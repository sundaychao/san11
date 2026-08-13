import { reduceGameIntent, type ActionGameIntent } from '../network/intentReducer';
import type { GameState } from '../types';

export function applyLocalIntent(state: GameState, intent: ActionGameIntent) {
  return reduceGameIntent(state, state.playerForceId, intent);
}
