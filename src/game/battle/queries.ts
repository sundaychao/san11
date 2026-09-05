import {
  attackableCities,
  attackableFacilities,
  attackableUnits,
  deploymentCells,
  facilityBuildTargets,
  jointAttackableUnits,
  movementCells,
  repairableFacilities,
  requiredAptitudeForTactic,
  strategyTargetCells,
  strategyTargetUnits,
  tacticTargetFacilities,
  tacticTargetUnits,
  unitCanUseTactic,
  unitFacilities,
  unitIsIncapacitated,
  unitStrategies,
  unitTactics,
  type UnitFacility,
  type UnitStrategy,
  type UnitTactic,
} from './actions';
import { movementAllowanceForProfile } from './definitions';
import type { GridCoord } from './grid';
import { attackablePlots, type PlotAttackTarget } from './targetRules';
import { strategyEnergyCostForUnit } from './strategies';
import { formationMovementAllowanceBonus } from '../skills';
import { troopMovementBonusForTroop } from '../techs';
import { TROOP_LABELS } from '../armaments';
import type { ArmyUnit, City, CityId, Facility, FacilityType, GameState, TroopType } from '../types';

export interface DeploymentTargetQueryInput {
  cityId: CityId;
  troopType?: TroopType;
  officerIds?: string[];
  kind?: 'combat' | 'transport';
}

export interface UnitTacticOption {
  tactic: UnitTactic;
  unavailableReason?: string;
}

export interface UnitCommandAvailability {
  wait: boolean;
  attack: boolean;
  duel: boolean;
  jointAttack: boolean;
  tactic: boolean;
  strategy: boolean;
  facility: boolean;
  repair: boolean;
}

export interface UnitActionQuery {
  unit?: ArmyUnit;
  attackUnits: ArmyUnit[];
  attackCities: City[];
  attackFacilities: Facility[];
  attackPlots: PlotAttackTarget[];
  jointAttackUnits: ArmyUnit[];
  repairFacilities: Facility[];
  tacticOptions: UnitTacticOption[];
  availableTactics: UnitTactic[];
  availableStrategies: UnitStrategy[];
  availableFacilities: UnitFacility[];
  commandAvailability: UnitCommandAvailability;
}

function emptyCommandAvailability(): UnitCommandAvailability {
  return {
    wait: false,
    attack: false,
    duel: false,
    jointAttack: false,
    tactic: false,
    strategy: false,
    facility: false,
    repair: false,
  };
}

function unavailableTacticReason(state: GameState, unitId: string, tactic: UnitTactic, origin?: GridCoord) {
  const unit = state.units[unitId];
  if (!unit) return '部队无法行动';
  if (!unitCanUseTactic(state, unitId, tactic.id)) {
    const troopLabel = tactic.troopType === 'naval' ? '水军' : TROOP_LABELS[tactic.troopType];
    return `需要${troopLabel}适性 ${requiredAptitudeForTactic(tactic.id)}`;
  }
  if (unit.acted) return '部队已行动';
  if (unitIsIncapacitated(unit)) return '部队无法行动';
  if (unit.energy < tactic.cost) return '气力不足';
  if (
    tacticTargetUnits(state, unitId, tactic.id, origin).length === 0 &&
    tacticTargetFacilities(state, unitId, tactic.id, origin).length === 0
  ) return '无有效目标';
  return undefined;
}

export function getDeploymentTargets(state: GameState, input: DeploymentTargetQueryInput): GridCoord[] {
  if (input.kind === 'transport') return deploymentCells(state, input.cityId, undefined, 'transport');
  const troopType = input.troopType ?? 'sword';
  const movementAllowance = movementAllowanceForProfile(troopType) +
    formationMovementAllowanceBonus(state, input.officerIds ?? [], troopType) +
    troopMovementBonusForTroop(state, state.turnForceId, troopType);
  return deploymentCells(state, input.cityId, movementAllowance, troopType);
}

export function getMovementTargets(state: GameState, unitId: string) {
  return movementCells(state, unitId);
}

