import { nextRandom } from './random';
import type { City, ForceId, GameCommand, GameState, Officer } from './types';

export const COMMAND_AP = {
  develop: 20,
  recruit: 20,
  train: 15,
  patrol: 15,
  talent: 20,
  transfer: 10,
} as const;

export const COMMAND_LABELS: Record<GameCommand['type'], string> = {
  develop: '开发',
  recruit: '征兵',
  train: '训练',
  patrol: '巡察',
  talent: '人才',
  transfer: '调动',
};

export function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, Math.round(value)));
}

function commandGoldCost(command: GameCommand) {
  switch (command.type) {
    case 'develop': return 500;
    case 'recruit': return 800;
    case 'patrol': return 300;
    case 'talent': return 500;
    default: return 0;
  }
}

function validateTransfer(state: GameState, forceId: ForceId, command: Extract<GameCommand, { type: 'transfer' }>) {
  const errors: string[] = [];
  const source = state.cities[command.cityId];
  const target = state.cities[command.targetCityId];
  if (!target || target.ownerId !== forceId) errors.push('只能调往己方城市');
  if (command.targetCityId === command.cityId) errors.push('目标城市不能与出发城市相同');
  if ([command.gold, command.food, command.troops].some((value) => !Number.isFinite(value) || value < 0)) {
    errors.push('调动数值不能为负数');
  }
  if (source) {
    if (command.gold > source.gold) errors.push(`资金不足 ${command.gold}`);
    if (command.food > source.food) errors.push(`粮草不足 ${command.food}`);
    if (command.troops > source.troops) errors.push(`兵力不足 ${command.troops}`);
  }
  for (const officerId of command.officerIds) {
    const officer = state.officers[officerId];
    if (!officer || officer.forceId !== forceId || officer.cityId !== command.cityId) {
      errors.push('只能调动出发城市内的己方武将');
      break;
    }
  }
  return errors;
}

export function validateCommand(state: GameState, forceId: ForceId, command: GameCommand): string[] {
  const errors: string[] = [];
  const city = state.cities[command.cityId];
  const officer = state.officers[command.officerId];
  if (state.phase !== 'playing') errors.push('本局已经结束');
  if (!city || city.ownerId !== forceId) errors.push('只能管理己方城市');
  if (!officer || officer.forceId !== forceId || officer.cityId !== command.cityId) {
    errors.push('武将不在目标城市');
  } else if (officer.acted) {
    errors.push(`${officer.name}本月已行动`);
  }
  if (state.actionPoints[forceId] < COMMAND_AP[command.type]) {
    errors.push(`行动力不足 ${COMMAND_AP[command.type]}`);
  }
  if (!city) return errors;

  const goldCost = commandGoldCost(command);
  if (city.gold < goldCost) errors.push(`资金不足 ${goldCost}`);
  if (command.type === 'recruit') {
    if (city.food < 500) errors.push('粮草不足 500');
    if (city.population < 500) errors.push('人口不足 500');
  }
  if (command.type === 'train' && city.food < 300) errors.push('粮草不足 300');
  if (command.type === 'transfer') errors.push(...validateTransfer(state, forceId, command));
  return [...new Set(errors)];
}

function findLocalTalent(state: GameState, city: City) {
  return Object.values(state.officers).find((officer) => officer.forceId === null && officer.cityId === city.id);
}

function resolveTalentSearch(state: GameState, forceId: ForceId, city: City, officer: Officer) {
  const talent = findLocalTalent(state, city);
  const roll = nextRandom(state.seed, state.rngCursor);
  state.rngCursor = roll.cursor;
  const chance = Math.min(85, 35 + Math.floor(officer.stats.intelligence / 2)) / 100;
  if (talent && roll.value < chance) {
    talent.forceId = forceId;
    return `${officer.name}在${city.name}登用了${talent.name}`;
  }
  return talent
    ? `${officer.name}尝试登用${talent.name}，但未能登用`
    : `${officer.name}在${city.name}搜索人才，但一无所获`;
}

function applyTransfer(state: GameState, command: Extract<GameCommand, { type: 'transfer' }>) {
  const source = state.cities[command.cityId];
  const target = state.cities[command.targetCityId];
  source.gold -= command.gold;
  source.food -= command.food;
  source.troops -= command.troops;
  target.gold += command.gold;
  target.food += command.food;
  target.troops += command.troops;
  for (const officerId of command.officerIds) state.officers[officerId].cityId = command.targetCityId;
  return `${source.name}向${target.name}调动了物资与人员`;
}

export function executeCommand(state: GameState, forceId: ForceId, command: GameCommand): GameState {
  const errors = validateCommand(state, forceId, command);
  if (errors.length > 0) throw new Error(errors.join('；'));

  const next = structuredClone(state);
  const city = next.cities[command.cityId];
  const officer = next.officers[command.officerId];
  let message = '';

  switch (command.type) {
    case 'develop': {
      city.gold -= 500;
      const gain = 4 + Math.floor(officer.stats.politics / 20);
      city[command.focus] = clamp(city[command.focus] + gain, 0, 100);
      const focusName = command.focus === 'commerce' ? '商业' : '农业';
      message = `${officer.name}开发${city.name}${focusName}，提升了${gain}点`;
      break;
    }
    case 'recruit':
      city.gold -= 800;
      city.food -= 500;
      city.population -= 500;
      city.troops += 300 + officer.stats.charisma * 10;
      city.order = clamp(city.order - 2, 0, 100);
      message = `${officer.name}在${city.name}征募士兵`;
      break;
    case 'train': {
      city.food -= 300;
      const gain = 5 + Math.floor(officer.stats.leadership / 20);
      city.training = clamp(city.training + gain, 0, 100);
      message = `${officer.name}训练${city.name}守军`;
      break;
    }
    case 'patrol': {
      city.gold -= 300;
      const gain = 4 + Math.floor(officer.stats.charisma / 20);
      city.order = clamp(city.order + gain, 0, 100);
      message = `${officer.name}巡察${city.name}，安抚百姓`;
      break;
    }
    case 'talent':
      city.gold -= 500;
      message = resolveTalentSearch(next, forceId, city, officer);
      break;
    case 'transfer':
      message = applyTransfer(next, command);
      break;
  }

  next.actionPoints[forceId] -= COMMAND_AP[command.type];
  next.officers[command.officerId].acted = true;
  next.logs.push({
    id: `command-${next.month}-${next.logs.length}`,
    month: next.month,
    forceId,
    message,
  });
  return next;
}
