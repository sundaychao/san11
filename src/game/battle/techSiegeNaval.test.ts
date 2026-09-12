import { describe, expect, it } from 'vitest';
import {
  ARMAMENT_LABELS,
  armamentLabelFor,
  initialArmaments,
  isBattleShip,
  siegeWeaponKindOf,
  TROOP_MOVEMENT,
  unitArmamentLabel,
  unitHasCatapultAttack,
  vehicleLabelFor,
} from '../armaments';
import { createGame } from '../scenario/jingxiang208';
import type { ArmyUnit, GameState, TechNodeId } from '../types';
import { attackCity, attackFacility, attackPass, attackPlot, attackUnit, deployUnit } from './actions';
import { battleShipMovementBonus } from './catalog';
import { neighborsOf } from './grid';
import { damageRoll } from './shared';
import {
  attackableCities,
  attackableFacilities,
  attackableUnits,
  jointAttackableUnits,
  unitAttackRange,
} from './targetRules';

/**
 * 器械/舰船科技（理工系 机械→弹道→霹雳、航行系 造船术）在单位侧的落地：
 * 木兽、投石车、斗舰的判定与数值，以及霹雳溅射的接线。
 */

function setUniformTerrain(state: GameState, terrain: GameState['grid'][number]['terrain']) {
  for (const cell of state.grid) cell.terrain = terrain;
}

/** 平地测试场景：地形全平，避免地形防御/水域射程干扰 */
function plainState(techNodes: TechNodeId[] = []) {
  const state = createGame('liu', 1);
  setUniformTerrain(state, 'plain');
  state.forces.liu.techNodes = techNodes;
  return state;
}

function waterState(techNodes: TechNodeId[] = []) {
  const state = createGame('liu', 1);
  setUniformTerrain(state, 'water');
  state.forces.liu.techNodes = techNodes;
  return state;
}

function siegeUnit(
  state: GameState,
  coord: { q: number; r: number },
  overrides: Partial<ArmyUnit> = {},
): ArmyUnit {
  state.officers['guan-yu'].location = { kind: 'unit', unitId: 'siege' };
  state.units.siege = {
    id: 'siege',
    kind: 'combat',
    forceId: 'liu',
    leaderId: 'guan-yu',
    officerIds: ['guan-yu'],
    homeCityId: 'jiangling',
    troopType: 'siege',
    siegeWeapon: 'ram',
    q: coord.q,
    r: coord.r,
    troops: 6000,
    food: 6000,
    stamina: 100,
    energy: 100,
    movementRemaining: 16,
    moved: false,
    acted: false,
    ...overrides,
  };
  return state.units.siege;
}

function shipUnit(
  state: GameState,
  coord: { q: number; r: number },
  overrides: Partial<ArmyUnit> = {},
): ArmyUnit {
  state.officers['guan-yu'].location = { kind: 'unit', unitId: 'warship' };
  state.units.warship = {
    id: 'warship',
    kind: 'combat',
    forceId: 'liu',
    leaderId: 'guan-yu',
    officerIds: ['guan-yu'],
    homeCityId: 'jiangling',
    troopType: 'sword',
    vehicle: 'ship',
    q: coord.q,
    r: coord.r,
    troops: 6000,
    food: 6000,
    stamina: 100,
    energy: 100,
    movementRemaining: 22,
    moved: false,
    acted: false,
    ...overrides,
  };
  return state.units.warship;
}

function addEnemyUnit(
  state: GameState,
  id: string,
  coord: { q: number; r: number },
  troops = 6000,
  overrides: Partial<ArmyUnit> = {},
): ArmyUnit {
  state.units[id] = {
    id,
    kind: 'combat',
    forceId: 'cao',
    leaderId: 'cao-ren',
    officerIds: ['cao-ren'],
    homeCityId: 'xiangyang',
    troopType: 'sword',
    q: coord.q,
    r: coord.r,
    troops,
    food: 6000,
    stamina: 100,
    energy: 100,
    movementRemaining: 20,
    moved: false,
    acted: false,
    ...overrides,
  };
  state.officers['cao-ren'].location = { kind: 'unit', unitId: id };
  return state.units[id];
}

