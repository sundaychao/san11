import { ARMAMENT_TYPES, armamentsOf, TROOP_SCALED_ARMAMENT_TYPES } from './armaments';
import { appointSuccessorGovernor } from './innerAffairs';
import { cityResourceCaps, clampCityResources, clampPassResources, passResourceCaps } from './strongholdCapacity';
import { moraleCapOf } from './techs';
import type { ArmyUnit, City, GameState, Pass } from './types';

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/** 资源宿主是否为关隘（用于区分关隘与城池：关隘无都市设施/商人/地格）。
 *  从 commands.ts 下沉至此：movement.ts 等底层结算模块需要本函数但不能反向依赖 commands（循环引用）。 */
export function isPassGarrison(g: City | Pass): g is Pass {
  return 'flankKeys' in g;
}

/**
 * 把一支部队整体并入据点（城池/关隘）：兵力按部队士气加权稀释据点士气、军粮/金钱并入、
 * 随军武将转为驻扎并标记已行动。**不负责删除部队本身**，调用方需自行 `delete state.units[unit.id]`。
 *
 * 三处共用同一口径，避免各写一遍走样：
 *   ① 移动进城（`movement.moveUnit` 回城）② 移动进关（回关）③ 攻破城池/关隘后主力进城（`captives`）。
 * 兵力受据点上限约束（城池按规模、关隘按 PASS_TROOP_CAP，均含科技「修筑要塞」倍率），超出部分丢弃。
 */
export function mergeUnitIntoStronghold(state: GameState, unit: ArmyUnit, stronghold: City | Pass): void {
  const garrisonIsPass = isPassGarrison(stronghold);
  // 上限与据点归属势力的科技同口径：合并后的钱/粮/兵装也按同一倍率收口，避免「先按倍率放行、再按基准截回」
  const resourceCaps = garrisonIsPass ? passResourceCaps(state, stronghold) : cityResourceCaps(state, stronghold);
  const troopCap = resourceCaps.troops;
  const prevTroops = stronghold.troops;
  const prevTraining = stronghold.training;
  // 士气（训练度）上限与部队气力上限同口径：职业化＋20
  const moraleCap = moraleCapOf(state, stronghold.ownerId);
  const unitMorale = clamp(unit.energy ?? 0, 0, moraleCap);
  const mergedTroops = Math.min(troopCap, prevTroops + unit.troops);
  const addedTroops = mergedTroops - prevTroops;
  stronghold.troops = mergedTroops;
  if (mergedTroops > 0) {
    stronghold.training = Math.round(clamp(
      (prevTroops * prevTraining + addedTroops * unitMorale) / mergedTroops, 0, moraleCap,
    ));
  }
  stronghold.food += unit.food;
  if (unit.gold) stronghold.gold += unit.gold;
  returnArmamentsToStronghold(stronghold, unit, addedTroops);

  const officerIds = unit.officerIds ?? [unit.leaderId];
  // 入城/入关武将若仍挂名其他据点太守（如出征前未补任的旧档），原据点自动补任
  for (const officerId of officerIds) {
    const officer = state.officers[officerId];
    if (!officer) continue;
    const governedCity = Object.values(state.cities).find((candidate) => (
      candidate.governorId === officerId && candidate.id !== stronghold.id
    ));
    if (governedCity) appointSuccessorGovernor(state, governedCity);
    const governedPass = Object.values(state.passes ?? {}).find((candidate) => (
      candidate.governorId === officerId && candidate.id !== stronghold.id
    ));
    if (governedPass) appointStrongholdSuccessor(state, governedPass);
  }
  for (const officerId of officerIds) {
    const officer = state.officers[officerId];
    if (!officer) continue;
    officer.location = garrisonIsPass
      ? { kind: 'pass', passId: stronghold.id }
      : { kind: 'city', cityId: stronghold.id };
    officer.cityId = garrisonIsPass ? stronghold.homeCityId : stronghold.id;
    officer.acted = true;
  }
  // 并账后按据点容纳上限收口（含归属势力科技倍率）：兵力已在上面按上限收敛，这里补齐钱/粮/兵装，
  // 使任何直接调用（如委任部队行动不经过指令出口）也不会把钱粮顶爆。
  if (garrisonIsPass) clampPassResources(stronghold, state);
  else clampCityResources(stronghold, state);
}

/**
 * 部队并入据点时返还它出征时带走的兵装（`ArmyUnit.armaments`，由 `armamentsCarriedByDeploy` 写入）。
 *
 * - 枪/戟/弩/军马按兵力计，只返还「实际并入据点」的兵力数 —— 战损带走的装备不再归还；
 * - 楼船/冲车/井阑按「艘/辆」计，整件返还；
 * - **未记录兵装的部队不返还**（疆域防御队、输送队、旧存档）：避免凭空造出兵装。
 * 返还后由调用方末尾的 `clamp*Resources` 统一按据点上限收口。
 */
function returnArmamentsToStronghold(stronghold: City | Pass, unit: ArmyUnit, addedTroops: number): void {
  const carried = unit.armaments;
  if (!carried) return;
  const base = armamentsOf(stronghold.armaments);
  const next = { ...base };
  let changed = false;
  for (const type of ARMAMENT_TYPES) {
    const amount = carried[type] ?? 0;
    if (amount <= 0) continue;
    const returned = TROOP_SCALED_ARMAMENT_TYPES.includes(type) ? Math.min(amount, Math.max(0, addedTroops)) : amount;
    if (returned <= 0) continue;
    next[type] = base[type] + returned;
    changed = true;
  }
  if (changed) stronghold.armaments = next;
}

/** 据点补任太守（城池/关隘通用）：无主则清空，否则在驻扎武将中选政治最高者 */
export function appointStrongholdSuccessor(state: GameState, stronghold: City | Pass): void {
  if (!stronghold.ownerId) {
    stronghold.governorId = null;
    return;
  }
  const candidates = Object.values(state.officers).filter((officer) =>
    officer.forceId === stronghold.ownerId &&
    (isPassGarrison(stronghold)
      ? officer.location.kind === 'pass' && officer.location.passId === stronghold.id
      : officer.location.kind === 'city' && officer.location.cityId === stronghold.id));
  const best = candidates.sort((a, b) => b.stats.politics - a.stats.politics || a.id.localeCompare(b.id))[0];
  stronghold.governorId = best ? best.id : null;
}
