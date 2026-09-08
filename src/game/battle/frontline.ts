import type { ArmyUnit, GameState, TerrainType } from '../types';
import { cellAt } from './movementRules';
import { areAdjacent } from './targetRules';

/** 战线宽度：普通地形 4000，毒泉/森林/渡所 3000，栈道/小径 2000 */
const NARROW_FRONT_WIDTH = 3000;
const PLANK_FRONT_WIDTH = 2000;
export const DEFAULT_FRONT_WIDTH = 4000;

const FRONT_WIDTH_BY_TERRAIN: Partial<Record<TerrainType, number>> = {
  poison: NARROW_FRONT_WIDTH,
  forest: NARROW_FRONT_WIDTH,
  ferry: NARROW_FRONT_WIDTH,
  plank: PLANK_FRONT_WIDTH,
  path: PLANK_FRONT_WIDTH,
};

export function frontWidthForTerrain(terrain: TerrainType): number {
  return FRONT_WIDTH_BY_TERRAIN[terrain] ?? DEFAULT_FRONT_WIDTH;
}

/**
 * 战线分摊数：攻击方邻接的敌方部队数，加上未邻接的攻击目标（远程目标也占一条战线）。
 * 骑兵不分摊战线，恒为 1。
 */
export function frontCount(state: GameState, attacker: ArmyUnit, target?: ArmyUnit): number {
  if (attacker.troopType === 'cavalry') return 1;
  const count = Object.values(state.units).filter((unit) => (
    unit.id !== attacker.id &&
    unit.forceId !== attacker.forceId &&
    (areAdjacent(unit, attacker) || unit.id === target?.id)
  )).length;
  return Math.max(1, count);
}

/**
 * 攻击投入兵力 = Min(兵力 ÷ 战线分摊数, 战线宽度)。
 * 骑兵免分摊（投入 = Min(兵力, 战线宽度)）；战线宽度按攻击方所站地形决定。
 */
export function committedTroops(state: GameState, attacker: ArmyUnit, target?: ArmyUnit): number {
  const terrain = cellAt(state, attacker)?.terrain ?? 'plain';
  const width = frontWidthForTerrain(terrain);
  const count = frontCount(state, attacker, target);
  return Math.min(attacker.troops / count, width);
}
