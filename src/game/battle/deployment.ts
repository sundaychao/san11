import { ARMAMENT_LABELS, ARMAMENT_TYPES, armamentLabelFor, armamentsCarriedByDeploy, armamentsOf, takeArmaments, TROOP_ARMAMENT, TROOP_LABELS } from '../armaments';
import { deployTroopCapOf, initialEnergyBonus, moraleCapOf, movementTechBonus } from '../techs';
import { unitTroopCapOf } from '../ranks';
import { appointSuccessorGovernor, hasPlotFacility } from '../innerAffairs';
import { appointStrongholdSuccessor } from '../strongholds';
import { formationMovementAllowanceBonus } from '../skills/rules/movement';
import type { City, CityArmaments, CityId, ForceId, GameState, Pass, PassId, TroopType } from '../types';
import { battleShipMovementBonus, isWaterTerrain, MIN_TRANSPORT_TROOPS } from './catalog';
import {
  DEPLOY_AP_COST,
  movementAllowanceForProfile,
  type DeployInput,
  type TransportInput,
} from './legacyCore';
import { cellAt, deploymentCellsForStronghold, deploymentCostsForStronghold, spawnCellFor } from './movementRules';

export { deploymentCells, deploymentCellsForStronghold, deploymentCostsForStronghold } from './movementRules';
export type { DeployInput, TransportInput } from './legacyCore';

/**
 * 输送队单次可押运的兵力上限。与据点驻军规模、主将官阶**都无关**——输送队不是作战编制，
 * 不吃 `unitTroopCapOf`，只有这一条上限。UI 侧滑块最大值也取本常量，避免两处各写一个数字。
 */
export const TRANSPORT_TROOP_CAP = 10000;

/** 解析出征/输送出发据点：passId 优先（关隘），否则按 cityId 取城池 */
function deploySourceOf(state: GameState, input: { cityId?: CityId; passId?: PassId }): City | Pass | undefined {
  return input.passId ? state.passes?.[input.passId] : input.cityId ? state.cities[input.cityId] : undefined;
}

/**
 * 出征移动力预算（出征与出征预览共用同一口径）：
 * 兵种基础 + 阵型特技 + 科技（兵科对应节点）+ 舰船加成。
 * 楼船/斗舰按水军口径取「罗盘」+6（与每旬重置 turn.ts 的 movementTechBonus 一致），
 * 斗舰再额外 +4（造船术，`battleShipMovementBonus`）——罗盘的 +6 不重复给。
 */
export function deploymentMovementAllowance(
  state: GameState,
  forceId: ForceId,
  officerIds: string[],
  troopType: TroopType,
  vehicle: 'boat' | 'ship',
) {
  const techProfile = vehicle === 'ship'
    ? { kind: 'combat' as const, troopType, vehicle: 'ship' as const }
    : { kind: 'combat' as const, troopType };
  return movementAllowanceForProfile(troopType)
    + formationMovementAllowanceBonus(state, officerIds, troopType)
    + movementTechBonus(state, forceId, techProfile)
    + battleShipMovementBonus(state, { forceId, vehicle });
}

function preferredSpawnCell(state: GameState, source: City | Pass, movement: number, troopType: Parameters<typeof deploymentCellsForStronghold>[3], vehicle?: 'boat' | 'ship') {
  const options = deploymentCellsForStronghold(state, source.id, movement, troopType, vehicle);
  return options.find((coord) => !isWaterTerrain(cellAt(state, coord)?.terrain)) ?? options[0];
}

/** 六边形网格的近似距离（奇偶行平铺：将 r 按 q 折叠成轴向行距） */
export function hexGridDistance(a: { q: number; r: number }, b: { q: number; r: number }) {
  const ar = a.r - Math.floor(a.q / 2);
  const br = b.r - Math.floor(b.q / 2);
  const dq = a.q - b.q;
  const dr = ar - br;
  return (Math.abs(dq) + Math.abs(dr) + Math.abs(dq + dr)) / 2;
}

/** 在给定部署格（deployTargets）中挑离 toward 最近的陆地格；无陆地则退化为最近格 */
export function chooseDelegateSpawnCell(targets: { q: number; r: number }[], toward: { q: number; r: number }): { q: number; r: number } | undefined {
  if (targets.length === 0) return undefined;
  return [...targets]
    .sort((a, b) => (
      hexGridDistance(a, toward) - hexGridDistance(b, toward)
      || a.q - b.q
      || a.r - b.r
    ))[0];
}

