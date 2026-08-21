import { useCallback, useReducer } from 'react';
import type { GridCoord } from '../game/battle/grid';
import {
  INITIAL_MAP_INTERACTION,
  reduceMapInteraction,
  type UnitMenuInteraction,
  type UnitSubmenuInteraction,
} from './gameInteraction';

export interface UnitMenuInput {
  unitId: string;
  position: { x: number; y: number };
  destination?: GridCoord;
}

export function useUnitMenuInteraction() {
  const [unitInteraction, unitInteractionDispatch] = useReducer(reduceMapInteraction, INITIAL_MAP_INTERACTION);
  const unitCommandMenu: UnitMenuInteraction | null = unitInteraction.type === 'unit-menu'
    ? unitInteraction
    : unitInteraction.type === 'unit-submenu'
      ? unitInteraction.parent
      : null;
  const unitTacticMenu: UnitSubmenuInteraction | null = unitInteraction.type === 'unit-submenu' && unitInteraction.kind === 'tactic'
    ? unitInteraction
    : null;
  const unitStrategyMenu: UnitSubmenuInteraction | null = unitInteraction.type === 'unit-submenu' && unitInteraction.kind === 'strategy'
    ? unitInteraction
    : null;
  const unitFacilityMenu: UnitSubmenuInteraction | null = unitInteraction.type === 'unit-submenu' && unitInteraction.kind === 'facility'
    ? unitInteraction
    : null;

  const setUnitCommandMenu = useCallback((menu: UnitMenuInput | null) => {
    unitInteractionDispatch(menu
      ? { type: 'open-unit-menu', ...menu }
      : { type: 'close' });
  }, []);

  const setSubmenu = useCallback((kind: UnitSubmenuInteraction['kind'], menu: UnitMenuInput | null) => {
    if (menu) {
      unitInteractionDispatch({ type: 'open-unit-submenu', kind, ...menu });
      return;
    }
    if (unitInteraction.type === 'unit-submenu' && unitInteraction.kind === kind) {
      unitInteractionDispatch({ type: 'back' });
    }
  }, [unitInteraction]);

  const setUnitTacticMenu = useCallback((menu: UnitMenuInput | null) => {
    setSubmenu('tactic', menu);
  }, [setSubmenu]);

  const setUnitStrategyMenu = useCallback((menu: UnitMenuInput | null) => {
    setSubmenu('strategy', menu);
  }, [setSubmenu]);

  const setUnitFacilityMenu = useCallback((menu: UnitMenuInput | null) => {
    setSubmenu('facility', menu);
  }, [setSubmenu]);

  return {
    unitInteraction,
    unitCommandMenu,
    unitTacticMenu,
    unitStrategyMenu,
    unitFacilityMenu,
    setUnitCommandMenu,
    setUnitTacticMenu,
    setUnitStrategyMenu,
    setUnitFacilityMenu,
  };
}
