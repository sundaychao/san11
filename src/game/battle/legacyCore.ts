import type { AptitudeGrade, ArmyUnit, City, CityId, Facility, FacilityRepairReport, FacilityType, ForceId, GameState, StrategyResultReport, TerrainType, TroopType } from '../types';
import { BLOCKED_TERRAINS, isWaterTerrain } from './catalog';
import { nextRandom } from '../random';
import { TECHP_PER_BREAK_UNIT, techLevelOf, troopDamageMultiplier, addTechP } from '../techs';
import { complexHandlerById } from '../skills/handlers';
import { effectsOfKind, resolveOfficerSkills, resolveUnitSkills } from '../skills';
import {
  absorbTroopsOnCritical,
  breakUnitEnergyRecovery,
  drainTargetEnergyBySkills,
  fireDamageMultiplierOf,
  rangedTargetBlockedByForest,
  recoverEnergyOnTacticHit,
  reduceIncomingDamageBySkills,
  rollNoCounterAttack,
  tacticConfusesTarget,
  tacticCriticalMode,
} from '../skills/rules/combat';
import { facilityBuildPowerMultiplier } from '../skills/rules/facility';
import { resolveStrategySkillRules } from '../skills/rules/strategy';
import { territoryCityAt } from '../territory';
import { hasCityTrait } from '../cityTraits';
import { captureOfficersOnDestroy, captureCityOnCapture } from '../captives';
import { treasureDefinition } from '../treasures';
import { coordsWithinRange, gridKey, isSameCoord, neighborsOf, sevenCellCityFootprint, type GridCoord } from './grid';
import { isInAnyCityAttackRange } from '../innerAffairs';
import { AURA_ATTACK_MULTIPLIER, AURA_DEFENSE_MULTIPLIER, unitUnderAura } from './aura';
import { committedTroops } from './frontline';
import { applyImmediateFireDamageToCityAndPlot } from './fire';
import { allCityKeys, cellAt, cityCenter, deploymentCells, isLegalUnitCell, occupiedFacilityKeys, occupiedUnitKeys, reachableCosts, spawnCellFor, unitIsIncapacitated } from './movementRules';
import { areAdjacent, attackableCities, attackableFacilities, attackableUnits, gridDistanceWithin, isCityInAttackRange, jointAttackableUnits } from './targetRules';
import { effectiveNavyAptitude, effectiveUnitAbilities, fireStrategySuccessChance, harmfulStrategySuccessChance, maxTacticTier, tacticCriticalChance } from './officerAbilities';
import {
  ARROW_TOWER_DAMAGE,
  DEFENSE_MAX_TROOPS,
  DEFENSE_MIN_TROOPS,
  DRUM_DAMAGE_MULTIPLIER,
  movementAllowanceForUnit,
  FACILITIES,
  FACILITY_BUILD_COSTS,
  FACILITY_BUILD_DURABILITY_PER_TEN_THOUSAND,
  FIRE_BALL_DAMAGE,
  FIRE_FACILITY_DAMAGE,
  FIRE_PLOT_DAMAGE,
  FIRE_SEED_DAMAGE,
  FORTRESS_DAMAGE_MULTIPLIER,
  FORTRESS_RANGE,
  FORTRESS_SUPPLY_MULTIPLIER,
  NAVAL_TACTIC_IDS,
  PUBLIC_REPAIRABLE_FACILITY_TYPES,
  SPACING_LIMITED_FACILITY_TYPES,
  SHIP_WATER_ATTACK_MULTIPLIER,
  SHIP_WATER_DEFENSE_MULTIPLIER,
  STRATEGIES,
  TACTIC_APTITUDE_DAMAGE,
  TACTIC_REQUIRED_APTITUDE,
  TACTICS,
  TACTICS_BY_TROOP,
  TERRAIN_DEFENSE,
  TROOP_LABEL,
} from './catalog';
import type { MovementProfile, StrategyId, StrategySelection, TacticId, UnitFacility, UnitStrategy, UnitTactic } from './catalog';

export {
  BASE_MOVEMENT,
  DEPLOY_AP_COST,
  FACILITY_BUILD_COSTS,
  movementAllowanceForProfile,
  movementAllowanceForUnit,
} from './catalog';
export type { MovementProfile, StrategyId, StrategySelection, TacticId, UnitFacility, UnitStrategy, UnitTactic } from './catalog';
export { deploymentCells, movementCells, reachableCosts, spawnCellFor, unitIsIncapacitated } from './movementRules';
export { areAdjacent, attackableCities, attackableFacilities, attackableUnits, gridDistanceWithin, isCityInAttackRange, jointAttackableUnits } from './targetRules';

