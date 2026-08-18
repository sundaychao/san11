import { describe, expect, it } from 'vitest';
import type { ArmyUnit, ForceId } from '../types';
import { createGame } from '../scenario/jingxiang208';
import {
  effectsOfKind,
  hasActiveSkill,
  resolveCitySkills,
  resolveCommandSkills,
  resolveOfficerSkills,
  resolveUnitSkills,
  skillConditionMatches,
} from './index';
import type { ActiveSkill } from './types';

function unit(id: string, forceId: ForceId, leaderId: string, officerIds: string[]): ArmyUnit {
  return {
    id,
    kind: 'combat',
    forceId,
    leaderId,
    officerIds,
    homeCityId: 'jiangling',
    troopType: 'spear',
    q: 10,
    r: 10,
    troops: 4000,
    food: 4000,
    energy: 100,
    movementRemaining: 20,
    moved: false,
    acted: false,
  };
}

describe('skill sources', () => {
  it('combines leader and deputies, deduplicates a skill, and keeps every source', () => {
    const state = createGame('liu', 1);
    const officerIds = ['liu-bei', 'guan-yu', 'guan-yu', 'zhang-fei', 'unknown'];
    state.officers['liu-bei'].skill = '神将';
    state.officers['guan-yu'].skill = '神将';
    state.officers['zhang-fei'].skill = '富豪';
    state.units.test = unit('test', 'liu', 'liu-bei', officerIds);

    expect(resolveUnitSkills(state, state.units.test)).toEqual([
      expect.objectContaining({ definition: expect.objectContaining({ name: '神将' }), sourceOfficerIds: ['liu-bei', 'guan-yu'] }),
      expect.objectContaining({ definition: expect.objectContaining({ name: '富豪' }), sourceOfficerIds: ['zhang-fei'] }),
    ]);
    expect(state.units.test.officerIds).toEqual(officerIds);
  });

  it('keeps planned definitions displayable but ignores unknown and blocked officer skills', () => {
    const state = createGame('liu', 1);
    state.officers['liu-bei'].skill = '神将';
    state.officers['guan-yu'].skill = '强袭';
    state.officers['zhang-fei'].skill = '不存在的特技';

    expect(resolveOfficerSkills(state, ['liu-bei', 'guan-yu', 'zhang-fei'])).toMatchObject([
      { definition: { name: '神将', implementationStatus: 'planned' }, sourceOfficerIds: ['liu-bei'] },
    ]);
  });

  it('counts city and local production-task officers but excludes units, transfers, enemies, and unaffiliated officers', () => {
    const state = createGame('liu', 1);
    state.officers['lu-su'].skill = '富豪';
    state.officers['zhou-yu'].skill = '米道';
    state.officers['zhou-yu'].location = {
      kind: 'task', cityId: 'changsha', task: 'armament', armamentType: 'ram', amount: 2, remainingTenDays: 2,
    };
    state.officers['gan-ning'].skill = '富豪';
    state.officers['gan-ning'].location = { kind: 'unit', unitId: 'test' };
    state.officers['han-dang'].skill = '富豪';
    state.officers['han-dang'].location = {
      kind: 'transfer', fromCityId: 'changsha', targetCityId: 'jiangxia', remainingTenDays: 1,
    };
    state.officers['liu-bei'].skill = '富豪';
    state.officers['liu-bei'].location = { kind: 'city', cityId: 'changsha' };
    state.officers['zhao-yun'].skill = '富豪';
    state.officers['zhao-yun'].location = { kind: 'unaffiliated', cityId: 'changsha' };

    expect(resolveCitySkills(state, 'changsha').map((skill) => skill.definition.name)).toEqual(['富豪', '米道']);
  });

  it('uses only the command officer for command-scoped skills and none for transfers', () => {
    const state = createGame('liu', 1);
    state.officers['liu-bei'].skill = '名声';
    state.officers['guan-yu'].skill = '能吏';

    expect(resolveCommandSkills(state, { type: 'recruit', cityId: 'jiangling', officerId: 'liu-bei' })
      .map((skill) => skill.definition.name)).toEqual(['名声']);
    expect(resolveCommandSkills(state, {
      type: 'transfer', cityId: 'jiangling', targetCityId: 'wuling', officerIds: ['liu-bei', 'guan-yu'],
    })).toEqual([]);
  });

  it('returns effects and matches names only for active definitions', () => {
    const active: ActiveSkill = {
      definition: {
        name: 'active movement',
        displayCategory: '行军',
        description: '',
        implementationStatus: 'active',
        effects: [{ kind: 'movementAllowance', add: 5 }],
      },
      sourceOfficerIds: ['liu-bei'],
    };
    const planned: ActiveSkill = {
      definition: { ...active.definition, name: 'planned movement', implementationStatus: 'planned' },
      sourceOfficerIds: ['guan-yu'],
    };

    expect(effectsOfKind([active, planned], 'movementAllowance')).toEqual([
      { effect: { kind: 'movementAllowance', add: 5 }, skill: active },
    ]);
    expect(hasActiveSkill([active, planned], 'active movement')).toBe(true);
    expect(hasActiveSkill([active, planned], 'planned movement')).toBe(false);
  });

  it('evaluates conditions from effective formation abilities, actor troops, and a required target', () => {
    const state = createGame('liu', 1);
    const actor = unit('actor', 'liu', 'liu-bei', ['guan-yu']);
    const target = unit('target', 'cao', 'cao-cao', []);
    actor.troops = 2999;
    state.officers['liu-bei'].stats.war = 20;
    state.officers['liu-bei'].stats.intelligence = 20;
    state.officers['guan-yu'].stats.war = 90;
    state.officers['guan-yu'].stats.intelligence = 90;
    state.officers['cao-cao'].stats.war = 80;
    state.officers['cao-cao'].stats.intelligence = 80;

    expect(skillConditionMatches(state, { kind: 'always' }, actor)).toBe(true);
    expect(skillConditionMatches(state, { kind: 'troopsBelow', amount: 3000 }, actor)).toBe(true);
    expect(skillConditionMatches(state, { kind: 'targetWarLower' }, actor)).toBe(false);
    expect(skillConditionMatches(state, { kind: 'targetWarLower' }, actor, target)).toBe(true);
    expect(skillConditionMatches(state, { kind: 'targetIntelligenceLower' }, actor, target)).toBe(true);
  });
});
