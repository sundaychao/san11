import { deployTroopCapOf } from './techs';
import type { ForceId, GameState, Officer, RankId, Stats } from './types';

/**
 * 官职与爵位系统（参考《三国志11》原版）：
 * - 爵位：势力级身份，由城市数量决定，每月自动晋升；决定君主指挥兵数上限。
 * - 官职：部下以功绩授予，决定指挥兵数上限并提供五维加成，按月发俸禄。
 */

export interface RankDef {
  id: RankId;
  name: string;
  /** 达到该爵位所需的最小城市数 */
  minCities: number;
  /** 君主（该爵位）的部队指挥兵数上限 */
  troopCap: number;
}

export const BASE_OFFICER_TROOP_CAP = 7000;
/** 武将开局初始功绩 */
export const INITIAL_OFFICER_MERIT = 4000;
/** 执行一次城市命令增加的功绩 */
export const MERIT_PER_COMMAND = 20;
/** 每月所有武将被动增加的功绩 */
export const MERIT_PER_MONTH = 30;

export const RANKS: RankDef[] = [
  { id: 'none', name: '无', minCities: 1, troopCap: 10000 },
  { id: 'zhou-cishi', name: '州刺史', minCities: 2, troopCap: 11000 },
  { id: 'zhou-mu', name: '州牧', minCities: 4, troopCap: 11000 },
  { id: 'yulin-zhonglang', name: '羽林中郎将', minCities: 6, troopCap: 12000 },
  { id: 'wuguan-zhonglang', name: '五官中郎将', minCities: 8, troopCap: 12000 },
  { id: 'da-jiangjun', name: '大将军', minCities: 12, troopCap: 13000 },
  { id: 'da-sima', name: '大司马', minCities: 14, troopCap: 13000 },
  { id: 'gong', name: '公', minCities: 18, troopCap: 14000 },
  { id: 'wang', name: '王', minCities: 20, troopCap: 14000 },
  { id: 'huangdi', name: '皇帝', minCities: 24, troopCap: 15000 },
];

export function rankDefinition(rank: RankId): RankDef {
  return RANKS.find((candidate) => candidate.id === rank) ?? RANKS[0];
}

export function rankName(rank: RankId | undefined): string {
  return rank ? rankDefinition(rank).name : '无';
}

/** 按城市数量计算应得的爵位 */
export function rankForCityCount(cityCount: number): RankDef {
  let result = RANKS[0];
  for (const rank of RANKS) {
    if (cityCount >= rank.minCities) result = rank;
  }
  return result;
}

export function rankIndex(rank: RankId | undefined): number {
  return RANKS.findIndex((candidate) => candidate.id === rank);
}

export interface PositionDef {
  id: string;
  name: string;
  /** 授予所需的功绩 */
  merit: number;
  /** 指挥兵数上限（仅该官职） */
  troopCommand: number;
  /** 每月俸禄（从武将所在城资金扣除） */
  salary: number;
  /** 五维加成（授予时即时生效） */
  statBonus: Partial<Stats>;
  /** 授予所需的爵位 */
  rankNeeded: RankId;
}

interface PositionTier {
  merit: number;
  salary: number;
  rankNeeded: RankId;
  troopCommand: number;
  statBonus: Partial<Stats> | null;
  names: string[];
}

// 原版官职表（按功绩/所需爵位分层；每层含文官与将军两组）
// 偏离原版：最低一档功绩要求为 0，无需功绩即可任免
const POSITION_TIERS: PositionTier[] = [
  { merit: 0, salary: 15, rankNeeded: 'zhou-cishi', troopCommand: 6000, statBonus: { politics: 1 }, names: ['主簿', '谏议大夫', '侍郎', '中郎'] },
  { merit: 0, salary: 15, rankNeeded: 'zhou-cishi', troopCommand: 7000, statBonus: null, names: ['忠义校尉', '昭信校尉', '儒林校尉', '建议校尉'] },
  { merit: 5000, salary: 10, rankNeeded: 'zhou-cishi', troopCommand: 5000, statBonus: { politics: 1 }, names: ['左仆射', '右仆射', '典农校尉', '议郎'] },
  { merit: 6000, salary: 10, rankNeeded: 'zhou-cishi', troopCommand: 7000, statBonus: null, names: ['奋威校尉', '长水校尉', '破贼校尉', '武卫校尉'] },
  { merit: 8000, salary: 20, rankNeeded: 'zhou-mu', troopCommand: 6000, statBonus: { politics: 2 }, names: ['太乐令', '大仓令', '武库令', '卫士令'] },
  { merit: 8000, salary: 20, rankNeeded: 'zhou-mu', troopCommand: 8000, statBonus: null, names: ['牙门将军', '护军', '偏将军', '裨将军'] },
  { merit: 12000, salary: 25, rankNeeded: 'yulin-zhonglang', troopCommand: 7000, statBonus: { politics: 2 }, names: ['郎中', '从事中郎', '长史', '司马'] },
  { merit: 12000, salary: 25, rankNeeded: 'yulin-zhonglang', troopCommand: 9000, statBonus: null, names: ['平东将军', '平南将军', '平西将军', '平北将军'] },
  { merit: 16000, salary: 30, rankNeeded: 'wuguan-zhonglang', troopCommand: 7000, statBonus: { politics: 3 }, names: ['谒者仆射', '都尉', '黄门侍郎', '太史令'] },
  { merit: 16000, salary: 30, rankNeeded: 'wuguan-zhonglang', troopCommand: 10000, statBonus: null, names: ['军师将军', '安国将军', '破虏将军', '讨逆将军'] },
  { merit: 20000, salary: 35, rankNeeded: 'da-jiangjun', troopCommand: 8000, statBonus: { politics: 3 }, names: ['秘书令', '侍中', '留府长史', '太学博士'] },
  { merit: 20000, salary: 35, rankNeeded: 'da-jiangjun', troopCommand: 11000, statBonus: null, names: ['左将军', '右将军', '前将军', '后将军'] },
  { merit: 24000, salary: 40, rankNeeded: 'da-sima', troopCommand: 8000, statBonus: { politics: 4 }, names: ['中书令', '御史中丞', '执金吾', '少府'] },
  { merit: 24000, salary: 40, rankNeeded: 'da-sima', troopCommand: 12000, statBonus: null, names: ['安东将军', '安南将军', '安西将军', '安北将军'] },
  { merit: 28000, salary: 45, rankNeeded: 'gong', troopCommand: 9000, statBonus: { politics: 4 }, names: ['尚书令', '太仆', '太常', '大鸿胪'] },
  { merit: 28000, salary: 45, rankNeeded: 'gong', troopCommand: 13000, statBonus: { leadership: 1 }, names: ['镇东将军', '镇南将军', '镇西将军', '镇北将军'] },
  { merit: 32000, salary: 50, rankNeeded: 'wang', troopCommand: 9000, statBonus: { politics: 5 }, names: ['光禄勋', '大司农', '廷尉', '卫尉'] },
  { merit: 32000, salary: 50, rankNeeded: 'wang', troopCommand: 14000, statBonus: { leadership: 1 }, names: ['征东将军', '征南将军', '征西将军', '征北将军'] },
  { merit: 36000, salary: 60, rankNeeded: 'huangdi', troopCommand: 15000, statBonus: { politics: 5 }, names: ['丞相', '司空', '太尉', '司徒'] },
  { merit: 36000, salary: 55, rankNeeded: 'huangdi', troopCommand: 15000, statBonus: { leadership: 2 }, names: ['大都督', '卫将军', '骠骑将军', '车骑将军'] },
];