export interface DeployInput {
  cityId: CityId;
  officerId?: string;
  officerIds?: string[];
  targetCityId?: CityId;
  troopType?: TroopType;
  vehicle?: 'boat' | 'ship';
  siegeWeapon?: 'ram' | 'tower';
  destination?: GridCoord;
  troops: number;
  gold?: number;
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

function facilityAt(state: GameState, coord: GridCoord): Facility | undefined {
  return Object.values(state.facilities ?? {}).find((facility) => facility.q === coord.q && facility.r === coord.r);
}

function facilityDefinition(type: FacilityType) {
  return FACILITIES[type];
}

export function facilityIsCompleted(facility: Facility) {
  return facility.completed !== false;
}

function facilityBuildPower(state: GameState, unit: ArmyUnit) {
  const basePower = Math.max(1, Math.ceil((unit.troops / 10000) * FACILITY_BUILD_DURABILITY_PER_TEN_THOUSAND));
  return basePower * facilityBuildPowerMultiplier(state, unit);
}

function repairFacilityDurability(facility: Facility, amount: number) {
  const definition = facilityDefinition(facility.type);
  if (!definition) return facility;
  const durability = Math.min(definition.durability, facility.durability + amount);
  return {
    ...facility,
    durability,
    completed: durability >= definition.durability,
  };
}

function repairedDurabilityAmount(facility: Facility, amount: number) {
  const definition = facilityDefinition(facility.type);
  if (!definition) return 0;
  return Math.max(0, Math.min(definition.durability, facility.durability + amount) - facility.durability);
}

function addFacilityRepairReport(next: GameState, facility: Facility, amount: number, kind: FacilityRepairReport['kind']) {
  next.facilityRepairReports = [{
    id: `facility-repair-${next.month}-${next.tenDay}-${facility.id}`,
    facilityId: facility.id,
    q: facility.q,
    r: facility.r,
    amount,
    kind,
  }];
}

function isSpacingLimitedFacility(type: FacilityType) {
  return SPACING_LIMITED_FACILITY_TYPES.has(type);
}

function isInLimitedFacilitySpacing(state: GameState, coord: GridCoord, facilityType: FacilityType) {
  if (!isSpacingLimitedFacility(facilityType)) return false;
  return Object.values(state.facilities ?? {}).some((facility) => (
    isSpacingLimitedFacility(facility.type) &&
    coordsWithinRange(facility, 2).some((cell) => cell.q === coord.q && cell.r === coord.r)
  ));
}

function isBuildableFacilityCell(state: GameState, coord: GridCoord, facilityType?: FacilityType) {
  const cell = cellAt(state, coord);
  if (!cell || BLOCKED_TERRAINS.has(cell.terrain) || isWaterTerrain(cell.terrain)) return false;
  const key = gridKey(coord);
  return !allCityKeys(state).has(key) &&
    !occupiedUnitKeys(state).has(key) &&
    !occupiedFacilityKeys(state).has(key) &&
    !isInAnyCityAttackRange(state, coord.q, coord.r) &&
    (!facilityType || !isInLimitedFacilitySpacing(state, coord, facilityType));
}

function distance(a: GridCoord, b: GridCoord) {
  return Math.abs(a.q - b.q) + Math.abs(a.r - b.r);
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

export function assertUnitTurn(state: GameState, forceId: ForceId, unitId: string): ArmyUnit {
  const unit = state.units[unitId];
  if (!unit) throw new Error('部队不存在');
  if (unit.forceId !== forceId) throw new Error('只能操作己方部队');
  if (unit.acted) throw new Error('部队已经行动');
  if (unit.confusedTenDays) throw new Error('部队混乱中，无法行动');
  if (unit.falseReportedTenDays) throw new Error('部队伪报中，无法行动');
  return unit;
}

function facilityDamageMultiplier(state: GameState, attacker: ArmyUnit) {
  const boosted = Object.values(state.facilities ?? {}).some((facility) => (
    facility.type === 'drum' &&
    facilityIsCompleted(facility) &&
    facility.forceId === attacker.forceId &&
    gridDistanceWithin(facility, attacker, 3) <= 3
  ));
  return boosted ? DRUM_DAMAGE_MULTIPLIER : 1;
}

export function unitIsProtectedByFortress(state: GameState, unit: ArmyUnit) {
  return Object.values(state.facilities ?? {}).some((facility) => (
    facility.type === 'fortress' &&
    facilityIsCompleted(facility) &&
    facility.forceId === unit.forceId &&
    gridDistanceWithin(facility, unit, FORTRESS_RANGE) <= FORTRESS_RANGE
  ));
}

export function unitSupplyMultiplier(state: GameState, unit: ArmyUnit) {
  return unitIsProtectedByFortress(state, unit) ? FORTRESS_SUPPLY_MULTIPLIER : 1;
}

export function reduceUnitDamageByFortress(state: GameState, target: ArmyUnit, damage: number) {
  const multiplier = unitIsProtectedByFortress(state, target) ? FORTRESS_DAMAGE_MULTIPLIER : 1;
  return Math.min(target.troops, Math.max(0, Math.round(damage * multiplier)));
}

function damageForRoll(
  state: GameState,
  attacker: ArmyUnit,
  defenderTerrain: TerrainType,
  rollValue: number,
  counter = false,
  defender?: ArmyUnit,
) {
  const attack = effectiveUnitAbilities(state, attacker);
  const defenseLeadership = defender
    ? effectiveUnitAbilities(state, defender).leadership.value
    : attack.leadership.value;
  const leadershipModifier = Math.min(1.2, Math.max(
    0.8,
    1 + (attack.leadership.value - defenseLeadership) / 250,
  ));
  const attackScore = committedTroops(state, attacker, defender) * (
    0.08 + attack.leadership.value / 2000 + attack.war.value / 3000
  );
  const rawDamage = 240 + attackScore;
  const randomModifier = 0.92 + rollValue * 0.16;
  const attackerOnWater = isWaterTerrain(unitTerrain(state, attacker));
  const attackerShipModifier = attacker.vehicle === 'ship' && attackerOnWater ? SHIP_WATER_ATTACK_MULTIPLIER : 1;
  const defenderShipModifier = defender && defender.vehicle === 'ship' && isWaterTerrain(unitTerrain(state, defender))
    ? SHIP_WATER_DEFENSE_MULTIPLIER
    : 1;
  // 武将光环：统率90+/96+/100+ 的主将为周围（含自身）提供攻防加成
  const auraAttackModifier = unitUnderAura(state, attacker) ? AURA_ATTACK_MULTIPLIER : 1;
  const auraDefenseModifier = defender && unitUnderAura(state, defender) ? AURA_DEFENSE_MULTIPLIER : 1;
  const damage = Math.round(
    rawDamage *
    leadershipModifier *
    TERRAIN_DEFENSE[defenderTerrain] *
    randomModifier *
    facilityDamageMultiplier(state, attacker) *
    attackerShipModifier *
    defenderShipModifier *
    auraAttackModifier *
    auraDefenseModifier *
    (counter ? 0.6 : 1),
  );
  return Math.min(2200, Math.max(120, damage));
}

export function damageRoll(
  state: GameState,
  attacker: ArmyUnit,
  defenderTerrain: TerrainType,
  counter = false,
  defender?: ArmyUnit,
) {
  const roll = nextRandom(state.seed, state.rngCursor);
  state.rngCursor = roll.cursor;
  return damageForRoll(state, attacker, defenderTerrain, roll.value, counter, defender);
}

export function unitTerrain(state: GameState, unit: ArmyUnit) {
  return cellAt(state, unit)?.terrain ?? 'plain';
}

export function removeUnit(next: GameState, unit: ArmyUnit, looter?: ArmyUnit) {
  const officerIds = unit.officerIds ?? [unit.leaderId];
  if (looter && looter.id !== unit.id && looter.forceId !== unit.forceId) {
    const nextLooter = next.units[looter.id];
    if (nextLooter) {
      nextLooter.gold = (nextLooter.gold ?? 0) + Math.floor((unit.gold ?? 0) / 2);
      nextLooter.food += Math.floor(unit.food / 2);
    }
    // 击破敌军部队获得技巧P（精妙：双倍）
    if (looter.forceId) {
      const dbl = nextLooter && effectsOfKind(resolveUnitSkills(next, nextLooter), 'techPDoubleOnBreak').length > 0;
      addTechP(next, looter.forceId, TECHP_PER_BREAK_UNIT * (dbl ? 2 : 1));
    }
    // 昂扬：击破敌军后恢复气力
    if (nextLooter) breakUnitEnergyRecovery(next, nextLooter);
    // 强夺：击破敌军时夺取敌将宝物（归本方势力宝库）
    if (nextLooter && effectsOfKind(resolveUnitSkills(next, nextLooter), 'stealTreasureOnBreak').length > 0) {
      for (const officerId of officerIds) {
        const officer = next.officers[officerId];
        if (!officer?.treasureId) continue;
        const treasure = next.treasures?.[officer.treasureId];
        if (!treasure) continue;
        treasure.ownerId = looter.forceId;
        treasure.cityId = null;
        treasure.holderId = null;
        officer.treasureId = undefined;
        next.logs.push({
          id: `loot-${next.month}-${next.logs.length}`,
          month: next.month,
          forceId: looter.forceId,
          message: `击破敌军，夺取了${officer.name}的宝物「${treasureDefinition(treasure.id)?.name ?? treasure.id}」`,
        });
      }
    }
  }
  delete next.units[unit.id];
  // 被敌方部队击破：先判定战死，再按捕获率俘获敌将，未被俘者退回并概率负伤
  if (looter && looter.id !== unit.id && looter.forceId !== unit.forceId) {
    const { captured, dead } = captureOfficersOnDestroy(next, unit, looter);
    if (dead.length > 0) {
      next.logs.push({
        id: `death-destroy-${next.month}-${next.logs.length}`,
        month: next.month,
        forceId: null,
        message: `${dead.join('、')}所部覆灭，力战阵亡`,
      });
    }
    if (captured.length > 0) {
      next.logs.push({
        id: `capture-${next.month}-${next.logs.length}`,
        month: next.month,
        forceId: looter.forceId,
        message: `击破敌军部队，俘获${captured.join('、')}`,
      });
    }
    return;
  }
  const retreatCity = Object.values(next.cities).find((city) => city.ownerId === unit.forceId);
  for (const officerId of officerIds) {
    const officer = next.officers[officerId];
    if (!officer) continue;
    officer.location = retreatCity ? { kind: 'city', cityId: retreatCity.id } : { kind: 'unaffiliated', cityId: unit.homeCityId };
    officer.cityId = officer.location.cityId;
    officer.acted = false;
  }
}

function unitIsOnWater(state: GameState, unit: ArmyUnit) {
  return isWaterTerrain(unitTerrain(state, unit));
}

export function unitTactics(state: GameState, unitId: string): UnitTactic[] {
  const unit = state.units[unitId];
  if (!unit || unit.kind === 'transport') return [];
  if (unitIsOnWater(state, unit)) {
    return NAVAL_TACTIC_IDS.map((id) => TACTICS[id]);
  }
  return (TACTICS_BY_TROOP[unit.troopType ?? 'sword'] ?? []).map((id) => TACTICS[id]);
}

export function tacticTier(tacticId: TacticId): 1 | 2 | 3 {
  for (const tacticIds of Object.values(TACTICS_BY_TROOP)) {
    const index = tacticIds?.indexOf(tacticId) ?? -1;
    if (index >= 0) return (index + 1) as 1 | 2 | 3;
  }
  const navalIndex = NAVAL_TACTIC_IDS.indexOf(tacticId);
  if (navalIndex >= 0) return (navalIndex + 1) as 1 | 2 | 3;
  throw new Error('战法不存在');
}

export function requiredAptitudeForTactic(tacticId: TacticId): AptitudeGrade {
  return TACTIC_REQUIRED_APTITUDE[tacticTier(tacticId)];
}

export function unitCanUseTactic(state: GameState, unitId: string, tacticId: TacticId): boolean {
  const unit = state.units[unitId];
  const tactic = TACTICS[tacticId];
  if (!unit || (unit.kind ?? 'combat') !== 'combat' || !tactic) return false;
  const grade = tactic.troopType === 'naval'
    ? effectiveNavyAptitude(state, unit).grade
    : effectiveUnitAbilities(state, unit).aptitude.grade;
  if (tactic.troopType === 'naval') {
    if (!unitIsOnWater(state, unit)) return false;
  } else {
    if (tactic.troopType !== unit.troopType) return false;
    if (unitIsOnWater(state, unit)) return false;
  }
  return maxTacticTier(grade) >= tacticTier(tacticId);
}

export function tacticTargetUnits(state: GameState, attackerId: string, tacticId: TacticId, origin?: GridCoord): ArmyUnit[] {
  const attacker = state.units[attackerId];
  const tactic = TACTICS[tacticId];
  const attackerAtOrigin = origin ? { ...attacker, q: origin.q, r: origin.r } : attacker;
  if (!attacker || attacker.kind === 'transport' || !tactic) return [];
  if (tactic.troopType === 'naval') {
    if (!unitIsOnWater(state, attackerAtOrigin)) return [];
  } else {
    if (tactic.troopType !== (attacker.troopType ?? 'sword')) return [];
    if (unitIsOnWater(state, attackerAtOrigin)) return [];
  }
  const minRange = tacticId === 'crossbow-fire' || tacticId === 'crossbow-pierce' || tacticId === 'ship-fire' ? 2 : 1;
  return Object.values(state.units)
    .filter((unit) => {
      if (unit.id === attacker.id || unit.forceId === attacker.forceId) return false;
      const range = gridDistanceWithin(attackerAtOrigin, unit, tactic.range);
      return range >= minRange && range <= tactic.range;
    })
    // 射手：无射手特技时弩兵战法不能攻击森林中的目标
    .filter((unit) => (
      tactic.troopType !== 'crossbow' || !rangedTargetBlockedByForest(state, attackerAtOrigin, unit)
    ))
    .sort((a, b) => (
      gridDistanceWithin(attackerAtOrigin, a, tactic.range) - gridDistanceWithin(attackerAtOrigin, b, tactic.range) ||
      a.id.localeCompare(b.id)
    ));
}

export function tacticTargetFacilities(state: GameState, attackerId: string, tacticId: TacticId, origin?: GridCoord): Facility[] {
  const attacker = state.units[attackerId];
  const tactic = TACTICS[tacticId];
  if (!attacker || attacker.kind === 'transport' || !tactic) return [];
  if (tactic.troopType === 'naval') {
    if (!unitIsOnWater(state, origin ? { ...attacker, q: origin.q, r: origin.r } : attacker)) return [];
  } else {
    if (tactic.troopType !== (attacker.troopType ?? 'sword')) return [];
    if (unitIsOnWater(state, origin ? { ...attacker, q: origin.q, r: origin.r } : attacker)) return [];
  }
  if (tacticId !== 'crossbow-fire' && tacticId !== 'ship-fire') return [];
  const attackerAtOrigin = origin ? { ...attacker, q: origin.q, r: origin.r } : attacker;
  return Object.values(state.facilities ?? {})
    .filter((facility) => (
      facility.type === 'fireBall' &&
      facilityIsCompleted(facility) &&
      gridDistanceWithin(attackerAtOrigin, facility, tactic.range) === tactic.range
    ))
    .sort((a, b) => (
      gridDistanceWithin(attackerAtOrigin, a, tactic.range) - gridDistanceWithin(attackerAtOrigin, b, tactic.range) ||
      a.id.localeCompare(b.id)
    ));
}

export function firePlotCells(state: GameState, unitId: string, origin?: GridCoord): GridCoord[] {
  const unit = state.units[unitId];
  if (!unit) return [];
  const source = origin ?? unit;
  // 鬼谋：火计范围 +1
  const range = 1 + resolveStrategySkillRules(state, unit, undefined, 'fire', STRATEGIES.fire.cost).rangeBonus;
  return state.grid
    .filter((cell) => gridDistanceWithin(source, cell, range) <= range)
    .sort((a, b) => a.q - b.q || a.r - b.r);
}

export function unitFacilities(): UnitFacility[] {
  return Object.values(FACILITIES).filter((facility): facility is UnitFacility => Boolean(facility));
}

export function facilityBuildTargets(state: GameState, unitId: string, origin?: GridCoord, facilityType?: FacilityType): GridCoord[] {
  const unit = state.units[unitId];
  if (!unit) return [];
  if (facilityType && (unit.gold ?? 0) < FACILITY_BUILD_COSTS[facilityType]) return [];
  const source = origin ?? unit;
  return neighborsOf(source.q, source.r)
    .filter((coord) => isBuildableFacilityCell(state, coord, facilityType))
    .sort((a, b) => a.q - b.q || a.r - b.r);
}

export function repairableFacilities(state: GameState, unitId: string, origin?: GridCoord): Facility[] {
  const unit = state.units[unitId];
  if (!unit || unit.kind === 'transport') return [];
  const source = origin ? { ...unit, q: origin.q, r: origin.r } : unit;
  return Object.values(state.facilities ?? {})
    .filter((facility) => {
      const canRepairOwner = facility.forceId === unit.forceId || PUBLIC_REPAIRABLE_FACILITY_TYPES.has(facility.type);
      if (!canRepairOwner || facilityIsCompleted(facility) || gridDistanceWithin(source, facility, 1) > 1) return false;
      const definition = facilityDefinition(facility.type);
      return Boolean(definition && facility.durability < definition.durability);
    })
    .sort((a, b) => (
      gridDistanceWithin(source, a, 1) - gridDistanceWithin(source, b, 1) ||
      a.id.localeCompare(b.id)
    ));
}

function hasSameForceNeighbor(state: GameState, source: ArmyUnit) {
  return Object.values(state.units).some((unit) => (
    unit.id !== source.id &&
    unit.forceId === source.forceId &&
    areAdjacent(source, unit)
  ));
}

function friendlyAbnormal(unit: ArmyUnit) {
  return Boolean(unit.confusedTenDays || unit.falseReportedTenDays);
}

export function unitStrategies(): UnitStrategy[] {
  return Object.values(STRATEGIES);
}

/** 部队最高政治（主将+副将中 stats.politics 的最大值），用于出城初始战力与每旬战力回复 */
export function unitMaxPolitics(state: GameState, unit: ArmyUnit): number {
  const officerIds = unit.officerIds?.length ? unit.officerIds : [unit.leaderId];
  return officerIds.reduce((max, officerId) => Math.max(max, state.officers[officerId]?.stats.politics ?? 0), 0);
}

export function strategyEnergyCostForUnit(state: GameState, unitId: string, strategyId: StrategyId) {
  const unit = state.units[unitId];
  const strategy = STRATEGIES[strategyId];
  if (!unit || !strategy) throw new Error('部队不能使用该计略');
  return resolveStrategySkillRules(state, unit, undefined, strategyId, strategy.cost).energyCost;
}

export function strategyTargetCells(state: GameState, unitId: string, strategyId: StrategyId, origin?: GridCoord): GridCoord[] {
  const unit = state.units[unitId];
  if (!unit || unit.kind === 'transport') return [];
  const source = origin ? { ...unit, q: origin.q, r: origin.r } : unit;
  if (strategyId === 'fire') return firePlotCells(state, unitId, origin);
  if (strategyId !== 'extinguish') return [];

  const gridKeys = new Set(state.grid.map(gridKey));
  // 鬼谋：灭火范围 +1
  const range = 2 + resolveStrategySkillRules(state, unit, undefined, 'extinguish', STRATEGIES.extinguish.cost).rangeBonus;
  return (state.firePlots ?? [])
    .filter((plot) => gridKeys.has(gridKey(plot)) && gridDistanceWithin(source, plot, range) <= range)
    .sort((a, b) => gridDistanceWithin(source, a, range) - gridDistanceWithin(source, b, range) || a.q - b.q || a.r - b.r);
}

export function strategyTargetUnits(state: GameState, unitId: string, strategyId: StrategyId, origin?: GridCoord): ArmyUnit[] {
  const unit = state.units[unitId];
  if (!unit || unit.kind === 'transport') return [];
  const source = origin ? { ...unit, q: origin.q, r: origin.r } : unit;
  // 鬼谋：敌部队计略范围 +1
  const range = (strategyId === 'discord' ? 1 : 2)
    + resolveStrategySkillRules(state, unit, undefined, strategyId, STRATEGIES[strategyId].cost).rangeBonus;
  return Object.values(state.units)
    .filter((target) => {
      if (target.kind === 'transport') return false;
      if (gridDistanceWithin(source, target, range) > range) return false;
      if (strategyId === 'false-report' || strategyId === 'disturb') return target.forceId !== unit.forceId;
      if (strategyId === 'calm') return target.forceId === unit.forceId && friendlyAbnormal(target);
      if (strategyId === 'inspire') return target.forceId === unit.forceId && target.energy < 100;
      if (strategyId === 'discord') {
        return target.forceId !== unit.forceId && (target.troopType ?? 'sword') !== 'siege' && hasSameForceNeighbor(state, target);
      }
      return false;
    })
    .sort((a, b) => (
      gridDistanceWithin(source, a, range) - gridDistanceWithin(source, b, range) ||
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

function crossbowPierceMiddleUnit(state: GameState, attacker: ArmyUnit, target: ArmyUnit): ArmyUnit | null {
  if (areAdjacent(attacker, target)) return null;
  const straightCells = neighborsOf(attacker.q, attacker.r).filter((neighbor) => {
    const projected = projectBeyond(attacker, neighbor);
    return projected?.q === target.q && projected.r === target.r;
  });
  const targetNeighborKeys = new Set(neighborsOf(target.q, target.r).map(gridKey));
  const sharedCells = neighborsOf(attacker.q, attacker.r).filter((neighbor) => targetNeighborKeys.has(gridKey(neighbor)));
  const candidates = [...straightCells, ...sharedCells.filter((cell) => !straightCells.some((straight) => isSameCoord(straight, cell)))];

  for (const cell of candidates) {
    const middle = Object.values(state.units).find((unit) => (
      unit.id !== attacker.id &&
      unit.id !== target.id &&
      unit.q === cell.q &&
      unit.r === cell.r
    ));
    if (middle) return middle;
  }
  return null;
}

function tryMoveUnit(next: GameState, unitId: string, destination: GridCoord) {
  if (!isLegalUnitCell(next, destination, unitId)) return false;
  next.units[unitId].q = destination.q;
  next.units[unitId].r = destination.r;
  applyGroundFireDamageAfterForcedMove(next, unitId);
  return true;
}

function unitAtCoord(state: GameState, coord: GridCoord, excludedIds: string[] = []) {
  const excluded = new Set(excludedIds);
  return Object.values(state.units).find((unit) => (
    !excluded.has(unit.id) &&
    unit.q === coord.q &&
    unit.r === coord.r
  ));
}

function tacticAffectedUnits(next: GameState, attacker: ArmyUnit, target: ArmyUnit, tactic: UnitTactic): ArmyUnit[] {
  if (tactic.id === 'spear-thrust' || tactic.id === 'spear-double') {
    const rearCoord = projectBeyond(attacker, target);
    const rearUnit = rearCoord ? unitAtCoord(next, rearCoord, [attacker.id, target.id]) : undefined;
    return rearUnit ? [target, rearUnit] : [target];
  }
  if (tactic.id === 'halberd-whirlwind') {
    return Object.values(next.units).filter((unit) => unit.forceId !== attacker.forceId && areAdjacent(attacker, unit));
  }
  if (tactic.id === 'halberd-sweep') {
    return Object.values(next.units)
      .filter((unit) => (
        unit.id === target.id ||
        (unit.forceId === target.forceId && areAdjacent(target, unit) && areAdjacent(attacker, unit))
      ))
      .slice(0, 3);
  }
  if (tactic.id === 'crossbow-pierce') {
    const middle = crossbowPierceMiddleUnit(next, attacker, target);
    return Object.values(next.units)
      .filter((unit) => unit.id === target.id || unit.id === middle?.id);
  }
  if (tactic.id === 'crossbow-volley' || tactic.id === 'ship-whirl') {
    return Object.values(next.units).filter((unit) => unit.id === target.id || gridDistanceWithin(target, unit, 1) <= 1);
  }
  return [target];
}

// 科技：战法兵科伤害加成（枪/戟/弩/骑的训练与精锐）+ 骑兵2级马镫（按本旬已移动格数每格+4%）
function troopDamageMultiplierOfTactic(state: GameState, attacker: ArmyUnit, tactic: UnitTactic): number {
  if (!attacker.forceId) return 1;
  const troop = tactic.troopType;
  if (troop !== 'spear' && troop !== 'halberd' && troop !== 'crossbow' && troop !== 'cavalry') return 1;
  let multiplier = troopDamageMultiplier(state, attacker.forceId, troop);
  if (troop === 'cavalry' && techLevelOf(state, attacker.forceId, 'cavalry') >= 2) {
    const allowance = movementAllowanceForUnit(attacker);
    const movedCells = Math.max(0, allowance - (attacker.movementRemaining ?? 0));
    multiplier *= 1 + movedCells * 0.04;
  }
  return multiplier;
}

function applyTacticDamage(
  next: GameState,
  attacker: ArmyUnit,
  target: ArmyUnit,
  tactic: UnitTactic,
  aptitude: AptitudeGrade,
  critical: boolean,
) {
  const nextAttacker = next.units[attacker.id];
  const nextTarget = next.units[target.id];
  if (!nextAttacker || !nextTarget) return;
  // 科技：兵科训练/精锐伤害加成（枪/戟/弩/骑）
  const techMultiplier = troopDamageMultiplierOfTactic(next, nextAttacker, tactic);
  const modifiedDamage = Math.round(
    damageRoll(next, nextAttacker, unitTerrain(next, nextTarget), false, nextTarget) *
    tactic.power *
    TACTIC_APTITUDE_DAMAGE[aptitude] *
    techMultiplier *
    (critical ? 1.35 : 1),
  );
  const fortifiedDamage = reduceUnitDamageByFortress(next, nextTarget, modifiedDamage);
  const damage = reduceIncomingDamageBySkills(next, nextTarget, fortifiedDamage, 'tactic');
  nextTarget.troops -= damage;
  // 扫讨/威风：战法击中同样降低敌方气力；心攻：会心时吸收士兵；怒发：受战法后恢复气力
  drainTargetEnergyBySkills(next, nextAttacker, nextTarget);
  absorbTroopsOnCritical(next, nextAttacker, damage, critical);
  recoverEnergyOnTacticHit(next, nextTarget);
  next.battleDamageReports ??= [];
  next.battleDamageReports.push({
    id: `tactic-${tactic.id}-${next.month}-${next.tenDay}-${next.rngCursor}-${target.id}`,
    unitId: target.id,
    q: nextTarget.q,
    r: nextTarget.r,
    amount: damage,
    kind: 'attack',
    ...(critical ? { critical: true, label: '暴击' } : {}),
  });
  if (nextTarget.troops <= 0) removeUnit(next, nextTarget, nextAttacker);
}

function applyTacticPositionEffect(next: GameState, attackerId: string, targetId: string, tactic: UnitTactic) {
  const attacker = next.units[attackerId];
  const target = next.units[targetId];
  if (!attacker || !target) return;

  if (tactic.id === 'spear-thrust' || tactic.id === 'ship-ram') {
    const destination = projectBeyond(attacker, target);
    if (destination) tryMoveUnit(next, targetId, destination);
  } else if (tactic.id === 'spear-double') {
    const farDestination = projectBeyond(attacker, target, 2);
    const nearDestination = projectBeyond(attacker, target);
    if (!nearDestination || !isLegalUnitCell(next, nearDestination, targetId)) return;
    if (farDestination && tryMoveUnit(next, targetId, farDestination)) return;
    tryMoveUnit(next, targetId, nearDestination);
  } else if (tactic.id === 'spear-spiral') {
    next.units[targetId].confusedTenDays = 1;
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
  const tactic = TACTICS[tacticId];
  if (!tactic) throw new Error('部队不能使用该战法');
  if (tactic.troopType === 'naval') {
    if (!unitIsOnWater(state, attacker)) throw new Error('部队不在水域，无法使用水军战法');
  } else {
    if (unitIsOnWater(state, attacker)) throw new Error('水域中不能使用陆地战法');
    if (tactic.troopType !== (attacker.troopType ?? 'sword')) throw new Error('部队不能使用该战法');
  }
  if (!unitCanUseTactic(state, attackerId, tacticId)) {
    const troopLabel = tactic.troopType === 'naval' ? '水军' : TROOP_LABEL[attacker.troopType ?? 'sword'] ?? '部队';
    throw new Error(`需要${troopLabel}适性 ${requiredAptitudeForTactic(tacticId)}`);
  }
  const target = state.units[targetId];
  if (!target && (tacticId === 'crossbow-fire' || tacticId === 'ship-fire')) return useFireArrowFacilityTactic(state, attacker, targetId, tactic);
  if (!target) throw new Error('目标部队不存在');
  if ((attacker.stamina ?? 0) < tactic.cost) throw new Error('战力不足');
  if (!tacticTargetUnits(state, attackerId, tacticId).some((unit) => unit.id === targetId)) throw new Error('目标不在战法范围');

  const next = structuredClone(state);
  next.battleDamageReports = [];
  next.cityEffectReports = [];
  next.strategyResultReports = [];
  const nextAttacker = next.units[attackerId];
  const nextTarget = next.units[targetId];
  const abilities = effectiveUnitAbilities(next, nextAttacker);
  const aptitude = tactic.troopType === 'naval'
    ? effectiveNavyAptitude(next, nextAttacker).grade!
    : abilities.aptitude.grade!;
  const criticalMode = tacticCriticalMode(next, nextAttacker, nextTarget, tacticId);
  let critical = criticalMode === 'guaranteed';
  if (criticalMode === 'normal') {
    const criticalRoll = nextRandom(next.seed, next.rngCursor);
    next.rngCursor = criticalRoll.cursor;
    critical = criticalRoll.value < tacticCriticalChance(abilities.war.value, aptitude) / 100;
  }
  const affected = tacticAffectedUnits(next, nextAttacker, nextTarget, tactic);
  const fireArrowCells = tactic.id === 'crossbow-fire'
    ? affected.map((unit) => ({ q: unit.q, r: unit.r }))
    : [];
  for (const affectedUnit of affected) {
    applyTacticDamage(next, nextAttacker, affectedUnit, tactic, aptitude, critical);
  }
  if (tactic.id === 'ship-fire') {
    for (const affectedUnit of affected) {
      const burningUnit = next.units[affectedUnit.id];
      if (burningUnit) burningUnit.burningTenDays = 2;
    }
  }
  if (fireArrowCells.length > 0) igniteGroundFire(next, fireArrowCells, nextAttacker);
  if (next.units[targetId]) applyTacticPositionEffect(next, attackerId, targetId, tactic);
  if (next.units[targetId]) applyTacticCounterDamage(next, attackerId, targetId);
  // 疾走：骑兵战法攻击武力较低目标后令其混乱
  if (next.units[targetId] && next.units[attackerId]
    && tacticConfusesTarget(next, next.units[attackerId], next.units[targetId], tacticId)) {
    next.units[targetId].confusedTenDays = 1;
  }
  if (next.units[attackerId]) {
    // 科技：枪兵2级兵粮袭击——战法击中敌军时夺取其兵粮
    if (tactic.troopType === 'spear' && techLevelOf(next, forceId, 'spear') >= 2) {
      const lootTarget = next.units[targetId];
      if (lootTarget) {
        const loot = Math.min(lootTarget.food, Math.floor(lootTarget.food * 0.15) + 200);
        lootTarget.food -= loot;
        next.units[attackerId].food += loot;
      }
    }
    if (next.units[attackerId].stamina !== undefined) {
      next.units[attackerId].stamina = Math.max(0, next.units[attackerId].stamina - tactic.cost);
    }
    // 科技：骑兵3级游击——攻击后可再次行动（二动）
    if (!(tactic.troopType === 'cavalry' && techLevelOf(next, forceId, 'cavalry') >= 3)) {
      next.units[attackerId].acted = true;
    }
  }
  return next;
}

// 战法反伤比例：低于普攻但不为零，战法受击方可以反击，只是伤害更小
// 用固定中值掷点(rollValue=0.5)计算，不消耗RNG，便于战法结算保持确定性回放
const TACTIC_COUNTER_RATIO = 0.5;

function applyTacticCounterDamage(next: GameState, attackerId: string, targetId: string): void {
  const attacker = next.units[attackerId];
  const target = next.units[targetId];
  if (!attacker || !target) return;
  const attackerTerrain = unitTerrain(next, attacker);
  if (!areAdjacent(target, attacker) || rollNoCounterAttack(next, attacker, attackerTerrain)) return;
  const rolledCounterDamage = damageForRoll(next, target, unitTerrain(next, attacker), 0.5, true, attacker);
  const fortifiedCounterDamage = reduceUnitDamageByFortress(next, attacker, rolledCounterDamage);
  const counterDamage = Math.round(
    reduceIncomingDamageBySkills(next, attacker, fortifiedCounterDamage, 'counter') * TACTIC_COUNTER_RATIO,
  );
  if (counterDamage <= 0) return;
  next.battleDamageReports ??= [];
  next.battleDamageReports.push({
    id: `damage-${next.month}-${next.tenDay}-${next.rngCursor}-${attackerId}-tacticCounter`,
    unitId: attackerId, q: attacker.q, r: attacker.r, amount: counterDamage, kind: 'counter',
  });
  attacker.troops -= counterDamage;
  if (attacker.troops <= 0) removeUnit(next, attacker, target);
}

function useFireArrowFacilityTactic(state: GameState, attacker: ArmyUnit, facilityId: string, tactic: UnitTactic): GameState {
  const facility = state.facilities?.[facilityId];
  if (!facility || !tacticTargetFacilities(state, attacker.id, tactic.id).some((target) => target.id === facilityId)) {
    throw new Error('目标不在战法范围');
  }

  const next = structuredClone(state);
  next.battleDamageReports = [];
  next.cityEffectReports = [];
  next.strategyResultReports = [];
  const nextAttacker = next.units[attacker.id];
  const nextFacility = next.facilities?.[facilityId];
  if (!nextAttacker || !nextFacility || !igniteFacility(next, nextAttacker, nextFacility, nextAttacker)) {
    throw new Error('目标不在战法范围');
  }
  if (next.units[attacker.id]) {
    const stamina = next.units[attacker.id].stamina;
    if (stamina !== undefined) {
      next.units[attacker.id].stamina = Math.max(0, stamina - tactic.cost);
    }
    next.units[attacker.id].acted = true;
  }
  return next;
}

function spendStrategyCost(next: GameState, unitId: string, strategy: UnitStrategy) {
  const unit = next.units[unitId];
  if (!unit) return;
  if (unit.stamina !== undefined) {
    unit.stamina = Math.max(0, unit.stamina - strategy.cost);
  }
  unit.acted = true;
}

function strategyReport(
  state: GameState,
  unitId: string,
  strategy: UnitStrategy,
  target: GridCoord,
  succeeded: boolean,
): StrategyResultReport {
  return {
    id: `strategy-${strategy.id}-${state.month}-${state.tenDay}-${state.rngCursor}-${unitId}-${target.q}-${target.r}`,
    strategyId: strategy.id,
    q: target.q,
    r: target.r,
    label: succeeded ? strategy.name : '计略失败',
    succeeded,
  };
}

function discordVictim(next: GameState, target: ArmyUnit) {
  return Object.values(next.units)
    .filter((unit) => unit.id !== target.id && unit.forceId === target.forceId && areAdjacent(target, unit))
    .sort((a, b) => a.troops - b.troops || a.id.localeCompare(b.id))[0];
}

interface SuccessfulUnitStrategyOutcome {
  statusDuration: number;
  successRollValue: number | undefined;
}

function applySuccessfulUnitStrategy(
  next: GameState,
  strategyId: StrategyId,
  targetId: string,
  outcome: SuccessfulUnitStrategyOutcome,
) {
  const target = next.units[targetId];
  if (!target) return;

  if (strategyId === 'false-report') {
    target.falseReportedTenDays = outcome.statusDuration;
  } else if (strategyId === 'disturb') {
    target.confusedTenDays = outcome.statusDuration;
  } else if (strategyId === 'calm') {
    delete target.confusedTenDays;
    delete target.falseReportedTenDays;
  } else if (strategyId === 'inspire') {
    target.energy = Math.min(100, target.energy + 20);
  } else if (strategyId === 'discord') {
    const victim = discordVictim(next, target);
    if (!victim) throw new Error('目标不在计略范围');
    const damage = reduceUnitDamageByFortress(
      next,
      victim,
      damageForRoll(next, target, unitTerrain(next, victim), outcome.successRollValue ?? 0, false, victim),
    );
    victim.troops -= damage;
    next.battleDamageReports = [{
      id: `strategy-${strategyId}-${next.month}-${next.tenDay}-${next.rngCursor}-${victim.id}`,
      unitId: victim.id,
      q: victim.q,
      r: victim.r,
      amount: damage,
      kind: 'attack',
    }];
    if (victim.troops <= 0) removeUnit(next, victim, target);
  }
}

function multiplyImmediateFireDamage(
  next: GameState,
  firstReportIndex: number,
  multiplier: number,
  looter: ArmyUnit,
) {
  if (multiplier <= 1) return;
  for (const report of (next.battleDamageReports ?? []).slice(firstReportIndex)) {
    const extraDamage = report.amount * (multiplier - 1);
    report.amount += extraDamage;
    const unit = next.units[report.unitId];
    if (!unit) continue;
    unit.troops -= extraDamage;
    if (unit.troops <= 0) removeUnit(next, unit, looter);
  }
}

function addDamageReport(next: GameState, unit: ArmyUnit, amount: number, prefix: string) {
  next.battleDamageReports ??= [];
  next.battleDamageReports.push({
    id: `${prefix}-${next.month}-${next.tenDay}-${next.rngCursor}-${unit.id}-${next.battleDamageReports.length}`,
    unitId: unit.id,
    q: unit.q,
    r: unit.r,
    amount,
    kind: 'attack',
  });
}

function applyGroundFireDamageAfterForcedMove(next: GameState, unitId: string) {
  const unit = next.units[unitId];
  if (!unit || !(next.firePlots ?? []).some((plot) => isSameCoord(plot, unit))) return;
  const damage = reduceUnitDamageByFortress(next, unit, Math.round(FIRE_PLOT_DAMAGE * fireDamageMultiplierOf(next, unit)));
  unit.troops -= damage;
  addDamageReport(next, unit, damage, 'tactic-fire');
  if (unit.troops <= 0) removeUnit(next, unit);
}

function damageUnitsAt(next: GameState, coords: GridCoord[], amount: number, prefix: string, looter?: ArmyUnit) {
  const keys = new Set(coords.map(gridKey));
  for (const unit of [...Object.values(next.units)]) {
    if (!keys.has(gridKey(unit))) continue;
    const nextUnit = next.units[unit.id];
    if (!nextUnit) continue;
    // 藤甲：火焰伤害加倍
    const fireDamage = reduceUnitDamageByFortress(next, nextUnit, Math.round(amount * fireDamageMultiplierOf(next, nextUnit)));
    nextUnit.troops -= fireDamage;
    addDamageReport(next, nextUnit, fireDamage, prefix);
    if (nextUnit.troops <= 0) removeUnit(next, nextUnit, looter);
  }
}

function damageFacility(next: GameState, facilityId: string, amount: number) {
  const facility = next.facilities?.[facilityId];
  if (!facility) return;
  facility.durability = Math.max(0, facility.durability - amount);
  if (facility.durability <= 0) delete next.facilities?.[facilityId];
}

function damageFacilitiesAt(next: GameState, coords: GridCoord[], amount: number) {
  const keys = new Set(coords.map(gridKey));
  for (const facility of Object.values(next.facilities ?? {})) {
    if (!keys.has(gridKey(facility))) continue;
    damageFacility(next, facility.id, amount);
  }
}

function fireBallCells(state: GameState, source: GridCoord, trap: GridCoord) {
  const gridKeys = new Set(state.grid.map(gridKey));
  const previous = fireBallPreviousCell(state, source, trap);
  return [trap, projectBeyond(previous, trap), projectBeyond(previous, trap, 2)]
    .filter((coord): coord is GridCoord => Boolean(coord && gridKeys.has(gridKey(coord))));
}

function fireBallPreviousCell(state: GameState, source: GridCoord, trap: GridCoord): GridCoord {
  if (areAdjacent(source, trap)) return source;
  const gridKeys = new Set(state.grid.map(gridKey));
  const straightStep = neighborsOf(source.q, source.r)
    .filter((coord) => gridKeys.has(gridKey(coord)))
    .find((coord) => {
      const projected = projectBeyond(source, coord);
      return Boolean(projected && isSameCoord(projected, trap));
    });
  if (straightStep) return straightStep;
  return neighborsOf(trap.q, trap.r)
    .filter((coord) => gridKeys.has(gridKey(coord)))
    .sort((a, b) => gridDistanceWithin(source, a, 99) - gridDistanceWithin(source, b, 99) || a.q - b.q || a.r - b.r)[0] ?? source;
}

function addFirePlots(next: GameState, coords: GridCoord[]) {
  const gridKeys = new Set(next.grid.map(gridKey));
  next.firePlots ??= [];
  const existing = new Set(next.firePlots.map(gridKey));
  for (const coord of coords) {
    const key = gridKey(coord);
    if (!gridKeys.has(key) || existing.has(key)) continue;
    const durationRoll = nextRandom(next.seed, next.rngCursor);
    next.rngCursor = durationRoll.cursor;
    next.firePlots.push({ q: coord.q, r: coord.r, remainingTenDays: Math.floor(durationRoll.value * 3) + 1 });
    existing.add(key);
  }
}

function igniteGroundFire(next: GameState, coords: GridCoord[], looter?: ArmyUnit) {
  addFirePlots(next, coords);
  damageUnitsAt(next, coords, FIRE_PLOT_DAMAGE, 'fire-plot', looter);
}

function igniteOrdinaryFacility(next: GameState, facility: Facility, looter?: ArmyUnit) {
  const coord = { q: facility.q, r: facility.r };
  addFirePlots(next, [coord]);
  damageFacility(next, facility.id, FIRE_FACILITY_DAMAGE);
  damageUnitsAt(next, [coord], FIRE_PLOT_DAMAGE, 'fire-plot', looter);
}

function fireStrategyAffectedCells(next: GameState, coords: GridCoord[], caster: ArmyUnit | undefined) {
  if (!caster) return coords;
  const immuneUnitCells = new Set(Object.values(next.units)
    .filter((target) => resolveStrategySkillRules(next, caster, target, 'fire', STRATEGIES.fire.cost).immune)
    .map(gridKey));
  return coords.filter((coord) => !immuneUnitCells.has(gridKey(coord)));
}

function igniteFacility(
  next: GameState,
  source: GridCoord,
  facility: Facility,
  looter?: ArmyUnit,
  fireStrategyCaster?: ArmyUnit,
) {
  if (!facilityIsCompleted(facility)) return false;
  if (facility.type === 'fireSeed') {
    const cells = [facility, ...neighborsOf(facility.q, facility.r)];
    const affectedCells = fireStrategyAffectedCells(next, cells, fireStrategyCaster);
    addFirePlots(next, affectedCells);
    damageUnitsAt(next, affectedCells, FIRE_SEED_DAMAGE, 'fire-seed', looter);
    damageFacilitiesAt(next, cells, FIRE_FACILITY_DAMAGE);
    delete next.facilities?.[facility.id];
    return true;
  }
  if (facility.type === 'fireBall') {
    const cells = fireBallCells(next, source, facility);
    const affectedCells = fireStrategyAffectedCells(next, cells, fireStrategyCaster);
    addFirePlots(next, affectedCells);
    damageUnitsAt(next, affectedCells, FIRE_BALL_DAMAGE, 'fire-ball', looter);
    damageFacilitiesAt(next, cells, FIRE_FACILITY_DAMAGE);
    delete next.facilities?.[facility.id];
    return true;
  }
  return false;
}

export function useUnitStrategy(state: GameState, forceId: ForceId, unitId: string, strategyId: StrategyId, selection: StrategySelection): GameState {
  const unit = assertUnitTurn(state, forceId, unitId);
  const strategy = STRATEGIES[strategyId];
  if (!strategy) throw new Error('部队不能使用该计略');
  if (unit.kind === 'transport') throw new Error('运输队不能使用计略');
  const staminaCost = strategyEnergyCostForUnit(state, unitId, strategyId);
  if ((unit.stamina ?? 0) < staminaCost) throw new Error('战力不足');

  let targetCoord: GridCoord;
  let targetUnit: ArmyUnit | undefined;

  if (strategy.target === 'cell') {
    if (!selection.coord) throw new Error('计略目标不存在');
    if (!strategyTargetCells(state, unitId, strategyId).some((coord) => coord.q === selection.coord.q && coord.r === selection.coord.r)) {
      throw new Error('目标不在计略范围');
    }
    targetCoord = selection.coord;
  } else {
    if (!selection.targetUnitId) throw new Error('计略目标不存在');
    if (!strategyTargetUnits(state, unitId, strategyId).some((target) => target.id === selection.targetUnitId)) {
      throw new Error('目标不在计略范围');
    }
    targetUnit = state.units[selection.targetUnitId];
    if (!targetUnit) throw new Error('计略目标不存在');
    targetCoord = { q: targetUnit.q, r: targetUnit.r };
  }

  const probabilistic = strategyId === 'fire' || strategyId === 'false-report' || strategyId === 'disturb' || strategyId === 'discord';
  const sourceIntelligence = effectiveUnitAbilities(state, unit).intelligence.value;
  const occupiedFireTarget = strategyId === 'fire' && targetCoord
    ? Object.values(state.units).find((candidate) => (
      candidate.id !== unit.id &&
      candidate.forceId !== unit.forceId &&
      candidate.q === targetCoord.q &&
      candidate.r === targetCoord.r
    ))
    : undefined;
  const chance = strategyId === 'fire'
    ? occupiedFireTarget
      ? harmfulStrategySuccessChance(
        sourceIntelligence,
        effectiveUnitAbilities(state, occupiedFireTarget).intelligence.value,
      )
      : fireStrategySuccessChance(sourceIntelligence)
    : probabilistic && targetUnit
      ? harmfulStrategySuccessChance(sourceIntelligence, effectiveUnitAbilities(state, targetUnit).intelligence.value)
      : 100;
  const skillTarget = occupiedFireTarget ?? targetUnit;
  const skillRules = resolveStrategySkillRules(state, unit, skillTarget, strategyId, strategy.cost);
  // 神算/倾国：敌对计略成功率 +bonus（上限 100%）
  const effectiveChance = skillRules.guaranteed ? 100 : Math.min(100, chance + skillRules.successBonus);
  const roll = probabilistic && !skillRules.guaranteed && !skillRules.immune
    ? nextRandom(state.seed, state.rngCursor)
    : undefined;
  const succeeded = !skillRules.immune && (skillRules.guaranteed || !roll || roll.value < effectiveChance / 100);
  const next = structuredClone(state);
  next.battleDamageReports = [];
  next.cityEffectReports = [];
  next.facilityRepairReports = [];
  if (roll) next.rngCursor = roll.cursor;
  const disturbDurationRoll = strategyId === 'disturb' && succeeded
    ? nextRandom(next.seed, next.rngCursor)
    : undefined;
  if (disturbDurationRoll) next.rngCursor = disturbDurationRoll.cursor;
  spendStrategyCost(next, unitId, { ...strategy, cost: staminaCost });
  next.strategyResultReports = [strategyReport(next, unitId, strategy, targetCoord, succeeded)];
  // 反计：敌方对本部队的计略失败且敌将智力不高于本部队主将时，将计略反作用到施计方
  if (!succeeded && skillRules.reflect) {
    applySuccessfulUnitStrategy(next, strategyId, unitId, { statusDuration: 1, successRollValue: roll?.value });
    return next;
  }
  // 妙计：敌方对本部队的计略失败后，施计方陷入混乱
  if (!succeeded && skillRules.castFailConfuse) {
    applySuccessfulUnitStrategy(next, 'disturb', unitId, { statusDuration: 1, successRollValue: roll?.value });
    return next;
  }
  if (!succeeded) return next;

  if (strategy.target === 'cell') {
    next.firePlots ??= [];
    if (strategyId === 'fire') {
      const firstFireDamageReport = next.battleDamageReports.length;
      const facility = facilityAt(next, targetCoord);
      if (facility && igniteFacility(next, next.units[unitId], facility, next.units[unitId], next.units[unitId])) {
        next.battleDamageReports ??= [];
      } else if (facility) {
        igniteOrdinaryFacility(next, facility, next.units[unitId]);
      } else {
        igniteGroundFire(next, [targetCoord], next.units[unitId]);
      }
      // 点火瞬间对城内开发设施与所属城池本体造成一次即时伤害（与点火对部队/野外设施的即时伤害一致）
      applyImmediateFireDamageToCityAndPlot(next, targetCoord);
      // 点火瞬间若将某个敌方城池耐久烧至 0，则视为当场攻破（持续余火烧至 0 不算，需再补一刀攻破）
      const fireCaster = next.units[unitId];
      for (const city of Object.values(next.cities)) {
        if (!fireCaster.forceId || city.ownerId === fireCaster.forceId) continue;
        if (city.durability === 0) captureCityOnCapture(next, fireCaster, city.id);
      }
      multiplyImmediateFireDamage(next, firstFireDamageReport, skillRules.fireDamageMultiplier * (skillRules.critical ? 2 : 1), next.units[unitId]);
    } else if (strategyId === 'extinguish') {
      next.firePlots = next.firePlots.filter((plot) => plot.q !== targetCoord.q || plot.r !== targetCoord.r);
    }
    return next;
  }

  const target = next.units[targetUnit!.id];
  if (!target) throw new Error('计略目标不存在');

  const sharedDuration = strategyId === 'disturb' && disturbDurationRoll
    ? Math.floor(disturbDurationRoll.value * 3) + 1
    : 1;
  // 深谋/秘计：计略暴击使状态持续时间翻倍
  const statusDuration = skillRules.critical && strategyId === 'disturb' ? sharedDuration * 2 : sharedDuration;
  const sharedOutcome = { statusDuration, successRollValue: roll?.value };
  const applySuccessfulStatus = (targetId: string, duration: number) => {
    const nextCaster = next.units[unitId];
    const nextStatusTarget = next.units[targetId];
    if (!nextCaster || !nextStatusTarget) return;
    const targetRules = resolveStrategySkillRules(next, nextCaster, nextStatusTarget, strategyId, strategy.cost);
    if (targetRules.immune) return;
    applySuccessfulUnitStrategy(next, strategyId, targetId, { ...sharedOutcome, statusDuration: duration });
  };

  if (skillRules.complexHandlerIds.length > 0) {
    for (const handlerId of skillRules.complexHandlerIds) {
      complexHandlerById(handlerId).apply({
        state: next,
        casterId: unitId,
        originalTargetId: target.id,
        strategyId,
        sharedDuration,
        applySuccessfulStatus,
      });
    }
  } else {
    applySuccessfulUnitStrategy(next, strategyId, target.id, sharedOutcome);
  }

  return next;
}

export function useFirePlot(state: GameState, forceId: ForceId, unitId: string, target: GridCoord): GameState {
  assertUnitTurn(state, forceId, unitId);
  if (!firePlotCells(state, unitId).some((coord) => coord.q === target.q && coord.r === target.r)) {
    throw new Error('目标不在火计范围');
  }

  const next = structuredClone(state);
  next.firePlots ??= [];
  if (!next.firePlots.some((plot) => plot.q === target.q && plot.r === target.r)) {
    addFirePlots(next, [target]);
  }
  return next;
}

export function buildFacility(state: GameState, forceId: ForceId, unitId: string, facilityType: FacilityType, target: GridCoord): GameState {
  const unit = assertUnitTurn(state, forceId, unitId);
  const facility = FACILITIES[facilityType];
  if (!facility) throw new Error('设施不存在');
  if (unit.kind === 'transport') throw new Error('运输队不能设置设施');
  const buildCost = FACILITY_BUILD_COSTS[facilityType];
  if ((unit.gold ?? 0) < buildCost) throw new Error(`资金不足 ${buildCost}`);
  if (!facilityBuildTargets(state, unitId, undefined, facilityType).some((coord) => coord.q === target.q && coord.r === target.r)) {
    throw new Error('设置位置不可用');
  }

  const next = structuredClone(state);
  next.facilities ??= {};
  const id = `facility-${facilityType}-${next.month}-${next.tenDay}-${unitId}-${Object.keys(next.facilities).length + 1}`;
  const buildAmount = facilityBuildPower(state, unit);
  const durability = Math.min(facility.durability, buildAmount);
  next.facilities[id] = {
    id,
    type: facilityType,
    forceId,
    q: target.q,
    r: target.r,
    durability,
    completed: durability >= facility.durability,
  };
  addFacilityRepairReport(next, next.facilities[id], durability, 'build');
  next.battleDamageReports = [];
  next.cityEffectReports = [];
  next.strategyResultReports = [];
  next.units[unitId].gold = (next.units[unitId].gold ?? 0) - buildCost;
  next.units[unitId].acted = true;
  next.units[unitId].moved = true;
  next.units[unitId].movementRemaining = 0;
  // 委任建设（或新建设施未建成）：自动转为修补委任，直到建成；一次建成则清除委任
  if (next.facilities[id].completed) {
    delete next.units[unitId].delegate;
  } else {
    next.units[unitId].delegate = { kind: 'repair', facilityId: id };
  }
  return next;
}

export function repairFacility(state: GameState, forceId: ForceId, unitId: string, facilityId: string): GameState {
  const unit = assertUnitTurn(state, forceId, unitId);
  const facility = state.facilities?.[facilityId];
  if (!facility) throw new Error('设施不存在');
  if (facility.forceId !== forceId && !PUBLIC_REPAIRABLE_FACILITY_TYPES.has(facility.type)) throw new Error('只能修补己方设施');
  if (unit.kind === 'transport') throw new Error('运输队不能修补设施');
  if (!repairableFacilities(state, unitId).some((target) => target.id === facilityId)) throw new Error('设施不在修补范围');

  const next = structuredClone(state);
  const amount = repairedDurabilityAmount(next.facilities![facilityId], facilityBuildPower(state, unit));
  next.facilities![facilityId] = repairFacilityDurability(next.facilities![facilityId], amount);
  addFacilityRepairReport(next, next.facilities![facilityId], amount, 'repair');
  next.battleDamageReports = [];
  next.cityEffectReports = [];
  next.strategyResultReports = [];
  next.units[unitId].acted = true;
  next.units[unitId].moved = true;
  next.units[unitId].movementRemaining = 0;
  const delegate = next.units[unitId].delegate;
  if (delegate) {
    const isDelegateTarget = delegate.kind === 'repair' && delegate.facilityId === facilityId;
    if (isDelegateTarget) {
      // 委任目标建成：结束修补委任（未建成则保持，由委任自动继续修补）
      if (facilityIsCompleted(next.facilities![facilityId])) delete next.units[unitId].delegate;
    } else {
      // 手动修补了与委任目标不同的设施 → 视为做了其他操作，取消委任
      delete next.units[unitId].delegate;
    }
  }
  return next;
}

export function dismantleFacility(state: GameState, forceId: ForceId, facilityId: string): GameState {
  const facility = state.facilities?.[facilityId];
  if (!facility) throw new Error('设施不存在');
  if (facility.forceId !== forceId) throw new Error('只能撤销己方设施');
  // 2格范围内有敌方部队时无法撤销（与城池设施撤销规则一致）
  const enemyNear = Object.values(state.units).some(
    (unit) => unit.forceId && unit.forceId !== forceId && gridDistanceWithin(facility, unit, 2) <= 2,
  );
  if (enemyNear) throw new Error('有敌军在设施附近，无法撤销');

  const next = structuredClone(state);
  delete next.facilities?.[facilityId];
  return next;
}

export function settleBattleFacilities(next: GameState, activeForceId?: ForceId) {
  for (const facility of Object.values(next.facilities ?? {})) {
    if (!facilityIsCompleted(facility)) continue;
    if (facility.type === 'musicTower') {
      if (activeForceId && facility.forceId !== activeForceId) continue;
      // 诗想：军乐台战力恢复效果加倍（由势力内任意拥有诗想者生效）
      const forceOfficerIds = Object.values(next.officers)
        .filter((officer) => officer.forceId === facility.forceId)
        .map((officer) => officer.id);
      const musicMultiplier = effectsOfKind(resolveOfficerSkills(next, forceOfficerIds), 'musicTowerEnergyMultiplier')
        .reduce((highest, { effect }) => Math.max(highest, effect.multiplier), 1);
      for (const unit of Object.values(next.units)) {
        // 军乐台每旬使邻近（2格内）同势力战斗部队恢复 6 战力，运输队无战力不受影响
        if (unit.forceId === facility.forceId && unit.stamina !== undefined && gridDistanceWithin(facility, unit, 2) <= 2) {
          unit.stamina = Math.min(100, unit.stamina + 6 * musicMultiplier);
        }
      }
    } else if (facility.type === 'arrowTower') {
      if (activeForceId && facility.forceId !== activeForceId) continue;
      // 要塞城：本方工事伤害+50%（箭楼所在领地为要塞特性城且归属同势力时生效）
      const towerTerritory = territoryCityAt(next, facility);
      const fortressMultiplier = towerTerritory.ownerId === facility.forceId && hasCityTrait(towerTerritory.id, 'fortress') ? 1.5 : 1;
      for (const unit of [...Object.values(next.units)]) {
        if (unit.forceId === facility.forceId || gridDistanceWithin(facility, unit, 2) > 2) continue;
        const target = next.units[unit.id];
        if (!target) continue;
        const damage = reduceUnitDamageByFortress(next, target, ARROW_TOWER_DAMAGE * fortressMultiplier);
        target.troops -= damage;
        addDamageReport(next, target, damage, 'arrow-tower');
        if (target.troops <= 0) removeUnit(next, target);
      }
    }
  }
}
