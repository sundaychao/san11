import { nextRandom } from './random';
import { recruitmentInitialLoyalty } from './loyalty';
import type { CityId, ForceId, GameState, Officer } from './types';

/**
 * 舌战系统（参考《三国志11》舌战规则）：
 * - 话题卡：故事/道理/时节 × 大/中/小 共 9 种；话术卡：无视/大喝/诡辩/镇静/逆上 共 5 种。
 * - 手牌数随智力：<70→3 张，70~79→4 张，80~89→5 张，90+→6 张。
 * - 每回合双方各出一卡比较胜负，负方心理值减损；心理值先归零者败北。
 * - 判定顺序：当前话题的话题卡 > 其他话题卡；同话题按大>中>小；话术克制：
 *   无视 > 大喝 > 诡辩 > 话题卡 > 镇静 > 逆上。
 * - 负方怒气上升，怒气满进入「激愤状态」，按性格（莽撞/刚胆/冷静/胆小）发动特殊攻击。
 * - 登庸触发：对在野武将使用「登庸」命令后进入本系统，玩家每回合出卡（可再考换牌），
 *   舌战获胜则登用成功，失利则目标短期内无法再登用。
 */

export type DebateTopic = 'story' | 'moral' | 'timing';
export type DebateSize = 'big' | 'medium' | 'small';
export type DebateSkill = 'ignore' | 'shout' | 'sophistry' | 'calm' | 'provoke';

export type DebateCard =
  | { kind: 'topic'; topic: DebateTopic; size: DebateSize }
  | { kind: 'skill'; skill: DebateSkill };

/** 激愤形态：按武将性格映射 */
export type RageKind = 'reckless' | 'bold' | 'calm' | 'timid';

export interface DebateRoundLog {
  round: number;
  /** 特殊回合标记：rage=激愤攻击、normal=常规比卡 */
  kind: 'normal' | 'rage';
  rageSide: 'recruiter' | 'target' | null;
  recruiterCardLabel: string;
  targetCardLabel: string;
  result: 'recruiter' | 'target' | 'draw';
  damage: number;
  narration: string;
  hpAfter: { recruiter: number; target: number };
  rageAfter: { recruiter: number; target: number };
}

export interface DebateSession {
  recruiterId: string;
  targetId: string;
  topic: DebateTopic;
  recruiterFirst: boolean;
  recruiterHp: number;
  targetHp: number;
  recruiterRage: number;
  targetRage: number;
  recruiterHand: DebateCard[];
  targetHand: DebateCard[];
  /** 激愤剩余回合数（>0 表示处于激愤状态），0 = 未进入 */
  recruiterRageMode: number;
  targetRageMode: number;
  recruiterRageKind: RageKind | null;
  targetRageKind: RageKind | null;
  /** 玩家本回合是否已用过再考 */
  recruiterRethinkUsed: boolean;
  status: 'ongoing' | 'finished';
  winner: 'recruiter' | 'target' | null;
  logs: DebateRoundLog[];
}

export const DEBATE_MAX_HP = 100;
export const DEBATE_MAX_RAGE = 100;
export const RAGE_MODE_ROUNDS = 3;

export const TOPIC_LABELS_ZH: Record<DebateTopic, string> = {
  story: '故事',
  moral: '道理',
  timing: '时节',
};

export const SIZE_LABELS_ZH: Record<DebateSize, string> = {
  big: '大',
  medium: '中',
  small: '小',
};

export const SKILL_LABELS_ZH: Record<DebateSkill, string> = {
  ignore: '无视',
  shout: '大喝',
  sophistry: '诡辩',
  calm: '镇静',
  provoke: '逆上',
};

export const RAGE_KIND_LABELS_ZH: Record<RageKind, string> = {
  reckless: '莽撞',
  bold: '刚胆',
  calm: '冷静',
  timid: '胆小',
};

/** 每位武将可取的话术池（按性格） */
export const SKILL_POOL_BY_PERSONALITY: Record<string, DebateSkill[]> = {
  reckless: ['shout', 'shout', 'provoke', 'sophistry', 'ignore'],
  bold: ['shout', 'shout', 'sophistry', 'provoke', 'calm'],
  calm: ['sophistry', 'ignore', 'calm', 'calm', 'provoke'],
  timid: ['ignore', 'calm', 'calm', 'sophistry', 'shout'],
};

