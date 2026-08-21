import type { StrategyId } from '../../battle/strategies';
import { gridKey, neighborsOf } from '../../battle/grid';
import type { GameState } from '../../types';

const CHAINABLE_STRATEGIES = new Set<StrategyId>(['false-report', 'disturb']);

export function canApplyChainStrategy(strategyId: StrategyId): boolean {
  return CHAINABLE_STRATEGIES.has(strategyId);
}

export interface ChainStrategyContext {
  state: GameState;
  casterId: string;
  originalTargetId: string;
  strategyId: StrategyId;
  sharedDuration: number;
  applySuccessfulStatus: (targetUnitId: string, duration: number) => void;
}

export function applyChainStrategyEffect({
  state,
  casterId,
  originalTargetId,
  strategyId,
  sharedDuration,
  applySuccessfulStatus,
}: ChainStrategyContext): string[] {
  if (!canApplyChainStrategy(strategyId)) return [];
  const caster = state.units[casterId];
  const originalTarget = state.units[originalTargetId];
  if (!caster || !originalTarget || originalTarget.forceId === caster.forceId) return [];

  const adjacentKeys = new Set(neighborsOf(originalTarget.q, originalTarget.r).map(gridKey));
  const chainedTargetIds = Object.values(state.units)
    .filter((unit) => (
      unit.id !== casterId &&
      unit.id !== originalTargetId &&
      unit.kind !== 'transport' &&
      unit.forceId !== caster.forceId &&
      adjacentKeys.has(gridKey(unit))
    ))
    .map((unit) => unit.id)
    .sort((a, b) => a.localeCompare(b));
  const targetIds = [originalTargetId, ...chainedTargetIds];

  for (const targetId of targetIds) applySuccessfulStatus(targetId, sharedDuration);
  return targetIds;
}
