import { nextRandom } from './random';
import { recruitmentInitialLoyalty } from './loyalty';
import type { CityId, ForceId, GameState, Officer } from './types';

/**
 * 舌战系统（完整移植自水浒卡牌小程序 debate-engine.js）：
 * - 话题卡：故事/道理/时节 × 大/中/小；话术卡：无视/大喝一声/强词夺理/镇静/愤怒。
 * - 初始血量 67（按百分比显示），怒气 0~100，怒气满触发性格激愤。
 * - 手牌数按五维总和：≥335→6 张，≥301→5 张，≥275→4 张，否则 3 张。
 * - 判定：当前话题的话题卡 > 其他话题卡；同话题按大>中>小；
 *   话术对拼按优先级，无视/大喝一声/强词夺理压过话题卡，镇静/愤怒偏守势。
 * - 伤害 = 12 + (攻方五维和-守方五维和)/25，钳制 8~33；大喝×1.5、小话题×0.5、中话题×0.75；
 *   冷静激愤×2、刚胆激愤×1.3，上限 35。
 * - 怒气：败方 +10+伤害/2（大喝额外+10）；平局双方+8；无视生效败方+25；愤怒自身+25。
 * - 激愤（怒气满）：莽撞=弃最大话题牌造成2.5倍伤害；小心=掷出全部话题牌逐张结算；
 *   刚胆=3回合内话题牌必胜（对方无视/大喝除外）；冷静=3回合伤害翻倍+封锁对方
 *   无视/大喝/强词夺理+思考不限次。对方激愤时我方「愤怒」反弹（清对方怒气并反进激愤）、
 *   「镇静」强制化解。莽撞/小心爆发时按本回合所受伤害回血。
 * - 思考（再考）：整局 1 次，血量每跌破 75/50/25 阈值各返还 1 次（至多3次）。
 * - 强词夺理获胜后话题切换；回合胜者获得下回合先手；每回合结束补牌至手牌上限。
 * - 登庸触发：舌战获胜则登用成功，失利则目标禁仕 3 个月。
 */

export type DebateTopic = 'story' | 'reason' | 'past';
export type DebateTier = 'big' | 'mid' | 'sm';
export type DebateSkillId = 'ignore' | 'shout' | 'sophistry' | 'calm' | 'riseup';
export type DebateTrait = '冷静' | '刚胆' | '莽撞' | '小心';

export const TOPIC_TYPES: DebateTopic[] = ['story', 'reason', 'past'];
export const TYPE_NAMES: Record<DebateTopic, string> = { story: '故事', reason: '道理', past: '时节' };
export const TIER_NAMES: Record<DebateTier, string> = { big: '大', mid: '中', sm: '小' };
export const TIER_ORDER: Record<DebateTier, number> = { big: 3, mid: 2, sm: 1 };

export interface DebateSkillDef {
  id: DebateSkillId;
  name: string;
  desc: string;
  priority: number;
}

export const SKILLS: DebateSkillDef[] = [
  { id: 'ignore', name: '无视', desc: '使对方牌无效化', priority: 6 },
  { id: 'shout', name: '大喝一声', desc: '压过除无视外所有牌', priority: 5 },
  { id: 'sophistry', name: '强词夺理', desc: '获胜后切换话题', priority: 4 },
  { id: 'calm', name: '镇静', desc: '降低对方怒气', priority: 1 },
  { id: 'riseup', name: '愤怒', desc: '提升自身怒气', priority: 0 },
];

export interface DebateCard {
  uid: string;
  type: 'topic' | 'skill';
  /** 话题卡字段 */
  topic?: DebateTopic;
  tier?: DebateTier;
  /** 话术卡字段 */
  skill?: DebateSkillId;
  desc?: string;
  priority?: number;
  /** 组合 id：话题 'story-big' / 话术 'ignore' */
  id: string;
  /** 卡面名称：'故事 大' / '无视' */
  name: string;
  /** 新发标记（补牌后 5 秒内显示「新发」角标） */
  isNew?: boolean;
}

export interface DebatePlayerState {
  officerId: string;
  name: string;
  trait: DebateTrait;
  intel: number;
  /** 五维总和（决定手牌数与伤害基数） */
  power: number;
  hp: number;
  maxHp: number;
  anger: number;
  /** 激愤剩余回合数（>0 表示处于激愤状态） */
  furyRounds: number;
  /** 本回合刚进入激愤（不递减回合数） */
  furyJustActivated: boolean;
  cards: DebateCard[];
  rethinkUsed: boolean;
  rethinkResets: number;
}

export interface DebateFuryAction {
  actor: 'p1' | 'p2';
  trait?: DebateTrait;
  card: DebateCard | null;
  damage: number;
  reason?: string;
  text?: string;
  portrait?: string;
  hpAfter: { p1: number; p2: number };
  angerAfter: { p1: number; p2: number };
}

export interface DebateRoundRecord {
  roundNo: number;
  /** 本回合 AI 是否先手（其先手牌此前已展示预览） */
  aiWasFirst: boolean;
  p1Card: DebateCard;
  p2Card: DebateCard;
  /** AI 作为后手响应前是否思考过 */
  opponentRethought: boolean;
  winner: 'p1' | 'p2' | 'draw';
  reason: string;
  damageToP1: number;
  damageToP2: number;
  hpBefore: { p1: number; p2: number };
  angerBefore: { p1: number; p2: number };
  angerAfter: { p1: number; p2: number };
  furyActions: DebateFuryAction[];
  topicBefore: DebateTopic;
  topicAfter: DebateTopic;
  /** 下回合 AI 先手时已选定的牌（供预览）及其是否思考过 */
  aiFirst: { card: DebateCard; rethought: boolean } | null;
  gameOver: boolean;
}

export interface DebateLogEntry {
  round: number;
  playerCard: string;
  opponentCard: string;
  result: 'p1' | 'p2' | 'draw';
  reason: string;
}

export interface DebateSession {
  recruiterId: string;
  targetId: string;
  p1: DebatePlayerState;
  p2: DebatePlayerState;
  currentTopic: DebateTopic;
  round: number;
  firstPlayer: 1 | 2;
  /** AI 先手时已打出的牌（等待玩家响应） */
  firstCard: DebateCard | null;
  /** 上一回合完整演出记录（UI 据此播放动画） */
  lastRound: DebateRoundRecord | null;
  /** 最新在前，至多保留 20 条 */
  log: DebateLogEntry[];
  /** 卡牌 uid 序列 */
  uidSeq: number;
  status: 'ongoing' | 'finished';
  winner: 'recruiter' | 'target' | null;
}

export const DEBATE_STARTING_HP = 67;
const TRAIT_SET: DebateTrait[] = ['冷静', '刚胆', '莽撞', '小心'];

type Rng = () => number;

