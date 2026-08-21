import type { ActionGameIntent } from '../network/intentReducer';
import type { GameState } from '../types';

export type GameEvent =
  | { type: 'unit-deployed'; unitId: string }
  | { type: 'unit-moved'; unitId: string; from: { q: number; r: number }; to: { q: number; r: number } }
  | { type: 'unit-attacked'; attackerId: string; targetId: string; targetType: 'unit' | 'facility' | 'city' }
  | { type: 'tactic-used'; unitId: string; tacticId: string }
  | { type: 'strategy-used'; unitId: string; strategyId: string }
  | { type: 'fire-plot-ignited'; unitId: string; target: { q: number; r: number } }
  | { type: 'facility-built'; unitId: string; facilityType: string; target: { q: number; r: number } }
  | { type: 'facility-repaired'; unitId: string; facilityId: string }
  | { type: 'facility-dismantled'; facilityId: string }
  | { type: 'command-executed'; commandType: string };

function newlyCreatedUnitId(before: GameState, after: GameState) {
  return Object.keys(after.units).find((unitId) => !before.units[unitId]);
}

function actionEvents(unitId: string, action: Extract<ActionGameIntent, { type: 'deployUnitAction' }>['action']): GameEvent[] {
  switch (action.type) {
    case 'attackUnit': return [{ type: 'unit-attacked', attackerId: unitId, targetId: action.targetId, targetType: 'unit' }];
    case 'attackFacility': return [{ type: 'unit-attacked', attackerId: unitId, targetId: action.facilityId, targetType: 'facility' }];
    case 'attackCity': return [{ type: 'unit-attacked', attackerId: unitId, targetId: action.cityId, targetType: 'city' }];
    case 'useUnitTactic': return [{ type: 'tactic-used', unitId, tacticId: action.tacticId }];
    case 'useUnitStrategy': return [{ type: 'strategy-used', unitId, strategyId: action.strategyId }];
    case 'buildFacility': return [{ type: 'facility-built', unitId, facilityType: action.facilityType, target: action.target }];
    case 'repairFacility': return [{ type: 'facility-repaired', unitId, facilityId: action.facilityId }];
    case 'wait': return [];
    default: return [];
  }
}

export function eventsForIntent(before: GameState, after: GameState, intent: ActionGameIntent): GameEvent[] {
  switch (intent.type) {
    case 'issueCommand':
      return [{ type: 'command-executed', commandType: intent.command.type }];
    case 'deployUnit':
    case 'deployTransportUnit': {
      const unitId = newlyCreatedUnitId(before, after);
      return unitId ? [{ type: 'unit-deployed', unitId }] : [];
    }
    case 'deployUnitAction': {
      const unitId = newlyCreatedUnitId(before, after);
      return unitId ? [{ type: 'unit-deployed', unitId }, ...actionEvents(unitId, intent.action)] : [];
    }
    case 'moveUnit': {
      const previous = before.units[intent.unitId];
      const next = after.units[intent.unitId];
      return previous && next && (previous.q !== next.q || previous.r !== next.r)
        ? [{ type: 'unit-moved', unitId: intent.unitId, from: { q: previous.q, r: previous.r }, to: { q: next.q, r: next.r } }]
        : [];
    }
    case 'attackUnit': return [{ type: 'unit-attacked', attackerId: intent.attackerId, targetId: intent.targetId, targetType: 'unit' }];
    case 'attackFacility': return [{ type: 'unit-attacked', attackerId: intent.attackerId, targetId: intent.facilityId, targetType: 'facility' }];
    case 'attackCity': return [{ type: 'unit-attacked', attackerId: intent.attackerId, targetId: intent.cityId, targetType: 'city' }];
    case 'useUnitTactic': return [{ type: 'tactic-used', unitId: intent.attackerId, tacticId: intent.tacticId }];
    case 'useUnitStrategy': return [{ type: 'strategy-used', unitId: intent.unitId, strategyId: intent.strategyId }];
    case 'useFirePlot': return [{ type: 'fire-plot-ignited', unitId: intent.unitId, target: intent.target }];
    case 'buildFacility': return [{ type: 'facility-built', unitId: intent.unitId, facilityType: intent.facilityType, target: intent.target }];
    case 'repairFacility': return [{ type: 'facility-repaired', unitId: intent.unitId, facilityId: intent.facilityId }];
    case 'dismantleFacility': return [{ type: 'facility-dismantled', facilityId: intent.facilityId }];
    default: return [];
  }
}
