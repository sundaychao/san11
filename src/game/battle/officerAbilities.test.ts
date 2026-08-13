import { describe, expect, it } from 'vitest';
import type { AptitudeGrade } from '../types';
import { deployUnit } from './actions';
import { createGame } from '../scenario/jingxiang208';
import {
  effectiveUnitAbilities,
  fireStrategySuccessChance,
  harmfulStrategySuccessChance,
  maxTacticTier,
  tacticCriticalChance,
} from './officerAbilities';

function deployOfficerFormation() {
  const game = createGame('liu', 1);
  game.officers['zhuge-liang'].cityId = 'jiangling';
  game.officers['zhuge-liang'].location = { kind: 'city', cityId: 'jiangling' };
  const state = deployUnit(game, 'liu', {
    cityId: 'jiangling', officerIds: ['jian-yong', 'guan-yu', 'zhuge-liang'],
    troopType: 'spear', troops: 4000, food: 5000,
  });
  return { state, unit: Object.values(state.units)[0] };
}

describe('effectiveUnitAbilities', () => {
  it('uses leader leadership and formation maxima for other abilities', () => {
    const { state, unit } = deployOfficerFormation();
    const result = effectiveUnitAbilities(state, unit);

    expect(result.leadership).toEqual({ value: state.officers['jian-yong'].stats.leadership, officerId: 'jian-yong' });
    expect(result.war.officerId).toBe('guan-yu');
    expect(result.intelligence.officerId).toBe('zhuge-liang');
    expect(result.aptitude).toEqual({ grade: 'S', officerId: 'guan-yu' });
  });

  it('uses default aptitudes and first formation officer for ties', () => {
    const { state, unit } = deployOfficerFormation();
    state.officers['jian-yong'].stats.war = 97;
    state.officers['jian-yong'].stats.intelligence = 100;
    state.officers['jian-yong'].aptitudes = undefined;
    state.officers['guan-yu'].aptitudes = undefined;
    state.officers['zhuge-liang'].aptitudes = undefined;

    const result = effectiveUnitAbilities(state, unit);

    expect(result.war).toEqual({ value: 97, officerId: 'jian-yong' });
    expect(result.intelligence).toEqual({ value: 100, officerId: 'jian-yong' });
    expect(result.aptitude).toEqual({ grade: 'B', officerId: 'jian-yong' });
  });

  it('falls back to the leader and has no aptitude for sword or transport units', () => {
    const { state, unit } = deployOfficerFormation();
    const leaderOnlyUnit = { ...unit, officerIds: undefined, troopType: 'sword' as const };
    const transportUnit = { ...unit, kind: 'transport' as const, troopType: undefined };

    expect(effectiveUnitAbilities(state, leaderOnlyUnit)).toMatchObject({
      war: { officerId: 'jian-yong' },
      intelligence: { officerId: 'jian-yong' },
      aptitude: { grade: null, officerId: null },
    });
    expect(effectiveUnitAbilities(state, transportUnit).aptitude).toEqual({ grade: null, officerId: null });
  });

  it.each([
    ['an empty formation', [], 'jian-yong'],
    ['invalid formation members', ['missing-officer'], 'jian-yong'],
    ['a formation that omits and duplicates its leader', ['guan-yu', 'guan-yu'], 'guan-yu'],
  ])('always includes the valid leader first for %s', (_case, officerIds, expectedWarOfficerId) => {
    const { state, unit } = deployOfficerFormation();
    state.officers['jian-yong'].stats.intelligence = 100;
    unit.officerIds = officerIds;

    const result = effectiveUnitAbilities(state, unit);

    expect(result.leadership.officerId).toBe('jian-yong');
    expect(result.war.officerId).toBe(expectedWarOfficerId);
    expect(result.intelligence.officerId).toBe('jian-yong');
  });

  it('maps aptitude and probability formulas exactly', () => {
    const aptitudeGrades = ['C', 'B', 'A', 'S'] as const satisfies readonly AptitudeGrade[];
    expect(aptitudeGrades.map(maxTacticTier)).toEqual([0, 1, 2, 3]);
    expect(tacticCriticalChance(60, 'B')).toBe(5);
    expect(tacticCriticalChance(100, 'S')).toBe(27);
    expect(harmfulStrategySuccessChance(100, 40)).toBe(95);
    expect(harmfulStrategySuccessChance(40, 100)).toBe(10);
    expect(fireStrategySuccessChance(50)).toBe(55);
    expect(fireStrategySuccessChance(100)).toBe(95);
  });
});