function makeRng(state: GameState): Rng {
  return () => {
    const roll = nextRandom(state.seed, state.rngCursor);
    state.rngCursor = roll.cursor;
    return roll.value;
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function pick<T>(list: T[], random: Rng): T {
  return list[Math.min(list.length - 1, Math.floor(random() * list.length))];
}

export type DebatePersonality = 'reckless' | 'bold' | 'calm' | 'timid';

/** 按五维推导性格：智最高=冷静、武最高=莽撞、统最高=刚胆、否则=小心 */
export function derivePersonality(stats: Pick<Officer['stats'], 'leadership' | 'war' | 'intelligence' | 'charisma' | 'politics'>): DebatePersonality {
  const max = Math.max(stats.intelligence, stats.war, stats.leadership, stats.charisma, stats.politics);
  if (max === stats.intelligence) return 'calm';
  if (max === stats.war) return 'reckless';
  if (max === stats.leadership) return 'bold';
  return 'timid';
}

/** 武将性格 → 舌战激愤形态（无显式性格时按最高五维推定） */
export function officerTrait(officer: Officer): DebateTrait {
  switch (officer.personality ?? derivePersonality(officer.stats)) {
    case 'reckless': return '莽撞';
    case 'bold': return '刚胆';
    case 'calm': return '冷静';
    case 'timid': return '小心';
  }
}

/** 手牌数：按五维总和 */
export function getHandSize(power: number): number {
  if (power >= 335) return 6;
  if (power >= 301) return 5;
  if (power >= 275) return 4;
  return 3;
}

function toPlayerState(officer: Officer): DebatePlayerState {
  const s = officer.stats;
  return {
    officerId: officer.id,
    name: officer.name,
    trait: officerTrait(officer),
    intel: s.intelligence,
    power: s.leadership + s.war + s.intelligence + s.politics + s.charisma,
    hp: DEBATE_STARTING_HP,
    maxHp: DEBATE_STARTING_HP,
    anger: 0,
    furyRounds: 0,
    furyJustActivated: false,
    cards: [],
    rethinkUsed: false,
    rethinkResets: 0,
  };
}

function nextCardUid(session: DebateSession): string {
  session.uidSeq += 1;
  return `debate_${session.uidSeq}`;
}

function createTopicCard(session: DebateSession, topic: DebateTopic, tier: DebateTier): DebateCard {
  return {
    uid: nextCardUid(session),
    type: 'topic',
    topic,
    tier,
    id: `${topic}-${tier}`,
    name: `${TYPE_NAMES[topic]} ${TIER_NAMES[tier]}`,
  };
}

function cloneSkill(session: DebateSession, skill: DebateSkillDef): DebateCard {
  return {
    uid: nextCardUid(session),
    type: 'skill',
    skill: skill.id,
    id: skill.id,
    name: skill.name,
    desc: skill.desc,
    priority: skill.priority,
  };
}

/** 手牌排序：话题牌在前（按话题名分组、大→中→小），话术牌在后保持原序 */
function orderHandCards(cards: DebateCard[]): DebateCard[] {
  return cards.slice().sort((a, b) => {
    if (a.type !== b.type) return a.type === 'topic' ? -1 : 1;
    if (a.type === 'skill') return 0;
    if (a.topic !== b.topic) return (a.topic ?? '') < (b.topic ?? '') ? -1 : 1;
    return (TIER_ORDER[b.tier ?? 'sm'] || 0) - (TIER_ORDER[a.tier ?? 'sm'] || 0);
  });
}

function markNewCard(card: DebateCard): DebateCard {
  card.isNew = true;
  return card;
}

function generateSingleCard(session: DebateSession, intel: number, random: Rng): DebateCard {
  if (random() < 0.18) return cloneSkill(session, pick(SKILLS, random));
  return createTopicCard(session, pick(TOPIC_TYPES, random), pick<DebateTier>(['big', 'mid', 'sm'], random));
}

/** 发一手牌：每话题各一张打底，再按智力概率补话术（至多2张不重复）或话题牌；智力≥90保底1话术 */
function generateHand(session: DebateSession, player: DebatePlayerState, random: Rng): DebateCard[] {
  const intel = player.intel;
  const count = getHandSize(player.power);
  const hand: DebateCard[] = TOPIC_TYPES.map((topic) => createTopicCard(session, topic, pick<DebateTier>(['big', 'mid', 'sm'], random)));
  const skillProb = intel >= 80 ? 0.3 : 0.22;

  const usedSkillIds = () => hand.filter((card) => card.type === 'skill').map((card) => card.id);

  while (hand.length < count) {
    const availableSkills = SKILLS.filter((skill) => !usedSkillIds().includes(skill.id));
    if (random() < skillProb && usedSkillIds().length < 2 && availableSkills.length) {
      hand.push(cloneSkill(session, pick(availableSkills, random)));
    } else {
      hand.push(createTopicCard(session, pick(TOPIC_TYPES, random), pick<DebateTier>(['big', 'mid', 'sm'], random)));
    }
  }

  if (intel >= 90 && !hand.some((card) => card.type === 'skill')) {
    hand[hand.length - 1] = cloneSkill(session, pick(SKILLS, random));
  }

  return orderHandCards(hand);
}

/** 补牌至手牌上限：话术不与手牌重复，新牌标记 isNew */
function refillHand(session: DebateSession, player: DebatePlayerState, random: Rng): void {
  const size = getHandSize(player.power);
  // 旧牌的新发标记先清除（仅保留本轮新补的）
  player.cards.forEach((card) => { card.isNew = false; });
  while (player.cards.length < size) {
    let card: DebateCard | null = null;
    let attempts = 0;
    while (attempts < 12) {
      attempts += 1;
      const candidate = generateSingleCard(session, player.intel, random);
      if (candidate.type === 'skill' && player.cards.some((item) => item.type === 'skill' && item.id === candidate.id)) continue;
      card = candidate;
      break;
    }
    player.cards.push(markNewCard(card ?? createTopicCard(session, pick(TOPIC_TYPES, random), pick<DebateTier>(['big', 'mid', 'sm'], random))));
  }
  player.cards = orderHandCards(player.cards);
}

interface RoundJudgement {
  winner: 'a' | 'b' | 'draw';
  reason: string;
  winnerCard: DebateCard | null;
  loserCard?: DebateCard | null;
}

/** 一轮比卡判定（a=p1 玩家，b=p2 对手） */
export function judgeRound(cardA: DebateCard, cardB: DebateCard, topic: DebateTopic): RoundJudgement {
  const aSkill = cardA.type === 'skill';
  const bSkill = cardB.type === 'skill';

  if (aSkill && bSkill) {
    const pa = cardA.priority ?? 0;
    const pb = cardB.priority ?? 0;
    if (pa > pb) return { winner: 'a', reason: `${cardA.name}压过${cardB.name}`, winnerCard: cardA };
    if (pb > pa) return { winner: 'b', reason: `${cardB.name}压过${cardA.name}`, winnerCard: cardB };
    return { winner: 'draw', reason: '势均力敌', winnerCard: null };
  }

  if (aSkill) {
    if (cardA.skill === 'ignore' || cardA.skill === 'shout' || cardA.skill === 'sophistry') {
      return { winner: 'a', reason: `${cardA.name}生效`, winnerCard: cardA };
    }
    return { winner: 'b', reason: `${cardA.name}偏守势`, winnerCard: cardB, loserCard: cardA };
  }

  if (bSkill) {
    if (cardB.skill === 'ignore' || cardB.skill === 'shout' || cardB.skill === 'sophistry') {
      return { winner: 'b', reason: `${cardB.name}生效`, winnerCard: cardB };
    }
    return { winner: 'a', reason: `${cardB.name}偏守势`, winnerCard: cardA, loserCard: cardB };
  }

  const aMatch = cardA.topic === topic;
  const bMatch = cardB.topic === topic;
  if (aMatch && !bMatch) return { winner: 'a', reason: `${TYPE_NAMES[topic]}切中话题`, winnerCard: cardA };
  if (!aMatch && bMatch) return { winner: 'b', reason: `${TYPE_NAMES[topic]}切中话题`, winnerCard: cardB };

  const ta = TIER_ORDER[cardA.tier ?? 'sm'] ?? 0;
  const tb = TIER_ORDER[cardB.tier ?? 'sm'] ?? 0;
  if (ta > tb) return { winner: 'a', reason: `${cardA.name}更强`, winnerCard: cardA };
  if (tb > ta) return { winner: 'b', reason: `${cardB.name}更强`, winnerCard: cardB };
  return { winner: 'draw', reason: '旗鼓相当', winnerCard: null };
}

/** 伤害计算：五维差基数 + 大喝/话题大小/激愤性格修正 */
export function calcDamage(attacker: DebatePlayerState, defender: DebatePlayerState, result: RoundJudgement): number {
  if (result.winner === 'draw') return 0;
  let base = 12 + Math.floor((attacker.power - defender.power) / 25);
  base = clamp(base, 8, 33);
  if (result.winnerCard?.id === 'shout') base = Math.floor(base * 1.5);
  if (result.winnerCard?.type === 'topic') {
    if (result.winnerCard.tier === 'sm') base = Math.floor(base * 0.5);
    if (result.winnerCard.tier === 'mid') base = Math.floor(base * 0.75);
  }
  if (attacker.furyRounds > 0) {
    if (attacker.trait === '冷静') base *= 2;
    if (attacker.trait === '刚胆') base *= 1.3;
  }
  return Math.round(Math.min(base, 35));
}

function calcFuryTopicDamage(attacker: DebatePlayerState, defender: DebatePlayerState, card: DebateCard, multiplier: number): number {
  const damage = calcDamage(attacker, defender, { winner: 'a', reason: '', winnerCard: card });
  return Math.round(damage * multiplier);
}

/** 对手冷静激愤中，无视/大喝一声/强词夺理不可用 */
function canUseSkillAgainst(card: DebateCard | null, opponent: DebatePlayerState): boolean {
  if (!card || card.type !== 'skill') return true;
  if (!opponent || opponent.furyRounds <= 0 || opponent.trait !== '冷静') return true;
  return card.skill !== 'ignore' && card.skill !== 'shout' && card.skill !== 'sophistry';
}

function chooseLargestTopicCard(player: DebatePlayerState, currentTopic: DebateTopic): DebateCard | null {
  const topics = player.cards.filter((card) => card.type === 'topic');
  if (!topics.length) return null;
  return topics
    .map((card) => ({
      card,
      score: (TIER_ORDER[card.tier ?? 'sm'] || 0) * 10 + (card.topic === currentTopic ? 1 : 0),
    }))
    .sort((a, b) => b.score - a.score)[0].card;
}

function removeSpecificCard(cards: DebateCard[], card: DebateCard): void {
  const index = cards.findIndex((item) => item.uid === card.uid);
  if (index !== -1) cards.splice(index, 1);
}

function snapshotHp(session: DebateSession): { p1: number; p2: number } {
  return { p1: session.p1.hp, p2: session.p2.hp };
}

function snapshotAnger(session: DebateSession): { p1: number; p2: number } {
  return { p1: session.p1.anger, p2: session.p2.anger };
}

/** 性格爆发（莽撞/小心）：一次性结算并重置怒气 */
function applyFuryBurst(session: DebateSession, side: 'p1' | 'p2', actions: DebateFuryAction[], random: Rng): void {
  const actor = side === 'p1' ? session.p1 : session.p2;
  const target = side === 'p1' ? session.p2 : session.p1;

  if (actor.trait === '莽撞') {
    const card = chooseLargestTopicCard(actor, session.currentTopic);
    actor.anger = 0;
    actor.furyRounds = 0;
    actor.furyJustActivated = false;
    if (card) {
      removeSpecificCard(actor.cards, card);
      const damage = calcFuryTopicDamage(actor, target, card, 2.5);
      target.hp = Math.max(0, target.hp - damage);
      actions.push({ actor: side, trait: '莽撞', card, damage, reason: '莽撞爆发，直接造成伤害', hpAfter: snapshotHp(session), angerAfter: snapshotAnger(session) });
    } else {
      actions.push({ actor: side, trait: '莽撞', card: null, damage: 0, reason: '手中没有话题牌', hpAfter: snapshotHp(session), angerAfter: snapshotAnger(session) });
    }
    refillHand(session, actor, random);
  } else if (actor.trait === '小心') {
    const topicCards = actor.cards.filter((card) => card.type === 'topic');
    actor.anger = 0;
    actor.furyRounds = 0;
    actor.furyJustActivated = false;
    topicCards.forEach((card) => {
      removeSpecificCard(actor.cards, card);
      const damage = calcFuryTopicDamage(actor, target, card, 1);
      target.hp = Math.max(0, target.hp - damage);
      actions.push({ actor: side, trait: '小心', card, damage, reason: '小心爆发，连续话题牌造成伤害', hpAfter: snapshotHp(session), angerAfter: snapshotAnger(session) });
    });
    if (!topicCards.length) {
      actions.push({ actor: side, trait: '小心', card: null, damage: 0, reason: '手中没有话题牌', hpAfter: snapshotHp(session), angerAfter: snapshotAnger(session) });
    }
    refillHand(session, actor, random);
  }
}

interface PendingFury {
  side: 'p1' | 'p2';
  roundDamage: number;
}

interface RoundResultInternal extends RoundJudgement {
  p1Card: DebateCard;
  p2Card: DebateCard;
  pendingFury?: PendingFury[];
  pendingTopicChange?: { from: DebateTopic; to: DebateTopic };
  furyActions?: DebateFuryAction[];
}

function queueFury(session: DebateSession, side: 'p1' | 'p2', result: RoundResultInternal, roundDamage: number): boolean {
  const player = side === 'p1' ? session.p1 : session.p2;
  if (player.anger < 100 || player.furyRounds !== 0) return false;
  player.anger = 100;
  if (!result.pendingFury) result.pendingFury = [];
  result.pendingFury.push({ side, roundDamage: Number(roundDamage || 0) || 0 });
  return true;
}

function applyForcedFury(session: DebateSession, side: 'p1' | 'p2', actions: DebateFuryAction[], random: Rng): void {
  const player = side === 'p1' ? session.p1 : session.p2;
  player.anger = 100;
  if (player.trait === '莽撞' || player.trait === '小心') {
    applyFuryBurst(session, side, actions, random);
  } else if (player.trait === '刚胆' || player.trait === '冷静') {
    player.furyRounds = 3;
    player.furyJustActivated = true;
  }
}

/** 对手（p2）进入激愤时，我方（p1）手中的「愤怒」/「镇静」自动反制 */
function applyCounterOpponentFury(session: DebateSession, actions: DebateFuryAction[], triggeredSides: Set<'p1' | 'p2'>, random: Rng): boolean {
  const me = session.p1;
  const opponent = session.p2;
  const angerCard = me.cards.find((card) => card.type === 'skill' && card.skill === 'riseup');

  // 优先「愤怒」：反弹对方愤怒，并令我方反进愤怒态
  if (angerCard) {
    removeSpecificCard(me.cards, angerCard);
    opponent.anger = 0;
    opponent.furyRounds = 0;
    opponent.furyJustActivated = false;
    const meAlreadyFurious = triggeredSides.has('p1');
    actions.push({
      actor: 'p1',
      card: angerCard,
      damage: 0,
      text: meAlreadyFurious ? '愤怒反弹 · 对方怒气清空' : '愤怒反弹 · 对方怒气清空，我方被激怒',
      portrait: '愤怒反弹',
      hpAfter: snapshotHp(session),
      angerAfter: snapshotAnger(session),
    });
    if (!meAlreadyFurious) {
      applyForcedFury(session, 'p1', actions, random);
      triggeredSides.add('p1');
    }
    return true;
  }

  // 其次「镇静」：强制对方退出愤怒态
  const calmCard = me.cards.find((card) => card.type === 'skill' && card.skill === 'calm');
  if (calmCard) {
    removeSpecificCard(me.cards, calmCard);
    opponent.anger = 0;
    opponent.furyRounds = 0;
    opponent.furyJustActivated = false;
    actions.push({
      actor: 'p1',
      card: calmCard,
      damage: 0,
      text: '镇静安抚 · 对方强制退出愤怒',
      portrait: '镇静安抚',
      hpAfter: snapshotHp(session),
      angerAfter: snapshotAnger(session),
    });
    return true;
  }

  return false;
}

/** 结算回合后挂起的激愤（含我方反制、莽撞/小心爆发回血） */
function applyPendingFury(session: DebateSession, result: RoundResultInternal, random: Rng): DebateFuryAction[] {
  const pending = result.pendingFury ? result.pendingFury.slice() : [];
  if (!pending.length) return [];
  result.pendingFury = [];

  const actions = result.furyActions ?? [];
  result.furyActions = actions;
  const triggeredSides = new Set<'p1' | 'p2'>();

  pending.forEach((item) => {
    const side = item.side;
    const player = side === 'p1' ? session.p1 : session.p2;
    if (!player || player.anger < 100 || player.furyRounds !== 0) return;
    player.anger = 100;

    // 对方进入愤怒状态时，我方「愤怒」或「镇静」手牌自动反制
    if (side === 'p2' && applyCounterOpponentFury(session, actions, triggeredSides, random)) {
      return;
    }

    triggeredSides.add(side);

    const roundDamage = Number(item.roundDamage || 0) || 0;
    if (player.trait === '莽撞' || player.trait === '小心') {
      applyFuryBurst(session, side, actions, random);
      if (roundDamage > 0) {
        player.hp = Math.min(player.maxHp, player.hp + roundDamage);
      }
    } else if (player.trait === '刚胆' || player.trait === '冷静') {
      player.furyRounds = 3;
      player.furyJustActivated = true;
    }
  });

  return actions;
}

/** 激愤回合递减（激活当回合不递减；归零时怒气清空） */
function tickFury(player: DebatePlayerState): void {
  if (player.furyRounds <= 0) return;
  if (player.furyJustActivated) {
    player.furyJustActivated = false;
    return;
  }
  player.furyRounds = Math.max(0, player.furyRounds - 1);
  if (player.furyRounds === 0) player.anger = 0;
}

/** 血量跌破 75/50/25 阈值时各返还一次思考机会（至多3次） */
function resetRethinkIfHpCrossed(player: DebatePlayerState, beforeHp: number): void {
  const thresholds = [75, 50, 25];
  for (let i = 0; i < thresholds.length; i += 1) {
    if (player.rethinkResets >= 3) break;
    const threshold = thresholds[i];
    if (beforeHp > threshold && player.hp <= threshold) {
      player.rethinkUsed = false;
      player.rethinkResets += 1;
    }
  }
}

// ---------- AI 决策 ----------

interface AiStateSnapshot {
  hpRatio: number;
  oppHpRatio: number;
  hpDiff: number;
  myAnger: number;
  oppAnger: number;
  oppNearFury: boolean;
  oppFury: boolean;
  myFury: boolean;
  oppFuryRounds: number;
  myFuryRounds: number;
  leading: boolean;
  critical: boolean;
  oppCritical: boolean;
}

function aiEvaluateState(session: DebateSession): AiStateSnapshot {
  const me = session.p2;
  const opp = session.p1;
  return {
    hpRatio: me.hp / (me.maxHp || 100),
    oppHpRatio: opp.hp / (opp.maxHp || 100),
    hpDiff: me.hp - opp.hp,
    myAnger: me.anger,
    oppAnger: opp.anger,
    oppNearFury: opp.anger >= 80,
    oppFury: opp.furyRounds > 0,
    myFury: me.furyRounds > 0,
    oppFuryRounds: opp.furyRounds,
    myFuryRounds: me.furyRounds,
    leading: me.hp > opp.hp,
    critical: me.hp < 35,
    oppCritical: opp.hp < 35,
  };
}

function aiScoreTopicFirst(card: DebateCard, st: AiStateSnapshot, topic: DebateTopic): number {
  let score = 0;
  const tierVal = TIER_ORDER[card.tier ?? 'sm'] || 1;
  if (card.topic === topic) {
    score += 55 + tierVal * 12;
  } else {
    score += 15 + tierVal * 6;
  }
  if (st.oppCritical) score += tierVal * 8;
  if (st.oppFury) score += tierVal * 4 - 10;
  if (st.myFury) score += tierVal * 6;
  if (st.hpDiff > 30) score -= tierVal * 3;
  if (st.hpDiff < -20) score += tierVal * 5;
  return score;
}

function aiScoreSkillFirst(card: DebateCard, st: AiStateSnapshot, session: DebateSession): number {
  let score = 0;
  const opp = session.p1;
  switch (card.skill) {
    case 'ignore':
      score = st.oppFury ? 75 : 55;
      if (st.critical) score += 20;
      if (st.oppFury && opp.trait === '刚胆') score += 30;
      break;
    case 'shout':
      score = 50;
      if (st.oppAnger > 50) score += 20;
      if (st.oppCritical) score += 25;
      if (st.myFury) score += 20;
      if (st.oppFury && opp.trait === '刚胆') score += 25;
      break;
    case 'sophistry':
      score = 45;
      if (st.myFury) score += 10;
      break;
    case 'calm':
      score = st.oppFury ? 95 : (st.oppNearFury ? 70 : (st.oppAnger > 60 ? 50 : 25));
      if (st.myAnger > 60) score -= 15;
      break;
    case 'riseup':
      score = 20;
      if (st.myAnger < 50 && !st.myFury) score += 30;
      if (st.oppFury) score += 15;
      if (st.critical) score -= 20;
      break;
  }
  return score;
}

function aiScoreSkillSecond(card: DebateCard, oppCard: DebateCard, st: AiStateSnapshot, result: RoundJudgement, session: DebateSession): number {
  let bonus = 0;
  const opp = session.p1;
  switch (card.skill) {
    case 'ignore':
      if (oppCard.id === 'shout' || oppCard.id === 'sophistry') bonus += 40;
      if (oppCard.type === 'topic' && oppCard.tier === 'big') bonus += 25;
      if (st.critical) bonus += 30;
      if (st.oppFury && opp.trait === '刚胆') bonus += 35;
      break;
    case 'shout':
      if (oppCard.type === 'topic' && oppCard.tier === 'sm') bonus += 20;
      if (st.oppAnger > 60) bonus += 15;
      if (st.oppFury && opp.trait === '刚胆') bonus += 25;
      break;
    case 'sophistry':
      if (oppCard.type === 'topic' && oppCard.topic === session.currentTopic && oppCard.tier === 'big') bonus += 25;
      break;
    case 'calm':
      if (st.oppFury) bonus += 70;
      else if (st.oppAnger >= 85) bonus += 50;
      else if (st.oppNearFury) bonus += 30;
      if (result.winner === 'b' && !st.oppNearFury && !st.oppFury) bonus -= 20;
      break;
    case 'riseup':
      if (st.myAnger < 50 && !st.myFury) {
        if (oppCard.type === 'topic' && oppCard.tier === 'big') bonus += 30;
        if (oppCard.id === 'shout') bonus += 15;
      }
      if (st.critical) bonus -= 30;
      break;
  }
  return bonus;
}

function aiScoreTopicSecond(card: DebateCard, oppCard: DebateCard, st: AiStateSnapshot, topic: DebateTopic, result: RoundJudgement): number {
  let bonus = 0;
  const tierVal = TIER_ORDER[card.tier ?? 'sm'] || 1;
  if (result.winner === 'b' && card.topic === topic) bonus += tierVal * 4;
  if (result.winner === 'a') bonus += (4 - tierVal) * 3;
  if (st.oppCritical && result.winner === 'b') bonus += tierVal * 6;
  return bonus;
}

function aiSelectAsFirst(session: DebateSession, cards: DebateCard[], st: AiStateSnapshot, topic: DebateTopic, random: Rng): DebateCard {
  const scored = cards.map((c) => ({
    card: c,
    score: c.type === 'skill' ? aiScoreSkillFirst(c, st, session) : aiScoreTopicFirst(c, st, topic),
  })).sort((a, b) => b.score - a.score);
  const top = scored[0];
  const second = scored.length > 1 ? scored[1] : null;
  const gap = second ? (top.score - second.score) / Math.max(1, Math.abs(top.score)) : 1;
  if (gap < 0.15 && random() < 0.5) {
    const poolSize = Math.max(2, Math.ceil(scored.length / 3));
    return scored[Math.floor(random() * poolSize)].card;
  }
  return top.card;
}

function aiSelectAsSecond(session: DebateSession, oppCard: DebateCard, cards: DebateCard[], st: AiStateSnapshot, topic: DebateTopic, random: Rng): DebateCard {
  const scored = cards.map((c) => {
    const result = judgeRound(oppCard, c, topic);
    let score = 0;
    if (result.winner === 'b') {
      score += 80;
      if (result.winnerCard && result.winnerCard.type === 'topic') {
        score += (TIER_ORDER[result.winnerCard.tier ?? 'sm'] || 1) * 6;
      }
      if (st.oppCritical) score += 25;
    } else if (result.winner === 'draw') {
      score += 35;
    } else {
      score -= 5;
    }
    if (c.type === 'skill') score += aiScoreSkillSecond(c, oppCard, st, result, session);
    else score += aiScoreTopicSecond(c, oppCard, st, topic, result);
    return { card: c, score };
  }).sort((a, b) => b.score - a.score);
  const top = scored[0];
  const second = scored.length > 1 ? scored[1] : null;
  const gap = second ? (top.score - second.score) / Math.max(1, Math.abs(top.score)) : 1;
  if (gap < 0.1 && random() < 0.4) {
    const poolSize = Math.max(2, Math.ceil(scored.length / 3));
    return scored[Math.floor(random() * poolSize)].card;
  }
  return top.card;
}

function selectAiCard(session: DebateSession, opponentCard: DebateCard | null, random: Rng): DebateCard | null {
  let cards = session.p2.cards;
  if (!cards.length) return null;
  // 冷静封锁：对手冷静激愤中，无视/大喝一声/强词夺理不可用
  if (session.p1.furyRounds > 0 && session.p1.trait === '冷静') {
    cards = cards.filter((c) => !(c.type === 'skill' && (c.skill === 'ignore' || c.skill === 'shout' || c.skill === 'sophistry')));
    if (!cards.length) cards = session.p2.cards;
  }
  const st = aiEvaluateState(session);
  if (opponentCard) return aiSelectAsSecond(session, opponentCard, cards, st, session.currentTopic, random);
  return aiSelectAsFirst(session, cards, st, session.currentTopic, random);
}

function opponentCanRethink(session: DebateSession): boolean {
  const unlimited = session.p2.furyRounds > 0 && session.p2.trait === '冷静';
  return !session.p2.rethinkUsed || unlimited;
}

function useOpponentRethink(session: DebateSession, random: Rng): void {
  const unlimited = session.p2.furyRounds > 0 && session.p2.trait === '冷静';
  if (session.p2.rethinkUsed && !unlimited) return;
  if (!unlimited) session.p2.rethinkUsed = true;
  session.p2.cards = generateHand(session, session.p2, random).map(markNewCard);
}

function aiShouldRethink(session: DebateSession, random: Rng): boolean {
  if (session.p2.rethinkUsed) return false;
  const cards = session.p2.cards;
  const topic = session.currentTopic;
  const st = aiEvaluateState(session);
  const topicCards = cards.filter((c) => c.type === 'topic' && c.topic === topic);
  const bigCards = cards.filter((c) => c.type === 'topic' && c.tier === 'big');
  const skillCards = cards.filter((c) => c.type === 'skill');

  if (session.p1.furyRounds > 0 && session.p1.trait === '冷静') {
    const blocked = cards.filter((c) => c.type === 'skill' && (c.skill === 'ignore' || c.skill === 'shout' || c.skill === 'sophistry'));
    if (blocked.length >= 2) return random() < 0.7;
  }
  if (session.p1.furyRounds > 0 && session.p1.trait === '刚胆') {
    const hasBreaker = skillCards.some((c) => c.skill === 'ignore' || c.skill === 'shout');
    if (!hasBreaker && cards.length > 2) return random() < 0.6;
  }
  if (cards.every((c) => c.type === 'skill')) return true;
  if (topicCards.length === 0 && cards.some((c) => c.type === 'topic')) {
    if ((skillCards.some((c) => c.skill === 'ignore') || skillCards.some((c) => c.skill === 'shout')) && st.hpRatio > 0.5) {
      return random() < 0.5;
    }
    return true;
  }
  if (bigCards.length === 0 && topicCards.length === 0) return random() < 0.7;

  const priorities: Record<string, number> = { ignore: 6, shout: 5, sophistry: 4, calm: 2, riseup: 1 };
  let handQuality = 0;
  for (let i = 0; i < cards.length; i += 1) {
    const c = cards[i];
    if (c.type === 'skill') handQuality += (priorities[c.skill ?? ''] || 0) * 3;
    else if (c.topic === topic) handQuality += (TIER_ORDER[c.tier ?? 'sm'] || 0) * 5;
    else handQuality += (TIER_ORDER[c.tier ?? 'sm'] || 0) * 1;
  }
  if (handQuality < 12) return random() < 0.6;
  if (st.critical && handQuality < 18) return random() < 0.5;
  return false;
}

// ---------- 回合主流程 ----------

function queueTopicSwitch(session: DebateSession, result: RoundResultInternal, random: Rng): void {
  const from = session.currentTopic;
  const rest = TOPIC_TYPES.filter((topic) => topic !== from);
  const change = { from, to: pick(rest, random) };
  result.pendingTopicChange = change;
}

function applyRoundResult(session: DebateSession, p1Card: DebateCard, p2Card: DebateCard, random: Rng): RoundResultInternal {
  const result: RoundResultInternal = {
    ...judgeRound(p1Card, p2Card, session.currentTopic),
    p1Card,
    p2Card,
  };

  const hasIgnore = p1Card.id === 'ignore' || p2Card.id === 'ignore';
  const p1HpBefore = session.p1.hp;
  const p2HpBefore = session.p2.hp;
  let p1RoundDamage = 0;
  let p2RoundDamage = 0;
  const p1CalmsP2 = p1Card.id === 'calm';
  const p2CalmsP1 = p2Card.id === 'calm';
  const p1Bold = session.p1.furyRounds > 0 && session.p1.trait === '刚胆' && p1Card.type === 'topic';
  const p2Bold = session.p2.furyRounds > 0 && session.p2.trait === '刚胆' && p2Card.type === 'topic';
  let p1BoldPressed = false;
  let p2BoldPressed = false;

  if (p1Bold && !p2Bold && p2Card.id !== 'ignore' && p2Card.id !== 'shout') {
    p1BoldPressed = true;
    if (result.winner !== 'a') {
      result.winner = 'a';
      result.reason = `${session.p1.name}刚胆硬压，强行胜出`;
      result.winnerCard = p1Card;
    }
  } else if (p2Bold && !p1Bold && p1Card.id !== 'ignore' && p1Card.id !== 'shout') {
    p2BoldPressed = true;
    if (result.winner !== 'b') {
      result.winner = 'b';
      result.reason = `${session.p2.name}刚胆硬压，强行胜出`;
      result.winnerCard = p2Card;
    }
  }

  if (result.winner === 'draw') {
    // 平局（含双方都出无视、同优先级话术、同级话题）：双方同时涨怒气
    session.p1.anger = clamp(session.p1.anger + 8, 0, 100);
    session.p2.anger = clamp(session.p2.anger + 8, 0, 100);
  } else if (hasIgnore) {
    // 一方出无视并胜出：败方（被无视方）额外涨怒气
    if (result.winner === 'a' && p1Card.id === 'ignore') session.p2.anger = clamp(session.p2.anger + 25, 0, 100);
    if (result.winner === 'b' && p2Card.id === 'ignore') session.p1.anger = clamp(session.p1.anger + 25, 0, 100);
  } else if (result.winner === 'a') {
    const damage = calcDamage(session.p1, session.p2, result);
    p2RoundDamage = damage;
    session.p2.hp = Math.max(0, session.p2.hp - damage);
    let anger = 10 + Math.floor(damage / 2);
    if (p1Card.id === 'shout') anger += 10;
    session.p2.anger = clamp(session.p2.anger + anger, 0, 100);
  } else if (result.winner === 'b') {
    const damage = calcDamage(session.p2, session.p1, result);
    p1RoundDamage = damage;
    session.p1.hp = Math.max(0, session.p1.hp - damage);
    let anger = 10 + Math.floor(damage / 2);
    if (p2Card.id === 'shout') anger += 10;
    session.p1.anger = clamp(session.p1.anger + anger, 0, 100);
  }

  if (p1Card.id === 'riseup' && !hasIgnore) session.p1.anger = clamp(session.p1.anger + 25, 0, 100);
  if (p2Card.id === 'riseup' && !hasIgnore) session.p2.anger = clamp(session.p2.anger + 25, 0, 100);
  if (p1CalmsP2 && !hasIgnore && !p2BoldPressed) {
    if (session.p2.furyRounds !== 0 || session.p2.anger >= 100) {
      session.p2.furyRounds = 0;
      session.p2.anger = 0;
      session.p2.furyJustActivated = false;
      result.reason += '；对手被安抚情绪压制，愤激解除，怒气归零';
    } else {
      session.p2.anger = clamp(session.p2.anger - 25, 0, 100);
    }
  }
  if (p2CalmsP1 && !hasIgnore && !p1BoldPressed) {
    if (session.p1.furyRounds !== 0 || session.p1.anger >= 100) {
      session.p1.furyRounds = 0;
      session.p1.anger = 0;
      session.p1.furyJustActivated = false;
      result.reason += '；我方被安抚情绪压制，愤激解除，怒气归零';
    } else {
      session.p1.anger = clamp(session.p1.anger - 25, 0, 100);
    }
  }
  if (result.winner === 'a' && p1Card.id === 'sophistry' && !p1Bold) queueTopicSwitch(session, result, random);
  if (result.winner === 'b' && p2Card.id === 'sophistry' && !p2Bold) queueTopicSwitch(session, result, random);

  queueFury(session, 'p1', result, p1RoundDamage);
  queueFury(session, 'p2', result, p2RoundDamage);
  resetRethinkIfHpCrossed(session.p1, p1HpBefore);
  resetRethinkIfHpCrossed(session.p2, p2HpBefore);

  if (!hasIgnore) {
    if (result.winner === 'a') session.firstPlayer = 1;
    if (result.winner === 'b') session.firstPlayer = 2;
  }

  session.log.unshift({
    round: session.round,
    playerCard: p1Card.name,
    opponentCard: p2Card.name,
    result: result.winner === 'a' ? 'p1' : result.winner === 'b' ? 'p2' : 'draw',
    reason: result.reason,
  });
  session.log = session.log.slice(0, 20);

  if (!isGameOver(session)) {
    tickFury(session.p1);
    tickFury(session.p2);
    session.round += 1;
    session.firstCard = null;
  }

  return result;
}

function isGameOver(session: DebateSession): boolean {
  return session.p1.hp <= 0 || session.p2.hp <= 0;
}

function removeCardByUid(cards: DebateCard[], uid: string): DebateCard | null {
  const index = cards.findIndex((card) => card.uid === uid);
  if (index === -1) return null;
  return cards.splice(index, 1)[0];
}

/** AI 先手出牌（选定后从手牌移除并挂到 firstCard 等待玩家响应） */
function startAiFirstTurn(session: DebateSession, random: Rng): DebateCard | null {
  if (session.firstPlayer !== 2 || session.firstCard) return session.firstCard;
  const aiCard = selectAiCard(session, null, random);
  if (!aiCard) return null;
  removeSpecificCard(session.p2.cards, aiCard);
  session.firstCard = aiCard;
  return aiCard;
}

function refillHandsAfterRound(session: DebateSession, random: Rng): void {
  if (isGameOver(session)) return;
  refillHand(session, session.p1, random);
  refillHand(session, session.p2, random);
}

function applyPendingTopicChange(session: DebateSession, result: RoundResultInternal): boolean {
  if (!result.pendingTopicChange) return false;
  session.currentTopic = result.pendingTopicChange.to;
  result.pendingTopicChange = undefined;
  return true;
}

/**
 * 创建舌战会话（登庸在野武将时调用）。玩家（招募者）为 p1，AI（目标）为 p2。
 */
export function createDebate(
  state: GameState,
  recruiter: Officer,
  target: Officer,
): DebateSession {
  const session: DebateSession = {
    recruiterId: recruiter.id,
    targetId: target.id,
    p1: toPlayerState(recruiter),
    p2: toPlayerState(target),
    currentTopic: 'story',
    round: 1,
    firstPlayer: 1,
    firstCard: null,
    lastRound: null,
    log: [],
    uidSeq: 0,
    status: 'ongoing',
    winner: null,
  };
  const random = makeRng(state);
  session.currentTopic = pick(TOPIC_TYPES, random);
  session.p1.cards = generateHand(session, session.p1, random);
  session.p2.cards = generateHand(session, session.p2, random);
  return session;
}

/** 玩家思考：重抽一手牌（整局1次，冷静激愤中不限次；血量跌破阈值返还） */
export function resolveDebateRethink(state: GameState): GameState {
  const next = structuredClone(state);
  const session = next.debateSession;
  if (!session || session.status !== 'ongoing' || !session.p1) return next;
  const unlimited = session.p1.furyRounds > 0 && session.p1.trait === '冷静';
  if (session.p1.rethinkUsed && !unlimited) return next;
  if (!unlimited) session.p1.rethinkUsed = true;
  const random = makeRng(next);
  session.p1.cards = generateHand(session, session.p1, random).map(markNewCard);
  next.debateSession = session;
  return next;
}

/** 中途退出舌战：判负结算（目标禁仕） */
export function resolveDebateAbandon(state: GameState): GameState {
  const next = structuredClone(state);
  const session = next.debateSession;
  if (!session || session.status !== 'ongoing' || !session.p1) return next;
  session.p1.hp = 0;
  session.status = 'finished';
  session.winner = 'target';
  settleDebateOutcome(next, session);
  next.debateSession = session;
  return next;
}

/**
 * 出一张牌并完整结算该回合（判定→伤害怒气→激愤→补牌→换话题→AI先手牌）。
 * 演出所需全部信息写入 session.lastRound，由 UI 按步骤播放动画。
 */
export function resolveDebateRound(state: GameState, cardUid: string): GameState {
  const next = structuredClone(state);
  const session = next.debateSession;
  if (!session || session.status !== 'ongoing' || !session.p1) return next;

  const aiWasFirst = !!session.firstCard;
  const roundNo = session.round;
  const topicBefore = session.currentTopic;
  const hpBefore = snapshotHp(session);
  const angerBefore = snapshotAnger(session);

  const candidate = session.p1.cards.find((card) => card.uid === cardUid);
  if (!candidate) return next;
  if (!canUseSkillAgainst(candidate, session.p2)) return next;

  const random = makeRng(next);

  let p2Card: DebateCard | null = null;
  let opponentRethought = false;

  if (!aiWasFirst) {
    // 玩家先手：AI 可能先思考再以后手身份响应（能看到玩家出的牌）
    if (opponentCanRethink(session) && aiShouldRethink(session, random)) {
      useOpponentRethink(session, random);
      opponentRethought = true;
    }
    p2Card = selectAiCard(session, candidate, random);
    if (!p2Card) return next;
    const p1Card = removeCardByUid(session.p1.cards, cardUid);
    if (!p1Card) return next;
    removeSpecificCard(session.p2.cards, p2Card);
    return settlePlayedRound(next, session, p1Card, p2Card, { aiWasFirst, roundNo, topicBefore, hpBefore, angerBefore, opponentRethought, random });
  }

  // AI 先手：其牌此前已定（firstCard）
  p2Card = session.firstCard;
  if (!p2Card) return next;
  session.firstCard = null;
  const p1Card = removeCardByUid(session.p1.cards, cardUid);
  if (!p1Card) return next;
  return settlePlayedRound(next, session, p1Card, p2Card, { aiWasFirst, roundNo, topicBefore, hpBefore, angerBefore, opponentRethought: false, random });
}

interface RoundContext {
  aiWasFirst: boolean;
  roundNo: number;
  topicBefore: DebateTopic;
  hpBefore: { p1: number; p2: number };
  angerBefore: { p1: number; p2: number };
  opponentRethought: boolean;
  random: Rng;
}

/** 双方出牌确定后的完整结算（判定→激愤→补牌→换话题→AI先手→终局） */
function settlePlayedRound(
  next: GameState,
  session: DebateSession,
  p1Card: DebateCard,
  p2Card: DebateCard,
  ctx: RoundContext,
): GameState {
  const { random, aiWasFirst, roundNo, topicBefore, hpBefore, angerBefore, opponentRethought } = ctx;

  const result = applyRoundResult(session, p1Card, p2Card, random);

  // 伤害记录（展示用）
  const damageToP2 = hpBefore.p2 - session.p2.hp;
  const damageToP1 = hpBefore.p1 - session.p1.hp;
  const angerAfterRound = snapshotAnger(session);

  // 激愤结算（含我方愤怒/镇静自动反制）
  const furyActions = applyPendingFury(session, result, random);

  const gameOver = isGameOver(session);
  let aiFirst: { card: DebateCard; rethought: boolean } | null = null;

  if (!gameOver) {
    refillHandsAfterRound(session, random);
    applyPendingTopicChange(session, result);
    if (session.firstPlayer === 2) {
      // 下回合 AI 先手：可能思考后选定先手牌（UI 展示遮罩预览）
      const rethought = opponentCanRethink(session) && aiShouldRethink(session, random);
      if (rethought) useOpponentRethink(session, random);
      const aiCard = startAiFirstTurn(session, random);
      if (aiCard) aiFirst = { card: aiCard, rethought };
    }
  }

  if (gameOver) {
    session.status = 'finished';
    session.winner = session.p2.hp <= 0 ? 'recruiter' : 'target';
    settleDebateOutcome(next, session);
  }

  session.lastRound = {
    roundNo,
    aiWasFirst,
    p1Card,
    p2Card,
    opponentRethought,
    winner: result.winner === 'a' ? 'p1' : result.winner === 'b' ? 'p2' : 'draw',
    reason: result.reason,
    damageToP1,
    damageToP2,
    hpBefore,
    angerBefore,
    angerAfter: angerAfterRound,
    furyActions,
    topicBefore,
    topicAfter: session.currentTopic,
    aiFirst,
    gameOver,
  };

  next.debateSession = session;
  return next;
}

/**
 * 舌战结束结算：
 * - 我方获胜 → 登用目标（在野目标加入势力）；
 * - 我方失利 → 目标禁仕 3 个月，短期内无法再登用。
 */
function settleDebateOutcome(next: GameState, session: DebateSession): void {
  const recruiter = next.officers[session.recruiterId];
  const target = next.officers[session.targetId];
  if (!recruiter || !target) return;
  const recruiterForceId = recruiter.forceId as ForceId | undefined;
  if (!recruiterForceId) return;

  if (session.winner === 'recruiter') {
    target.forceId = recruiterForceId;
    const cityId: CityId = target.location.kind === 'unaffiliated' ? target.location.cityId : (target.location as { cityId: CityId }).cityId;
    target.location = { kind: 'city', cityId };
    target.bannedUntilMonth = undefined;
    target.loyalty = recruitmentInitialLoyalty(target);
    // 本旬通过舌战新登用的武将视为已行动，下个回合（旬）才可执行指令
    target.acted = true;
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

/** 关闭舌战视图（结束后清空会话；进行中忽略；旧版结构异常会话直接清除） */
export function dismissDebate(state: GameState): GameState {
  const next = structuredClone(state);
  if (!next.debateSession) return next;
  const session = next.debateSession;
  const malformed = !session.p1 || !session.p2;
  if (session.status === 'ongoing' && !malformed) return next;
  next.debateSession = null;
  return next;
}

/** 翻转视角：p1/p2 互换，复用为 p2 编写的 AI 选牌逻辑为 p1 选牌 */
function flipSessionForP1(session: DebateSession): DebateSession {
  return {
    ...session,
    p1: session.p2,
    p2: session.p1,
    firstPlayer: session.firstPlayer === 1 ? 2 : 1,
  };
}

/**
 * AI 势力舌战自动结算（AI 执行登庸后立即调用，不进入玩家界面）：
 * 双方均由 AI 出牌（p1 通过翻转视角复用同一套选牌逻辑），逐回合演算至终局并结算。
 */
export function autoResolveDebate(initial: GameState): GameState {
  let next = structuredClone(initial);
  let guard = 0;
  while (next.debateSession && next.debateSession.status === 'ongoing' && guard < 150) {
    const session = next.debateSession;
    const random = makeRng(next);
    const flipped = flipSessionForP1(session);
    const card = selectAiCard(flipped, session.firstCard, random);
    if (!card) break;
    const after = resolveDebateRound(next, card.uid);
    if (after === next) break;
    next = after;
    guard += 1;
  }
  // 兜底：极端情况下演算未分胜负则判招募方失利，确保不遗留挂起会话
  if (next.debateSession?.status === 'ongoing') {
    next = resolveDebateAbandon(next);
  }
  return next;
}

// ---------- 展示辅助 ----------

/** 对手手牌遮罩：话题牌仅显示话题名，话术牌显示「话术」 */
export function maskOpponentHand(cards: DebateCard[]): Array<Pick<DebateCard, 'uid' | 'type' | 'topic' | 'id' | 'isNew'> & { displayName: string }> {
  return (cards || []).map((card) => {
    if (card.type === 'skill') {
      return { uid: card.uid, type: card.type, id: card.id, isNew: card.isNew, displayName: '话术' };
    }
    return {
      uid: card.uid,
      type: card.type,
      topic: card.topic,
      id: card.id,
      isNew: card.isNew,
      displayName: TYPE_NAMES[card.topic ?? 'story'] || '话题',
    };
  });
}

/** 对手先手牌的遮罩预览 */
export function maskFirstCardPreview(card: DebateCard | null): { displayName: string; type: 'topic' | 'skill'; topic?: DebateTopic } | null {
  if (!card) return null;
  if (card.type === 'skill') return { displayName: '话术', type: 'skill' };
  return { displayName: TYPE_NAMES[card.topic ?? 'story'], type: 'topic', topic: card.topic };
}

/** 回合结果判定文案（参照小程序 resultText） */
export function roundResultText(record: DebateRoundRecord): { text: string; tone: 'win' | 'lose' | 'draw' } {
  if (record.p1Card.id === 'ignore' || record.p2Card.id === 'ignore') return { text: '无效', tone: 'draw' };
  if (record.winner === 'draw') return { text: '平手', tone: 'draw' };
  return record.winner === 'p1' ? { text: '胜', tone: 'win' } : { text: '败', tone: 'lose' };
}

/** 回结算音（参照小程序 roundAudioFile）：大喝 > 强词夺理 > 平手 > 胜/败 */
export function roundAudioEvent(record: DebateRoundRecord): 'debate-shout' | 'debate-sophistry' | 'debate-draw' | 'debate-victory' | 'debate-defeat' {
  const has = (id: string) => record.p1Card.id === id || record.p2Card.id === id;
  if (has('shout')) return 'debate-shout';
  if (has('sophistry')) return 'debate-sophistry';
  if (record.winner === 'draw') return 'debate-draw';
  return record.winner === 'p1' ? 'debate-victory' : 'debate-defeat';
}

/** 激愤徽章文案（激活当回合不显示倒计时数字，避免误数成 4 回合；次回合起显示剩余回合） */
export function furyBadgeText(player: DebatePlayerState): string {
  if (!player.furyRounds) return '';
  if (player.furyJustActivated) return `火冒三丈 · ${player.trait} 激活`;
  return `火冒三丈 · ${player.trait} ${player.furyRounds}回合`;
}

/** 头像旁激愤提示 */
export function furyPortraitText(player: DebatePlayerState): string {
  if (!player.furyRounds || !player.trait) return '';
  if (player.furyJustActivated) return `${player.trait}愤怒 · 激活`;
  return `${player.trait}愤怒 · ${player.furyRounds}回合`;
}

/** 激愤动作文案 */
export function furyActionText(action: DebateFuryAction): string {
  if (!action) return '愤怒爆发';
  if (action.text) return action.text;
  if (!action.trait) return '愤怒爆发';
  if (action.card?.name) return `${action.trait}爆发 · ${action.card.name}`;
  return `${action.trait}爆发`;
}

export const DEBATE_TRAITS = TRAIT_SET;
