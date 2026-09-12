import { describe, expect, it } from 'vitest';
import { executeCommand, validateCommand } from './commands';
import { DEFAULT_OFFICER_LOYALTY, LEADER_INITIAL_LOYALTY, LOYALTY_MAX, settleLoyaltyDrift } from './loyalty';
import { createGame } from './scenario/jingxiang208';
import { compatTierOf, affinityOf, officerCompatWithRuler } from './diplomacy';
import { loyaltyLossResist } from './techs';
import { recruitCaptiveChance } from './captives';
import { poachChance } from './rumor';

describe('忠诚度系统', () => {
  it('初始忠诚：君主100、在城武将默认92、在野0', () => {
    const state = createGame('cao');
    const cao = state.officers['cao-cao'];
    const xunYu = state.officers['xun-yu'];
    expect(cao.loyalty).toBe(LEADER_INITIAL_LOYALTY);
    expect(xunYu.loyalty).toBe(DEFAULT_OFFICER_LOYALTY);
    const bonus = Object.values(state.officers).find((o) => o.forceId === null);
    expect(bonus?.loyalty ?? 0).toBe(0);
  });

  it('褒奖：每人忠诚+5并扣除每人100金与5行动力，不改变武将待命状态', () => {
    const state = createGame('cao');
    const xunYu = state.officers['xun-yu'];
    const city = state.cities[xunYu.cityId];
    city.gold = 1000;
    state.actionPoints.cao = 60;
    const beforeLoyalty = xunYu.loyalty ?? DEFAULT_OFFICER_LOYALTY;

    const command = { type: 'reward' as const, cityId: xunYu.cityId, officerIds: [xunYu.id] };
    expect(validateCommand(state, 'cao', command)).toEqual([]);
    const next = executeCommand(state, 'cao', command);

    const after = next.officers[xunYu.id];
    expect(after.loyalty).toBe(beforeLoyalty + 5);
    expect(next.cities[xunYu.cityId].gold).toBe(900);
    expect(next.actionPoints.cao).toBe(55);
    expect(after.acted).toBe(false);
  });

  it('褒奖多人：全体+5，资金按人数扣除', () => {
    const state = createGame('cao');
    const xunYu = state.officers['xun-yu'];
    const partner = Object.values(state.officers).find((o) =>
      o.id !== xunYu.id && o.forceId === 'cao' && !o.deathMonth
      && o.location.kind === 'city' && o.location.cityId === xunYu.cityId
      && (o.loyalty ?? 92) < 100,
    )!;
    const city = state.cities[xunYu.cityId];
    city.gold = 1000;
    state.actionPoints.cao = 60;
    const beforeXun = xunYu.loyalty ?? DEFAULT_OFFICER_LOYALTY;
    const beforePartner = partner.loyalty ?? DEFAULT_OFFICER_LOYALTY;

    const next = executeCommand(state, 'cao', { type: 'reward', cityId: xunYu.cityId, officerIds: [xunYu.id, partner.id] });

    expect(next.officers[xunYu.id].loyalty).toBe(beforeXun + 5);
    expect(next.officers[partner.id].loyalty).toBe(beforePartner + 5);
    expect(next.cities[xunYu.cityId].gold).toBe(800);
  });

  it('忠诚上限127封顶', () => {
    const state = createGame('cao');
    const xunYu = state.officers['xun-yu'];
    xunYu.loyalty = LOYALTY_MAX - 1;
    state.actionPoints.cao = 60;
    const next = executeCommand(state, 'cao', { type: 'reward', cityId: xunYu.cityId, officerIds: [xunYu.id] });
    expect(next.officers[xunYu.id].loyalty).toBe(LOYALTY_MAX);
  });

  it('季初高义理低野望武将不降忠诚，忠诚不低于0', () => {
    const state = createGame('cao');
    const guanYu = state.officers['guan-yu'];
    guanYu.forceId = 'cao';
    guanYu.loyalty = 1;
    guanYu.righteousness = 90;
    guanYu.ambition = 20;
    state.month = 1;
    settleLoyaltyDrift(state);
    expect(guanYu.loyalty).toBe(1);
    expect(guanYu.loyalty).toBeGreaterThanOrEqual(0);
  });
});

