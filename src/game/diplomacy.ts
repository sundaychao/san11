import { nextRandom } from './random';
import { officerSkillNames } from './skills';
import type { City, DiplomacyAction, ForceId, GameState, Officer } from './types';

/**
 * 外交系统（参照《三国志11》原版）：
 * - 友好度：`Force.diplomacy` 存 `0 ~ 100`，`50` = 中立；双方各存一份，变动时同步调整。
 * - 亲善：固定花1000金，提升双方友好度；增长与执行者政治、君主相性差、亲疏关系相关。
 * - 同盟：无期限互不侵犯，成功与否由「金钱/政治/相性/友好度」判定；成功后可请求援军。
 * - 停战：有明确期限（1~24个月）的互不侵犯；期限越长判定门槛越高。
 * - 请求援军：仅同盟可用，向盟友请求出兵攻击指定敌城；成功后盟友将在目标城旁出兵。
 * - 出使行程：执行武将真的走这一趟 —— 去程按「出发据点 → 对方君主所在城池」的移动旬数计，
 *   抵达当旬才结算上述效果，随后自动返程，回到出发据点才恢复可用。见 `OfficerLocation['kind'] === 'envoy'`。
 */

export const DIPLOMACY_AP_COST = 20;
export const GOODWILL_GOLD_COST = 1000;
/** 同盟成立时的友好度增量（原版 +10） */
export const ALLIANCE_GOODWILL_GAIN = 10;
/** 同盟交涉失败时的友好度减量（原版 −10；原版还可能转为使者被捕，本作暂未实现） */
export const ALLIANCE_GOODWILL_LOSS = 10;
/** 破弃同盟时的友好度减量（原版 −50） */
export const BREAK_GOODWILL_LOSS = 50;
/** 同盟/停战可送出的资金上限 */
export const DIPLOMACY_GOLD_MAX = 10000;
/** 停战期限范围（月，1~24） */
export const TRUCE_MONTHS_MIN = 1;
export const TRUCE_MONTHS_MAX = 24;
/** 请求援军预期驻留旬数（约3个月=9旬） */
export const REINFORCEMENT_TEN_DAYS = 9;

/**
 * 外交子行动的中文名（命令菜单「外交」段与对话框标题共用）。
 * 「同盟」即原版的缔结同盟，「停战协议」即原版的停战，别在组件里另写文案。
 */
export const DIPLOMACY_ACTION_LABELS: Record<DiplomacyAction, string> = {
  goodwill: '亲善',
  alliance: '同盟',
  truce: '停战协议',
  requestTroops: '请求援军',
  break: '破弃同盟',
};

/** 外交子行动的展示顺序（命令菜单「外交」段按此排列） */
export const DIPLOMACY_ACTIONS: DiplomacyAction[] = ['goodwill', 'alliance', 'truce', 'requestTroops', 'break'];

/** 需要己方存在同盟势力才能执行的外交行动（无盟友时置灰） */
export const ALLIED_ONLY_ACTIONS: DiplomacyAction[] = ['requestTroops', 'break'];

/** 每旬一旬共计 month*3+tenDay，用于换算 */
export function tenDayIndex(month: number, tenDay: 1 | 2 | 3): number {
  return month * 3 + tenDay;
}

/** 友好度上下限：与原版《三国志11》一致（0 = 险恶，100 = 亲密） */
export const DIPLOMACY_MIN = 0;
export const DIPLOMACY_MAX = 100;
/**
 * 未发生外交关系时的友好度，取原版「中立」档中心。
 * 判定公式里的 `100 − 友好度` 直接以本值为基础，改动它会同时改变开局的外交难度。
 */
export const NEUTRAL_DIPLOMACY = 50;

export function clampDiplomacy(value: number): number {
  return Math.min(DIPLOMACY_MAX, Math.max(DIPLOMACY_MIN, Math.round(value)));
}

/** 读取 from 势力对 to 势力的友好度（0~100，默认 50 = 中立） */
export function forceDiplomacy(state: GameState, from: ForceId, to: ForceId): number {
  if (from === to) return DIPLOMACY_MAX;
  return state.forces[from]?.diplomacy?.[to] ?? NEUTRAL_DIPLOMACY;
}

