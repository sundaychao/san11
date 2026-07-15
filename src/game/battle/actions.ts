import type { ArmyUnit, City, CityId, ForceId, GameState, GridCell, TerrainType, TroopType } from '../types';
import { nextRandom } from '../random';
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

const TERRAIN_DEFENSE: Record<TerrainType, number> = {
  road: 1,
  plain: 1,
  forest: 0.85,
  hill: 0.8,
  mountain: 1,
  deepWater: 1,
};

interface DeployInput {
  cityId: CityId;
  officerId: string;
  targetCityId?: CityId;
  troopType?: TroopType;
  destination?: GridCoord;
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

function areAdjacent(a: GridCoord, b: GridCoord) {
  return neighborsOf(a.q, a.r).some((coord) => coord.q === b.q && coord.r === b.r);
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

export function deploymentCells(state: GameState, cityId: CityId, movement = BASE_MOVEMENT): GridCoord[] {
  const city = state.cities[cityId];
  if (!city) return [];
  const start = cityCenter(city);
  const ownCityKeys = new Set(sevenCellCityFootprint(start).map(gridKey));
  const cityKeys = allCityKeys(state);
  const unitKeys = occupiedUnitKeys(state);
  const costs = new Map<string, number>([[gridKey(start), 0]]);
  const coords = new Map<string, GridCoord>([[gridKey(start), start]]);
  const frontier: GridCoord[] = [start];

  while (frontier.length > 0) {
    const current = frontier.shift()!;
    const currentCost = costs.get(gridKey(current))!;
    for (const neighbor of neighborsOf(current.q, current.r)) {
      const key = gridKey(neighbor);
      const insideOwnCity = ownCityKeys.has(key);
      const terrainCost = insideOwnCity ? 1 : movementCost(state, neighbor);
      if (!Number.isFinite(terrainCost)) continue;
      if (!insideOwnCity && cityKeys.has(key)) continue;
      if (unitKeys.has(key)) continue;
      const nextCost = currentCost + terrainCost;
      if (nextCost > movement) continue;
      if (costs.has(key) && costs.get(key)! <= nextCost) continue;
      costs.set(key, nextCost);
      coords.set(key, neighbor);
      frontier.push(neighbor);
    }
  }

  return [...coords.entries()]
    .filter(([key]) => key !== gridKey(start) && !cityKeys.has(key))
    .map(([, coord]) => coord)
    .sort((a, b) => a.q - b.q || a.r - b.r);
}

function assertUnitTurn(state: GameState, forceId: ForceId, unitId: string): ArmyUnit {
  const unit = state.units[unitId];
  if (!unit) throw new Error('部队不存在');
  if (unit.forceId !== forceId) throw new Error('只能操作己方部队');
  if (unit.acted) throw new Error('部队已经行动');
  return unit;
}

function damageRoll(state: GameState, attacker: ArmyUnit, defenderTerrain: TerrainType, counter = false) {
  const officer = state.officers[attacker.leaderId];
  const roll = nextRandom(state.seed, state.rngCursor);
  state.rngCursor = roll.cursor;
  const attackScore = attacker.troops * (0.08 + officer.stats.leadership / 2000 + officer.stats.war / 3000);
  const rawDamage = 240 + attackScore;
  const randomModifier = 0.92 + roll.value * 0.16;
  const damage = Math.round(rawDamage * TERRAIN_DEFENSE[defenderTerrain] * randomModifier * (counter ? 0.6 : 1));
  return Math.min(2200, Math.max(120, damage));
}

function unitTerrain(state: GameState, unit: ArmyUnit) {
  return cellAt(state, unit)?.terrain ?? 'plain';
}

function removeUnit(next: GameState, unit: ArmyUnit) {
  const officer = next.officers[unit.leaderId];
  delete next.units[unit.id];
  const retreatCity = Object.values(next.cities).find((city) => city.ownerId === unit.forceId);
  officer.location = retreatCity ? { kind: 'city', cityId: retreatCity.id } : { kind: 'unaffiliated', cityId: unit.homeCityId };
  officer.cityId = officer.location.cityId;
  officer.acted = false;
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

export function movementCells(state: GameState, unitId: string): GridCoord[] {
  const unit = state.units[unitId];
  if (!unit || unit.moved || unit.movementRemaining <= 0) return [];
  return [...reachableCosts(state, unit).entries()]
    .filter(([key]) => key !== gridKey(unit))
    .map(([key]) => {
      const [q, r] = key.split(',').map(Number);
      return { q, r };
    })
    .sort((a, b) => a.q - b.q || a.r - b.r);
}

export function deployUnit(state: GameState, forceId: ForceId, input: DeployInput): GameState {
  const city = state.cities[input.cityId];
  const target = input.targetCityId ? state.cities[input.targetCityId] : undefined;
  const officer = state.officers[input.officerId];
  if (state.phase !== 'playing') throw new Error('游戏已经结束');
  if (state.turnForceId !== forceId) throw new Error('不是当前势力回合');
  if (!city || city.ownerId !== forceId) throw new Error('只能从己方城市出征');
  if (input.targetCityId && !target) throw new Error('目标城市不存在');
  if (!officer || officer.forceId !== forceId || officer.location.kind !== 'city' || officer.location.cityId !== city.id) {
    throw new Error('武将不在出征城市');
  }
  if (officer.acted) throw new Error('武将已经行动');
  if (state.actionPoints[forceId] < DEPLOY_AP_COST) throw new Error('行动力不足 20');
  if (!Number.isInteger(input.troops) || input.troops < 1000 || input.troops > 10000) throw new Error('出征兵力必须为 1000-10000');
  if (!Number.isInteger(input.food) || input.food < 0 || input.food > city.food) throw new Error('粮草不足');
  if (city.troops - input.troops < 500) throw new Error('城市至少保留 500 兵力');

  const spawn = input.destination ?? (target ? spawnCellFor(state, city, target) : deploymentCells(state, input.cityId)[0]);
  if (!spawn) throw new Error('没有合法出生格');
  if (!deploymentCells(state, input.cityId).some((coord) => coord.q === spawn.q && coord.r === spawn.r)) {
    throw new Error('出征位置超出移动范围');
  }

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
    troopType: input.troopType ?? 'sword',
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
  next.units[unitId].movementRemaining = 0;
  next.units[unitId].moved = true;
  return next;
}

export function waitUnit(state: GameState, forceId: ForceId, unitId: string): GameState {
  assertUnitTurn(state, forceId, unitId);
  const next = structuredClone(state);
  next.units[unitId].acted = true;
  return next;
}

export function attackUnit(state: GameState, forceId: ForceId, attackerId: string, targetId: string): GameState {
  const attacker = assertUnitTurn(state, forceId, attackerId);
  const target = state.units[targetId];
  if (!target) throw new Error('目标部队不存在');
  if (target.forceId === forceId) throw new Error('不能攻击己方部队');
  if (attacker.energy < 10) throw new Error('气力不足');
  if (!areAdjacent(attacker, target)) throw new Error('目标不相邻');

  const next = structuredClone(state);
  const nextAttacker = next.units[attackerId];
  const nextTarget = next.units[targetId];
  const damage = Math.min(nextTarget.troops, damageRoll(next, nextAttacker, unitTerrain(next, nextTarget)));
  nextTarget.troops -= damage;
  nextAttacker.energy -= 10;
  nextAttacker.acted = true;

  if (nextTarget.troops <= 0) {
    removeUnit(next, nextTarget);
    return next;
  }

  if (areAdjacent(nextTarget, nextAttacker)) {
    const counterDamage = Math.min(nextAttacker.troops, damageRoll(next, nextTarget, unitTerrain(next, nextAttacker), true));
    nextAttacker.troops -= counterDamage;
    if (nextAttacker.troops <= 0) removeUnit(next, nextAttacker);
  }

  return next;
}

function isAdjacentToCity(city: City, unit: ArmyUnit) {
  return sevenCellCityFootprint(cityCenter(city)).some((coord) => areAdjacent(coord, unit));
}

export function attackCity(state: GameState, forceId: ForceId, attackerId: string, cityId: CityId): GameState {
  const attacker = assertUnitTurn(state, forceId, attackerId);
  const city = state.cities[cityId];
  if (!city) throw new Error('城市不存在');
  if (city.ownerId === forceId) throw new Error('不能攻击己方城市');
  if (attacker.energy < 10) throw new Error('气力不足');
  if (!isAdjacentToCity(city, attacker)) throw new Error('部队不在城市外围');

  const next = structuredClone(state);
  const nextAttacker = next.units[attackerId];
  const nextCity = next.cities[cityId];
  const damage = damageRoll(next, nextAttacker, 'plain');
  nextCity.troops = Math.max(0, nextCity.troops - Math.round(damage * 0.65));
  nextCity.durability = Math.max(0, nextCity.durability - Math.round(damage * 0.45));
  nextAttacker.energy -= 10;
  nextAttacker.acted = true;

  if (nextCity.troops === 0 || nextCity.durability === 0) {
    const oldOwner = nextCity.ownerId;
    nextCity.ownerId = forceId;
    nextCity.order = Math.max(0, nextCity.order - 20);
    nextCity.gold = Math.floor(nextCity.gold / 2);
    nextCity.food = Math.floor(nextCity.food / 2);
    nextCity.governorId = null;
    const garrison = Math.min(1000, Math.floor(nextAttacker.troops * 0.2));
    const transfer = Math.min(garrison, Math.max(0, nextAttacker.troops - 1));
    nextCity.troops = transfer;
    nextAttacker.troops -= transfer;
    nextCity.durability = Math.ceil(nextCity.maxDurability * 0.2);
    for (const officer of Object.values(next.officers)) {
      if (officer.forceId === oldOwner && officer.location.kind === 'city' && officer.location.cityId === cityId) {
        const retreat = Object.values(next.cities).find((candidate) => candidate.ownerId === oldOwner);
        officer.location = retreat ? { kind: 'city', cityId: retreat.id } : { kind: 'unaffiliated', cityId };
        officer.cityId = officer.location.cityId;
      }
    }
  }

  return next;
}
