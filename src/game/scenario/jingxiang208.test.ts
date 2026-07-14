import { describe, expect, it } from 'vitest';
import { createGame } from './jingxiang208';

describe('jingxiang 208 scenario', () => {
  it('contains the approved amount of content', () => {
    const game = createGame('liu', 20804);

    expect(Object.keys(game.cities)).toHaveLength(8);
    expect(Object.values(game.officers)).toHaveLength(24);
    expect(Object.values(game.officers).filter((officer) => officer.forceId)).toHaveLength(16);
    expect(Object.values(game.officers).filter((officer) => !officer.forceId)).toHaveLength(8);
  });

  it.each(['cao', 'liu', 'sun', 'biao'] as const)(
    '%s starts with two cities and four officers',
    (forceId) => {
      const game = createGame(forceId, 1);

      expect(Object.values(game.cities).filter((city) => city.ownerId === forceId)).toHaveLength(2);
      expect(Object.values(game.officers).filter((officer) => officer.forceId === forceId)).toHaveLength(4);
      expect(game.actionPoints[forceId]).toBe(80);
    },
  );

  it('creates independent mutable game states', () => {
    const first = createGame('liu', 1);
    const second = createGame('liu', 1);

    first.cities.jiangling.gold = 0;
    first.officers['liu-bei'].acted = true;

    expect(second.cities.jiangling.gold).toBeGreaterThan(0);
    expect(second.officers['liu-bei'].acted).toBe(false);
  });

  it('keeps all bounded values valid', () => {
    const game = createGame('cao', 1);

    for (const city of Object.values(game.cities)) {
      expect(city.gold).toBeGreaterThanOrEqual(0);
      expect(city.food).toBeGreaterThanOrEqual(0);
      expect(city.population).toBeGreaterThanOrEqual(0);
      expect(city.troops).toBeGreaterThanOrEqual(0);
      expect(city.mapX).toBeGreaterThanOrEqual(0);
      expect(city.mapX).toBeLessThanOrEqual(1);
      expect(city.mapY).toBeGreaterThanOrEqual(0);
      expect(city.mapY).toBeLessThanOrEqual(1);
      for (const value of [city.commerce, city.agriculture, city.order, city.training]) {
        expect(value).toBeGreaterThanOrEqual(0);
        expect(value).toBeLessThanOrEqual(100);
      }
    }
  });
});
