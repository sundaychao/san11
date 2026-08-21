export {
  assertUnitTurn,
  damageRoll,
  reduceUnitDamageByFortress,
  removeUnit,
  unitTerrain,
} from './legacyCore';
export { areAdjacent, isCityInAttackRange } from './targetRules';
export {
  deploymentCells,
  isLegalUnitCell,
  movementCells,
  reachableCosts,
  spawnCellFor,
  unitIsIncapacitated,
} from './movementRules';