describe('相性/忠诚对齐原版', () => {
  it('相性差档位：≤24同相×0.5，25~49中庸×1，≥50相克×1.5', () => {
    expect(compatTierOf(0).factor).toBe(0.5);
    expect(compatTierOf(0).key).toBe('close');
    expect(compatTierOf(24).key).toBe('close');
    expect(compatTierOf(25).key).toBe('mid');
    expect(compatTierOf(49).key).toBe('mid');
    expect(compatTierOf(50).key).toBe('far');
    expect(compatTierOf(75).factor).toBe(1.5);
  });

  it('克己复礼（文教6级）开关', () => {
    const state = createGame('cao');
    expect(loyaltyLossResist(state, 'cao')).toBe(false);
    state.forces.cao.techNodes = ['kejifuli'];
    expect(loyaltyLossResist(state, 'cao')).toBe(true);
  });

  it('相性差取圆环最短距离并与君主比较', () => {
    const state = createGame('cao'); // 曹操相性25
    const guanYu = state.officers['guan-yu'];
    guanYu.xing = 100;
    const compat = officerCompatWithRuler(state, guanYu, 'cao');
    expect(compat.diff).toBe(75);
    expect(compat.tier.key).toBe('far');
    expect(affinityOf(state, guanYu)).toBe(100);
  });

  it('关系锁定：有配偶/义兄弟在营，季初不掉忠', () => {
    const state = createGame('cao', 1);
    const officer = state.officers['guan-yu'];
    officer.forceId = 'cao';
    officer.loyalty = 100;
    officer.righteousness = 40;
    officer.ambition = 90;
    officer.relationships = { 'xu-huang': 'spouse' };
    officer.location = { kind: 'unaffiliated', cityId: 'wan' };
    state.month = 1;
    settleLoyaltyDrift(state);
    expect(officer.loyalty).toBe(100);
  });

  it('厌恶君主必降忠诚（无视义理/野望与克己复礼）', () => {
    const state = createGame('cao', 1);
    const officer = state.officers['guan-yu'];
    officer.forceId = 'cao';
    officer.loyalty = 100;
    officer.righteousness = 95;
    officer.ambition = 10;
    officer.hates = ['cao-cao'];
    officer.location = { kind: 'unaffiliated', cityId: 'wan' };
    state.forces.cao.techNodes = ['kejifuli'];
    settleLoyaltyDrift(state);
    expect(officer.loyalty).toBeLessThan(100);
  });

  it('仁政为城级：同城武将被保护，他城武将不受保护', () => {
    const state = createGame('cao', 1);
    // wan 城有仁政持有者
    const xunYu = state.officers['xun-yu'];
    xunYu.skill = '仁政';
    // 两者均厌恶君主（必降），仅所在城不同
    const protectee = state.officers['guan-yu'];
    protectee.forceId = 'cao';
    protectee.loyalty = 100;
    protectee.hates = ['cao-cao'];
    protectee.location = { kind: 'city', cityId: 'wan' };
    const exposed = state.officers['cao-ren'];
    exposed.forceId = 'cao';
    exposed.loyalty = 100;
    exposed.hates = ['cao-cao'];
    exposed.location = { kind: 'city', cityId: 'xiangyang' };
    settleLoyaltyDrift(state);
    expect(protectee.loyalty).toBe(100);
    expect(exposed.loyalty).toBeLessThan(100);
  });

  it('厌恶登庸被拒：登用战俘概率为0', () => {
    const state = createGame('liu', 1);
    const executor = state.officers['liu-bei'];
    const target = state.officers['cao-ren'];
    target.forceId = 'cao';
    const leaderId = state.forces.liu.leaderId;
    target.hates = [leaderId];
    expect(recruitCaptiveChance(state, 'liu', executor, target)).toBe(0);
  });

  it('厌恶挖角被拒：概率为0；克己复礼进一步压制', () => {
    const state = createGame('cao', 1);
    const executor = state.officers['cao-cao'];
    const target = state.officers['zhou-yu'];
    target.forceId = 'sun';
    target.hates = [state.forces.cao.leaderId];
    expect(poachChance(state, executor, target)).toBe(0);

    const target2 = state.officers['lu-su'];
    target2.forceId = 'sun';
    const withoutResist = poachChance(state, executor, target2);
    state.forces.sun.techNodes = ['kejifuli'];
    const withResist = poachChance(state, executor, target2);
    expect(withResist).toBeLessThan(withoutResist);
  });
});