/**
 * 出使目的地：目标势力君主所在的城池。
 * 君主驻关隘时取其所属城；君主出征/被俘/不在据点（或势力已无城池）时退化为该势力第一座城，无城则返回 null。
 * 外交使者的往返耗时与「抵达日期」都以本函数的结果为准，别再另算目的地。
 */
export function leaderCityOf(state: GameState, forceId: ForceId): City | null {
  const cities = Object.values(state.cities).filter((city) => city.ownerId === forceId);
  if (cities.length === 0) return null;
  const leaderId = state.forces[forceId]?.leaderId;
  const leader = leaderId ? state.officers[leaderId] : undefined;
  if (leader) {
    if (leader.location.kind === 'city') {
      const city = state.cities[leader.location.cityId];
      if (city && city.ownerId === forceId) return city;
    } else if (leader.location.kind === 'pass') {
      const pass = state.passes?.[leader.location.passId];
      const home = pass ? state.cities[pass.homeCityId] : undefined;
      if (home && home.ownerId === forceId) return home;
    }
  }
  return cities[0];
}

/** 双向增减友好度（亲善/破盟等统一入口） */
export function adjustDiplomacy(state: GameState, from: ForceId, to: ForceId, delta: number): void {
  if (from === to) return;
  for (const [source, target] of [[from, to], [to, from]] as const) {
    const force = state.forces[source];
    if (!force) continue;
    const diplomacy = force.diplomacy ?? {};
    diplomacy[target] = clampDiplomacy((diplomacy[target] ?? NEUTRAL_DIPLOMACY) + delta);
    force.diplomacy = diplomacy;
  }
}

export function areAllies(state: GameState, a: ForceId, b: ForceId): boolean {
  return a !== b && (state.forces[a]?.allies ?? []).includes(b);
}

/** 双方势力是否互不侵犯（同盟或停战期内） */
export function areNonAggressed(state: GameState, attacker: ForceId, defender: ForceId): boolean {
  return areAllies(state, attacker, defender) || (state.forces[attacker]?.truces?.[defender] ?? 0) > 0;
}

/** 相性（默认与势力存档一致，缺失时按势力顺序给25/75/125/130） */
export function forceXing(state: GameState, forceId: ForceId): number {
  const stored = state.forces[forceId]?.xing;
  if (typeof stored === 'number') return stored;
  const defaults: Record<ForceId, number> = { cao: 25, liu: 75, sun: 125, biao: 130 };
  return defaults[forceId] ?? 50;
}

/** 相性差（同一圆环上取最短距离，范围0~75） */
export function compatDifference(state: GameState, a: ForceId, b: ForceId): number {
  const diff = Math.abs(forceXing(state, a) - forceXing(state, b));
  return Math.min(diff, 150 - diff);
}

/** 两个相性数值间的圆环最短距离（0~75） */
export function circleCompatDiff(xingA: number, xingB: number): number {
  const diff = Math.abs(xingA - xingB);
  return Math.min(diff, 150 - diff);
}

/** 读取武将相性：在仕武将无独立相性字段时沿用其势力相性；
 *  在野且未设个人相性者按相性圆环中位 75 兜底（0 为圆环起点、75 为正对面，对各方势力均不偏袒） */
export function affinityOf(state: GameState, officer: Officer): number {
  const own = officer.xing;
  if (typeof own === 'number') return own;
  return officer.forceId ? forceXing(state, officer.forceId) : 75;
}

/** 相性差档位（映射原版三档），factor 用于掉忠/登庸修正 */
export interface CompatTier {
  key: 'close' | 'mid' | 'far';
  label: string;
  factor: number;
}

export function compatTierOf(diff: number): CompatTier {
  if (diff <= 24) return { key: 'close', label: '同相', factor: 0.5 };
  if (diff <= 49) return { key: 'mid', label: '中庸', factor: 1.0 };
  return { key: 'far', label: '相克', factor: 1.5 };
}

