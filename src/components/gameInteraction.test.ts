import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import * as interactionModule from './gameInteraction';

it('provides a map interaction reducer module', () => {
  expect(existsSync(resolve(process.cwd(), 'src/components/gameInteraction.ts'))).toBe(true);
});

describe('reduceMapInteraction', () => {
  const module = interactionModule as typeof interactionModule & {
    INITIAL_MAP_INTERACTION?: unknown;
    reduceMapInteraction?: (state: any, action: any) => any;
  };

  it('backs from a unit submenu to its parent unit menu', () => {
    expect(typeof module.reduceMapInteraction).toBe('function');
    if (!module.reduceMapInteraction) return;

    const menu = module.reduceMapInteraction(module.INITIAL_MAP_INTERACTION, {
      type: 'open-unit-menu',
      unitId: 'unit-1',
      position: { x: 10, y: 20 },
    });
    const submenu = module.reduceMapInteraction(menu, {
      type: 'open-unit-submenu',
      kind: 'strategy',
    });

    expect(module.reduceMapInteraction(submenu, { type: 'back' })).toEqual(menu);
  });

  it('backs from targeting to the submenu that opened it', () => {
    expect(typeof module.reduceMapInteraction).toBe('function');
    if (!module.reduceMapInteraction) return;

    const menu = module.reduceMapInteraction(module.INITIAL_MAP_INTERACTION, {
      type: 'open-unit-menu',
      unitId: 'unit-1',
      position: { x: 10, y: 20 },
    });
    const submenu = module.reduceMapInteraction(menu, {
      type: 'open-unit-submenu',
      kind: 'facility',
    });
    const targeting = module.reduceMapInteraction(submenu, {
      type: 'start-targeting',
      kind: 'facility',
      payload: { facilityType: 'arrowTower' },
    });

    expect(module.reduceMapInteraction(targeting, { type: 'back' })).toEqual(submenu);
  });

  it('closes a first-level menu to idle', () => {
    expect(typeof module.reduceMapInteraction).toBe('function');
    if (!module.reduceMapInteraction) return;

    const menu = module.reduceMapInteraction(module.INITIAL_MAP_INTERACTION, {
      type: 'open-map-menu',
      position: { x: 10, y: 20 },
    });

    expect(module.reduceMapInteraction(menu, { type: 'back' })).toEqual(module.INITIAL_MAP_INTERACTION);
  });
});