/** 手牌数：智力越高卡越多 */
export function handSizeFor(intelligence: number): number {
  if (intelligence >= 90) return 6;
  if (intelligence >= 80) return 5;
  if (intelligence >= 70) return 4;
  return 3;
}

/** 话题卡基础伤害 */
const TOPIC_DAMAGE: Record<DebateSize, number> = { big: 24, medium: 16, small: 10 };

/** 智力伤害系数：智力越高同张卡威力越大（55→0.7，100→1.0） */
function damageScale(intelligence: number): number {
  return (50 + intelligence) / 150;
}

/** 单张话题卡的伤害值 */
export function topicCardDamage(card: DebateCard, intelligence: number): number {
  if (card.kind !== 'topic') return 0;
  return Math.max(3, Math.round(TOPIC_DAMAGE[card.size] * damageScale(intelligence)));
}

/** 生成一张随机话题卡 */
function randomTopicCard(state: GameState, topic?: DebateTopic): DebateCard {
  const roll = nextRandom(state.seed, state.rngCursor);
  state.rngCursor = roll.cursor;
  const sizeRoll = nextRandom(state.seed, state.rngCursor);
  state.rngCursor = sizeRoll.cursor;
  const topics: DebateTopic[] = ['story', 'moral', 'timing'];
  const sizes: DebateSize[] = ['big', 'medium', 'small'];
  return {
    kind: 'topic',
    topic: topic ?? topics[Math.floor(roll.value * topics.length)],
    size: sizes[Math.floor(sizeRoll.value * sizes.length)],
  };
}

/** 生成一张话术卡（按性格话术池） */
function randomSkillCard(state: GameState, personality: string): DebateCard {
  const pool = SKILL_POOL_BY_PERSONALITY[personality] ?? SKILL_POOL_BY_PERSONALITY.calm;
  const roll = nextRandom(state.seed, state.rngCursor);
  state.rngCursor = roll.cursor;
  return { kind: 'skill', skill: pool[Math.floor(roll.value * pool.length)] };
}

/** 发一手牌：约 75% 话题卡 + 25% 话术卡，至少保留1张话题保证可出 */
export function drawHand(state: GameState, officer: Officer): DebateCard[] {
  const size = handSizeFor(officer.stats.intelligence);
  const hand: DebateCard[] = [];
  for (let index = 0; index < size - 1; index += 1) {
    const roll = nextRandom(state.seed, state.rngCursor);
    state.rngCursor = roll.cursor;
    hand.push(roll.value < 0.75 ? randomTopicCard(state) : randomSkillCard(state, officer.personality ?? 'calm'));
  }
  hand.push(randomTopicCard(state));
  return hand;
}

/** 卡面文案 */
export function cardLabel(card: DebateCard): string {
  if (card.kind === 'topic') {
    return `${TOPIC_LABELS_ZH[card.topic]}${SIZE_LABELS_ZH[card.size]}`;
  }
  return SKILL_LABELS_ZH[card.skill];
}

/** 卡牌在与当前话题比较时的强度分（用于 AI 决策与胜负顺序） */
function cardPotency(card: DebateCard, topic: DebateTopic, skillBlocked: boolean): number {
  if (card.kind === 'skill') {
    if (skillBlocked) return -1;
    switch (card.skill) {
      case 'ignore': return 9;
      case 'shout': return 8;
      case 'sophistry': return 7;
      case 'calm': return 1;
      case 'provoke': return 0;
    }
  }
  if (card.topic === topic) {
    return card.size === 'big' ? 6 : card.size === 'medium' ? 5 : 4;
  }
  return card.size === 'big' ? 3 : card.size === 'medium' ? 2 : 1;
}

/** 话术卡是否被「冷静」激愤状态封锁 */
function skillBlockedFor(skillSide: 'recruiter' | 'target', session: DebateSession): boolean {
  if (skillSide === 'recruiter') return session.targetRageMode > 0 && session.targetRageKind === 'calm';
  return session.recruiterRageMode > 0 && session.recruiterRageKind === 'calm';
}

