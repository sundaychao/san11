import { reduceGameIntent, type ActionGameIntent } from '../network/intentReducer';
import type { ForceId, GameState } from '../types';
import { eventsForIntent, type GameEvent } from './events';

export type GameEngineListener = (state: GameState, events: readonly GameEvent[]) => void;

export interface GameDispatchResult {
  state: GameState;
  events: readonly GameEvent[];
}

export interface GameEngine {
  getState(): GameState;
  dispatch(intent: ActionGameIntent): GameState;
  dispatchWithEvents(intent: ActionGameIntent): GameDispatchResult;
  replace(state: GameState): GameState;
  subscribe(listener: GameEngineListener): () => void;
}

function snapshot(state: GameState) {
  return structuredClone(state);
}

export function createGameEngine(initialState: GameState, forceId: ForceId = initialState.playerForceId): GameEngine {
  let state = snapshot(initialState);
  const listeners = new Set<GameEngineListener>();

  function publish(events: readonly GameEvent[] = []) {
    const current = snapshot(state);
    for (const listener of listeners) listener(current, events);
    return current;
  }

  return {
    getState() {
      return snapshot(state);
    },
    dispatch(intent) {
      return this.dispatchWithEvents(intent).state;
    },
    dispatchWithEvents(intent) {
      const before = state;
      state = reduceGameIntent(state, forceId, intent);
      const events = eventsForIntent(before, state, intent);
      return { state: publish(events), events };
    },
    replace(nextState) {
      state = snapshot(nextState);
      return publish();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
