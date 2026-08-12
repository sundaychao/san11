import type { DeployInput, StrategyId, StrategySelection, TransportInput, TacticId } from '../battle/actions';
import type { GridCoord } from '../battle/grid';
import type { CityId, FacilityType, GameCommand } from '../types';

export type DeployFollowupAction =
  | { type: 'wait' }
  | { type: 'attackUnit'; targetId: string }
  | { type: 'attackFacility'; facilityId: string }
  | { type: 'attackCity'; cityId: CityId }
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
  | { type: 'waitUnit'; unitId: string }
  | { type: 'attackUnit'; attackerId: string; targetId: string; destination?: GridCoord }
  | { type: 'attackFacility'; attackerId: string; facilityId: string; destination?: GridCoord }
  | { type: 'useUnitTactic'; attackerId: string; targetId: string; tacticId: TacticId; destination?: GridCoord }
  | { type: 'useUnitStrategy'; unitId: string; strategyId: StrategyId; selection: StrategySelection; destination?: GridCoord }
  | { type: 'useFirePlot'; unitId: string; target: GridCoord; destination?: GridCoord }
  | { type: 'buildFacility'; unitId: string; facilityType: FacilityType; target: GridCoord; destination?: GridCoord }
  | { type: 'repairFacility'; unitId: string; facilityId: string; destination?: GridCoord }
  | { type: 'dismantleFacility'; facilityId: string }
  | { type: 'attackCity'; attackerId: string; cityId: CityId; destination?: GridCoord }
  | { type: 'endTenDay' };
