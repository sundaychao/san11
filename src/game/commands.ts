import { nextRandom } from './random';
import { ARMAMENT_GOLD_COST, ARMAMENT_LABELS, ARMAMENT_TYPES, armamentsOf, isDelayedArmament, produceArmamentYield, DELAYED_ARMAMENT_TEN_DAYS } from './armaments';
import { commandYieldMultiplier } from './skills/rules/city';
import type { City, ForceId, GameCommand, GameState, Officer } from './types';

export const COMMAND_AP = {
  develop: 20,
  recruit: 20,
  produceArmament: 20,
  train: 15,
  patrol: 15,
  talent: 20,
  transfer: 10,
} as const;

export const COMMAND_LABELS: Record<GameCommand['type'], string> = {
  develop: '开发',
  recruit: '征兵',
  produceArmament: '生产兵装',
  train: '训练',
  patrol: '巡察',
  talent: '人才',
  transfer: '调动',
};

export function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, Math.round(value)));
}

export function transferDistance(source: City, target: City) {
  return Math.abs(source.gridQ - target.gridQ) + Math.abs(source.gridR - target.gridR);
}

export function transferDuration(source: City, target: City) {
  return Math.max(1, Math.ceil(transferDistance(source, target) / 10));
}

function commandGoldCost(command: GameCommand) {
  switch (command.type) {
    case 'develop': return 500;
    case 'recruit': return 800;
    case 'produceArmament': return ARMAMENT_GOLD_COST;
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
  if (command.officerIds.length === 0) errors.push('至少调动一名武将');

  for (const officerId of command.officerIds) {
    const officer = state.officers[officerId];
    if (!officer || officer.forceId !== forceId || officer.location.kind !== 'city' || officer.location.cityId !== command.cityId) {
      errors.push('只能调动出发城市内的己方武将');
      break;
    }
    if (source?.governorId === officerId) {
      errors.push('太守不可调离任所');
      break;
    }
  }
  return errors;
}

function localOfficer(state: GameState, forceId: ForceId, command: Exclude<GameCommand, { type: 'transfer' }>) {
  const officer = state.officers[command.officerId];
  return officer?.forceId === forceId && officer.location.kind === 'city' && officer.location.cityId === command.cityId
    ? officer
    : undefined;
}

export function validateCommand(state: GameState, forceId: ForceId, command: GameCommand): string[] {
  const errors: string[] = [];
  const city = state.cities[command.cityId];
  if (state.phase !== 'playing') errors.push('本局已经结束');
  if (!city || city.ownerId !== forceId) errors.push('只能管理己方城市');

  if (command.type !== 'transfer') {
    const officer = localOfficer(state, forceId, command);
    if (!officer) {
      errors.push('武将不在目标城市');
    } else if (officer.acted) {
      errors.push(`${officer.name}本月已行动`);
    }
  }

  if (state.actionPoints[forceId] < COMMAND_AP[command.type]) {
    errors.push(`行动力不足 ${COMMAND_AP[command.type]}`);
  }
  if (!city) return [...new Set(errors)];

  const goldCost = commandGoldCost(command);
  if (city.gold < goldCost) errors.push(`资金不足 ${goldCost}`);
  if (command.type === 'recruit') {
    if (city.food < 500) errors.push('兵粮不足 500');
    if (city.population < 500) errors.push('人口不足 500');
  }
  if (command.type === 'train' && city.food < 300) errors.push('兵粮不足 300');
  if (command.type === 'produceArmament' && !ARMAMENT_TYPES.includes(command.armamentType)) {
    errors.push('兵装类型无效');
  }
  if (command.type === 'transfer') errors.push(...validateTransfer(state, forceId, command));
  return [...new Set(errors)];
}

function findLocalTalent(state: GameState, city: City) {
  return Object.values(state.officers).find((officer) =>
    officer.forceId === null && officer.location.kind === 'unaffiliated' && officer.location.cityId === city.id,
  );
}

function resolveTalentSearch(state: GameState, forceId: ForceId, city: City, officer: Officer) {
  const talent = findLocalTalent(state, city);
  const roll = nextRandom(state.seed, state.rngCursor);
  state.rngCursor = roll.cursor;
  const chance = Math.min(85, 35 + Math.floor(officer.stats.intelligence / 2)) / 100;
  if (talent && roll.value < chance) {
    talent.forceId = forceId;
    talent.location = { kind: 'city', cityId: city.id };
    talent.cityId = city.id;
    return `${officer.name}在${city.name}登用了${talent.name}`;
  }
  return talent
    ? `${officer.name}尝试登用${talent.name}，但未能登用`
    : `${officer.name}在${city.name}搜索人才，但一无所获`;
}

function applyTransfer(state: GameState, command: Extract<GameCommand, { type: 'transfer' }>) {
  const source = state.cities[command.cityId];
  const target = state.cities[command.targetCityId];
  const duration = transferDuration(source, target);
  const names: string[] = [];
  for (const officerId of command.officerIds) {
    const officer = state.officers[officerId];
    names.push(officer.name);
    officer.location = {
      kind: 'transfer',
      fromCityId: command.cityId,
      targetCityId: command.targetCityId,
      remainingTenDays: duration,
    };
    officer.cityId = command.cityId;
    officer.acted = true;
  }
  return `${source.name}向${target.name}调动${names.join('、')}，预计${duration}旬抵达`;
}

export function executeCommand(state: GameState, forceId: ForceId, command: GameCommand): GameState {
  const errors = validateCommand(state, forceId, command);
  if (errors.length > 0) throw new Error(errors.join('；'));

  const next = structuredClone(state);
  const city = next.cities[command.cityId];
  let message = '';
  next.battleDamageReports = [];
  next.cityEffectReports = [];
  next.strategyResultReports = [];

  switch (command.type) {
    case 'develop': {
      const officer = next.officers[command.officerId];
      city.gold -= 500;
      const gain = 4 + Math.floor(officer.stats.politics / 20);
      city[command.focus] = clamp(city[command.focus] + gain, 0, 100);
      const focusName = command.focus === 'commerce' ? '商业' : '农业';
      message = `${officer.name}开发${city.name}${focusName}，提升了${gain}点`;
      officer.acted = true;
      break;
    }
    case 'recruit': {
      const officer = next.officers[command.officerId];
      const baseGain = 300 + officer.stats.charisma * 10;
      const gain = Math.round(baseGain * commandYieldMultiplier(next, command));
      city.gold -= 800;
      city.food -= 500;
      city.population -= 500;
      city.troops += gain;
      city.order = clamp(city.order - 2, 0, 100);
      message = `${officer.name}在${city.name}征募士兵`;
      next.cityEffectReports = [{
        id: `city-effect-${next.month}-${next.logs.length}`,
        cityId: city.id,
        q: city.gridQ,
        r: city.gridR,
        amount: gain,
        label: '士兵',
        kind: 'recruit',
      }];
      officer.acted = true;
      break;
    }
    case 'produceArmament': {
      const officer = next.officers[command.officerId];
      const current = armamentsOf(city.armaments);
      const baseGain = produceArmamentYield(officer, command.armamentType);
      const gain = Math.round(baseGain * commandYieldMultiplier(next, command));
      city.gold -= ARMAMENT_GOLD_COST;
      if (isDelayedArmament(command.armamentType)) {
        officer.location = {
          kind: 'task',
          cityId: city.id,
          task: 'armament',
          armamentType: command.armamentType,
          amount: gain,
          remainingTenDays: DELAYED_ARMAMENT_TEN_DAYS,
        };
        message = `${officer.name}开始生产${city.name}${ARMAMENT_LABELS[command.armamentType]}，预计1个月完成`;
      } else {
        city.armaments = {
          ...current,
          [command.armamentType]: current[command.armamentType] + gain,
        };
        message = `${officer.name}生产${city.name}${ARMAMENT_LABELS[command.armamentType]}，增加了${gain.toLocaleString('en-US')}`;
        next.cityEffectReports = [{
          id: `city-effect-${next.month}-${next.logs.length}`,
          cityId: city.id,
          q: city.gridQ,
          r: city.gridR,
          amount: gain,
          label: ARMAMENT_LABELS[command.armamentType],
          kind: 'armament',
        }];
      }
      officer.acted = true;
      break;
    }
    case 'train': {
      const officer = next.officers[command.officerId];
      city.food -= 300;
      const gain = 5 + Math.floor(officer.stats.leadership / 20);
      city.training = clamp(city.training + gain, 0, 100);
      message = `${officer.name}训练${city.name}守军`;
      officer.acted = true;
      break;
    }
    case 'patrol': {
      const officer = next.officers[command.officerId];
      city.gold -= 300;
      const gain = 4 + Math.floor(officer.stats.charisma / 20);
      city.order = clamp(city.order + gain, 0, 100);
      message = `${officer.name}巡察${city.name}，安抚百姓`;
      officer.acted = true;
      break;
    }
    case 'talent': {
      const officer = next.officers[command.officerId];
      city.gold -= 500;
      message = resolveTalentSearch(next, forceId, city, officer);
      officer.acted = true;
      break;
    }
    case 'transfer':
      message = applyTransfer(next, command);
      break;
  }

  next.actionPoints[forceId] -= COMMAND_AP[command.type];
  next.logs.push({
    id: `command-${next.month}-${next.logs.length}`,
    month: next.month,
    forceId,
    message,
  });
  return next;
}
