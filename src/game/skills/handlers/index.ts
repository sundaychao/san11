import type { StrategyId } from '../../battle/strategies';
import type { ComplexHandlerId } from '../types';
import {
  applyChainStrategyEffect,
  canApplyChainStrategy,
  type ChainStrategyContext,
} from './chainStrategy';

export interface ComplexStrategyHandler {
  canApply: (strategyId: StrategyId) => boolean;
  apply: (context: ChainStrategyContext) => string[];
}

export const COMPLEX_HANDLER_REGISTRY = {
  chainStrategy: {
    canApply: canApplyChainStrategy,
    apply: applyChainStrategyEffect,
  },
} satisfies Record<ComplexHandlerId, ComplexStrategyHandler>;

export function complexHandlerById(id: ComplexHandlerId): ComplexStrategyHandler {
  return COMPLEX_HANDLER_REGISTRY[id];
}

export { applyChainStrategyEffect, canApplyChainStrategy };
export type { ChainStrategyContext };
