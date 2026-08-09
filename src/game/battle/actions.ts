import { armamentsOf, TRANSPORT_MOVEMENT, TROOP_ARMAMENT, TROOP_LABELS, TROOP_MOVEMENT } from '../armaments';
import type { ArmyUnit, City, CityId, ForceId, GameState, GridCell, TerrainType, TroopType } from '../types';
import { nextRandom } from '../random';
import { territoryCityAt } from '../territory';
import { gridKey, neighborsOf, sevenCellCityFootprint, type GridCoord } from './grid';

const DEPLOY_AP_COST = 20;
export const BASE_MOVEMENT = TROOP_MOVEMENT.sword;
const DEFENSE_MIN_TROOPS = 1000;
const DEFENSE_MAX_TROOPS = 3000;

export type MovementProfile = TroopType | 'transport';

const INFANTRY_TERRAIN_COST: Record<TerrainType, number> = {
  road: 4,
  plain: 4,
  forest: 6,
  hill: 6,
  mountain: Number.POSITIVE_INFINITY,
  shallowWater: 6,
  deepWater: Number.POSITIVE_INFINITY,
};

const CAVALRY_TERRAIN_COST: Record<TerrainType, number> = {
  ...INFANTRY_TERRAIN_COST,
  forest: 8,
  shallowWater: 8,
};

const SIEGE_TERRAIN_COST: Record<TerrainType, number> = {
  ...INFANTRY_TERRAIN_COST,
  forest: 8,
  hill: 8,
  shallowWater: 8,
};

const TERRAIN_COST_BY_PROFILE: Record<MovementProfile, Record<TerrainType, number>> = {
  sword: INFANTRY_TERRAIN_COST,
  spear: INFANTRY_TERRAIN_COST,
  halberd: INFANTRY_TERRAIN_COST,
  crossbow: INFANTRY_TERRAIN_COST,
  transport: INFANTRY_TERRAIN_COST,
  cavalry: CAVALRY_TERRAIN_COST,
  siege: SIEGE_TERRAIN_COST,
};

const TERRAIN_DEFENSE: Record<TerrainType, number> = {
  road: 1,
  plain: 1,
  forest: 0.85,
  hill: 0.8,
  mountain: 1,
  shallowWater: 0.95,
  deepWater: 1,
};

export interface DeployInput {
  cityId: CityId;
  officerId?: string;
  officerIds?: string[];
  targetCityId?: CityId;
  troopType?: TroopType;
  destination?: GridCoord;
  troops: number;
  food: number;
}

export interface TransportInput {
  cityId: CityId;
  officerId: string;
  destination?: GridCoord;
  troops: number;
  gold: number;
  food: number;
}

export type TacticId =
  | 'spear-thrust'
  | 'spear-spiral'
  | 'spear-double'
  | 'halberd-hook'
  | 'halberd-sweep'
  | 'halberd-whirlwind'
  | 'crossbow-fire'
  | 'crossbow-pierce'
  | 'crossbow-volley'
  | 'cavalry-charge'
  | 'cavalry-breakthrough'
  | 'cavalry-rush';

export interface UnitTactic {
  id: TacticId;
  name: string;
  troopType: Exclude<TroopType, 'sword' | 'siege'>;
  cost: number;
  range: number;
  power: number;
}