describe('器械与舰船的科技派生（不改存档字段）', () => {
  it('机械把冲车升为木兽、弹道把井阑升为投石车、造船术把楼船升为斗舰', () => {
    const state = plainState();
    const ram = siegeUnit(state, { q: 10, r: 10 });
    const tower = siegeUnit(state, { q: 9, r: 10 }, { id: 'tower-unit', siegeWeapon: 'tower' });

    expect(siegeWeaponKindOf(state, ram)).toBe('ram');
    expect(siegeWeaponKindOf(state, tower)).toBe('tower');
    expect(siegeWeaponKindOf(state, { forceId: 'liu', siegeWeapon: undefined })).toBeUndefined();
    expect(armamentLabelFor(state, 'liu', 'ram')).toBe('冲车');
    expect(armamentLabelFor(state, 'liu', 'tower')).toBe('井阑');
    expect(armamentLabelFor(state, 'liu', 'ship')).toBe('楼船');
    expect(vehicleLabelFor(state, 'liu', 'ship')).toBe('楼船');

    // 研究机械后：**已在外部队的冲车自动变成木兽**（siegeWeapon 字段仍是 ram，无需迁移）
    state.forces.liu.techNodes = ['jixie'];
    expect(ram.siegeWeapon).toBe('ram');
    expect(siegeWeaponKindOf(state, ram)).toBe('woodenBeast');
    expect(armamentLabelFor(state, 'liu', 'ram')).toBe('木兽');
    expect(unitArmamentLabel(state, ram)).toBe('木兽');
    expect(siegeWeaponKindOf(state, tower)).toBe('tower');

    state.forces.liu.techNodes = ['dandao'];
    expect(siegeWeaponKindOf(state, tower)).toBe('catapult');
    expect(armamentLabelFor(state, 'liu', 'tower')).toBe('投石车');
    expect(siegeWeaponKindOf(state, ram)).toBe('ram');

    state.forces.liu.techNodes = ['zaochuanshu'];
    expect(armamentLabelFor(state, 'liu', 'ship')).toBe('斗舰');
    expect(vehicleLabelFor(state, 'liu', 'ship')).toBe('斗舰');
    expect(armamentLabelFor(state, 'liu', 'spear')).toBe(ARMAMENT_LABELS.spear);
  });

  it('兵装存储口径不变：木兽/投石车仍按 ram/tower 征用与返还', () => {
    const state = createGame('liu', 1);
    state.forces.liu.techNodes = ['jixie', 'dandao'];
    state.cities.jiangling.armaments = { ...initialArmaments(), ram: 3, tower: 2 };

    const ramDeployed = deployUnit(state, 'liu', {
      cityId: 'jiangling', officerId: 'guan-yu', troopType: 'siege', siegeWeapon: 'ram', troops: 4000, food: 6000,
    });
    const ramUnit = Object.values(ramDeployed.units)[0];
    expect(ramUnit.siegeWeapon).toBe('ram');
    expect(siegeWeaponKindOf(ramDeployed, ramUnit)).toBe('woodenBeast');
    expect(ramDeployed.cities.jiangling.armaments!.ram).toBe(2);

    const towerDeployed = deployUnit(ramDeployed, 'liu', {
      cityId: 'jiangling', officerId: 'chen-dao', troopType: 'siege', siegeWeapon: 'tower', troops: 4000, food: 6000,
    });
    expect(towerDeployed.cities.jiangling.armaments!.tower).toBe(1);
    expect(ramUnit.armaments).toEqual({ ram: 1 });
  });
});

