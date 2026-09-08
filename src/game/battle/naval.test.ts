import { describe, expect, it } from 'vitest';
import { initialArmaments } from '../armaments';
import { movementCells } from './movementRules';
import { attackUnit, attackableUnits, deployUnit, unitCanUseTactic, unitTactics, useUnitTactic } from './actions';
import { damageRoll } from './legacyCore';
import { nextRandom } from '../random';
import { createGame } from '../scenario/jingxiang208';
import { createMobileDuelGame } from '../scenario/mobileDuel';
import { movementAllowanceBonus, unitIgnoresEnemyZocTerrain } from '../skills';
import { rollNoCounterAttack } from '../skills/rules/combat';
import { settleTenDay } from '../turn';
import type { AptitudeGrade, ArmyUnit, GameState, TroopType } from '../types';

function setUniformTerrain(state: GameState, terrain: GameState['grid'][number]['terrain']) {
  for (const cell of state.grid) cell.terrain = terrain;
}

function readyUnitAt(
  state: GameState,
  unitId: string,
  coord: { q: number; r: number },
  troopType: TroopType = 'sword',
  vehicle?: 'boat' | 'ship',
) {
  const movementByTroop = { sword: 22, spear: 22, halberd: 20, crossbow: 19, cavalry: 30, siege: 16 };
  state.units[unitId].q = coord.q;
  state.units[unitId].r = coord.r;
  state.units[unitId].troopType = troopType;
  state.units[unitId].vehicle = vehicle;
  state.units[unitId].moved = false;
  state.units[unitId].acted = false;
  state.units[unitId].movementRemaining = movementByTroop[troopType];
}

function addEnemyUnit(state: GameState, id: string, coord: { q: number; r: number }, troops = 10_000) {
  state.units[id] = {
    id,
    kind: 'combat',
    forceId: 'cao',
    leaderId: 'cao-ren',
    homeCityId: 'xiangyang',
    troopType: 'sword',
    vehicle: 'boat',
    q: coord.q,
    r: coord.r,
    troops,
    food: 6000,
    energy: 100,
    movementRemaining: 20,
    moved: false,
    acted: false,
  };
  state.officers['cao-ren'].location = { kind: 'unit', unitId: id };
}

function boatState(seed = 1) {
  const game = createGame('liu', seed);
  game.cities['jiangling'].armaments = { ...initialArmaments(), ship: 5000 };
  return deployUnit(game, 'liu', {
    cityId: 'jiangling',
    officerId: 'guan-yu',
    troops: 4000,
    food: 5000,
  });
}

function shipState(seed = 1) {
  const game = createGame('liu', seed);
  game.cities['jiangling'].armaments = { ...initialArmaments(), ship: 5000 };
  return deployUnit(game, 'liu', {
    cityId: 'jiangling',
    officerId: 'guan-yu',
    vehicle: 'ship',
    troops: 4000,
    food: 5000,
  });
}