const TACTICS: Record<TacticId, UnitTactic> = {
  'spear-thrust': { id: 'spear-thrust', name: '突刺', troopType: 'spear', cost: 15, range: 1, power: 1.18 },
  'spear-spiral': { id: 'spear-spiral', name: '螺旋突刺', troopType: 'spear', cost: 20, range: 1, power: 1.23 },
  'spear-double': { id: 'spear-double', name: '二段突刺', troopType: 'spear', cost: 25, range: 1, power: 1.27 },
  'halberd-hook': { id: 'halberd-hook', name: '熊手', troopType: 'halberd', cost: 15, range: 1, power: 1.18 },
  'halberd-sweep': { id: 'halberd-sweep', name: '横扫', troopType: 'halberd', cost: 20, range: 1, power: 1.23 },
  'halberd-whirlwind': { id: 'halberd-whirlwind', name: '旋风', troopType: 'halberd', cost: 30, range: 1, power: 1.27 },
  'crossbow-fire': { id: 'crossbow-fire', name: '火矢', troopType: 'crossbow', cost: 10, range: 2, power: 1.12 },
  'crossbow-pierce': { id: 'crossbow-pierce', name: '贯箭', troopType: 'crossbow', cost: 15, range: 2, power: 1.18 },
  'crossbow-volley': { id: 'crossbow-volley', name: '乱射', troopType: 'crossbow', cost: 25, range: 2, power: 1.22 },
  'cavalry-charge': { id: 'cavalry-charge', name: '突击', troopType: 'cavalry', cost: 15, range: 1, power: 1.4 },
  'cavalry-breakthrough': { id: 'cavalry-breakthrough', name: '突破', troopType: 'cavalry', cost: 20, range: 1, power: 1.45 },
  'cavalry-rush': { id: 'cavalry-rush', name: '突进', troopType: 'cavalry', cost: 25, range: 1, power: 1.5 },
};

const TACTICS_BY_TROOP: Partial<Record<TroopType, TacticId[]>> = {
  spear: ['spear-thrust', 'spear-spiral', 'spear-double'],
  halberd: ['halberd-hook', 'halberd-sweep', 'halberd-whirlwind'],
  crossbow: ['crossbow-fire', 'crossbow-pierce', 'crossbow-volley'],
  cavalry: ['cavalry-charge', 'cavalry-breakthrough', 'cavalry-rush'],
};

function cellAt(state: GameState, coord: GridCoord): GridCell | undefined {
  return state.grid.find((cell) => cell.q === coord.q && cell.r === coord.r);
}

function movementProfileForUnit(unit: Pick<ArmyUnit, 'kind' | 'troopType'>): MovementProfile {
  return unit.kind === 'transport' ? 'transport' : unit.troopType ?? 'sword';
}

export function movementAllowanceForProfile(profile: MovementProfile) {
  return profile === 'transport' ? TRANSPORT_MOVEMENT : TROOP_MOVEMENT[profile];
}

export function movementAllowanceForUnit(unit: Pick<ArmyUnit, 'kind' | 'troopType'>) {
  return movementAllowanceForProfile(movementProfileForUnit(unit));
}