export const POSITIONS: PositionDef[] = POSITION_TIERS.flatMap((tier) =>
  tier.names.map((name, index) => ({
    id: `${tier.rankNeeded}-${index}-${tier.troopCommand}-${name}`,
    name,
    merit: tier.merit,
    troopCommand: tier.troopCommand,
    salary: tier.salary,
    statBonus: tier.statBonus ?? {},
    rankNeeded: tier.rankNeeded,
  })),
);

export function positionDefinition(positionId: string | undefined): PositionDef | null {
  return positionId ? POSITIONS.find((position) => position.id === positionId) ?? null : null;
}

/** 带默认值的功绩读取（未显式记录时按初始功绩计） */
export function officerMerit(officer: Officer): number {
  return officer.merit ?? INITIAL_OFFICER_MERIT;
}

/** 增加功绩（不设上限，供命令/时间结算调用） */
export function addOfficerMerit(officer: Officer, amount: number): void {
  officer.merit = Math.max(0, officerMerit(officer) + amount);
}

/**
 * 武将是否正带部队在城外：随军（location.kind === 'unit'）且所在部队未驻于本势力城市格。
 * 带部队在城外的武将不可任免官职（需部队驻于友城格内方可在城中除授）。
 */
export function officerIsOnCampaign(state: GameState, officerId: string): boolean {
  const officer = state.officers[officerId];
  if (!officer) return false;
  const loc = officer.location;
  if (loc.kind !== 'unit') return false;
  const unit = state.units[loc.unitId];
  if (!unit) return false;
  return !Object.values(state.cities).some(
    (city) => city.ownerId === officer.forceId && city.gridQ === unit.q && city.gridR === unit.r,
  );
}

export function forceRankOf(state: GameState, forceId: ForceId): RankId {
  const force = state.forces[forceId];
  if (!force) return 'none';
  if (force.rank) return force.rank;
  // 兼容开局未结算/旧存档：爵位缺失时按城市数量推算，避免全体官职因"无爵"被锁
  const cityCount = Object.values(state.cities).filter((city) => city.ownerId === forceId).length;
  return rankForCityCount(cityCount).id;
}

/**
 * 部队主将（或君主）的指挥兵数上限：
 * - 君主：取爵位的 troopCap；
 * - 其余武将：取官职 troopCommand（无官为 5000）。
 */
export function officerTroopCapOf(state: GameState, forceId: ForceId, officer: Officer): number {
  const force = state.forces[forceId];
  if (force && force.leaderId === officer.id) return rankDefinition(forceRankOf(state, forceId)).troopCap;
  const position = positionDefinition(officer.positionId);
  return position ? position.troopCommand : BASE_OFFICER_TROOP_CAP;
}

/** 部队出征上限（官职/爵位基准 + 科技「节度使」+3000） */
export function unitTroopCapOf(state: GameState, forceId: ForceId, leaderId: string | undefined): number {
  const leader = leaderId ? state.officers[leaderId] : undefined;
  const base = leader ? officerTroopCapOf(state, forceId, leader) : 10000;
  // deployTroopCapOf 含 10000 基准，此处只取科技追加的 +3000
  return base + (deployTroopCapOf(state, forceId) - 10000);
}

/** 授予/免去官职时同步增减五维（与宝物加成一致，免官精确还原） */
export function applyPositionStatDelta(officer: Officer, positionId: string | undefined, sign: 1 | -1): void {
  const definition = positionDefinition(positionId);
  if (!definition) return;
  for (const [key, bonus] of Object.entries(definition.statBonus)) {
    officer.stats[key as keyof Stats] += sign * (bonus ?? 0);
  }
}