/** 武将与其势力君主间的相性差与档位（在野/无君主时逐级退化） */
export function officerCompatWithRuler(
  state: GameState,
  officer: Officer,
  forceId: ForceId,
): { diff: number; tier: CompatTier } {
  const rulerId = state.forces[forceId]?.leaderId;
  const ruler = rulerId ? state.officers[rulerId] : undefined;
  const rulerXing = ruler ? affinityOf(state, ruler) : (rulerId ? forceXing(state, forceId) : forceXing(state, forceId));
  const diff = circleCompatDiff(affinityOf(state, officer), rulerXing);
  return { diff, tier: compatTierOf(diff) };
}

/** 亲爱/厌恶武将 id 集合（对跟对方没有筛选，返回名称由调用方映射） */
export function likeAndHateIds(officer: Officer): { likes: string[]; hates: string[] } {
  return { likes: officer.likes ?? [], hates: officer.hates ?? [] };
}

/** 亲疏系数 c：执行者与目标君主为义兄弟/配偶 → 1.5，否则 1.0 */
function relationshipCoefficient(state: GameState, from: ForceId, to: ForceId, officer: Officer): number {
  const targetLeader = state.forces[to]?.leaderId;
  if (!targetLeader) return 1.0;
  const relation = officer.relationships?.[targetLeader];
  return relation === 'sworn' || relation === 'spouse' ? 1.5 : 1.0;
}

/**
 * 亲善成功后友好度增长：
 * ( c*20 + max(执行者政治 − 相性差/2, 0) + 100 ) / 10，至少1点。
 */
export function goodwillGain(state: GameState, from: ForceId, to: ForceId, officer: Officer): number {
  const c = relationshipCoefficient(state, from, to, officer);
  const compat = compatDifference(state, from, to);
  const raw = (c * 20 + Math.max(officer.stats.politics - Math.floor(compat / 2), 0) + 100) / 10;
  return Math.max(1, Math.floor(raw));
}

export interface DiplomacyJudgment {
  success: boolean;
  captured: boolean;
  judgment: number;
}

function roll100(state: GameState): number {
  const roll = nextRandom(state.seed, state.rngCursor);
  state.rngCursor = roll.cursor;
  return Math.floor(roll.value * 100);
}

/**
 * 同盟判定：
 * 判定值 = (金钱/150 + 执行者政治 − 相性差/5 + c*10) * t（t取1.0）
 * 判定值 > (100 − 友好度)*2 → 成功。
 */
export function resolveAlliance(
  state: GameState,
  from: ForceId,
  to: ForceId,
  officer: Officer,
  gold: number,
): DiplomacyJudgment {
  const c = relationshipCoefficient(state, from, to, officer);
  const judgment = Math.floor(gold / 150) + officer.stats.politics
    - Math.ceil(compatDifference(state, from, to) / 5) + Math.round(c * 10);
  const friendly = forceDiplomacy(state, from, to);
  return {
    success: judgment > (100 - friendly) * 2,
    captured: false,
    judgment,
  };
}

/**
 * 停战判定：
 * 判定值 = (金钱/400 + 执行者政治 − 相性差/5 + c) * t（t取1.0）
 * 判定值 > 80 + 期限/2 − 友好度/4 → 成功。
 */
export function resolveTruce(
  state: GameState,
  from: ForceId,
  to: ForceId,
  officer: Officer,
  gold: number,
  months: number,
): DiplomacyJudgment {
  const c = relationshipCoefficient(state, from, to, officer) === 1.5 ? 20 : 10;
  const judgment = Math.floor(gold / 400) + officer.stats.politics
    - Math.ceil(compatDifference(state, from, to) / 5) + c;
  const friendly = forceDiplomacy(state, from, to);
  return {
    success: judgment > 80 + months / 2 - friendly / 4,
    captured: false,
    judgment,
  };
}

/**
 * 请求援军判定：友好度与执行者政治越高越易被接受。
 */
export function resolveRequestTroops(
  state: GameState,
  from: ForceId,
  to: ForceId,
  officer: Officer,
): { success: boolean } {
  const friendly = forceDiplomacy(state, from, to);
  const chance = Math.min(95, 45 + Math.floor(friendly / 2) + Math.floor(officer.stats.politics / 3));
  return { success: roll100(state) < chance };
}

/** 某势力当前是否仍拥有城市（无城势力无法关押俘虏/出兵援军） */
export function forceHasCity(state: GameState, forceId: ForceId): boolean {
  return Object.values(state.cities).some((city) => city.ownerId === forceId);
}

