import { armamentsOf, TROOP_ARMAMENT, TROOP_LABELS } from '../armaments';
import { formationMovementAllowanceBonus } from '../skills/rules/movement';
import type { ForceId, GameState } from '../types';
import {
  DEPLOY_AP_COST,
  movementAllowanceForProfile,
  type DeployInput,
  type TransportInput,
} from './legacyCore';
import { deploymentCells, spawnCellFor } from './movementRules';

export { deploymentCells } from './movementRules';
export type { DeployInput, TransportInput } from './legacyCore';

export function deployUnit(state: GameState, forceId: ForceId, input: DeployInput): GameState {
  const city = state.cities[input.cityId];
  const target = input.targetCityId ? state.cities[input.targetCityId] : undefined;
  const officerIds = input.officerIds?.length ? input.officerIds : input.officerId ? [input.officerId] : [];
  const leaderId = officerIds[0];
  const officers = officerIds.map((officerId) => state.officers[officerId]);
  const officer = leaderId ? state.officers[leaderId] : undefined;
  const troopType = input.troopType ?? 'sword';
  const gold = input.gold ?? 0;
  const armamentType = TROOP_ARMAMENT[troopType];
  const cityArmaments = armamentsOf(city?.armaments);
  const movementAllowance = movementAllowanceForProfile(troopType) + formationMovementAllowanceBonus(state, officerIds, troopType);
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
  if (!Number.isInteger(input.troops) || input.troops < 1000 || input.troops > 10000) throw new Error('出征兵力必须为 1000-10000');
  if (!Number.isInteger(gold) || gold < 0 || gold > city.gold) throw new Error('资金不足');
  if (!Number.isInteger(input.food) || input.food < 0 || input.food > city.food) throw new Error('粮草不足');
  if (city.troops - input.troops < 500) throw new Error('城市至少保留 500 兵力');
  if (armamentType && cityArmaments[armamentType] < input.troops) throw new Error(`${TROOP_LABELS[troopType]}兵装不足`);

  const spawn = input.destination ?? (target
    ? spawnCellFor(state, city, target, troopType)
    : deploymentCells(state, input.cityId, movementAllowance, troopType)[0]);
  if (!spawn) throw new Error('没有合法出生格');
  if (!deploymentCells(state, input.cityId, movementAllowance, troopType).some((coord) => coord.q === spawn.q && coord.r === spawn.r)) {
    throw new Error('出征位置超出移动范围');
  }

  const next = structuredClone(state);
  const unitId = `unit-${next.month}-${next.tenDay}-${leaderId}-${Object.keys(next.units).length + 1}`;
  next.cities[input.cityId].troops -= input.troops;
  next.cities[input.cityId].gold -= gold;
  next.cities[input.cityId].food -= input.food;
  if (armamentType) {
    next.cities[input.cityId].armaments = { ...cityArmaments, [armamentType]: cityArmaments[armamentType] - input.troops };
  }
  next.actionPoints[forceId] -= DEPLOY_AP_COST;
  for (const officerId of officerIds) {
    next.officers[officerId].acted = true;
    next.officers[officerId].location = { kind: 'unit', unitId };
  }
  next.units[unitId] = {
    id: unitId, kind: 'combat', forceId, leaderId, officerIds: [...officerIds], homeCityId: input.cityId,
    troopType, q: spawn.q, r: spawn.r, troops: input.troops, gold, food: input.food, energy: 100,
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
  const gold = input.gold ?? 0;
  const movementAllowance = movementAllowanceForProfile(troopType) + formationMovementAllowanceBonus(state, officerIds, troopType);
  const spawn = input.destination ?? deploymentCells(state, input.cityId, movementAllowance, troopType)[0];
  if (!city || !leaderId || !spawn) throw new Error('无法创建出征预览');
  const next = structuredClone(state);
  const unitId = `preview-deploy-${leaderId}`;
  next.units[unitId] = {
    id: unitId, kind: 'combat', forceId, leaderId, officerIds: [...officerIds], homeCityId: input.cityId,
    troopType, q: spawn.q, r: spawn.r, troops: input.troops, gold, food: input.food, energy: 100,
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
  const unitId = `transport-${next.month}-${next.tenDay}-${input.officerId}-${Object.keys(next.units).length + 1}`;
  next.cities[input.cityId].troops -= input.troops;
  next.cities[input.cityId].gold -= input.gold;
  next.cities[input.cityId].food -= input.food;
  next.actionPoints[forceId] -= DEPLOY_AP_COST;
  next.officers[input.officerId].acted = true;
  next.officers[input.officerId].location = { kind: 'unit', unitId };
  next.units[unitId] = {
    id: unitId, kind: 'transport', forceId, leaderId: input.officerId, homeCityId: input.cityId,
    gold: input.gold, q: spawn.q, r: spawn.r, troops: input.troops, food: input.food, energy: 100,
    movementRemaining: 0, moved: true, acted: false,
  };
  next.logs.push({ id: `transport-${unitId}`, month: next.month, forceId, message: `${officer.name}从${city.name}输送物资` });
  return next;
}