/**
 * 出征超距委任的出生格选择：在出征可部署格中挑「离委任目标最近」的陆地格，
 * 使部队从城池朝目标方向出城（而不是固定取第一个部署格导致反方向绕路）。
 */
export function preferredSpawnCellToward(
  state: GameState,
  cityId: Parameters<typeof deploymentCellsForStronghold>[1],
  movement: number,
  troopType: Parameters<typeof deploymentCellsForStronghold>[3],
  toward: { q: number; r: number },
  vehicle?: 'boat' | 'ship',
) {
  const options = deploymentCellsForStronghold(state, cityId, movement, troopType, vehicle);
  const land = options.filter((coord) => !isWaterTerrain(cellAt(state, coord)?.terrain));
  const pool = land.length > 0 ? land : options;
  return chooseDelegateSpawnCell(pool, toward);
}

export function deployUnit(state: GameState, forceId: ForceId, input: DeployInput): GameState {
  const source = deploySourceOf(state, input);
  const target = input.targetCityId ? state.cities[input.targetCityId] : undefined;
  const officerIds = input.officerIds?.length ? input.officerIds : input.officerId ? [input.officerId] : [];
  const leaderId = officerIds[0];
  const officers = officerIds.map((officerId) => state.officers[officerId]);
  const officer = leaderId ? state.officers[leaderId] : undefined;
  const troopType = input.troopType ?? 'sword';
  const vehicle = input.vehicle ?? 'boat';
  const gold = input.gold ?? 0;
  const armamentType = TROOP_ARMAMENT[troopType];
  const sourceArmaments = armamentsOf(source?.armaments);
  const movementAllowance = deploymentMovementAllowance(state, forceId, officerIds, troopType, vehicle);
  if (state.phase !== 'playing') throw new Error('游戏已经结束');
  if (state.turnForceId !== forceId) throw new Error('不是当前势力旬');
  if (!source || source.ownerId !== forceId) throw new Error('只能从己方据点出征');
  if (input.targetCityId && !target) throw new Error('目标城市不存在');
  if (officerIds.length === 0) throw new Error('至少选择一名武将');
  if (!officer) throw new Error('武将不存在');
  if (officerIds.length > 3 || new Set(officerIds).size !== officerIds.length) throw new Error('最多选择一名主将和两名副将');
  const officerAtSource = (candidate: NonNullable<typeof officers[number]>) => input.passId
    ? candidate.location.kind === 'pass' && candidate.location.passId === input.passId
    : candidate.location.kind === 'city' && candidate.location.cityId === input.cityId;
  if (officers.some((candidate) => !candidate || candidate.forceId !== forceId || !officerAtSource(candidate))) {
    throw new Error('武将不在出征据点');
  }
  if (officers.some((candidate) => candidate.acted)) throw new Error('选择的武将已经行动');
  if (state.actionPoints[forceId] < DEPLOY_AP_COST) throw new Error('行动力不足 20');
  if (!Number.isInteger(input.troops) || input.troops < 1000 || input.troops > unitTroopCapOf(state, forceId, leaderId)) {
    throw new Error(`出征兵力必须为 1000-${unitTroopCapOf(state, forceId, leaderId)}`);
  }
  if (!Number.isInteger(gold) || gold < 0 || gold > source.gold) throw new Error('资金不足');
  if (!Number.isInteger(input.food) || input.food < 0 || input.food > source.food) throw new Error('粮草不足');
  if (source.troops - input.troops < 500) throw new Error('据点至少保留 500 兵力');
  if (armamentType && sourceArmaments[armamentType] < input.troops) throw new Error(`${TROOP_LABELS[troopType]}兵装不足`);
  // 兵装存储口径不变（冲车/井阑/楼船），但提示按科技口径显示（木兽/投石车/斗舰）
  if (vehicle === 'ship' && sourceArmaments.ship < 1) throw new Error(`${armamentLabelFor(state, forceId, 'ship')}兵装不足`);
  if (troopType === 'siege' && !input.siegeWeapon) {
    throw new Error(`需要选择${armamentLabelFor(state, forceId, 'ram')}或${armamentLabelFor(state, forceId, 'tower')}`);
  }
  if (troopType === 'siege' && sourceArmaments[input.siegeWeapon!] < 1) {
    throw new Error(`${armamentLabelFor(state, forceId, input.siegeWeapon!)}不足`);
  }

  const spawn = input.destination ?? (target
    ? (input.passId
      // 关隘为单格据点，无 spawnCellFor 的城池面向逻辑：取部署格中朝目标最近者
      ? chooseDelegateSpawnCell(deploymentCellsForStronghold(state, source.id, movementAllowance, troopType, vehicle), { q: target.gridQ, r: target.gridR })
      : spawnCellFor(state, source as City, target, troopType, vehicle))
    : preferredSpawnCell(state, source, movementAllowance, troopType, vehicle));
  if (!spawn) throw new Error('没有合法出生格');
  const deploymentCosts = deploymentCostsForStronghold(state, source.id, movementAllowance, troopType, vehicle);
  if (!deploymentCellsForStronghold(state, source.id, movementAllowance, troopType, vehicle).some((coord) => coord.q === spawn.q && coord.r === spawn.r)) {
    throw new Error('出征位置超出移动范围');
  }
  // 落位本身就是本旬位移：从出征移动力预算中扣除到达落位格的消耗，
  // 剩余移动力才留给本旬随后的委任行军/修补靠近，保证总位移不超过显示的可移动范围。
  const spawnMovementRemaining = Math.max(0, movementAllowance - (deploymentCosts.get(`${spawn.q},${spawn.r}`) ?? movementAllowance));

  const next = structuredClone(state);
  // 与 moveUnit/waitUnit 同口径清理瞬时战报：出征是新的部队动作，旧的建设/修补/战斗弹字不应带到场上
  next.battleDamageReports = [];
  next.cityEffectReports = [];
  next.facilityRepairReports = [];
  next.strategyResultReports = [];
  const unitId = `unit-${next.month}-${next.tenDay}-${leaderId}-${Object.keys(next.units).length + 1}`;
  const departSource = input.passId ? next.passes![input.passId] : next.cities[input.cityId!];
  departSource.troops -= input.troops;
  departSource.gold -= gold;
  departSource.food -= input.food;
  // 兵装扣减：枪戟弩马按兵力 1:1、楼船/冲车/井阑各 1 件。一次性算出并扣除，
  // 避免「兵种兵装」与「楼船/兵器」逐项覆盖导致漏扣（见 takeArmaments 注释）。
  const carriedArmaments = armamentsCarriedByDeploy(troopType, input.troops, vehicle, input.siegeWeapon);
  if (Object.keys(carriedArmaments).length > 0) {
    departSource.armaments = takeArmaments(sourceArmaments, carriedArmaments);
  }
  next.actionPoints[forceId] -= DEPLOY_AP_COST;
  for (const officerId of officerIds) {
    next.officers[officerId].acted = true;
    next.officers[officerId].location = { kind: 'unit', unitId };
  }
  // 太守出征：出发据点自动补任太守（本据点最高政治值武将）
  if (departSource.governorId && officerIds.includes(departSource.governorId)) {
    if (input.passId) appointStrongholdSuccessor(next, departSource);
    else appointSuccessorGovernor(next, departSource as City);
  }
  // 部队士气 ＝ 出发据点的士气（两者是同一资源、同一上限）：据点士气多少，出阵部队就带多少；
  // 科技「随军参谋」再额外 +相关属性×20%。战力另算（见下方 initialStamina）。
  const moraleCap = moraleCapOf(state, forceId);
  const staffOfficerBonus = initialEnergyBonus(state, forceId, officer?.stats.politics ?? 0);
  const initialEnergy = Math.min(moraleCap, source.training + staffOfficerBonus);
  // 战力：出城战力 = 城中士气×25% + 部队最高政治×(基础20% + 科技加成0 + 兵部加成20%)
  const maxPolitics = officers.reduce((max, candidate) => Math.max(max, candidate.stats.politics), 0);
  const bingbuBonus = hasPlotFacility(source, 'bingbu') ? 0.2 : 0;
  const initialStamina = Math.min(100, Math.floor(source.training * 0.25 + maxPolitics * (0.2 + bingbuBonus)));
  next.units[unitId] = {
    id: unitId, kind: 'combat', forceId, leaderId, officerIds: [...officerIds], homeCityId: input.passId ? (source as Pass).homeCityId : input.cityId!,
    troopType, vehicle, siegeWeapon: troopType === 'siege' ? input.siegeWeapon : undefined, q: spawn.q, r: spawn.r, troops: input.troops, gold, food: input.food, energy: initialEnergy, stamina: initialStamina,
    movementRemaining: spawnMovementRemaining, moved: true, acted: false,
    // 记下本次带走的兵装：部队回城/进关并账时原样返还（未记录者不返还）
    ...(Object.keys(carriedArmaments).length > 0 ? { armaments: carriedArmaments } : {}),
  };
  next.logs.push({ id: `deploy-${unitId}`, month: next.month, forceId, message: `${officer.name}率军从${source.name}出征` });
  return next;
}

