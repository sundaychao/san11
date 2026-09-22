import { describe, expect, it, vi } from 'vitest';
import { initialArmaments } from '../armaments';
import { runAiTurn } from '../ai';
import { nextRandom } from '../random';
import { CITY_GOLD_CAP, cityTroopCap } from '../innerAffairs';
import { PASS_TROOP_CAP } from '../passes';
import { cityResourceCaps, strongholdsExceedCaps } from '../strongholdCapacity';
import { createGame } from '../scenario/jingxiang208';
import { territoryCityAt, territoryForceAt } from '../territory';
import { settleTenDay } from '../turn';
import type { FacilityType, TroopType } from '../types';
import * as skillHandlers from '../skills/handlers';
import { tacticCriticalMode } from '../skills';
import { applyCatapultSplash, attackableCities, attackableFacilities, attackableUnits, attackCity, attackFacility, attackPlot, attackUnit, buildFacility, deployTransportUnit, deployUnit, deployUnitPreviewWithId, deploymentCells, deploymentCostsForStronghold, deploymentMovementAllowance, dismantleFacility, effectiveUnitAbilities, FACILITY_BUILD_COSTS, facilityBuildTargets, fireStrategySuccessChance, harmfulStrategySuccessChance, jointAttackableUnits, jointAttackUnit, moveUnit, movementCells, reconcileFacilityUpgrades, repairableFacilities, repairFacility, resolveFacilityUpgrade, settleBattleFacilities, strategyTargetCells, strategyTargetUnits, tacticCriticalChance, tacticTargetFacilities, unitCanUseTactic, unitFacilities, unitFacilityMenuOptions, unitStrategies, tacticTargetUnits, unitTactics, useFirePlot, useUnitStrategy, useUnitTactic, waitUnit } from './actions';
import { attackablePlots } from './targetRules';
import { applyGroundFireDamageToCities, applyImmediateFireDamageToCityAndPlot, GROUND_FIRE_CITY_DURABILITY } from './fire';
import { movementAllowanceForProfile, movementAllowanceForUnit } from './definitions';
import { gridKey, neighborsOf, sevenCellCityFootprint } from './grid';
import { damageRoll } from './shared';
import { unitCombatRating, unitStrategySuccessChance } from './officerAbilities';
import { strategyEnergyCostForUnit } from './strategies';
import { executeCommand } from '../commands';
import { isGameState } from '../persistence';

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
    stamina: 100,
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
    stamina: 100, energy: 100, movementRemaining: 30, moved: false, acted: false,
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
      stamina: 100, energy: 100, movementRemaining: 20, moved: false, acted: false,
    },
    'skill-target': {
      id: 'skill-target', kind: 'combat', forceId: 'cao', leaderId: 'cao-ren', officerIds: ['cao-ren'],
      homeCityId: 'xiangyang', troopType: 'spear', q: 11, r: 10, troops: targetTroops, food: 6000,
      stamina: 100, energy: 100, movementRemaining: 20, moved: false, acted: false,
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
      stamina: 100, energy: 100, movementRemaining: 20, moved: false, acted: false,
    },
    'strategy-skill-target': {
      id: 'strategy-skill-target', kind: 'combat', forceId: 'cao', leaderId: 'cao-ren', officerIds: ['cao-ren'],
      homeCityId: 'xiangyang', troopType: 'spear', q: 11, r: 10, troops: 5000, food: 5000,
      stamina: 100, energy: 100, movementRemaining: 20, moved: false, acted: false,
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
  state.units[attacker.id].stamina = 100;
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
  state.units[unit.id].stamina = 100;
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
    : unitStrategySuccessChance(
      strategyId,
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
      stamina: 100, energy: 100, movementRemaining: 20, moved: false, acted: false,
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
    // 落位消耗移动力：剩余 = 出征移动力预算 − 到达落位格的消耗
    const budget = deploymentMovementAllowance(state, 'liu', ['liu-bei'], 'spear', 'boat');
    const spawnCost = deploymentCostsForStronghold(state, 'jiangling', budget, 'spear').get(gridKey(destination!))!;
    expect(spawnCost).toBeGreaterThan(movementAllowanceForProfile('spear')); // 只有强化后的范围才够得到
    expect(unit.movementRemaining).toBe(budget - spawnCost);

    const preview = deployUnitPreviewWithId(state, 'liu', {
      cityId: 'jiangling', officerIds: ['liu-bei'], troopType: 'spear', troops: 3000, food: 3000,
      destination,
    });
    expect(preview.state.units[preview.unitId].movementRemaining).toBe(budget - spawnCost);
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
      // 部队士气 = 出发城池士气（两者是同一资源）
      energy: beforeCity.training,
      moved: true,
      acted: false,
    });
    // 落位消耗移动力：剩余 = 出征移动力预算 − 到达出生格的消耗
    const swordBudget = deploymentMovementAllowance(state, 'liu', ['guan-yu'], 'sword', 'boat');
    const swordSpawnCost = deploymentCostsForStronghold(state, 'jiangling', swordBudget, 'sword').get(gridKey(unit))!;
    expect(unit.movementRemaining).toBe(swordBudget - swordSpawnCost);
    expect(swordSpawnCost).toBeGreaterThan(0);
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
    setUniformTerrain(state, 'plain');
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
    state.cities.wuling.troops = 7400;

    expect(() => deployUnit(state, 'liu', {
      cityId: 'wuling',
      officerId: 'zhang-fei',
      targetCityId: 'changsha',
      troops: 7000,
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
      troops: 7000,
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
      food: 5000, stamina: 100, energy: 100, movementRemaining: 20, moved: false, acted: false,
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
      troops: 7000,
      food: 6000,
    });
    setUniformTerrain(state, 'plain');
    const unit = Object.values(state.units)[0];
    readyUnitAt(state, unit.id, { q: 10, r: 10 }, 'sword');
    state.units[unit.id].troops = 10_000;
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
      troops: 7000,
      food: 6000,
    });
    setUniformTerrain(state, 'plain');
    const unit = Object.values(state.units)[0];
    readyUnitAt(state, unit.id, { q: 10, r: 10 }, 'sword');
    state.units[unit.id].troops = 10_000;
    state.facilities = {
      building: { id: 'building', type: 'arrowTower', forceId: 'liu', q: 11, r: 10, durability: 150, completed: false },
      // 已建成且耐久已满：已无可修补空间，不列入可修补集（受损的已建成设施见下方专门用例）
      damagedCompleted: { id: 'damagedCompleted', type: 'musicTower', forceId: 'liu', q: 10, r: 11, durability: 800, completed: true },
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

  it('repairs a completed-but-damaged facility and keeps it effective while patching', () => {
    const state = deployUnit(createGame('liu', 1), 'liu', {
      cityId: 'jiangling',
      officerId: 'guan-yu',
      troops: 7000,
      food: 6000,
    });
    setUniformTerrain(state, 'plain');
    const unit = Object.values(state.units)[0];
    readyUnitAt(state, unit.id, { q: 10, r: 10 }, 'sword');
    state.units[unit.id].troops = 1000;
    // 已建成的太鼓台（上限 800）被打掉 500 耐久：仍是「已建成」，但耐久未满，应当可修补
    state.facilities = {
      drum: { id: 'drum', type: 'drum', forceId: 'liu', q: 11, r: 10, durability: 300, completed: true },
    };

    expect(repairableFacilities(state, unit.id).map((facility) => facility.id)).toEqual(['drum']);

    const repaired = repairFacility(state, 'liu', unit.id, 'drum');
    // 只补了一部分：耐久上升，且 completed 不得回退（否则会出现「不修还生效、一修反而失效」）
    expect(repaired.facilities!.drum.durability).toBeGreaterThan(300);
    expect(repaired.facilities!.drum.durability).toBeLessThan(800);
    expect(repaired.facilities!.drum.completed).not.toBe(false);
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

  it('lets units attack enemy development plots, reducing durability and clearing the plot at zero', () => {
    const state = deployUnit(createGame('liu', 1), 'liu', {
      cityId: 'jiangling',
      officerId: 'guan-yu',
      troops: 4000,
      food: 6000,
    });
    setUniformTerrain(state, 'plain');
    const unit = Object.values(state.units)[0];
    readyUnitAt(state, unit.id, { q: 10, r: 10 }, 'sword');

    // 敌城地格：市场在攻击范围，农场超出范围，空地在范围
    const caoCity = state.cities['xiangyang'];
    if (!caoCity.plots) caoCity.plots = [];
    caoCity.plots[0] = { id: 'p-market', type: 'market', level: 1, value: 0, q: 11, r: 10, durability: 500 };
    caoCity.plots[1] = { id: 'p-farm', type: 'farm', level: 1, value: 0, q: 20, r: 20, durability: 500 };
    caoCity.plots[2] = { id: 'p-empty', type: 'empty', level: 0, value: 0, q: 11, r: 11, durability: 0 };

    expect(attackablePlots(state, unit.id).map((plot) => `${plot.cityId}:${plot.plotIndex}`)).toEqual(['xiangyang:0']);

    // 耐久扣减
    const attacked = attackPlot(state, 'liu', unit.id, 'xiangyang', 0);
    expect(attacked.cities['xiangyang'].plots![0].durability).toBeLessThan(500);
    expect(attacked.cities['xiangyang'].plots![0].type).toBe('market');

    // 破坏到 0 时地格清空
    const destState = deployUnit(createGame('liu', 1), 'liu', {
      cityId: 'jiangling', officerId: 'guan-yu', troops: 3000, food: 3000,
    });
    setUniformTerrain(destState, 'plain');
    const destUnit = Object.values(destState.units)[0];
    readyUnitAt(destState, destUnit.id, { q: 10, r: 10 }, 'sword');
    const destCity = destState.cities['xiangyang'];
    if (!destCity.plots) destCity.plots = [];
    destCity.plots[0] = { id: 'p-low', type: 'market', level: 2, value: 0, q: 11, r: 10, durability: 1 };
    const destroyed = attackPlot(destState, 'liu', destUnit.id, 'xiangyang', 0);
    expect(destroyed.cities['xiangyang'].plots![0]).toMatchObject({ type: 'empty', level: 0, value: 0, durability: 0 });

    // 不能攻击己方地格
    const ownCity = state.cities['jiangling'];
    if (!ownCity.plots) ownCity.plots = [];
    ownCity.plots[0] = { id: 'own-plot', type: 'market', level: 1, value: 0, q: 11, r: 11, durability: 500 };
    expect(() => attackPlot(state, 'liu', unit.id, 'jiangling', 0)).toThrow(/己方/);
    expect(() => attackPlot(state, 'liu', unit.id, 'xiangyang', 1)).toThrow(/范围/);
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
    // 本用例把 grid 换成 4 格假图，守军落在江陵粮道之外 → 粮道受阻：不回复士气且每旬 -3（50 - 3）
    expect(settled.units[defender.id].energy).toBe(47);
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

  it('settles music tower stamina recovery and arrow tower automatic damage each ten-day', () => {
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
    state.units[unit.id].stamina = 50;
    addEnemyUnit(state, 'arrow-target', { q: 13, r: 10 }, 3000);
    state.facilities = {
      music: { id: 'music', type: 'musicTower', forceId: 'liu', q: 10, r: 11, durability: 800 },
      arrow: { id: 'arrow', type: 'arrowTower', forceId: 'liu', q: 12, r: 10, durability: 700 },
    };

    const next = settleTenDay(state);

    // 部队在 (10,10) 远离出发城江陵 → 粮道受阻：不回复基础士气且每旬 -3；军乐台只回战力不回气力
    expect(next.units[unit.id].energy).toBe(47);
    // 战力：每旬回复最高政治12%（关羽政 62×12%=7.44）+ 军乐台 +6
    expect(next.units[unit.id].stamina).toBeCloseTo(50 + state.officers['guan-yu'].stats.politics * 0.12 + 6);
    expect(next.units['arrow-target'].troops).toBeLessThan(3000);
  });

  it('gates the new field facilities behind their tech nodes while 阵/土垒/箭楼 stay free', () => {
    const state = deployUnit(createGame('liu', 1), 'liu', {
      cityId: 'jiangling',
      officerId: 'guan-yu',
      troops: 4000,
      food: 6000,
      gold: 2000,
    });
    const unit = Object.values(state.units)[0];
    setUniformTerrain(state, 'plain');
    readyUnitAt(state, unit.id, { q: 10, r: 12 }, 'sword');

    // 无科技：阵 / 土垒 / 箭楼 / 太鼓台 / 火种 / 火球等默认可建
    for (const facility of ['formation', 'earthwork', 'arrowTower', 'fireSeed', 'fireBall'] as const) {
      expect(facilityBuildTargets(state, unit.id, undefined, facility).length).toBeGreaterThan(0);
    }
    // 需科技：砦/石墙（石工术）、连弩楼（建筑学）、投石台（弹道）、火焰种/火焰球（火药）、业火种/业火球（化学）
    for (const facility of [
      'fort', 'stoneWall', 'crossbowTower', 'catapultTower',
      'flameSeed', 'flameBall', 'hellfireSeed', 'hellfireBall',
    ] as const) {
      expect(facilityBuildTargets(state, unit.id, undefined, facility)).toEqual([]);
      expect(() => buildFacility(state, 'liu', unit.id, facility, { q: 10, r: 11 })).toThrow();
    }

    const researched = structuredClone(state);
    researched.forces.liu.techNodes = ['shigongshu', 'jianzhuxue', 'dandao', 'huaxue'];
    for (const facility of ['fort', 'stoneWall', 'crossbowTower', 'catapultTower', 'hellfireSeed', 'hellfireBall'] as const) {
      expect(facilityBuildTargets(researched, unit.id, undefined, facility).length).toBeGreaterThan(0);
    }
    // 化学不覆盖火药：火焰种/火焰球仍需「火药」；火种/火球为基础档仍可建
    expect(facilityBuildTargets(researched, unit.id, undefined, 'fireSeed').length).toBeGreaterThan(0);
    expect(facilityBuildTargets(researched, unit.id, undefined, 'fireBall').length).toBeGreaterThan(0);
    expect(facilityBuildTargets(researched, unit.id, undefined, 'flameSeed')).toEqual([]);
    expect(facilityBuildTargets(researched, unit.id, undefined, 'flameBall')).toEqual([]);
    researched.forces.liu.techNodes = [...researched.forces.liu.techNodes, 'huoyao'];
    expect(facilityBuildTargets(researched, unit.id, undefined, 'flameSeed').length).toBeGreaterThan(0);
    expect(facilityBuildTargets(researched, unit.id, undefined, 'flameBall').length).toBeGreaterThan(0);
  });

  it('settles 连弩楼 harder than 箭楼 and keeps 投石台 on the 2~3 ring only', () => {
    const towerState = (type: FacilityType, targets: Array<[string, { q: number; r: number }]>) => {
      const state = createGame('liu', 1);
      state.facilities = { tower: { id: 'tower', type, forceId: 'liu', q: 12, r: 10, durability: 900 } };
      targets.forEach(([id, coord]) => addEnemyUnit(state, id, coord, 5000));
      return state;
    };
    const loss = (state: ReturnType<typeof createGame>, id: string) => 5000 - state.units[id].troops;

    // 箭楼 300：射程 1~2 格
    const arrow = towerState('arrowTower', [['adjacent', { q: 13, r: 10 }], ['two-away', { q: 14, r: 10 }]]);
    settleBattleFacilities(arrow);
    expect(loss(arrow, 'adjacent')).toBe(300);
    expect(loss(arrow, 'two-away')).toBe(300);

    // 连弩楼 500：同样吃 1~2 格，但伤害更高
    const crossbow = towerState('crossbowTower', [['adjacent', { q: 13, r: 10 }], ['two-away', { q: 14, r: 10 }]]);
    settleBattleFacilities(crossbow);
    expect(loss(crossbow, 'adjacent')).toBe(500);
    expect(loss(crossbow, 'two-away')).toBe(500);

    // 投石台 700：只打距其 2~3 格，相邻第 1 格（与 2 格）不挨打
    const catapult = towerState('catapultTower', [
      ['adjacent', { q: 13, r: 10 }],
      ['two-away', { q: 14, r: 10 }],
      ['three-away', { q: 15, r: 10 }],
      ['four-away', { q: 16, r: 10 }],
    ]);
    settleBattleFacilities(catapult);
    expect(loss(catapult, 'adjacent')).toBe(0);
    expect(loss(catapult, 'two-away')).toBe(700);
    expect(loss(catapult, 'three-away')).toBe(700);
    expect(loss(catapult, 'four-away')).toBe(0);
  });

  it('lets 投石台 splash onto the surrounding ring with 霹雳 but not without it', () => {
    const staged = (techNodes: string[]) => {
      const state = createGame('liu', 1);
      state.forces.liu.techNodes = techNodes;
      state.facilities = { tower: { id: 'tower', type: 'catapultTower', forceId: 'liu', q: 12, r: 10, durability: 800 } };
      addEnemyUnit(state, 'center-target', { q: 14, r: 10 }, 5000);
      // 距投石台 1 格 → 不在 2~3 格直射圈内，只会吃到溅射
      addEnemyUnit(state, 'splash-target', { q: 13, r: 10 }, 5000);
      return state;
    };

    const withoutPili = staged(['dandao']);
    settleBattleFacilities(withoutPili);
    expect(5000 - withoutPili.units['center-target'].troops).toBe(700);
    expect(withoutPili.units['splash-target'].troops).toBe(5000);

    const withPili = staged(['dandao', 'pili']);
    settleBattleFacilities(withPili);
    // 中心格 700（不重复结算溅射），相邻 1 格溅射 350（中心伤害的 50%）
    expect(5000 - withPili.units['center-target'].troops).toBe(700);
    expect(5000 - withPili.units['splash-target'].troops).toBe(350);
  });

  it('applies 霹雳 splash to all six neighbouring cells regardless of force', () => {
    const state = createGame('liu', 1);
    state.forces.liu.techNodes = ['pili'];
    addEnemyUnit(state, 'center', { q: 14, r: 10 }, 5000);
    addEnemyUnit(state, 'neighbour', { q: 13, r: 10 }, 5000);
    addEnemyUnit(state, 'friendly-neighbour', { q: 14, r: 11 }, 5000);
    addEnemyUnit(state, 'far-away', { q: 16, r: 10 }, 5000);
    state.units['friendly-neighbour'].forceId = 'liu';

    const next = structuredClone(state);
    const hits = applyCatapultSplash(next, 'catapultTower', 'liu', { q: 14, r: 10 }, 700, { centerUnitId: 'center' });

    expect(hits.map((hit) => hit.unitId).sort()).toEqual(['friendly-neighbour', 'neighbour']);
    expect(next.units.center.troops).toBe(5000);
    expect(next.units.neighbour.troops).toBe(4650);
    expect(next.units['friendly-neighbour'].troops).toBe(4650);
    expect(next.units['far-away'].troops).toBe(5000);

    const withoutPili = structuredClone(state);
    withoutPili.forces.liu.techNodes = [];
    expect(applyCatapultSplash(withoutPili, 'catapultTower', 'liu', { q: 14, r: 10 }, 700, { centerUnitId: 'center' })).toEqual([]);
    expect(withoutPili.units.neighbour.troops).toBe(5000);
  });

  it('applies the 阵→砦→城塞 protection gradient by range', () => {
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
    addEnemyUnit(base, 'gradient-attacker', { q: 10, r: 10 }, 5000);

    const normal = attackUnit(base, 'cao', 'gradient-attacker', defender.id);
    const normalLoss = base.units[defender.id].troops - normal.units[defender.id].troops;

    const lossWith = (type: FacilityType, q: number, r: number) => {
      const state = structuredClone(base);
      state.facilities = { guard: { id: 'guard', type, forceId: 'liu', q, r, durability: 1200 } };
      const hit = attackUnit(state, 'cao', 'gradient-attacker', defender.id);
      return state.units[defender.id].troops - hit.units[defender.id].troops;
    };

    // 阵：1 格内 0.9，超过 1 格不生效
    expect(lossWith('formation', 12, 10)).toBe(Math.round(normalLoss * 0.9));
    expect(lossWith('formation', 13, 10)).toBe(normalLoss);
    // 砦：2 格内 0.8
    expect(lossWith('fort', 13, 10)).toBe(Math.round(normalLoss * 0.8));
    expect(lossWith('fort', 14, 10)).toBe(normalLoss);
    // 城塞：3 格内 0.7（既有数值不变）
    expect(lossWith('fortress', 14, 10)).toBe(Math.round(normalLoss * 0.7));
  });

  it('upgrades 阵/土垒/箭楼 along the chain when 石工术/建筑学 completes', () => {
    const state = createGame('liu', 1);
    state.facilities = {
      wall: { id: 'wall', type: 'earthwork', forceId: 'liu', q: 11, r: 10, durability: 120 },
      tower: { id: 'tower', type: 'arrowTower', forceId: 'liu', q: 13, r: 10, durability: 200 },
      enemyWall: { id: 'enemyWall', type: 'earthwork', forceId: 'cao', q: 15, r: 10, durability: 90 },
      formation: { id: 'formation', type: 'formation', forceId: 'liu', q: 17, r: 10, durability: 300 },
      building: { id: 'building', type: 'earthwork', forceId: 'liu', q: 19, r: 10, durability: 100, completed: false },
    };

    // 石工术：阵 → 砦、土垒 → 石墙；箭楼与敌方/施工中的设施不受影响
    state.forces.liu.techNodes = ['shigongshu'];
    expect(reconcileFacilityUpgrades(state, 'liu')).toBe(2);
    expect(state.facilities.formation).toMatchObject({ id: 'formation', forceId: 'liu', type: 'fort', durability: 900 });
    expect(state.facilities.wall).toMatchObject({
      id: 'wall', type: 'stoneWall', forceId: 'liu', q: 11, r: 10, durability: 600, completed: true,
    });
    expect(state.facilities.tower).toMatchObject({ type: 'arrowTower', durability: 200 });
    expect(state.facilities.enemyWall).toMatchObject({ type: 'earthwork', durability: 90 });
    expect(state.facilities.building).toMatchObject({ type: 'earthwork', durability: 100, completed: false });
    // 幂等：已收敛的设施不会重复升级
    expect(reconcileFacilityUpgrades(state, 'liu')).toBe(0);

    // 建筑学：砦 → 城塞、箭楼 → 连弩楼
    state.forces.liu.techNodes = ['shigongshu', 'jianzhuxue'];
    expect(reconcileFacilityUpgrades(state, 'liu')).toBe(2);
    expect(state.facilities.formation).toMatchObject({ type: 'fortress', durability: 1200 });
    expect(state.facilities.tower).toMatchObject({ type: 'crossbowTower', durability: 900 });
    expect(reconcileFacilityUpgrades(state, 'liu')).toBe(0);
  });

  it('keeps 砦/城塞/连弩楼 out of the build menu and renames the entry as techs land', () => {
    const state = createGame('liu', 1);
    const menuNames = () => unitFacilityMenuOptions(state, 'liu').map((facility) => facility.name);

    // 默认：只列基础档（阵/土垒/箭楼），高档作独立选项一律不出现
    expect(menuNames()).toEqual(expect.arrayContaining(['阵', '土垒', '箭楼']));
    for (const hidden of ['砦', '城塞', '连弩楼']) expect(menuNames()).not.toContain(hidden);

    // 石工术：阵 → 砦、土垒 → 石墙
    state.forces.liu.techNodes = ['shigongshu'];
    expect(menuNames()).toEqual(expect.arrayContaining(['砦', '石墙', '箭楼']));
    expect(menuNames()).not.toContain('阵');
    expect(menuNames()).not.toContain('土垒');

    // 建筑学：砦 → 城塞、箭楼 → 连弩楼
    state.forces.liu.techNodes = ['shigongshu', 'jianzhuxue'];
    expect(menuNames()).toEqual(expect.arrayContaining(['城塞', '石墙', '连弩楼']));
    expect(menuNames()).not.toContain('砦');
    expect(menuNames()).not.toContain('箭楼');
    // 投石台是独立选项（非升级链），也因此没有低档可退：弹道之前整条不出现，研究后才冒出来
    expect(menuNames()).not.toContain('投石台');
    state.forces.liu.techNodes = ['shigongshu', 'jianzhuxue', 'dandao'];
    expect(menuNames()).toContain('投石台');
    // 陷阱型与据点/阻挡/攻击型一样走升级链：默认只列基础档「火种/火球」，火焰/业火高档不单独出现
    expect(menuNames()).toEqual(expect.arrayContaining(['火种', '火球']));
    for (const hidden of ['火焰种', '火焰球', '业火种', '业火球']) expect(menuNames()).not.toContain(hidden);

    // 火药：火种 → 火焰种、火球 → 火焰球（入口改名并升级）
    state.forces.liu.techNodes = ['shigongshu', 'jianzhuxue', 'huoyao'];
    expect(menuNames()).toEqual(expect.arrayContaining(['火焰种', '火焰球']));
    expect(menuNames()).not.toContain('火种');
    expect(menuNames()).not.toContain('火球');

    // 化学：火焰种 → 业火种、火焰球 → 业火球
    state.forces.liu.techNodes = ['shigongshu', 'jianzhuxue', 'huoyao', 'huaxue'];
    expect(menuNames()).toEqual(expect.arrayContaining(['业火种', '业火球']));
    expect(menuNames()).not.toContain('火焰种');
    expect(menuNames()).not.toContain('火焰球');
    // 升级链入口升级后仍用高档的造价
    expect(FACILITY_BUILD_COSTS[resolveFacilityUpgrade(state, 'liu', 'formation')]).toBe(900);
  });

  it('doubles stronghold capacity with 修筑要塞 for cities and passes', () => {
    const state = createGame('liu', 1);
    const city = state.cities.jiangling;
    city.gold = CITY_GOLD_CAP + 1;
    expect(strongholdsExceedCaps(state)).toBe(true);

    const researched = structuredClone(state);
    researched.forces.liu.techNodes = ['xiuzhuyaosai'];
    expect(strongholdsExceedCaps(researched)).toBe(false);
    expect(cityResourceCaps(researched, researched.cities.jiangling)).toMatchObject({
      gold: CITY_GOLD_CAP * 2,
      troops: Math.round(cityTroopCap(researched.cities.jiangling) * 2),
    });

    // 港关容量同样＋100%：关隘兵力超过基准上限但未超过翻倍上限时不算超限
    const pass = Object.values(researched.passes!)[0]!;
    pass.ownerId = 'liu';
    pass.troops = PASS_TROOP_CAP + 1;
    expect(strongholdsExceedCaps(researched)).toBe(false);
    researched.forces.liu.techNodes = [];
    expect(strongholdsExceedCaps(researched)).toBe(true);
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

  it('ignites 业火种 and 业火球 for higher damage and longer burning ground', () => {
    const seedState = deployUnit(createGame('liu', 1), 'liu', {
      cityId: 'jiangling',
      officerId: 'guan-yu',
      troops: 4000,
      food: 6000,
    });
    const seedUnit = Object.values(seedState.units)[0];
    readyUnitAt(seedState, seedUnit.id, { q: 10, r: 10 }, 'sword');
    addEnemyUnit(seedState, 'hellfire-seed-target', { q: 11, r: 11 }, 5000);
    seedState.facilities = {
      seed: { id: 'seed', type: 'hellfireSeed', forceId: 'liu', q: 11, r: 10, durability: 250 },
    };

    const seedResult = useUnitStrategy(seedState, 'liu', seedUnit.id, 'fire', { coord: { q: 11, r: 10 } });
    expect(seedResult.units['hellfire-seed-target'].troops).toBe(5000 - 1200);
    expect(seedResult.facilities?.seed).toBeUndefined();
    expect(seedResult.firePlots).toHaveLength(7);
    for (const plot of seedResult.firePlots ?? []) {
      // 业火持续 2~4 旬（普通火焰种为 1~3 旬）
      expect(plot.remainingTenDays).toBeGreaterThanOrEqual(2);
      expect(plot.remainingTenDays).toBeLessThanOrEqual(4);
    }

    const ballState = deployUnit(createGame('liu', 1), 'liu', {
      cityId: 'jiangling',
      officerId: 'guan-yu',
      troops: 4000,
      food: 6000,
    });
    const ballUnit = Object.values(ballState.units)[0];
    readyUnitAt(ballState, ballUnit.id, { q: 10, r: 10 }, 'sword');
    addEnemyUnit(ballState, 'hellfire-ball-target', { q: 12, r: 11 }, 5000);
    ballState.facilities = {
      ball: { id: 'ball', type: 'hellfireBall', forceId: 'liu', q: 11, r: 10, durability: 250 },
    };

    const ballResult = useUnitStrategy(ballState, 'liu', ballUnit.id, 'fire', { coord: { q: 11, r: 10 } });
    // 业火球沿用 fireBallCells 的贯通 3 格，伤害 1200
    expect(ballResult.units['hellfire-ball-target'].troops).toBe(5000 - 1200);
    expect(ballResult.facilities?.ball).toBeUndefined();
    expect(ballResult.firePlots?.map(({ q, r }) => ({ q, r }))).toEqual([
      { q: 11, r: 10 },
      { q: 12, r: 11 },
      { q: 13, r: 11 },
    ]);
    for (const plot of ballResult.firePlots ?? []) {
      expect(plot.remainingTenDays).toBeGreaterThanOrEqual(2);
      expect(plot.remainingTenDays).toBeLessThanOrEqual(4);
    }
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
    const game = createGame('liu', 1);
    game.cities['jiangling'].armaments = { ...initialArmaments(), cavalry: 5000 };
    const deployed = deployUnit(game, 'liu', {
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
    state.cities['jiangling'].armaments = { ...initialArmaments(), ram: 5 };

    const infantryDeployTargets = deploymentCells(state, 'jiangling', undefined, 'sword');
    const siegeDeployTargets = deploymentCells(state, 'jiangling', undefined, 'siege');

    expect(infantryDeployTargets.length).toBeGreaterThan(siegeDeployTargets.length);

    const deployed = deployUnit(state, 'liu', {
      cityId: 'jiangling',
      officerId: 'guan-yu',
      troopType: 'siege',
      siegeWeapon: 'ram',
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
    // 原版精确地图：部队自渡所下水（(73,137) 是渡所，西侧 (72,137) 是河）
    deployed.units[unit.id].q = 73;
    deployed.units[unit.id].r = 137;
    deployed.units[unit.id].moved = false;
    deployed.units[unit.id].movementRemaining = 20;

    const water = deployed.grid.find((cell) => cell.q === 72 && cell.r === 137);

    expect(water?.terrain).toBe('river');
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
    state.units[attacker.id].stamina = 0;

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

  it('scales damage with committed troops and keeps remnants below their own size', () => {
    // 出征下限为 1000 兵，但部队被打残后仍可继续攻击。
    // 基础伤害与投入兵力严格成正比（已无固定基数），残兵段再被残兵系数二次衰减。
    const damageAt = (troops: number) => {
      const state = deployUnit(createGame('liu', 77), 'liu', {
        cityId: 'jiangling', officerId: 'guan-yu', troops: 4000, food: 5000,
      });
      const attacker = Object.values(state.units)[0];
      readyUnitAt(state, attacker.id, { q: 10, r: 10 });
      setUniformTerrain(state, 'plain');
      attacker.troops = troops;
      addEnemyUnit(state, 'enemy-remnant', { q: 11, r: 10 }, 10_000);
      return attackUnit(state, 'liu', attacker.id, 'enemy-remnant').battleDamageReports![0].amount;
    };

    const remnant = damageAt(200);
    const half = damageAt(1000);
    const full = damageAt(4000);

    // 200 兵打出的伤害必须低于自身兵力（旧公式约为 270，会超过自身兵力）
    expect(remnant).toBeLessThan(200);
    expect(half).toBeGreaterThan(remnant);
    // 兵力回到满编后恢复正常量级
    expect(full).toBeGreaterThan(half);
    // 去掉固定基数后伤害与投入兵力成正比：1000 → 4000（同一随机种子）约 4 倍
    expect(full / half).toBeGreaterThan(3);
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
    // 适性现在同时参与「部队攻防力」，三个等级的基础伤害并不相同，故各自取一次基准
    const cases = (['B', 'A', 'S'] as const).map((grade) => {
      const { state, attacker } = spearTacticState(grade, seed);
      const amount = useUnitTactic(state, 'liu', attacker.id, 'enemy-tactic', 'spear-thrust').battleDamageReports![0].amount;
      const { state: baseline, attacker: baselineAttacker } = spearTacticState(grade, seed);
      baseline.rngCursor = nextRandom(seed, baseline.rngCursor).cursor;
      // 防守方曹仁统率被对齐为95，自身带光环（范围1、相邻）→ 伤害×0.95，需传入防守方
      const baseDamage = damageRoll(baseline, baselineAttacker, 'plain', false, baseline.units['enemy-tactic']);
      return { amount, baseDamage };
    });

    expect(cases.map((entry) => entry.amount)).toEqual(
      cases.map((entry, index) => Math.round(entry.baseDamage * 1.18 * [1, 1.1, 1.2][index])),
    );
  });

  it('uses one tactic critical roll and reports a 135 percent critical hit', () => {
    const chance = tacticCriticalChance(97, 'S') / 100;
    const criticalSeed = seedForFirstRoll((value) => value < chance);
    const { state, attacker } = spearTacticState('S', criticalSeed);
    const expectedState = structuredClone(state);
    expectedState.rngCursor = nextRandom(criticalSeed, expectedState.rngCursor).cursor;
    // 同上：防守方曹仁带光环，期望值需传入防守方
    const expectedBase = damageRoll(expectedState, expectedState.units[attacker.id], 'plain', false, expectedState.units['enemy-tactic']);

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
    const damageReports = next.battleDamageReports!.filter((report) => report.kind !== 'counter');
    expect(damageReports).toHaveLength(2);
    expect(damageReports.every((report) => report.critical && report.label === '暴击')).toBe(true);
    expect(next.battleDamageReports?.some((report) => report.kind === 'counter' && report.unitId === attacker.id)).toBe(true);
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
    const damageReports = next.battleDamageReports!.filter((report) => report.kind !== 'counter');
    expect(damageReports.map((report) => report.unitId)).toEqual([target.id, 'area-stronger']);
    expect(damageReports.every((report) => report.critical && report.label === '暴击')).toBe(true);
    expect(next.battleDamageReports?.some((report) => report.kind === 'counter' && report.unitId === attacker.id)).toBe(true);
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
    const damageReports = next.battleDamageReports!.filter((report) => report.kind !== 'counter');
    expect(damageReports).toEqual([firstExpected.report, secondExpected.report]);
    expect(next.battleDamageReports?.some((report) => report.kind === 'counter' && report.unitId === attacker.id)).toBe(true);
  });

  it('uses spear tactics to push or confuse a target and spend stamina', () => {
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
    state.units[attacker.id].stamina = 100;
    addEnemyUnit(state, 'enemy-thrust', { q: 11, r: 10 });

    expect(tacticTargetUnits(state, attacker.id, 'spear-thrust').map((unit) => unit.id)).toContain('enemy-thrust');

    const pushed = useUnitTactic(state, 'liu', attacker.id, 'enemy-thrust', 'spear-thrust');

    expect(pushed.units[attacker.id].stamina).toBe(85);
    expect(pushed.units[attacker.id].acted).toBe(true);
    expect(pushed.units['enemy-thrust']).toMatchObject({ q: 12, r: 11 });
    expect(pushed.units['enemy-thrust'].troops).toBeLessThan(3000);

    const spiralState = structuredClone(state);
    spiralState.units[attacker.id].stamina = 100;
    const confused = useUnitTactic(spiralState, 'liu', attacker.id, 'enemy-thrust', 'spear-spiral');

    expect(confused.units[attacker.id].stamina).toBe(80);
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
    firstBlocked.units[attacker.id].stamina = 100;
    addEnemyUnit(firstBlocked, 'first-blocker', { q: 12, r: 11 }, 2800);
    const stopped = useUnitTactic(firstBlocked, 'liu', attacker.id, 'enemy-double-open', 'spear-double');
    expect(stopped.units['enemy-double-open']).toMatchObject({ q: 11, r: 10 });
    expect(stopped.units['first-blocker'].troops).toBeLessThan(2800);
    expect(stopped.battleDamageReports?.map((report) => report.unitId)).toEqual(expect.arrayContaining([
      'enemy-double-open',
      'first-blocker',
    ]));

    const secondBlocked = structuredClone(state);
    secondBlocked.units[attacker.id].stamina = 100;
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
    state.units[attacker.id].stamina = 100;
    addEnemyUnit(state, 'enemy-front', { q: 11, r: 10 });
    addEnemyUnit(state, 'enemy-side', { q: 10, r: 9 });

    const whirlwind = useUnitTactic(state, 'liu', attacker.id, 'enemy-front', 'halberd-whirlwind');

    expect(whirlwind.units[attacker.id].stamina).toBe(70);
    expect(whirlwind.battleDamageReports?.filter((report) => report.kind !== 'counter').map((report) => report.unitId).sort()).toEqual(['enemy-front', 'enemy-side']);

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
    crossbowState.units[crossbow.id].stamina = 100;
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

    expect(pierced.units[crossbow.id].stamina).toBe(85);
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
    state.units[attacker.id].stamina = 100;
    addEnemyUnit(state, 'sweep-target', { q: 11, r: 10 });
    addEnemyUnit(state, 'sweep-linked-a', { q: 10, r: 11 });
    addEnemyUnit(state, 'sweep-target-only', { q: 12, r: 10 });
    addEnemyUnit(state, 'sweep-linked-b', { q: 11, r: 9 });

    const swept = useUnitTactic(state, 'liu', attacker.id, 'sweep-target', 'halberd-sweep');

    expect(swept.units[attacker.id].stamina).toBe(80);
    expect(swept.battleDamageReports?.filter((report) => report.kind !== 'counter').map((report) => report.unitId).sort()).toEqual([
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
    crossbowState.units[crossbow.id].stamina = 100;
    addEnemyUnit(crossbowState, 'enemy-fire', { q: 12, r: 10 });

    const targetCell = { q: crossbowState.units['enemy-fire'].q, r: crossbowState.units['enemy-fire'].r };
    const burning = useUnitTactic(crossbowState, 'liu', crossbow.id, 'enemy-fire', 'crossbow-fire');

    expect(burning.units[crossbow.id].stamina).toBe(90);
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
    cavalryState.units[cavalry.id].stamina = 100;
    addEnemyUnit(cavalryState, 'enemy-breakthrough', { q: 11, r: 10 });

    const breakthrough = useUnitTactic(cavalryState, 'liu', cavalry.id, 'enemy-breakthrough', 'cavalry-breakthrough');

    expect(breakthrough.units[cavalry.id]).toMatchObject({ q: 12, r: 11, stamina: 80, acted: true });
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
    state.units[crossbow.id].stamina = 100;
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
    expect(ignited.units[crossbow.id]).toMatchObject({ stamina: 90, acted: true });
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

  it('rejects strategies below the troop threshold while normal attacks still work', () => {
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
    state.units[unit.id].stamina = 50;
    state.firePlots = [{ q: 11, r: 10 }];
    addEnemyUnit(state, 'enemy-low-troops', { q: 11, r: 10 }, 3000);

    state.units[unit.id].troops = 499;
    expect(() => useUnitStrategy(state, 'liu', unit.id, 'fire', { coord: { q: 11, r: 10 } }))
      .toThrow(/兵力不足/);

    // 兵力不足只封锁计略，普攻照常可用
    const next = attackUnit(state, 'liu', unit.id, 'enemy-low-troops');
    expect(next.battleDamageReports![0].amount).toBeGreaterThan(0);
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
    state.units[unit.id].stamina = 50;
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
    expect(burned.units[unit.id]).toMatchObject({ stamina: 40, acted: true });

    const extinguished = useUnitStrategy(state, 'liu', unit.id, 'extinguish', { coord: { q: 11, r: 10 } });
    expect(extinguished.firePlots).toEqual([]);
    expect(extinguished.units[unit.id]).toMatchObject({ stamina: 40, acted: true });

    const falseReported = useUnitStrategy(state, 'liu', unit.id, 'false-report', { targetUnitId: 'enemy-plot' });
    // 伪报与扰乱同规则：1~3 旬掷点
    expect(falseReported.units['enemy-plot'].falseReportedTenDays).toBeGreaterThanOrEqual(1);
    expect(falseReported.units['enemy-plot'].falseReportedTenDays).toBeLessThanOrEqual(3);
    expect(falseReported.units[unit.id]).toMatchObject({ stamina: 35, acted: true });
    expect(() => waitUnit(falseReported, 'cao', 'enemy-plot')).toThrow(/伪报|混乱/);

    const disturbed = useUnitStrategy(state, 'liu', unit.id, 'disturb', { targetUnitId: 'enemy-plot' });
    expect(disturbed.units['enemy-plot'].confusedTenDays).toBeGreaterThanOrEqual(1);
    expect(disturbed.units['enemy-plot'].confusedTenDays).toBeLessThanOrEqual(3);
    expect(disturbed.units[unit.id]).toMatchObject({ stamina: 35, acted: true });
    expect(() => waitUnit(disturbed, 'cao', 'enemy-plot')).toThrow(/伪报|混乱/);

    expect(() => useUnitStrategy(state, 'liu', unit.id, 'calm', { targetUnitId: 'enemy-plot' })).toThrow(/范围|目标/);
    const calmed = useUnitStrategy(calmState, 'liu', unit.id, 'calm', { targetUnitId: 'ally-calm-target' });
    expect(calmed.units['ally-calm-target'].confusedTenDays).toBeUndefined();
    expect(calmed.units[unit.id]).toMatchObject({ stamina: 40, acted: true });

    const inspired = useUnitStrategy(state, 'liu', unit.id, 'inspire', { targetUnitId: unit.id });
    // 鼓舞消耗 10 战力，并额外为自身部队恢复 20 士气
    expect(inspired.units[unit.id]).toMatchObject({ stamina: 40, energy: 70, acted: true });
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

    expect(next.rngCursor).toBe(state.rngCursor + (strategyId === 'disturb' || strategyId === 'false-report' || strategyId === 'fire' ? 2 : 1));
    expect(next.units[unit.id]).toMatchObject({ stamina: 100 - cost, acted: true });
    expect(next.strategyResultReports).toEqual([expect.objectContaining({
      strategyId, label, succeeded: true, q: target.q, r: target.r,
    })]);
    if (strategyId === 'fire') expect(next.firePlots).toContainEqual(expect.objectContaining(target));
    if (strategyId === 'false-report') expect(targetStatus.falseReportedTenDays).toBeUndefined();
    if (strategyId === 'false-report') {
      expect(next.units['strategy-target'].falseReportedTenDays).toBeGreaterThanOrEqual(1);
      expect(next.units['strategy-target'].falseReportedTenDays).toBeLessThanOrEqual(3);
    }
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

  it.each([1, 2, 3])('assigns a successful false report a deterministic random duration of %i ten-day turns', (duration) => {
    const { state, unit, selection, chance } = probabilisticStrategyState('false-report');
    state.seed = seedForTwoRolls(
      (value) => value < chance / 100,
      (value) => Math.floor(value * 3) + 1 === duration,
    );

    const next = useUnitStrategy(state, 'liu', unit.id, 'false-report', selection);

    expect(next.units['strategy-target'].falseReportedTenDays).toBe(duration);
    expect(next.rngCursor).toBe(2);
  });

  it('makes false report harder to land than disturb', () => {
    // 同一对智力：伪报基准比扰乱低 15 点（55 + 智力差 vs 70 + 智力差）
    expect(unitStrategySuccessChance('false-report', 80, 70)).toBe(65);
    expect(harmfulStrategySuccessChance(80, 70)).toBe(80);
    // 上限也更低（10~90 vs 10~95）
    expect(unitStrategySuccessChance('false-report', 200, 1)).toBe(90);
    expect(harmfulStrategySuccessChance(200, 1)).toBe(95);
    // 扰乱仍走原公式：只有伪报被下调
    expect(unitStrategySuccessChance('disturb', 80, 70)).toBe(harmfulStrategySuccessChance(80, 70));
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
    expect(next.units[unit.id]).toMatchObject({ stamina: 100 - cost, acted: true });
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

  it('deals immediate fire damage to a city development plot and the city itself on ignition', () => {
    const state = deployUnit(createGame('liu', 1), 'liu', {
      cityId: 'jiangling',
      officerId: 'guan-yu',
      troops: 3000,
      food: 3000,
    });
    setUniformTerrain(state, 'plain');
    const unit = Object.values(state.units)[0];
    const city = state.cities.jiangling;
    const footprint = sevenCellCityFootprint({ q: city.gridQ, r: city.gridR });
    // 目标格取城池 7 格中的一格，部队站其邻格（射程 1）
    const target = footprint[0];
    const unitCoord = neighborsOf(target.q, target.r)[0];
    readyUnitAt(state, unit.id, { q: unitCoord.q, r: unitCoord.r });
    city.plots = [{ id: 'p-market', type: 'market', level: 2, value: 0, q: target.q, r: target.r, durability: 500 }];
    const cityDurabilityBefore = city.durability;

    const next = useUnitStrategy(state, 'liu', unit.id, 'fire', { coord: { q: target.q, r: target.r } });

    expect(next.cities.jiangling.plots![0].durability).toBe(500 - 150);
    expect(next.cities.jiangling.durability).toBe(cityDurabilityBefore - 150);
  });

  it('captures an enemy city immediately when ignition fire burns its durability to zero', () => {
    const state = deployUnit(createGame('liu', 1), 'liu', {
      cityId: 'jiangling',
      officerId: 'guan-yu',
      troops: 3000,
      food: 3000,
    });
    setUniformTerrain(state, 'plain');
    const unit = Object.values(state.units)[0];
    const target = state.cities.xiangyang;
    const footprint = sevenCellCityFootprint({ q: target.gridQ, r: target.gridR });
    const cell = footprint[0];
    const unitCoord = neighborsOf(cell.q, cell.r)[0];
    readyUnitAt(state, unit.id, { q: unitCoord.q, r: unitCoord.r });
    target.durability = 150; // 点火瞬间的 150 城伤恰好将其烧至 0

    const next = useUnitStrategy(state, 'liu', unit.id, 'fire', { coord: { q: cell.q, r: cell.r } });

    expect(next.cities.xiangyang.ownerId).toBe('liu'); // 当场攻破
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
    state.units[unit.id].stamina = 50;
    addEnemyUnit(state, 'discord-target', { q: 11, r: 10 });
    addEnemyUnit(state, 'discord-victim', { q: 12, r: 11 });

    expect(strategyTargetUnits(state, unit.id, 'discord').map((target) => target.id)).toEqual(['discord-target']);

    const next = useUnitStrategy(state, 'liu', unit.id, 'discord', { targetUnitId: 'discord-target' });

    expect(next.units[unit.id]).toMatchObject({ stamina: 30, acted: true });
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

  it('resolves 连击 through two normal hits but spends energy and counters once', () => {
    const { state, attacker, target } = combatSkillState('连击', '无', 10_000);
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

  it('does not roll 连击 after the first normal hit defeats the target', () => {
    const { state, attacker, target } = combatSkillState('连击', '无', 1);

    const next = attackUnit(state, 'liu', attacker.id, target.id);

    expect(next.units[target.id]).toBeUndefined();
    // RNG 构成：伤害 1 + 歼灭结算（战死 1 + 俘获 1 + 败军负伤 1）= 4；关键是没有第二次连击伤害
    expect(next.rngCursor).toBe(state.rngCursor + 4);
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
    expect(next.units[attacker.id].energy).toBe(deployed.cities.jiangling.training - 10);
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

  it('performs a joint attack that merges ally damage into one report and acts every participant', () => {
    const first = deployUnit(createGame('liu', 2), 'liu', {
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

    const next = jointAttackUnit(second, 'liu', attacker.id, 'joint-target');

    // 总伤害合并为单个齐攻报告，且报告的伤害等于目标实际受到的损失
    const jointReport = next.battleDamageReports!.find((report) => report.kind === 'jointAttack');
    expect(jointReport).toBeDefined();
    expect(jointReport!.amount).toBe(3000 - next.units['joint-target'].troops);
    expect(next.units['joint-target'].troops).toBeLessThan(3000);
    // 主攻者与友军都本旬行动、各消耗 10 士气
    expect(next.units[attacker.id].acted).toBe(true);
    expect(next.units[ally.id].acted).toBe(true);
    expect(next.units[attacker.id].energy).toBe(second.cities.jiangling.training - 10);
    // 友军自武陵出征，士气取自武陵（各据点士气独立）
    expect(next.units[ally.id].energy).toBe(second.cities.wuling.training - 10);
  });

  it('rejects a joint attack when no actionable ally is adjacent to the target', () => {
    const first = deployUnit(createGame('liu', 2), 'liu', {
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
    second.units.ally = second.units[ally.id];
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

    // 让友军本旬已行动，齐攻不再可用
    second.units[ally.id].acted = true;
    expect(jointAttackableUnits(second, attacker.id)).toHaveLength(0);
    expect(() => jointAttackUnit(second, 'liu', attacker.id, 'joint-target')).toThrow(/齐攻范围/);
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
    // 破城后主力直接进城接管：部队解散，其兵力全部并入城池
    expect(next.units[attacker.id]).toBeUndefined();
    expect(next.cities.xiangyang.troops).toBe(attacker.troops);
    expect(next.officers['guan-yu'].location).toEqual({ kind: 'city', cityId: 'xiangyang' });
    expect(next.officers['guan-yu'].acted).toBe(true);
  });

  it('lists enemy cities in attack range and lets siege attack from two cells away', () => {
    const game = createGame('liu', 1);
    game.cities['jiangling'].armaments = { ...initialArmaments(), ram: 5 };
    const deployed = deployUnit(game, 'liu', {
      cityId: 'jiangling',
      officerId: 'guan-yu',
      targetCityId: 'xiangyang',
      troopType: 'siege',
      siegeWeapon: 'ram',
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

  it('treats unowned garrison-less cities as attack targets while still allowing entering by movement', () => {
    const deployed = deployUnit(createGame('liu', 1), 'liu', {
      cityId: 'jiangling',
      officerId: 'guan-yu',
      targetCityId: 'xiangyang',
      troops: 6000,
      food: 6000,
    });
    const attacker = Object.values(deployed.units)[0];
    // 新剧本无主城无守军：既可攻击（打下来），也可直接进驻（兵不血刃）
    const target = deployed.cities.nanpi;
    expect(target.ownerId).toBeNull();
    expect(target.troops).toBe(0);
    const blockedKeys = cityKeys(deployed);
    const attackCell = sevenCellCityFootprint({ q: target.gridQ, r: target.gridR })
      .flatMap((coord) => neighborsOf(coord.q, coord.r))
      .find((coord) => !blockedKeys.has(gridKey(coord)))!;
    readyUnitAt(deployed, attacker.id, attackCell, 'sword');

    expect(attackableCities(deployed, attacker.id).map((city) => city.id)).toContain('nanpi');
    // 空城可直达进驻：城池格在可移动范围内
    const cityCell = sevenCellCityFootprint({ q: target.gridQ, r: target.gridR })[0];
    expect(movementCells(deployed, attacker.id).some((coord) => coord.q === cityCell.q && coord.r === cityCell.r)).toBe(true);

    // 攻击空城：守军本就是 0，按「守军或耐久任一归零即破城」一次即攻破。
    // 与进驻的区别只在结算：资源减半、耐久重置为 20%，部队同样整体进城（兵力/军粮/金钱与武将并入）。
    const unitTroops = deployed.units[attacker.id].troops;
    const carriedGold = attacker.gold ?? 0;
    const carriedFood = attacker.food;
    const attacked = attackCity(deployed, 'liu', attacker.id, 'nanpi');
    expect(attacked.cities.nanpi.ownerId).toBe('liu');
    expect(attacked.cities.nanpi.gold).toBe(Math.floor(target.gold / 2) + carriedGold);
    expect(attacked.cities.nanpi.food).toBe(Math.floor(target.food / 2) + carriedFood);
    expect(attacked.cities.nanpi.durability).toBe(Math.ceil(target.maxDurability * 0.2));
    expect(attacked.units[attacker.id]).toBeUndefined();
    expect(attacked.cities.nanpi.troops).toBe(unitTroops);
    expect(attacked.officers['guan-yu'].location).toEqual({ kind: 'city', cityId: 'nanpi' });
  });

  it('lets fire damage unowned garrison-less cities (immediate ignition and per-ten-day burn)', () => {
    const state = createGame('liu', 1);
    const target = state.cities.nanpi;
    expect(target.ownerId).toBeNull();
    const before = target.durability;

    // 点火即时伤害：目标格落在 7 格 footprint 内即掉耐久
    applyImmediateFireDamageToCityAndPlot(state, { q: target.gridQ, r: target.gridR });
    expect(state.cities.nanpi.durability).toBe(before - GROUND_FIRE_CITY_DURABILITY);

    // 每旬火焰结算：footprint 内着火格数 × 基础值
    state.firePlots = [{ q: target.gridQ, r: target.gridR, remainingTenDays: 3 }];
    applyGroundFireDamageToCities(state);
    expect(state.cities.nanpi.durability).toBe(before - GROUND_FIRE_CITY_DURABILITY * 2);
  });

  it('appoints the highest-politics resident officer as successor governor when the governor deploys', () => {
    const base = createGame('liu', 1);
    expect(base.cities.jiangling.governorId).toBe('liu-bei');

    const next = deployUnit(base, 'liu', {
      cityId: 'jiangling',
      officerId: 'liu-bei',
      targetCityId: 'xiangyang',
      troops: 3000,
      food: 3000,
    });

    // 刘备（太守）出征：留守江陵武将中孙乾政治75最高 → 自动接任太守
    expect(next.cities.jiangling.governorId).toBe('sun-qian');
    expect(next.officers['sun-qian'].location.kind).toBe('city');
  });

  it('occupies a garrison-less unowned city by moving into its footprint', () => {
    const deployed = deployUnit(createGame('liu', 1), 'liu', {
      cityId: 'jiangling',
      officerId: 'guan-yu',
      targetCityId: 'xiangyang',
      troops: 6000,
      food: 6000,
    });
    const attacker = Object.values(deployed.units)[0];
    const target = deployed.cities.nanpi;
    const blockedKeys = cityKeys(deployed);
    const attackCell = sevenCellCityFootprint({ q: target.gridQ, r: target.gridR })
      .flatMap((coord) => neighborsOf(coord.q, coord.r))
      .find((coord) => !blockedKeys.has(gridKey(coord)))!;
    readyUnitAt(deployed, attacker.id, attackCell, 'sword');
    const cityCell = sevenCellCityFootprint({ q: target.gridQ, r: target.gridR })[0];
    const prevGold = target.gold;
    const prevFood = target.food;

    const next = moveUnit(deployed, 'liu', attacker.id, cityCell);

    // 部队进入无主空城：兵不血刃占领，资源保留，兵力/武将并入，部队消失
    expect(next.cities.nanpi.ownerId).toBe('liu');
    expect(next.cities.nanpi.troops).toBe(6000);
    expect(next.cities.nanpi.gold).toBe(prevGold);
    expect(next.cities.nanpi.food).toBe(prevFood + 6000);
    expect(next.units[attacker.id]).toBeUndefined();
    expect(next.officers['guan-yu'].location.kind).toBe('city');
    expect(next.officers['guan-yu'].cityId).toBe('nanpi');
    expect(next.logs.some((log) => log.message.includes('进驻无主的南皮'))).toBe(true);
  });

  it('keeps the save valid after occupying an unowned city then summoning officers', () => {
    const deployed = deployUnit(createGame('liu', 1), 'liu', {
      cityId: 'jiangling',
      officerId: 'liu-bei',
      targetCityId: 'xiangyang',
      troops: 6000,
      food: 6000,
    });
    const attacker = Object.values(deployed.units)[0];
    const target = deployed.cities.nanpi;
    const blockedKeys = cityKeys(deployed);
    const attackCell = sevenCellCityFootprint({ q: target.gridQ, r: target.gridR })
      .flatMap((coord) => neighborsOf(coord.q, coord.r))
      .find((coord) => !blockedKeys.has(gridKey(coord)))!;
    readyUnitAt(deployed, attacker.id, attackCell, 'sword');
    const cityCell = sevenCellCityFootprint({ q: target.gridQ, r: target.gridR })[0];
    const occupied = moveUnit(deployed, 'liu', attacker.id, cityCell);
    expect(occupied.cities.nanpi.ownerId).toBe('liu');

    // 占领南皮后，从江陵召唤关羽与太守孙乾到南皮
    const next = executeCommand(occupied, 'liu', {
      type: 'summon', cityId: 'nanpi', officerIds: ['guan-yu', 'sun-qian'],
    });

    expect(isGameState(next)).toBe(true);

    // 再从武陵召唤张飞（武陵太守）与诸葛亮
    const next2 = executeCommand(next, 'liu', {
      type: 'summon', cityId: 'nanpi', officerIds: ['zhang-fei', 'zhuge-liang'],
    });
    expect(isGameState(next2)).toBe(true);
  });

  it('keeps the save valid after capturing an enemy city with defending officers', () => {
    const deployed = deployUnit(createGame('liu', 1), 'liu', {
      cityId: 'jiangling',
      officerId: 'guan-yu',
      targetCityId: 'lingling',
      troops: 7000,
      food: 7000,
    });
    const attacker = Object.values(deployed.units)[0];
    // 攻打刘表的零陵（城内有守将刘表），一击破城
    deployed.cities.lingling.troops = 1;
    const blockedKeys = cityKeys(deployed);
    const attackCell = sevenCellCityFootprint({ q: deployed.cities.lingling.gridQ, r: deployed.cities.lingling.gridR })
      .flatMap((coord) => neighborsOf(coord.q, coord.r))
      .find((coord) => !blockedKeys.has(gridKey(coord)))!;
    readyUnitAt(deployed, attacker.id, attackCell, 'siege');

    const next = attackCity(deployed, 'liu', attacker.id, 'lingling');

    expect(next.cities.lingling.ownerId).toBe('liu');
    // 守将刘表撤退：transfer 出发城为已易主的零陵（合法），cityId 归属撤退目的地桂阳
    const biao = next.officers['liu-biao'];
    if (biao.location.kind === 'transfer') {
      expect(biao.location.fromCityId).toBe('lingling');
      expect(biao.location.targetCityId).toBe('guiyang');
      expect(biao.cityId).toBe('guiyang');
    }
    // 存档校验必须通过（曾因撤退 transfer 出发城易主而拒绝写入存档）
    expect(isGameState(next)).toBe(true);
  });

  it('occupies an unowned city once its garrison is depleted', () => {
    const deployed = deployUnit(createGame('liu', 1), 'liu', {
      cityId: 'jiangling',
      officerId: 'guan-yu',
      targetCityId: 'xiangyang',
      troops: 6000,
      food: 6000,
    });
    const attacker = Object.values(deployed.units)[0];
    const target = deployed.cities.nanpi;
    const blockedKeys = cityKeys(deployed);
    const attackCell = sevenCellCityFootprint({ q: target.gridQ, r: target.gridR })
      .flatMap((coord) => neighborsOf(coord.q, coord.r))
      .find((coord) => !blockedKeys.has(gridKey(coord)))!;
    readyUnitAt(deployed, attacker.id, attackCell, 'sword');
    deployed.cities.nanpi.troops = 100;

    const next = attackCity(deployed, 'liu', attacker.id, 'nanpi');

    // 守军清零 → 无主城被刘备占领，主力直接进城接管
    expect(next.cities.nanpi.ownerId).toBe('liu');
    expect(next.cities.nanpi.governorId).toBeNull();
    expect(next.cities.nanpi.troops).toBeGreaterThan(0);
    expect(next.units[attacker.id]).toBeUndefined();
    expect(next.cities.nanpi.troops).toBe(deployed.units[attacker.id].troops);
    expect(next.cities.nanpi.durability).toBe(Math.ceil(next.cities.nanpi.maxDurability * 0.2));
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
    caster.stamina = 1;

    expect(strategyEnergyCostForUnit(state, caster.id, 'disturb')).toBe(1);
    const next = useUnitStrategy(state, 'liu', caster.id, 'disturb', { targetUnitId: 'strategy-skill-target' });
    expect(next.units[caster.id]).toMatchObject({ stamina: 0, acted: true });
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
    expect(next.units[caster.id]).toMatchObject({ stamina: 90, acted: true });
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

    expect(next.units[caster.id]).toMatchObject({ stamina: 100 - cost, acted: true });
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

    expect(next.units[caster.id]).toMatchObject({ stamina: 90, acted: true });
    expect(next.units[target.id].energy).toBe(60);
    expect(next.strategyResultReports).toEqual([expect.objectContaining({ succeeded: true })]);
    expect(next.rngCursor).toBe(state.rngCursor);
  });

  it.each([
    ['false-report', 'falseReportedTenDays', 2],
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
    expect(next.units[caster.id]).toMatchObject({ stamina: 85, acted: true });
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

describe('兵种相克在伤害结算中生效', () => {
  const S_APTITUDES = { spear: 'S', halberd: 'S', crossbow: 'S', cavalry: 'S', siege: 'C', navy: 'C' } as const;

  /**
   * 每个场景都把攻方攻击力与守方防御力对齐到同一个值（74），
   * 使统率修正恒为 1.0，从而让伤害差异**只**来自相克系数。
   * 统率一律低于 90，避免武将光环介入破坏对照。
   *
   * 攻方攻击力 = floor(统率 × 基础攻 / 100)：
   *   枪 95 → 统率 78；骑 105 → 统率 71。
   * 守方防御力 = floor(统率 × 基础防 / 100)：
   *   枪 85 → 统率 88；戟 105 → 统率 71；骑 95 → 统率 78。
   */
  function matchupState(input: {
    attackerTroop: TroopType;
    attackerLeadership: number;
    defenderTroop: TroopType;
    defenderLeadership: number;
    attackerSkill?: string;
    defenderSkill?: string;
  }) {
    const state = createGame('liu', 7);
    setUniformTerrain(state, 'plain');
    state.officers['guan-yu'].skill = input.attackerSkill ?? '无';
    state.officers['guan-yu'].stats.leadership = input.attackerLeadership;
    state.officers['guan-yu'].stats.war = 60;
    state.officers['guan-yu'].aptitudes = { ...S_APTITUDES };
    state.officers['guan-yu'].location = { kind: 'unit', unitId: 'matchup-attacker' };
    state.officers['cao-ren'].skill = input.defenderSkill ?? '无';
    state.officers['cao-ren'].stats.leadership = input.defenderLeadership;
    state.officers['cao-ren'].stats.war = 60;
    state.officers['cao-ren'].aptitudes = { ...S_APTITUDES };
    state.officers['cao-ren'].location = { kind: 'unit', unitId: 'matchup-target' };
    state.units = {
      'matchup-attacker': {
        id: 'matchup-attacker', kind: 'combat', forceId: 'liu', leaderId: 'guan-yu', officerIds: ['guan-yu'],
        homeCityId: 'jiangling', troopType: input.attackerTroop, q: 10, r: 10, troops: 10_000, food: 10_000,
        stamina: 100, energy: 100, movementRemaining: 20, moved: false, acted: false,
      },
      'matchup-target': {
        id: 'matchup-target', kind: 'combat', forceId: 'cao', leaderId: 'cao-ren', officerIds: ['cao-ren'],
        homeCityId: 'xiangyang', troopType: input.defenderTroop, q: 11, r: 10, troops: 10_000, food: 10_000,
        stamina: 100, energy: 100, movementRemaining: 20, moved: false, acted: false,
      },
    };
    return state;
  }

  function damageOf(input: Parameters<typeof matchupState>[0]) {
    const state = matchupState(input);
    return damageRoll(state, state.units['matchup-attacker'], 'plain', false, state.units['matchup-target']);
  }

  it('同一攻击力对同一防御力时，伤害比严格等于相克系数比', () => {
    // 三组 state 用同一个 seed，随机修正一致
    const baseline = damageOf({ attackerTroop: 'spear', attackerLeadership: 78, defenderTroop: 'spear', defenderLeadership: 88 });
    const vsHalberd = damageOf({ attackerTroop: 'spear', attackerLeadership: 78, defenderTroop: 'halberd', defenderLeadership: 71 });
    const vsCavalry = damageOf({ attackerTroop: 'spear', attackerLeadership: 78, defenderTroop: 'cavalry', defenderLeadership: 78 });

    expect(baseline).toBeGreaterThan(0);
    expect(vsHalberd / baseline).toBeCloseTo(0.85, 2);
    expect(vsCavalry / baseline).toBeCloseTo(1.15, 2);
  });

  it('骑兵侧：对骑 1.0、对枪与对戟 1.10、对弩 1.20', () => {
    // 攻方固定为骑兵、统率 63 → 攻击力 floor(63 × 1.05) = 66，
    // attackScore 与统率修正对四组完全一致，差异只来自守方兵种的相克系数。
    // 守方统率按各自基础防御回推，使防御力同样落在 66：
    //   骑 95 → 70；枪 85 → 78；戟 105 → 63；弩 75 → 88（全部低于 90，不触发光环）。
    const attacker = { attackerTroop: 'cavalry' as TroopType, attackerLeadership: 63 };
    const baseline = damageOf({ ...attacker, defenderTroop: 'cavalry', defenderLeadership: 70 });
    const vsSpear = damageOf({ ...attacker, defenderTroop: 'spear', defenderLeadership: 78 });
    const vsHalberd = damageOf({ ...attacker, defenderTroop: 'halberd', defenderLeadership: 63 });
    const vsCrossbow = damageOf({ ...attacker, defenderTroop: 'crossbow', defenderLeadership: 88 });

    expect(baseline).toBeGreaterThan(0);
    expect(vsSpear / baseline).toBeCloseTo(1.1, 2);
    expect(vsHalberd / baseline).toBeCloseTo(1.1, 2);
    expect(vsCrossbow / baseline).toBeCloseTo(1.2, 2);
  });

  it('「布阵」规避不利相克，但保留有利加成', () => {
    // 枪打戟 0.85：攻方吃亏 → 攻方带布阵则归 1.0
    const spearVsHalberd = {
      attackerTroop: 'spear' as TroopType, attackerLeadership: 78,
      defenderTroop: 'halberd' as TroopType, defenderLeadership: 71,
    };
    expect(damageOf({ ...spearVsHalberd, attackerSkill: '布阵' }) / damageOf(spearVsHalberd))
      .toBeCloseTo(1 / 0.85, 2);

    // 枪打骑 1.15：守方吃亏 → 守方带布阵则归 1.0
    const spearVsCavalry = {
      attackerTroop: 'spear' as TroopType, attackerLeadership: 78,
      defenderTroop: 'cavalry' as TroopType, defenderLeadership: 78,
    };
    expect(damageOf({ ...spearVsCavalry, defenderSkill: '布阵' }) / damageOf(spearVsCavalry))
      .toBeCloseTo(1 / 1.15, 2);

    // 骑打枪 1.10：攻方占优 → 带布阵不改变任何东西（有利加成保留）
    const cavalryVsSpear = {
      attackerTroop: 'cavalry' as TroopType, attackerLeadership: 63,
      defenderTroop: 'spear' as TroopType, defenderLeadership: 78,
    };
    expect(damageOf({ ...cavalryVsSpear, attackerSkill: '布阵' })).toBe(damageOf(cavalryVsSpear));
  });

  it('「布阵」使目标完全免疫战法暴击', () => {
    const withoutSkill = matchupState({
      attackerTroop: 'spear', attackerLeadership: 78, defenderTroop: 'spear', defenderLeadership: 88,
    });
    expect(tacticCriticalMode(
      withoutSkill, withoutSkill.units['matchup-attacker'], withoutSkill.units['matchup-target'], 'spear-thrust',
    )).not.toBe('none');

    const withSkill = matchupState({
      attackerTroop: 'spear', attackerLeadership: 78, defenderTroop: 'spear', defenderLeadership: 88,
      defenderSkill: '布阵',
    });
    expect(tacticCriticalMode(
      withSkill, withSkill.units['matchup-attacker'], withSkill.units['matchup-target'], 'spear-thrust',
    )).toBe('none');
  });
});

describe('基础伤害不含攻击方武力，精造加在基础攻防上', () => {
  const S_APTITUDES = { spear: 'S', halberd: 'S', crossbow: 'S', cavalry: 'S', siege: 'C', navy: 'C' } as const;

  /** 攻方枪兵统率 78（攻击力 floor(78×1.0×95/100)=74），守方枪兵统率 88（防御力同样 74）→ 统率修正恒为 1.0 */
  function duelState(mutate?: (state: ReturnType<typeof createGame>) => void) {
    const state = createGame('liu', 7);
    setUniformTerrain(state, 'plain');
    for (const [id, leadership] of [['guan-yu', 78], ['cao-ren', 88]] as const) {
      const officer = state.officers[id];
      officer.stats.leadership = leadership;
      officer.stats.war = 60;
      officer.aptitudes = { ...S_APTITUDES };
      officer.location = { kind: 'unit', unitId: id === 'guan-yu' ? 'duel-attacker' : 'duel-target' };
    }
    state.units = {
      'duel-attacker': {
        id: 'duel-attacker', kind: 'combat', forceId: 'liu', leaderId: 'guan-yu', officerIds: ['guan-yu'],
        homeCityId: 'jiangling', troopType: 'spear', q: 10, r: 10, troops: 10_000, food: 10_000,
        stamina: 100, energy: 100, movementRemaining: 20, moved: false, acted: false,
      },
      'duel-target': {
        id: 'duel-target', kind: 'combat', forceId: 'cao', leaderId: 'cao-ren', officerIds: ['cao-ren'],
        homeCityId: 'xiangyang', troopType: 'spear', q: 11, r: 10, troops: 10_000, food: 10_000,
        stamina: 100, energy: 100, movementRemaining: 20, moved: false, acted: false,
      },
    };
    mutate?.(state);
    return state;
  }

  const damageOf = (mutate?: Parameters<typeof duelState>[0]) => {
    const state = duelState(mutate);
    return damageRoll(state, state.units['duel-attacker'], 'plain', false, state.units['duel-target']);
  };

  it('攻击方武力高低不改变普攻伤害', () => {
    const low = damageOf((state) => { state.officers['guan-yu'].stats.war = 1; });
    const high = damageOf((state) => { state.officers['guan-yu'].stats.war = 100; });

    expect(low).toBeGreaterThan(0);
    // 旧公式里武力走 war/3000，100 与 1 之间会让伤害差出 3% 以上
    expect(high).toBe(low);
  });

  it('守方武力高低同样不改变所受伤害', () => {
    const low = damageOf((state) => { state.officers['cao-ren'].stats.war = 1; });
    const high = damageOf((state) => { state.officers['cao-ren'].stats.war = 100; });
    expect(high).toBe(low);
  });

  it('武器精造把 +10 加在基础攻击上（研究后攻击力上升、伤害上升）', () => {
    const plain = duelState();
    const ratingBefore = unitCombatRating(plain, plain.units['duel-attacker']).attack;
    const withTech = duelState((state) => { state.forces.liu.techNodes = ['wuqijingzao']; });
    const ratingAfter = unitCombatRating(withTech, withTech.units['duel-attacker']).attack;

    // 攻击力 = floor(78 × 1.0 × (95 + 10) / 100) = 81，研究前 floor(78 × 95 / 100) = 74
    expect(ratingBefore).toBe(74);
    expect(ratingAfter).toBe(81);
    expect(ratingAfter - ratingBefore).toBe(7);

    const before = damageOf();
    const after = damageOf((state) => { state.forces.liu.techNodes = ['wuqijingzao']; });
    // 攻击力 74 → 81，守方防御力仍为 74，统率修正 1.0 → 1.028
    expect(after / before).toBeCloseTo(1 + 7 / 250, 2);
  });

  it('防具精造把 +10 加在基础防御上（研究后防御力上升、伤害下降）', () => {
    const plain = duelState();
    const ratingBefore = unitCombatRating(plain, plain.units['duel-target']).defense;
    const withTech = duelState((state) => { state.forces.cao.techNodes = ['fangjujingzao']; });
    const ratingAfter = unitCombatRating(withTech, withTech.units['duel-target']).defense;

    // 防御力 = floor(88 × 1.0 × (85 + 10) / 100) = 83，研究前 floor(88 × 85 / 100) = 74
    expect(ratingBefore).toBe(74);
    expect(ratingAfter).toBe(83);

    const before = damageOf();
    const after = damageOf((state) => { state.forces.cao.techNodes = ['fangjujingzao']; });
    expect(after / before).toBeCloseTo(1 - 9 / 250, 2);
  });
});
