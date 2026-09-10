import { describe, expect, it } from 'vitest';
import { nextRandom } from '../../random';
import { createGame } from '../../scenario/jingxiang208';
import type { ArmyUnit, GameState } from '../../types';
import type { TacticId } from '../../battle/tactics';
import { skillDefinition } from '../registry';
import * as skillRules from '../index';
import { skillAttackRangeBonus, unitAttackRange } from '../../battle/targetRules';
import { attackUnit } from '../../battle/combat';
import { TECH_COSTS, TECHP_PER_BREAK_UNIT } from '../../techs';
import { cityAvailableOfficers, executeCommand, researchTechPCost } from '../../commands';
import {
  absorbTroopsOnCritical,
  breakUnitEnergyRecovery,
  drainTargetEnergyBySkills,
  fireDamageMultiplierOf,
  jointAttackRollConfuse,
  jointAttackSplitsToSingle,
  rangedTargetBlockedByForest,
  recoverEnergyOnTacticHit,
  siegeDamageMultiplier,
  tacticConfusesTarget,
} from '../rules/combat';

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
    expect(skillDefinition('驱逐')?.implementationStatus).toBe('active');
    expect(skillDefinition('扫讨')?.implementationStatus).toBe('active');
    expect(skillDefinition('金刚')?.implementationStatus).toBe('active');
    expect(skillDefinition('铁壁')?.implementationStatus).toBe('active');
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

  it('drains target energy on hit for 扫讨 and keeps 威风 as the highest drain', () => {
    const { state, attacker, weaker } = combatFixture('扫讨');
    weaker.energy = 100;

    drainTargetEnergyBySkills(state, attacker, weaker);

    expect(weaker.energy).toBe(95);

    state.officers['guan-yu'].skill = '威风';
    weaker.energy = 100;
    drainTargetEnergyBySkills(state, attacker, weaker);
    expect(weaker.energy).toBe(80);
  });

  it('restores energy after breaking a unit for 昂扬 and after being hit by a tactic for 怒发', () => {
    const { state, attacker } = combatFixture('昂扬');
    attacker.energy = 80;

    breakUnitEnergyRecovery(state, attacker);

    expect(attacker.energy).toBeGreaterThan(80);

    state.officers['guan-yu'].skill = '无';
    state.officers['cao-ren'].skill = '怒发';
    const weaker = state.units.weaker;
    weaker.energy = 100;
    recoverEnergyOnTacticHit(state, weaker);
    expect(weaker.energy).toBe(100);

    weaker.energy = 90;
    recoverEnergyOnTacticHit(state, weaker);
    expect(weaker.energy).toBe(95);
  });

  it('absorbs troops only on critical for 心攻 and never without it', () => {
    const { state, attacker } = combatFixture('心攻');
    attacker.troops = 5000;

    absorbTroopsOnCritical(state, attacker, 1000, true);

    expect(attacker.troops).toBe(5200);

    attacker.troops = 5000;
    absorbTroopsOnCritical(state, attacker, 1000, false);
    expect(attacker.troops).toBe(5000);

    state.officers['guan-yu'].skill = '无';
    attacker.troops = 5000;
    absorbTroopsOnCritical(state, attacker, 1000, true);
    expect(attacker.troops).toBe(5000);
  });

  it('amplifies facility damage for 攻城 and doubles fire damage for 藤甲', () => {
    const { state, attacker, weaker } = combatFixture('攻城');

    expect(siegeDamageMultiplier(state, attacker)).toBe(1.5);

    state.officers['guan-yu'].skill = '无';
    expect(siegeDamageMultiplier(state, attacker)).toBe(1);

    state.officers['cao-ren'].skill = '藤甲';
    expect(fireDamageMultiplierOf(state, weaker)).toBe(2);
  });

  it('negates damage below 500 for 金刚 and halves non-fire damage for 藤甲', () => {
    const reduceIncomingDamageBySkills = requireRule('reduceIncomingDamageBySkills');
    const { state, weaker } = combatFixture('无', '金刚');

    expect(reduceIncomingDamageBySkills(state, weaker, 400, 'normalAttack')).toBe(0);
    expect(reduceIncomingDamageBySkills(state, weaker, 600, 'normalAttack')).toBe(600);

    state.officers['cao-ren'].skill = '藤甲';
    expect(reduceIncomingDamageBySkills(state, weaker, 700, 'tactic')).toBe(350);
  });

  it('splits joint attacks to a single hit for 铁壁', () => {
    const { state, weaker } = combatFixture('无', '铁壁');

    expect(jointAttackSplitsToSingle(state, weaker)).toBe(true);

    state.officers['cao-ren'].skill = '无';
    expect(jointAttackSplitsToSingle(state, weaker)).toBe(false);
  });

  it('rolls 掎角 confusion only when a participant owns it', () => {
    const { state, attacker, weaker } = combatFixture('掎角');
    const expected = nextRandom(state.seed, state.rngCursor);

    expect(jointAttackRollConfuse(state, [attacker], weaker)).toBe(expected.value < 0.5);
    expect(state.rngCursor).toBe(expected.cursor);

    state.officers['guan-yu'].skill = '无';
    const before = state.rngCursor;
    expect(jointAttackRollConfuse(state, [attacker], weaker)).toBe(false);
    expect(state.rngCursor).toBe(before);
  });

  it('blocks crossbow forest shots without 射手 and confuses for 疾走 cavalry vs weaker war', () => {
    const { state, attacker, weaker } = combatFixture('无');
    attacker.troopType = 'crossbow';
    const targetCell = state.grid.find((cell) => cell.q === weaker.q && cell.r === weaker.r)!;
    targetCell.terrain = 'forest';

    expect(rangedTargetBlockedByForest(state, attacker, weaker)).toBe(true);

    state.officers['guan-yu'].skill = '射手';
    expect(rangedTargetBlockedByForest(state, attacker, weaker)).toBe(false);

    state.officers['guan-yu'].skill = '疾走';
    attacker.troopType = 'cavalry';
    expect(tacticConfusesTarget(state, attacker, weaker, 'cavalry-rush')).toBe(true);

    state.officers['cao-ren'].stats.war = 120;
    expect(tacticConfusesTarget(state, attacker, weaker, 'cavalry-rush')).toBe(false);

    attacker.troopType = 'spear';
    state.officers['cao-ren'].stats.war = 60;
    expect(tacticConfusesTarget(state, attacker, weaker, 'spear-thrust')).toBe(false);
  });
});

