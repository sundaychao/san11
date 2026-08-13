import type { GridCoord } from '../game/battle/grid';
import type { CityId, FacilityType } from '../game/types';

export interface ScreenPoint {
  x: number;
  y: number;
}

export interface UnitMenuInteraction {
  type: 'unit-menu';
  unitId: string;
  position: ScreenPoint;
  destination?: GridCoord;
}

export interface UnitSubmenuInteraction {
  type: 'unit-submenu';
  kind: 'tactic' | 'strategy' | 'facility' | 'intel';
  unitId: string;
  position: ScreenPoint;
  destination?: GridCoord;
  parent: UnitMenuInteraction;
}

export interface TargetingInteraction {
  type: 'targeting';
  kind: 'attack' | 'tactic' | 'strategy' | 'fire-plot' | 'facility' | 'repair';
  parent: UnitMenuInteraction | UnitSubmenuInteraction;
  payload?: Record<string, unknown>;
}

export type MapInteraction =
  | { type: 'idle' }
  | { type: 'city-menu'; cityId: CityId; position: ScreenPoint }
  | UnitMenuInteraction
  | UnitSubmenuInteraction
  | TargetingInteraction
  | { type: 'map-menu'; position: ScreenPoint }
  | { type: 'facility-menu'; facilityId: string; position: ScreenPoint };

export type MapInteractionAction =
  | { type: 'open-city-menu'; cityId: CityId; position: ScreenPoint }
  | { type: 'open-unit-menu'; unitId: string; position: ScreenPoint; destination?: GridCoord }
  | {
    type: 'open-unit-submenu';
    kind: UnitSubmenuInteraction['kind'];
    position?: ScreenPoint;
    destination?: GridCoord;
  }
  | { type: 'start-targeting'; kind: TargetingInteraction['kind']; payload?: Record<string, unknown> }
  | { type: 'open-map-menu'; position: ScreenPoint }
  | { type: 'open-facility-menu'; facilityId: string; position: ScreenPoint }
  | { type: 'back' }
  | { type: 'close' };

export const INITIAL_MAP_INTERACTION: MapInteraction = { type: 'idle' };

export function reduceMapInteraction(
  state: MapInteraction,
  action: MapInteractionAction,
): MapInteraction {
  switch (action.type) {
    case 'open-city-menu':
      return { type: 'city-menu', cityId: action.cityId, position: action.position };
    case 'open-unit-menu':
      return {
        type: 'unit-menu',
        unitId: action.unitId,
        position: action.position,
        destination: action.destination,
      };
    case 'open-unit-submenu':
      return state.type === 'unit-menu'
        ? {
          type: 'unit-submenu',
          kind: action.kind,
          unitId: state.unitId,
          position: action.position ?? state.position,
          destination: action.destination ?? state.destination,
          parent: state,
        }
        : state;
    case 'start-targeting':
      return state.type === 'unit-menu' || state.type === 'unit-submenu'
        ? { type: 'targeting', kind: action.kind, parent: state, payload: action.payload }
        : state;
    case 'open-map-menu':
      return { type: 'map-menu', position: action.position };
    case 'open-facility-menu':
      return { type: 'facility-menu', facilityId: action.facilityId, position: action.position };
    case 'back':
      if (state.type === 'targeting' || state.type === 'unit-submenu') return state.parent;
      return INITIAL_MAP_INTERACTION;
    case 'close':
      return INITIAL_MAP_INTERACTION;
    default:
      return state;
  }
}

export function facilityTypeFromTargeting(interaction: MapInteraction): FacilityType | null {
  if (interaction.type !== 'targeting' || interaction.kind !== 'facility') return null;
  const facilityType = interaction.payload?.facilityType;
  return typeof facilityType === 'string' ? facilityType as FacilityType : null;
}
