import { emptyArmaments, initialArmaments } from '../armaments';
import { gridKey, neighborsOf } from '../battle/grid';
import { derivePersonality } from '../debate';
import { initCityPopulation, initConstructionPlots } from '../innerAffairs';
import { DEFAULT_OFFICER_LOYALTY, LEADER_INITIAL_LOYALTY } from '../loyalty';
import { INITIAL_OFFICER_MERIT, rankForCityCount } from '../ranks';
import { TREASURES } from '../treasures';
import type { CityArmaments, City, CityId, Force, ForceId, GameState, Officer, Pass, PassId, TreasureState } from '../types';
import type { EditorMapPayload, EditorStrongholdMarker } from '../map-editor/editor';
import {
  DEFAULT_CITY_ECONOMY,
  SCENARIO_FORCES,
  defaultAptitudes,
  officerBirthYears,
  officerPersonalities,
  officerProfiles,
  officerSeeds,
} from './jingxiang208';

const CITY_MAX_DURABILITY = 3000;
/** 关隘初始资源（有主关隘）：2000兵/1000金/10000粮/枪戟箭马各500 */
const PASS_INITIAL_GOLD = 1000;
const PASS_INITIAL_FOOD = 10_000;
const PASS_INITIAL_TROOPS = 2000;
const PASS_INITIAL_TRAINING = 100;
const PASS_MAX_DURABILITY = 3000;
const PASS_INITIAL_ARMAMENTS: CityArmaments = { spear: 500, halberd: 500, crossbow: 500, cavalry: 500, ram: 0, tower: 0, ship: 0 };

function toRecord<T extends { id: string }>(items: T[]): Record<string, T> {
  return Object.fromEntries(items.map((item) => [item.id, item]));
}

/** 构建武将（沿用 createGame 的出生年/忠诚/性格/特技逻辑） */
function buildOfficer(
  seed: (typeof officerSeeds)[number],
  forceId: ForceId | null,
  cityId: CityId,
): Officer {
  const profile = officerProfiles[seed.id];
  const personality = officerPersonalities[seed.id];
  const force = forceId ? SCENARIO_FORCES[forceId] : undefined;
  return {
    ...seed,
    cityId,
    forceId,
    birthYear: officerBirthYears[seed.id],
    loyalty: seed.forceId === null ? 0 : force?.leaderId === seed.id ? LEADER_INITIAL_LOYALTY : DEFAULT_OFFICER_LOYALTY,
    merit: seed.merit ?? INITIAL_OFFICER_MERIT,
    ambition: personality?.ambition ?? 50,
    righteousness: personality?.righteousness ?? 55,
    location: { kind: forceId === null ? 'unaffiliated' : 'city', cityId },
    stats: { ...seed.stats },
    personality: derivePersonality(seed.stats),
    skill: profile?.skill ?? '无',
    aptitudes: { ...(profile?.aptitudes ?? defaultAptitudes) },
    acted: false,
  } as Officer;
}

/** 关隘初始化：归属=最近城池所有者的主/无主；无主关隘兵力/资源为 0 */
export function createScenarioPassesFromMarkers(
  state: Pick<GameState, 'cities' | 'grid'>,
  passMarkers: EditorStrongholdMarker[],
): Record<PassId, Pass> {
  const passCellKeys = new Set(
    state.grid.filter((cell) => cell.terrain === 'pass').map((cell) => gridKey(cell)),
  );
  const cityList = Object.values(state.cities);
  const toAxialR = (q: number, r: number) => r - Math.floor(q / 2);
  const hexDistance = (q1: number, r1: number, q2: number, r2: number) =>
    (Math.abs(q1 - q2) + Math.abs(toAxialR(q1, r1) - toAxialR(q2, r2)) + Math.abs((q1 - q2) + (toAxialR(q1, r1) - toAxialR(q2, r2)))) / 2;

  const result = {} as Record<PassId, Pass>;
  passMarkers.forEach((marker, index) => {
    const id = marker.id as PassId;
    const homeCity = cityList
      .map((city) => ({ city, distance: hexDistance(marker.q, marker.r, city.gridQ, city.gridR) }))
      .sort((a, b) => a.distance - b.distance)[0]?.city;
    const ownerId: ForceId | null = homeCity?.ownerId ?? null;
    const occupied = ownerId !== null;
    const flankKeys = neighborsOf(marker.q, marker.r)
      .filter((n) => passCellKeys.has(gridKey(n)))
      .map(gridKey);
    result[id] = {
      id,
      name: marker.label,
      homeCityId: (homeCity?.id ?? cityList[0]?.id ?? marker.id) as CityId,
      ownerId,
      governorId: null,
      gold: occupied ? PASS_INITIAL_GOLD : 0,
      food: occupied ? PASS_INITIAL_FOOD : 0,
      population: 40_000 + (index % 40_000),
      troops: occupied ? PASS_INITIAL_TROOPS : 0,
      training: occupied ? PASS_INITIAL_TRAINING : 0,
      order: 100,
      durability: PASS_MAX_DURABILITY,
      maxDurability: PASS_MAX_DURABILITY,
      armaments: occupied ? { ...PASS_INITIAL_ARMAMENTS } : emptyArmaments(),
      trainedThisTenDay: false,
      patrolledThisTenDay: false,
      q: marker.q,
      r: marker.r,
      flankKeys,
    } as Pass;
  });
  return result;
}