/** 获取某势力当前拥有（且未被关押）的最高智力武将，用于流言防御方 */
export function forceStrategist(state: GameState, forceId: ForceId): Officer | undefined {
  return Object.values(state.officers)
    .filter((officer) => officer.forceId === forceId && officer.location.kind !== 'captive')
    .sort((a, b) => b.stats.intelligence - a.stats.intelligence)[0];
}

/** 武将是否持有「强运」特技 */
export function hasStrongLuckSkill(officer: Officer): boolean {
  return officerSkillNames(officer).includes('强运');
}

/** 武将是否持有「论客」特技 */
export function hasLobbyistSkill(officer: Officer): boolean {
  return officerSkillNames(officer).includes('论客');
}

/** 外交关系档位（参考原版「险恶 / 不和 / 中立 / 友好 / 亲密」五档） */
export type RelationTierKey = 'hostile' | 'discord' | 'neutral' | 'friendly' | 'intimate';

export const RELATION_TIER_LABELS: Record<RelationTierKey, string> = {
  hostile: '险恶',
  discord: '不和',
  neutral: '中立',
  friendly: '友好',
  intimate: '亲密',
};

/** 友好档及以上的下界（原版为 60）：AI 结盟筛选与亲善铺路共用，别在别处硬编码 */
export const FRIENDLY_TIER_MIN = 60;

/**
 * 友好度 → 档位切分表（自高到低，取第一个满足 min 的档）。
 * 与原版《三国志11》一致：友好度区间 `0 ~ 100` 五等分，每 20 点一段，
 * `0 ~ 19` 险恶、`20 ~ 39` 不和、`40 ~ 59` 中立、`60 ~ 79` 友好、`80 ~ 100` 亲密。
 */
const RELATION_TIER_CUTS: { key: RelationTierKey; min: number }[] = [
  { key: 'intimate', min: 80 },
  { key: 'friendly', min: FRIENDLY_TIER_MIN },
  { key: 'neutral', min: 40 },
  { key: 'discord', min: 20 },
  { key: 'hostile', min: Number.NEGATIVE_INFINITY },
];

export function relationTierOf(friendly: number): RelationTierKey {
  for (const cut of RELATION_TIER_CUTS) {
    if (friendly >= cut.min) return cut.key;
  }
  return 'hostile';
}

/** 友好度档位的中文名（险恶 / 不和 / 中立 / 友好 / 亲密） */
export function relationTierLabel(friendly: number): string {
  return RELATION_TIER_LABELS[relationTierOf(friendly)];
}

/** 「选择对象势力」页一行的完整外交视图 */
export interface ForceRelationView {
  forceId: ForceId;
  /** 我方对该势力的友好度（0~100） */
  friendly: number;
  tier: RelationTierKey;
  tierLabel: string;
  /** 双方相性差（0~75，越小越亲密） */
  compatibleDiff: number;
  allied: boolean;
  /** 停战剩余旬数（0 = 未停战） */
  truceTenDays: number;
  /** 关系：同盟 / 停战 / 中立 */
  relationLabel: '同盟' | '停战' | '中立';
  /** 当前是否存在有效盟约（界面「履行」列：同盟或停战期内为 true） */
  honored: boolean;
}

/** 汇总 from 视角下与 to 的外交关系（同盟 / 停战 / 友好度 / 相性差） */
export function forceRelationView(state: GameState, from: ForceId, to: ForceId): ForceRelationView {
  const friendly = forceDiplomacy(state, from, to);
  const allied = areAllies(state, from, to);
  // 停战双向记录；任一侧仍有剩余即视为停战期内，避免只写单边时误判
  const truceTenDays = Math.max(
    state.forces[from]?.truces?.[to] ?? 0,
    state.forces[to]?.truces?.[from] ?? 0,
  );
  return {
    forceId: to,
    friendly,
    tier: relationTierOf(friendly),
    tierLabel: relationTierLabel(friendly),
    compatibleDiff: compatDifference(state, from, to),
    allied,
    truceTenDays,
    relationLabel: allied ? '同盟' : truceTenDays > 0 ? '停战' : '中立',
    honored: allied || truceTenDays > 0,
  };
}