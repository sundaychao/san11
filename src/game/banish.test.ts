import { describe, expect, it } from 'vitest';
import { createGame } from './scenario/jingxiang208';
import { executeCommand, validateCommand } from './commands';
import { POSITIONS } from './ranks';

describe('君主流放', () => {
  it('多选武将流放后变成本城在野：脱离势力、忠诚保留、仕龄清零、不耗行动力', () => {
    const state = createGame('liu', 3);
    const ids = ['guan-yu', 'zhang-fei'];
    const loyalties = ids.map((id) => state.officers[id].loyalty ?? 0);
    state.actionPoints.liu = 50;

    const command = { type: 'banish' as const, cityId: 'jiangling' as const, officerIds: ids };
    expect(validateCommand(state, 'liu', command)).toEqual([]);
    const next = executeCommand(state, 'liu', command);

    ids.forEach((id, index) => {
      const officer = next.officers[id];
      expect(officer.forceId).toBeNull();
      expect(officer.location).toEqual({ kind: 'unaffiliated', cityId: 'jiangling' });
      expect(officer.cityId).toBe('jiangling');
      expect(officer.loyalty).toBe(loyalties[index]);
      expect(officer.serviceYears).toBe(0);
    });
    expect(next.actionPoints.liu).toBe(50);
  });

  it('职务清算：官阶加成回收，太守、军师、军团长任命一并解除', () => {
    const state = createGame('liu', 3);
    const officer = state.officers['guan-yu'];
    const position = POSITIONS[0];
    officer.positionId = position.id;
    state.cities.jiangling.governorId = 'guan-yu';
    state.forces.liu.strategistId = 'guan-yu';
    state.forces.liu.legions = {
      l1: { id: 'l1', commanderId: 'guan-yu', cityIds: ['jiangling'], policy: 'balanced' },
    };

    const next = executeCommand(state, 'liu', {
      type: 'banish', cityId: 'jiangling', officerIds: ['guan-yu'],
    });

    expect(next.officers['guan-yu'].positionId).toBeUndefined();
    expect(next.cities.jiangling.governorId).toBeNull();
    expect(next.forces.liu.strategistId).toBeUndefined();
    expect(next.forces.liu.legions?.l1).toBeUndefined();
  });

  it('校验：不能流放君主、他方武将与出征在外者', () => {
    const state = createGame('liu', 3);
    expect(validateCommand(state, 'liu', { type: 'banish', cityId: 'jiangling', officerIds: ['liu-bei'] }))
      .toEqual(['不能流放君主']);

    const caoOfficer = Object.values(state.officers).find((officer) => officer.forceId === 'cao')!;
    expect(validateCommand(state, 'liu', { type: 'banish', cityId: 'jiangling', officerIds: [caoOfficer.id] }))
      .toEqual(['只能流放己方武将']);

    state.officers['guan-yu'].location = { kind: 'unit', unitId: 'field-u1' };
    expect(validateCommand(state, 'liu', { type: 'banish', cityId: 'jiangling', officerIds: ['guan-yu'] }))
      .toEqual(['只能流放驻守城池或关隘的武将']);
  });
});