describe('m15c skill hooks (行军/内政/灾害/攻击)', () => {
  it('activates the newly implemented m15c catalog entries while 踏破/辅佐 stay planned', () => {
    for (const name of ['遁走', '长驱', '搬运', '繁殖', '发明', '造船', '度支', '指导', '眼力', '诗想', '祈祷', '精妙', '强夺', '射程', '白马']) {
      expect(skillDefinition(name)?.implementationStatus).toBe('active');
    }
    // 踏破依赖地形伤害、辅佐依赖人际关系/支援攻击系统，均未实现
    expect(skillDefinition('踏破')?.implementationStatus).toBe('planned');
    expect(skillDefinition('辅佐')?.implementationStatus).toBe('planned');
  });

  it('白马 adds exactly one attack range to cavalry units on any terrain', () => {
    const fixture = combatFixture('无');
    fixture.attacker.troopType = 'cavalry';
    const base = unitAttackRange(fixture.state, fixture.attacker);

    fixture.state.officers['guan-yu'].skill = '白马';
    expect(skillAttackRangeBonus(fixture.state, fixture.attacker)).toBe(1);
    expect(unitAttackRange(fixture.state, fixture.attacker)).toBe(base + 1);

    fixture.attacker.troopType = 'spear';
    expect(skillAttackRangeBonus(fixture.state, fixture.attacker)).toBe(0);
  });

  it('射程 adds one attack range to siege units only', () => {
    const fixture = combatFixture('射程');
    fixture.attacker.troopType = 'siege';
    const siegeRange = unitAttackRange(fixture.state, fixture.attacker);

    expect(skillAttackRangeBonus(fixture.state, fixture.attacker)).toBe(1);
    fixture.attacker.troopType = 'sword';
    expect(skillAttackRangeBonus(fixture.state, fixture.attacker)).toBe(0);
    expect(unitAttackRange(fixture.state, fixture.attacker)).toBeLessThan(siegeRange);
  });

  it('精妙 doubles the techP awarded when breaking a unit', () => {
    const fixture = combatFixture('精妙');
    fixture.weaker.troops = 1;
    const before = fixture.state.forces['liu'].techP!;

    const next = attackUnit(fixture.state, 'liu', fixture.attacker.id, fixture.weaker.id);

    expect(next.units['weaker']).toBeUndefined();
    const techPAfter = next.forces['liu'].techP!;
    expect(techPAfter - before).toBe(TECHP_PER_BREAK_UNIT * 2);
  });

  it('awards the base techP when breaking a unit without 精妙', () => {
    const fixture = combatFixture('无');
    fixture.weaker.troops = 1;
    const before = fixture.state.forces['liu'].techP!;

    const next = attackUnit(fixture.state, 'liu', fixture.attacker.id, fixture.weaker.id);

    const techPAfter = next.forces['liu'].techP!;
    expect(techPAfter - before).toBe(TECHP_PER_BREAK_UNIT);
  });

  it('强夺 transfers the destroyed officer treasure to the looter force treasury', () => {
    const fixture = combatFixture('强夺');
    fixture.weaker.troops = 1;
    fixture.state.treasures = {
      qinglong: { id: 'qinglong', ownerId: 'cao', cityId: null, holderId: 'cao-ren' },
    };
    fixture.state.officers['cao-ren'].treasureId = 'qinglong';

    const next = attackUnit(fixture.state, 'liu', fixture.attacker.id, fixture.weaker.id);

    expect(next.treasures?.['qinglong'].ownerId).toBe('liu');
    expect(next.officers['cao-ren'].treasureId).toBeUndefined();
  });

  it('指导 halves the research techP cost for the researching officer only', () => {
    const state = createGame('liu', 1);
    state.officers['liu-bei'].skill = '指导';

    expect(researchTechPCost(state, 'liu', 'civil')).toBe(TECH_COSTS[0].techP);
    expect(researchTechPCost(state, 'liu', 'civil', ['liu-bei'])).toBe(Math.round(TECH_COSTS[0].techP / 2));
    expect(researchTechPCost(state, 'liu', 'civil', ['guan-yu'])).toBe(TECH_COSTS[0].techP);
  });

  it('眼力 guarantees discovering an in-city talent while exploring', () => {
    const state = createGame('liu', 1);
    state.actionPoints['liu'] = 100;
    state.cities['jiangling'].gold = 10000;
    state.officers['liu-bei'].acted = false;
    state.officers['liu-bei'].skill = '眼力';
    const talent = state.officers['mi-zhu'];
    talent.forceId = null;
    talent.location = { kind: 'unaffiliated', cityId: 'jiangling' };
    talent.cityId = 'jiangling';
    // 将江陵其余在野武将移走，确保糜竺是被登用的人
    for (const id of ['zhao-yun', 'ma-liang']) {
      state.officers[id].location = { kind: 'unaffiliated', cityId: 'wuling' };
    }

    const next = executeCommand(state, 'liu', { type: 'explore', cityId: 'jiangling', officerIds: ['liu-bei'] });

    expect(next.officers['mi-zhu'].forceId).toBe('liu');
    // 本旬新加入的武将视为已行动，下一旬才可执行指令
    expect(next.officers['mi-zhu'].acted).toBe(true);
    expect(cityAvailableOfficers(next, 'liu', 'jiangling').map((officer) => officer.id)).not.toContain('mi-zhu');
  });
});