describe('木兽（机械）', () => {
  it('攻击敌方部队：目标所在格着火（1~3 旬，与火计同一掷骰口径）', () => {
    const state = plainState(['jixie']);
    const attacker = siegeUnit(state, { q: 10, r: 10 });
    addEnemyUnit(state, 'target', { q: 12, r: 10 });

    expect(attacker.siegeWeapon).toBe('ram');
    const next = attackUnit(state, 'liu', 'siege', 'target');

    expect(next.units.target.troops).toBeLessThan(6000);
    expect(next.firePlots).toContainEqual(expect.objectContaining({ q: 12, r: 10 }));
    const [plot] = next.firePlots!;
    expect(plot.remainingTenDays).toBeGreaterThanOrEqual(1);
    expect(plot.remainingTenDays).toBeLessThanOrEqual(3);
  });

  it('未研究机械的冲车不点火（仍是普通冲车）', () => {
    const state = plainState();
    siegeUnit(state, { q: 10, r: 10 });
    addEnemyUnit(state, 'target', { q: 12, r: 10 });

    const next = attackUnit(state, 'liu', 'siege', 'target');

    expect(next.units.target.troops).toBeLessThan(6000);
    expect(next.firePlots ?? []).toEqual([]);
  });

  it('攻击城池：城池中心格着火', () => {
    const state = plainState(['jixie']);
    const city = state.cities.xiangyang;
    city.troops = 9000;
    city.durability = 9000;
    siegeUnit(state, { q: city.gridQ + 2, r: city.gridR });

    const next = attackCity(state, 'liu', 'siege', 'xiangyang');

    expect(next.cities.xiangyang.durability).toBeLessThan(9000);
    expect(next.firePlots).toContainEqual(expect.objectContaining({ q: city.gridQ, r: city.gridR }));
  });

  it('攻击关隘：关隘锚点格着火', () => {
    const state = plainState(['jixie']);
    const pass = state.passes!.wuguan;
    pass.ownerId = 'cao';
    pass.troops = 6000;
    pass.durability = 8000;
    siegeUnit(state, neighborsOf(pass.q, pass.r)[0]);

    const next = attackPass(state, 'liu', 'siege', pass.id);

    expect(next.passes![pass.id].durability).toBeLessThan(8000);
    expect(next.firePlots).toContainEqual(expect.objectContaining({ q: pass.q, r: pass.r }));
  });

  it('攻击设施：设施所在格着火（设施被打掉也照样烧）', () => {
    const state = plainState(['jixie']);
    state.facilities = {
      target: { id: 'target', type: 'arrowTower', forceId: 'cao', q: 12, r: 10, durability: 200, completed: true },
    };
    siegeUnit(state, { q: 10, r: 10 });

    const next = attackFacility(state, 'liu', 'siege', 'target');

    expect(next.facilities!.target).toBeUndefined();
    expect(next.firePlots).toContainEqual(expect.objectContaining({ q: 12, r: 10 }));
  });

  it('攻击地格（市场/农场等开发设施）：地格所在格着火', () => {
    const state = plainState(['jixie']);
    const city = state.cities.xiangyang;
    if (!city.plots) city.plots = [];
    city.plots[0] = { id: 'p-market', type: 'market', level: 1, value: 0, q: 12, r: 10, durability: 500 };
    siegeUnit(state, { q: 10, r: 10 });

    const next = attackPlot(state, 'liu', 'siege', 'xiangyang', 0);

    expect(next.cities.xiangyang.plots![0].durability).toBeLessThan(500);
    expect(next.firePlots).toContainEqual(expect.objectContaining({ q: 12, r: 10 }));
  });
});

