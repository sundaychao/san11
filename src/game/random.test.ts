import { describe, expect, it } from 'vitest';
import { nextRandom } from './random';

describe('nextRandom', () => {
  it('replays the same random value from the same seed and cursor', () => {
    expect(nextRandom(20804, 3)).toEqual(nextRandom(20804, 3));
  });

  it('returns a normalized value and advances one cursor', () => {
    const result = nextRandom(20804, 3);

    expect(result.value).toBeGreaterThanOrEqual(0);
    expect(result.value).toBeLessThan(1);
    expect(result.cursor).toBe(4);
  });
});
