import { ARMAMENT_LABELS, armamentsOf, TROOP_ARMAMENT, TROOP_LABELS } from '../armaments';
import { energyCapOf, techLevelOf, troopMovementBonusForTroop } from '../techs';
import { unitTroopCapOf } from '../ranks';
import { appointSuccessorGovernor, hasPlotFacility } from '../innerAffairs';
import { formationMovementAllowanceBonus } from '../skills/rules/movement';
import type { ForceId, GameState } from '../types';
import { isWaterTerrain } from './catalog';
import {
  DEPLOY_AP_COST,
  movementAllowanceForProfile,
  type DeployInput,
  type TransportInput,
} from './legacyCore';
import { cellAt, deploymentCells, spawnCellFor } from './movementRules';

export { deploymentCells } from './movementRules';
export type { DeployInput, TransportInput } from './legacyCore';

function preferredSpawnCell(state: GameState, cityId: Parameters<typeof deploymentCells>[1], movement: number, troopType: Parameters<typeof deploymentCells>[3], vehicle?: 'boat' | 'ship') {
  const options = deploymentCells(state, cityId, movement, troopType, vehicle);
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
  cityId: Parameters<typeof deploymentCells>[1],
  movement: number,
  troopType: Parameters<typeof deploymentCells>[3],
  toward: { q: number; r: number },
  vehicle?: 'boat' | 'ship',
) {
  const options = deploymentCells(state, cityId, movement, troopType, vehicle);
  const land = options.filter((coord) => !isWaterTerrain(cellAt(state, coord)?.terrain));
  const pool = land.length > 0 ? land : options;
  return chooseDelegateSpawnCell(pool, toward);
}

