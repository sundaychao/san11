import { describe, expect, it } from 'vitest';
import { unitStrategies, type StrategyId } from '../../battle/actions';
import { neighborsOf } from '../../battle/grid';
import { createGame } from '../../scenario/jingxiang208';
import type { ArmyUnit, GameState } from '../../types';
import { STRATEGY_SKILLS } from '../catalog/strategy';
import * as skillExports from '../index';

interface StrategySkillRules {
  energyCost: number;
  guaranteed: boolean;
  immune: boolean;
  fireDamageMultiplier: number;
  chain: boolean;
}

type ResolveStrategySkillRules = (
  state: GameState,
  caster: ArmyUnit,
  target: ArmyUnit | undefined,
  strategyId: StrategyId,
  baseCost: number,
) => StrategySkillRules;

interface ChainStrategyContext {
  state: GameState;
  casterId: string;
  originalTargetId: string;
  strategyId: StrategyId;
  sharedDuration: number;
  applySuccessfulStatus: (targetUnitId: string, duration: number) => void;
}

type ApplyChainStrategyEffect = (context: ChainStrategyContext) => string[];

const resolveStrategySkillRules = (skillExports as typeof skillExports & {
  resolveStrategySkillRules?: ResolveStrategySkillRules;
}).resolveStrategySkillRules;

const applyChainStrategyEffect = (skillExports as typeof skillExports & {
  applyChainStrategyEffect?: ApplyChainStrategyEffect;
}).applyChainStrategyEffect;

function strategyFixture(casterSkill = '无', targetSkill = '无') {
  const state = createGame('liu', 1);
  state.officers['zhuge-liang'].skill = casterSkill;
  state.officers['zhuge-liang'].location = { kind: 'unit', unitId: 'caster' };
  state.officers['cao-ren'].skill = targetSkill;
  state.officers['cao-ren'].location = { kind: 'unit', unitId: 'target' };
  state.units = {
    caster: {
      id: 'caster', kind: 'combat', forceId: 'liu', leaderId: 'zhuge-liang', officerIds: ['zhuge-liang'],
      homeCityId: 'jiangling', troopType: 'spear', q: 10, r: 10, troops: 5000, food: 5000,
      energy: 100, movementRemaining: 20, moved: false, acted: false,
    },
    target: {
      id: 'target', kind: 'combat', forceId: 'cao', leaderId: 'cao-ren', officerIds: ['cao-ren'],
      homeCityId: 'xiangyang', troopType: 'spear', q: 11, r: 10, troops: 5000, food: 5000,
      energy: 100, movementRemaining: 20, moved: false, acted: false,
    },
  };
  return { state, caster: state.units.caster, target: state.units.target };
}

function rulesFor(
  state: GameState,
  caster: ArmyUnit,
  target: ArmyUnit | undefined,
  strategyId: StrategyId,
  baseCost: number,
) {
  expect(resolveStrategySkillRules).toBeTypeOf('function');
  return resolveStrategySkillRules?.(state, caster, target, strategyId, baseCost);
}

