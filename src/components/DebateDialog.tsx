import { useEffect, useMemo, useRef, useState } from 'react';
import { useAudioEventAdapter } from '../audio/reactAudioEventAdapter';
import { useGame } from '../game/store/GameProvider';
import type { Officer } from '../game/types';
import {
  DEBATE_STARTING_HP,
  TYPE_NAMES,
  maskFirstCardPreview,
  maskOpponentHand,
  roundAudioEvent,
  roundResultText,
  furyActionText,
  furyBadgeText,
  furyPortraitText,
  type DebateCard,
  type DebateRoundRecord,
  type DebateSession,
  type DebateTopic,
  type DebatePlayerState,
} from '../game/debate';

interface DebateDialogProps {
  onClose(): void;
}

/** 动画步骤（参照小程序 playRoundRevealSequence 演出时序） */
type AnimStep =
  | { kind: 'opp-thinking' }
  | { kind: 'reveal'; both: boolean }
  | { kind: 'result' }
  | { kind: 'fury'; index: number }
  | { kind: 'ai-first-thinking' };

interface AnimState {
  record: DebateRoundRecord;
  step: AnimStep;
  hp: { p1: number; p2: number };
  anger: { p1: number; p2: number };
}

const REVEAL_DELAY_MS = 2000;
const FURY_STEP_MS = 900;
const RETHINK_DELAY_MS = 2000;
const NEW_BADGE_MS = 5000;

/** 回合演出步骤队列 */
function buildAnimSteps(record: DebateRoundRecord): AnimStep[] {
  const steps: AnimStep[] = [];
  if (record.opponentRethought && !record.aiWasFirst) steps.push({ kind: 'opp-thinking' });
  if (record.aiWasFirst) {
    steps.push({ kind: 'reveal', both: true });
  } else {
    steps.push({ kind: 'reveal', both: false });
    steps.push({ kind: 'reveal', both: true });
  }
  steps.push({ kind: 'result' });
  record.furyActions.forEach((_, index) => steps.push({ kind: 'fury', index }));
  // 参照原小程序：后手重抽已在开头播过"对方思考中..."，AI 先手重抽不再重复提示，
  // 直接进入 first-card 遮罩预览（仅当本回合无后手重抽时才补一段先手思考提示）
  if (record.aiFirst?.rethought && !record.opponentRethought) steps.push({ kind: 'ai-first-thinking' });
  return steps;
}

function stepDuration(step: AnimStep): number {
  if (step.kind === 'fury') return FURY_STEP_MS;
  return REVEAL_DELAY_MS;
}

/** 步骤显示的血量/怒气（参照小程序快照逐步刷新） */
function stepGauges(record: DebateRoundRecord, step: AnimStep): { hp: { p1: number; p2: number }; anger: { p1: number; p2: number } } {
  if (step.kind === 'result' || step.kind === 'ai-first-thinking') {
    return {
      hp: {
        p1: Math.max(0, record.hpBefore.p1 - record.damageToP1),
        p2: Math.max(0, record.hpBefore.p2 - record.damageToP2),
      },
      anger: record.angerAfter,
    };
  }
  if (step.kind === 'fury') {
    const action = record.furyActions[step.index];
    if (action) return { hp: action.hpAfter, anger: action.angerAfter };
  }
  return { hp: record.hpBefore, anger: record.angerBefore };
}

function cardClass(card: DebateCard): string {
  if (card.type === 'skill') return `skill-card skill-${card.skill}`;
  return `topic-card topic-${card.topic}`;
}

function stageCardClass(card: DebateCard): string {
  if (card.type === 'skill') return `skill-${card.skill}`;
  return `topic-${card.topic}`;
}

/** 头像占位（暂无武将头像，以姓名首字代替） */
function PlaceholderPortrait({ name }: { name: string }) {
  return (
    <div className="fighter-portrait placeholder-portrait" aria-hidden="true">
      <span>{name.slice(0, 1)}</span>
    </div>
  );
}

