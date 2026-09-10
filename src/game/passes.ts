import { emptyArmaments } from './armaments';
import { gridKey, neighborsOf, ringCoordsWithinRange, type GridCoord } from './battle/grid';
import type { CityArmaments, CityId, ForceId, GameState, Pass, PassId } from './types';
import china42Data from './scenario/china42x.json';

/** 原版关隘锚点（单格，来自 Scen000.s11 建筑坐标，与 jingxiang208.china42Passes 同源） */
interface PassAnchor {
  id: string;
  label: string;
  q: number;
  r: number;
}

const PASS_ANCHORS = (china42Data.passes ?? []) as PassAnchor[];

/** 关隘所属城池：默认取最近城池，个别按原版设定/战役安排调整 */
export const PASS_HOME_CITY: Record<PassId, CityId> = {
  huguan: 'jinyang', // 原版：壶关属晋阳（距邺17/晋阳19，取原版设定）
  hulaoguan: 'luoyang', // 最近（12）且与原版一致：虎牢关属洛阳
  tongguan: 'changan', // 原版：潼关为长安东正门
  hanguguan: 'wan', // 战役安排：函谷关属宛（曹操，开局唯一有主关隘）
  wuguan: 'changan', // 最近（12）且与原版一致：武关属长安
  yangpingguan: 'hanzhong', // 最近（6）且与原版一致：阳平关属汉中
  jiange: 'zitong', // 最近（8）：剑阁属梓潼
  jiamengguan: 'zitong', // 原版：葭萌关属梓潼（距梓潼15/成都9，取原版设定）
  fushuiguan: 'chengdu', // 原版：涪水关属成都
  jiangyouguan: 'zitong', // 最近（9）：江油关属梓潼
};

export const PASS_IDS: PassId[] = PASS_ANCHORS.map((anchor) => anchor.id as PassId);

const PASS_INITIAL_TROOPS = 2000;
const PASS_INITIAL_GOLD = 1000;
const PASS_INITIAL_FOOD = 10_000;
/** 关隘初始兵装：枪/戟/箭/马各 500（原版关隘自带守备兵装） */
const PASS_INITIAL_ARMAMENTS: CityArmaments = { spear: 500, halberd: 500, crossbow: 500, cavalry: 500, ram: 0, tower: 0, ship: 0 };
/** 关隘人口随机范围 4 万 ~ 8 万 */
export const PASS_POPULATION_MIN = 40_000;
export const PASS_POPULATION_SPREAD = 40_000;
/** 关隘守军初始气力（训练指令提升/出征，无治安值故巡查不作用于城市治安） */
export const PASS_INITIAL_TRAINING = 100;
/** 关隘初始治安（无治安值，仅供巡查等指令机制占位） */
export const PASS_INITIAL_ORDER = 100;
/** 关隘钱/粮容纳上限（同城池） */
export const PASS_GOLD_CAP = 200_000;
export const PASS_FOOD_CAP = 2_000_000;
/** 关隘耐久上限（同城池） */
export const PASS_MAX_DURABILITY = 3000;