export function deployUnit(state: GameState, forceId: ForceId, input: DeployInput): GameState {
  const city = state.cities[input.cityId];
  const target = input.targetCityId ? state.cities[input.targetCityId] : undefined;
  const officerIds = input.officerIds?.length ? input.officerIds : input.officerId ? [input.officerId] : [];
  const leaderId = officerIds[0];
  const officers = officerIds.map((officerId) => state.officers[officerId]);
  const officer = leaderId ? state.officers[leaderId] : undefined;
  const troopType = input.troopType ?? 'sword';
  const vehicle = input.vehicle ?? 'boat';
  const gold = input.gold ?? 0;
  const armamentType = TROOP_ARMAMENT[troopType];
  const cityArmaments = armamentsOf(city?.armaments);
  const movementAllowance = movementAllowanceForProfile(troopType) + formationMovementAllowanceBonus(state, officerIds, troopType) + troopMovementBonusForTroop(state, forceId, troopType);
  if (state.phase !== 'playing') throw new Error('游戏已经结束');
  if (state.turnForceId !== forceId) throw new Error('不是当前势力旬');
  if (!city || city.ownerId !== forceId) throw new Error('只能从己方城市出征');
  if (input.targetCityId && !target) throw new Error('目标城市不存在');
  if (officerIds.length === 0) throw new Error('至少选择一名武将');
  if (!officer) throw new Error('武将不存在');
  if (officerIds.length > 3 || new Set(officerIds).size !== officerIds.length) throw new Error('最多选择一名主将和两名副将');
  if (officers.some((candidate) => !candidate || candidate.forceId !== forceId || candidate.location.kind !== 'city' || candidate.location.cityId !== city.id)) {
    throw new Error('武将不在出征城市');
  }
  if (officers.some((candidate) => candidate.acted)) throw new Error('选择的武将已经行动');
  if (state.actionPoints[forceId] < DEPLOY_AP_COST) throw new Error('行动力不足 20');
  if (!Number.isInteger(input.troops) || input.troops < 1000 || input.troops > unitTroopCapOf(state, forceId, leaderId)) {
    throw new Error(`出征兵力必须为 1000-${unitTroopCapOf(state, forceId, leaderId)}`);
  }
  if (!Number.isInteger(gold) || gold < 0 || gold > city.gold) throw new Error('资金不足');
  if (!Number.isInteger(input.food) || input.food < 0 || input.food > city.food) throw new Error('粮草不足');
  if (city.troops - input.troops < 500) throw new Error('城市至少保留 500 兵力');
  if (armamentType && cityArmaments[armamentType] < input.troops) throw new Error(`${TROOP_LABELS[troopType]}兵装不足`);
  if (vehicle === 'ship' && cityArmaments.ship < 1) throw new Error('楼船兵装不足');
  if (troopType === 'siege' && !input.siegeWeapon) throw new Error('需要选择冲车或井阑');
  if (troopType === 'siege' && cityArmaments[input.siegeWeapon!] < 1) throw new Error(`${ARMAMENT_LABELS[input.siegeWeapon!]}不足`);

  const spawn = input.destination ?? (target
    ? spawnCellFor(state, city, target, troopType, vehicle)
    : preferredSpawnCell(state, input.cityId, movementAllowance, troopType, vehicle));
  if (!spawn) throw new Error('没有合法出生格');
  if (!deploymentCells(state, input.cityId, movementAllowance, troopType, vehicle).some((coord) => coord.q === spawn.q && coord.r === spawn.r)) {
    throw new Error('出征位置超出移动范围');
  }

  const next = structuredClone(state);
  next.cityEffectReports = [];
  const unitId = `unit-${next.month}-${next.tenDay}-${leaderId}-${Object.keys(next.units).length + 1}`;
  next.cities[input.cityId].troops -= input.troops;
  next.cities[input.cityId].gold -= gold;
  next.cities[input.cityId].food -= input.food;
  if (armamentType) {
    next.cities[input.cityId].armaments = { ...cityArmaments, [armamentType]: cityArmaments[armamentType] - input.troops };
  }
  if (vehicle === 'ship') {
    next.cities[input.cityId].armaments = { ...cityArmaments, ship: cityArmaments.ship - 1 };
  }
  if (troopType === 'siege' && input.siegeWeapon) {
    next.cities[input.cityId].armaments = {
      ...cityArmaments,
      [input.siegeWeapon]: cityArmaments[input.siegeWeapon] - 1,
    };
  }
  next.actionPoints[forceId] -= DEPLOY_AP_COST;
  for (const officerId of officerIds) {
    next.officers[officerId].acted = true;
    next.officers[officerId].location = { kind: 'unit', unitId };
  }
  // 太守出征：出发城自动补任太守（本城最高政治值武将）
  const departCity = next.cities[input.cityId];
  if (departCity.governorId && officerIds.includes(departCity.governorId)) {
    appointSuccessorGovernor(next, departCity);
  }
  // 科技：军制1级熟练兵气力上限+20；2级随军参谋初始气力+政治×20%
  const energyCap = energyCapOf(state, forceId);
  const staffOfficerBonus = techLevelOf(state, forceId, 'military') >= 2
    ? Math.floor((officer?.stats.politics ?? 0) * 0.2)
    : 0;
  const initialEnergy = Math.min(energyCap, 100 + staffOfficerBonus);
  // 战力：出城战力 = 城中士气×25% + 部队最高政治×(基础20% + 科技加成0 + 兵部加成20%)
  const maxPolitics = officers.reduce((max, candidate) => Math.max(max, candidate.stats.politics), 0);
  const bingbuBonus = hasPlotFacility(city, 'bingbu') ? 0.2 : 0;
  const initialStamina = Math.min(100, Math.floor(city.training * 0.25 + maxPolitics * (0.2 + bingbuBonus)));
  next.units[unitId] = {
    id: unitId, kind: 'combat', forceId, leaderId, officerIds: [...officerIds], homeCityId: input.cityId,
    troopType, vehicle, siegeWeapon: troopType === 'siege' ? input.siegeWeapon : undefined, q: spawn.q, r: spawn.r, troops: input.troops, gold, food: input.food, energy: initialEnergy, stamina: initialStamina,
    movementRemaining: movementAllowance, moved: true, acted: false,
  };
  next.logs.push({ id: `deploy-${unitId}`, month: next.month, forceId, message: `${officer.name}率军从${city.name}出征` });
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
  const city = state.cities[input.cityId];
  const officerIds = input.officerIds?.length ? input.officerIds : input.officerId ? [input.officerId] : [];
  const leaderId = officerIds[0];
  const troopType = input.troopType ?? 'sword';
  const vehicle = input.vehicle ?? 'boat';
  const gold = input.gold ?? 0;
  const movementAllowance = movementAllowanceForProfile(troopType) + formationMovementAllowanceBonus(state, officerIds, troopType) + troopMovementBonusForTroop(state, forceId, troopType);
  const spawn = input.destination ?? preferredSpawnCell(state, input.cityId, movementAllowance, troopType, vehicle);
  if (!city || !leaderId || !spawn) throw new Error('无法创建出征预览');
  const next = structuredClone(state);
  const unitId = `preview-deploy-${leaderId}`;
  const previewOfficers = officerIds.map((officerId) => state.officers[officerId]);
  const previewMaxPolitics = previewOfficers.reduce((max, candidate) => Math.max(max, candidate?.stats.politics ?? 0), 0);
  const previewBingbuBonus = hasPlotFacility(city, 'bingbu') ? 0.2 : 0;
  const initialStamina = Math.min(100, Math.floor(city.training * 0.25 + previewMaxPolitics * (0.2 + previewBingbuBonus)));
  next.units[unitId] = {
    id: unitId, kind: 'combat', forceId, leaderId, officerIds: [...officerIds], homeCityId: input.cityId,
    troopType, vehicle, siegeWeapon: troopType === 'siege' ? input.siegeWeapon : undefined, q: spawn.q, r: spawn.r, troops: input.troops, gold, food: input.food, energy: 100, stamina: initialStamina,
    movementRemaining: movementAllowance, moved: true, acted: false,
  };
  return { state: next, unitId };
}