/**
 * 创建舌战会话（登庸在野武将时调用）。
 */
export function createDebate(
  state: GameState,
  recruiter: Officer,
  target: Officer,
): DebateSession {
  const topicRoll = nextRandom(state.seed, state.rngCursor);
  state.rngCursor = topicRoll.cursor;
  const topics: DebateTopic[] = ['story', 'moral', 'timing'];
  const topic = topics[Math.floor(topicRoll.value * topics.length)];
  return {
    recruiterId: recruiter.id,
    targetId: target.id,
    topic,
    recruiterFirst: recruiter.stats.intelligence >= target.stats.intelligence,
    recruiterHp: DEBATE_MAX_HP,
    targetHp: DEBATE_MAX_HP,
    recruiterRage: 0,
    targetRage: 0,
    recruiterHand: drawHand(state, recruiter),
    targetHand: drawHand(state, target),
    recruiterRageMode: 0,
    targetRageMode: 0,
    recruiterRageKind: null,
    targetRageKind: null,
    recruiterRethinkUsed: false,
    status: 'ongoing',
    winner: null,
    logs: [],
  };
}

/** 变更当前话题（胜方出话题卡时话题随其改变：诡辩胜利额外重置话题） */
function nextTopic(current: DebateTopic, winnerCard: DebateCard | null, sophistryFlip: boolean, state: GameState): DebateTopic {
  if (sophistryFlip) {
    const roll = nextRandom(state.seed, state.rngCursor);
    state.rngCursor = roll.cursor;
    const topics: DebateTopic[] = ['story', 'moral', 'timing'];
    return topics[Math.floor(roll.value * topics.length)];
  }
  if (winnerCard && winnerCard.kind === 'topic') return winnerCard.topic;
  return current;
}

function isIgnoreOrShout(card: DebateCard): boolean {
  return card.kind === 'skill' && (card.skill === 'ignore' || card.skill === 'shout');
}

/** 胜方卡的伤害值（含冷静翻倍等修正） */
function damageFor(
  winnerCard: DebateCard,
  loserCard: DebateCard,
  winner: Officer,
  loser: Officer,
): number {
  void loser;
  if (winnerCard.kind === 'skill') {
    switch (winnerCard.skill) {
      case 'shout':
        return Math.max(4, Math.round(30 * damageScale(winner.stats.intelligence)));
      case 'sophistry': {
        // 诡辩：威力视对手话题卡大小反弹
        const bonus = loserCard.kind === 'topic'
          ? loserCard.size === 'big' ? 8 : loserCard.size === 'medium' ? 4 : 2
          : 0;
        return Math.max(4, Math.round((20 + bonus) * damageScale(winner.stats.intelligence)));
      }
      case 'ignore':
      case 'calm':
      case 'provoke':
        return 0;
    }
  }
  return topicCardDamage(winnerCard, winner.stats.intelligence);
}

/** 计算一轮常规比卡：返回胜者与伤害 */
function resolveCardClash(
  recruiterCard: DebateCard,
  targetCard: DebateCard,
  topic: DebateTopic,
  recruiter: Officer,
  target: Officer,
  session: DebateSession,
): { winner: 'recruiter' | 'target' | 'draw'; damage: number; sophistryFlip: boolean } {
  const recruiterSkillBlocked = skillBlockedFor('recruiter', session);
  const targetSkillBlocked = skillBlockedFor('target', session);
  const recruiterPotency = cardPotency(recruiterCard, topic, recruiterSkillBlocked);
  const targetPotency = cardPotency(targetCard, topic, targetSkillBlocked);

  // 刚胆激愤：对方攻击无效（除大喝/无视）。
  const recruiterBold = session.recruiterRageMode > 0 && session.recruiterRageKind === 'bold';
  const targetBold = session.targetRageMode > 0 && session.targetRageKind === 'bold';

  let winner: 'recruiter' | 'target' | 'draw' = 'draw';
  let damage = 0;
  let sophistryFlip = false;

  const targetAttackCounts = !(recruiterBold && !isIgnoreOrShout(targetCard));
  const recruiterAttackCounts = !(targetBold && !isIgnoreOrShout(recruiterCard));

  if (targetAttackCounts && targetPotency > recruiterPotency) winner = 'target';
  else if (recruiterAttackCounts && recruiterPotency > targetPotency) winner = 'recruiter';
  // 双方攻击均无效（互为空转/同分）时为平局

  if (winner === 'recruiter') {
    damage = damageFor(recruiterCard, targetCard, recruiter, target);
    if (recruiterCard.kind === 'skill' && recruiterCard.skill === 'sophistry') sophistryFlip = true;
  } else if (winner === 'target') {
    damage = damageFor(targetCard, recruiterCard, target, recruiter);
    if (targetCard.kind === 'skill' && targetCard.skill === 'sophistry') sophistryFlip = true;
  }
  return { winner, damage, sophistryFlip };
}