/** 关隘人口确定性随机（按 id 哈希），保证同城同关隘每次开局一致、存档稳定 */
function stableHash(text: string): number {
  let hash = 0;
  for (let i = 0; i < text.length; i += 1) {
    hash = (hash * 31 + text.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}

export function passPopulationFor(id: PassId): number {
  return PASS_POPULATION_MIN + (stableHash(id) % (PASS_POPULATION_SPREAD + 1));
}

/**
 * 初始化全部关隘据点：归属=最近/设定城池的所有者；归属城被占则关隘有主（兵力2000/金1000/粮10000/枪戟箭马各500），
 * 归属城无主则关隘也无主（兵力0，钱粮为0不做结算）。人口在 4万~8万 间随机。
 */
export function createScenarioPasses(state: Pick<GameState, 'cities' | 'grid'>): Record<PassId, Pass> {
  const passCellKeys = new Set(
    state.grid.filter((cell) => cell.terrain === 'pass').map((cell) => gridKey(cell)),
  );
  const result = {} as Record<PassId, Pass>;
  for (const anchor of PASS_ANCHORS) {
    const id = anchor.id as PassId;
    const city = state.cities[PASS_HOME_CITY[id]];
    const ownerId: ForceId | null = city?.ownerId ?? null;
    const occupied = ownerId !== null;
    const flankKeys = neighborsOf(anchor.q, anchor.r)
      .filter((n) => passCellKeys.has(gridKey(n)))
      .map(gridKey);
    result[id] = {
      id,
      name: anchor.label,
      homeCityId: PASS_HOME_CITY[id],
      ownerId,
      // 开局关隘无武将：太守与驻扎武将均由玩家自派（移动/召唤入驻）
      governorId: null,
      gold: occupied ? PASS_INITIAL_GOLD : 0,
      food: occupied ? PASS_INITIAL_FOOD : 0,
      population: passPopulationFor(id),
      troops: occupied ? PASS_INITIAL_TROOPS : 0,
      training: occupied ? PASS_INITIAL_TRAINING : 0,
      order: PASS_INITIAL_ORDER,
      durability: PASS_MAX_DURABILITY,
      maxDurability: PASS_MAX_DURABILITY,
      armaments: occupied ? { ...PASS_INITIAL_ARMAMENTS } : emptyArmaments(),
      trainedThisTenDay: false,
      patrolledThisTenDay: false,
      q: anchor.q,
      r: anchor.r,
      flankKeys,
    };
  }
  return result;
}

/** 全部关隘翼格集合（不可通行、渲染隐藏）；按 state 实例缓存，同实例多次查询不重算 */
const blockedPassCache = new WeakMap<object, Set<string>>();
export function passBlockedKeys(state: Pick<GameState, 'passes' | 'grid'>): Set<string> {
  const cached = blockedPassCache.get(state);
  if (cached) return cached;
  const keys = new Set<string>();
  const passCells = new Set(
    (state.grid ?? []).filter((cell) => cell.terrain === 'pass').map((cell) => gridKey(cell)),
  );
  for (const pass of Object.values(state.passes ?? {})) {
    for (const key of pass.flankKeys) keys.add(key);
    // 防御性：锚点不在 pass 地形上的旧数据，重新按邻接 pass 格推导翼格
    if (!passCells.has(gridKey(pass))) {
      for (const n of neighborsOf(pass.q, pass.r)) {
        if (passCells.has(gridKey(n))) keys.add(gridKey(n));
      }
    }
  }
  blockedPassCache.set(state, keys);
  return keys;
}

/** 目标格是否关隘中心锚点（可通行格），返回对应关隘 */
export function passAt(state: Pick<GameState, 'passes'>, coord: GridCoord): Pass | undefined {
  const key = gridKey(coord);
  for (const pass of Object.values(state.passes ?? {})) {
    if (pass.q === coord.q && pass.r === coord.r) return pass;
  }
  return undefined;
}

/** 关隘月度资金收入 = √总人口（无治安值修正，与城池基础人口税收一致） */
export function passMonthlyGoldIncome(pass: Pass): number {
  return Math.floor(Math.sqrt(pass.population));
}

/** 关隘季度粮食收入 = 7×√总人口（与城池基础人口粮税一致，无治安修正） */
export function passQuarterlyFoodIncome(pass: Pass): number {
  return Math.floor(7 * Math.sqrt(pass.population));
}

/** 关隘攻击范围（关隘中心往外2格）：敌方部队进入此区域时每旬受箭矢攻击 */
export const PASS_ATTACK_RANGE = 2;
/** 关隘本身占 1 格，反击区从紧邻的一圈开始（外1~2圈，不含关隘中心） */
export const PASS_ATTACK_MIN = 1;
/** 关隘箭矢每旬基础伤害（按守军兵力比例，与城池一致） */
export const PASS_RANGED_BASE_DAMAGE_RATIO = 0.05;

/** 获取关隘攻击区格子（距关隘中心 PASS_ATTACK_MIN~PASS_ATTACK_RANGE 圈，不含关隘本身） */
export function passAttackRangeCoords(pass: Pass): GridCoord[] {
  const coords: GridCoord[] = [];
  for (let d = PASS_ATTACK_MIN; d <= PASS_ATTACK_RANGE; d += 1) {
    coords.push(...ringCoordsWithinRange({ q: pass.q, r: pass.r }, d));
  }
  return coords;
}

/** 判断某坐标是否在关隘攻击区内（距关隘中心 PASS_ATTACK_MIN~PASS_ATTACK_RANGE 圈） */
export function isInPassAttackRange(pass: Pass, q: number, r: number): boolean {
  // 网格使用偶数列偏移坐标（even-q offset），需先转为轴向坐标再算六角格距离
  const toAxialR = (qVal: number, rVal: number) => rVal - Math.floor(qVal / 2);
  const aq = q - pass.q;
  const ar = toAxialR(q, r) - toAxialR(pass.q, pass.r);
  const dist = (Math.abs(aq) + Math.abs(ar) + Math.abs(aq + ar)) / 2;
  return dist >= PASS_ATTACK_MIN && dist <= PASS_ATTACK_RANGE;
}

/** 判断某坐标是否在任意关隘的攻击区内 */
export function isInAnyPassAttackRange(state: Pick<GameState, 'passes'>, q: number, r: number): boolean {
  return Object.values(state.passes ?? {}).some((pass) => isInPassAttackRange(pass, q, r));
}

/** 关隘是否被敌方封锁（攻击区内有敌方部队） */
export function isPassBlocked(state: Pick<GameState, 'passes' | 'units'>, pass: Pass): boolean {
  if (!pass.ownerId) return false;
  const attackKeys = new Set(passAttackRangeCoords(pass).map(gridKey));
  return Object.values(state.units).some(
    (unit) => unit.forceId && unit.forceId !== pass.ownerId && attackKeys.has(gridKey({ q: unit.q, r: unit.r })),
  );
}

/** 根据关隘状态，返回实际应给予的收入（封锁时为0） */
export function passIncomeMultiplierByBlockade(state: Pick<GameState, 'passes' | 'units'>, pass: Pass): number {
  return isPassBlocked(state, pass) ? 0 : 1;
}

/**
 * 关隘中心格对指定势力是否不可通行：仅当关隘有主且非该势力时阻挡。
 * 无主关隘任何势力均可通行；归属方（及其它无主情形）可通行。
 * forceId 未知（如编辑器预览）时不阻挡。
 */
export function passCenterBlockedFor(state: Pick<GameState, 'passes'>, coord: GridCoord, forceId: ForceId | undefined): boolean {
  const pass = passAt(state, coord);
  if (!pass || !pass.ownerId || !forceId) return false;
  return pass.ownerId !== forceId;
}

/**
 * 旬结算：关隘箭矢射击（对攻击区内敌方部队每旬造成伤害）。
 * 与城池一致：伤害 = 守军兵力 × 5%，最低 100。
 */
export function settlePassRangedAttack(state: GameState): string[] {
  const events: string[] = [];
  for (const pass of Object.values(state.passes ?? {})) {
    if (!pass.ownerId) continue;
    const attackKeys = new Set(passAttackRangeCoords(pass).map(gridKey));
    const enemyUnitsInRange = Object.values(state.units).filter((unit) => {
      if (!unit.forceId || unit.forceId === pass.ownerId) return false;
      return attackKeys.has(gridKey({ q: unit.q, r: unit.r }));
    });

    for (const unit of enemyUnitsInRange) {
      const damage = Math.max(100, Math.round(pass.troops * PASS_RANGED_BASE_DAMAGE_RATIO));
      unit.troops = Math.max(0, unit.troops - damage);
      state.battleDamageReports ??= [];
      state.battleDamageReports.push({
        id: `pass-arrow-${state.month}-${state.tenDay}-${pass.id}-${unit.id}-${state.battleDamageReports.length}`,
        unitId: unit.id,
        q: unit.q,
        r: unit.r,
        amount: damage,
        kind: 'attack',
        label: `${pass.name}箭矢`,
      });
      events.push(`${pass.name}向关外敌军射出箭矢，${damage}士兵被射杀（${state.officers[unit.leaderId]?.name ?? unit.id}部）`);
      if (unit.troops <= 0) {
        delete state.units[unit.id];
        events.push(`${state.officers[unit.leaderId]?.name ?? unit.id}部被${pass.name}箭矢全歼`);
      }
    }
  }
  return events;
}