function movementCost(state: GameState, coord: GridCoord, profile: MovementProfile = 'sword') {
  const cell = cellAt(state, coord);
  return cell ? TERRAIN_COST_BY_PROFILE[profile][cell.terrain] : Number.POSITIVE_INFINITY;
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

function isLegalUnitCell(state: GameState, coord: GridCoord, ignoredUnitId?: string, profile: MovementProfile = 'sword') {
  return Number.isFinite(movementCost(state, coord, profile)) &&
    !allCityKeys(state).has(gridKey(coord)) &&
    !occupiedUnitKeys(state, ignoredUnitId).has(gridKey(coord));
}

function distance(a: GridCoord, b: GridCoord) {
  return Math.abs(a.q - b.q) + Math.abs(a.r - b.r);
}

function areAdjacent(a: GridCoord, b: GridCoord) {
  return neighborsOf(a.q, a.r).some((coord) => coord.q === b.q && coord.r === b.r);
}

function unitAttackRange(unit: ArmyUnit) {
  return ['crossbow', 'siege'].includes(unit.troopType ?? 'sword') ? 2 : 1;
}

function gridDistanceWithin(from: GridCoord, to: GridCoord, maxDistance: number) {
  if (from.q === to.q && from.r === to.r) return 0;
  const seen = new Set<string>([gridKey(from)]);
  let frontier: GridCoord[] = [from];

  for (let distanceStep = 1; distanceStep <= maxDistance; distanceStep += 1) {
    const nextFrontier: GridCoord[] = [];
    for (const current of frontier) {
      for (const neighbor of neighborsOf(current.q, current.r)) {
        const key = gridKey(neighbor);
        if (seen.has(key)) continue;
        if (neighbor.q === to.q && neighbor.r === to.r) return distanceStep;
        seen.add(key);
        nextFrontier.push(neighbor);
      }
    }
    frontier = nextFrontier;
  }

  return Number.POSITIVE_INFINITY;
}

function isUnitInAttackRange(attacker: ArmyUnit, target: ArmyUnit) {
  return gridDistanceWithin(attacker, target, unitAttackRange(attacker)) <= unitAttackRange(attacker);
}

function isCityInAttackRange(attacker: ArmyUnit, city: City) {
  const range = unitAttackRange(attacker);
  return sevenCellCityFootprint(cityCenter(city)).some((coord) => (
    gridDistanceWithin(attacker, coord, range) <= range
  ));
}

function isActionableFriendlyUnit(unit: ArmyUnit, forceId: ForceId) {
  return unit.forceId === forceId && unit.kind !== 'transport' && !unit.moved && !unit.acted && unit.movementRemaining > 0;
}

function cityCenter(city: City): GridCoord {
  return { q: city.gridQ, r: city.gridR };
}

function spawnCellFor(state: GameState, city: City, target: City, profile: MovementProfile = 'sword') {
  const cityKeys = new Set(sevenCellCityFootprint(cityCenter(city)).map(gridKey));
  const candidates = new Map<string, GridCoord>();
  for (const coord of sevenCellCityFootprint(cityCenter(city))) {
    for (const neighbor of neighborsOf(coord.q, coord.r)) {
      const key = gridKey(neighbor);
      if (!cityKeys.has(key)) candidates.set(key, neighbor);
    }
  }
  return [...candidates.values()]
    .filter((coord) => isLegalUnitCell(state, coord, undefined, profile))
    .sort((a, b) => distance(a, cityCenter(target)) - distance(b, cityCenter(target)) || a.q - b.q || a.r - b.r)[0];
}

function availableDefenseOfficer(state: GameState, city: City) {
  return Object.values(state.officers)
    .filter((officer) => (
      officer.forceId === city.ownerId &&
      officer.location.kind === 'city' &&
      officer.location.cityId === city.id &&
      !officer.acted
    ))
    .sort((a, b) => (
      b.stats.leadership + b.stats.war - (a.stats.leadership + a.stats.war) ||
      a.id.localeCompare(b.id)
    ))[0];
}

function hasActiveDefenseUnit(state: GameState, city: City) {
  return Object.values(state.units).some((unit) => (
    unit.forceId === city.ownerId &&
    unit.homeCityId === city.id &&
    unit.id.startsWith(`defense-${city.id}-`)
  ));
}

function defenseSpawnCell(state: GameState, city: City, invader: GridCoord) {
  const adjacent = neighborsOf(invader.q, invader.r)
    .filter((coord) => isLegalUnitCell(state, coord, undefined, 'spear'))
    .sort((a, b) => distance(a, cityCenter(city)) - distance(b, cityCenter(city)) || a.q - b.q || a.r - b.r)[0];
  if (adjacent) return adjacent;

  return deploymentCells(state, city.id, undefined, 'spear')
    .sort((a, b) => distance(a, invader) - distance(b, invader) || a.q - b.q || a.r - b.r)[0];
}

function stateForceName(state: GameState, forceId: ForceId) {
  return state.forces[forceId]?.name ?? forceId;
}

export function dispatchTerritoryDefenseForForce(state: GameState, forceId: ForceId): GameState {
  for (const invader of Object.values(state.units).sort((a, b) => a.id.localeCompare(b.id))) {
    if (invader.forceId === forceId) continue;

    const invaderCell = cellAt(state, invader);
    if (!invaderCell) continue;

    const territoryCity = territoryCityAt(state, invaderCell);
    if (territoryCity.ownerId !== forceId) continue;
    if (hasActiveDefenseUnit(state, territoryCity)) continue;

    const officer = availableDefenseOfficer(state, territoryCity);
    if (!officer) continue;

    const troops = Math.min(DEFENSE_MAX_TROOPS, territoryCity.troops - 500);
    if (troops < DEFENSE_MIN_TROOPS) continue;

    const spawn = defenseSpawnCell(state, territoryCity, invader);
    if (!spawn) continue;

    const next = structuredClone(state);
    const unitId = `defense-${territoryCity.id}-${next.month}-${next.tenDay}-${officer.id}-${Object.keys(next.units).length + 1}`;
    next.cities[territoryCity.id].troops -= troops;
    next.officers[officer.id].acted = true;
    next.officers[officer.id].location = { kind: 'unit', unitId };
    next.units[unitId] = {
      id: unitId,
      kind: 'combat',
      forceId,
      leaderId: officer.id,
      homeCityId: territoryCity.id,
      troopType: 'spear',
      q: spawn.q,
      r: spawn.r,
      troops,
      food: troops * 2,
      energy: 100,
      movementRemaining: 0,
      moved: true,
      acted: false,
    };
    next.logs.push({
      id: `defense-${unitId}`,
      month: next.month,
      forceId,
      message: `${stateForceName(next, forceId)}军发现敌军进入${territoryCity.name}疆域，${officer.name}率军出防`,
    });
    return next;
  }

  return state;
}

export function deploymentCells(state: GameState, cityId: CityId, movement?: number, profile: MovementProfile = 'sword'): GridCoord[] {
  const city = state.cities[cityId];
  if (!city) return [];
  const movementBudget = movement ?? movementAllowanceForProfile(profile);
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
      const terrainCost = movementCost(state, neighbor, profile);
      if (!Number.isFinite(terrainCost)) continue;
      if (!insideOwnCity && cityKeys.has(key)) continue;
      if (unitKeys.has(key)) continue;
      const nextCost = currentCost + terrainCost;
      if (nextCost > movementBudget) continue;
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
  const officerIds = unit.officerIds ?? [unit.leaderId];
  delete next.units[unit.id];
  const retreatCity = Object.values(next.cities).find((city) => city.ownerId === unit.forceId);
  for (const officerId of officerIds) {
    const officer = next.officers[officerId];
    if (!officer) continue;
    officer.location = retreatCity ? { kind: 'city', cityId: retreatCity.id } : { kind: 'unaffiliated', cityId: unit.homeCityId };
    officer.cityId = officer.location.cityId;
    officer.acted = false;
  }
}

function reachableCosts(state: GameState, unit: ArmyUnit) {
  const startKey = gridKey(unit);
  const profile = movementProfileForUnit(unit);
  const costs = new Map<string, number>([[startKey, 0]]);
  const frontier: GridCoord[] = [{ q: unit.q, r: unit.r }];

  while (frontier.length > 0) {
    const current = frontier.shift()!;
    const currentCost = costs.get(gridKey(current))!;
    for (const neighbor of neighborsOf(current.q, current.r)) {
      if (!isLegalUnitCell(state, neighbor, unit.id, profile)) continue;
      const nextCost = currentCost + movementCost(state, neighbor, profile);
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

export function attackableUnits(state: GameState, attackerId: string, origin?: GridCoord): ArmyUnit[] {
  const attacker = state.units[attackerId];
  if (!attacker || attacker.kind === 'transport') return [];
  const attackerAtOrigin = origin ? { ...attacker, q: origin.q, r: origin.r } : attacker;
  return Object.values(state.units)
    .filter((unit) => unit.id !== attacker.id && unit.forceId !== attacker.forceId && isUnitInAttackRange(attackerAtOrigin, unit))
    .sort((a, b) => (
      gridDistanceWithin(attackerAtOrigin, a, unitAttackRange(attackerAtOrigin)) - gridDistanceWithin(attackerAtOrigin, b, unitAttackRange(attackerAtOrigin)) ||
      a.id.localeCompare(b.id)
    ));
}

export function attackableCities(state: GameState, attackerId: string, origin?: GridCoord): City[] {
  const attacker = state.units[attackerId];
  if (!attacker || attacker.kind === 'transport') return [];
  const attackerAtOrigin = origin ? { ...attacker, q: origin.q, r: origin.r } : attacker;
  return Object.values(state.cities)
    .filter((city) => city.ownerId !== attacker.forceId && isCityInAttackRange(attackerAtOrigin, city))
    .sort((a, b) => (
      Math.min(...sevenCellCityFootprint(cityCenter(a)).map((coord) => gridDistanceWithin(attackerAtOrigin, coord, unitAttackRange(attackerAtOrigin)))) -
      Math.min(...sevenCellCityFootprint(cityCenter(b)).map((coord) => gridDistanceWithin(attackerAtOrigin, coord, unitAttackRange(attackerAtOrigin)))) ||
      a.id.localeCompare(b.id)
    ));
}

export function jointAttackableUnits(state: GameState, attackerId: string, origin?: GridCoord): ArmyUnit[] {
  const attacker = state.units[attackerId];
  if (!attacker || attacker.kind === 'transport') return [];
  const attackerAtOrigin = origin ? { ...attacker, q: origin.q, r: origin.r } : attacker;
  return Object.values(state.units)
    .filter((target) => (
      target.forceId !== attacker.forceId &&
      areAdjacent(attackerAtOrigin, target) &&
      Object.values(state.units).some((ally) => (
        ally.id !== attacker.id &&
        isActionableFriendlyUnit(ally, attacker.forceId) &&
        areAdjacent(ally, target)
      ))
    ))
    .sort((a, b) => (
      gridDistanceWithin(attackerAtOrigin, a, 1) - gridDistanceWithin(attackerAtOrigin, b, 1) ||
      a.id.localeCompare(b.id)
    ));
}

export function unitTactics(state: GameState, unitId: string): UnitTactic[] {
  const unit = state.units[unitId];
  if (!unit || unit.kind === 'transport') return [];
  return (TACTICS_BY_TROOP[unit.troopType ?? 'sword'] ?? []).map((id) => TACTICS[id]);
}

export function tacticTargetUnits(state: GameState, attackerId: string, tacticId: TacticId, origin?: GridCoord): ArmyUnit[] {
  const attacker = state.units[attackerId];
  const tactic = TACTICS[tacticId];
  if (!attacker || attacker.kind === 'transport' || !tactic || tactic.troopType !== (attacker.troopType ?? 'sword')) return [];
  const attackerAtOrigin = origin ? { ...attacker, q: origin.q, r: origin.r } : attacker;
  return Object.values(state.units)
    .filter((unit) => (
      unit.id !== attacker.id &&
      unit.forceId !== attacker.forceId &&
      gridDistanceWithin(attackerAtOrigin, unit, tactic.range) <= tactic.range
    ))
    .sort((a, b) => (
      gridDistanceWithin(attackerAtOrigin, a, tactic.range) - gridDistanceWithin(attackerAtOrigin, b, tactic.range) ||
      a.id.localeCompare(b.id)
    ));
}

function doubledRow(coord: GridCoord) {
  return coord.r * 2 + (coord.q % 2 === 0 ? -1 : 0);
}

function offsetRowFromDoubled(q: number, doubled: number) {
  const row = (doubled - (q % 2 === 0 ? -1 : 0)) / 2;
  return Number.isInteger(row) ? row : null;
}

function projectBeyond(from: GridCoord, through: GridCoord, scale = 1): GridCoord | null {
  const q = through.q + (through.q - from.q) * scale;
  const projectedDoubledRow = doubledRow(through) + (doubledRow(through) - doubledRow(from)) * scale;
  const r = offsetRowFromDoubled(q, projectedDoubledRow);
  return r === null ? null : { q, r };
}

function tryMoveUnit(next: GameState, unitId: string, destination: GridCoord) {
  if (!isLegalUnitCell(next, destination, unitId)) return false;
  next.units[unitId].q = destination.q;
  next.units[unitId].r = destination.r;
  return true;
}

function tacticAffectedUnits(next: GameState, attacker: ArmyUnit, target: ArmyUnit, tactic: UnitTactic): ArmyUnit[] {
  if (tactic.id === 'halberd-whirlwind') {
    return Object.values(next.units).filter((unit) => unit.forceId !== attacker.forceId && areAdjacent(attacker, unit));
  }
  if (tactic.id === 'halberd-sweep') {
    return Object.values(next.units)
      .filter((unit) => unit.forceId !== attacker.forceId && (unit.id === target.id || areAdjacent(target, unit)))
      .slice(0, 3);
  }
  if (tactic.id === 'crossbow-pierce') {
    const behind = projectBeyond(attacker, target);
    return Object.values(next.units)
      .filter((unit) => unit.id === target.id || (behind && unit.q === behind.q && unit.r === behind.r));
  }
  if (tactic.id === 'crossbow-volley') {
    return Object.values(next.units).filter((unit) => unit.id === target.id || gridDistanceWithin(target, unit, 1) <= 1);
  }
  return [target];
}

function applyTacticDamage(next: GameState, attacker: ArmyUnit, target: ArmyUnit, tactic: UnitTactic) {
  const nextAttacker = next.units[attacker.id];
  const nextTarget = next.units[target.id];
  if (!nextAttacker || !nextTarget) return;
  const damage = Math.min(nextTarget.troops, Math.round(damageRoll(next, nextAttacker, unitTerrain(next, nextTarget)) * tactic.power));
  nextTarget.troops -= damage;
  next.battleDamageReports ??= [];
  next.battleDamageReports.push({
    id: `tactic-${tactic.id}-${next.month}-${next.tenDay}-${next.rngCursor}-${target.id}`,
    unitId: target.id,
    q: nextTarget.q,
    r: nextTarget.r,
    amount: damage,
    kind: 'attack',
  });
  if (nextTarget.troops <= 0) removeUnit(next, nextTarget);
}

function applyTacticPositionEffect(next: GameState, attackerId: string, targetId: string, tactic: UnitTactic) {
  const attacker = next.units[attackerId];
  const target = next.units[targetId];
  if (!attacker || !target) return;

  if (tactic.id === 'spear-thrust') {
    const destination = projectBeyond(attacker, target);
    if (destination) tryMoveUnit(next, targetId, destination);
  } else if (tactic.id === 'spear-double') {
    const farDestination = projectBeyond(attacker, target, 2);
    const nearDestination = projectBeyond(attacker, target);
    if (farDestination && tryMoveUnit(next, targetId, farDestination)) return;
    if (nearDestination) tryMoveUnit(next, targetId, nearDestination);
  } else if (tactic.id === 'spear-spiral') {
    next.units[targetId].confusedTenDays = 1;
  } else if (tactic.id === 'crossbow-fire') {
    next.units[targetId].burningTenDays = 1;
  } else if (tactic.id === 'cavalry-charge') {
    const oldTarget = { q: target.q, r: target.r };
    const destination = projectBeyond(attacker, target);
    if (destination && tryMoveUnit(next, targetId, destination)) tryMoveUnit(next, attackerId, oldTarget);
  } else if (tactic.id === 'cavalry-breakthrough') {
    const destination = projectBeyond(attacker, target);
    if (destination) tryMoveUnit(next, attackerId, destination);
  } else if (tactic.id === 'cavalry-rush') {
    const oldTarget = { q: target.q, r: target.r };
    const farDestination = projectBeyond(attacker, target, 2);
    const nearDestination = projectBeyond(attacker, target);
    if ((farDestination && tryMoveUnit(next, targetId, farDestination)) || (nearDestination && tryMoveUnit(next, targetId, nearDestination))) {
      tryMoveUnit(next, attackerId, oldTarget);
    }
  } else if (tactic.id === 'halberd-hook') {
    const attackerBack = projectBeyond(target, attacker);
    const oldAttacker = { q: attacker.q, r: attacker.r };
    if (attackerBack && tryMoveUnit(next, attackerId, attackerBack)) tryMoveUnit(next, targetId, oldAttacker);
  }
}

export function useUnitTactic(state: GameState, forceId: ForceId, attackerId: string, targetId: string, tacticId: TacticId): GameState {
  const attacker = assertUnitTurn(state, forceId, attackerId);
  const target = state.units[targetId];
  const tactic = TACTICS[tacticId];
  if (!target) throw new Error('目标部队不存在');
  if (!tactic || tactic.troopType !== (attacker.troopType ?? 'sword')) throw new Error('部队不能使用该战法');
  if (attacker.energy < tactic.cost) throw new Error('气力不足');
  if (!tacticTargetUnits(state, attackerId, tacticId).some((unit) => unit.id === targetId)) throw new Error('目标不在战法范围');

  const next = structuredClone(state);
  next.battleDamageReports = [];
  const nextAttacker = next.units[attackerId];
  const nextTarget = next.units[targetId];
  const affected = tacticAffectedUnits(next, nextAttacker, nextTarget, tactic);
  for (const affectedUnit of affected) applyTacticDamage(next, nextAttacker, affectedUnit, tactic);
  if (next.units[targetId]) applyTacticPositionEffect(next, attackerId, targetId, tactic);
  if (next.units[attackerId]) {
    next.units[attackerId].energy -= tactic.cost;
    next.units[attackerId].acted = true;
  }
  return next;
}

export function deployUnit(state: GameState, forceId: ForceId, input: DeployInput): GameState {
  const city = state.cities[input.cityId];
  const target = input.targetCityId ? state.cities[input.targetCityId] : undefined;
  const officerIds = input.officerIds?.length ? input.officerIds : input.officerId ? [input.officerId] : [];
  const leaderId = officerIds[0];
  const officers = officerIds.map((officerId) => state.officers[officerId]);
  const officer = leaderId ? state.officers[leaderId] : undefined;
  const troopType = input.troopType ?? 'sword';
  const armamentType = TROOP_ARMAMENT[troopType];
  const cityArmaments = armamentsOf(city?.armaments);
  if (state.phase !== 'playing') throw new Error('游戏已经结束');
  if (state.turnForceId !== forceId) throw new Error('不是当前势力回合');
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
  if (!Number.isInteger(input.food) || input.food < 0 || input.food > city.food) throw new Error('粮草不足');
  if (city.troops - input.troops < 500) throw new Error('城市至少保留 500 兵力');
  if (armamentType && cityArmaments[armamentType] < input.troops) {
    throw new Error(`${TROOP_LABELS[troopType]}兵装不足`);
  }

  const spawn = input.destination ?? (target ? spawnCellFor(state, city, target, troopType) : deploymentCells(state, input.cityId, undefined, troopType)[0]);
  if (!spawn) throw new Error('没有合法出生格');
  if (!deploymentCells(state, input.cityId, undefined, troopType).some((coord) => coord.q === spawn.q && coord.r === spawn.r)) {
    throw new Error('出征位置超出移动范围');
  }

  const next = structuredClone(state);
  const unitId = `unit-${next.month}-${next.tenDay}-${leaderId}-${Object.keys(next.units).length + 1}`;
  next.cities[input.cityId].troops -= input.troops;
  next.cities[input.cityId].food -= input.food;
  if (armamentType) {
    next.cities[input.cityId].armaments = {
      ...cityArmaments,
      [armamentType]: cityArmaments[armamentType] - input.troops,
    };
  }
  next.actionPoints[forceId] -= DEPLOY_AP_COST;
  for (const officerId of officerIds) {
    next.officers[officerId].acted = true;
    next.officers[officerId].location = { kind: 'unit', unitId };
  }
  next.units[unitId] = {
    id: unitId,
    kind: 'combat',
    forceId,
    leaderId,
    officerIds: [...officerIds],
    homeCityId: input.cityId,
    troopType,
    q: spawn.q,
    r: spawn.r,
    troops: input.troops,
    food: input.food,
    energy: 100,
    movementRemaining: movementAllowanceForProfile(troopType),
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

export function deployTransportUnit(state: GameState, forceId: ForceId, input: TransportInput): GameState {
  const city = state.cities[input.cityId];
  const officer = state.officers[input.officerId];
  if (state.phase !== 'playing') throw new Error('游戏已经结束');
  if (state.turnForceId !== forceId) throw new Error('不是当前势力回合');
  if (!city || city.ownerId !== forceId) throw new Error('只能从己方城市输送');
  if (!officer || officer.forceId !== forceId || officer.location.kind !== 'city' || officer.location.cityId !== city.id) {
    throw new Error('武将不在输送城市');
  }
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
    id: unitId,
    kind: 'transport',
    forceId,
    leaderId: input.officerId,
    homeCityId: input.cityId,
    gold: input.gold,
    q: spawn.q,
    r: spawn.r,
    troops: input.troops,
    food: input.food,
    energy: 100,
    movementRemaining: movementAllowanceForProfile('transport'),
    moved: true,
    acted: false,
  };
  next.logs.push({
    id: `transport-${unitId}`,
    month: next.month,
    forceId,
    message: `${officer.name}从${city.name}输送物资`,
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
  if (!attackableUnits(state, attackerId).some((unit) => unit.id === targetId)) throw new Error('目标不在攻击范围');

  const next = structuredClone(state);
  const nextAttacker = next.units[attackerId];
  const nextTarget = next.units[targetId];
  const damage = Math.min(nextTarget.troops, damageRoll(next, nextAttacker, unitTerrain(next, nextTarget)));
  const reports = [{
    id: `damage-${next.month}-${next.tenDay}-${next.rngCursor}-${targetId}`,
    unitId: targetId,
    q: nextTarget.q,
    r: nextTarget.r,
    amount: damage,
    kind: 'attack' as const,
  }];
  nextTarget.troops -= damage;
  nextAttacker.energy -= 10;
  nextAttacker.acted = true;
  next.battleDamageReports = reports;

  if (nextTarget.troops <= 0) {
    removeUnit(next, nextTarget);
    return next;
  }

  if (areAdjacent(nextTarget, nextAttacker)) {
    const counterDamage = Math.min(nextAttacker.troops, damageRoll(next, nextTarget, unitTerrain(next, nextAttacker), true));
    next.battleDamageReports.push({
      id: `damage-${next.month}-${next.tenDay}-${next.rngCursor}-${attackerId}`,
      unitId: attackerId,
      q: nextAttacker.q,
      r: nextAttacker.r,
      amount: counterDamage,
      kind: 'counter',
    });
    nextAttacker.troops -= counterDamage;
    if (nextAttacker.troops <= 0) removeUnit(next, nextAttacker);
  }

  return next;
}

export function attackCity(state: GameState, forceId: ForceId, attackerId: string, cityId: CityId): GameState {
  const attacker = assertUnitTurn(state, forceId, attackerId);
  const city = state.cities[cityId];
  if (!city) throw new Error('城市不存在');
  if (city.ownerId === forceId) throw new Error('不能攻击己方城市');
  if (attacker.energy < 10) throw new Error('气力不足');
  if (!isCityInAttackRange(attacker, city)) throw new Error('城市不在攻击范围');

  const next = structuredClone(state);
  const nextAttacker = next.units[attackerId];
  const nextCity = next.cities[cityId];
  const damage = damageRoll(next, nextAttacker, 'plain');
  const durabilityMultiplier = (nextAttacker.troopType ?? 'sword') === 'siege' ? 1.4 : 0.2;
  nextCity.troops = Math.max(0, nextCity.troops - Math.round(damage * 0.65));
  nextCity.durability = Math.max(0, nextCity.durability - Math.round(damage * durabilityMultiplier));
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
