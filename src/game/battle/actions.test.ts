import { describe, expect, it } from 'vitest';
import { runAiTurn } from '../ai';
import { createGame } from '../scenario/jingxiang208';
import { territoryCityAt, territoryForceAt } from '../territory';
import { settleTenDay } from '../turn';
import { attackableCities, attackableUnits, attackCity, attackUnit, deployTransportUnit, deployUnit, deploymentCells, jointAttackableUnits, moveUnit, movementCells, tacticTargetUnits, unitTactics, useUnitTactic, waitUnit } from './actions';
import { gridKey, neighborsOf, sevenCellCityFootprint } from './grid';

function cityKeys(state: ReturnType<typeof createGame>) {
  return new Set(Object.values(state.cities).flatMap((city) => (
    sevenCellCityFootprint({ q: city.gridQ, r: city.gridR }).map(gridKey)
  )));
}

function setUniformTerrain(state: ReturnType<typeof createGame>, terrain: ReturnType<typeof createGame>['grid'][number]['terrain']) {
  for (const cell of state.grid) cell.terrain = terrain;
}

function hasCoord(cells: Array<{ q: number; r: number }>, coord: { q: number; r: number }) {
  return cells.some((cell) => cell.q === coord.q && cell.r === coord.r);
}

function readyUnitAt(
  state: ReturnType<typeof createGame>,
  unitId: string,
  coord: { q: number; r: number },
  troopType: NonNullable<ReturnType<typeof createGame>['units'][string]['troopType']> = 'sword',
) {
  const movementByTroop = { sword: 22, spear: 22, halberd: 20, crossbow: 19, cavalry: 30, siege: 16 };
  state.units[unitId].q = coord.q;
  state.units[unitId].r = coord.r;
  state.units[unitId].troopType = troopType;
  state.units[unitId].moved = false;
  state.units[unitId].acted = false;
  state.units[unitId].movementRemaining = movementByTroop[troopType];
}