export function deployTransportUnit(state: GameState, forceId: ForceId, input: TransportInput): GameState {
  const city = state.cities[input.cityId];
  const officer = state.officers[input.officerId];
  if (state.phase !== 'playing') throw new Error('游戏已经结束');
  if (state.turnForceId !== forceId) throw new Error('不是当前势力旬');
  if (!city || city.ownerId !== forceId) throw new Error('只能从己方城市输送');
  if (!officer || officer.forceId !== forceId || officer.location.kind !== 'city' || officer.location.cityId !== city.id) throw new Error('武将不在输送城市');
  if (officer.acted) throw new Error('武将已经行动');
  if (state.actionPoints[forceId] < DEPLOY_AP_COST) throw new Error('行动力不足 20');
  if (!Number.isInteger(input.troops) || input.troops < 0 || input.troops > 10000) throw new Error('输送士兵必须为 0-10000');
  if (!Number.isInteger(input.gold) || input.gold < 0 || input.gold > city.gold) throw new Error('资金不足');
  if (!Number.isInteger(input.food) || input.food < 0 || input.food > city.food) throw new Error('兵粮不足');
  if (input.troops === 0 && input.gold === 0 && input.food === 0) throw new Error('至少输送一种资源');
  if (city.troops - input.troops < 500) throw new Error('城市至少保留 500 兵力');

  const spawn = input.destination ?? deploymentCells(state, input.cityId, undefined, 'transport')[0];
  if (!spawn) throw new Error('没有合法输送位置');
  if (!deploymentCells(state, input.cityId, undefined, 'transport').some((coord) => coord.q === spawn.q && coord.r === spawn.r)) {
    throw new Error('输送位置超出移动范围');
  }

  const next = structuredClone(state);
  next.cityEffectReports = [];
  const unitId = `transport-${next.month}-${next.tenDay}-${input.officerId}-${Object.keys(next.units).length + 1}`;
  next.cities[input.cityId].troops -= input.troops;
  next.cities[input.cityId].gold -= input.gold;
  next.cities[input.cityId].food -= input.food;
  next.actionPoints[forceId] -= DEPLOY_AP_COST;
  next.officers[input.officerId].acted = true;
  next.officers[input.officerId].location = { kind: 'unit', unitId };
  // 太守输送出城：出发城自动补任太守
  if (next.cities[input.cityId].governorId === input.officerId) {
    appointSuccessorGovernor(next, next.cities[input.cityId]);
  }
  next.units[unitId] = {
    id: unitId, kind: 'transport', forceId, leaderId: input.officerId, homeCityId: input.cityId,
    gold: input.gold, q: spawn.q, r: spawn.r, troops: input.troops, food: input.food, energy: 100,
    movementRemaining: 0, moved: true, acted: false,
  };
  next.logs.push({ id: `transport-${unitId}`, month: next.month, forceId, message: `${officer.name}从${city.name}输送物资` });
  return next;
}
