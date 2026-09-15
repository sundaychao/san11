import {
  attackableCities,
  attackableFacilities,
  attackableUnits,
  deploymentCellsForStronghold,
  facilityBuildTargets,
  jointAttackableUnits,
  movementCells,
  repairableFacilities,
  requiredAptitudeForTactic,
  strategyTargetCells,
  strategyTargetUnits,
  tacticHasAnyTarget,
  tacticTargetCities,
  tacticTargetFacilities,
  tacticTargetPasses,
  tacticTargetPlots,
  tacticTargetUnits,
  unitCanUseTactic,
  unitFacilityMenuOptions,
  unitIsIncapacitated,
  unitStrategies,
  unitTactics,
  type UnitFacility,
  type UnitStrategy,
  type UnitTactic,
} from './actions';
import { suppliableUnits } from './supply';
import { movementAllowanceForProfile } from './definitions';
import type { GridCoord } from './grid';
import { attackablePlots, attackablePasses, type PlotAttackTarget } from './targetRules';
import { strategyEnergyCostForUnit } from './strategies';
import { STRATEGY_MIN_TROOPS } from './catalog';
import { formationMovementAllowanceBonus } from '../skills';
import { battleShipMovementBonus } from './catalog';
import { movementTechBonus } from '../techs';
import { TROOP_LABELS } from '../armaments';
import type { ArmyUnit, City, CityId, Facility, FacilityType, GameState, Pass, PassId, TroopType } from '../types';

export interface DeploymentTargetQueryInput {
  cityId?: CityId;
  passId?: PassId;
  troopType?: TroopType;
  /** 舰船出征时的载具（楼船 / 斗舰），用于预览移动力与可达格 */
  vehicle?: 'boat' | 'ship';
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
  /** 仅运输队可能出现：周围 6 格有己方作战部队时可补给 */
  supply: boolean;
}

export interface UnitActionQuery {
  unit?: ArmyUnit;
  attackUnits: ArmyUnit[];
  attackCities: City[];
  attackPasses: Pass[];
  attackFacilities: Facility[];
  attackPlots: PlotAttackTarget[];
  jointAttackUnits: ArmyUnit[];
  repairFacilities: Facility[];
  /** 运输队周围可补给的己方作战部队（非运输队恒为空） */
  supplyUnits: ArmyUnit[];
  /** 兵器战法可打的敌方城池 / 关隘（其余部队恒为空） */
  tacticCities: City[];
  tacticPasses: Pass[];
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
    supply: false,
  };
}

function unavailableTacticReason(state: GameState, unitId: string, tactic: UnitTactic, origin?: GridCoord) {
  const unit = state.units[unitId];
  if (!unit) return '部队无法行动';
  if (!unitCanUseTactic(state, unitId, tactic.id)) {
    // 兵器战法不要求兵种适性，只按兵器种类给（`unitCanUseTactic` 已含该口径）
    const troopLabel = tactic.troopType === 'naval' ? '水军' : TROOP_LABELS[tactic.troopType];
    return `需要${troopLabel}适性 ${requiredAptitudeForTactic(tactic.id)}`;
  }
  if (unit.acted) return '部队已行动';
  if (unitIsIncapacitated(unit)) return '部队无法行动';
  if ((unit.stamina ?? 0) < tactic.cost) return '战力不足';
  // 兵器战法可以打建筑（据点/关隘/设施），因此目标判定要连建筑一起看
  if (!tacticHasAnyTarget(state, unitId, tactic.id, origin)) return '无有效目标';
  return undefined;
}