/** AI 为对方挑选一张卡（返回手牌下标） */
export function aiPickCard(state: GameState, session: DebateSession): number {
  const hand = session.targetHand;
  const handCount = hand.length;
  if (handCount === 0) return 0;

  const topic = session.topic;
  // 己方局势：怒气高优先逆上，心理值低优先大喝，对方激愤中优先镇静解除
  const preferProvoke = session.targetRage >= 80 && hand.some((card) => card.kind === 'skill' && card.skill === 'provoke');
  const preferShout = session.recruiterHp <= 30 && hand.some((card) => card.kind === 'skill' && card.skill === 'shout');
  const preferCalm = session.recruiterRageMode > 0 && hand.some((card) => card.kind === 'skill' && card.skill === 'calm');

  const scored = hand.map((card, index) => {
    let score = cardPotency(card, topic, skillBlockedFor('target', session));
    if (preferProvoke && card.kind === 'skill' && card.skill === 'provoke') score += 20;
    if (preferShout && card.kind === 'skill' && card.skill === 'shout') score += 20;
    if (preferCalm && card.kind === 'skill' && card.skill === 'calm') score += 20;
    if (card.kind === 'skill' && card.skill === 'ignore') score += 2; // 防御卡略加分
    return { index, score };
  });
  scored.sort((a, b) => b.score - a.score);

  const roll = nextRandom(state.seed, state.rngCursor);
  state.rngCursor = roll.cursor;
  // 90% 出当前最优，10% 出次优增加变数
  const pick = roll.value < 0.9 ? scored[0] : (scored[1] ?? scored[0]);
  return pick.index;
}

/** 判断某侧是否进入激愤（怒气满且未在激愤中） */
function rageEntry(side: 'recruiter' | 'target', session: DebateSession): boolean {
  const rage = side === 'recruiter' ? session.recruiterRage : session.targetRage;
  const mode = side === 'recruiter' ? session.recruiterRageMode : session.targetRageMode;
  return rage >= DEBATE_MAX_RAGE && mode <= 0;
}

/**
 * 处理激愤状态入口：若是，则执行一波特殊攻击并返回该侧已进入
 * （莽撞/胆小为一次性爆发，刚胆/冷静进入持续状态）。
 */