describe('投石车（弹道）', () => {
  it('射程 2~3：打不到相邻 1 格，未研究弹道时井阑仍是射程 2（可打相邻）', () => {
    const state = plainState();
    const attacker = siegeUnit(state, { q: 10, r: 10 }, { siegeWeapon: 'tower' });
    addEnemyUnit(state, 'adjacent', { q: 11, r: 10 });
    addEnemyUnit(state, 'two-away', { q: 12, r: 10 });
    addEnemyUnit(state, 'three-away', { q: 13, r: 10 });
    addEnemyUnit(state, 'four-away', { q: 14, r: 10 });

    expect(unitAttackRange(state, attacker)).toBe(2);
    expect(attackableUnits(state, 'siege').map((unit) => unit.id)).toEqual(['adjacent', 'two-away']);

    state.forces.liu.techNodes = ['dandao'];
    expect(siegeWeaponKindOf(state, state.units.siege)).toBe('catapult');
    expect(unitAttackRange(state, state.units.siege)).toBe(3);
    expect(attackableUnits(state, 'siege').map((unit) => unit.id)).toEqual(['two-away', 'three-away']);
    expect(() => attackUnit(state, 'liu', 'siege', 'adjacent')).toThrow(/攻击范围/);
    expect(() => attackUnit(state, 'liu', 'siege', 'four-away')).toThrow(/攻击范围/);
    expect(attackUnit(state, 'liu', 'siege', 'three-away').units['three-away'].troops).toBeLessThan(6000);
  });

  it('对城池同样限定 2~3 格（轮廓最近距离），2 格内不再能贴脸轰城', () => {
    const state = plainState();
    const city = state.cities.xiangyang;
    city.troops = 14_500;
    const adjacentCell = { q: city.gridQ + 2, r: city.gridR };
    const farCell = { q: city.gridQ + 3, r: city.gridR };
    const attacker = siegeUnit(state, adjacentCell, { siegeWeapon: 'tower' });

    // 井阑（射程 2，可贴脸）
    expect(attackableCities(state, attacker.id).map((target) => target.id)).toContain('xiangyang');

    state.forces.liu.techNodes = ['dandao'];
    expect(attackableCities(state, attacker.id).map((target) => target.id)).not.toContain('xiangyang');

    state.units.siege.q = farCell.q;
    state.units.siege.r = farCell.r;
    expect(attackableCities(state, attacker.id).map((target) => target.id)).toContain('xiangyang');
    expect(attackCity(state, 'liu', attacker.id, 'xiangyang').cities.xiangyang.durability)
      .toBeLessThan(city.durability);
  });

  it('最小射程 2 同样作用于设施：贴脸不可打，2 格外可打', () => {
    const state = plainState(['dandao']);
    state.facilities = {
      target: { id: 'target', type: 'arrowTower', forceId: 'cao', q: 12, r: 10, durability: 5000, completed: true },
    };
    const attacker = siegeUnit(state, { q: 10, r: 10 }, { siegeWeapon: 'tower' });

    expect(attackableFacilities(state, attacker.id).map((facility) => facility.id)).toEqual(['target']);
    expect(attackFacility(state, 'liu', attacker.id, 'target').facilities!.target.durability).toBeLessThan(5000);

    // 贴脸 1 格：投石车打不到
    state.units.siege.q = 11;
    expect(attackableFacilities(state, attacker.id)).toEqual([]);
    expect(() => attackFacility(state, 'liu', attacker.id, 'target')).toThrow(/攻击范围/);
  });

  it('投石车用最小射程参战：不能发起齐攻', () => {
    const state = plainState();
    const attacker = siegeUnit(state, { q: 10, r: 10 }, { siegeWeapon: 'tower' });
    addEnemyUnit(state, 'target', { q: 11, r: 10 });
    state.units.ally = {
      ...state.units.siege, id: 'ally', q: 12, r: 10, siegeWeapon: undefined, troopType: 'sword',
    };

    // 井阑：可以贴脸齐攻
    expect(jointAttackableUnits(state, attacker.id).map((unit) => unit.id)).toEqual(['target']);

    state.forces.liu.techNodes = ['dandao'];
    expect(jointAttackableUnits(state, attacker.id)).toEqual([]);
  });
});