/** 按城市数量初始化爵位（月末前生效，供官职按爵位解锁） */
export function assignInitialRanks(state: GameState): void {
  for (const force of Object.values(state.forces)) {
    const cityCount = Object.values(state.cities).filter((city) => city.ownerId === force.id).length;
    force.rank = rankForCityCount(cityCount).id;
  }
}

/**
 * 自定义地图场景生成器：以地图标记（城池/关隘 + 势力归属）生成完整可玩 GameState。
 * - 只在「有主城池」中出现的势力会获得武将（round-robin 分配到该势力城池，君主任首城太守）；
 * - 无主城池无守军（可直接进驻），无主关隘兵力/资源为 0；
 * - 沿用现有 4 势力池，非上场势力的武将不入局。
 */
export function createGameFromMap(
  map: EditorMapPayload,
  playerForceId: ForceId,
  seed = Date.now(),
): GameState {
  const { grid, width, height } = map;
  const cityMarkers = map.cities.filter((marker) => marker.type !== 'pass');
  const passMarkers = map.cities.filter((marker) => marker.type === 'pass');

  const usedForceIds = [...new Set(
    cityMarkers.map((marker) => marker.forceId).filter((f): f is ForceId => f !== null && f !== undefined),
  )];
  if (usedForceIds.length === 0) throw new Error('自定义地图没有任何有主城池');
  if (!usedForceIds.includes(playerForceId)) throw new Error('所选势力在该地图没有城池');

  // 势力沿用内置 4 势力；爵位稍后按城市数量初始化
  const initialForces = structuredClone(SCENARIO_FORCES) as Record<ForceId, Force>;

  // 城池：由标记生成，资源沿用新建城默认；无主城无守军
  const cities = {} as Record<CityId, City>;
  cityMarkers.forEach((marker, index) => {
    const id = marker.id as CityId;
    const ownerId: ForceId | null = marker.forceId ?? null;
    cities[id] = {
      id,
      name: marker.label,
      ownerId,
      governorId: null,
      ...DEFAULT_CITY_ECONOMY,
      troops: ownerId === null ? 0 : DEFAULT_CITY_ECONOMY.troops,
      mapX: (marker.q + 0.5) / width,
      mapY: (marker.r + 0.5) / height,
      gridQ: marker.q,
      gridR: marker.r,
      durability: CITY_MAX_DURABILITY,
      maxDurability: CITY_MAX_DURABILITY,
      armaments: initialArmaments(),
      grainPrice: 3 + (index % 5),
      merchantPresent: index % 4 === 2,
    } as City;
  });

  // 武将补足：各势力武将 round-robin 分配到该势力城池
  const forceCities = new Map<ForceId, CityId[]>();
  for (const city of Object.values(cities)) {
    if (city.ownerId) {
      const list = forceCities.get(city.ownerId) ?? [];
      list.push(city.id);
      forceCities.set(city.ownerId, list);
    }
  }
  const cursor: Record<string, number> = {};
  const officers = {} as Record<string, Officer>;
  for (const seedOfficer of officerSeeds) {
    if (seedOfficer.forceId) {
      const ownCities = forceCities.get(seedOfficer.forceId);
      if (!ownCities || ownCities.length === 0) continue; // 势力未上场则跳过其武将
      const bucket = cursor[seedOfficer.forceId] ?? 0;
      cursor[seedOfficer.forceId] = bucket + 1;
      const cityId = ownCities[bucket % ownCities.length];
      officers[seedOfficer.id] = buildOfficer(seedOfficer, seedOfficer.forceId, cityId);
      // 君主担任其首府城池太守（供各指令据点锚定）
      if (SCENARIO_FORCES[seedOfficer.forceId].leaderId === seedOfficer.id) {
        cities[cityId].governorId = seedOfficer.id;
      }
    } else {
      // 在野武将：保留 unaffiliated，挂靠自定义地图第一座城池
      const anyCity = Object.keys(cities)[0] as CityId;
      officers[seedOfficer.id] = buildOfficer(seedOfficer, null, anyCity);
    }
  }

  const passes = createScenarioPassesFromMarkers({ cities, grid }, passMarkers);

  const state: GameState = {
    schemaVersion: 2,
    scenarioId: 'custom-map',
    seed: seed >>> 0,
    rngCursor: 0,
    month: 1,
    tenDay: 1,
    turnForceId: playerForceId,
    playerForceId,
    phase: 'playing',
    actionPoints: { cao: 80, liu: 80, sun: 80, biao: 80 },
    forces: initialForces,
    cities,
    officers,
    grid,
    gridWidth: width,
    gridHeight: height,
    units: {},
    passes,
    treasures: toRecord(TREASURES.map((treasure): TreasureState => ({
      id: treasure.id,
      ownerId: null,
      cityId: null,
      holderId: null,
    }))),
    battleDamageReports: [],
    cityEffectReports: [],
    logs: [
      {
        id: 'opening',
        month: 1,
        forceId: null,
        message: `基于「${map.name ?? '自定义地图'}」开始新的征程。`,
      },
    ],
  };

  assignInitialRanks(state);
  // 建设用地：自定义图无 interior → 走现成 fallback 在城址外围自动搜索空地
  initConstructionPlots(state);
  initCityPopulation(state);
  return state;
}

/** 某地图有主城池所使用的势力（供势力选择界面列出） */
export function forcesOfMap(map: EditorMapPayload): ForceId[] {
  const used = new Set<ForceId>();
  for (const marker of map.cities) {
    if (marker.type === 'pass') continue;
    if (marker.forceId) used.add(marker.forceId);
  }
  return [...used];
}