function applyRageEntry(
  state: GameState,
  session: DebateSession,
  side: 'recruiter' | 'target',
  recruiter: Officer,
  target: Officer,
): void {
  if (!rageEntry(side, session)) return;
  const personality = (side === 'recruiter' ? recruiter : target).personality ?? 'calm';
  const rageKind: RageKind = personality === 'reckless' ? 'reckless' : personality === 'bold' ? 'bold'
    : personality === 'timid' ? 'timid' : 'calm';
  const actor = side === 'recruiter' ? recruiter : target;
  const opponent = side === 'recruiter' ? target : recruiter;
  const actorName = actor.name;
  const label = RAGE_KIND_LABELS_ZH[rageKind];

  if (side === 'recruiter') {
    session.recruiterRageMode = rageKind === 'bold' || rageKind === 'calm' ? RAGE_MODE_ROUNDS : 1;
    session.recruiterRageKind = rageKind;
  } else {
    session.targetRageMode = rageKind === 'bold' || rageKind === 'calm' ? RAGE_MODE_ROUNDS : 1;
    session.targetRageKind = rageKind;
  }

  let damage = 0;
  let narration = '';
  if (rageKind === 'reckless') {
    damage = Math.round(42 * damageScale(actor.stats.intelligence));
    if (side === 'recruiter') session.recruiterRage = 0;
    else session.targetRage = 0;
    narration = `${actorName}的「${label}」激愤爆发，对${opponent.name}造成${damage}点重创！`;
  } else if (rageKind === 'timid') {
    // 胆小：一次性打出所有话题卡
    const topicCards = (side === 'recruiter' ? session.recruiterHand : session.targetHand)
      .filter((card): card is Extract<DebateCard, { kind: 'topic' }> => card.kind === 'topic');
    damage = topicCards.reduce((sum, card) => sum + topicCardDamage(card, actor.stats.intelligence), 0);
    if (side === 'recruiter') {
      session.recruiterHand = session.recruiterHand.filter((card) => card.kind !== 'topic');
      session.recruiterRage = 0;
    } else {
      session.targetHand = session.targetHand.filter((card) => card.kind !== 'topic');
      session.targetRage = 0;
    }
    narration = `${actorName}「${label}」喋喋不休，将手中话题全部掷出，造成${damage}点伤害！`;
  } else if (rageKind === 'bold') {
    if (side === 'recruiter') session.recruiterRage = 30;
    else session.targetRage = 30;
    narration = `${actorName}进入「${label}」激愤，${RAGE_MODE_ROUNDS}回合内对方攻击全部化为乌有！`;
  } else {
    if (side === 'recruiter') session.recruiterRage = 30;
    else session.targetRage = 30;
    narration = `${actorName}进入「${label}」激愤，攻击翻倍并封锁对方话术${RAGE_MODE_ROUNDS}回合！`;
  }

  if (damage > 0) {
    if (side === 'recruiter') session.targetHp = Math.max(0, session.targetHp - damage);
    else session.recruiterHp = Math.max(0, session.recruiterHp - damage);
  }

  session.logs.push({
    round: session.logs.length + 1,
    kind: 'rage',
    rageSide: side,
    recruiterCardLabel: '—',
    targetCardLabel: '—',
    result: side,
    damage,
    narration,
    hpAfter: { recruiter: session.recruiterHp, target: session.targetHp },
    rageAfter: { recruiter: session.recruiterRage, target: session.targetRage },
  });

  if (session.recruiterHp <= 0 || session.targetHp <= 0) {
    finishDebate(session);
  }
}

function finishDebate(session: DebateSession): void {
  session.status = 'finished';
  if (session.recruiterHp <= 0 && session.targetHp <= 0) session.winner = null;
  else if (session.recruiterHp <= 0) session.winner = 'target';
  else session.winner = 'recruiter';
}

