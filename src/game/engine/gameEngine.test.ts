import { describe, expect, it } from 'vitest';
import { createGame } from '../scenario/jingxiang208';
import { createGameEngine } from './gameEngine';

describe('game engine', () => {
  it('applies intents and publishes the new immutable state', () => {
    const initial = createGame('liu', 1);
    const engine = createGameEngine(initial, 'liu');
    const snapshots = [] as Array<typeof initial>;
    const unsubscribe = engine.subscribe((state) => snapshots.push(state));

    const next = engine.dispatch({
      type: 'issueCommand',
      command: { type: 'train', cityId: 'jiangling', officerIds: ['guan-yu'] },
    });

    expect(next).not.toBe(initial);
    expect(next.cities.jiangling.training).toBeGreaterThan(initial.cities.jiangling.training);
    expect(engine.getState()).toEqual(next);
    expect(snapshots).toEqual([next]);

    unsubscribe();
    engine.replace(initial);
    expect(snapshots).toEqual([next]);
  });

  it('does not expose mutable internal state through replacement', () => {
    const initial = createGame('liu', 2);
    const engine = createGameEngine(initial, 'liu');

    engine.replace(initial);
    const current = engine.getState();
    current.cities.jiangling.gold = 1;

    expect(initial.cities.jiangling.gold).not.toBe(1);
    expect(engine.getState().cities.jiangling.gold).not.toBe(1);
  });

  it('publishes domain events alongside a state transition', () => {
    const initial = createGame('liu', 3);
    const engine = createGameEngine(initial, 'liu');
    const received: string[] = [];
    engine.subscribe((_state, events) => received.push(...events.map((event) => event.type)));

    const result = engine.dispatchWithEvents({
      type: 'issueCommand',
      command: { type: 'train', cityId: 'jiangling', officerIds: ['guan-yu'] },
    });

    expect(result.events).toEqual([{ type: 'command-executed', commandType: 'train' }]);
    expect(received).toEqual(['command-executed']);
  });
});
