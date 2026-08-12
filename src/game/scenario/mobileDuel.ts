import { initialArmaments } from '../armaments';
import type { City, CityId, ForceId, GameState, GridCell, Officer } from '../types';
import { createGame } from './jingxiang208';

export const MOBILE_DUEL_GRID_WIDTH = 16;
export const MOBILE_DUEL_GRID_HEIGHT = 33;

const TOP_CITY_ID: CityId = 'xiangyang';
const BOTTOM_CITY_ID: CityId = 'jiangling';
const TOP_CITY_CENTER = { q: 8, r: 3 };
const BOTTOM_CITY_CENTER = { q: 8, r: 29 };
const CENTER_ROAD_R = Math.floor(MOBILE_DUEL_GRID_HEIGHT / 2);

function createMobileDuelGrid(): GridCell[] {
  const cells: GridCell[] = [];
  for (let r = 0; r < MOBILE_DUEL_GRID_HEIGHT; r += 1) {
    for (let q = 0; q < MOBILE_DUEL_GRID_WIDTH; q += 1) {
      const onCenterRoad = q === 8 || (r === CENTER_ROAD_R && q >= 4 && q <= 12);
      cells.push({ q, r, terrain: onCenterRoad ? 'road' : 'plain' });
    }
  }
  return cells;
}

function cityForDuel(base: City, ownerId: ForceId, center: { q: number; r: number }, governorId: string | null): City {
  return {
    ...base,
    ownerId,
    governorId,
    gold: 10000,
    food: 50000,
    population: 100000,
    troops: 20000,
    commerce: 60,
    agriculture: 60,
    order: 85,
    training: 75,
    mapX: (center.q + 0.5) / MOBILE_DUEL_GRID_WIDTH,
    mapY: center.r / MOBILE_DUEL_GRID_HEIGHT,
    gridQ: center.q,
    gridR: center.r,
    maxDurability: 3000,
    durability: 3000,
    armaments: initialArmaments(),
  };
}

function duelOfficer(officer: Officer, cityId: CityId): Officer {
  return {
    ...officer,
    cityId,
    location: { kind: 'city', cityId },
    acted: false,
  };
}

export function createMobileDuelGame(bottomForceId: ForceId, topForceId: ForceId, seed = Date.now()): GameState {
  if (bottomForceId === topForceId) throw new Error('手机双人地图需要两个不同势力');

  const base = createGame(bottomForceId, seed);
  const forceCityIds: Record<ForceId, CityId | undefined> = {
    cao: undefined,
    liu: undefined,
    sun: undefined,
    biao: undefined,
  };
  forceCityIds[bottomForceId] = BOTTOM_CITY_ID;
  forceCityIds[topForceId] = TOP_CITY_ID;

  const officers = Object.fromEntries(Object.values(base.officers)
    .filter((officer) => officer.forceId && forceCityIds[officer.forceId])
    .map((officer) => [officer.id, duelOfficer(officer, forceCityIds[officer.forceId!]!)]));
  const bottomLeaderId = base.forces[bottomForceId].leaderId;
  const topLeaderId = base.forces[topForceId].leaderId;

  return {
    ...base,
    scenarioId: 'mobile-duel',
    gridWidth: MOBILE_DUEL_GRID_WIDTH,
    gridHeight: MOBILE_DUEL_GRID_HEIGHT,
    turnForceId: bottomForceId,
    playerForceId: bottomForceId,
    actionPoints: { cao: 80, liu: 80, sun: 80, biao: 80 },
    cities: {
      [BOTTOM_CITY_ID]: cityForDuel(base.cities[BOTTOM_CITY_ID], bottomForceId, BOTTOM_CITY_CENTER, bottomLeaderId),
      [TOP_CITY_ID]: cityForDuel(base.cities[TOP_CITY_ID], topForceId, TOP_CITY_CENTER, topLeaderId),
    } as Record<CityId, City>,
    officers,
    grid: createMobileDuelGrid(),
    units: {},
    battleDamageReports: [],
    cityEffectReports: [],
    logs: [{
      id: 'mobile-duel-opening',
      month: 1,
      forceId: null,
      message: '手机双人对战开始，双方城池隔图相望。',
    }],
  };
}
