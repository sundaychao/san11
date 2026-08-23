import { describe, expect, it, vi } from 'vitest';
import { runAiTurn } from '../ai';
import { nextRandom } from '../random';
import { createGame } from '../scenario/jingxiang208';
import { territoryCityAt, territoryForceAt } from '../territory';
import { settleTenDay } from '../turn';
import type { TroopType } from '../types';
import * as skillHandlers from '../skills/handlers';
import { attackableCities, attackableFacilities, attackableUnits, attackCity, attackFacility, attackUnit, buildFacility, deployTransportUnit, deployUnit, deployUnitPreviewWithId, deploymentCells, dismantleFacility, effectiveUnitAbilities, FACILITY_BUILD_COSTS, facilityBuildTargets, fireStrategySuccessChance, harmfulStrategySuccessChance, jointAttackableUnits, moveUnit, movementCells, repairableFacilities, repairFacility, strategyTargetCells, strategyTargetUnits, tacticCriticalChance, tacticTargetFacilities, unitCanUseTactic, unitFacilities, unitStrategies, tacticTargetUnits, unitTactics, useFirePlot, useUnitStrategy, useUnitTactic, waitUnit } from './actions';
import { movementAllowanceForProfile, movementAllowanceForUnit } from './definitions';
import { gridKey, neighborsOf, sevenCellCityFootprint } from './grid';
import { damageRoll } from './shared';
import { strategyEnergyCostForUnit } from './strategies';

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

function stateWithSkillUnit(skill: string, troopType: TroopType) {
  const state = createGame('liu', 1);
  state.officers['liu-bei'].skill = skill;
  state.units.test = {
    id: 'test', kind: 'combat', forceId: 'liu', leaderId: 'liu-bei', officerIds: ['liu-bei'],
    homeCityId: 'jiangling', troopType, q: 0, r: 0, troops: 4000, food: 4000,
    energy: 100, movementRemaining: 30, moved: false, acted: false,
  };
  return state;
}

function combatSkillState(attackerSkill: string, targetSkill = '无', targetTroops = 6000) {
  const state = createGame('liu', 1);
  setUniformTerrain(state, 'plain');
  state.officers['guan-yu'].skill = attackerSkill;
  state.officers['guan-yu'].stats.war = 97;
  state.officers['guan-yu'].location = { kind: 'unit', unitId: 'skill-attacker' };
  state.officers['cao-ren'].skill = targetSkill;
  state.officers['cao-ren'].stats.war = 60;
  state.officers['cao-ren'].location = { kind: 'unit', unitId: 'skill-target' };
  state.units = {
    'skill-attacker': {
      id: 'skill-attacker', kind: 'combat', forceId: 'liu', leaderId: 'guan-yu', officerIds: ['guan-yu'],
      homeCityId: 'jiangling', troopType: 'spear', q: 10, r: 10, troops: 6000, food: 6000,
      energy: 100, movementRemaining: 20, moved: false, acted: false,
    },
    'skill-target': {
      id: 'skill-target', kind: 'combat', forceId: 'cao', leaderId: 'cao-ren', officerIds: ['cao-ren'],
      homeCityId: 'xiangyang', troopType: 'spear', q: 11, r: 10, troops: targetTroops, food: 6000,
      energy: 100, movementRemaining: 20, moved: false, acted: false,
    },
  };
  return { state, attacker: state.units['skill-attacker'], target: state.units['skill-target'] };
}

function strategySkillState(casterSkill = '无', targetSkill = '无') {
  const state = createGame('liu', 1);
  setUniformTerrain(state, 'plain');
  state.officers['zhuge-liang'].skill = casterSkill;
  state.officers['zhuge-liang'].location = { kind: 'unit', unitId: 'strategy-caster' };
  state.officers['cao-ren'].skill = targetSkill;
  state.officers['cao-ren'].location = { kind: 'unit', unitId: 'strategy-skill-target' };
  state.units = {
    'strategy-caster': {
      id: 'strategy-caster', kind: 'combat', forceId: 'liu', leaderId: 'zhuge-liang', officerIds: ['zhuge-liang'],
      homeCityId: 'jiangling', troopType: 'spear', q: 10, r: 10, troops: 5000, food: 5000,
      energy: 100, movementRemaining: 20, moved: false, acted: false,
    },
    'strategy-skill-target': {
      id: 'strategy-skill-target', kind: 'combat', forceId: 'cao', leaderId: 'cao-ren', officerIds: ['cao-ren'],
      homeCityId: 'xiangyang', troopType: 'spear', q: 11, r: 10, troops: 5000, food: 5000,
      energy: 100, movementRemaining: 20, moved: false, acted: false,
    },
  };
  return {
    state,
    caster: state.units['strategy-caster'],
    target: state.units['strategy-skill-target'],
  };
}

function seedForFirstRoll(predicate: (value: number) => boolean) {
  for (let seed = 1; seed < 100_000; seed += 1) {
    if (predicate(nextRandom(seed, 0).value)) return seed;
  }
  throw new Error('Unable to find a matching deterministic seed');
}

function seedForTwoRolls(firstPredicate: (value: number) => boolean, secondPredicate: (value: number) => boolean) {
  for (let seed = 1; seed < 100_000; seed += 1) {
    if (firstPredicate(nextRandom(seed, 0).value) && secondPredicate(nextRandom(seed, 1).value)) return seed;
  }
  throw new Error('Unable to find matching deterministic seeds');
}

function spearTacticState(grade: 'S' | 'A' | 'B' | 'C', seed = 1, troops = 10_000) {
  const state = deployUnit(createGame('liu', seed), 'liu', {
    cityId: 'jiangling',
    officerId: 'guan-yu',
    troopType: 'spear',
    troops: 4000,
    food: 5000,
  });
  setUniformTerrain(state, 'plain');
  const attacker = Object.values(state.units)[0];
  readyUnitAt(state, attacker.id, { q: 10, r: 10 }, 'spear');
  state.officers['guan-yu'].skill = '无';
  state.officers['guan-yu'].aptitudes!.spear = grade;
  state.officers['cao-ren'].stats.leadership = state.officers['guan-yu'].stats.leadership;
  addEnemyUnit(state, 'enemy-tactic', { q: 11, r: 10 }, troops);
  return { state, attacker, target: state.units['enemy-tactic'] };
}

type ProbabilisticStrategyId = 'fire' | 'false-report' | 'disturb' | 'discord';

function probabilisticStrategyState(strategyId: ProbabilisticStrategyId) {
  const state = deployUnit(createGame('liu', 1), 'liu', {
    cityId: 'jiangling', officerId: 'guan-yu', troops: 3000, food: 3000,
  });
  setUniformTerrain(state, 'plain');
  const unit = Object.values(state.units)[0];
  readyUnitAt(state, unit.id, { q: 10, r: 10 });
  state.units[unit.id].energy = 100;
  state.officers['guan-yu'].stats.intelligence = 70;
  addEnemyUnit(state, 'strategy-target', { q: 11, r: 10 });
  state.officers['cao-ren'].stats.intelligence = 70;

  if (strategyId === 'discord') {
    addEnemyUnit(state, 'discord-victim', { q: 12, r: 11 });
    state.units['discord-victim'].leaderId = 'cao-cao';
    state.officers['cao-cao'].stats.intelligence = 1;
    state.officers['cao-cao'].location = { kind: 'unit', unitId: 'discord-victim' };
  }

  const selection = strategyId === 'fire'
    ? { coord: { q: 10, r: 9 } } as const
    : { targetUnitId: 'strategy-target' } as const;
  const target = strategyId === 'fire' ? { q: 10, r: 9 } : state.units['strategy-target'];
  const sourceIntelligence = effectiveUnitAbilities(state, unit).intelligence.value;
  const chance = strategyId === 'fire'
    ? fireStrategySuccessChance(sourceIntelligence)
    : harmfulStrategySuccessChance(
      sourceIntelligence,
      effectiveUnitAbilities(state, state.units['strategy-target']).intelligence.value,
    );
  return { state, unit, selection, target, chance };
}