export function getStrategyCellTargets(state: GameState, unitId: string, strategyId: Parameters<typeof strategyTargetCells>[2], origin?: GridCoord) {
  return strategyTargetCells(state, unitId, strategyId, origin);
}

export function getStrategyUnitTargets(state: GameState, unitId: string, strategyId: Parameters<typeof strategyTargetUnits>[2], origin?: GridCoord) {
  return strategyTargetUnits(state, unitId, strategyId, origin);
}

export function getTacticUnitTargets(state: GameState, unitId: string, tacticId: Parameters<typeof tacticTargetUnits>[2], origin?: GridCoord) {
  return tacticTargetUnits(state, unitId, tacticId, origin);
}

export function getTacticFacilityTargets(state: GameState, unitId: string, tacticId: Parameters<typeof tacticTargetFacilities>[2], origin?: GridCoord) {
  return tacticTargetFacilities(state, unitId, tacticId, origin);
}

export function getFacilityBuildTargets(state: GameState, unitId: string, origin?: GridCoord, facilityType?: FacilityType) {
  return facilityBuildTargets(state, unitId, origin, facilityType);
}

export function getRepairTargets(state: GameState, unitId: string, origin?: GridCoord) {
  return repairableFacilities(state, unitId, origin);
}

export function getUnitTacticOptions(state: GameState, unitId: string, origin?: GridCoord): UnitTacticOption[] {
  return unitTactics(state, unitId).map((tactic) => ({
    tactic,
    unavailableReason: unavailableTacticReason(state, unitId, tactic, origin),
  }));
}

export function getUnitActionQuery(state: GameState, unitId: string, origin?: GridCoord): UnitActionQuery {
  const unit = state.units[unitId];
  if (!unit) {
    return {
      unit: undefined,
      attackUnits: [],
      attackCities: [],
      attackFacilities: [],
      attackPlots: [],
      jointAttackUnits: [],
      repairFacilities: [],
      tacticOptions: [],
      availableTactics: [],
      availableStrategies: [],
      availableFacilities: [],
      commandAvailability: emptyCommandAvailability(),
    };
  }

  const attackUnits = attackableUnits(state, unitId, origin);
  const attackCities = attackableCities(state, unitId, origin);
  const attackFacilities = attackableFacilities(state, unitId, origin);
  const attackPlots = attackablePlots(state, unitId, origin);
  const jointAttackUnits = jointAttackableUnits(state, unitId, origin);
  const repairFacilities = repairableFacilities(state, unitId, origin);
  const tacticOptions = getUnitTacticOptions(state, unitId, origin);
  const availableTactics = tacticOptions
    .filter((option) => !option.unavailableReason)
    .map((option) => option.tactic);
  const availableStrategies = unitStrategies().filter((strategy) => {
    if (unit.energy < strategyEnergyCostForUnit(state, unitId, strategy.id)) return false;
    if (strategy.target === 'cell') return strategyTargetCells(state, unitId, strategy.id, origin).length > 0;
    return strategyTargetUnits(state, unitId, strategy.id, origin).length > 0;
  });
  const availableFacilities = unitFacilities().filter((facility) => (
    facilityBuildTargets(state, unitId, origin, facility.type).length > 0
  ));
  const hasActed = unit.acted;
  const commandAvailability: UnitCommandAvailability = hasActed
    ? emptyCommandAvailability()
    : {
        wait: true,
        attack: attackUnits.length > 0 || attackCities.length > 0 || attackFacilities.length > 0 || attackPlots.length > 0,
        duel: attackUnits.length > 0,
        jointAttack: jointAttackUnits.length > 0,
        tactic: availableTactics.length > 0,
        strategy: availableStrategies.length > 0,
        facility: availableFacilities.length > 0,
        repair: repairFacilities.length > 0,
      };

  return {
    unit,
    attackUnits,
    attackCities,
    attackFacilities,
    attackPlots,
    jointAttackUnits,
    repairFacilities,
    tacticOptions,
    availableTactics,
    availableStrategies,
    availableFacilities,
    commandAvailability,
  };
}