export function getDeploymentTargets(state: GameState, input: DeploymentTargetQueryInput): GridCoord[] {
  const sourceId = input.passId ?? input.cityId;
  if (!sourceId) return [];
  if (input.kind === 'transport') return deploymentCellsForStronghold(state, sourceId, undefined, 'transport');
  const troopType = input.troopType ?? 'sword';
  const movementAllowance = movementAllowanceForProfile(troopType) +
    formationMovementAllowanceBonus(state, input.officerIds ?? [], troopType) +
    movementTechBonus(state, state.turnForceId, { kind: 'combat', troopType }) +
    battleShipMovementBonus(state, { forceId: state.turnForceId, vehicle: input.vehicle });
  return deploymentCellsForStronghold(state, sourceId, movementAllowance, troopType, input.vehicle);
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

/** 兵器战法可打的敌方城池 */
export function getTacticCityTargets(state: GameState, unitId: string, tacticId: Parameters<typeof tacticTargetCities>[2], origin?: GridCoord) {
  return tacticTargetCities(state, unitId, tacticId, origin);
}

/** 兵器战法可打的敌方关隘 */
export function getTacticPassTargets(state: GameState, unitId: string, tacticId: Parameters<typeof tacticTargetPasses>[2], origin?: GridCoord) {
  return tacticTargetPasses(state, unitId, tacticId, origin);
}

/** 兵器战法可打的敌方开发地格（市场/农场/兵舍…，标识为 `cityId:plotIndex`） */
export function getTacticPlotTargets(state: GameState, unitId: string, tacticId: Parameters<typeof tacticTargetPlots>[2], origin?: GridCoord) {
  return tacticTargetPlots(state, unitId, tacticId, origin);
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
      attackPasses: [],
      attackFacilities: [],
      attackPlots: [],
      jointAttackUnits: [],
      repairFacilities: [],
      supplyUnits: [],
      tacticCities: [],
      tacticPasses: [],
      tacticOptions: [],
      availableTactics: [],
      availableStrategies: [],
      availableFacilities: [],
      commandAvailability: emptyCommandAvailability(),
    };
  }

  const attackUnits = attackableUnits(state, unitId, origin);
  const attackCities = attackableCities(state, unitId, origin);
  const attackPasses = attackablePasses(state, unitId, origin);
  const attackFacilities = attackableFacilities(state, unitId, origin);
  const attackPlots = attackablePlots(state, unitId, origin);
  const jointAttackUnits = jointAttackableUnits(state, unitId, origin);
  const repairFacilities = repairableFacilities(state, unitId, origin);
  const supplyUnits = suppliableUnits(state, unitId, origin);
  const tacticOptions = getUnitTacticOptions(state, unitId, origin);
  // 兵器：每种兵器只有一条战法，菜单与目标高亮都按这条算（据点/关隘也算有效目标）
  const siegeTactic = tacticOptions.map((option) => option.tactic).find((tactic) => tactic.troopType === 'siege');
  const tacticCities = siegeTactic ? tacticTargetCities(state, unitId, siegeTactic.id, origin) : [];
  const tacticPasses = siegeTactic ? tacticTargetPasses(state, unitId, siegeTactic.id, origin) : [];
  const availableTactics = tacticOptions
    .filter((option) => !option.unavailableReason)
    .map((option) => option.tactic);
  // 兵力不足的部队无法释放计略（普攻、战法、攻城不受影响），UI 层据此禁用「计略」按钮
  const availableStrategies = unit.troops < STRATEGY_MIN_TROOPS ? [] : unitStrategies().filter((strategy) => {
    if (unit.energy < strategyEnergyCostForUnit(state, unitId, strategy.id)) return false;
    if (strategy.target === 'cell') return strategyTargetCells(state, unitId, strategy.id, origin).length > 0;
    return strategyTargetUnits(state, unitId, strategy.id, origin).length > 0;
  });
  // 设施升级链按势力科技解析成当前档位（阵/砦/城塞 只出现一个入口），再按可建位置过滤
  const availableFacilities = unitFacilityMenuOptions(state, unit.forceId).filter((facility) => (
    facilityBuildTargets(state, unitId, origin, facility.type).length > 0
  ));
  const hasActed = unit.acted;
  const commandAvailability: UnitCommandAvailability = hasActed
    ? emptyCommandAvailability()
    : {
        wait: true,
        attack: attackUnits.length > 0 || attackCities.length > 0 || attackPasses.length > 0 || attackFacilities.length > 0 || attackPlots.length > 0,
        // 运输队可普攻敌方部队，但**不发起单挑**（单挑是武将间的对决，辎重队不参与）
        duel: unit.kind !== 'transport' && attackUnits.length > 0,
        jointAttack: jointAttackUnits.length > 0,
        tactic: availableTactics.length > 0,
        strategy: availableStrategies.length > 0,
        facility: availableFacilities.length > 0,
        repair: repairFacilities.length > 0,
        // 补给是运输队专属命令：周围 6 格有己方作战部队才可用
        supply: unit.kind === 'transport' && supplyUnits.length > 0,
      };

  return {
    unit,
    attackUnits,
    attackCities,
    attackPasses,
    attackFacilities,
    attackPlots,
    jointAttackUnits,
    repairFacilities,
    supplyUnits,
    tacticCities,
    tacticPasses,
    tacticOptions,
    availableTactics,
    availableStrategies,
    availableFacilities,
    commandAvailability,
  };
}