/** 结算一回合（玩家出第 playerCardIndex 张卡，对方由 AI 决策） */
export function resolveDebateRound(state: GameState, playerCardIndex: number): GameState {
  const next = structuredClone(state);
  const session = next.debateSession;
  if (!session || session.status !== 'ongoing') return next;

  const recruiter = next.officers[session.recruiterId];
  const target = next.officers[session.targetId];
  if (!recruiter || !target) return next;

  // 1. 激愤入口（双方依次检测，进入后立即结算一次特殊攻击）
  applyRageEntry(next, session, 'recruiter', recruiter, target);
  if (session.status !== 'ongoing') {
    settleDebateOutcome(next, session, recruiter, target);
    next.debateSession = session;
    return next;
  }
  applyRageEntry(next, session, 'target', recruiter, target);
  if (session.status !== 'ongoing') {
    settleDebateOutcome(next, session, recruiter, target);
    next.debateSession = session;
    return next;
  }

  // 2. 玩家出卡
  const recruiterCard = session.recruiterHand[playerCardIndex];
  if (!recruiterCard) return next;
  session.recruiterHand.splice(playerCardIndex, 1);

  // 3. 对方换牌（手里没有对应当前话题且无强力话术时，25% 概率再考）
  const goodForTarget = session.targetHand.some((card) => {
    if (card.kind === 'topic' && card.topic === session.topic) return true;
    return card.kind === 'skill' && card.skill !== 'calm' && card.skill !== 'provoke';
  });
  if (!goodForTarget) {
    const rethinkRoll = nextRandom(next.seed, next.rngCursor);
    next.rngCursor = rethinkRoll.cursor;
    if (rethinkRoll.value < 0.25) {
      session.targetHand = drawHand(next, target);
    }
  }

  // 4. 对方出卡（AI）
  const targetIndex = aiPickCard(next, session);
  const targetCard = session.targetHand[targetIndex];
  session.targetHand.splice(targetIndex, 1);

  // 5. 判定
  const clash = resolveCardClash(recruiterCard, targetCard, session.topic, recruiter, target, session);

  // 6. 应用伤害
  if (clash.winner === 'recruiter' && clash.damage > 0) {
    session.targetHp = Math.max(0, session.targetHp - clash.damage);
  } else if (clash.winner === 'target' && clash.damage > 0) {
    session.recruiterHp = Math.max(0, session.recruiterHp - clash.damage);
  }

  // 话术附加效果（无视/镇静/逆上）
  applySkillEffects(session, recruiterCard, targetCard);

  // 回合胜负决定下回合先手与话题
  session.topic = nextTopic(session.topic, clash.winner === 'recruiter' ? recruiterCard : clash.winner === 'target' ? targetCard : null, clash.sophistryFlip, next);
  session.recruiterFirst = clash.winner !== 'target';
  session.recruiterRethinkUsed = false;

  const damageDealt = clash.damage;
  const narration = buildNarration(recruiterCard, targetCard, clash.winner, damageDealt, recruiter, target);
  session.logs.push({
    round: session.logs.length + 1,
    kind: 'normal',
    rageSide: null,
    recruiterCardLabel: cardLabel(recruiterCard),
    targetCardLabel: cardLabel(targetCard),
    result: clash.winner,
    damage: damageDealt,
    narration,
    hpAfter: { recruiter: session.recruiterHp, target: session.targetHp },
    rageAfter: { recruiter: session.recruiterRage, target: session.targetRage },
  });

  // 怒气累计：负方 +8，平局双方 +4
  if (clash.winner === 'recruiter') {
    session.targetRage = Math.min(DEBATE_MAX_RAGE, session.targetRage + 8);
  } else if (clash.winner === 'target') {
    session.recruiterRage = Math.min(DEBATE_MAX_RAGE, session.recruiterRage + 8);
  } else {
    session.recruiterRage = Math.min(DEBATE_MAX_RAGE, session.recruiterRage + 4);
    session.targetRage = Math.min(DEBATE_MAX_RAGE, session.targetRage + 4);
  }
  // 激愤持续回合递减
  if (session.recruiterRageMode > 0) {
    session.recruiterRageMode -= 1;
    if (session.recruiterRageMode <= 0) session.recruiterRageKind = null;
  }
  if (session.targetRageMode > 0) {
    session.targetRageMode -= 1;
    if (session.targetRageMode <= 0) session.targetRageKind = null;
  }

  // 7. 胜负判定
  if (session.recruiterHp <= 0 || session.targetHp <= 0) {
    finishDebate(session);
  }

  // 8. 舌战结束 → 结算登用结果；未结束则双方各补满一手新牌进入下一回合
  if (session.status !== 'ongoing') {
    settleDebateOutcome(next, session, recruiter, target);
  } else {
    session.recruiterHand = drawHand(next, recruiter);
    session.targetHand = drawHand(next, target);
  }

  next.debateSession = session;
  return next;
}

/** 话术卡附加效果：无视（对方怒气+12）、镇静（对方怒气-10/解除激愤）、逆上（自身怒气+14） */
function applySkillEffects(session: DebateSession, recruiterCard: DebateCard, targetCard: DebateCard): void {
  if (recruiterCard.kind === 'skill') {
    if (recruiterCard.skill === 'ignore') {
      session.targetRage = Math.min(DEBATE_MAX_RAGE, session.targetRage + 12);
    } else if (recruiterCard.skill === 'calm') {
      session.targetRage = Math.max(0, session.targetRage - 10);
      if (session.targetRageMode > 0) {
        session.targetRageMode = 0;
        session.targetRageKind = null;
      }
    } else if (recruiterCard.skill === 'provoke') {
      if (session.targetRageMode > 0) {
        session.recruiterRage = DEBATE_MAX_RAGE;
      } else {
        session.recruiterRage = Math.min(DEBATE_MAX_RAGE, session.recruiterRage + 14);
      }
    }
  }
  if (targetCard.kind === 'skill') {
    if (targetCard.skill === 'ignore') {
      session.recruiterRage = Math.min(DEBATE_MAX_RAGE, session.recruiterRage + 12);
    } else if (targetCard.skill === 'calm') {
      session.recruiterRage = Math.max(0, session.recruiterRage - 10);
      if (session.recruiterRageMode > 0) {
        session.recruiterRageMode = 0;
        session.recruiterRageKind = null;
      }
    } else if (targetCard.skill === 'provoke') {
      if (session.recruiterRageMode > 0) {
        session.targetRage = DEBATE_MAX_RAGE;
      } else {
        session.targetRage = Math.min(DEBATE_MAX_RAGE, session.targetRage + 14);
      }
    }
  }
}