function StatusCard({ player, side, hp, anger }: { player: DebatePlayerState; side: 'left' | 'right'; hp: number; anger: number }) {
  const hpPercent = Math.round((hp / (player.maxHp || DEBATE_STARTING_HP)) * 100);
  const tag = side === 'left' ? `我方 · ${player.trait}` : `对手 · ${player.trait}`;
  const furyBadge = furyBadgeText(player);
  return (
    <div className={`status-card status-${side}`}>
      <div className="status-name-row">
        <span className="status-name">{player.name}</span>
        <span className="status-tag">{tag}</span>
      </div>
      <div className="hp-track">
        <div className={`hp-fill ${hpPercent <= 25 ? 'hp-danger' : ''}`} style={{ width: `${Math.max(0, Math.min(100, hpPercent))}%` }} />
      </div>
      <div className="anger-track">
        <div className="anger-fill" style={{ width: `${Math.max(0, Math.min(100, anger))}%` }} />
      </div>
      <span className="status-values">血量 {hpPercent} / 怒气 {anger}</span>
      {furyBadge ? <span className="fury-badge">{furyBadge}</span> : null}
    </div>
  );
}

export function DebateDialog({ onClose }: DebateDialogProps) {
  const { state, debateRound, debateRethink, debateAbandon, dismissDebate } = useGame();
  const audio = useAudioEventAdapter();

  const [anim, setAnim] = useState<AnimState | null>(null);
  /** 出牌瞬间的双方手牌快照（动画期间按演出步骤逐步移除所出/所弃牌，动画结束后显示真实手牌） */
  const [handSnapshot, setHandSnapshot] = useState<{ p1: DebateCard[]; p2: ReturnType<typeof maskOpponentHand> } | null>(null);
  const [rethinkThinking, setRethinkThinking] = useState(false);
  const [showExitConfirm, setShowExitConfirm] = useState(false);
  const [showRules, setShowRules] = useState(false);
  const [newBadgeVisible, setNewBadgeVisible] = useState(true);

  const session = state?.debateSession ?? null;
  const finished = session?.status === 'finished';
  const ongoing = session?.status === 'ongoing';
  const busy = anim !== null || rethinkThinking;
  const animRecord = anim?.record ?? null;

  // 追踪已播放演出的回合，避免重复触发（克隆后引用变化但内容相同）
  const playedRef = useRef<string>('');

  const recruiter = session ? state?.officers[session.recruiterId] : undefined;
  const target = session ? state?.officers[session.targetId] : undefined;

  // 新发牌 5 秒后隐藏「新发」角标（动画/思考期间不计时，结束后重新展示）
  const handKey = useMemo(() => (session ? session.p1.cards.map((c) => c.uid).join(',') : ''), [session]);
  useEffect(() => {
    if (!handKey || anim || rethinkThinking) return;
    setNewBadgeVisible(true);
    const timer = window.setTimeout(() => setNewBadgeVisible(false), NEW_BADGE_MS);
    return () => window.clearTimeout(timer);
  }, [handKey, anim, rethinkThinking]);

  // 出牌后按小程序时序播放演出
  const lastRound = session?.lastRound ?? null;
  useEffect(() => {
    const record = lastRound;
    if (!record) return;
    const key = `${record.roundNo}-${record.p1Card.uid}`;
    if (playedRef.current === key) {
      // 无新回合产生（无效出牌等）：清除手牌快照恢复正常显示
      setHandSnapshot(null);
      return;
    }
    playedRef.current = key;

    const steps = buildAnimSteps(record);
    const firstStep = steps[0] ?? { kind: 'result' } as AnimStep;
    setAnim({ record, step: firstStep, ...stepGauges(record, firstStep) });
    if (firstStep.kind === 'result') audio.emit({ type: roundAudioEvent(record) });

    let index = 0;
    let cancelled = false;
    const advance = () => {
      if (cancelled) return;
      index += 1;
      if (index >= steps.length) {
        setAnim(null);
        setHandSnapshot(null);
        return;
      }
      const step = steps[index];
      setAnim({ record, step, ...stepGauges(record, step) });
      if (step.kind === 'result') audio.emit({ type: roundAudioEvent(record) });
      window.setTimeout(advance, stepDuration(step));
    };
    window.setTimeout(advance, stepDuration(firstStep));
    return () => {
      cancelled = true;
    };
  }, [lastRound, audio]);

  if (!session || !session.p1 || !session.p2 || !recruiter || !target || !state) return null;

  const p1 = session.p1;
  const p2 = session.p2;

  // 展示血量/怒气：演出中以动画状态为准
  const displayHp = anim ? anim.hp : { p1: p1.hp, p2: p2.hp };
  const displayAnger = anim ? anim.anger : { p1: p1.anger, p2: p2.anger };

  // 展示话题：诡辩换话题在激愤演出后才生效（参照小程序 applyPendingTopicChange 时机）
  const displayTopic: DebateTopic = anim
    ? (anim.step.kind === 'ai-first-thinking' ? anim.record.topicAfter : anim.record.topicBefore)
    : session.currentTopic;

  // 动画期间按演出步骤还原双方手牌：所出的牌移除、激愤弃牌逐步移除、补牌在演出结束后出现
  const oppCardRevealed = !!anim && !!animRecord && (
    (anim.step.kind === 'reveal' && anim.step.both) ||
    anim.step.kind === 'result' ||
    anim.step.kind === 'fury' ||
    anim.step.kind === 'ai-first-thinking'
  );
  const appliedFuryCount = !anim || !animRecord ? 0
    : anim.step.kind === 'fury' ? anim.step.index + 1
    : anim.step.kind === 'ai-first-thinking' ? animRecord.furyActions.length
    : 0;

  let p1Shown: DebateCard[] = handSnapshot ? handSnapshot.p1 : p1.cards;
  let p2Shown = handSnapshot ? handSnapshot.p2 : maskOpponentHand(p2.cards);
  if (handSnapshot && animRecord) {
    if (oppCardRevealed) {
      const playedIndex = p2Shown.findIndex((card) => card.uid === animRecord.p2Card.uid);
      if (playedIndex >= 0) {
        p2Shown = p2Shown.filter((_, i) => i !== playedIndex);
      } else if (!animRecord.aiWasFirst) {
        // 对手重抽后出的牌不在快照中：数量上仍需减一
        p2Shown = p2Shown.slice(0, -1);
      }
      // AI 先手牌在快照前已从手牌移除（中央遮罩预览），无需再减
    }
    const aiFirstCard = anim && anim.step.kind === 'ai-first-thinking' ? animRecord.aiFirst : null;
    if (aiFirstCard) {
      const reservedIndex = p2Shown.findIndex((card) => card.uid === aiFirstCard.card.uid);
      p2Shown = reservedIndex >= 0 ? p2Shown.filter((_, i) => i !== reservedIndex) : p2Shown.slice(0, -1);
    }
    for (let i = 0; i < appliedFuryCount; i += 1) {
      const action = animRecord.furyActions[i];
      if (!action?.card) continue;
      if (action.actor === 'p1') {
        p1Shown = p1Shown.filter((card) => card.uid !== action.card!.uid);
      } else {
        const dropIndex = p2Shown.findIndex((card) => card.uid === action.card!.uid);
        if (dropIndex >= 0) p2Shown = p2Shown.filter((_, j) => j !== dropIndex);
        else p2Shown = p2Shown.slice(0, -1);
      }
    }
  }
  const firstPreview = maskFirstCardPreview(ongoing && !anim ? session.firstCard : null);

  const canRethink = ongoing && !busy && (!p1.rethinkUsed || (p1.furyRounds > 0 && p1.trait === '冷静'));
  /** 对手思考状态（对齐原小程序 rethinkState：冷静激愤中可无限思考） */
  const p2UnlimitedRethink = p2.furyRounds > 0 && p2.trait === '冷静';
  const p2CanRethink = !p2.rethinkUsed || p2UnlimitedRethink;
  /** 对手冷静激愤中，无视/大喝一声/强词夺理不可用 */
  const cardBlocked = (card: DebateCard): boolean =>
    p2.furyRounds > 0 && p2.trait === '冷静' && card.type === 'skill' && (card.skill === 'ignore' || card.skill === 'shout' || card.skill === 'sophistry');

  const onHandTap = (card: DebateCard) => {
    if (!ongoing || busy || finished) return;
    if (cardBlocked(card)) return;
    // 快照出牌瞬间的双方手牌：动画期间基于快照逐步演出（出牌/弃牌移除），动画结束显示真实手牌
    setHandSnapshot({
      p1: p1.cards.filter((item) => item.uid !== card.uid),
      p2: maskOpponentHand(p2.cards),
    });
    debateRound(card.uid);
  };

  const onRethink = () => {
    if (!canRethink) return;
    setRethinkThinking(true);
    window.setTimeout(() => {
      setRethinkThinking(false);
      debateRethink();
    }, RETHINK_DELAY_MS);
  };

  const onExit = () => {
    if (ongoing) {
      setShowExitConfirm(true);
      return;
    }
    dismissDebate();
    onClose();
  };

  const confirmExit = () => {
    setShowExitConfirm(false);
    debateAbandon();
  };

  const closeSettlement = () => {
    dismissDebate();
    onClose();
  };

  // ---------- 中央对战区内容（参照小程序 result-panel 各 displayMode） ----------
  const stage = (() => {
    if (anim && animRecord) {
      const { step, record } = anim;
      if (step.kind === 'opp-thinking') {
        return (
          <div className="stage-card-pair">
            <div className={`stage-card stage-card-box ${stageCardClass(record.p1Card)}`}>
              <span className="stage-card-name">{record.p1Card.name}</span>
              {record.p1Card.desc ? <span className="stage-card-desc">{record.p1Card.desc}</span> : null}
            </div>
            <div className="stage-card stage-card-box opponent-thinking-tip">对方思考中...</div>
          </div>
        );
      }
      if (step.kind === 'reveal') {
        return (
          <div className="stage-card-pair">
            <div className={`stage-card stage-card-box ${stageCardClass(record.p1Card)}`}>
              <span className="stage-card-name">{record.p1Card.name}</span>
              {record.p1Card.desc ? <span className="stage-card-desc">{record.p1Card.desc}</span> : null}
            </div>
            {step.both ? (
              <div className={`stage-card stage-card-box ${stageCardClass(record.p2Card)}`}>
                <span className="stage-card-name">{record.p2Card.name}</span>
                {record.p2Card.desc ? <span className="stage-card-desc">{record.p2Card.desc}</span> : null}
              </div>
            ) : (
              <div className="stage-card stage-card-box opponent-thinking-tip">正在出牌...</div>
            )}
          </div>
        );
      }
      if (step.kind === 'result') {
        const resultText = roundResultText(record);
        const damage = resultText.tone === 'win' ? record.damageToP2 : resultText.tone === 'lose' ? record.damageToP1 : 0;
        return (
          <>
            <div className="played-row">
              <span className={`played-name ${stageCardClass(record.p1Card)}`}>{record.p1Card.name}</span>
              <span className={`result-word result-${resultText.tone}`}>{resultText.text}</span>
              <span className={`played-name ${stageCardClass(record.p2Card)}`}>{record.p2Card.name}</span>
            </div>
            <div className="round-tip">{record.reason}{damage > 0 ? `，造成${damage}点伤害` : ''}</div>
          </>
        );
      }
      if (step.kind === 'fury') {
        const action = record.furyActions[step.index];
        if (!action) return null;
        return (
          <div className="fury-anim">
            <div className={`fury-action-card ${action.card ? stageCardClass(action.card) : 'skill-masked'}`}>
              <span className="stage-card-name">{action.card ? action.card.name : '愤怒'}</span>
              <span className="stage-card-desc">{furyActionText(action)}</span>
            </div>
            <div className="fury-damage">{action.damage > 0 ? `-${action.damage}` : '0'}</div>
            <div className="fury-text">{action.portrait ?? action.text ?? `${action.trait ?? ''}爆发`}</div>
          </div>
        );
      }
      // ai-first-thinking
      return (
        <div className="stage-card-pair">
          <div className="stage-card stage-card-box stage-empty" />
          <div className="stage-card stage-card-box opponent-thinking-tip">对方思考中...</div>
        </div>
      );
    }
    if (finished) {
      return <div className="round-tip">舌战已结束</div>;
    }
    if (firstPreview) {
      return (
        <div className="stage-card-pair">
          <div className="stage-card stage-card-box stage-empty" />
          <div className={`stage-card stage-card-box masked-preview ${firstPreview.type === 'topic' ? `topic-${firstPreview.topic}` : 'skill-masked'}`}>
            <span className="stage-card-name">{firstPreview.displayName}</span>
          </div>
        </div>
      );
    }
    return <div className="stage-card stage-card-box stage-empty" />;
  })();

  return (
    <div className="debate-page" role="dialog" aria-label="舌战">
      <div className="debate-shell">
        <header className="debate-header">
          <div className="debate-title-wrap">
            <h2 className="debate-title">舌战</h2>
            <p className="debate-subtitle">第 {session.round} 回合 · {session.firstPlayer === 1 ? '我方先手' : '对方先手'}</p>
          </div>
          <button type="button" className="exit-btn" onClick={onExit}>退出</button>
        </header>

        <section className="debate-status">
          <StatusCard player={p1} side="left" hp={displayHp.p1} anger={displayAnger.p1} />
          <StatusCard player={p2} side="right" hp={displayHp.p2} anger={displayAnger.p2} />
        </section>

        <section className="duel-stage">
          <div className="portrait-side portrait-left">
            <PlaceholderPortrait name={p1.name} />
            <span className="portrait-name">{p1.name}</span>
            {furyPortraitText(p1) ? <span className="fury-portrait-tip">{furyPortraitText(p1)}</span> : null}
          </div>
          <div className="battle-center">
            <div className="result-panel">{stage}</div>
            <div className={`current-topic topic-${displayTopic}`}>
              <span className="topic-label">当前话题</span>
              <span className="topic-name">{TYPE_NAMES[displayTopic]}</span>
            </div>
          </div>
          <div className="portrait-side portrait-right">
            <PlaceholderPortrait name={p2.name} />
            <span className="portrait-name">{p2.name}</span>
            {furyPortraitText(p2) ? <span className="fury-portrait-tip">{furyPortraitText(p2)}</span> : null}
          </div>
        </section>

        <section className="hands-arena">
          <div className="player-hand-stack">
            <button
              type="button"
              className="rethink-btn"
              onClick={onRethink}
              disabled={!canRethink}
            >
              {rethinkThinking ? '思考中...' : p1.rethinkUsed ? '思考（已用）' : '思考'}
            </button>
            <div className="hand-panel player-hand-panel">
              <div className="hand-header">
                <span className="section-title">我方手牌（{p1Shown.length}）</span>
              </div>
              <div className="hand-list">
                {p1Shown.map((card) => (
                  <button
                    key={card.uid}
                    type="button"
                    className={`hand-card ${cardClass(card)} ${card.topic === displayTopic ? 'current-topic-card' : ''} ${cardBlocked(card) ? 'card-blocked' : ''}`}
                    onClick={() => onHandTap(card)}
                    disabled={!ongoing || busy || cardBlocked(card)}
                  >
                    {card.type === 'skill' ? <span className="hand-card-type">术</span> : null}
                    <span className="hand-card-name">{card.name}</span>
                    {card.type === 'skill' && card.desc ? <span className="hand-card-desc">{card.desc}</span> : null}
                    {card.isNew && newBadgeVisible ? <span className="new-badge">新发</span> : null}
                    {cardBlocked(card) ? <span className="blocked-tip">被封锁</span> : null}
                  </button>
                ))}
              </div>
            </div>
          </div>
          <div className="opponent-hand-stack">
            <span className={`rethink-pill ${p2CanRethink ? '' : 'used'}`}>
              {p2CanRethink ? (p2UnlimitedRethink ? '思考可用·激愤' : '思考可用') : '思考已用'}
            </span>
            <div className="hand-panel opponent-hand-panel">
              <div className="hand-header opponent-header">
                <span className="section-title">对手手牌（{p2Shown.length}）</span>
              </div>
              <div className="hand-list">
                {p2Shown.map((card) => (
                  <div
                    key={card.uid}
                    className={`hand-card opponent-card ${card.type === 'skill' ? `skill-card skill-${card.id}` : `topic-card topic-${card.topic ?? 'story'}`}${card.type === 'topic' && card.topic === displayTopic ? ' current-topic-card' : ''}`}
                  >
                    {card.type === 'skill' ? <span className="hand-card-type">术</span> : null}
                    <span className="hand-card-name">{card.displayName}</span>
                    {card.isNew && newBadgeVisible ? <span className="new-badge">新发</span> : null}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        <section className="debate-rules">
          <button type="button" className="rules-toggle" onClick={() => setShowRules((v) => !v)}>
            舌战规则 {showRules ? '▲' : '▼'}
          </button>
          {showRules ? (
            <ol className="rules-list">
              <li>回合开始随机确定话题，双方各出一张牌，胜者下回合先手。</li>
              <li>话题牌分「故事/道理/时节」×「大/中/小」，当前话题的牌更强，同级大&gt;中&gt;小。</li>
              <li>话术牌：无视 &gt; 大喝一声 &gt; 强词夺理 &gt; 话题牌 &gt; 镇静/愤怒。</li>
              <li>无视使对方牌无效化；大喝一声压过除无视外的牌；强词夺理获胜后切换话题。</li>
              <li>镇静降低对方怒气或解除激愤；愤怒快速积攒自身怒气。</li>
              <li>血量按百分比显示，先归零的一方落败。</li>
              <li>败方累积怒气，怒气满 100 触发性格激愤：冷静=伤害翻倍、刚胆=话题牌必胜、莽撞=爆发大伤害、小心=掷出全部话题牌。</li>
              <li>激愤持续 3 回合（莽撞/小心为一次性爆发）。</li>
              <li>对方激愤时，手中「愤怒」自动反弹、「镇静」强制化解。</li>
              <li>「思考」可重抽手牌，整局 1 次；血量每跌破 75/50/25 各返还 1 次。</li>
              <li>每回合结束自动补牌至手牌上限。</li>
              <li>话术牌上限 2 张且不重复；智力越高越易抽到话术。</li>
            </ol>
          ) : null}
        </section>
      </div>

      {showExitConfirm ? (
        <div className="debate-modal-mask">
          <div className="exit-confirm-modal">
            <p>强制退出将判负本场舌战，{target.name}短期内不会再应允登庸。</p>
            <footer>
              <button type="button" className="modal-btn ghost" onClick={() => setShowExitConfirm(false)}>继续舌战</button>
              <button type="button" className="modal-btn danger" onClick={confirmExit}>确认退出</button>
            </footer>
          </div>
        </div>
      ) : null}

      {finished && !anim ? <SettlementModal session={session} target={target} onClose={closeSettlement} /> : null}
    </div>
  );
}

function SettlementModal({ session, target, onClose }: { session: DebateSession; target: Officer; onClose(): void }) {
  const win = session.winner === 'recruiter';
  return (
    <div className="debate-modal-mask">
      <div className="settlement-modal">
        {win ? (
          <>
            <h3 className="settlement-title win">新人物加入</h3>
            <p className="settlement-text">成功说服{target.name}加入我方阵营！</p>
            <div className="officer-card-mini">
              <div className="officer-card-name">{target.name}</div>
              <div className="officer-card-force">{target.forceId ? '已加入我方' : '在野'}</div>
              <div className="officer-card-stats">
                <span>统 {target.stats.leadership}</span>
                <span>武 {target.stats.war}</span>
                <span>智 {target.stats.intelligence}</span>
                <span>政 {target.stats.politics}</span>
                <span>魅 {target.stats.charisma}</span>
              </div>
              {target.skill ? <div className="officer-card-skill">特技 · {target.skill}</div> : null}
            </div>
          </>
        ) : (
          <>
            <h3 className="settlement-title lose">舌战失败</h3>
            <p className="settlement-text">{target.name}婉拒了招揽，约 3 个月内不会再应允登庸。</p>
          </>
        )}
        <footer>
          <button type="button" className="modal-btn primary" onClick={onClose}>确定</button>
        </footer>
      </div>
    </div>
  );
}