describe('霹雳：投石车命中后的溅射', () => {
  function splashState(techNodes: TechNodeId[]) {
    const state = plainState(techNodes);
    siegeUnit(state, { q: 10, r: 10 }, { siegeWeapon: 'tower' });
    addEnemyUnit(state, 'center', { q: 12, r: 10 });
    addEnemyUnit(state, 'enemy-neighbour', { q: 13, r: 10 });
    addEnemyUnit(state, 'friendly-neighbour', { q: 12, r: 11 }, 6000, { forceId: 'liu', leaderId: 'liu-bei', officerIds: ['liu-bei'] });
    addEnemyUnit(state, 'far-away', { q: 14, r: 10 });
    return state;
  }

  it('有霹雳：中心 6 格内不分敌我各吃 50% 溅射；无霹雳：无溅射', () => {
    const withoutPili = splashState(['dandao']);
    const withoutNext = attackUnit(withoutPili, 'liu', 'siege', 'center');
    expect(withoutNext.units.center.troops).toBeLessThan(6000);
    expect(withoutNext.units['enemy-neighbour'].troops).toBe(6000);
    expect(withoutNext.units['friendly-neighbour'].troops).toBe(6000);

    const withPili = splashState(['dandao', 'pili']);
    const next = attackUnit(withPili, 'liu', 'siege', 'center');
    const centerDamage = 6000 - next.units.center.troops;
    const splashDamage = Math.round(centerDamage * 0.5);

    expect(centerDamage).toBeGreaterThan(0);
    expect(6000 - next.units['enemy-neighbour'].troops).toBe(splashDamage);
    // 不分敌我：己方部队同样吃溅射
    expect(6000 - next.units['friendly-neighbour'].troops).toBe(splashDamage);
    // 中心格不重复结算，距离 2 格的目标不在溅射圈内
    expect(next.units['far-away'].troops).toBe(6000);
    expect(next.battleDamageReports?.some((report) => report.id.includes('catapultUnit-splash'))).toBe(true);
  });
});

