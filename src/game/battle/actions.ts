import type { ArmyUnit, City, CityId, ForceId, GameState, GridCell, TerrainType } from '../types';
import { gridKey, neighborsOf, sevenCellCityFootprint, type GridCoord } from './grid';

const DEPLOY_AP_COST = 20;
const BASE_MOVEMENT = 5;

const TERRAIN_COST: Record<TerrainType, number> = {
  road: 1,
  plain: 1,
  forest: 2,
  hill: 2,
  mountain: Number.POSITIVE_INFINITY,
  deepWater: Number.POSITIVE_INFINITY,
};

interface DeployInput {
  cityId: CityId;
  officerId: string;
  targetCityId: CityId;
  troops: number;
  food: number;
}

function cellAt(state: GameState, coord: GridCoord): GridCell | undefined {
  return state.grid.find((cell) => cell.q === coord.q && cell.r === coord.r);
}

function movementCost(state: GameState, coord: GridCoord) {
  const cell = cellAt(state, coord);
  return cell ? TERRAIN_COST[cell.terrain] : Number.POSITIVE_INFINITY;
}

function allCityKeys(state: GameState) {
  const keys = new Set<string>();
  for (const city of Object.values(state.cities)) {
    for (const coord of sevenCellCityFootprint({ q: city.gridQ, r: city.gridR })) {
      keys.add(gridKey(coord));
    }
  }
  return keys;
}

function occupiedUnitKeys(state: GameState, ignoredUnitId?: string) {
  const keys = new Set<string>();
  for (const unit of Object.values(state.units)) {
    if (unit.id !== ignoredUnitId) keys.add(gridKey(unit));
  }
  return keys;
}

function isLegalUnitCell(state: GameState, coord: GridCoord, ignoredUnitId?: string) {
  return Number.isFinite(movementCost(state, coord)) &&
    !allCityKeys(state).has(gridKey(coord)) &&
    !occupiedUnitKeys(state, ignoredUnitId).has(gridKey(coord));
}

function distance(a: GridCoord, b: GridCoord) {
  return Math.abs(a.q - b.q) + Math.abs(a.r - b.r);
}

function cityCenter(city: City): GridCoord {
  return { q: city.gridQ, r: city.gridR };
}

function spawnCellFor(state: GameState, city: City, target: City) {
  const cityKeys = new Set(sevenCellCityFootprint(cityCenter(city)).map(gridKey));
  const candidates = new Map<string, GridCoord>();
  for (const coord of sevenCellCityFootprint(cityCenter(city))) {
    for (const neighbor of neighborsOf(coord.q, coord.r)) {
      const key = gridKey(neighbor);
      if (!cityKeys.has(key)) candidates.set(key, neighbor);
    }
  }
  return [...candidates.values()]
    .filter((coord) => isLegalUnitCell(state, coord))
    .sort((a, b) => distance(a, cityCenter(target)) - distance(b, cityCenter(target)) || a.q - b.q || a.r - b.r)[0];
}

function assertUnitTurn(state: GameState, forceId: ForceId, unitId: string): ArmyUnit {
  const unit = state.units[unitId];
  if (!unit) throw new Error('部队不存在');
  if (unit.forceId !== forceId) throw new Error('只能操作己方部队');
  if (unit.acted) throw new Error('部队已经行动');
  return unit;
}

function reachableCosts(state: GameState, unit: ArmyUnit) {
  const startKey = gridKey(unit);
  const costs = new Map<string, number>([[startKey, 0]]);
  const frontier: GridCoord[] = [{ q: unit.q, r: unit.r }];

  while (frontier.length > 0) {
    const current = frontier.shift()!;
    const currentCost = costs.get(gridKey(current))!;
    for (const neighbor of neighborsOf(current.q, current.r)) {
      if (!isLegalUnitCell(state, neighbor, unit.id)) continue;
      const nextCost = currentCost + movementCost(state, neighbor);
      const key = gridKey(neighbor);
      if (nextCost > unit.movementRemaining) continue;
      if (costs.has(key) && costs.get(key)! <= nextCost) continue;
      costs.set(key, nextCost);
      frontier.push(neighbor);
    }
  }

  return costs;
}

export function deployUnit(state: GameState, forceId: ForceId, input: DeployInput): GameState {
  const city = state.cities[input.cityId];
  const target = state.cities[input.targetCityId];
  const officer = state.officers[input.officerId];
  if (state.phase !== 'playing') throw new Error('游戏已经结束');
  if (state.turnForceId !== forceId) throw new Error('不是当前势力回合');
  if (!city || city.ownerId !== forceId) throw new Error('只能从己方城市出征');
  if (!target) throw new Error('目标城市不存在');
  if (!officer || officer.forceId !== forceId || officer.location.kind !== 'city' || officer.location.cityId !== city.id) {
    throw new Error('武将不在出征城市');
  }
  if (officer.acted) throw new Error('武将已经行动');
  if (state.actionPoints[forceId] < DEPLOY_AP_COST) throw new Error('行动力不足 20');
  if (!Number.isInteger(input.troops) || input.troops < 1000 || input.troops > 10000) throw new Error('出征兵力必须为 1000-10000');
  if (!Number.isInteger(input.food) || input.food < 0 || input.food > city.food) throw new Error('粮草不足');
  if (city.troops - input.troops < 500) throw new Error('城市至少保留 500 兵力');

  const spawn = spawnCellFor(state, city, target);
  if (!spawn) throw new Error('没有合法出生格');

  const next = structuredClone(state);
  const unitId = `unit-${next.month}-${next.tenDay}-${input.officerId}-${Object.keys(next.units).length + 1}`;
  next.cities[input.cityId].troops -= input.troops;
  next.cities[input.cityId].food -= input.food;
  next.actionPoints[forceId] -= DEPLOY_AP_COST;
  next.officers[input.officerId].acted = true;
  next.officers[input.officerId].location = { kind: 'unit', unitId };
  next.units[unitId] = {
    id: unitId,
    forceId,
    leaderId: input.officerId,
    homeCityId: input.cityId,
    q: spawn.q,
    r: spawn.r,
    troops: input.troops,
    food: input.food,
    energy: 100,
    movementRemaining: BASE_MOVEMENT,
    moved: true,
    acted: false,
  };
  next.logs.push({
    id: `deploy-${unitId}`,
    month: next.month,
    forceId,
    message: `${officer.name}率军从${city.name}出征`,
  });
  return next;
}

export function moveUnit(state: GameState, forceId: ForceId, unitId: string, destination: GridCoord): GameState {
  const unit = assertUnitTurn(state, forceId, unitId);
  if (unit.moved) throw new Error('部队已经移动');
  if (!isLegalUnitCell(state, destination, unitId)) throw new Error('目标格被占用或不可通行');
  const cost = reachableCosts(state, unit).get(gridKey(destination));
  if (cost === undefined) throw new Error('目标超过移动力');

  const next = structuredClone(state);
  next.units[unitId].q = destination.q;
  next.units[unitId].r = destination.r;
  next.units[unitId].movementRemaining -= cost;
  next.units[unitId].moved = true;
  return next;
}

export function waitUnit(state: GameState, forceId: ForceId, unitId: string): GameState {
  assertUnitTurn(state, forceId, unitId);
  const next = structuredClone(state);
  next.units[unitId].acted = true;
  return next;
}