export function deployUnitWithId(state: GameState, forceId: ForceId, input: DeployInput): { state: GameState; unitId: string } {
  const existingUnitIds = new Set(Object.keys(state.units));
  const next = deployUnit(state, forceId, input);
  const unitId = Object.keys(next.units).find((id) => !existingUnitIds.has(id));
  if (!unitId) throw new Error('出征部队创建失败');
  return { state: next, unitId };
}

export function deployUnitPreviewWithId(state: GameState, forceId: ForceId, input: DeployInput): { state: GameState; unitId: string } {
  const source = deploySourceOf(state, input);
  const officerIds = input.officerIds?.length ? input.officerIds : input.officerId ? [input.officerId] : [];
  const leaderId = officerIds[0];
  const troopType = input.troopType ?? 'sword';
  const vehicle = input.vehicle ?? 'boat';
  const gold = input.gold ?? 0;
  const movementAllowance = deploymentMovementAllowance(state, forceId, officerIds, troopType, vehicle);
  const spawn = input.destination ?? preferredSpawnCell(state, source!, movementAllowance, troopType, vehicle);
  if (!source || !leaderId || !spawn) throw new Error('无法创建出征预览');
  // 与 deployUnit 同口径：预览部队的剩余移动力 = 出征移动力 − 到达落位格的消耗
  const previewSpawnCost = deploymentCostsForStronghold(state, source.id, movementAllowance, troopType, vehicle).get(`${spawn.q},${spawn.r}`) ?? movementAllowance;
  const next = structuredClone(state);
  const unitId = `preview-deploy-${leaderId}`;
  const previewOfficers = officerIds.map((officerId) => state.officers[officerId]);
  const previewMaxPolitics = previewOfficers.reduce((max, candidate) => Math.max(max, candidate?.stats.politics ?? 0), 0);
  const previewBingbuBonus = hasPlotFacility(source, 'bingbu') ? 0.2 : 0;
  const initialStamina = Math.min(100, Math.floor(source.training * 0.25 + previewMaxPolitics * (0.2 + previewBingbuBonus)));
  // 与 deployUnit 同口径：部队士气 = 出发据点士气 + 「随军参谋」按主将政治加成
  const previewEnergy = Math.min(moraleCapOf(state, forceId), source.training + initialEnergyBonus(state, forceId, previewOfficers[0]?.stats.politics ?? 0));
  next.units[unitId] = {
    id: unitId, kind: 'combat', forceId, leaderId, officerIds: [...officerIds], homeCityId: input.passId ? (source as Pass).homeCityId : input.cityId!,
    troopType, vehicle, siegeWeapon: troopType === 'siege' ? input.siegeWeapon : undefined, q: spawn.q, r: spawn.r, troops: input.troops, gold, food: input.food, energy: previewEnergy, stamina: initialStamina,
    movementRemaining: Math.max(0, movementAllowance - previewSpawnCost), moved: true, acted: false,
  };
  return { state: next, unitId };
}