describe('斗舰（造船术 + 弹道）', () => {
  it('造船术提升水上攻防', () => {
    const boatLevel = waterState();
    shipUnit(boatLevel, { q: 10, r: 10 });
    addEnemyUnit(boatLevel, 'target', { q: 11, r: 10 });
    const baseAttack = damageRoll(boatLevel, boatLevel.units.warship, 'water', false, boatLevel.units.target);

    const battleShipLevel = waterState(['zaochuanshu']);
    shipUnit(battleShipLevel, { q: 10, r: 10 });
    addEnemyUnit(battleShipLevel, 'target', { q: 11, r: 10 });
    const battleShipAttack = damageRoll(
      battleShipLevel, battleShipLevel.units.warship, 'water', false, battleShipLevel.units.target,
    );

    expect(isBattleShip(battleShipLevel, battleShipLevel.units.warship)).toBe(true);
    expect(isBattleShip(boatLevel, boatLevel.units.warship)).toBe(false);
    expect(battleShipAttack).toBeGreaterThan(baseAttack);

    // 防守端：同样是楼船船体，斗舰吃到的伤害更低
    const plainDefender = waterState();
    shipUnit(plainDefender, { q: 10, r: 10 });
    addEnemyUnit(plainDefender, 'target', { q: 11, r: 10 }, 6000, { vehicle: 'ship' });
    const baseTaken = damageRoll(plainDefender, plainDefender.units.warship, 'water', false, plainDefender.units.target);

    const strongDefender = waterState();
    strongDefender.forces.cao.techNodes = ['zaochuanshu'];
    shipUnit(strongDefender, { q: 10, r: 10 });
    addEnemyUnit(strongDefender, 'target', { q: 11, r: 10 }, 6000, { vehicle: 'ship' });
    const strongTaken = damageRoll(strongDefender, strongDefender.units.warship, 'water', false, strongDefender.units.target);

    expect(strongTaken).toBeLessThan(baseTaken);
  });

  it('造船术给斗舰 +4 移动力（罗盘的 +6 不重复给）', () => {
    const deployed = (techNodes: TechNodeId[]) => {
      const state = createGame('liu', 1);
      state.forces.liu.techNodes = techNodes;
      state.cities.jiangling.armaments = { ...initialArmaments(), ship: 5 };
      const next = deployUnit(state, 'liu', {
        cityId: 'jiangling', officerId: 'guan-yu', vehicle: 'ship', troops: 4000, food: 5000,
      });
      return Object.values(next.units)[0];
    };

    const boat = deployed([]);
    expect(boat.movementRemaining).toBe(TROOP_MOVEMENT.sword);
    expect(battleShipMovementBonus(createGame('liu', 1), { forceId: 'liu', vehicle: 'ship' })).toBe(0);

    const battleShip = deployed(['luopan', 'zaochuanshu']);
    // 基础 22 + 罗盘 6 + 斗舰 4
    expect(battleShip.movementRemaining).toBe(TROOP_MOVEMENT.sword + 6 + 4);
  });

  it('弹道解锁斗舰投石：射程 3、对据点按兵器倍率结算', () => {
    const city = createGame('liu', 1).cities.xiangyang;
    // 距城池 7 格轮廓 2 格（楼船射程 2 也能打到，便于对比倍率）
    const ringTwo = { q: city.gridQ + 3, r: city.gridR };
    // 距城池轮廓 1 格（贴脸）
    const ringOne = { q: city.gridQ + 2, r: city.gridR };

    // 楼船：射程 2，对据点按一般部队倍率（0.2）
    const plainShip = waterState(['zaochuanshu']);
    shipUnit(plainShip, ringTwo);
    expect(unitAttackRange(plainShip, plainShip.units.warship)).toBe(2);
    expect(unitHasCatapultAttack(plainShip, plainShip.units.warship)).toBe(false);
    expect(attackableCities(plainShip, 'warship').map((target) => target.id)).toContain('xiangyang');
    const plainLoss = plainShip.cities.xiangyang.durability
      - attackCity(plainShip, 'liu', 'warship', 'xiangyang').cities.xiangyang.durability;

    // 斗舰投石：射程 3，对据点按兵器倍率（1.4）
    const battleShip = waterState(['zaochuanshu', 'dandao']);
    const ship = shipUnit(battleShip, ringTwo);
    expect(unitHasCatapultAttack(battleShip, ship)).toBe(true);
    expect(unitAttackRange(battleShip, ship)).toBe(3);
    const battleShipLoss = battleShip.cities.xiangyang.durability
      - attackCity(battleShip, 'liu', 'warship', 'xiangyang').cities.xiangyang.durability;
    expect(plainLoss).toBeGreaterThan(0);
    expect(battleShipLoss).toBeGreaterThan(plainLoss * 3);

    // 3 格外的城池（轮廓 3 格）同样能轰到
    const far = waterState(['zaochuanshu', 'dandao']);
    shipUnit(far, { q: city.gridQ + 4, r: city.gridR });
    expect(attackableCities(far, 'warship').map((target) => target.id)).toContain('xiangyang');

    // 贴脸（城池轮廓 1 格）时斗舰投石与投石车同口径：打不到，需要退到 2 格外
    const adjacent = waterState(['zaochuanshu', 'dandao']);
    shipUnit(adjacent, ringOne);
    expect(attackableCities(adjacent, 'warship').map((target) => target.id)).not.toContain('xiangyang');
    expect(() => attackCity(adjacent, 'liu', 'warship', 'xiangyang')).toThrow(/攻击范围/);
  });

  it('弹道解锁斗舰投石：可打 2~3 格外的敌方部队，并触发霹雳溅射', () => {
    const staged = (techNodes: TechNodeId[]) => {
      const state = waterState(techNodes);
      shipUnit(state, { q: 10, r: 10 });
      addEnemyUnit(state, 'two-away', { q: 12, r: 10 });
      addEnemyUnit(state, 'three-away', { q: 13, r: 10 });
      addEnemyUnit(state, 'neighbour', { q: 13, r: 11 });
      addEnemyUnit(state, 'adjacent', { q: 11, r: 10 });
      return state;
    };

    const battleShip = staged(['zaochuanshu', 'dandao', 'pili']);
    // 射程 3：相邻与 2~3 格外的敌军都可打（同名次按距离、id 排序）
    expect(attackableUnits(battleShip, 'warship').map((unit) => unit.id))
      .toEqual(['adjacent', 'two-away', 'neighbour', 'three-away']);

    const next = attackUnit(battleShip, 'liu', 'warship', 'three-away');
    const centerDamage = 6000 - next.units['three-away'].troops;
    expect(centerDamage).toBeGreaterThan(0);
    // 中心 6 格内的邻军吃 50% 溅射
    expect(6000 - next.units.neighbour.troops).toBe(Math.round(centerDamage * 0.5));

    // 未研究弹道的楼船打不到 3 格外的敌军
    const plainShip = staged(['zaochuanshu']);
    expect(attackableUnits(plainShip, 'warship').map((unit) => unit.id)).toEqual(['adjacent', 'two-away']);
  });
});
