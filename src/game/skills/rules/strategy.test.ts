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
  complexHandlerIds: string[];
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

const complexHandlerRegistry = (skillExports as typeof skillExports & {
  COMPLEX_HANDLER_REGISTRY?: Record<string, {
    canApply: (strategyId: StrategyId) => boolean;
    apply: ApplyChainStrategyEffect;
  }>;
}).COMPLEX_HANDLER_REGISTRY;

const complexHandlerById = (skillExports as typeof skillExports & {
  complexHandlerById?: (id: string) => {
    canApply: (strategyId: StrategyId) => boolean;
    apply: ApplyChainStrategyEffect;
  };
}).complexHandlerById;

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
  it('registers every complexHandler id declared by active skill metadata', () => {
    const metadataHandlerIds = [...new Set(STRATEGY_SKILLS
      .flatMap((definition) => definition.effects)
      .filter((effect) => effect.kind === 'complexHandler')
      .map((effect) => effect.handler))].sort();

    expect(complexHandlerRegistry).toBeTypeOf('object');
    expect(Object.keys(complexHandlerRegistry ?? {}).sort()).toEqual(metadataHandlerIds);
    expect(complexHandlerById).toBeTypeOf('function');
    for (const handlerId of metadataHandlerIds) {
      expect(complexHandlerById?.(handlerId)).toBe(complexHandlerRegistry?.[handlerId]);
    }
  });

  it('activates the planned strategy skills in this strategy phase', () => {
    expect(STRATEGY_SKILLS
      .filter((definition) => definition.implementationStatus === 'active')
      .map((definition) => definition.name)).toEqual([
      '火攻', '言毒', '机智', '诡计', '虚实', '妙计', '秘计', '看破', '洞察', '火神', '神算', '百出', '鬼谋',
      '连环', '深谋', '反计', '倾国',
    ]);
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

  it('guarantees 火攻/言毒/机智/诡计/虚实 against strictly less-intelligent targets', () => {
    const cases: Array<{ skill: string; strategyId: StrategyId }> = [
      { skill: '火攻', strategyId: 'fire' },
      { skill: '言毒', strategyId: 'false-report' },
      { skill: '机智', strategyId: 'disturb' },
      { skill: '诡计', strategyId: 'discord' },
      { skill: '虚实', strategyId: 'false-report' },
    ];
    for (const { skill, strategyId } of cases) {
      const { state, caster, target } = strategyFixture(skill);
      state.officers['zhuge-liang'].stats.intelligence = 95;
      state.officers['cao-ren'].stats.intelligence = 80;
      expect(rulesFor(state, caster, target, strategyId, 15)?.guaranteed, `${skill} 对低智力目标应必中`).toBe(true);

      state.officers['cao-ren'].stats.intelligence = 96;
      expect(rulesFor(state, caster, target, strategyId, 15)?.guaranteed, `${skill} 对高智力目标不得必中`).toBe(false);
    }
  });

  it('guarantees 虚实/神算 for every hostile unit strategy against lower intelligence', () => {
    for (const skill of ['虚实', '神算']) {
      const { state, caster, target } = strategyFixture(skill);
      state.officers['zhuge-liang'].stats.intelligence = 100;
      state.officers['cao-ren'].stats.intelligence = 50;
      for (const strategyId of ['fire', 'false-report', 'disturb', 'discord'] as const) {
        expect(rulesFor(state, caster, target, strategyId, 15)?.guaranteed, `${skill} 对${strategyId}应必中`).toBe(true);
      }
    }
  });

  it('serves 看破 as conditional immunity against lower-intelligence hostile casts', () => {
    const { state, caster, target } = strategyFixture('无', '看破');
    state.officers['zhuge-liang'].stats.intelligence = 90;
    state.officers['cao-ren'].stats.intelligence = 100;
    for (const strategyId of ['false-report', 'disturb', 'discord'] as const) {
      expect(rulesFor(state, caster, target, strategyId, 15)?.immune).toBe(true);
    }
    state.officers['zhuge-liang'].stats.intelligence = 101;
    expect(rulesFor(state, caster, target, 'disturb', 15)?.immune).toBe(false);
  });

  it('grants 神算 the success bonus and 鬼谋 the range bonus', () => {
    const deliberate = strategyFixture('神算');
    expect(rulesFor(deliberate.state, deliberate.caster, deliberate.target, 'disturb', 15))
      .toMatchObject({ successBonus: 10, rangeBonus: 0 });
    const range = strategyFixture('鬼谋');
    expect(rulesFor(range.state, range.caster, range.target, 'disturb', 15))
      .toMatchObject({ successBonus: 0, rangeBonus: 1 });
  });

  it('marks 深谋/秘计 as critical on hostile strategy casts', () => {
    const deep = strategyFixture('深谋');
    deep.state.officers['cao-ren'].stats.intelligence = 10;
    expect(rulesFor(deep.state, deep.caster, deep.target, 'disturb', 15)?.critical).toBe(true);
    deep.state.officers['cao-ren'].stats.intelligence = 90;
    expect(rulesFor(deep.state, deep.caster, deep.target, 'disturb', 15)?.critical).toBe(true);

    const secret = strategyFixture('秘计');
    secret.state.officers['zhuge-liang'].stats.intelligence = 60;
    secret.state.officers['cao-ren'].stats.intelligence = 90;
    expect(rulesFor(secret.state, secret.caster, secret.target, 'false-report', 15)?.critical).toBe(true);
    secret.state.officers['cao-ren'].stats.intelligence = 50;
    expect(rulesFor(secret.state, secret.caster, secret.target, 'disturb', 15)?.critical).toBe(false);
  });

  it('reflects hostile strategies with 反计 only when defender intelligence is not lower', () => {
    const counter = strategyFixture('无', '反计');
    counter.state.officers['zhuge-liang'].stats.intelligence = 90;
    counter.state.officers['cao-ren'].stats.intelligence = 95;
    expect(rulesFor(counter.state, counter.caster, counter.target, 'disturb', 15)?.reflect).toBe(true);
    counter.state.officers['cao-ren'].stats.intelligence = 89;
    expect(rulesFor(counter.state, counter.caster, counter.target, 'disturb', 15)?.reflect).toBe(false);
  });

  it('confuses the caster via 妙计 and counter-attacks with 规律/沉着/明镜 immunity', () => {
    const clever = strategyFixture('无', '妙计');
    expect(rulesFor(clever.state, clever.caster, clever.target, 'disturb', 15)?.castFailConfuse).toBe(true);

    const supportCases: Array<{ skill: string; strategyId: StrategyId }> = [
      { skill: '规律', strategyId: 'false-report' },
      { skill: '沉着', strategyId: 'disturb' },
      { skill: '明镜', strategyId: 'disturb' },
    ];
    for (const { skill, strategyId } of supportCases) {
      const fixture = strategyFixture('无', skill);
      expect(rulesFor(fixture.state, fixture.caster, fixture.target, strategyId, 15)?.immune, `${skill} 应免疫${strategyId}`)
        .toBe(true);
    }
    const calm = strategyFixture('无', '沉着');
    expect(rulesFor(calm.state, calm.caster, calm.target, 'false-report', 15)?.immune).toBe(false);
  });

  it('keeps 倾国 success bonus for non-female leading targets only', () => {
    const charm = strategyFixture('倾国');
    expect(rulesFor(charm.state, charm.caster, charm.target, 'disturb', 15)).toMatchObject({ successBonus: 10 });

    charm.state.officers['cao-ren'].gender = 'female';
    expect(rulesFor(charm.state, charm.caster, charm.target, 'disturb', 15)?.successBonus).toBe(0);
  });

  it('enables 连环 only for successful-status strategy kinds with a unit target', () => {
    const { state, caster, target } = strategyFixture('连环');
    expect(rulesFor(state, caster, target, 'false-report', 15)).toMatchObject({
      chain: true,
      complexHandlerIds: ['chainStrategy'],
    });
    expect(rulesFor(state, caster, target, 'disturb', 15)).toMatchObject({
      chain: true,
      complexHandlerIds: ['chainStrategy'],
    });
    for (const strategyId of ['fire', 'extinguish', 'calm', 'inspire', 'discord'] as const) {
      expect(rulesFor(state, caster, target, strategyId, 10)?.chain).toBe(false);
    }
    expect(rulesFor(state, caster, undefined, 'disturb', 15)?.chain).toBe(false);
  });

  it('derives 连环 activation from complexHandler metadata instead of the skill name', () => {
    const { state, caster, target } = strategyFixture('连环');
    const definition = STRATEGY_SKILLS.find((skill) => skill.name === '连环');
    expect(definition).toBeDefined();
    const originalEffects = definition?.effects ?? [];

    try {
      if (definition) definition.effects = [];
      expect(rulesFor(state, caster, target, 'disturb', 15)).toMatchObject({
        chain: false,
        complexHandlerIds: [],
      });
    } finally {
      if (definition) definition.effects = originalEffects;
    }
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