describe('battle deployment and movement actions', () => {
  it('resets a 强行 formation to base movement plus five', () => {
    const state = stateWithSkillUnit('强行', 'spear');
    state.units.test.movementRemaining = 0;
    state.units.test.moved = true;

    const next = settleTenDay(state);

    expect(next.units.test.movementRemaining).toBe(movementAllowanceForUnit(next.units.test) + 5);
  });

  it('allows 飞将 through land zoc but stops at shallow-water zoc and occupied cells', () => {
    const state = stateWithSkillUnit('飞将', 'spear');
    state.units.test.movementRemaining = 12;
    state.units.enemy = {
      id: 'enemy', kind: 'combat', forceId: 'cao', leaderId: 'cao-ren', officerIds: ['cao-ren'],
      homeCityId: 'xiangyang', troopType: 'spear', q: 1, r: 1, troops: 4000, food: 4000,
      energy: 100, movementRemaining: 20, moved: false, acted: false,
    };
    state.grid = [
      { q: 0, r: 0, terrain: 'road' }, { q: 1, r: 0, terrain: 'road' },
      { q: 2, r: 0, terrain: 'road' }, { q: 1, r: 1, terrain: 'road' },
    ];

    expect(movementCells(state, 'test')).toContainEqual({ q: 2, r: 0 });
    expect(movementCells(state, 'test')).not.toContainEqual({ q: 1, r: 1 });
    for (const cell of state.grid) cell.terrain = 'water';
    expect(movementCells(state, 'test')).not.toContainEqual({ q: 2, r: 0 });

    for (const cell of state.grid) cell.terrain = 'road';
    state.officers['liu-bei'].skill = '无';
    expect(movementCells(state, 'test')).not.toContainEqual({ q: 2, r: 0 });
  });

  it('uses selected officer movement skills in deployment validation', () => {
    const state = createGame('liu', 1);
    state.officers['liu-bei'].skill = '强行';
    const base = deploymentCells(state, 'jiangling', movementAllowanceForProfile('spear'), 'spear');
    const enhanced = deploymentCells(state, 'jiangling', movementAllowanceForProfile('spear') + 5, 'spear');
    const destination = enhanced.find((coord) => !base.some((cell) => cell.q === coord.q && cell.r === coord.r));

    expect(destination).toBeDefined();
    const deployed = deployUnit(state, 'liu', {
      cityId: 'jiangling', officerIds: ['liu-bei'], troopType: 'spear', troops: 3000, food: 3000,
      destination,
    });
    const unit = Object.values(deployed.units)[0];
    expect(unit.movementRemaining).toBe(movementAllowanceForProfile('spear') + 5);

    const preview = deployUnitPreviewWithId(state, 'liu', {
      cityId: 'jiangling', officerIds: ['liu-bei'], troopType: 'spear', troops: 3000, food: 3000,
      destination,
    });
    expect(preview.state.units[preview.unitId].movementRemaining).toBe(movementAllowanceForProfile('spear') + 5);
  });

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
      movementRemaining: movementAllowanceForProfile('sword'),
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

  it('deploys a combat unit with carried gold from the city', () => {
    const state = createGame('liu', 1);
    const beforeGold = state.cities.jiangling.gold;

    const next = deployUnit(state, 'liu', {
      cityId: 'jiangling',
      officerId: 'guan-yu',
      troops: 4000,
      food: 6000,
      gold: 900,
    });

    const unit = Object.values(next.units)[0];
    expect(unit.gold).toBe(900);
    expect(next.cities.jiangling.gold).toBe(beforeGold - 900);
  });

  it('spends carried unit gold when constructing facilities but not when repairing construction', () => {
    const state = deployUnit(createGame('liu', 1), 'liu', {
      cityId: 'jiangling',
      officerId: 'guan-yu',
      troops: 4000,
      food: 6000,
      gold: 900,
    });
    const unit = Object.values(state.units)[0];
    readyUnitAt(state, unit.id, { q: 10, r: 10 }, 'sword');

    const built = buildFacility(state, 'liu', unit.id, 'arrowTower', { q: 11, r: 10 });
    const facility = Object.values(built.facilities ?? {})[0];

    expect(FACILITY_BUILD_COSTS.arrowTower).toBe(600);
    expect(built.units[unit.id].gold).toBe(300);

    readyUnitAt(built, unit.id, { q: 10, r: 10 }, 'sword');
    const repaired = repairFacility(built, 'liu', unit.id, facility.id);

    expect(repaired.units[unit.id].gold).toBe(300);
  });

  it('does not allow construction without enough carried gold', () => {
    const state = deployUnit(createGame('liu', 1), 'liu', {
      cityId: 'jiangling',
      officerId: 'guan-yu',
      troops: 4000,
      food: 6000,
      gold: 500,
    });
    const unit = Object.values(state.units)[0];
    readyUnitAt(state, unit.id, { q: 10, r: 10 }, 'sword');

    expect(() => buildFacility(state, 'liu', unit.id, 'arrowTower', { q: 11, r: 10 })).toThrow(/资金不足/);
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

  it('uses ordinary movement occupancy rules for first deployment movement from the city center', () => {
    const state = createGame('liu', 1);
    const blocked = deploymentCells(state, 'jiangling')[0];
    state.facilities ??= {};
    state.facilities['deploy-blocker'] = {
      id: 'deploy-blocker',
      type: 'earthwork',
      forceId: 'liu',
      q: blocked.q,
      r: blocked.r,
      durability: 400,
    };

    expect(deploymentCells(state, 'jiangling')).not.toContainEqual(blocked);
    expect(() => deployUnit(state, 'liu', {
      cityId: 'jiangling',
      officerId: 'guan-yu',
      destination: blocked,
      troops: 4000,
      food: 6000,
    })).toThrow(/范围|位置|格/);
  });

  it('builds first deployment movement previews without consuming resources or requiring action points', () => {
    const state = createGame('liu', 1);
    const destination = deploymentCells(state, 'jiangling')[0];
    state.actionPoints.liu = 0;

    expect(() => deployUnit(state, 'liu', {
      cityId: 'jiangling',
      officerId: 'guan-yu',
      destination,
      troops: 4000,
      food: 6000,
    })).toThrow(/行动力|琛屽姩鍔?/);

    const preview = deployUnitPreviewWithId(state, 'liu', {
      cityId: 'jiangling',
      officerIds: ['guan-yu'],
      troopType: 'spear',
      destination,
      troops: 4000,
      food: 6000,
    });

    expect(preview.unitId).toBe('preview-deploy-guan-yu');
    expect(preview.state.actionPoints.liu).toBe(0);
    expect(preview.state.cities.jiangling.troops).toBe(state.cities.jiangling.troops);
    expect(preview.state.officers['guan-yu'].location).toEqual({ kind: 'city', cityId: 'jiangling' });
    expect(preview.state.units[preview.unitId]).toMatchObject({
      forceId: 'liu',
      leaderId: 'guan-yu',
      troopType: 'spear',
      q: destination.q,
      r: destination.r,
      moved: true,
      acted: false,
    });
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
      movementRemaining: 0,
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
    readyUnitAt(deployed, unit.id, unit, unit.troopType ?? 'sword');
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

  it('damages a unit when it moves onto a burning ground cell', () => {
    const deployed = deployUnit(createGame('liu', 1), 'liu', {
      cityId: 'jiangling',
      officerId: 'guan-yu',
      targetCityId: 'xiangyang',
      troops: 4000,
      food: 6000,
    });
    setUniformTerrain(deployed, 'plain');
    const unit = Object.values(deployed.units)[0];
    readyUnitAt(deployed, unit.id, { q: 10, r: 10 }, 'sword');
    const destination = { q: 11, r: 10 };
    deployed.firePlots = [destination];

    const next = moveUnit(deployed, 'liu', unit.id, destination);

    expect(next.units[unit.id].troops).toBe(3500);
    expect(next.battleDamageReports).toEqual([
      expect.objectContaining({
        unitId: unit.id,
        q: destination.q,
        r: destination.r,
        amount: 500,
        kind: 'attack',
      }),
    ]);
  });

  it('assigns each new burning ground cell a random duration of one to three ten-days', () => {
    const state = deployUnit(createGame('liu', 1), 'liu', {
      cityId: 'jiangling',
      officerId: 'guan-yu',
      troops: 4000,
      food: 6000,
    });
    const unit = Object.values(state.units)[0];
    readyUnitAt(state, unit.id, { q: 10, r: 10 }, 'sword');
    const target = { q: 11, r: 10 };

    const next = useFirePlot(state, 'liu', unit.id, target);

    expect(next.firePlots).toEqual([
      expect.objectContaining({
        q: target.q,
        r: target.r,
        remainingTenDays: expect.any(Number),
      }),
    ]);
    expect(next.firePlots![0].remainingTenDays).toBeGreaterThanOrEqual(1);
    expect(next.firePlots![0].remainingTenDays).toBeLessThanOrEqual(3);
  });

  it('builds a field facility on an adjacent legal cell and blocks movement through it', () => {
    const state = deployUnit(createGame('liu', 1), 'liu', {
      cityId: 'jiangling',
      officerId: 'guan-yu',
      troops: 4000,
      food: 6000,
    });
    const unit = Object.values(state.units)[0];
    readyUnitAt(state, unit.id, { q: 10, r: 10 }, 'sword');
    state.units[unit.id].gold = 1000;
    setUniformTerrain(state, 'plain');
    const target = neighborsOf(10, 10)[0];

    const next = buildFacility(state, 'liu', unit.id, 'earthwork', target);
    const facility = Object.values(next.facilities ?? {})[0];

    expect(facility).toMatchObject({ type: 'earthwork', forceId: 'liu', q: target.q, r: target.r });
    expect(next.units[unit.id]).toMatchObject({ acted: true, moved: true, movementRemaining: 0 });
    expect(facilityBuildTargets(next, unit.id)).not.toContainEqual(target);
    readyUnitAt(next, unit.id, { q: 10, r: 10 }, 'sword');
    expect(() => moveUnit(next, 'liu', unit.id, target)).toThrow(/占用|通行|目标/);
  });

  it('builds facilities by troop strength and marks incomplete construction as occupying only', () => {
    const state = deployUnit(createGame('liu', 1), 'liu', {
      cityId: 'jiangling',
      officerId: 'guan-yu',
      troops: 3000,
      food: 6000,
    });
    setUniformTerrain(state, 'plain');
    const unit = Object.values(state.units)[0];
    readyUnitAt(state, unit.id, { q: 10, r: 10 }, 'sword');
    state.units[unit.id].gold = 1000;
    state.units[unit.id].troops = 3000;
    const target = { q: 11, r: 10 };

    const next = buildFacility(state, 'liu', unit.id, 'arrowTower', target);
    const facility = Object.values(next.facilities ?? {})[0];

    expect(facility).toMatchObject({
      type: 'arrowTower',
      forceId: 'liu',
      q: target.q,
      r: target.r,
      durability: 150,
      completed: false,
    });
    expect((next as any).facilityRepairReports).toEqual([expect.objectContaining({
      facilityId: facility.id,
      q: target.q,
      r: target.r,
      amount: 150,
      kind: 'build',
    })]);
    expect(facilityBuildTargets(next, unit.id, undefined, 'drum')).not.toContainEqual({ q: 11, r: 11 });
    readyUnitAt(next, unit.id, { q: 10, r: 10 }, 'sword');
    expect(() => moveUnit(next, 'liu', unit.id, target)).toThrow(/占用|通行|目标|鍗犵敤|閫氳|鐩爣/);
  });

  it('completes construction immediately when one build exceeds facility durability', () => {
    const state = deployUnit(createGame('liu', 1), 'liu', {
      cityId: 'jiangling',
      officerId: 'guan-yu',
      troops: 10000,
      food: 6000,
    });
    setUniformTerrain(state, 'plain');
    const unit = Object.values(state.units)[0];
    readyUnitAt(state, unit.id, { q: 10, r: 10 }, 'sword');
    state.units[unit.id].gold = 1000;
    state.units[unit.id].troops = 10000;

    const next = buildFacility(state, 'liu', unit.id, 'earthwork', { q: 11, r: 10 });
    const facility = Object.values(next.facilities ?? {})[0];

    expect(facility).toMatchObject({ type: 'earthwork', durability: 400, completed: true });
  });

  it('doubles initial construction and free repair durability with deputy-provided 筑城 without changing gold cost', () => {
    const state = createGame('liu', 1);
    setUniformTerrain(state, 'plain');
    state.officers['guan-yu'].skill = '筑城';
    state.officers['zhang-fei'].skill = '筑城';
    state.officers['guan-yu'].location = { kind: 'unit', unitId: 'builder' };
    state.officers['zhang-fei'].location = { kind: 'unit', unitId: 'builder' };
    state.units.builder = {
      id: 'builder', kind: 'combat', forceId: 'liu', leaderId: 'liu-bei', officerIds: ['liu-bei', 'guan-yu', 'zhang-fei'],
      homeCityId: 'jiangling', troopType: 'spear', q: 10, r: 10, troops: 10_000, gold: 2000,
      food: 5000, energy: 100, movementRemaining: 20, moved: false, acted: false,
    };
    const target = facilityBuildTargets(state, 'builder', undefined, 'arrowTower')[0];

    const built = buildFacility(state, 'liu', 'builder', 'arrowTower', target);
    const facilityId = Object.keys(built.facilities!)[0];

    expect(built.facilities?.[facilityId]).toMatchObject({ durability: 700, completed: true });
    expect(built.units.builder.gold).toBe(2000 - FACILITY_BUILD_COSTS.arrowTower);
    expect(built.facilityRepairReports).toEqual([expect.objectContaining({ amount: 700, kind: 'build' })]);

    const repairState = structuredClone(state);
    repairState.units.builder.troops = 2000;
    repairState.facilities = {
      repairTarget: { id: 'repairTarget', type: 'arrowTower', forceId: 'liu', q: 11, r: 10, durability: 100, completed: false },
    };
    const repaired = repairFacility(repairState, 'liu', 'builder', 'repairTarget');

    expect(repaired.facilities?.repairTarget.durability).toBe(300);
    expect(repaired.units.builder.gold).toBe(2000);
    expect(repaired.facilityRepairReports).toEqual([expect.objectContaining({ amount: 200, kind: 'repair' })]);
  });

  it('repairs unfinished own facilities until they are completed', () => {
    const state = deployUnit(createGame('liu', 1), 'liu', {
      cityId: 'jiangling',
      officerId: 'guan-yu',
      troops: 10000,
      food: 6000,
    });
    setUniformTerrain(state, 'plain');
    const unit = Object.values(state.units)[0];
    readyUnitAt(state, unit.id, { q: 10, r: 10 }, 'sword');
    state.facilities = {
      tower: { id: 'tower', type: 'arrowTower', forceId: 'liu', q: 11, r: 10, durability: 150, completed: false },
    };

    const repaired = repairFacility(state, 'liu', unit.id, 'tower');

    expect(repaired.facilities?.tower).toMatchObject({ durability: 650, completed: false });
    expect((repaired as any).facilityRepairReports).toEqual([expect.objectContaining({
      facilityId: 'tower',
      q: 11,
      r: 10,
      amount: 500,
      kind: 'repair',
    })]);
    expect(repaired.units[unit.id]).toMatchObject({ acted: true, moved: true, movementRemaining: 0 });
    readyUnitAt(repaired, unit.id, { q: 10, r: 10 }, 'sword');

    const completed = repairFacility(repaired, 'liu', unit.id, 'tower');

    expect(completed.facilities?.tower).toMatchObject({ durability: 700, completed: true });
    expect((completed as any).facilityRepairReports).toEqual([expect.objectContaining({
      facilityId: 'tower',
      q: 11,
      r: 10,
      amount: 50,
      kind: 'repair',
    })]);
  });

  it('enables repair for own construction and public construction regardless of owner', () => {
    const state = deployUnit(createGame('liu', 1), 'liu', {
      cityId: 'jiangling',
      officerId: 'guan-yu',
      troops: 10000,
      food: 6000,
    });
    setUniformTerrain(state, 'plain');
    const unit = Object.values(state.units)[0];
    readyUnitAt(state, unit.id, { q: 10, r: 10 }, 'sword');
    state.facilities = {
      building: { id: 'building', type: 'arrowTower', forceId: 'liu', q: 11, r: 10, durability: 150, completed: false },
      damagedCompleted: { id: 'damagedCompleted', type: 'musicTower', forceId: 'liu', q: 10, r: 11, durability: 500, completed: true },
      enemyBuilding: { id: 'enemyBuilding', type: 'arrowTower', forceId: 'cao', q: 9, r: 10, durability: 150, completed: false },
      enemyEarthwork: { id: 'enemyEarthwork', type: 'earthwork', forceId: 'cao', q: 10, r: 9, durability: 150, completed: false },
      enemyFireSeed: { id: 'enemyFireSeed', type: 'fireSeed', forceId: 'cao', q: 9, r: 9, durability: 100, completed: false },
      enemyFireBall: { id: 'enemyFireBall', type: 'fireBall', forceId: 'cao', q: 11, r: 9, durability: 100, completed: false },
    };

    const repairableIds = repairableFacilities(state, unit.id).map((facility) => facility.id);
    expect(repairableIds).toHaveLength(4);
    expect(repairableIds).toEqual(expect.arrayContaining([
      'enemyFireSeed',
      'enemyEarthwork',
      'building',
      'enemyFireBall',
    ]));
    const repaired = repairFacility(state, 'liu', unit.id, 'enemyEarthwork');

    expect(repaired.facilities?.enemyEarthwork).toMatchObject({ durability: 400, completed: true, forceId: 'cao' });
    expect(() => repairFacility(state, 'liu', unit.id, 'enemyBuilding')).toThrow(/己方设施|宸辨柟璁炬柦/);
    expect(() => repairFacility(state, 'liu', unit.id, 'damagedCompleted')).toThrow(/修补范围|淇ˉ鑼冨洿/);
  });

  it('lets units attack enemy facilities and lets owners dismantle their own facilities', () => {
    const state = deployUnit(createGame('liu', 1), 'liu', {
      cityId: 'jiangling',
      officerId: 'guan-yu',
      troops: 4000,
      food: 6000,
    });
    setUniformTerrain(state, 'plain');
    const unit = Object.values(state.units)[0];
    readyUnitAt(state, unit.id, { q: 10, r: 10 }, 'sword');
    state.facilities = {
      enemyTower: { id: 'enemyTower', type: 'arrowTower', forceId: 'cao', q: 11, r: 10, durability: 200, completed: false },
      ownWall: { id: 'ownWall', type: 'earthwork', forceId: 'liu', q: 10, r: 11, durability: 400, completed: true },
    };

    expect(attackableFacilities(state, unit.id).map((facility) => facility.id)).toEqual(['enemyTower']);
    const attacked = attackFacility(state, 'liu', unit.id, 'enemyTower');
    expect(attacked.facilities?.enemyTower).toBeUndefined();

    const dismantled = dismantleFacility(state, 'liu', 'ownWall');
    expect(dismantled.facilities?.ownWall).toBeUndefined();
    expect(() => dismantleFacility(state, 'liu', 'enemyTower')).toThrow(/撤销|己方|设施/);
  });

  it('prevents arrow towers, drums, music towers, and fortresses from being built within two cells of each other', () => {
    const state = deployUnit(createGame('liu', 1), 'liu', {
      cityId: 'jiangling',
      officerId: 'guan-yu',
      troops: 4000,
      food: 6000,
    });
    setUniformTerrain(state, 'plain');
    const unit = Object.values(state.units)[0];
    readyUnitAt(state, unit.id, { q: 10, r: 12 }, 'sword');
    state.units[unit.id].gold = 1000;
    state.facilities = {
      tower: { id: 'tower', type: 'arrowTower', forceId: 'liu', q: 10, r: 10, durability: 700 },
    };
    const blocked = { q: 10, r: 11 };

    expect(facilityBuildTargets(state, unit.id, undefined, 'arrowTower')).not.toContainEqual(blocked);
    expect(facilityBuildTargets(state, unit.id, undefined, 'drum')).not.toContainEqual(blocked);
    expect(facilityBuildTargets(state, unit.id, undefined, 'musicTower')).not.toContainEqual(blocked);
    expect(facilityBuildTargets(state, unit.id, undefined, 'fortress')).not.toContainEqual(blocked);
    expect(facilityBuildTargets(state, unit.id, undefined, 'earthwork')).toContainEqual(blocked);
    expect(() => buildFacility(state, 'liu', unit.id, 'musicTower', blocked)).toThrow(/设置位置不可用|璁剧疆浣嶇疆涓嶅彲鐢?/);
    const fortressState = structuredClone(state);
    fortressState.facilities = {
      fortress: { id: 'fortress', type: 'fortress', forceId: 'liu', q: 10, r: 10, durability: 1200 },
    };
    expect(facilityBuildTargets(fortressState, unit.id, undefined, 'arrowTower')).not.toContainEqual(blocked);
    expect(facilityBuildTargets(fortressState, unit.id, undefined, 'drum')).not.toContainEqual(blocked);
    expect(facilityBuildTargets(fortressState, unit.id, undefined, 'musicTower')).not.toContainEqual(blocked);
    expect(facilityBuildTargets(fortressState, unit.id, undefined, 'fortress')).not.toContainEqual(blocked);
  });

  it('builds fortresses and reduces damage and food consumption for friendly units within three cells', () => {
    const base = deployUnit(createGame('liu', 1), 'liu', {
      cityId: 'jiangling',
      officerId: 'guan-yu',
      troops: 5000,
      food: 6000,
    });
    setUniformTerrain(base, 'plain');
    const defender = Object.values(base.units)[0];
    readyUnitAt(base, defender.id, { q: 11, r: 10 }, 'sword');
    base.units[defender.id].troops = 5000;
    base.units[defender.id].food = 5000;
    addEnemyUnit(base, 'fortress-attacker', { q: 10, r: 10 }, 5000);

    const withFortress = structuredClone(base);
    withFortress.facilities = {
      fortress: { id: 'fortress', type: 'fortress', forceId: 'liu', q: 12, r: 10, durability: 1200 },
    };

    expect(unitFacilities().some((facility) => (facility.type as string) === 'fortress')).toBe(true);

    const normal = attackUnit(base, 'cao', 'fortress-attacker', defender.id);
    const protectedState = attackUnit(withFortress, 'cao', 'fortress-attacker', defender.id);
    const normalLoss = base.units[defender.id].troops - normal.units[defender.id].troops;
    const protectedLoss = withFortress.units[defender.id].troops - protectedState.units[defender.id].troops;

    expect(protectedLoss).toBe(Math.round(normalLoss * 0.7));

    const supplied = settleTenDay(withFortress);
    expect(supplied.units[defender.id].food).toBe(4650);
  });

  it('does not apply ZOC or facility effects from unfinished facilities', () => {
    const base = deployUnit(createGame('liu', 1), 'liu', {
      cityId: 'jiangling',
      officerId: 'guan-yu',
      troops: 5000,
      food: 6000,
    });
    base.grid = [
      { q: 10, r: 10, terrain: 'plain' },
      { q: 11, r: 10, terrain: 'plain' },
      { q: 12, r: 11, terrain: 'plain' },
      { q: 12, r: 10, terrain: 'plain' },
    ];
    const defender = Object.values(base.units)[0];
    readyUnitAt(base, defender.id, { q: 11, r: 10 }, 'sword');
    base.units[defender.id].troops = 5000;
    base.units[defender.id].food = 5000;
    addEnemyUnit(base, 'unfinished-attacker', { q: 10, r: 10 }, 5000);

    const withUnfinished = structuredClone(base);
    withUnfinished.facilities = {
      fortress: { id: 'fortress', type: 'fortress', forceId: 'liu', q: 12, r: 10, durability: 150, completed: false },
      music: { id: 'music', type: 'musicTower', forceId: 'liu', q: 10, r: 11, durability: 150, completed: false },
      arrow: { id: 'arrow', type: 'arrowTower', forceId: 'cao', q: 12, r: 10, durability: 150, completed: false },
    };
    withUnfinished.units[defender.id].energy = 50;
    withUnfinished.units[defender.id].movementRemaining = 8;

    const normal = attackUnit(base, 'cao', 'unfinished-attacker', defender.id);
    const protectedState = attackUnit(withUnfinished, 'cao', 'unfinished-attacker', defender.id);
    expect(withUnfinished.units[defender.id].troops - protectedState.units[defender.id].troops)
      .toBe(base.units[defender.id].troops - normal.units[defender.id].troops);

    const settled = settleTenDay(withUnfinished);
    expect(settled.units[defender.id].energy).toBe(55);
    expect(settled.units[defender.id].food).toBe(4500);
    expect(movementCells(withUnfinished, defender.id)).toContainEqual({ q: 12, r: 11 });
  });

  it('applies drum damage bonuses to friendly attacks in range', () => {
    const base = deployUnit(createGame('liu', 1), 'liu', {
      cityId: 'jiangling',
      officerId: 'guan-yu',
      troops: 4000,
      food: 6000,
    });
    const attacker = Object.values(base.units)[0];
    readyUnitAt(base, attacker.id, { q: 10, r: 10 }, 'sword');
    addEnemyUnit(base, 'enemy-no-drum', { q: 11, r: 10 }, 5000);
    const withDrum = structuredClone(base);
    withDrum.facilities = {
      drum: { id: 'drum', type: 'drum', forceId: 'liu', q: 10, r: 11, durability: 800 },
    };
    withDrum.units['enemy-drum'] = { ...withDrum.units['enemy-no-drum'], id: 'enemy-drum', q: 11, r: 10, troops: 5000 };
    delete withDrum.units['enemy-no-drum'];

    const normal = attackUnit(base, 'liu', attacker.id, 'enemy-no-drum');
    const boosted = attackUnit(withDrum, 'liu', attacker.id, 'enemy-drum');

    expect(5000 - boosted.units['enemy-drum'].troops).toBeGreaterThan(5000 - normal.units['enemy-no-drum'].troops);
  });

  it('settles music tower morale recovery and arrow tower automatic damage each ten-day', () => {
    const state = deployUnit(createGame('liu', 1), 'liu', {
      cityId: 'jiangling',
      officerId: 'guan-yu',
      troops: 4000,
      food: 6000,
    });
    const unit = Object.values(state.units)[0];
    state.units[unit.id].q = 10;
    state.units[unit.id].r = 10;
    state.units[unit.id].energy = 50;
    addEnemyUnit(state, 'arrow-target', { q: 13, r: 10 }, 3000);
    state.facilities = {
      music: { id: 'music', type: 'musicTower', forceId: 'liu', q: 10, r: 11, durability: 800 },
      arrow: { id: 'arrow', type: 'arrowTower', forceId: 'liu', q: 12, r: 10, durability: 700 },
    };

    const next = settleTenDay(state);

    expect(next.units[unit.id].energy).toBe(65);
    expect(next.units['arrow-target'].troops).toBeLessThan(3000);
  });

  it('ignites fire seed and fire ball traps with fire strategy', () => {
    const seedState = deployUnit(createGame('liu', 1), 'liu', {
      cityId: 'jiangling',
      officerId: 'guan-yu',
      troops: 4000,
      food: 6000,
    });
    const seedUnit = Object.values(seedState.units)[0];
    readyUnitAt(seedState, seedUnit.id, { q: 10, r: 10 }, 'sword');
    addEnemyUnit(seedState, 'seed-target', { q: 11, r: 11 }, 3000);
    seedState.facilities = {
      seed: { id: 'seed', type: 'fireSeed', forceId: 'liu', q: 11, r: 10, durability: 200 },
    };

    const seedResult = useUnitStrategy(seedState, 'liu', seedUnit.id, 'fire', { coord: { q: 11, r: 10 } });
    expect(seedResult.units['seed-target'].troops).toBeLessThan(3000);
    expect(seedResult.facilities?.seed).toBeUndefined();
    expect(seedResult.firePlots).toEqual(expect.arrayContaining([
      expect.objectContaining({ q: 11, r: 10 }),
      ...neighborsOf(11, 10).map((coord) => expect.objectContaining(coord)),
    ]));
    expect(seedResult.firePlots).toHaveLength(7);

    const ballState = deployUnit(createGame('liu', 1), 'liu', {
      cityId: 'jiangling',
      officerId: 'guan-yu',
      troops: 4000,
      food: 6000,
    });
    const ballUnit = Object.values(ballState.units)[0];
    readyUnitAt(ballState, ballUnit.id, { q: 10, r: 10 }, 'sword');
    ballState.units['ball-target'] = {
      id: 'ball-target',
      kind: 'combat',
      forceId: 'cao',
      leaderId: 'cao-ren',
      homeCityId: 'xiangyang',
      troopType: 'sword',
      q: 12,
      r: 11,
      troops: 3000,
      food: 3000,
      energy: 100,
      movementRemaining: 5,
      moved: false,
      acted: false,
    };
    ballState.facilities = {
      ball: { id: 'ball', type: 'fireBall', forceId: 'liu', q: 11, r: 10, durability: 200 },
    };

    const ballResult = useUnitStrategy(ballState, 'liu', ballUnit.id, 'fire', { coord: { q: 11, r: 10 } });
    expect(ballResult.units['ball-target'].troops).toBeLessThan(3000);
    expect(ballResult.facilities?.ball).toBeUndefined();
    expect(ballResult.firePlots?.map(({ q, r }) => ({ q, r }))).toEqual([
      { q: 11, r: 10 },
      { q: 12, r: 11 },
      { q: 13, r: 11 },
    ]);
  });

  it('ignites ordinary facilities with fire strategy and damages their durability', () => {
    const state = deployUnit(createGame('liu', 1), 'liu', {
      cityId: 'jiangling',
      officerId: 'guan-yu',
      troops: 4000,
      food: 6000,
    });
    const unit = Object.values(state.units)[0];
    readyUnitAt(state, unit.id, { q: 10, r: 10 }, 'sword');
    state.officers['guan-yu'].stats.intelligence = 100;
    state.facilities = {
      tower: { id: 'tower', type: 'arrowTower', forceId: 'cao', q: 11, r: 10, durability: 700, completed: true },
    };
    state.seed = seedForFirstRoll((value) => value < fireStrategySuccessChance(100) / 100);

    const next = useUnitStrategy(state, 'liu', unit.id, 'fire', { coord: { q: 11, r: 10 } });

    expect(next.strategyResultReports).toEqual([expect.objectContaining({ succeeded: true, q: 11, r: 10 })]);
    expect(next.firePlots).toContainEqual(expect.objectContaining({ q: 11, r: 10 }));
    expect(next.facilities?.tower?.durability).toBeLessThan(700);
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

    setUniformTerrain(deployed, 'water');
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

  it('allows units to move into water', () => {
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

    const water = deployed.grid.find((cell) => cell.q === 28 && cell.r === 10);

    expect(water?.terrain).toBe('water');
    expect(moveUnit(deployed, 'liu', unit.id, water!).units[unit.id]).toMatchObject({ q: water!.q, r: water!.r });
  });

  it('lists tactics for each supported troop type', () => {
    const state = deployUnit(createGame('liu', 1), 'liu', {
      cityId: 'jiangling',
      officerId: 'guan-yu',
      troopType: 'spear',
      troops: 3000,
      food: 3000,
    });
    setUniformTerrain(state, 'plain');
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

  it.each([
    ['C', 0],
    ['B', 1],
    ['A', 2],
    ['S', 3],
  ] as const)('keeps all spear tactic definitions visible while %s aptitude unlocks %i tiers', (grade, unlocked) => {
    const { state, attacker } = spearTacticState(grade);
    const tacticIds = ['spear-thrust', 'spear-spiral', 'spear-double'] as const;

    expect(unitTactics(state, attacker.id)).toHaveLength(3);
    expect(tacticIds.filter((tacticId) => unitCanUseTactic(state, attacker.id, tacticId))).toHaveLength(unlocked);
  });

  it('rejects an aptitude-locked tactic before energy and target validation', () => {
    const { state, attacker } = spearTacticState('B');
    state.units[attacker.id].energy = 0;

    expect(() => useUnitTactic(state, 'liu', attacker.id, 'enemy-tactic', 'spear-spiral'))
      .toThrow('需要枪兵适性 A');
  });

  it('uses a deputy aptitude to unlock a tier-three tactic', () => {
    const state = createGame('liu', 1);
    const deployed = deployUnit(state, 'liu', {
      cityId: 'jiangling',
      officerIds: ['jian-yong', 'guan-yu'],
      troopType: 'spear',
      troops: 3000,
      food: 3000,
    });
    const unit = Object.values(deployed.units)[0];

    expect(unit.leaderId).toBe('jian-yong');
    expect(unitCanUseTactic(deployed, unit.id, 'spear-double')).toBe(true);
  });

  it('uses defender leadership to reduce normal attack damage', () => {
    const base = deployUnit(createGame('liu', 77), 'liu', {
      cityId: 'jiangling', officerId: 'guan-yu', troops: 4000, food: 5000,
    });
    const attacker = Object.values(base.units)[0];
    readyUnitAt(base, attacker.id, { q: 10, r: 10 });
    addEnemyUnit(base, 'enemy-defense', { q: 11, r: 10 }, 10_000);
    const lowDefense = structuredClone(base);
    const highDefense = structuredClone(base);
    lowDefense.officers['cao-ren'].stats.leadership = 40;
    highDefense.officers['cao-ren'].stats.leadership = 100;

    const lowDamage = attackUnit(lowDefense, 'liu', attacker.id, 'enemy-defense').battleDamageReports![0].amount;
    const highDamage = attackUnit(highDefense, 'liu', attacker.id, 'enemy-defense').battleDamageReports![0].amount;

    expect(highDamage).toBeLessThan(lowDamage);
  });

  it('uses the highest-war deputy without changing leader leadership', () => {
    const base = deployUnit(createGame('liu', 91), 'liu', {
      cityId: 'jiangling', officerIds: ['jian-yong', 'guan-yu'], troops: 4000, food: 5000,
    });
    const attacker = Object.values(base.units)[0];
    readyUnitAt(base, attacker.id, { q: 10, r: 10 });
    addEnemyUnit(base, 'enemy-deputy', { q: 11, r: 10 }, 10_000);
    base.officers['cao-ren'].stats.leadership = base.officers['jian-yong'].stats.leadership;
    const lowWar = structuredClone(base);
    const highWar = structuredClone(base);
    lowWar.officers['guan-yu'].stats.war = 1;
    highWar.officers['guan-yu'].stats.war = 100;

    const lowDamage = attackUnit(lowWar, 'liu', attacker.id, 'enemy-deputy').battleDamageReports![0].amount;
    const highDamage = attackUnit(highWar, 'liu', attacker.id, 'enemy-deputy').battleDamageReports![0].amount;

    expect(highWar.officers['jian-yong'].stats.leadership).toBe(lowWar.officers['jian-yong'].stats.leadership);
    expect(highDamage).toBeGreaterThan(lowDamage);
  });

  it('applies B, A, and S tactic damage multipliers before rounding', () => {
    const criticalChance = tacticCriticalChance(97, 'S') / 100;
    const seed = seedForFirstRoll((value) => value >= criticalChance);
    const damages = (['B', 'A', 'S'] as const).map((grade) => {
      const { state, attacker } = spearTacticState(grade, seed);
      return useUnitTactic(state, 'liu', attacker.id, 'enemy-tactic', 'spear-thrust').battleDamageReports![0].amount;
    });
    const { state, attacker } = spearTacticState('B', seed);
    state.rngCursor = nextRandom(seed, state.rngCursor).cursor;
    const baseDamage = damageRoll(state, attacker, 'plain');

    expect(damages).toEqual([1, 1.1, 1.2].map((multiplier) => Math.round(baseDamage * 1.18 * multiplier)));
  });

  it('uses one tactic critical roll and reports a 135 percent critical hit', () => {
    const chance = tacticCriticalChance(97, 'S') / 100;
    const criticalSeed = seedForFirstRoll((value) => value < chance);
    const { state, attacker } = spearTacticState('S', criticalSeed);
    const expectedState = structuredClone(state);
    expectedState.rngCursor = nextRandom(criticalSeed, expectedState.rngCursor).cursor;
    const expectedBase = damageRoll(expectedState, expectedState.units[attacker.id], 'plain');

    const next = useUnitTactic(state, 'liu', attacker.id, 'enemy-tactic', 'spear-thrust');

    expect(next.rngCursor).toBe(state.rngCursor + 2);
    expect(next.battleDamageReports![0]).toMatchObject({
      amount: Math.round(expectedBase * 1.18 * 1.2 * 1.35),
      critical: true,
      label: '暴击',
    });
  });

  it('omits critical report fields when the shared roll misses', () => {
    const chance = tacticCriticalChance(97, 'S') / 100;
    const normalSeed = seedForFirstRoll((value) => value >= chance);
    const { state, attacker } = spearTacticState('S', normalSeed);

    const next = useUnitTactic(state, 'liu', attacker.id, 'enemy-tactic', 'spear-thrust');

    expect(next.battleDamageReports![0].critical).toBeUndefined();
    expect(next.battleDamageReports![0].label).toBeUndefined();
  });

  it('shares one critical result across every whirlwind target', () => {
    const chance = tacticCriticalChance(97, 'S') / 100;
    const criticalSeed = seedForFirstRoll((value) => value < chance);
    const state = deployUnit(createGame('liu', criticalSeed), 'liu', {
      cityId: 'jiangling', officerId: 'guan-yu', troopType: 'halberd', troops: 2000, food: 5000,
    });
    setUniformTerrain(state, 'plain');
    const attacker = Object.values(state.units)[0];
    readyUnitAt(state, attacker.id, { q: 10, r: 10 }, 'halberd');
    state.officers['guan-yu'].skill = '无';
    addEnemyUnit(state, 'whirlwind-a', { q: 11, r: 10 }, 10_000);
    addEnemyUnit(state, 'whirlwind-b', { q: 10, r: 9 }, 10_000);

    const next = useUnitTactic(state, 'liu', attacker.id, 'whirlwind-a', 'halberd-whirlwind');

    expect(next.rngCursor).toBe(state.rngCursor + 3);
    expect(next.battleDamageReports).toHaveLength(2);
    expect(next.battleDamageReports?.every((report) => report.critical && report.label === '暴击')).toBe(true);
  });

  it('uses 飞将 tactic criticals without consuming the ordinary critical roll', () => {
    const { state, attacker, target } = combatSkillState('飞将', '无', 10_000);
    const expectedState = structuredClone(state);
    const expectedBase = damageRoll(
      expectedState,
      expectedState.units[attacker.id],
      'plain',
      false,
      expectedState.units[target.id],
    );

    const next = useUnitTactic(state, 'liu', attacker.id, target.id, 'spear-thrust');

    expect(next.rngCursor).toBe(state.rngCursor + 1);
    expect(next.battleDamageReports).toEqual([
      expect.objectContaining({
        unitId: target.id,
        amount: Math.round(expectedBase * 1.18 * 1.2 * 1.35),
        critical: true,
        label: '暴击',
      }),
    ]);
  });

  it('shares a guaranteed action-level critical across area targets', () => {
    const { state, attacker, target } = combatSkillState('神将', '无', 10_000);
    attacker.troopType = 'halberd';
    state.officers['guan-yu'].aptitudes!.halberd = 'S';
    state.officers['xiahou-dun'].stats.war = 100;
    state.officers['xiahou-dun'].location = { kind: 'unit', unitId: 'area-stronger' };
    state.units['area-stronger'] = {
      ...target,
      id: 'area-stronger',
      leaderId: 'xiahou-dun',
      officerIds: ['xiahou-dun'],
      q: 10,
      r: 9,
    };

    const next = useUnitTactic(state, 'liu', attacker.id, target.id, 'halberd-whirlwind');

    expect(next.rngCursor).toBe(state.rngCursor + 2);
    expect(next.battleDamageReports?.map((report) => report.unitId)).toEqual([target.id, 'area-stronger']);
    expect(next.battleDamageReports?.every((report) => report.critical && report.label === '暴击')).toBe(true);
  });

  it('rolls area tactic damage and 不屈 once per target in deterministic order', () => {
    const { state, attacker, target } = combatSkillState('无', '不屈', 2999);
    state.seed = 78_549;
    attacker.troopType = 'halberd';
    state.officers['guan-yu'].aptitudes!.halberd = 'S';
    state.officers['xiahou-dun'].skill = '不屈';
    state.officers['xiahou-dun'].location = { kind: 'unit', unitId: 'area-protected' };
    state.units['area-protected'] = {
      ...target,
      id: 'area-protected',
      leaderId: 'xiahou-dun',
      officerIds: ['xiahou-dun'],
      q: 10,
      r: 9,
    };
    const expectedState = structuredClone(state);
    const expectedAttacker = expectedState.units[attacker.id];
    const abilities = effectiveUnitAbilities(expectedState, expectedAttacker);
    const tactic = unitTactics(expectedState, expectedAttacker.id)
      .find((candidate) => candidate.id === 'halberd-whirlwind')!;
    const criticalRoll = nextRandom(expectedState.seed, expectedState.rngCursor);
    expectedState.rngCursor = criticalRoll.cursor;
    const critical = criticalRoll.value < tacticCriticalChance(abilities.war.value, abilities.aptitude.grade!) / 100;
    const damageMultiplier = tactic.power * 1.2 * (critical ? 1.35 : 1);

    const replayExpectedHit = (unitId: string) => {
      const expectedTarget = expectedState.units[unitId];
      const rolledDamage = damageRoll(expectedState, expectedAttacker, 'plain', false, expectedTarget);
      const ordinaryDamage = Math.min(expectedTarget.troops, Math.round(rolledDamage * damageMultiplier));
      const defenseRoll = nextRandom(expectedState.seed, expectedState.rngCursor);
      expectedState.rngCursor = defenseRoll.cursor;
      return {
        defenseRoll: defenseRoll.value,
        report: {
          id: `tactic-${tactic.id}-${expectedState.month}-${expectedState.tenDay}-${expectedState.rngCursor}-${unitId}`,
          unitId,
          q: expectedTarget.q,
          r: expectedTarget.r,
          amount: defenseRoll.value < 0.5 ? 0 : ordinaryDamage,
          kind: 'attack' as const,
          ...(critical ? { critical: true, label: '暴击' } : {}),
        },
      };
    };
    const firstExpected = replayExpectedHit(target.id);
    const secondExpected = replayExpectedHit('area-protected');

    const next = useUnitTactic(state, 'liu', attacker.id, target.id, 'halberd-whirlwind');

    expect(firstExpected.defenseRoll).toBeLessThan(0.5);
    expect(nextRandom(state.seed, 3).value).toBeGreaterThanOrEqual(0.5);
    expect(secondExpected.defenseRoll).toBeGreaterThanOrEqual(0.5);
    expect(next.rngCursor).toBe(expectedState.rngCursor);
    expect(next.battleDamageReports).toEqual([firstExpected.report, secondExpected.report]);
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

  it('limits fire arrow tactic targets to enemies exactly two cells away', () => {
    const state = deployUnit(createGame('liu', 1), 'liu', {
      cityId: 'jiangling',
      officerId: 'guan-yu',
      troopType: 'crossbow',
      troops: 1000,
      food: 3000,
    });
    const attacker = Object.values(state.units)[0];
    readyUnitAt(state, attacker.id, { q: 10, r: 10 }, 'crossbow');
    addEnemyUnit(state, 'enemy-adjacent', { q: 11, r: 10 });
    addEnemyUnit(state, 'enemy-distance-two', { q: 12, r: 11 });

    expect(tacticTargetUnits(state, attacker.id, 'crossbow-fire').map((unit) => unit.id)).toEqual(['enemy-distance-two']);
    expect(tacticTargetUnits(state, attacker.id, 'crossbow-pierce').map((unit) => unit.id)).toEqual(['enemy-distance-two']);
    expect(tacticTargetUnits(state, attacker.id, 'crossbow-volley').map((unit) => unit.id)).toEqual(['enemy-adjacent', 'enemy-distance-two']);
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

  it('applies ground fire damage after tactic damage when a tactic pushes a unit onto burning ground', () => {
    const { state, attacker, target } = spearTacticState('S', 1, 10_000);
    const fireCell = { q: 12, r: 11 };
    state.firePlots = [{ ...fireCell, remainingTenDays: 2 }];

    const next = useUnitTactic(state, 'liu', attacker.id, target.id, 'spear-thrust');
    const reports = next.battleDamageReports ?? [];

    expect(next.units[target.id]).toMatchObject(fireCell);
    expect(reports).toHaveLength(2);
    expect(reports[0]).toMatchObject({
      unitId: target.id,
      q: target.q,
      r: target.r,
      kind: 'attack',
    });
    expect(reports[1]).toMatchObject({
      unitId: target.id,
      q: fireCell.q,
      r: fireCell.r,
      amount: 500,
      kind: 'attack',
    });
    expect(next.units[target.id].troops).toBe(target.troops - reports[0].amount - reports[1].amount);
  });

  it('damages the unit directly behind a spear thrust target regardless of force', () => {
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
    addEnemyUnit(state, 'enemy-thrust-target', { q: 11, r: 10 });
    addEnemyUnit(state, 'friendly-behind-thrust', { q: 12, r: 11 }, 2800);
    state.units['friendly-behind-thrust'].forceId = 'liu';

    const next = useUnitTactic(state, 'liu', attacker.id, 'enemy-thrust-target', 'spear-thrust');

    expect(next.units['enemy-thrust-target'].troops).toBeLessThan(3000);
    expect(next.units['friendly-behind-thrust'].troops).toBeLessThan(2800);
    expect(next.battleDamageReports?.map((report) => report.unitId)).toEqual(expect.arrayContaining([
      'enemy-thrust-target',
      'friendly-behind-thrust',
    ]));
  });

  it('uses blockers behind a spear double target to decide whether it retreats zero, one, or two cells', () => {
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

    addEnemyUnit(state, 'enemy-double-open', { q: 11, r: 10 });
    const open = useUnitTactic(state, 'liu', attacker.id, 'enemy-double-open', 'spear-double');
    expect(open.units['enemy-double-open']).toMatchObject({ q: 13, r: 11 });

    const firstBlocked = structuredClone(state);
    firstBlocked.units[attacker.id].energy = 100;
    addEnemyUnit(firstBlocked, 'first-blocker', { q: 12, r: 11 }, 2800);
    const stopped = useUnitTactic(firstBlocked, 'liu', attacker.id, 'enemy-double-open', 'spear-double');
    expect(stopped.units['enemy-double-open']).toMatchObject({ q: 11, r: 10 });
    expect(stopped.units['first-blocker'].troops).toBeLessThan(2800);
    expect(stopped.battleDamageReports?.map((report) => report.unitId)).toEqual(expect.arrayContaining([
      'enemy-double-open',
      'first-blocker',
    ]));

    const secondBlocked = structuredClone(state);
    secondBlocked.units[attacker.id].energy = 100;
    addEnemyUnit(secondBlocked, 'second-blocker', { q: 13, r: 11 });
    const retreatedOne = useUnitTactic(secondBlocked, 'liu', attacker.id, 'enemy-double-open', 'spear-double');
    expect(retreatedOne.units['enemy-double-open']).toMatchObject({ q: 12, r: 11 });
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
    crossbowState.officers['guan-yu'].aptitudes!.crossbow = 'A';
    crossbowState.units['friendly-middle'] = {
      id: 'friendly-middle',
      kind: 'combat',
      forceId: 'liu',
      leaderId: 'zhang-fei',
      homeCityId: 'jiangling',
      troopType: 'sword',
      q: 11,
      r: 10,
      troops: 3000,
      food: 3000,
      energy: 100,
      movementRemaining: 20,
      moved: false,
      acted: false,
    };
    crossbowState.officers['zhang-fei'].location = { kind: 'unit', unitId: 'friendly-middle' };
    addEnemyUnit(crossbowState, 'enemy-arrow', { q: 12, r: 10 });
    addEnemyUnit(crossbowState, 'enemy-behind', { q: 14, r: 10 });

    const pierced = useUnitTactic(crossbowState, 'liu', crossbow.id, 'enemy-arrow', 'crossbow-pierce');

    expect(pierced.units[crossbow.id].energy).toBe(85);
    expect(pierced.battleDamageReports?.map((report) => report.unitId).sort()).toEqual(['enemy-arrow', 'friendly-middle']);
    expect(pierced.units['friendly-middle'].troops).toBeLessThan(crossbowState.units['friendly-middle'].troops);
    expect(pierced.units['enemy-behind'].troops).toBe(crossbowState.units['enemy-behind'].troops);
  });

  it('uses halberd sweep to hit only the target and target allies adjacent to the attacker', () => {
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
    addEnemyUnit(state, 'sweep-target', { q: 11, r: 10 });
    addEnemyUnit(state, 'sweep-linked-a', { q: 10, r: 11 });
    addEnemyUnit(state, 'sweep-target-only', { q: 12, r: 10 });
    addEnemyUnit(state, 'sweep-linked-b', { q: 11, r: 9 });

    const swept = useUnitTactic(state, 'liu', attacker.id, 'sweep-target', 'halberd-sweep');

    expect(swept.units[attacker.id].energy).toBe(80);
    expect(swept.battleDamageReports?.map((report) => report.unitId).sort()).toEqual([
      'sweep-linked-a',
      'sweep-linked-b',
      'sweep-target',
    ]);
    expect(swept.units['sweep-target-only'].troops).toBe(state.units['sweep-target-only'].troops);
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

    const targetCell = { q: crossbowState.units['enemy-fire'].q, r: crossbowState.units['enemy-fire'].r };
    const burning = useUnitTactic(crossbowState, 'liu', crossbow.id, 'enemy-fire', 'crossbow-fire');

    expect(burning.units[crossbow.id].energy).toBe(90);
    expect(burning.firePlots).toContainEqual(expect.objectContaining(targetCell));
    expect(burning.units['enemy-fire'].burningTenDays).toBeUndefined();

    const movedEnemy = structuredClone(burning);
    movedEnemy.units['enemy-fire'].q = targetCell.q + 1;
    expect(movedEnemy.firePlots).toContainEqual(expect.objectContaining(targetCell));
    expect(movedEnemy.units['enemy-fire'].burningTenDays).toBeUndefined();

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

  it('lets fire arrow ignite a completed fire ball facility exactly two cells away', () => {
    const state = deployUnit(createGame('liu', 1), 'liu', {
      cityId: 'jiangling',
      officerId: 'guan-yu',
      troopType: 'crossbow',
      troops: 2000,
      food: 3000,
    });
    setUniformTerrain(state, 'plain');
    const crossbow = Object.values(state.units)[0];
    readyUnitAt(state, crossbow.id, { q: 10, r: 10 }, 'crossbow');
    state.facilities = {
      ball: { id: 'ball', type: 'fireBall', forceId: 'liu', q: 12, r: 11, durability: 200, completed: true },
      adjacentBall: { id: 'adjacentBall', type: 'fireBall', forceId: 'liu', q: 11, r: 10, durability: 200, completed: true },
      tower: { id: 'tower', type: 'arrowTower', forceId: 'cao', q: 12, r: 10, durability: 700 },
    };

    expect(tacticTargetFacilities(state, crossbow.id, 'crossbow-fire').map((facility) => facility.id)).toEqual(['ball']);
    expect(tacticTargetFacilities(state, crossbow.id, 'crossbow-pierce')).toEqual([]);

    const ignited = useUnitTactic(state, 'liu', crossbow.id, 'ball', 'crossbow-fire');

    expect(ignited.facilities?.ball).toBeUndefined();
    expect(ignited.facilities?.adjacentBall).toBeDefined();
    expect(ignited.units[crossbow.id]).toMatchObject({ energy: 90, acted: true });
    expect(ignited.firePlots).toEqual(expect.arrayContaining([
      expect.objectContaining({ q: 12, r: 11 }),
    ]));
    expect(ignited.firePlots).toHaveLength(3);
    const firePlotKeys = new Set(ignited.firePlots!.map(gridKey));
    const linkedFirePlots = ignited.firePlots!.filter((plot, index, plots) => (
      index === 0 || plots.some((previous, previousIndex) => previousIndex < index && neighborsOf(previous.q, previous.r).some((coord) => gridKey(coord) === gridKey(plot)))
    ));
    expect(linkedFirePlots).toHaveLength(3);
    expect(neighborsOf(12, 11).some((coord) => firePlotKeys.has(gridKey(coord)))).toBe(true);
  });

  it('lists plot strategies and applies fire, extinguish, false report, disturb, calm, and inspire', () => {
    const state = deployUnit(createGame('liu', 1), 'liu', {
      cityId: 'jiangling',
      officerId: 'guan-yu',
      troops: 3000,
      food: 3000,
    });
    setUniformTerrain(state, 'plain');
    const unit = Object.values(state.units)[0];
    readyUnitAt(state, unit.id, { q: 10, r: 10 });
    state.units[unit.id].energy = 50;
    state.firePlots = [{ q: 11, r: 10 }];
    addEnemyUnit(state, 'enemy-plot', { q: 12, r: 10 });
    state.units['enemy-plot'].confusedTenDays = 1;
    state.units['enemy-plot'].energy = 60;

    expect(unitStrategies().map((strategy) => strategy.id)).toEqual(['fire', 'extinguish', 'false-report', 'disturb', 'calm', 'inspire', 'discord']);
    expect(strategyTargetCells(state, unit.id, 'fire').map(gridKey)).toContain('10,9');
    expect(strategyTargetCells(state, unit.id, 'extinguish').map(gridKey)).toEqual(['11,10']);
    expect(strategyTargetUnits(state, unit.id, 'false-report').map((target) => target.id)).toEqual(['enemy-plot']);
    expect(strategyTargetUnits(state, unit.id, 'disturb').map((target) => target.id)).toEqual(['enemy-plot']);
    const calmState = structuredClone(state);
    calmState.units['ally-calm-target'] = {
      id: 'ally-calm-target',
      kind: 'combat',
      forceId: 'liu',
      leaderId: 'zhang-fei',
      homeCityId: 'jiangling',
      troopType: 'sword',
      q: 9,
      r: 10,
      troops: 3000,
      food: 3000,
      energy: 80,
      movementRemaining: 20,
      confusedTenDays: 1,
      moved: false,
      acted: false,
    };
    expect(strategyTargetUnits(calmState, unit.id, 'calm').map((target) => target.id)).toEqual(['ally-calm-target']);
    expect(strategyTargetUnits(state, unit.id, 'inspire').map((target) => target.id)).toEqual([unit.id]);

    const burned = useUnitStrategy(state, 'liu', unit.id, 'fire', { coord: { q: 10, r: 9 } });
    expect(burned.firePlots).toContainEqual(expect.objectContaining({ q: 10, r: 9 }));
    expect(burned.units[unit.id]).toMatchObject({ energy: 40, acted: true });

    const extinguished = useUnitStrategy(state, 'liu', unit.id, 'extinguish', { coord: { q: 11, r: 10 } });
    expect(extinguished.firePlots).toEqual([]);
    expect(extinguished.units[unit.id]).toMatchObject({ energy: 40, acted: true });

    const falseReported = useUnitStrategy(state, 'liu', unit.id, 'false-report', { targetUnitId: 'enemy-plot' });
    expect(falseReported.units['enemy-plot'].falseReportedTenDays).toBe(1);
    expect(falseReported.units[unit.id]).toMatchObject({ energy: 35, acted: true });
    expect(() => waitUnit(falseReported, 'cao', 'enemy-plot')).toThrow(/伪报|混乱/);

    const disturbed = useUnitStrategy(state, 'liu', unit.id, 'disturb', { targetUnitId: 'enemy-plot' });
    expect(disturbed.units['enemy-plot'].confusedTenDays).toBeGreaterThanOrEqual(1);
    expect(disturbed.units['enemy-plot'].confusedTenDays).toBeLessThanOrEqual(3);
    expect(disturbed.units[unit.id]).toMatchObject({ energy: 35, acted: true });
    expect(() => waitUnit(disturbed, 'cao', 'enemy-plot')).toThrow(/伪报|混乱/);

    expect(() => useUnitStrategy(state, 'liu', unit.id, 'calm', { targetUnitId: 'enemy-plot' })).toThrow(/范围|目标/);
    const calmed = useUnitStrategy(calmState, 'liu', unit.id, 'calm', { targetUnitId: 'ally-calm-target' });
    expect(calmed.units['ally-calm-target'].confusedTenDays).toBeUndefined();
    expect(calmed.units[unit.id]).toMatchObject({ energy: 40, acted: true });

    const inspired = useUnitStrategy(state, 'liu', unit.id, 'inspire', { targetUnitId: unit.id });
    expect(inspired.units[unit.id]).toMatchObject({ energy: 60, acted: true });
  });

  it.each([
    ['fire', '火计', 10],
    ['false-report', '伪报', 15],
    ['disturb', '扰乱', 15],
    ['discord', '内讧', 20],
  ] as const)('%s succeeds on a seeded roll below its calculated chance', (strategyId, label, cost) => {
    const { state, unit, selection, target, chance } = probabilisticStrategyState(strategyId);
    state.seed = seedForFirstRoll((value) => value < chance / 100);
    const targetStatus = state.units['strategy-target'];
    const victimTroops = state.units['discord-victim']?.troops;

    const next = useUnitStrategy(state, 'liu', unit.id, strategyId, selection);

    expect(next.rngCursor).toBe(state.rngCursor + (strategyId === 'disturb' || strategyId === 'fire' ? 2 : 1));
    expect(next.units[unit.id]).toMatchObject({ energy: 100 - cost, acted: true });
    expect(next.strategyResultReports).toEqual([expect.objectContaining({
      strategyId, label, succeeded: true, q: target.q, r: target.r,
    })]);
    if (strategyId === 'fire') expect(next.firePlots).toContainEqual(expect.objectContaining(target));
    if (strategyId === 'false-report') expect(targetStatus.falseReportedTenDays).toBeUndefined();
    if (strategyId === 'false-report') expect(next.units['strategy-target'].falseReportedTenDays).toBe(1);
    if (strategyId === 'disturb') {
      expect(next.units['strategy-target'].confusedTenDays).toBeGreaterThanOrEqual(1);
      expect(next.units['strategy-target'].confusedTenDays).toBeLessThanOrEqual(3);
    }
    if (strategyId === 'discord') expect(next.units['discord-victim'].troops).toBeLessThan(victimTroops!);
  });

  it.each([1, 2, 3])('assigns a successful disturb a deterministic random duration of %i ten-day turns', (duration) => {
    const { state, unit, selection, chance } = probabilisticStrategyState('disturb');
    state.seed = seedForTwoRolls(
      (value) => value < chance / 100,
      (value) => Math.floor(value * 3) + 1 === duration,
    );

    const next = useUnitStrategy(state, 'liu', unit.id, 'disturb', selection);

    expect(next.units['strategy-target'].confusedTenDays).toBe(duration);
    expect(next.rngCursor).toBe(2);
  });

  it.each([
    ['fire', 10],
    ['false-report', 15],
    ['disturb', 15],
    ['discord', 20],
  ] as const)('%s fails without applying effects on a seeded roll above its calculated chance', (strategyId, cost) => {
    const { state, unit, selection, target, chance } = probabilisticStrategyState(strategyId);
    state.seed = seedForFirstRoll((value) => value >= chance / 100);
    state.battleDamageReports = [{
      id: 'old-damage', unitId: 'old-target', q: 1, r: 1, amount: 99, kind: 'attack',
    }];
    state.facilityRepairReports = [{
      id: 'old-repair', facilityId: 'old-facility', q: 2, r: 2, amount: 88, kind: 'repair',
    }];
    const beforeFirePlots = structuredClone(state.firePlots ?? []);
    const beforeTarget = structuredClone(state.units['strategy-target']);
    const beforeVictim = structuredClone(state.units['discord-victim']);

    const next = useUnitStrategy(state, 'liu', unit.id, strategyId, selection);

    expect(next.rngCursor).toBe(state.rngCursor + 1);
    expect(next.units[unit.id]).toMatchObject({ energy: 100 - cost, acted: true });
    expect(next.firePlots ?? []).toEqual(beforeFirePlots);
    expect(next.units['strategy-target']).toEqual(beforeTarget);
    expect(next.units['discord-victim']).toEqual(beforeVictim);
    expect(next.battleDamageReports).toEqual([]);
    expect(next.facilityRepairReports).toEqual([]);
    expect(next.strategyResultReports).toEqual([expect.objectContaining({
      strategyId, label: '计略失败', succeeded: false, q: target.q, r: target.r,
    })]);
  });

  it.each([
    ['extinguish', '灭火'],
    ['calm', '镇定'],
    ['inspire', '鼓舞'],
  ] as const)('%s always succeeds without consuming RNG', (strategyId, label) => {
    const state = deployUnit(createGame('liu', 17), 'liu', {
      cityId: 'jiangling', officerId: 'guan-yu', troops: 3000, food: 3000,
    });
    setUniformTerrain(state, 'plain');
    const unit = Object.values(state.units)[0];
    readyUnitAt(state, unit.id, { q: 10, r: 10 });
    state.units[unit.id].energy = 50;
    state.rngCursor = 7;
    state.firePlots = [{ q: 11, r: 10 }];
    state.battleDamageReports = [{
      id: 'old-damage', unitId: 'old-target', q: 1, r: 1, amount: 99, kind: 'attack',
    }];
    state.facilityRepairReports = [{
      id: 'old-build', facilityId: 'old-facility', q: 2, r: 2, amount: 88, kind: 'build',
    }];
    state.units['calm-target'] = {
      id: 'calm-target', kind: 'combat', forceId: 'liu', leaderId: 'zhang-fei', homeCityId: 'jiangling',
      troopType: 'sword', q: 9, r: 10, troops: 3000, food: 3000, energy: 80,
      movementRemaining: 20, confusedTenDays: 1, moved: false, acted: false,
    };
    const selection = strategyId === 'extinguish'
      ? { coord: { q: 11, r: 10 } } as const
      : { targetUnitId: strategyId === 'calm' ? 'calm-target' : unit.id } as const;
    const target = strategyId === 'extinguish'
      ? { q: 11, r: 10 }
      : strategyId === 'calm' ? state.units['calm-target'] : unit;

    const next = useUnitStrategy(state, 'liu', unit.id, strategyId, selection);

    expect(next.rngCursor).toBe(state.rngCursor);
    expect(next.battleDamageReports).toEqual([]);
    expect(next.facilityRepairReports).toEqual([]);
    expect(next.strategyResultReports).toEqual([expect.objectContaining({
      strategyId, label, succeeded: true, q: target.q, r: target.r,
    })]);
  });

  it('sets occupied target cells on fire and damages units from any force standing there', () => {
    const state = deployUnit(createGame('liu', 1), 'liu', {
      cityId: 'jiangling',
      officerId: 'guan-yu',
      troops: 3000,
      food: 3000,
    });
    setUniformTerrain(state, 'plain');
    const unit = Object.values(state.units)[0];
    readyUnitAt(state, unit.id, { q: 10, r: 10 });
    addEnemyUnit(state, 'enemy-on-fire', { q: 11, r: 10 }, 3000);
    state.units['friendly-on-fire'] = {
      id: 'friendly-on-fire',
      kind: 'combat',
      forceId: 'liu',
      leaderId: 'zhang-fei',
      homeCityId: 'jiangling',
      troopType: 'sword',
      q: 10,
      r: 9,
      troops: 3000,
      food: 3000,
      energy: 100,
      movementRemaining: 20,
      moved: false,
      acted: false,
    };

    const enemyBurned = useUnitStrategy(state, 'liu', unit.id, 'fire', { coord: { q: 11, r: 10 } });
    expect(enemyBurned.firePlots).toContainEqual(expect.objectContaining({ q: 11, r: 10 }));
    expect(enemyBurned.units['enemy-on-fire'].troops).toBeLessThan(3000);
    expect(enemyBurned.battleDamageReports?.some((report) => report.unitId === 'enemy-on-fire')).toBe(true);

    const friendlyBurned = useUnitStrategy(state, 'liu', unit.id, 'fire', { coord: { q: 10, r: 9 } });
    expect(friendlyBurned.firePlots).toContainEqual(expect.objectContaining({ q: 10, r: 9 }));
    expect(friendlyBurned.units['friendly-on-fire'].troops).toBeLessThan(3000);
    expect(friendlyBurned.battleDamageReports?.some((report) => report.unitId === 'friendly-on-fire')).toBe(true);
  });

  it('uses opposed intelligence for an enemy occupying the fire target cell', () => {
    const state = deployUnit(createGame('liu', 1), 'liu', {
      cityId: 'jiangling',
      officerId: 'guan-yu',
      troops: 3000,
      food: 3000,
    });
    setUniformTerrain(state, 'plain');
    const unit = Object.values(state.units)[0];
    readyUnitAt(state, unit.id, { q: 10, r: 10 });
    state.officers['guan-yu'].stats.intelligence = 90;
    addEnemyUnit(state, 'high-intelligence-fire-target', { q: 10, r: 9 });
    state.officers['cao-ren'].stats.intelligence = 90;

    const defenderChance = harmfulStrategySuccessChance(90, 90);
    const emptyCellChance = fireStrategySuccessChance(90);
    state.seed = seedForFirstRoll((value) => (
      value >= defenderChance / 100 && value < emptyCellChance / 100
    ));

    const next = useUnitStrategy(state, 'liu', unit.id, 'fire', { coord: { q: 10, r: 9 } });

    expect(next.strategyResultReports).toEqual([expect.objectContaining({ succeeded: false })]);
    expect(next.firePlots ?? []).not.toContainEqual(expect.objectContaining({ q: 10, r: 9 }));
    expect(next.units['high-intelligence-fire-target'].troops).toBe(3000);
    expect(next.rngCursor).toBe(state.rngCursor + 1);
  });

  it('allows opposed intelligence to raise fire success against a weaker enemy', () => {
    const state = deployUnit(createGame('liu', 1), 'liu', {
      cityId: 'jiangling',
      officerId: 'guan-yu',
      troops: 3000,
      food: 3000,
    });
    setUniformTerrain(state, 'plain');
    const unit = Object.values(state.units)[0];
    readyUnitAt(state, unit.id, { q: 10, r: 10 });
    state.officers['guan-yu'].stats.intelligence = 90;
    addEnemyUnit(state, 'low-intelligence-fire-target', { q: 10, r: 9 });
    state.officers['cao-ren'].stats.intelligence = 40;

    const defenderChance = harmfulStrategySuccessChance(90, 40);
    const emptyCellChance = fireStrategySuccessChance(90);
    state.seed = seedForFirstRoll((value) => (
      value >= emptyCellChance / 100 && value < defenderChance / 100
    ));

    const next = useUnitStrategy(state, 'liu', unit.id, 'fire', { coord: { q: 10, r: 9 } });

    expect(next.strategyResultReports).toEqual([expect.objectContaining({ succeeded: true })]);
    expect(next.firePlots).toContainEqual(expect.objectContaining({ q: 10, r: 9 }));
    expect(next.units['low-intelligence-fire-target'].troops).toBeLessThan(3000);
    expect(next.rngCursor).toBe(state.rngCursor + 2);
  });

  it('uses discord to make an adjacent enemy attack a neighboring same-force unit', () => {
    const state = deployUnit(createGame('liu', 1), 'liu', {
      cityId: 'jiangling',
      officerId: 'guan-yu',
      troops: 3000,
      food: 3000,
    });
    setUniformTerrain(state, 'plain');
    const unit = Object.values(state.units)[0];
    readyUnitAt(state, unit.id, { q: 10, r: 10 });
    state.units[unit.id].energy = 50;
    addEnemyUnit(state, 'discord-target', { q: 11, r: 10 });
    addEnemyUnit(state, 'discord-victim', { q: 12, r: 11 });

    expect(strategyTargetUnits(state, unit.id, 'discord').map((target) => target.id)).toEqual(['discord-target']);

    const next = useUnitStrategy(state, 'liu', unit.id, 'discord', { targetUnitId: 'discord-target' });

    expect(next.units[unit.id]).toMatchObject({ energy: 30, acted: true });
    expect(next.units['discord-victim'].troops).toBeLessThan(state.units['discord-victim'].troops);
    expect(next.battleDamageReports?.map((report) => report.unitId)).toEqual(['discord-victim']);
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

  it('clears stale battle reports when a unit only moves', () => {
    const deployed = deployUnit(createGame('liu', 1), 'liu', {
      cityId: 'jiangling',
      officerId: 'guan-yu',
      targetCityId: 'xiangyang',
      troops: 3000,
      food: 3000,
    });
    const unit = Object.values(deployed.units)[0];
    readyUnitAt(deployed, unit.id, unit, unit.troopType ?? 'sword');
    const destination = movementCells(deployed, unit.id)[0];
    deployed.battleDamageReports = [{
      id: 'old-damage',
      unitId: 'old-target',
      q: unit.q,
      r: unit.r,
      amount: 600,
      kind: 'attack',
    }];
    deployed.strategyResultReports = [{
      id: 'old-strategy', strategyId: 'disturb', q: unit.q, r: unit.r,
      label: '计略失败', succeeded: false,
    }];

    const moved = moveUnit(deployed, 'liu', unit.id, destination);

    expect(moved.units[unit.id].troops).toBe(unit.troops);
    expect(moved.battleDamageReports).toEqual([]);
    expect(moved.strategyResultReports).toEqual([]);
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

  it('allows entering enemy unit ZOC but prevents moving through it', () => {
    const state = deployUnit(createGame('liu', 1), 'liu', {
      cityId: 'jiangling',
      officerId: 'guan-yu',
      troops: 3000,
      food: 3000,
    });
    state.grid = [
      { q: 10, r: 10, terrain: 'plain' },
      { q: 11, r: 10, terrain: 'plain' },
      { q: 12, r: 11, terrain: 'plain' },
      { q: 12, r: 10, terrain: 'plain' },
    ];
    const unit = Object.values(state.units)[0];
    readyUnitAt(state, unit.id, { q: 10, r: 10 });
    state.units[unit.id].movementRemaining = 8;
    addEnemyUnit(state, 'enemy-zoc-source', { q: 12, r: 10 });

    const targets = movementCells(state, unit.id);

    expect(targets).toContainEqual({ q: 11, r: 10 });
    expect(targets).not.toContainEqual({ q: 12, r: 11 });
    expect(() => moveUnit(state, 'liu', unit.id, { q: 12, r: 11 })).toThrow(/瓒呰繃|范围|移动力/);
  });

  it('uses hostile arrow tower ZOC but not earthwork ZOC for movement', () => {
    const state = deployUnit(createGame('liu', 1), 'liu', {
      cityId: 'jiangling',
      officerId: 'guan-yu',
      troops: 3000,
      food: 3000,
    });
    state.grid = [
      { q: 10, r: 10, terrain: 'plain' },
      { q: 11, r: 10, terrain: 'plain' },
      { q: 12, r: 11, terrain: 'plain' },
      { q: 12, r: 10, terrain: 'plain' },
    ];
    const unit = Object.values(state.units)[0];
    readyUnitAt(state, unit.id, { q: 10, r: 10 });
    state.units[unit.id].movementRemaining = 8;
    state.facilities = {
      tower: { id: 'tower', type: 'arrowTower', forceId: 'cao', q: 12, r: 10, durability: 700 },
    };

    expect(movementCells(state, unit.id)).toContainEqual({ q: 11, r: 10 });
    expect(movementCells(state, unit.id)).not.toContainEqual({ q: 12, r: 11 });

    state.facilities = {
      earthwork: { id: 'earthwork', type: 'earthwork', forceId: 'cao', q: 12, r: 10, durability: 400 },
    };
    expect(movementCells(state, unit.id)).toContainEqual({ q: 12, r: 11 });
  });

  it('reports 神将 normal attacks as critical without an extra RNG roll', () => {
    const { state, attacker, target } = combatSkillState('神将', '无', 10_000);
    const expectedState = structuredClone(state);
    const expectedBase = damageRoll(expectedState, expectedState.units[attacker.id], 'plain', false, expectedState.units[target.id]);

    const next = attackUnit(state, 'liu', attacker.id, target.id);

    expect(next.rngCursor).toBe(state.rngCursor + 2);
    expect(next.battleDamageReports?.[0]).toMatchObject({
      unitId: target.id,
      amount: Math.round(expectedBase * 1.35),
      critical: true,
      label: '暴击',
    });
  });

  it('resolves 连战 through two normal hits but spends energy and counters once', () => {
    const { state, attacker, target } = combatSkillState('连战', '无', 10_000);
    const expectedState = structuredClone(state);
    const expectedFirst = damageRoll(expectedState, expectedState.units[attacker.id], 'plain', false, expectedState.units[target.id]);
    expectedState.rngCursor = nextRandom(expectedState.seed, expectedState.rngCursor).cursor;
    const expectedSecond = damageRoll(expectedState, expectedState.units[attacker.id], 'plain', false, expectedState.units[target.id]);

    const next = attackUnit(state, 'liu', attacker.id, target.id);
    const targetReports = next.battleDamageReports?.filter((report) => report.unitId === target.id) ?? [];

    expect(targetReports.map((report) => report.amount)).toEqual([expectedFirst, expectedSecond]);
    expect(next.battleDamageReports?.filter((report) => report.kind === 'counter')).toHaveLength(1);
    expect(next.rngCursor).toBe(state.rngCursor + 4);
    expect(next.units[attacker.id]).toMatchObject({ energy: 90, acted: true });
  });

  it('does not roll 连战 after the first normal hit defeats the target', () => {
    const { state, attacker, target } = combatSkillState('连战', '无', 1);

    const next = attackUnit(state, 'liu', attacker.id, target.id);

    expect(next.units[target.id]).toBeUndefined();
    expect(next.rngCursor).toBe(state.rngCursor + 1);
    expect(next.battleDamageReports).toHaveLength(1);
    expect(next.units[attacker.id]).toMatchObject({ energy: 90, acted: true });
  });

  it('lets 不屈 negate eligible normal damage below 3000 but not at exactly 3000', () => {
    const { state, attacker, target } = combatSkillState('无', '不屈', 2999);

    const protectedState = attackUnit(state, 'liu', attacker.id, target.id);

    expect(protectedState.units[target.id].troops).toBe(2999);
    expect(protectedState.battleDamageReports?.[0].amount).toBe(0);
    expect(protectedState.rngCursor).toBe(state.rngCursor + 3);

    state.units[target.id].troops = 3000;
    const ordinaryState = attackUnit(state, 'liu', attacker.id, target.id);
    expect(ordinaryState.units[target.id].troops).toBeLessThan(3000);
    expect(ordinaryState.rngCursor).toBe(state.rngCursor + 2);
  });

  it('lets 不屈 independently negate counterattack damage', () => {
    const { state, attacker, target } = combatSkillState('不屈', '无', 10_000);
    state.seed = 3214;
    attacker.troops = 2999;

    const next = attackUnit(state, 'liu', attacker.id, target.id);

    expect(next.units[attacker.id].troops).toBe(2999);
    expect(next.battleDamageReports?.find((report) => report.kind === 'counter')?.amount).toBe(0);
    expect(next.rngCursor).toBe(state.rngCursor + 3);
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

  it('captures half of a defeated unit gold and food', () => {
    const deployed = deployUnit(createGame('liu', 1), 'liu', {
      cityId: 'jiangling',
      officerId: 'guan-yu',
      targetCityId: 'xiangyang',
      troops: 4000,
      food: 6000,
    });
    const attacker = Object.values(deployed.units)[0];
    const enemyId = 'unit-loot-cao-ren';
    const enemyPosition = neighborsOf(attacker.q, attacker.r)[0];
    deployed.units[enemyId] = {
      id: enemyId,
      forceId: 'cao',
      leaderId: 'cao-ren',
      homeCityId: 'xiangyang',
      q: enemyPosition.q,
      r: enemyPosition.r,
      troops: 1,
      gold: 1001,
      food: 2001,
      energy: 100,
      movementRemaining: 5,
      moved: false,
      acted: false,
    };
    deployed.officers['cao-ren'].location = { kind: 'unit', unitId: enemyId };

    const next = attackUnit(deployed, 'liu', attacker.id, enemyId);

    expect(next.units[enemyId]).toBeUndefined();
    expect(next.units[attacker.id]).toMatchObject({ gold: 500, food: 7000 });
  });

  it('captures supplies when a tactic deals the defeating blow', () => {
    const { state, attacker } = spearTacticState('S', 1, 1);
    state.units['enemy-tactic'].gold = 801;
    state.units['enemy-tactic'].food = 1601;

    const next = useUnitTactic(state, 'liu', attacker.id, 'enemy-tactic', 'spear-thrust');

    expect(next.units['enemy-tactic']).toBeUndefined();
    expect(next.units[attacker.id]).toMatchObject({ gold: 400, food: 5800 });
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
    readyUnitAt(second, attacker.id, attacker, attacker.troopType ?? 'sword');
    readyUnitAt(second, ally.id, allyPosition, ally.troopType ?? 'sword');
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

describe('strategy officer skills', () => {
  it('uses the same 百出 cost helper for validation and actual spending', () => {
    const { state, caster } = strategySkillState('百出');
    caster.energy = 1;

    expect(strategyEnergyCostForUnit(state, caster.id, 'disturb')).toBe(1);
    const next = useUnitStrategy(state, 'liu', caster.id, 'disturb', { targetUnitId: 'strategy-skill-target' });
    expect(next.units[caster.id]).toMatchObject({ energy: 0, acted: true });
  });

  it('does not guarantee 火神 fire on an empty cell', () => {
    const { state, caster } = strategySkillState('火神');
    state.officers['zhuge-liang'].stats.intelligence = 1;
    delete state.units['strategy-skill-target'];
    const chance = fireStrategySuccessChance(1);
    state.seed = seedForFirstRoll((value) => value >= chance / 100);

    const next = useUnitStrategy(state, 'liu', caster.id, 'fire', { coord: { q: 11, r: 10 } });

    expect(next.strategyResultReports).toEqual([expect.objectContaining({ succeeded: false })]);
    expect(next.firePlots ?? []).not.toContainEqual(expect.objectContaining({ q: 11, r: 10 }));
    expect(next.rngCursor).toBe(state.rngCursor + 1);
  });

  it('does not guarantee 火神 fire against a lower-intelligence friendly occupant', () => {
    const { state, caster, target } = strategySkillState('火神');
    target.forceId = caster.forceId;
    state.officers['zhuge-liang'].stats.intelligence = 100;
    state.officers['cao-ren'].stats.intelligence = 1;
    const chance = fireStrategySuccessChance(100);
    state.seed = seedForFirstRoll((value) => value >= chance / 100);

    const next = useUnitStrategy(state, 'liu', caster.id, 'fire', { coord: { q: target.q, r: target.r } });

    expect(next.strategyResultReports).toEqual([expect.objectContaining({ succeeded: false })]);
    expect(next.firePlots ?? []).not.toContainEqual(expect.objectContaining({ q: target.q, r: target.r }));
    expect(next.units[target.id].troops).toBe(5000);
    expect(next.units[caster.id]).toMatchObject({ energy: 90, acted: true });
    expect(next.rngCursor).toBe(state.rngCursor + 1);
  });

  it.each([
    ['fireSeed', { q: 11, r: 11 }],
    ['fireBall', { q: 12, r: 11 }],
  ] as const)('protects an enemy 火神 unit from %s trap splash caused by fire strategy', (facilityType, targetCoord) => {
    const { state, caster, target } = strategySkillState('无', '火神');
    target.q = targetCoord.q;
    target.r = targetCoord.r;
    state.officers['zhuge-liang'].stats.intelligence = 100;
    state.seed = seedForFirstRoll((value) => value < fireStrategySuccessChance(100) / 100);
    state.facilities = {
      trap: {
        id: 'trap', type: facilityType, forceId: 'liu', q: 11, r: 10, durability: 200, completed: true,
      },
    };

    const next = useUnitStrategy(state, 'liu', caster.id, 'fire', { coord: { q: 11, r: 10 } });

    expect(next.strategyResultReports).toEqual([expect.objectContaining({ succeeded: true })]);
    expect(next.units[target.id].troops).toBe(5000);
    expect(next.battleDamageReports?.some((report) => report.unitId === target.id)).toBe(false);
    expect(next.firePlots ?? []).not.toContainEqual(expect.objectContaining(targetCoord));
  });

  it('doubles only 火神 immediate fire damage and leaves the later ground-fire tick at 500', () => {
    const { state, caster, target } = strategySkillState('火神');
    state.officers['zhuge-liang'].stats.intelligence = 100;
    state.officers['cao-ren'].stats.intelligence = 1;

    const ignited = useUnitStrategy(state, 'liu', caster.id, 'fire', { coord: { q: target.q, r: target.r } });

    expect(ignited.units[target.id].troops).toBe(4000);
    expect(ignited.rngCursor).toBe(state.rngCursor + 1);
    const nextTenDay = settleTenDay(ignited);
    expect(nextTenDay.units[target.id].troops).toBe(3500);
    expect(nextTenDay.battleDamageReports).toEqual([
      expect.objectContaining({ unitId: target.id, amount: 500 }),
    ]);
  });

  it.each([
    ['火神', 'fire', 10],
    ['洞察', 'fire', 10],
    ['洞察', 'false-report', 15],
    ['洞察', 'disturb', 15],
    ['洞察', 'discord', 20],
  ] as const)('spends once without RNG or side effects when %s blocks hostile %s', (targetSkill, strategyId, cost) => {
    const { state, caster, target } = strategySkillState('无', targetSkill);
    state.officers['zhuge-liang'].stats.intelligence = 100;
    state.officers['cao-ren'].stats.intelligence = 1;
    state.rngCursor = 7;
    state.officers['xiahou-dun'].location = { kind: 'unit', unitId: 'strategy-discord-victim' };
    state.units['strategy-discord-victim'] = {
      ...target,
      id: 'strategy-discord-victim',
      leaderId: 'xiahou-dun',
      officerIds: ['xiahou-dun'],
      q: 12,
      r: 11,
    };
    const selection = strategyId === 'fire'
      ? { coord: { q: target.q, r: target.r } } as const
      : { targetUnitId: target.id } as const;

    const next = useUnitStrategy(state, 'liu', caster.id, strategyId, selection);

    expect(next.units[caster.id]).toMatchObject({ energy: 100 - cost, acted: true });
    expect(next.rngCursor).toBe(state.rngCursor);
    expect(next.strategyResultReports).toEqual([expect.objectContaining({ succeeded: false })]);
    expect(next.firePlots ?? []).not.toContainEqual(expect.objectContaining({ q: target.q, r: target.r }));
    expect(next.units[target.id].falseReportedTenDays).toBeUndefined();
    expect(next.units[target.id].confusedTenDays).toBeUndefined();
    expect(next.units['strategy-discord-victim'].troops).toBe(5000);
    expect(next.battleDamageReports).toEqual([]);
  });

  it('does not let 洞察 block a friendly inspire strategy', () => {
    const { state, caster, target } = strategySkillState('无', '洞察');
    target.forceId = caster.forceId;
    target.energy = 40;

    const next = useUnitStrategy(state, 'liu', caster.id, 'inspire', { targetUnitId: target.id });

    expect(next.units[caster.id]).toMatchObject({ energy: 90, acted: true });
    expect(next.units[target.id].energy).toBe(60);
    expect(next.strategyResultReports).toEqual([expect.objectContaining({ succeeded: true })]);
    expect(next.rngCursor).toBe(state.rngCursor);
  });

  it.each([
    ['false-report', 'falseReportedTenDays', 1],
    ['disturb', 'confusedTenDays', 2],
  ] as const)('chains one successful %s duration without extra cost or RNG', (strategyId, statusKey, expectedCursor) => {
    const { state, caster, target } = strategySkillState('连环');
    state.officers['zhuge-liang'].stats.intelligence = 100;
    state.officers['cao-ren'].stats.intelligence = 1;
    const chainCells = neighborsOf(target.q, target.r)
      .filter((coord) => coord.q !== caster.q || coord.r !== caster.r);
    state.officers['xiahou-dun'].location = { kind: 'unit', unitId: 'z-adjacent' };
    state.officers['cao-cao'].location = { kind: 'unit', unitId: 'a-adjacent' };
    state.units['z-adjacent'] = {
      ...target, id: 'z-adjacent', leaderId: 'xiahou-dun', officerIds: ['xiahou-dun'],
      q: chainCells[0].q, r: chainCells[0].r,
    };
    state.units['a-adjacent'] = {
      ...target, id: 'a-adjacent', leaderId: 'cao-cao', officerIds: ['cao-cao'],
      q: chainCells[1].q, r: chainCells[1].r,
    };

    const next = useUnitStrategy(state, 'liu', caster.id, strategyId, { targetUnitId: target.id });
    const sharedDuration = next.units[target.id][statusKey];

    expect(sharedDuration).toBeGreaterThanOrEqual(1);
    expect(next.units['a-adjacent'][statusKey]).toBe(sharedDuration);
    expect(next.units['z-adjacent'][statusKey]).toBe(sharedDuration);
    expect(next.units[caster.id]).toMatchObject({ energy: 85, acted: true });
    expect(next.rngCursor).toBe(state.rngCursor + expectedCursor);
    expect(next.strategyResultReports).toHaveLength(1);
  });

  it('dispatches 连环 through the registered complex handler', () => {
    const { state, caster, target } = strategySkillState('连环');
    state.officers['zhuge-liang'].stats.intelligence = 100;
    state.officers['cao-ren'].stats.intelligence = 1;
    const handlerById = (skillHandlers as typeof skillHandlers & {
      complexHandlerById?: (id: 'chainStrategy') => {
        apply: (context: unknown) => string[];
      };
    }).complexHandlerById;
    expect(handlerById).toBeTypeOf('function');
    const handler = handlerById?.('chainStrategy');
    expect(handler).toBeDefined();
    if (!handler) throw new Error('chainStrategy handler is not registered');
    const applySpy = vi.spyOn(handler, 'apply');

    try {
      useUnitStrategy(state, 'liu', caster.id, 'disturb', { targetUnitId: target.id });
      expect(applySpy).toHaveBeenCalledOnce();
    } finally {
      applySpy.mockRestore();
    }
  });
});
