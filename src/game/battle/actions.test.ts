import { describe, expect, it } from 'vitest';
import { createGame } from '../scenario/jingxiang208';
import { deployUnit, moveUnit, waitUnit } from './actions';
import { gridKey, neighborsOf, sevenCellCityFootprint } from './grid';

function cityKeys(state: ReturnType<typeof createGame>) {
  return new Set(Object.values(state.cities).flatMap((city) => (
    sevenCellCityFootprint({ q: city.gridQ, r: city.gridR }).map(gridKey)
  )));
}

describe('battle deployment and movement actions', () => {
  it('deploys one officer as a one-cell unit outside the seven-cell city footprint', () => {
    const state = createGame('liu', 1);
    const beforeCity = state.cities.jiangling;

    const next = deployUnit(state, 'liu', {
      cityId: 'jiangling',
      officerId: 'guan-yu',
      targetCityId: 'xiangyang',
      troops: 4000,
      food: 6000,
    });

    const unit = Object.values(next.units)[0];
    const cityFootprint = new Set(sevenCellCityFootprint({ q: beforeCity.gridQ, r: beforeCity.gridR }).map(gridKey));

    expect(unit).toMatchObject({
      forceId: 'liu',
      leaderId: 'guan-yu',
      homeCityId: 'jiangling',
      troops: 4000,
      food: 6000,
      energy: 100,
      movementRemaining: 5,
      moved: true,
      acted: false,
    });
    expect(cityFootprint.has(gridKey(unit))).toBe(false);
    expect(next.cities.jiangling.troops).toBe(beforeCity.troops - 4000);
    expect(next.cities.jiangling.food).toBe(beforeCity.food - 6000);
    expect(next.officers['guan-yu'].location).toEqual({ kind: 'unit', unitId: unit.id });
    expect(next.officers['guan-yu'].acted).toBe(true);
    expect(next.actionPoints.liu).toBe(60);
  });

  it('rejects deployment that would leave fewer than 500 city troops', () => {
    const state = createGame('liu', 1);
    state.cities.wuling.troops = 10400;

    expect(() => deployUnit(state, 'liu', {
      cityId: 'wuling',
      officerId: 'zhang-fei',
      targetCityId: 'changsha',
      troops: 10000,
      food: 1000,
    })).toThrow(/500/);
  });

  it('moves a unit to an adjacent legal cell and reduces movement by terrain cost', () => {
    const deployed = deployUnit(createGame('liu', 1), 'liu', {
      cityId: 'jiangling',
      officerId: 'guan-yu',
      targetCityId: 'xiangyang',
      troops: 4000,
      food: 6000,
    });
    const unit = Object.values(deployed.units)[0];
    deployed.units[unit.id].moved = false;
    const blockedCityKeys = cityKeys(deployed);
    const destinationCell = neighborsOf(unit.q, unit.r)
      .map((coord) => deployed.grid.find((cell) => cell.q === coord.q && cell.r === coord.r))
      .find((cell) => cell && !['mountain', 'deepWater'].includes(cell.terrain) && !blockedCityKeys.has(gridKey(cell)));

    expect(destinationCell).toBeTruthy();

    const next = moveUnit(deployed, 'liu', unit.id, destinationCell!);
    const movedUnit = next.units[unit.id];
    const expectedCost = ['forest', 'hill'].includes(destinationCell!.terrain) ? 2 : 1;

    expect(movedUnit.q).toBe(destinationCell!.q);
    expect(movedUnit.r).toBe(destinationCell!.r);
    expect(movedUnit.movementRemaining).toBe(5 - expectedCost);
    expect(movedUnit.moved).toBe(true);
    expect(movedUnit.acted).toBe(false);
  });

  it('rejects movement into an occupied cell', () => {
    const first = deployUnit(createGame('liu', 1), 'liu', {
      cityId: 'jiangling',
      officerId: 'guan-yu',
      targetCityId: 'xiangyang',
      troops: 3000,
      food: 3000,
    });
    const second = deployUnit(first, 'liu', {
      cityId: 'wuling',
      officerId: 'zhang-fei',
      targetCityId: 'xiangyang',
      troops: 3000,
      food: 3000,
    });
    const [firstUnit, secondUnit] = Object.values(second.units);
    second.units[secondUnit.id].moved = false;

    expect(() => moveUnit(second, 'liu', secondUnit.id, { q: firstUnit.q, r: firstUnit.r })).toThrow(/占用/);
  });

  it('marks a unit acted when it waits', () => {
    const deployed = deployUnit(createGame('liu', 1), 'liu', {
      cityId: 'jiangling',
      officerId: 'guan-yu',
      targetCityId: 'xiangyang',
      troops: 4000,
      food: 6000,
    });
    const unit = Object.values(deployed.units)[0];

    const next = waitUnit(deployed, 'liu', unit.id);

    expect(next.units[unit.id].acted).toBe(true);
  });
});