function buildNarration(
  recruiterCard: DebateCard,
  targetCard: DebateCard,
  winner: 'recruiter' | 'target' | 'draw',
  damage: number,
  recruiter: Officer,
  target: Officer,
): string {
  const rLabel = cardLabel(recruiterCard);
  const tLabel = cardLabel(targetCard);
  if (winner === 'draw') {
    return `${recruiter.name}以「${rLabel}」对阵${target.name}的「${tLabel}」，旗鼓相当，平分秋色`;
  }
  const winnerName = winner === 'recruiter' ? recruiter.name : target.name;
  return `${recruiter.name}以「${rLabel}」对阵${target.name}的「${tLabel}」，${winnerName}胜出，造成${damage}点损伤`;
}

/** 玩家再考：重抽一手牌（每回合一次） */
export function resolveDebateRethink(state: GameState): GameState {
  const next = structuredClone(state);
  const session = next.debateSession;
  if (!session || session.status !== 'ongoing') return next;
  const recruiter = next.officers[session.recruiterId];
  if (!recruiter || session.recruiterRethinkUsed || session.recruiterHand.length === 0) return next;
  session.recruiterRethinkUsed = true;
  session.recruiterHand = drawHand(next, recruiter);
  next.debateSession = session;
  return next;
}

/**
 * 舌战结束结算：
 * - 我方获胜 → 登用目标（在野目标加入势力）；
 * - 我方失利（或平局）→ 目标禁仕 3 个月，短期内无法再登用。
 */
function settleDebateOutcome(
  next: GameState,
  session: DebateSession,
  recruiter: Officer,
  target: Officer,
): void {
  const recruiterForceId = recruiter.forceId as ForceId | undefined;
  if (!recruiterForceId) return;

  if (session.winner === 'recruiter') {
    target.forceId = recruiterForceId;
    const cityId: CityId = target.location.kind === 'unaffiliated' ? target.location.cityId : (target.location as { cityId: CityId }).cityId;
    target.location = { kind: 'city', cityId };
    target.bannedUntilMonth = undefined;
    target.loyalty = recruitmentInitialLoyalty(target);
    // 技巧P入账（与探索/登庸一致，避免与 commands 形成循环依赖）
    const force = next.forces[recruiterForceId];
    if (force) force.techP = (force.techP ?? 0) + 150;
    next.logs.push({
      id: `debate-win-${next.month}-${next.rngCursor}`,
      month: next.month,
      forceId: recruiterForceId,
      message: `舌战告捷！${recruiter.name}说服${target.name}加入${next.forces[recruiterForceId]?.name ?? ''}`,
    });
  } else {
    const bannedMonths = 3;
    target.bannedUntilMonth = next.month + bannedMonths;
    next.logs.push({
      id: `debate-lose-${next.month}-${next.rngCursor}`,
      month: next.month,
      forceId: recruiterForceId,
      message: `舌战受挫，${target.name}拒绝了${recruiter.name}的招揽（约${bannedMonths}个月内不会再应允）`,
    });
  }
}

/** 关闭舌战视图（仅允许在会话结束后清空，进行中忽略） */
export function dismissDebate(state: GameState): GameState {
  const next = structuredClone(state);
  if (!next.debateSession) return next;
  if (next.debateSession.status !== 'finished') return next;
  next.debateSession = null;
  return next;
}