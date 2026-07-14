import { clamp } from './commands';
import { nextRandom } from './random';
import { FORCE_IDS } from './scenario/jingxiang208';
import type { City, GameState } from './types';

interface CityEvent {
  name: string;
  apply(city: City): void;
}

const EVENTS: CityEvent[] = [
  { name: '丰收', apply: (city) => { city.food += 3000; } },
  { name: '旱灾', apply: (city) => { city.food = Math.max(0, city.food - 3000); city.order = clamp(city.order - 2, 0, 100); } },
  { name: '商旅', apply: (city) => { city.gold += 1200; } },
  { name: '流民', apply: (city) => { city.population += 2000; city.order = clamp(city.order - 1, 0, 100); } },
  { name: '疫病', apply: (city) => { city.population = Math.max(0, city.population - 1500); city.troops = Math.max(0, city.troops - 500); city.order = clamp(city.order - 3, 0, 100); } },
  { name: '人才传闻', apply: () => undefined },
];

function applyPossibleEvent(state: GameState, city: City) {
  const roll = nextRandom(state.seed, state.rngCursor);
  state.rngCursor = roll.cursor;
  if (roll.value >= 0.18) return;

  const choice = nextRandom(state.seed, state.rngCursor);
  state.rngCursor = choice.cursor;
  const event = EVENTS[Math.floor(choice.value * EVENTS.length)];
  event.apply(city);
  state.logs.push({
    id: `event-${state.month}-${city.id}-${state.rngCursor}`,
    month: state.month,
    forceId: city.ownerId,
    message: `${city.name}发生${event.name}`,
  });
}

export function settleMonth(state: GameState): GameState {
  const next = structuredClone(state);
  for (const city of Object.values(next.cities)) {
    city.gold += Math.round(city.commerce * 20 + city.population / 100);
    city.food += Math.round(city.agriculture * 60 + city.population / 40);
    city.population += Math.floor((city.population * 0.005 * city.order) / 100);
    applyPossibleEvent(next, city);
  }
  for (const forceId of FORCE_IDS) next.actionPoints[forceId] = 80;
  for (const officer of Object.values(next.officers)) officer.acted = false;

  if (next.month === 24) {
    next.phase = 'finished';
    next.logs.push({ id: 'final-settlement', month: 24, forceId: null, message: '二十四个月经营期结束，开始结算国力。' });
  } else {
    next.month += 1;
    next.logs.push({ id: `month-${next.month}`, month: next.month, forceId: null, message: `进入建安十三年后的第${next.month}个月。` });
  }
  return next;
}