describe('strategy officer skill rules', () => {
  it('activates exactly 百出、火神、洞察、连环 in this strategy phase', () => {
    expect(STRATEGY_SKILLS
      .filter((definition) => definition.implementationStatus === 'active')
      .map((definition) => definition.name)).toEqual(['洞察', '火神', '百出', '连环']);
  });

  it('sets every implemented strategy cost to one when 百出 comes from a deputy', () => {
    const { state, caster } = strategyFixture();
    state.officers['liu-bei'].skill = '百出';
    state.officers['liu-bei'].location = { kind: 'unit', unitId: caster.id };
    caster.officerIds = ['zhuge-liang', 'liu-bei'];

    for (const strategy of unitStrategies()) {
      expect(rulesFor(state, caster, undefined, strategy.id, strategy.cost)?.energyCost).toBe(1);
    }
    expect(rulesFor(state, caster, undefined, 'fire', 0)?.energyCost).toBe(0);
  });

  it('guarantees 火神 fire only against an occupied strictly less-intelligent target', () => {
    const { state, caster, target } = strategyFixture('火神');
    state.officers['zhuge-liang'].stats.intelligence = 90;
    state.officers['cao-ren'].stats.intelligence = 89;

    expect(rulesFor(state, caster, target, 'fire', 10)).toMatchObject({
      guaranteed: true,
      fireDamageMultiplier: 2,
    });
    state.officers['cao-ren'].stats.intelligence = 90;
    expect(rulesFor(state, caster, target, 'fire', 10)?.guaranteed).toBe(false);
    expect(rulesFor(state, caster, undefined, 'fire', 10)?.guaranteed).toBe(false);
  });

  it('limits 火神 and 洞察 immunity to hostile implemented unit strategies', () => {
    const fireDefense = strategyFixture('无', '火神');
    expect(rulesFor(fireDefense.state, fireDefense.caster, fireDefense.target, 'fire', 10)?.immune).toBe(true);
    expect(rulesFor(fireDefense.state, fireDefense.caster, fireDefense.target, 'disturb', 15)?.immune).toBe(false);

    const insight = strategyFixture('无', '洞察');
    for (const strategyId of ['fire', 'false-report', 'disturb', 'discord'] as const) {
      expect(rulesFor(insight.state, insight.caster, insight.target, strategyId, 15)?.immune).toBe(true);
    }

    insight.target.forceId = insight.caster.forceId;
    expect(rulesFor(insight.state, insight.caster, insight.target, 'calm', 10)?.immune).toBe(false);
    expect(rulesFor(insight.state, insight.caster, insight.target, 'inspire', 10)?.immune).toBe(false);
  });

  it('enables 连环 only for successful-status strategy kinds with a unit target', () => {
    const { state, caster, target } = strategyFixture('连环');
    expect(rulesFor(state, caster, target, 'false-report', 15)?.chain).toBe(true);
    expect(rulesFor(state, caster, target, 'disturb', 15)?.chain).toBe(true);
    for (const strategyId of ['fire', 'extinguish', 'calm', 'inspire', 'discord'] as const) {
      expect(rulesFor(state, caster, target, strategyId, 10)?.chain).toBe(false);
    }
    expect(rulesFor(state, caster, undefined, 'disturb', 15)?.chain).toBe(false);
  });

  it('applies the original chain target first, then adjacent enemies by unit id with one shared duration', () => {
    const { state, target } = strategyFixture('连环');
    const chainCells = neighborsOf(target.q, target.r)
      .filter((coord) => coord.q !== state.units.caster.q || coord.r !== state.units.caster.r);
    state.units['z-chain'] = { ...target, id: 'z-chain', q: chainCells[0].q, r: chainCells[0].r };
    state.units['a-chain'] = { ...target, id: 'a-chain', q: chainCells[1].q, r: chainCells[1].r };
    state.units['friendly-chain'] = {
      ...target, id: 'friendly-chain', forceId: 'liu', q: chainCells[2].q, r: chainCells[2].r,
    };
    state.units['distant-chain'] = { ...target, id: 'distant-chain', q: 20, r: 20 };
    state.rngCursor = 7;
    const applied: Array<{ id: string; duration: number }> = [];

    expect(applyChainStrategyEffect).toBeTypeOf('function');
    const targetIds = applyChainStrategyEffect?.({
      state,
      casterId: 'caster',
      originalTargetId: 'target',
      strategyId: 'disturb',
      sharedDuration: 3,
      applySuccessfulStatus: (id, duration) => applied.push({ id, duration }),
    });

    expect(targetIds).toEqual(['target', 'a-chain', 'z-chain']);
    expect(applied).toEqual([
      { id: 'target', duration: 3 },
      { id: 'a-chain', duration: 3 },
      { id: 'z-chain', duration: 3 },
    ]);
    expect(state.rngCursor).toBe(7);
  });

  it('does not invoke the chain handler for unsupported strategies', () => {
    const { state } = strategyFixture('连环');
    const applied: string[] = [];
    expect(applyChainStrategyEffect).toBeTypeOf('function');

    for (const strategyId of ['fire', 'extinguish', 'calm', 'inspire', 'discord'] as const) {
      expect(applyChainStrategyEffect?.({
        state,
        casterId: 'caster',
        originalTargetId: 'target',
        strategyId,
        sharedDuration: 2,
        applySuccessfulStatus: (id) => applied.push(id),
      })).toEqual([]);
    }
    expect(applied).toEqual([]);
  });
});