export function deployTransportUnit(state: GameState, forceId: ForceId, input: TransportInput): GameState {
  const source = deploySourceOf(state, input);
  const officerIds = input.officerIds?.length ? input.officerIds : input.officerId ? [input.officerId] : [];
  const leaderId = officerIds[0];
  const leader = leaderId ? state.officers[leaderId] : undefined;
  const officers = officerIds.map((officerId) => state.officers[officerId]);
  if (state.phase !== 'playing') throw new Error('游戏已经结束');
  if (state.turnForceId !== forceId) throw new Error('不是当前势力旬');
  if (!source || source.ownerId !== forceId) throw new Error('只能从己方据点输送');
  if (officerIds.length === 0) throw new Error('至少选择一名武将');
  if (officerIds.length > 3 || new Set(officerIds).size !== officerIds.length) throw new Error('最多选择一名主将和两名副将');
  const officerAtSource = (candidate: NonNullable<typeof officers[number]>) => input.passId
    ? candidate.location.kind === 'pass' && candidate.location.passId === input.passId
    : candidate.location.kind === 'city' && candidate.location.cityId === input.cityId;
  if (!leader || officers.some((candidate) => !candidate || candidate.forceId !== forceId || !officerAtSource(candidate))) {
    throw new Error('武将不在输送据点');
  }
  if (officers.some((candidate) => candidate.acted)) throw new Error('选择的武将已经行动');
  if (state.actionPoints[forceId] < DEPLOY_AP_COST) throw new Error('行动力不足 20');
  if (!Number.isInteger(input.troops) || input.troops < MIN_TRANSPORT_TROOPS || input.troops > TRANSPORT_TROOP_CAP) {
    throw new Error(`输送士兵必须为 ${MIN_TRANSPORT_TROOPS}-${TRANSPORT_TROOP_CAP}`);
  }
  if (!Number.isInteger(input.gold) || input.gold < 0 || input.gold > source.gold) throw new Error('资金不足');
  if (!Number.isInteger(input.food) || input.food < 0 || input.food > source.food) throw new Error('兵粮不足');
  // 货装的校验口径与「据点库存」一致：逐项非负整数且不超过据点现有量，至少押运一种
  const sourceArmaments = armamentsOf(source.armaments);
  const carriedArmaments: Partial<CityArmaments> = {};
  for (const type of ARMAMENT_TYPES) {
    const amount = input.armaments?.[type] ?? 0;
    if (amount <= 0) continue;
    if (!Number.isInteger(amount) || amount > sourceArmaments[type]) throw new Error(`${ARMAMENT_LABELS[type]}不足`);
    carriedArmaments[type] = amount;
  }
  const carriesSomething = input.troops > 0 || input.gold > 0 || input.food > 0 || Object.keys(carriedArmaments).length > 0;
  if (!carriesSomething) throw new Error('至少输送一种资源');
  if (source.troops - input.troops < 500) throw new Error('据点至少保留 500 兵力');

  const spawn = input.destination ?? deploymentCellsForStronghold(state, source.id, undefined, 'transport')[0];
  if (!spawn) throw new Error('没有合法输送位置');
  if (!deploymentCellsForStronghold(state, source.id, undefined, 'transport').some((coord) => coord.q === spawn.q && coord.r === spawn.r)) {
    throw new Error('输送位置超出移动范围');
  }

  const next = structuredClone(state);
  next.cityEffectReports = [];
  const unitId = `transport-${next.month}-${next.tenDay}-${leaderId}-${Object.keys(next.units).length + 1}`;
  const departSource = input.passId ? next.passes![input.passId] : next.cities[input.cityId!];
  departSource.troops -= input.troops;
  departSource.gold -= input.gold;
  departSource.food -= input.food;
  if (Object.keys(carriedArmaments).length > 0) {
    departSource.armaments = takeArmaments(sourceArmaments, carriedArmaments);
  }
  next.actionPoints[forceId] -= DEPLOY_AP_COST;
  for (const officerId of officerIds) {
    next.officers[officerId].acted = true;
    next.officers[officerId].location = { kind: 'unit', unitId };
  }
  // 太守输送出城：出发据点自动补任太守
  if (departSource.governorId && officerIds.includes(departSource.governorId)) {
    if (input.passId) appointStrongholdSuccessor(next, departSource);
    else appointSuccessorGovernor(next, departSource as City);
  }
  next.units[unitId] = {
    id: unitId, kind: 'transport', forceId, leaderId, officerIds: [...officerIds], homeCityId: input.passId ? (source as Pass).homeCityId : input.cityId!,
    gold: input.gold, q: spawn.q, r: spawn.r, troops: input.troops, food: input.food,
    // 与出征同口径：输送队士气也来自出发据点
    energy: Math.min(moraleCapOf(state, forceId), source.training),
    movementRemaining: 0, moved: true, acted: false,
    // 押运的兵装是货物：并账时整件返还（见 strongholds.returnArmamentsToStronghold）
    ...(Object.keys(carriedArmaments).length > 0 ? { armaments: carriedArmaments } : {}),
  };
  next.logs.push({ id: `transport-${unitId}`, month: next.month, forceId, message: `${leader.name}从${source.name}输送物资` });
  return next;
}

/**
 * 部署输送队并返回新部队 id。`deployTransportUnit` 本身是纯函数（入参 state 不被修改、
 * 返回全新克隆），因此它同时充当 UI「落位后命令菜单」的预演：预演态里资源已扣、
 * 武将已出城，但只用于查询可用命令与目标，不会写回真实对局 —— 与 `deployUnitPreviewWithId` 同一用法。
 */
export function deployTransportUnitWithId(state: GameState, forceId: ForceId, input: TransportInput): { state: GameState; unitId: string } {
  const existingUnitIds = new Set(Object.keys(state.units));
  const next = deployTransportUnit(state, forceId, input);
  const unitId = Object.keys(next.units).find((id) => !existingUnitIds.has(id));
  if (!unitId) throw new Error('输送队创建失败');
  return { state: next, unitId };
}
