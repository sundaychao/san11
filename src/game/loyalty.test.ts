import { describe, expect, it } from 'vitest';
import { executeCommand, validateCommand } from './commands';
import {
  DEFAULT_OFFICER_LOYALTY,
  LEADER_INITIAL_LOYALTY,
  RECRUIT_REFUSE_LOYALTY,
  loyaltyCapOf,
  recruitWillOf,
  settleLoyaltyDrift,
  settleServiceYears,
  serviceYearsOf,
} from './loyalty';
import { createGame } from './scenario/jingxiang208';
import { compatTierOf, affinityOf, officerCompatWithRuler } from './diplomacy';
import { loyaltyLossResist } from './techs';
import { POSITIONS } from './ranks';
import { capturableByLoyalty, recruitCaptiveChance } from './captives';
import { poachChance } from './rumor';

describe('忠诚度系统（血色衣冠6.0）', () => {
  it('初始忠诚：君主100、在城武将默认92、在野0；在仕武将仕龄1、在野0', () => {
    const state = createGame('cao');
    const cao = state.officers['cao-cao'];
    const xunYu = state.officers['xun-yu'];
    expect(cao.loyalty).toBe(LEADER_INITIAL_LOYALTY);
    expect(xunYu.loyalty).toBe(DEFAULT_OFFICER_LOYALTY);
    expect(xunYu.serviceYears).toBe(1);
    const bonus = Object.values(state.officers).find((o) => o.forceId === null);
    expect(bonus?.loyalty ?? 0).toBe(0);
    expect(bonus?.serviceYears ?? 0).toBe(0);
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

  it('褒奖上限为忠诚度基准值：超出部分被截断', () => {
    const state = createGame('cao');
    const xunYu = state.officers['xun-yu'];
    // 关羽设为远相性（差75）→ 基准值 = 100 − 45 + 3（仕龄1） = 58
    const guanYu = state.officers['guan-yu'];
    guanYu.forceId = 'cao';
    guanYu.xing = 100;
    guanYu.loyalty = 56;
    guanYu.cityId = xunYu.cityId;
    guanYu.location = { kind: 'city', cityId: xunYu.cityId };
    expect(loyaltyCapOf(state, guanYu)).toBe(58);
    state.actionPoints.cao = 60;
    const next = executeCommand(state, 'cao', { type: 'reward', cityId: xunYu.cityId, officerIds: [guanYu.id] });
    expect(next.officers[guanYu.id].loyalty).toBe(58);
  });

  it('忠诚度基准值公式：相性差/仕龄/官阶/与君主关系逐项生效', () => {
    const state = createGame('cao');
    const officer = state.officers['guan-yu'];
    officer.forceId = 'cao';
    officer.xing = 100;
    officer.serviceYears = 1;
    officer.positionId = undefined;
    // 基础：100 − 75×60% + 1年×3 = 58
    expect(loyaltyCapOf(state, officer)).toBe(58);
    // 仕龄加成上限 +12（10 年封顶）
    officer.serviceYears = 10;
    expect(loyaltyCapOf(state, officer)).toBe(67);
    // 满官阶 +20（最高档官职）
    const topPosition = POSITIONS[POSITIONS.length - 1];
    officer.positionId = topPosition.id;
    expect(loyaltyCapOf(state, officer)).toBe(87);
    // 与君主关系：亲爱 +10
    officer.positionId = undefined;
    officer.likes = ['cao-cao'];
    expect(loyaltyCapOf(state, officer)).toBe(77);
    // 与君主关系：配偶 +10（配偶必须是君主本人才计入「与君主关系」）
    officer.likes = undefined;
    officer.relationships = { 'cao-cao': 'spouse' };
    expect(loyaltyCapOf(state, officer)).toBe(77);
    // 厌恶 −10（清掉配偶关系，避免 +10/−10 相互抵消）
    officer.relationships = undefined;
    officer.hates = ['cao-cao'];
    expect(loyaltyCapOf(state, officer)).toBe(57);
  });

  it('季初：相性亲近（差≤15）且非俘虏的武将不掉忠', () => {
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

  it('季初：高野心低义理（野心≥3档且义理≤1档）必定掉忠', () => {
    const state = createGame('cao', 1);
    const guanYu = state.officers['guan-yu'];
    guanYu.forceId = 'cao';
    guanYu.loyalty = 100;
    guanYu.righteousness = 30;
    guanYu.ambition = 80;
    state.month = 1;
    settleLoyaltyDrift(state);
    expect(guanYu.loyalty).toBeLessThan(100);
  });

  it('季初：亲爱君主必不掉忠（即使高野心低义理）', () => {
    const state = createGame('cao', 1);
    const guanYu = state.officers['guan-yu'];
    guanYu.forceId = 'cao';
    guanYu.loyalty = 100;
    guanYu.righteousness = 30;
    guanYu.ambition = 80;
    guanYu.likes = ['cao-cao'];
    state.month = 1;
    settleLoyaltyDrift(state);
    expect(guanYu.loyalty).toBe(100);
  });
});

describe('仕龄（血色衣冠6.0）', () => {
  it('新年结算：在仕与被俘武将仕龄+1，在野不变', () => {
    const state = createGame('cao');
    const xunYu = state.officers['xun-yu'];
    const inWild = Object.values(state.officers).find((o) => o.forceId === null)!;
    const captive = state.officers['zhou-yu'];
    captive.forceId = 'sun';
    captive.loyalty = 80;
    captive.location = { kind: 'captive', cityId: xunYu.cityId, captorForceId: 'cao', capturedTenDays: 0 };
    settleServiceYears(state);
    expect(xunYu.serviceYears).toBe(2);
    expect(captive.serviceYears).toBe(2);
    expect(inWild.serviceYears ?? 0).toBe(0);
  });

  it('旧档兜底：未记录仕龄的在仕武将视为已仕 1 年', () => {
    const state = createGame('cao');
    const xunYu = state.officers['xun-yu'];
    delete xunYu.serviceYears;
    expect(serviceYearsOf(xunYu)).toBe(1);
  });
});

describe('登用接受意愿（血色衣冠6.0）', () => {
  it('目标亲爱登用方君主且在野 → 必定同意', () => {
    const state = createGame('cao');
    const executor = state.officers['xun-yu'];
    const target = Object.values(state.officers).find((o) => o.forceId === null)!;
    target.likes = ['cao-cao'];
    const will = recruitWillOf(state, executor, target);
    expect(will.verdict).toBe('accept');
    expect(will.will).toBe(999);
  });

  it('目标是君主 / 厌恶登用君主或武将 / 忠诚高于96 → 必定拒绝', () => {
    const state = createGame('cao');
    const executor = state.officers['xun-yu'];
    const sunLeader = state.officers[state.forces.sun.leaderId];
    expect(recruitWillOf(state, executor, sunLeader).verdict).toBe('refuse');

    const hostile = state.officers['zhou-yu'];
    hostile.forceId = 'sun';
    hostile.loyalty = 80;
    hostile.hates = ['cao-cao'];
    expect(recruitWillOf(state, executor, hostile).verdict).toBe('refuse');
    hostile.hates = [executor.id];
    expect(recruitWillOf(state, executor, hostile).verdict).toBe('refuse');

    const loyal = state.officers['lu-su'];
    loyal.forceId = 'sun';
    loyal.loyalty = RECRUIT_REFUSE_LOYALTY + 1;
    expect(recruitWillOf(state, executor, loyal).verdict).toBe('refuse');
  });

  it('相性越近意愿越高：同相性目标显著高于相克目标', () => {
    const state = createGame('cao');
    const executor = state.officers['xun-yu'];
    const near = Object.values(state.officers).find((o) => o.forceId === null)!;
    const far = Object.values(state.officers).filter((o) => o.forceId === null && o.id !== near.id)[0];
    near.xing = 25;
    far.xing = 100;
    near.ambition = 50;
    far.ambition = 50;
    const willNear = recruitWillOf(state, executor, near).will;
    const willFar = recruitWillOf(state, executor, far).will;
    // 有效相性差相差 37.5（75→0），浮动值最多带来 ±5 偏差
    expect(willNear - willFar).toBeGreaterThanOrEqual(32);
    expect(willNear - willFar).toBeLessThanOrEqual(43);
  });

  it('俘虏身份 +10 意愿；忠诚越高意愿越低', () => {
    const state = createGame('cao', 1);
    const executor = state.officers['xun-yu'];
    const target = state.officers['zhou-yu'];
    target.forceId = 'sun';
    target.xing = 25;
    target.serviceYears = 1;
    target.loyalty = 60;
    target.location = { kind: 'city', cityId: target.cityId };
    const asOfficer = recruitWillOf(state, executor, target).will;
    target.location = { kind: 'captive', cityId: target.cityId, captorForceId: 'cao', capturedTenDays: 0 };
    const asCaptive = recruitWillOf(state, executor, target).will;
    expect(asCaptive - asOfficer).toBe(10);
    target.loyalty = 96;
    expect(recruitWillOf(state, executor, target).will).toBeLessThan(asCaptive - 30);
  });

  it('挖角：厌恶→0%，忠诚高于96→0%，亲爱我方君主的俘虏→100%', () => {
    const state = createGame('cao', 1);
    const executor = state.officers['cao-cao'];
    const target = state.officers['zhou-yu'];
    target.forceId = 'sun';
    target.hates = [state.forces.cao.leaderId];
    expect(poachChance(state, executor, target)).toBe(0);

    const loyal = state.officers['lu-su'];
    loyal.forceId = 'sun';
    loyal.loyalty = 100;
    loyal.hates = [];
    expect(poachChance(state, executor, loyal)).toBe(0);

    // 亲爱登用方君主 + 被俘 → 必定同意
    const friendly = state.officers['lu-su'];
    friendly.loyalty = 70;
    friendly.likes = ['cao-cao'];
    friendly.location = { kind: 'captive', cityId: friendly.cityId, captorForceId: 'cao', capturedTenDays: 0 };
    expect(poachChance(state, executor, friendly)).toBe(100);
  });

  it('俘虏登用：厌恶→0%，亲爱捕获方君主→100%；必拒线=96', () => {
    const state = createGame('liu', 1);
    const executor = state.officers['liu-bei'];
    const target = state.officers['cao-ren'];
    target.forceId = 'cao';
    const leaderId = state.forces.liu.leaderId;
    target.hates = [leaderId];
    expect(recruitCaptiveChance(state, 'liu', executor, target)).toBe(0);

    target.hates = [];
    target.loyalty = 100;
    expect(recruitCaptiveChance(state, 'liu', executor, target)).toBe(0);

    // 亲爱捕获方君主 + 俘虏身份 → 必定同意
    target.loyalty = 80;
    target.likes = [leaderId];
    target.location = { kind: 'captive', cityId: target.cityId, captorForceId: 'liu', capturedTenDays: 0 };
    expect(recruitCaptiveChance(state, 'liu', executor, target)).toBe(100);

    expect(capturableByLoyalty(target)).toBe(true);
    target.loyalty = RECRUIT_REFUSE_LOYALTY + 1;
    expect(capturableByLoyalty(target)).toBe(false);
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

  it('相性差取圆环最短距离并与君主比较；在野无相性按中位75兜底', () => {
    const state = createGame('cao'); // 曹操相性25
    const guanYu = state.officers['guan-yu'];
    guanYu.xing = 100;
    const compat = officerCompatWithRuler(state, guanYu, 'cao');
    expect(compat.diff).toBe(75);
    expect(compat.tier.key).toBe('far');
    expect(affinityOf(state, guanYu)).toBe(100);
    const inWild = Object.values(state.officers).find((o) => o.forceId === null && o.xing === undefined)!;
    expect(affinityOf(state, inWild)).toBe(75);
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
});
