import { describe, expect, it } from 'vitest';
import { nextRandom } from '../../random';
import { createGame } from '../../scenario/jingxiang208';
import type { ArmyUnit, GameState } from '../../types';
import type { TacticId } from '../../battle/tactics';
import { skillDefinition } from '../registry';
import * as skillRules from '../index';

type CombatRules = {
  normalAttackIsCritical?: (state: GameState, attacker: ArmyUnit, target: ArmyUnit) => boolean;
  tacticCriticalMode?: (
    state: GameState,
    attacker: ArmyUnit,
    target: ArmyUnit,
    tacticId: TacticId,
  ) => 'normal' | 'guaranteed';
  rollRepeatNormalAttack?: (state: GameState, attacker: ArmyUnit) => boolean;
  reduceIncomingDamageBySkills?: (
    state: GameState,
    target: ArmyUnit,
    damage: number,
    source: 'normalAttack' | 'counter' | 'tactic',
  ) => number;
};

const combatRules = skillRules as CombatRules;

function combatFixture(attackerSkill: string, targetSkill = '无') {
  const state = createGame('liu', 1);
  state.officers['guan-yu'].skill = attackerSkill;
  state.officers['guan-yu'].location = { kind: 'unit', unitId: 'attacker' };
  state.officers['guan-yu'].stats.war = 97;
  state.officers['cao-ren'].skill = targetSkill;
  state.officers['cao-ren'].location = { kind: 'unit', unitId: 'weaker' };
  state.officers['cao-ren'].stats.war = 60;
  state.officers['xiahou-dun'].location = { kind: 'unit', unitId: 'stronger' };
  state.officers['xiahou-dun'].stats.war = 100;
  state.units.attacker = {
    id: 'attacker', kind: 'combat', forceId: 'liu', leaderId: 'guan-yu', officerIds: ['guan-yu'],
    homeCityId: 'jiangling', troopType: 'spear', q: 10, r: 10, troops: 6000, food: 6000,
    energy: 100, movementRemaining: 20, moved: false, acted: false,
  };
  state.units.weaker = {
    id: 'weaker', kind: 'combat', forceId: 'cao', leaderId: 'cao-ren', officerIds: ['cao-ren'],
    homeCityId: 'xiangyang', troopType: 'spear', q: 11, r: 10, troops: 6000, food: 6000,
    energy: 100, movementRemaining: 20, moved: false, acted: false,
  };
  state.units.stronger = {
    ...state.units.weaker,
    id: 'stronger',
    leaderId: 'xiahou-dun',
    officerIds: ['xiahou-dun'],
    q: 10,
    r: 11,
  };
  return {
    state,
    attacker: state.units.attacker,
    weaker: state.units.weaker,
    stronger: state.units.stronger,
  };
}

function requireRule<K extends keyof CombatRules>(name: K): NonNullable<CombatRules[K]> {
  const rule = combatRules[name];
  expect(rule, `${name} must be exported`).toBeTypeOf('function');
  return rule!;
}

describe('combat skill rules', () => {
  it('activates only the Task 4 catalog entries', () => {
    expect(skillDefinition('神将')?.implementationStatus).toBe('active');
    expect(skillDefinition('连击')?.implementationStatus).toBe('active');
    expect(skillDefinition('不屈')?.implementationStatus).toBe('active');
    expect(skillDefinition('飞将')?.implementationStatus).toBe('active');
    expect(skillDefinition('驱逐')?.implementationStatus).toBe('planned');
  });

  it('guarantees 神将 normal and tactic criticals only against lower-war targets', () => {
    const normalAttackIsCritical = requireRule('normalAttackIsCritical');
    const tacticCriticalMode = requireRule('tacticCriticalMode');
    const { state, attacker, weaker, stronger } = combatFixture('神将');

    expect(normalAttackIsCritical(state, attacker, weaker)).toBe(true);
    expect(tacticCriticalMode(state, attacker, weaker, 'spear-thrust')).toBe('guaranteed');
    expect(normalAttackIsCritical(state, attacker, stronger)).toBe(false);
    expect(tacticCriticalMode(state, attacker, stronger, 'spear-thrust')).toBe('normal');
    state.officers['xiahou-dun'].stats.war = 97;
    expect(normalAttackIsCritical(state, attacker, stronger)).toBe(false);
  });

  it('limits 飞将 guaranteed critical to non-siege tactics and never normal attacks', () => {
    const normalAttackIsCritical = requireRule('normalAttackIsCritical');
    const tacticCriticalMode = requireRule('tacticCriticalMode');
    const fixture = combatFixture('飞将');

    expect(normalAttackIsCritical(fixture.state, fixture.attacker, fixture.weaker)).toBe(false);
    expect(tacticCriticalMode(fixture.state, fixture.attacker, fixture.weaker, 'spear-thrust')).toBe('guaranteed');
    expect(tacticCriticalMode(fixture.state, fixture.attacker, fixture.stronger, 'spear-thrust')).toBe('normal');
    fixture.attacker.troopType = 'siege';
    expect(tacticCriticalMode(fixture.state, fixture.attacker, fixture.weaker, 'spear-thrust')).toBe('normal');
  });

  it('deduplicates 连击 and consumes exactly one repeat roll at the highest applicable chance', () => {
    const rollRepeatNormalAttack = requireRule('rollRepeatNormalAttack');
    const { state, attacker } = combatFixture('连击');
    state.officers['liu-bei'].skill = '连击';
    attacker.officerIds = ['guan-yu', 'liu-bei'];
    const expected = nextRandom(state.seed, state.rngCursor);

    expect(rollRepeatNormalAttack(state, attacker)).toBe(expected.value < 0.5);
    expect(state.rngCursor).toBe(expected.cursor);
  });

  it('does not consume a repeat roll when no active repeat effect applies', () => {
    const rollRepeatNormalAttack = requireRule('rollRepeatNormalAttack');
    const { state, attacker } = combatFixture('无');

    expect(rollRepeatNormalAttack(state, attacker)).toBe(false);
    expect(state.rngCursor).toBe(0);
  });

  it('rolls 不屈 independently below 3000 and leaves exactly 3000 unprotected', () => {
    const reduceIncomingDamageBySkills = requireRule('reduceIncomingDamageBySkills');
    const { state, weaker } = combatFixture('无', '不屈');
    weaker.troops = 2999;
    const expected = nextRandom(state.seed, state.rngCursor);

    expect(reduceIncomingDamageBySkills(state, weaker, 700, 'normalAttack')).toBe(expected.value < 0.5 ? 0 : 700);
    expect(state.rngCursor).toBe(expected.cursor);

    weaker.troops = 3000;
    expect(reduceIncomingDamageBySkills(state, weaker, 700, 'tactic')).toBe(700);
    expect(state.rngCursor).toBe(expected.cursor);
  });
});