function waterTacticState(grade: AptitudeGrade, seed = 1, troops = 10_000) {
  const state = boatState(seed);
  setUniformTerrain(state, 'water');
  const attacker = Object.values(state.units)[0];
  readyUnitAt(state, attacker.id, { q: 10, r: 10 }, 'spear', 'boat');
  state.units[attacker.id].stamina = 100;
  state.officers['guan-yu'].skill = '无';
  state.officers['guan-yu'].aptitudes!.navy = grade;
  state.officers['cao-ren'].stats.leadership = state.officers['guan-yu'].stats.leadership;
  addEnemyUnit(state, 'enemy-tactic', { q: 11, r: 10 }, troops);
  return { state, attacker, target: state.units['enemy-tactic'] };
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

describe('vehicle deployment', () => {
  it('deploys with the boat vehicle by default', () => {
    const state = boatState(1);
    const unit = Object.values(state.units)[0];

    expect(unit).toBeDefined();
    expect(unit.troopType).toBe('sword');
    expect(unit.vehicle).toBe('boat');
    expect(state.cities['jiangling'].armaments?.ship).toBe(5000);
  });

  it('deploys a ship vehicle and consumes one ship armament', () => {
    const state = shipState(1);
    const unit = Object.values(state.units)[0];

    expect(unit.vehicle).toBe('ship');
    expect(state.cities['jiangling'].armaments?.ship).toBe(4999);
  });

  it('consumes one ship armament per deployed ship formation', () => {
    const game = createGame('liu', 1);
    game.cities['jiangling'].armaments = { ...initialArmaments(), ship: 2 };
    const first = deployUnit(game, 'liu', {
      cityId: 'jiangling',
      officerId: 'guan-yu',
      vehicle: 'ship',
      troops: 4000,
      food: 5000,
    });
    expect(first.cities['jiangling'].armaments?.ship).toBe(1);

    const second = deployUnit(first, 'liu', {
      cityId: 'jiangling',
      officerId: 'chen-dao',
      vehicle: 'ship',
      troops: 4000,
      food: 5000,
    });
    expect(second.cities['jiangling'].armaments?.ship).toBe(0);
  });

  it('rejects a ship vehicle without ship armaments', () => {
    const state = createGame('liu', 1);

    expect(() => deployUnit(state, 'liu', {
      cityId: 'jiangling',
      officerId: 'guan-yu',
      vehicle: 'ship',
      troops: 4000,
      food: 5000,
    })).toThrow(/楼船兵装不足/);
  });

  it('clears stale city effect reports when deploying', () => {
    const game = createGame('liu', 1);
    game.cityEffectReports = [{
      id: 'effect-1', cityId: 'jiangling', q: 1, r: 1, amount: 2, label: '冲车', kind: 'armament',
    }];

    const next = deployUnit(game, 'liu', {
      cityId: 'jiangling',
      officerId: 'guan-yu',
      troops: 4000,
      food: 6000,
    });

    expect(next.cityEffectReports).toEqual([]);
  });

  it('lets ship vehicles fight stronger on water and take less damage', () => {
    const boatAttack = waterTacticState('S', 1);
    const boatHit = damageRoll(boatAttack.state, boatAttack.attacker, 'water', false, boatAttack.target);

    const shipAttack = waterTacticState('S', 2);
    shipAttack.state.units[shipAttack.attacker.id].vehicle = 'ship';
    const shipHit = damageRoll(shipAttack.state, shipAttack.attacker, 'water', false, shipAttack.target);
    expect(shipHit).toBeGreaterThan(boatHit);

    const boatDefense = waterTacticState('S', 3);
    const boatTaken = damageRoll(boatDefense.state, boatDefense.attacker, 'water', false, boatDefense.target);

    const shipDefense = waterTacticState('S', 4);
    shipDefense.state.units[shipDefense.target.id].vehicle = 'ship';
    const shipTaken = damageRoll(shipDefense.state, shipDefense.attacker, 'water', false, shipDefense.target);
    expect(shipTaken).toBeLessThan(boatTaken);
  });

  it('lets water formations attack enemies two cells away with bows', () => {
    const state = boatState(1);
    setUniformTerrain(state, 'water');
    const attacker = Object.values(state.units)[0];
    readyUnitAt(state, attacker.id, { q: 10, r: 10 }, 'sword', 'boat');
    state.officers['guan-yu'].skill = '无';
    addEnemyUnit(state, 'enemy-near', { q: 11, r: 10 });
    addEnemyUnit(state, 'enemy-far', { q: 12, r: 10 });

    const targets = attackableUnits(state, attacker.id);
    expect(targets.map((unit) => unit.id)).toEqual(['enemy-near', 'enemy-far']);

    const next = attackUnit(state, 'liu', attacker.id, 'enemy-far');

    expect(next.units['enemy-far'].troops).toBeLessThan(10_000);
    expect(next.battleDamageReports?.some((report) => report.kind === 'counter')).toBe(false);
  });

  it('keeps land formations at melee range', () => {
    const state = boatState(1);
    setUniformTerrain(state, 'plain');
    const attacker = Object.values(state.units)[0];
    readyUnitAt(state, attacker.id, { q: 10, r: 10 }, 'sword', 'boat');
    state.officers['guan-yu'].skill = '无';
    addEnemyUnit(state, 'enemy-far', { q: 12, r: 10 });

    expect(attackableUnits(state, attacker.id).map((unit) => unit.id)).toEqual([]);
    expect(() => attackUnit(state, 'liu', attacker.id, 'enemy-far')).toThrow(/攻击范围/);
  });
});

describe('siege weapon deployment', () => {
  it('rejects siege deployment without weapon stock', () => {
    const state = createGame('liu', 1);

    expect(() => deployUnit(state, 'liu', {
      cityId: 'jiangling',
      officerId: 'guan-yu',
      troopType: 'siege',
      siegeWeapon: 'ram',
      troops: 4000,
      food: 6000,
    })).toThrow(/冲车不足/);
    expect(() => deployUnit(state, 'liu', {
      cityId: 'jiangling',
      officerId: 'guan-yu',
      troopType: 'siege',
      troops: 4000,
      food: 6000,
    })).toThrow(/需要选择冲车或井阑/);
  });

  it('records the chosen siege weapon on the deployed unit', () => {
    const game = createGame('liu', 1);
    game.cities['jiangling'].armaments = { ...initialArmaments(), ram: 5, tower: 5 };

    const ramDeployed = deployUnit(game, 'liu', {
      cityId: 'jiangling',
      officerId: 'guan-yu',
      troopType: 'siege',
      siegeWeapon: 'ram',
      troops: 4000,
      food: 6000,
    });
    expect(Object.values(ramDeployed.units)[0].siegeWeapon).toBe('ram');

    const towerDeployed = deployUnit(ramDeployed, 'liu', {
      cityId: 'jiangling',
      officerId: 'chen-dao',
      troopType: 'siege',
      siegeWeapon: 'tower',
      troops: 4000,
      food: 6000,
    });
    const towerUnit = Object.values(towerDeployed.units).find((unit) => unit.leaderId === 'chen-dao');
    expect(towerUnit?.siegeWeapon).toBe('tower');
  });

  it('consumes one siege weapon per deployed siege formation', () => {
    const game = createGame('liu', 1);
    game.cities['jiangling'].armaments = { ...initialArmaments(), ram: 3 };

    const first = deployUnit(game, 'liu', {
      cityId: 'jiangling',
      officerId: 'guan-yu',
      troopType: 'siege',
      siegeWeapon: 'ram',
      troops: 4000,
      food: 6000,
    });
    expect(first.cities['jiangling'].armaments?.ram).toBe(2);

    const second = deployUnit(first, 'liu', {
      cityId: 'jiangling',
      officerId: 'chen-dao',
      troopType: 'siege',
      siegeWeapon: 'ram',
      troops: 4000,
      food: 6000,
    });
    expect(second.cities['jiangling'].armaments?.ram).toBe(1);
  });
});

describe('water and ferry movement', () => {
  function duelUnit(state: GameState, id: string, coord: { q: number; r: number }, movementRemaining = 30) {
    state.units[id] = {
      id, kind: 'combat', forceId: 'liu', leaderId: 'zhang-fei', officerIds: ['zhang-fei'],
      homeCityId: 'jiangling', troopType: 'sword', vehicle: 'boat', q: coord.q, r: coord.r,
      troops: 2000, food: 2000, energy: 100, movementRemaining, moved: false, acted: false,
    };
    state.officers['zhang-fei'].location = { kind: 'unit', unitId: id };
  }

  it('stops formations so they cannot cross water in one turn from land', () => {
    const state = createMobileDuelGame('liu', 'cao', 7);
    duelUnit(state, 'land', { q: 3, r: 11 });

    const cells = movementCells(state, 'land');

    expect(cells.some((cell) => cell.q === 3 && cell.r === 12)).toBe(true);
    expect(cells.some((cell) => cell.q === 3 && cell.r === 13)).toBe(false);
  });

  it('lets formations enter water directly through a ferry', () => {
    const state = createMobileDuelGame('liu', 'cao', 7);
    duelUnit(state, 'land', { q: 8, r: 11 });

    const cells = movementCells(state, 'land');

    expect(cells.some((cell) => cell.q === 8 && cell.r === 12)).toBe(true);
    expect(cells.some((cell) => cell.q === 8 && cell.r === 13)).toBe(true);
  });

  it('lets water formations land through a ferry but stop on the water-adjacent land', () => {
    const state = createMobileDuelGame('liu', 'cao', 7);
    duelUnit(state, 'water-ferry', { q: 8, r: 14 });

    const ferryCells = movementCells(state, 'water-ferry');
    expect(ferryCells.some((cell) => cell.q === 8 && cell.r === 12)).toBe(true);
    expect(ferryCells.some((cell) => cell.q === 8 && cell.r === 11)).toBe(true);

    duelUnit(state, 'water-plain', { q: 3, r: 14 });
    const plainCells = movementCells(state, 'water-plain');
    expect(plainCells.some((cell) => cell.q === 3 && cell.r === 12)).toBe(true);
    // 出水需先停留在水中相接的边界格(r12)，本回合不能登岸，下一回合才能出水
    expect(plainCells.some((cell) => cell.q === 3 && cell.r === 11)).toBe(false);
    expect(plainCells.some((cell) => cell.q === 3 && cell.r === 10)).toBe(false);
  });

  it('lets formations entering water via a ferry keep moving across the river', () => {
    const state = createMobileDuelGame('liu', 'cao', 7);
    duelUnit(state, 'ferry-entry', { q: 8, r: 11 }, 30);

    const cells = movementCells(state, 'ferry-entry');

    expect(cells.some((cell) => cell.q === 8 && cell.r === 13)).toBe(true);
    expect(cells.some((cell) => cell.q === 8 && cell.r === 14)).toBe(true);
    expect(cells.some((cell) => cell.q === 8 && cell.r === 17)).toBe(false);
  });

  it('ends movement on the first water cell entered away from a ferry, requiring the unit to start on the boundary', () => {
    const state = createMobileDuelGame('liu', 'cao', 7);
    state.grid = state.grid.map((cell) => (cell.q === 3 && cell.r === 12 ? { ...cell, terrain: 'plain' } : cell));
    // 部队已在陆地边界格 r12 停留一回合，本回合从这里出发才能跨越一步入水
    duelUnit(state, 'plain-entry', { q: 3, r: 12 }, 30);

    const cells = movementCells(state, 'plain-entry');

    // 从边界格出发可以把入水格 r13 作为终点（消耗全部行动力），但不能越过 r13 继续深入
    expect(cells.some((cell) => cell.q === 3 && cell.r === 13)).toBe(true);
    expect(cells.some((cell) => cell.q === 3 && cell.r === 14)).toBe(false);
  });

  it('does not cross into water mid-turn; the unit must first stop on the land boundary cell', () => {
    const state = createMobileDuelGame('liu', 'cao', 7);
    state.grid = state.grid.map((cell) => (cell.q === 3 && cell.r === 12 ? { ...cell, terrain: 'plain' } : cell));
    duelUnit(state, 'plain-approach', { q: 3, r: 10 }, 30);

    const cells = movementCells(state, 'plain-approach');

    // 本回合最多到达陆地边界格 r12，不能同回合越界入水 r13
    expect(cells.some((cell) => cell.q === 3 && cell.r === 12)).toBe(true);
    expect(cells.some((cell) => cell.q === 3 && cell.r === 13)).toBe(false);
  });
});

describe('water movement', () => {
  it('lets every troop type move across deep water', () => {
    for (const troopType of ['sword', 'spear', 'halberd', 'crossbow', 'cavalry', 'siege'] as const) {
      const state = createGame('liu', 1);
      setUniformTerrain(state, 'water');
      state.units.test = {
        id: 'test', kind: 'combat', forceId: 'liu', leaderId: 'guan-yu', officerIds: ['guan-yu'],
        homeCityId: 'jiangling', troopType, vehicle: 'boat', q: 10, r: 10, troops: 4000, food: 4000,
        energy: 100, movementRemaining: 30, moved: false, acted: false,
      };

      expect(movementCells(state, 'test').length).toBeGreaterThan(0);
    }
  });

  it('lets the ship vehicle cover more water than the boat vehicle', () => {
    const boat = boatState(1);
    setUniformTerrain(boat, 'water');
    const boatUnit = Object.values(boat.units)[0];
    readyUnitAt(boat, boatUnit.id, { q: 10, r: 10 }, 'sword', 'boat');

    const ship = shipState(2);
    setUniformTerrain(ship, 'water');
    const shipUnit = Object.values(ship.units)[0];
    readyUnitAt(ship, shipUnit.id, { q: 10, r: 10 }, 'sword', 'ship');

    expect(movementCells(ship, shipUnit.id).length).toBeGreaterThan(movementCells(boat, boatUnit.id).length);
  });
});

describe('naval tactics for any formation on water', () => {
  it('unlocks naval tactics by navy aptitude tier while on water', () => {
    const bState = waterTacticState('B');
    expect(useUnitTactic(bState.state, 'liu', bState.attacker.id, bState.target.id, 'ship-ram')).toBeTruthy();

    const cState = waterTacticState('C');
    expect(() => useUnitTactic(cState.state, 'liu', cState.attacker.id, cState.target.id, 'ship-ram'))
      .toThrow(/需要水军适性/);
  });

  it('keeps naval tactics unavailable on land', () => {
    const { state, attacker, target } = waterTacticState('S');
    setUniformTerrain(state, 'plain');

    expect(() => useUnitTactic(state, 'liu', attacker.id, target.id, 'ship-ram'))
      .toThrow(/不在水域/);
  });

  it('replaces land troop tactics with naval tactics while on water', () => {
    const { state, attacker, target } = waterTacticState('S');
    expect(unitTactics(state, attacker.id).map((tactic) => tactic.name)).toEqual(['冲角', '火箭', '回旋']);

    expect(() => useUnitTactic(state, 'liu', attacker.id, target.id, 'spear-thrust'))
      .toThrow(/水域中不能使用陆地战法/);
    expect(unitCanUseTactic(state, attacker.id, 'spear-thrust')).toBe(false);

    setUniformTerrain(state, 'plain');
    expect(unitTactics(state, attacker.id).map((tactic) => tactic.name)).toEqual(['突刺', '螺旋突刺', '二段突刺']);
  });

  it('pushes the target back with 冲角', () => {
    const { state, attacker, target } = waterTacticState('S');
    const before = { q: target.q, r: target.r };

    const next = useUnitTactic(state, 'liu', attacker.id, target.id, 'ship-ram');

    expect(next.units[attacker.id].stamina).toBe(100 - 15);
    const moved = next.units['enemy-tactic'];
    expect(moved).toBeDefined();
    expect({ q: moved.q, r: moved.r }).not.toEqual(before);
  });

  it('sets the target on fire with 火箭', () => {
    const { state, attacker } = waterTacticState('S');
    addEnemyUnit(state, 'enemy-arrow', { q: 12, r: 10 });

    const next = useUnitTactic(state, 'liu', attacker.id, 'enemy-arrow', 'ship-fire');

    expect(next.units[attacker.id].stamina).toBe(100 - 20);
    expect(next.units['enemy-arrow'].burningTenDays).toBe(2);
    expect(next.firePlots ?? []).toHaveLength(0);
    expect(next.units['enemy-arrow'].troops).toBeLessThan(10_000);
  });

  it('burns a burning unit every ten-day settlement until the fire goes out', () => {
    const state = boatState(1);
    setUniformTerrain(state, 'water');
    const unit = Object.values(state.units)[0];
    readyUnitAt(state, unit.id, { q: 10, r: 10 }, 'sword', 'boat');
    state.officers['guan-yu'].skill = '无';
    state.units[unit.id].troops = 10_000;
    state.units[unit.id].burningTenDays = 2;
    state.units[unit.id].food = 50_000;

    const first = settleTenDay(state);
    const firstUnit = first.units[unit.id];
    expect(firstUnit.burningTenDays).toBe(1);
    expect(firstUnit.troops).toBeLessThan(10_000);

    const second = settleTenDay(first);
    const secondUnit = second.units[unit.id];
    expect(secondUnit.burningTenDays).toBeUndefined();
    expect(secondUnit.troops).toBeLessThan(firstUnit.troops);
  });

  it('hits adjacent enemies with 回旋', () => {
    const { state, attacker, target } = waterTacticState('S');
    addEnemyUnit(state, 'enemy-adjacent', { q: 12, r: 11 });

    const next = useUnitTactic(state, 'liu', attacker.id, target.id, 'ship-whirl');

    expect(next.units['enemy-tactic'].troops).toBeLessThan(10_000);
    expect(next.units['enemy-adjacent'].troops).toBeLessThan(10_000);
    expect(next.units[attacker.id].stamina).toBe(100 - 30);
  });
});

describe('naval officer skills', () => {
  it('grants 操舵 water movement only on water cells', () => {
    const state = shipState(1);
    const unit = Object.values(state.units)[0] as ArmyUnit;
    state.officers['guan-yu'].skill = '操舵';

    expect(movementAllowanceBonus(state, unit, 'water')).toBe(6);
    expect(movementAllowanceBonus(state, unit, 'water')).toBe(6);
    expect(movementAllowanceBonus(state, unit, 'plain')).toBe(0);
  });

  it('restores 操舵 water movement after a ten-day settlement on water', () => {
    const state = shipState(1);
    setUniformTerrain(state, 'water');
    const unit = Object.values(state.units)[0];
    readyUnitAt(state, unit.id, { q: 10, r: 10 }, 'sword', 'ship');
    state.officers['guan-yu'].skill = '操舵';
    state.units[unit.id].movementRemaining = 0;

    const next = settleTenDay(state);

    expect(next.units[unit.id].movementRemaining).toBe(22 + 6);
  });

  it('lets 推进 ignore enemy zoc only on water', () => {
    const state = shipState(1);
    const unit = Object.values(state.units)[0] as ArmyUnit;
    state.officers['guan-yu'].skill = '推进';

    expect(unitIgnoresEnemyZocTerrain(state, unit)).toBe('water');
  });

  it('lets 水神 guarantee naval tactic criticals on any formation', () => {
    const { state, attacker, target } = waterTacticState('S');
    state.officers['guan-yu'].skill = '水神';

    const next = useUnitTactic(state, 'liu', attacker.id, target.id, 'ship-ram');

    expect(next.battleDamageReports?.find((entry) => entry.unitId === target.id)?.critical).toBe(true);
  });

  it('lets 水将 guarantee naval tactic criticals only against lower war targets', () => {
    const { state, attacker } = waterTacticState('S', 1);
    state.officers['guan-yu'].skill = '水将';
    state.officers['cao-ren'].stats.war = 60;

    const next = useUnitTactic(state, 'liu', attacker.id, 'enemy-tactic', 'ship-ram');

    expect(next.battleDamageReports?.find((entry) => entry.unitId === 'enemy-tactic')?.critical).toBe(true);
  });

  it('lets 强袭 avoid the enemy counter attack on water', () => {
    const seed = seedForTwoRolls(() => true, (value) => value < 0.5);
    const state = shipState(seed);
    setUniformTerrain(state, 'water');
    const attacker = Object.values(state.units)[0];
    readyUnitAt(state, attacker.id, { q: 10, r: 10 }, 'sword', 'ship');
    state.officers['guan-yu'].skill = '强袭';
    addEnemyUnit(state, 'enemy-attack', { q: 11, r: 10 });

    const next = attackUnit(state, 'liu', attacker.id, 'enemy-attack');

    expect(next.battleDamageReports?.some((entry) => entry.kind === 'counter')).toBe(false);
  });

  it('does not trigger 强袭 on land', () => {
    const state = shipState(1);
    setUniformTerrain(state, 'plain');
    const attacker = Object.values(state.units)[0];
    state.officers['guan-yu'].skill = '强袭';

    expect(rollNoCounterAttack(state, attacker, 'plain')).toBe(false);
  });
});

describe('mobile duel river', () => {
  it('lets any formation move across the seven-row middle river', () => {
    const state = createMobileDuelGame('liu', 'cao', 7);

    state.units.ship = {
      id: 'ship', kind: 'combat', forceId: 'liu', leaderId: 'zhang-fei', officerIds: ['zhang-fei'],
      homeCityId: 'jiangling', troopType: 'sword', vehicle: 'ship', q: 0, r: 16, troops: 2000, food: 2000,
      energy: 100, movementRemaining: 22, moved: false, acted: false,
    };
    state.officers['zhang-fei'].location = { kind: 'unit', unitId: 'ship' };
    const shipCells = movementCells(state, 'ship');
    expect(shipCells.some((cell) => cell.q === 0 && (cell.r === 15 || cell.r === 17))).toBe(true);

    state.units.infantry = {
      id: 'infantry', kind: 'combat', forceId: 'liu', leaderId: 'guan-yu', officerIds: ['guan-yu'],
      homeCityId: 'jiangling', troopType: 'sword', vehicle: 'boat', q: 3, r: 15, troops: 2000, food: 2000,
      energy: 100, movementRemaining: 22, moved: false, acted: false,
    };
    state.officers['guan-yu'].location = { kind: 'unit', unitId: 'infantry' };
    const infantryCells = movementCells(state, 'infantry');
    expect(infantryCells.some((cell) => cell.q === 3 && cell.r === 16)).toBe(true);

    state.units.bridge = {
      id: 'bridge', kind: 'combat', forceId: 'liu', leaderId: 'chen-dao', officerIds: ['chen-dao'],
      homeCityId: 'jiangling', troopType: 'sword', vehicle: 'boat', q: 8, r: 15, troops: 2000, food: 2000,
      energy: 100, movementRemaining: 22, moved: false, acted: false,
    };
    state.officers['chen-dao'].location = { kind: 'unit', unitId: 'bridge' };
    const bridgeCells = movementCells(state, 'bridge');
    expect(bridgeCells.some((cell) => cell.q === 8 && cell.r === 16)).toBe(true);
  });
});
