import { effectsOfKind } from '../stacking';
import { resolveCitySkills, resolveCommandSkills } from '../sources';
import type { CityId, GameCommand, GameState } from '../../types';

export function commandYieldMultiplier(state: GameState, command: GameCommand) {
  return effectsOfKind(resolveCommandSkills(state, command), 'commandYieldMultiplier')
    .filter(({ effect }) => effect.command === command.type)
    .filter(({ effect }) => command.type !== 'produceArmament'
      || !effect.armamentTypes
      || effect.armamentTypes.includes(command.armamentType))
    .reduce((highest, { effect }) => Math.max(highest, effect.multiplier), 1);
}

/** 兵器/舰船生产速度倍率（发明/造船：生产日数 ÷ 倍率） */
export function armamentProductionSpeedMultiplier(state: GameState, command: Extract<GameCommand, { type: 'produceArmament' }>) {
  return effectsOfKind(resolveCommandSkills(state, command), 'armamentProductionSpeed')
    .filter(({ effect }) => !effect.armamentTypes || effect.armamentTypes.includes(command.armamentType))
    .reduce((highest, { effect }) => Math.max(highest, effect.multiplier), 1);
}

export function cityIncomeMultiplier(state: GameState, cityId: CityId, resource: 'gold' | 'food') {
  return effectsOfKind(resolveCitySkills(state, cityId), 'cityIncomeMultiplier')
    .filter(({ effect }) => effect.resource === resource)
    .reduce((highest, { effect }) => Math.max(highest, effect.multiplier), 1);
}