function addEnemyUnit(state: ReturnType<typeof createGame>, id: string, coord: { q: number; r: number }, troops = 3000) {
  state.units[id] = {
    id,
    kind: 'combat',
    forceId: 'cao',
    leaderId: 'cao-ren',
    homeCityId: 'xiangyang',
    troopType: 'sword',
    q: coord.q,
    r: coord.r,
    troops,
    food: 3000,
    energy: 100,
    movementRemaining: 20,
    moved: false,
    acted: false,
  };
  state.officers['cao-ren'].location = { kind: 'unit', unitId: id };
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
      movementRemaining: 22,
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

  it('records the selected troop type on a deployed unit', () => {
    const next = deployUnit(createGame('liu', 1), 'liu', {
      cityId: 'jiangling',
      officerId: 'guan-yu',
      targetCityId: 'xiangyang',
      troops: 4000,
      food: 6000,
      troopType: 'spear',
    });

    expect(Object.values(next.units)[0].troopType).toBe('spear');
  });

  it('deploys one leader with two deputies and consumes matching armaments', () => {
    const state = createGame('liu', 1);
    const next = deployUnit(state, 'liu', {
      cityId: 'jiangling',
      officerIds: ['guan-yu', 'liu-bei', 'jian-yong'],
      troopType: 'spear',
      troops: 4000,
      food: 6000,
    });

    const unit = Object.values(next.units)[0];
    expect(unit).toMatchObject({ leaderId: 'guan-yu', officerIds: ['guan-yu', 'liu-bei', 'jian-yong'] });
    expect(next.cities.jiangling.armaments!.spear).toBe(state.cities.jiangling.armaments!.spear - 4000);
    expect(next.officers['guan-yu'].location).toEqual({ kind: 'unit', unitId: unit.id });
    expect(next.officers['liu-bei'].location).toEqual({ kind: 'unit', unitId: unit.id });
    expect(next.officers['jian-yong'].location).toEqual({ kind: 'unit', unitId: unit.id });
  });

  it('does not require sword armaments but rejects insufficient spear armaments', () => {
    const swordState = createGame('liu', 1);
    const swordNext = deployUnit(swordState, 'liu', {
      cityId: 'jiangling',
      officerId: 'guan-yu',
      troopType: 'sword',
      troops: 4000,
      food: 6000,
    });
    expect(swordNext.cities.jiangling.armaments!.spear).toBe(swordState.cities.jiangling.armaments!.spear);

    const spearState = createGame('liu', 1);
    spearState.cities.jiangling.armaments!.spear = 1000;
    expect(() => deployUnit(spearState, 'liu', {
      cityId: 'jiangling',
      officerId: 'guan-yu',
      troopType: 'spear',
      troops: 2000,
      food: 3000,
    })).toThrow(/枪兵兵装不足/);
  });

  it('deploys to a selected legal cell inside the city movement range', () => {
    const state = createGame('liu', 1);
    const destination = deploymentCells(state, 'jiangling')[0];

    const next = deployUnit(state, 'liu', {
      cityId: 'jiangling',
      officerId: 'guan-yu',
      destination,
      troops: 4000,
      food: 6000,
    });

    const unit = Object.values(next.units)[0];
    expect(unit.q).toBe(destination.q);
    expect(unit.r).toBe(destination.r);
  });

  it('deploys a transport unit with troops, gold, and food to a selected legal cell', () => {
    const state = createGame('liu', 1);
    const destination = deploymentCells(state, 'jiangling', undefined, 'transport')[0];

    const next = deployTransportUnit(state, 'liu', {
      cityId: 'jiangling',
      officerId: 'guan-yu',
      destination,
      troops: 1200,
      gold: 900,
      food: 1800,
    });

    const unit = Object.values(next.units)[0];
    expect(unit).toMatchObject({
      kind: 'transport',
      leaderId: 'guan-yu',
      troops: 1200,
      gold: 900,
      food: 1800,
      q: destination.q,
      r: destination.r,
      movementRemaining: 20,
      moved: true,
    });
    expect(next.cities.jiangling.troops).toBe(state.cities.jiangling.troops - 1200);
    expect(next.cities.jiangling.gold).toBe(state.cities.jiangling.gold - 900);
    expect(next.cities.jiangling.food).toBe(state.cities.jiangling.food - 1800);
    expect(next.officers['guan-yu'].location).toEqual({ kind: 'unit', unitId: unit.id });
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

  it('moves a unit to an adjacent legal cell and clears movement until next ten-day reset', () => {
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
    expect(movedUnit.q).toBe(destinationCell!.q);
    expect(movedUnit.r).toBe(destinationCell!.r);
    expect(movedUnit.movementRemaining).toBe(0);
    expect(movedUnit.moved).toBe(true);
    expect(movedUnit.acted).toBe(false);

    const reset = settleTenDay(next);
    expect(reset.units[unit.id].movementRemaining).toBe(22);
    expect(reset.units[unit.id].moved).toBe(false);
  });

  it('uses road and plain cost 4, and forest cost 6 for infantry movement', () => {
    const deployed = deployUnit(createGame('liu', 1), 'liu', {
      cityId: 'jiangling',
      officerId: 'guan-yu',
      troops: 4000,
      food: 6000,
    });
    const unit = Object.values(deployed.units)[0];
    readyUnitAt(deployed, unit.id, { q: 10, r: 10 }, 'sword');
    setUniformTerrain(deployed, 'plain');

    const plainTargets = movementCells(deployed, unit.id);

    expect(hasCoord(plainTargets, { q: 15, r: 10 })).toBe(true);
    expect(hasCoord(plainTargets, { q: 16, r: 10 })).toBe(false);

    setUniformTerrain(deployed, 'forest');
    const forestTargets = movementCells(deployed, unit.id);

    expect(hasCoord(forestTargets, { q: 13, r: 10 })).toBe(true);
    expect(hasCoord(forestTargets, { q: 14, r: 10 })).toBe(false);
  });

  it('keeps cavalry movement high on plain but penalizes forest and shallow water', () => {
    const deployed = deployUnit(createGame('liu', 1), 'liu', {
      cityId: 'jiangling',
      officerId: 'guan-yu',
      troopType: 'cavalry',
      troops: 4000,
      food: 6000,
    });
    const unit = Object.values(deployed.units)[0];
    readyUnitAt(deployed, unit.id, { q: 10, r: 10 }, 'cavalry');
    setUniformTerrain(deployed, 'plain');

    const plainTargets = movementCells(deployed, unit.id);

    expect(hasCoord(plainTargets, { q: 17, r: 10 })).toBe(true);
    expect(hasCoord(plainTargets, { q: 18, r: 10 })).toBe(false);

    setUniformTerrain(deployed, 'forest');

    const forestTargets = movementCells(deployed, unit.id);

    expect(hasCoord(forestTargets, { q: 13, r: 10 })).toBe(true);
    expect(hasCoord(forestTargets, { q: 14, r: 10 })).toBe(false);

    setUniformTerrain(deployed, 'shallowWater');
    const waterTargets = movementCells(deployed, unit.id);

    expect(hasCoord(waterTargets, { q: 13, r: 10 })).toBe(true);
    expect(hasCoord(waterTargets, { q: 14, r: 10 })).toBe(false);
  });

  it('makes siege units clearly slower on complex terrain and uses troop type for deployment range', () => {
    const state = createGame('liu', 1);
    setUniformTerrain(state, 'hill');

    const infantryDeployTargets = deploymentCells(state, 'jiangling', undefined, 'sword');
    const siegeDeployTargets = deploymentCells(state, 'jiangling', undefined, 'siege');

    expect(infantryDeployTargets.length).toBeGreaterThan(siegeDeployTargets.length);

    const deployed = deployUnit(state, 'liu', {
      cityId: 'jiangling',
      officerId: 'guan-yu',
      troopType: 'siege',
      troops: 4000,
      food: 6000,
    });
    const unit = Object.values(deployed.units)[0];
    readyUnitAt(deployed, unit.id, { q: 10, r: 10 }, 'siege');

    const siegeTargets = movementCells(deployed, unit.id);

    expect(hasCoord(siegeTargets, { q: 12, r: 10 })).toBe(true);
    expect(hasCoord(siegeTargets, { q: 13, r: 10 })).toBe(false);
  });

  it('allows units to move into shallow water but not deep water', () => {
    const deployed = deployUnit(createGame('liu', 1), 'liu', {
      cityId: 'jiangling',
      officerId: 'guan-yu',
      targetCityId: 'xiangyang',
      troops: 4000,
      food: 6000,
    });
    const unit = Object.values(deployed.units)[0];
    deployed.units[unit.id].q = 27;
    deployed.units[unit.id].r = 10;
    deployed.units[unit.id].moved = false;
    deployed.units[unit.id].movementRemaining = 20;

    const shallow = deployed.grid.find((cell) => cell.q === 27 && cell.r === 9);
    const deep = deployed.grid.find((cell) => cell.q === 28 && cell.r === 10);

    expect(shallow?.terrain).toBe('shallowWater');
    expect(deep?.terrain).toBe('deepWater');
    expect(moveUnit(deployed, 'liu', unit.id, shallow!).units[unit.id]).toMatchObject({ q: shallow!.q, r: shallow!.r });
    expect(() => moveUnit(deployed, 'liu', unit.id, deep!)).toThrow(/通行|占用|目标/);
  });

  it('lists tactics for each supported troop type', () => {
    const state = deployUnit(createGame('liu', 1), 'liu', {
      cityId: 'jiangling',
      officerId: 'guan-yu',
      troopType: 'spear',
      troops: 3000,
      food: 3000,
    });
    const unit = Object.values(state.units)[0];

    state.units[unit.id].troopType = 'spear';
    expect(unitTactics(state, unit.id).map((tactic) => tactic.name)).toEqual(['突刺', '螺旋突刺', '二段突刺']);
    state.units[unit.id].troopType = 'halberd';
    expect(unitTactics(state, unit.id).map((tactic) => tactic.name)).toEqual(['熊手', '横扫', '旋风']);
    state.units[unit.id].troopType = 'crossbow';
    expect(unitTactics(state, unit.id).map((tactic) => tactic.name)).toEqual(['火矢', '贯箭', '乱射']);
    state.units[unit.id].troopType = 'cavalry';
    expect(unitTactics(state, unit.id).map((tactic) => tactic.name)).toEqual(['突击', '突破', '突进']);
  });

  it('uses spear tactics to push or confuse a target and spend energy', () => {
    const state = deployUnit(createGame('liu', 1), 'liu', {
      cityId: 'jiangling',
      officerId: 'guan-yu',
      troopType: 'spear',
      troops: 3000,
      food: 3000,
    });
    setUniformTerrain(state, 'plain');
    const attacker = Object.values(state.units)[0];
    readyUnitAt(state, attacker.id, { q: 10, r: 10 }, 'spear');
    addEnemyUnit(state, 'enemy-thrust', { q: 11, r: 10 });

    expect(tacticTargetUnits(state, attacker.id, 'spear-thrust').map((unit) => unit.id)).toContain('enemy-thrust');

    const pushed = useUnitTactic(state, 'liu', attacker.id, 'enemy-thrust', 'spear-thrust');

    expect(pushed.units[attacker.id].energy).toBe(85);
    expect(pushed.units[attacker.id].acted).toBe(true);
    expect(pushed.units['enemy-thrust']).toMatchObject({ q: 12, r: 11 });
    expect(pushed.units['enemy-thrust'].troops).toBeLessThan(3000);

    const spiralState = structuredClone(state);
    spiralState.units[attacker.id].energy = 100;
    const confused = useUnitTactic(spiralState, 'liu', attacker.id, 'enemy-thrust', 'spear-spiral');

    expect(confused.units[attacker.id].energy).toBe(80);
    expect(confused.units['enemy-thrust']).toMatchObject({ q: 11, r: 10, confusedTenDays: 1 });
  });

  it('pushes a spear thrust target one hex straight behind the target on offset-grid diagonals', () => {
    const state = deployUnit(createGame('liu', 1), 'liu', {
      cityId: 'jiangling',
      officerId: 'guan-yu',
      troopType: 'spear',
      troops: 3000,
      food: 3000,
    });
    setUniformTerrain(state, 'plain');
    const attacker = Object.values(state.units)[0];
    readyUnitAt(state, attacker.id, { q: 10, r: 10 }, 'spear');
    addEnemyUnit(state, 'enemy-diagonal-thrust', { q: 11, r: 9 });

    const pushed = useUnitTactic(state, 'liu', attacker.id, 'enemy-diagonal-thrust', 'spear-thrust');

    expect(pushed.units['enemy-diagonal-thrust']).toMatchObject({ q: 12, r: 9 });
  });

  it('uses halberd and crossbow tactics to hit multiple targets', () => {
    const state = deployUnit(createGame('liu', 1), 'liu', {
      cityId: 'jiangling',
      officerId: 'guan-yu',
      troopType: 'halberd',
      troops: 2000,
      food: 3000,
    });
    setUniformTerrain(state, 'plain');
    const attacker = Object.values(state.units)[0];
    readyUnitAt(state, attacker.id, { q: 10, r: 10 }, 'halberd');
    addEnemyUnit(state, 'enemy-front', { q: 11, r: 10 });
    addEnemyUnit(state, 'enemy-side', { q: 10, r: 9 });

    const whirlwind = useUnitTactic(state, 'liu', attacker.id, 'enemy-front', 'halberd-whirlwind');

    expect(whirlwind.units[attacker.id].energy).toBe(70);
    expect(whirlwind.battleDamageReports?.map((report) => report.unitId).sort()).toEqual(['enemy-front', 'enemy-side']);

    const crossbowState = deployUnit(createGame('liu', 1), 'liu', {
      cityId: 'jiangling',
      officerId: 'guan-yu',
      troopType: 'crossbow',
      troops: 2000,
      food: 3000,
    });
    setUniformTerrain(crossbowState, 'plain');
    const crossbow = Object.values(crossbowState.units)[0];
    readyUnitAt(crossbowState, crossbow.id, { q: 10, r: 10 }, 'crossbow');
    addEnemyUnit(crossbowState, 'enemy-arrow', { q: 12, r: 10 });
    addEnemyUnit(crossbowState, 'enemy-behind', { q: 14, r: 10 });

    const pierced = useUnitTactic(crossbowState, 'liu', crossbow.id, 'enemy-arrow', 'crossbow-pierce');

    expect(pierced.units[crossbow.id].energy).toBe(85);
    expect(pierced.battleDamageReports?.map((report) => report.unitId).sort()).toEqual(['enemy-arrow', 'enemy-behind']);
  });

  it('uses fire arrow and cavalry breakthrough special effects', () => {
    const crossbowState = deployUnit(createGame('liu', 1), 'liu', {
      cityId: 'jiangling',
      officerId: 'guan-yu',
      troopType: 'crossbow',
      troops: 2000,
      food: 3000,
    });
    setUniformTerrain(crossbowState, 'plain');
    const crossbow = Object.values(crossbowState.units)[0];
    readyUnitAt(crossbowState, crossbow.id, { q: 10, r: 10 }, 'crossbow');
    addEnemyUnit(crossbowState, 'enemy-fire', { q: 12, r: 10 });

    const burning = useUnitTactic(crossbowState, 'liu', crossbow.id, 'enemy-fire', 'crossbow-fire');

    expect(burning.units[crossbow.id].energy).toBe(90);
    expect(burning.units['enemy-fire'].burningTenDays).toBe(1);

    const cavalryState = deployUnit(createGame('liu', 1), 'liu', {
      cityId: 'jiangling',
      officerId: 'guan-yu',
      troopType: 'cavalry',
      troops: 3000,
      food: 3000,
    });
    setUniformTerrain(cavalryState, 'plain');
    const cavalry = Object.values(cavalryState.units)[0];
    readyUnitAt(cavalryState, cavalry.id, { q: 10, r: 10 }, 'cavalry');
    addEnemyUnit(cavalryState, 'enemy-breakthrough', { q: 11, r: 10 });

    const breakthrough = useUnitTactic(cavalryState, 'liu', cavalry.id, 'enemy-breakthrough', 'cavalry-breakthrough');

    expect(breakthrough.units[cavalry.id]).toMatchObject({ q: 12, r: 11, energy: 80, acted: true });
    expect(breakthrough.units['enemy-breakthrough']).toMatchObject({ q: 11, r: 10 });
  });

  it('dispatches an enemy defense unit on that enemy force turn after territory is invaded', () => {
    const deployed = deployUnit(createGame('liu', 1), 'liu', {
      cityId: 'jiangling',
      officerId: 'guan-yu',
      targetCityId: 'xiangyang',
      troops: 4000,
      food: 6000,
    });
    const blockedCityKeys = cityKeys(deployed);
    const passable = (coord: { q: number; r: number }) => {
      const cell = deployed.grid.find((candidate) => candidate.q === coord.q && candidate.r === coord.r);
      return cell && !['mountain', 'deepWater'].includes(cell.terrain) && !blockedCityKeys.has(gridKey(cell));
    };
    const from = deployed.grid.find((cell) => (
      passable(cell) &&
      territoryForceAt(deployed, cell) === 'liu' &&
      neighborsOf(cell.q, cell.r).some((neighbor) => {
        const neighborCell = deployed.grid.find((candidate) => candidate.q === neighbor.q && candidate.r === neighbor.r);
        return neighborCell && passable(neighborCell) && territoryForceAt(deployed, neighborCell) === 'cao';
      })
    ))!;
    const destination = neighborsOf(from.q, from.r)
      .map((neighbor) => deployed.grid.find((cell) => cell.q === neighbor.q && cell.r === neighbor.r))
      .find((cell) => cell && passable(cell) && territoryForceAt(deployed, cell) === 'cao')!;
    const defenseCity = territoryCityAt(deployed, destination);
    const unit = Object.values(deployed.units)[0];
    deployed.units[unit.id].q = from.q;
    deployed.units[unit.id].r = from.r;
    deployed.units[unit.id].moved = false;
    deployed.units[unit.id].movementRemaining = 20;

    const moved = moveUnit(deployed, 'liu', unit.id, destination);
    const immediateDefense = Object.values(moved.units).find((candidate) => candidate.id.startsWith(`defense-${defenseCity.id}-`));

    expect(immediateDefense).toBeUndefined();

    const next = runAiTurn(moved, 'cao');
    const defenseUnit = Object.values(next.units).find((candidate) => candidate.id.startsWith(`defense-${defenseCity.id}-`));

    expect(defenseUnit).toBeTruthy();
    expect(defenseUnit).toMatchObject({
      forceId: 'cao',
      homeCityId: defenseCity.id,
      troops: 3000,
      moved: true,
      movementRemaining: 0,
    });
    expect(next.cities[defenseCity.id].troops).toBeLessThan(deployed.cities[defenseCity.id].troops);
    expect(next.officers[defenseUnit!.leaderId].location).toEqual({ kind: 'unit', unitId: defenseUnit!.id });
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

  it('damages an adjacent enemy unit and receives a counterattack', () => {
    const deployed = deployUnit(createGame('liu', 1), 'liu', {
      cityId: 'jiangling',
      officerId: 'guan-yu',
      targetCityId: 'xiangyang',
      troops: 4000,
      food: 6000,
    });
    const attacker = Object.values(deployed.units)[0];
    const enemyId = 'unit-enemy-cao-ren';
    const enemyPosition = neighborsOf(attacker.q, attacker.r)[0];
    deployed.units[enemyId] = {
      id: enemyId,
      forceId: 'cao',
      leaderId: 'cao-ren',
      homeCityId: 'xiangyang',
      q: enemyPosition.q,
      r: enemyPosition.r,
      troops: 3500,
      food: 4000,
      energy: 100,
      movementRemaining: 5,
      moved: false,
      acted: false,
    };
    deployed.officers['cao-ren'].location = { kind: 'unit', unitId: enemyId };

    const next = attackUnit(deployed, 'liu', attacker.id, enemyId);

    expect(next.units[enemyId].troops).toBeLessThan(3500);
    expect(next.units[attacker.id].troops).toBeLessThan(4000);
    expect(next.units[attacker.id].energy).toBe(90);
    expect(next.units[attacker.id].acted).toBe(true);
    expect(next.units[enemyId].acted).toBe(false);
  });

  it('records damage numbers for the attacked unit and counterattack loss', () => {
    const deployed = deployUnit(createGame('liu', 1), 'liu', {
      cityId: 'jiangling',
      officerId: 'guan-yu',
      troops: 4000,
      food: 6000,
    });
    const attacker = Object.values(deployed.units)[0];
    const enemyId = 'unit-enemy-cao-ren';
    const enemyPosition = neighborsOf(attacker.q, attacker.r)[0];
    deployed.units[enemyId] = {
      id: enemyId,
      forceId: 'cao',
      leaderId: 'cao-ren',
      homeCityId: 'xiangyang',
      q: enemyPosition.q,
      r: enemyPosition.r,
      troops: 3500,
      food: 4000,
      energy: 100,
      movementRemaining: 5,
      moved: false,
      acted: false,
    };
    deployed.officers['cao-ren'].location = { kind: 'unit', unitId: enemyId };

    const next = attackUnit(deployed, 'liu', attacker.id, enemyId);
    const reports = next.battleDamageReports ?? [];

    expect(reports).toHaveLength(2);
    expect(reports[0]).toMatchObject({
      unitId: enemyId,
      q: enemyPosition.q,
      r: enemyPosition.r,
      kind: 'attack',
      amount: 3500 - next.units[enemyId].troops,
    });
    expect(reports[1]).toMatchObject({
      unitId: attacker.id,
      q: attacker.q,
      r: attacker.r,
      kind: 'counter',
      amount: 4000 - next.units[attacker.id].troops,
    });
  });

  it('limits melee attacks to adjacent enemy units', () => {
    const deployed = deployUnit(createGame('liu', 1), 'liu', {
      cityId: 'jiangling',
      officerId: 'guan-yu',
      troops: 4000,
      food: 6000,
    });
    const attacker = Object.values(deployed.units)[0];
    const adjacent = neighborsOf(attacker.q, attacker.r)[0];
    const twoStep = neighborsOf(adjacent.q, adjacent.r)
      .find((coord) => coord.q !== attacker.q && coord.r !== attacker.r && !neighborsOf(attacker.q, attacker.r).some((near) => near.q === coord.q && near.r === coord.r))!;

    deployed.units['enemy-adjacent'] = {
      id: 'enemy-adjacent',
      forceId: 'cao',
      leaderId: 'cao-ren',
      homeCityId: 'xiangyang',
      q: adjacent.q,
      r: adjacent.r,
      troops: 3000,
      food: 3000,
      energy: 100,
      movementRemaining: 5,
      moved: false,
      acted: false,
    };
    deployed.units['enemy-ranged'] = {
      id: 'enemy-ranged',
      forceId: 'cao',
      leaderId: 'xiahou-dun',
      homeCityId: 'wan',
      q: twoStep.q,
      r: twoStep.r,
      troops: 3000,
      food: 3000,
      energy: 100,
      movementRemaining: 5,
      moved: false,
      acted: false,
    };

    expect(attackableUnits(deployed, attacker.id).map((unit) => unit.id)).toEqual(['enemy-adjacent']);
    expect(() => attackUnit(deployed, 'liu', attacker.id, 'enemy-ranged')).toThrow(/目标|相邻|范围/);
  });

  it('allows crossbow and siege units to attack with one-cell spacing', () => {
    const state = createGame('liu', 1);
    state.cities.jiangling.armaments!.crossbow = 4000;
    const deployed = deployUnit(state, 'liu', {
      cityId: 'jiangling',
      officerId: 'guan-yu',
      troopType: 'crossbow',
      troops: 4000,
      food: 6000,
    });
    const attacker = Object.values(deployed.units)[0];
    const adjacent = neighborsOf(attacker.q, attacker.r)[0];
    const twoStep = neighborsOf(adjacent.q, adjacent.r)
      .find((coord) => coord.q !== attacker.q && coord.r !== attacker.r && !neighborsOf(attacker.q, attacker.r).some((near) => near.q === coord.q && near.r === coord.r))!;

    deployed.units['enemy-ranged'] = {
      id: 'enemy-ranged',
      forceId: 'cao',
      leaderId: 'cao-ren',
      homeCityId: 'xiangyang',
      q: twoStep.q,
      r: twoStep.r,
      troops: 3000,
      food: 3000,
      energy: 100,
      movementRemaining: 5,
      moved: false,
      acted: false,
    };

    expect(attackableUnits(deployed, attacker.id).map((unit) => unit.id)).toEqual(['enemy-ranged']);
    expect(attackUnit(deployed, 'liu', attacker.id, 'enemy-ranged').units['enemy-ranged'].troops).toBeLessThan(3000);
  });

  it('calculates attack targets from a planned movement destination', () => {
    const deployed = deployUnit(createGame('liu', 1), 'liu', {
      cityId: 'jiangling',
      officerId: 'guan-yu',
      troops: 4000,
      food: 6000,
    });
    const attacker = Object.values(deployed.units)[0];
    const destination = neighborsOf(attacker.q, attacker.r)[0];
    const enemyPosition = neighborsOf(destination.q, destination.r)
      .find((coord) => coord.q !== attacker.q || coord.r !== attacker.r)!;
    deployed.units['enemy-after-move'] = {
      id: 'enemy-after-move',
      forceId: 'cao',
      leaderId: 'cao-ren',
      homeCityId: 'xiangyang',
      q: enemyPosition.q,
      r: enemyPosition.r,
      troops: 3000,
      food: 3000,
      energy: 100,
      movementRemaining: 5,
      moved: false,
      acted: false,
    };

    expect(attackableUnits(deployed, attacker.id).map((unit) => unit.id)).toEqual([]);
    expect(attackableUnits(deployed, attacker.id, destination).map((unit) => unit.id)).toEqual(['enemy-after-move']);
  });

  it('requires two actionable friendly units adjacent to the same enemy for a joint attack', () => {
    const first = deployUnit(createGame('liu', 1), 'liu', {
      cityId: 'jiangling',
      officerId: 'guan-yu',
      troops: 4000,
      food: 6000,
    });
    const second = deployUnit(first, 'liu', {
      cityId: 'wuling',
      officerId: 'zhang-fei',
      troops: 4000,
      food: 6000,
    });
    const [attacker, ally] = Object.values(second.units);
    const enemyPosition = neighborsOf(attacker.q, attacker.r)[0];
    const allyPosition = neighborsOf(enemyPosition.q, enemyPosition.r)
      .find((coord) => (
        (coord.q !== attacker.q || coord.r !== attacker.r) &&
        !Object.values(second.units).some((unit) => unit.q === coord.q && unit.r === coord.r)
      ))!;
    second.units[ally.id].q = allyPosition.q;
    second.units[ally.id].r = allyPosition.r;
    second.units[attacker.id].moved = false;
    second.units[attacker.id].acted = false;
    second.units[ally.id].moved = false;
    second.units[ally.id].acted = false;
    second.units['joint-target'] = {
      id: 'joint-target',
      forceId: 'cao',
      leaderId: 'cao-ren',
      homeCityId: 'xiangyang',
      q: enemyPosition.q,
      r: enemyPosition.r,
      troops: 3000,
      food: 3000,
      energy: 100,
      movementRemaining: 5,
      moved: false,
      acted: false,
    };

    expect(jointAttackableUnits(second, attacker.id).map((unit) => unit.id)).toEqual(['joint-target']);

    second.units[ally.id].acted = true;
    expect(jointAttackableUnits(second, attacker.id).map((unit) => unit.id)).toEqual([]);
  });

  it('captures a city when siege damage drops garrison or durability to zero', () => {
    const deployed = deployUnit(createGame('liu', 1), 'liu', {
      cityId: 'jiangling',
      officerId: 'guan-yu',
      targetCityId: 'xiangyang',
      troops: 6000,
      food: 6000,
    });
    const attacker = Object.values(deployed.units)[0];
    const target = deployed.cities.xiangyang;
    const blockedKeys = cityKeys(deployed);
    const siegeCell = sevenCellCityFootprint({ q: target.gridQ, r: target.gridR })
      .flatMap((coord) => neighborsOf(coord.q, coord.r))
      .find((coord) => !blockedKeys.has(gridKey(coord)))!;
    deployed.units[attacker.id].q = siegeCell.q;
    deployed.units[attacker.id].r = siegeCell.r;
    deployed.cities.xiangyang.troops = 100;
    deployed.cities.xiangyang.durability = 100;

    const next = attackCity(deployed, 'liu', attacker.id, 'xiangyang');

    expect(next.cities.xiangyang.ownerId).toBe('liu');
    expect(next.cities.xiangyang.governorId).toBeNull();
    expect(next.cities.xiangyang.troops).toBeGreaterThan(0);
    expect(next.units[attacker.id].troops).toBeLessThan(6000);
    expect(next.units[attacker.id].acted).toBe(true);
  });

  it('lists enemy cities in attack range and lets siege attack from two cells away', () => {
    const deployed = deployUnit(createGame('liu', 1), 'liu', {
      cityId: 'jiangling',
      officerId: 'guan-yu',
      targetCityId: 'xiangyang',
      troopType: 'siege',
      troops: 6000,
      food: 6000,
    });
    const attacker = Object.values(deployed.units)[0];
    const target = deployed.cities.xiangyang;
    const blockedKeys = cityKeys(deployed);
    const adjacentCell = sevenCellCityFootprint({ q: target.gridQ, r: target.gridR })
      .flatMap((coord) => neighborsOf(coord.q, coord.r))
      .find((coord) => !blockedKeys.has(gridKey(coord)))!;
    const twoCellAttackPosition = neighborsOf(adjacentCell.q, adjacentCell.r)
      .find((coord) => !blockedKeys.has(gridKey(coord)) && !sevenCellCityFootprint({ q: target.gridQ, r: target.gridR }).some((cityCoord) => neighborsOf(cityCoord.q, cityCoord.r).some((near) => near.q === coord.q && near.r === coord.r)))!;
    readyUnitAt(deployed, attacker.id, twoCellAttackPosition, 'siege');

    expect(attackableCities(deployed, attacker.id).map((city) => city.id)).toContain('xiangyang');

    const next = attackCity(deployed, 'liu', attacker.id, 'xiangyang');
    expect(next.cities.xiangyang.durability).toBeLessThan(deployed.cities.xiangyang.durability);
  });

  it('makes siege attacks deal much higher city durability damage than other troops', () => {
    const deployed = deployUnit(createGame('liu', 1), 'liu', {
      cityId: 'jiangling',
      officerId: 'guan-yu',
      targetCityId: 'xiangyang',
      troops: 6000,
      food: 6000,
    });
    const attacker = Object.values(deployed.units)[0];
    const target = deployed.cities.xiangyang;
    const blockedKeys = cityKeys(deployed);
    const attackCell = sevenCellCityFootprint({ q: target.gridQ, r: target.gridR })
      .flatMap((coord) => neighborsOf(coord.q, coord.r))
      .find((coord) => !blockedKeys.has(gridKey(coord)))!;
    readyUnitAt(deployed, attacker.id, attackCell, 'sword');

    const siegeState = structuredClone(deployed);
    readyUnitAt(siegeState, attacker.id, attackCell, 'siege');

    const swordNext = attackCity(deployed, 'liu', attacker.id, 'xiangyang');
    const siegeNext = attackCity(siegeState, 'liu', attacker.id, 'xiangyang');
    const swordDurabilityLoss = deployed.cities.xiangyang.durability - swordNext.cities.xiangyang.durability;
    const siegeDurabilityLoss = siegeState.cities.xiangyang.durability - siegeNext.cities.xiangyang.durability;

    expect(swordDurabilityLoss).toBeGreaterThan(0);
    expect(siegeDurabilityLoss).toBeGreaterThan(swordDurabilityLoss * 3);
  });

  it('settles supply and advances ten-day turns', () => {
    const deployed = deployUnit(createGame('liu', 1), 'liu', {
      cityId: 'jiangling',
      officerId: 'guan-yu',
      targetCityId: 'xiangyang',
      troops: 4000,
      food: 50,
    });
    const unit = Object.values(deployed.units)[0];
    deployed.units[unit.id].acted = true;
    deployed.units[unit.id].energy = 40;

    const next = settleTenDay(deployed);

    expect(next.tenDay).toBe(2);
    expect(next.turnForceId).toBe('liu');
    expect(next.units[unit.id].food).toBe(0);
    expect(next.units[unit.id].energy).toBe(20);
    expect(next.units[unit.id].troops).toBeLessThan(4000);
    expect(next.units[unit.id].movementRemaining).toBe(22);
    expect(next.units[unit.id].moved).toBe(false);
    expect(next.units[unit.id].acted).toBe(false);
  });
});
