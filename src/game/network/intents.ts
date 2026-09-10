import type { DeployInput, StrategyId, StrategySelection, TransportInput, TacticId } from '../battle/actions';
import type { GridCoord } from '../battle/grid';
import type { CityId, FacilityType, GameCommand, PassId } from '../types';

export type DeployFollowupAction =
  | { type: 'wait' }
  | { type: 'attackUnit'; targetId: string }
  | { type: 'jointAttackUnit'; targetId: string }
  | { type: 'attackFacility'; facilityId: string }
  | { type: 'attackPlot'; cityId: CityId; plotIndex: number }
  | { type: 'attackCity'; cityId: CityId }
  | { type: 'attackPass'; passId: PassId }
  | { type: 'useUnitTactic'; targetId: string; tacticId: TacticId }
  | { type: 'useUnitStrategy'; strategyId: StrategyId; selection: StrategySelection }
  | { type: 'buildFacility'; facilityType: FacilityType; target: GridCoord }
  | { type: 'repairFacility'; facilityId: string };

export type GameIntent =
  | { type: 'issueCommand'; command: GameCommand }
  | { type: 'deployUnit'; input: DeployInput }
  | { type: 'deployUnitAction'; input: DeployInput; action: DeployFollowupAction }
  | { type: 'deployTransportUnit'; input: TransportInput }
  | { type: 'moveUnit'; unitId: string; destination: GridCoord }
  | { type: 'setMoveDelegate'; unitId: string; target: GridCoord }
  | { type: 'setBuildDelegate'; unitId: string; target: GridCoord; facility: FacilityType }
  | { type: 'setRepairDelegate'; unitId: string; facilityId: string }
  | { type: 'deployUnitDelegate'; input: DeployInput; target: GridCoord; facility?: FacilityType }
  | { type: 'waitUnit'; unitId: string }
  | { type: 'attackUnit'; attackerId: string; targetId: string; destination?: GridCoord }
  | { type: 'jointAttackUnit'; attackerId: string; targetId: string; destination?: GridCoord }
  | { type: 'attackFacility'; attackerId: string; facilityId: string; destination?: GridCoord }
  | { type: 'attackPlot'; attackerId: string; cityId: CityId; plotIndex: number; destination?: GridCoord }
  | { type: 'useUnitTactic'; attackerId: string; targetId: string; tacticId: TacticId; destination?: GridCoord }
  | { type: 'useUnitStrategy'; unitId: string; strategyId: StrategyId; selection: StrategySelection; destination?: GridCoord }
  | { type: 'useFirePlot'; unitId: string; target: GridCoord; destination?: GridCoord }
  | { type: 'buildFacility'; unitId: string; facilityType: FacilityType; target: GridCoord; destination?: GridCoord }
  | { type: 'repairFacility'; unitId: string; facilityId: string; destination?: GridCoord }
  | { type: 'dismantleFacility'; facilityId: string }
  | { type: 'attackCity'; attackerId: string; cityId: CityId; destination?: GridCoord }
  | { type: 'attackPass'; attackerId: string; passId: PassId; destination?: GridCoord }
  | { type: 'duelUnit'; unitId: string; targetUnitId: string; stance: 'attack' | 'defense' | 'spirit' | 'finisher'; destination?: GridCoord }
  | { type: 'debateRound'; cardUid: string }
  | { type: 'debateRethink' }
  | { type: 'debateAbandon' }
  | { type: 'debateDismiss' }
  | { type: 'endTenDay' };
