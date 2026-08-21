export {
  BASE_MOVEMENT,
  DEPLOY_AP_COST,
  FACILITY_BUILD_COSTS,
  movementAllowanceForProfile,
  movementAllowanceForUnit,
} from './catalog';
export type {
  MovementProfile,
  StrategyId,
  StrategySelection,
  TacticId,
  UnitFacility,
  UnitStrategy,
  UnitTactic,
} from './catalog';
export { unitFacilities, unitStrategies, unitTactics } from './legacyCore';
export type { DeployInput, TransportInput } from './legacyCore';
