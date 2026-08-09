import type { DeployInput, TransportInput, TacticId } from '../battle/actions';
import type { GridCoord } from '../battle/grid';
import type { CityId, GameCommand } from '../types';

export type GameIntent =
  | { type: 'issueCommand'; command: GameCommand }
  | { type: 'deployUnit'; input: DeployInput }
  | { type: 'deployTransportUnit'; input: TransportInput }
  | { type: 'moveUnit'; unitId: string; destination: GridCoord }
  | { type: 'waitUnit'; unitId: string }
  | { type: 'attackUnit'; attackerId: string; targetId: string; destination?: GridCoord }
  | { type: 'useUnitTactic'; attackerId: string; targetId: string; tacticId: TacticId; destination?: GridCoord }
  | { type: 'attackCity'; attackerId: string; cityId: CityId; destination?: GridCoord }
  | { type: 'endTenDay' };
