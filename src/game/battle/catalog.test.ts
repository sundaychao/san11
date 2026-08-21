import { describe, expect, it } from 'vitest';
import {
  FACILITIES,
  FACILITY_BUILD_COSTS,
  TACTICS,
  TACTICS_BY_TROOP,
  TERRAIN_COST_BY_PROFILE,
} from './catalog';

describe('battle catalog', () => {
  it('keeps unit definitions independent from battle execution code', () => {
    expect(TACTICS['spear-thrust']).toMatchObject({ name: '突刺', troopType: 'spear', cost: 15 });
    expect(TACTICS_BY_TROOP.spear).toEqual(['spear-thrust', 'spear-spiral', 'spear-double']);
    expect(FACILITIES.fortress).toMatchObject({ name: '城塞', durability: 1200 });
    expect(FACILITY_BUILD_COSTS.arrowTower).toBe(600);
    expect(TERRAIN_COST_BY_PROFILE.cavalry.forest).toBe(8);
  });
});
