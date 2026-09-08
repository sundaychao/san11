import { describe, expect, it } from 'vitest';
import { deployUnit } from './actions';
import { getDeploymentTargets, getUnitActionQuery } from './queries';
import { createGame } from '../scenario/jingxiang208';

function combatState() {
  const state = deployUnit(createGame('liu', 1), 'liu', {
    cityId: 'jiangling',
    officerId: 'guan-yu',
    troopType: 'spear',
    troops: 4000,
    food: 4000,
  });
  const attacker = Object.values(state.units)[0];
  // 血色衣冠地图下 (10,10) 附近为山地，改用西北平原区 (2,23)（偶数列，邻接关系与原坐标一致）
  attacker.q = 2;
  attacker.r = 23;
  attacker.moved = false;
  attacker.acted = false;
  attacker.movementRemaining = 20;
  state.units.enemy = {
    id: 'enemy',
    kind: 'combat',
    forceId: 'cao',
    leaderId: 'cao-ren',
    officerIds: ['cao-ren'],
    homeCityId: 'xiangyang',
    troopType: 'spear',
    q: 3,
    r: 23,
    troops: 3000,
    food: 3000,
    energy: 100,
    stamina: 100,
    movementRemaining: 20,
    moved: false,
    acted: false,
  };
  state.units.ally = {
    id: 'ally',
    kind: 'combat',
    forceId: 'liu',
    leaderId: 'liu-bei',
    officerIds: ['liu-bei'],
    homeCityId: 'jiangling',
    troopType: 'spear',
    q: 2,
    r: 24,
    troops: 3000,
    food: 3000,
    energy: 100,
    stamina: 100,
    movementRemaining: 20,
    moved: false,
    acted: false,
  };
  attacker.gold = 1000;
  return { state, attacker };
}

describe('battle queries', () => {
  it('returns unit targets and command availability from one query', () => {
    const { state, attacker } = combatState();

    const query = getUnitActionQuery(state, attacker.id);

    expect(query.attackUnits.map((unit) => unit.id)).toContain('enemy');
    expect(query.jointAttackUnits.map((unit) => unit.id)).toContain('enemy');
    expect(query.commandAvailability).toMatchObject({
      wait: true,
      attack: true,
      duel: true,
      jointAttack: true,
      tactic: true,
      strategy: true,
      facility: true,
      repair: false,
    });
  });

  it('returns tactic reasons and disables tactic command when stamina is insufficient', () => {
    const { state, attacker } = combatState();
    attacker.stamina = 0;

    const query = getUnitActionQuery(state, attacker.id);

    expect(query.tacticOptions).toHaveLength(3);
    expect(query.tacticOptions.every((option) => option.unavailableReason === '战力不足')).toBe(true);
    expect(query.availableTactics).toHaveLength(0);
    expect(query.commandAvailability.tactic).toBe(false);
  });

  it('prioritizes aptitude and action status before energy and target reasons', () => {
    const { state, attacker } = combatState();
    state.officers['guan-yu'].aptitudes = { ...state.officers['guan-yu'].aptitudes!, spear: 'B' };
    attacker.acted = true;
    attacker.stamina = 0;

    const actedQuery = getUnitActionQuery(state, attacker.id);

    expect(actedQuery.tacticOptions.find(({ tactic }) => tactic.id === 'spear-spiral')?.unavailableReason).toBe('需要枪兵适性 A');
    expect(actedQuery.tacticOptions.find(({ tactic }) => tactic.id === 'spear-thrust')?.unavailableReason).toBe('部队已行动');

    attacker.acted = false;
    attacker.confusedTenDays = 1;
    const confusedQuery = getUnitActionQuery(state, attacker.id);

    expect(confusedQuery.tacticOptions.find(({ tactic }) => tactic.id === 'spear-thrust')?.unavailableReason).toBe('部队无法行动');
  });

  it('returns deployment targets using the selected troop profile and officer bonus', () => {
    const state = createGame('liu', 1);

    const targets = getDeploymentTargets(state, {
      cityId: 'jiangling',
      troopType: 'spear',
      officerIds: ['liu-bei'],
    });

    expect(targets.length).toBeGreaterThan(0);
  });

  it('disables every unit command after the unit has acted', () => {
    const { state, attacker } = combatState();
    attacker.acted = true;

    const query = getUnitActionQuery(state, attacker.id);

    expect(query.commandAvailability).toEqual({
      wait: false,
      attack: false,
      duel: false,
      jointAttack: false,
      tactic: false,
      strategy: false,
      facility: false,
      repair: false,
    });
  });
});
