import { describe, expect, it } from 'vitest';
import { nextRandom } from './random';
import {
  RUMOR_BASE_CHANCE,
  RUMOR_INTELLIGENCE_SLOPE,
  RUMOR_MAX_CHANCE,
  RUMOR_MIN_CHANCE,
  resolveRumor,
  rumorSuccessChanceOf,
  rumorTargetOptions,
} from './rumor';
import { executeCommand, officerIsBusy } from './commands';
import { RUMOR_ADVICE_MIN_CHANCE, RECRUIT_ADVICE_MIN_CHANCE, recruitAdviceOf, recruitSuccessChance, rumorAdviceOf, strategistOf } from './strategist';
import { createGame } from './scenario/jingxiang208';
import { settleTenDay } from './turn';
import type { GameState, Officer } from './types';

/** 把一名武将改为指定智力（原地修改） */
function withIntelligence(officer: Officer, intelligence: number): Officer {
  officer.stats = { ...officer.stats, intelligence };
  return officer;
}

/** 复刻 resolveRumor 的判定值：判定值即成功率百分数，收敛在 15 ~ 95 */
function rumorJudgmentOf(executorInt: number, guardInt: number, jitter: number): number {
  const base = Math.round(RUMOR_BASE_CHANCE + (executorInt - guardInt) * RUMOR_INTELLIGENCE_SLOPE);
  return Math.min(RUMOR_MAX_CHANCE, Math.max(RUMOR_MIN_CHANCE, base + jitter));
}

/** 把指定关隘设为敌属并派驻一名守将（同时任命为太守以固定防御智力） */
function staffPass(state: GameState, passId: 'hanguguan', guardInt: number): Officer {
  const pass = state.passes![passId];
  const guard = Object.values(state.officers).find(
    (officer) => officer.forceId === 'cao' && officer.location.kind === 'city' && officer.location.cityId === pass.homeCityId,
  )!;
  guard.location = { kind: 'pass', passId };
  guard.cityId = pass.homeCityId;
  withIntelligence(guard, guardInt);
  pass.governorId = guard.id;
  return guard;
}

/**
 * 选种（直接调用 resolveRumor 的回归用例专用）：xorshift32 小种子首掷≈0，须在大数值域探测。
 * 复现 resolveRumor 的首两掷（抖动 → 结果，失败时再掷被捕），在 rngCursor=0 的初始状态下找种子。
 * 注意：走完整差旅流程的用例请用 findRumorJourneySeed（结算发生在旬推进中，游标已前移）。
 */
function findRumorSeed(executorInt: number, guardInt: number, wantSuccess: boolean, wantCaptured = false): number {
  for (let i = 0; i < 20000; i += 1) {
    const seed = 2 ** 30 + i * 7919;
    const jitterRoll = nextRandom(seed, 0);
    const resultRoll = nextRandom(seed, jitterRoll.cursor);
    const jitter = Math.floor((executorInt / 10) * jitterRoll.value);
    const judgment = rumorJudgmentOf(executorInt, guardInt, jitter);
    const success = Math.floor(resultRoll.value * 100) < judgment;
    if (success !== wantSuccess) continue;
    if (!wantCaptured) return seed;
    const captureRoll = nextRandom(seed, resultRoll.cursor);
    if ((captureRoll.value < 0.25) === wantCaptured) return seed;
  }
  throw new Error('no seed satisfies the expected rumor branch');
}

/**
 * 流言差旅起点：执行武将（智 executorInt）自江陵启程，目标为曹操函谷关（守将智 guardInt）。
 * 默认「智 120 对智 10」＝成功几乎必然，适合跑成功/失败路径。
 */
function startRumorJourney(seed: number, executorInt = 120, guardInt = 10) {
  const state = createGame('liu', seed);
  const guard = staffPass(state, 'hanguguan', guardInt);
  withIntelligence(state.officers['liu-bei'], executorInt);
  const next = executeCommand(state, 'liu', { type: 'rumor', cityId: 'jiangling', officerId: 'liu-bei', targetPassId: 'hanguguan' });
  return { state: next, guard };
}

/** 把去程压到最后一旬后推进一旬，返回「抵达当旬」结算后的状态与关隘守将 */
function arriveRumorJourney(seed: number, executorInt = 120, guardInt = 10) {
  const { state, guard } = startRumorJourney(seed, executorInt, guardInt);
  const location = state.officers['liu-bei'].location;
  if (location.kind !== 'rumorJourney') throw new Error('执行武将未进入流言差旅');
  location.remainingTenDays = 1;
  // 固定落在旬初：绕开旬末的月度结算（流言结算与月份无关），选种探测更快
  state.tenDay = 1;
  return { state: settleTenDay(state), guard };
}

/**
 * 被捕路径的选种场景（执行者智 10 / 守将智 120）：失败成为常态，
 * 几枚种子即可命中「失败 → 25% 被捕」的复合分支。
 * 若沿用默认的高智执行者（成功率 95%），被捕概率仅约 1%，要空跑数百枚种子（曾是本文件超时的元凶）。
 */
const CAPTURED_SCENE = { executorInt: 10, guardInt: 120 } as const;

/**
 * 选种：xorshift32 小种子首掷≈0，必须在大数值域探测。
 * 流言结算发生在旬推进中（rngCursor 已被同旬其它系统推进过），
 * 故这里直接跑完整差旅流程，按抵达当旬的真实分支挑选种子。
 * 返回 seed 与当时使用的场景参数（调用方须用同一组参数复现）。
 */
function findRumorJourneySeed(want: 'success' | 'fail' | 'captured') {
  const scene = want === 'captured' ? CAPTURED_SCENE : { executorInt: 120, guardInt: 10 };
  for (let i = 0; i < 600; i += 1) {
    const seed = 2 ** 30 + i * 7919;
    const { state } = arriveRumorJourney(seed, scene.executorInt, scene.guardInt);
    const officer = state.officers['liu-bei'];
    if (want === 'captured') {
      if (officer.location.kind === 'captive') return { seed, ...scene };
      continue;
    }
    if (officer.location.kind !== 'rumorJourney') continue;
    const success = state.logs.some((log) => log.message.includes('散布流言成功'));
    if (want === 'success' ? success : !success) return { seed, ...scene };
  }
  throw new Error('no seed satisfies the expected rumor journey branch');
}

describe('登庸军师评估', () => {
  /** 江陵据点里待命、未行动的武将（军师评估的候选执行者） */
  function jianglingGarrison(state: GameState): Officer[] {
    return Object.values(state.officers).filter((officer) =>
      officer.forceId === 'liu' && !officer.acted
      && officer.location.kind === 'city' && officer.location.cityId === 'jiangling');
  }

  it('recruitAdviceOf：逐一测算我方武将，推举成功率最高者（过了半即推举）', () => {
    const state = createGame('liu', 3);
    const garrison = jianglingGarrison(state);
    const target = state.officers['zhao-yun']; // 江陵在野赵云（登庸页的默认对象）
    const advice = recruitAdviceOf(state, garrison, target);

    expect(advice.viable).toBe(true);
    expect(advice.chance).toBeGreaterThanOrEqual(RECRUIT_ADVICE_MIN_CHANCE);
    // 推举者即逐人测算里的最高者：刘备（魅力 99 压过甘氏 42）
    expect(advice.executorId).toBe('liu-bei');
    expect(advice.chance).toBe(recruitSuccessChance(state, state.officers['liu-bei'], target));
    // 魅力直接入算：甘氏的成算必然低于刘备
    expect(advice.chance).toBeGreaterThan(recruitSuccessChance(state, state.officers['gan-shi'], target));
  });

  it('recruitAdviceOf：必定同意折算 100%，必拒 / 无意出仕折算 0%', () => {
    const state = createGame('liu', 3);
    const garrison = jianglingGarrison(state);
    const target = state.officers['zhao-yun'];
    // 素来亲善我方君主 → 不待舌战直接出仕
    target.likes = ['liu-bei'];
    expect(recruitSuccessChance(state, state.officers['liu-bei'], target)).toBe(100);
    expect(recruitAdviceOf(state, garrison, target).chance).toBe(100);

    // 拒绝：目标是君主 → 必拒，且原因是与执行者无关的共有原因
    const monarch = recruitAdviceOf(state, garrison, state.officers['cao-cao']);
    expect(monarch.viable).toBe(false);
    expect(monarch.chance).toBe(0);
    expect(monarch.rejected).toBe(true);
    expect(monarch.reasons).toContain('对方是一方君主');

    // 拒绝：在仕忠诚高于必拒线
    state.officers['cao-ren'].loyalty = 99;
    const loyal = recruitAdviceOf(state, garrison, state.officers['cao-ren']);
    expect(loyal.rejected).toBe(true);
    expect(loyal.reasons.some((reason) => reason.includes('拒不背主'))).toBe(true);
  });

  it('recruitAdviceOf：成算不过半只出忠告、不推举人选，并报出我方最高把握', () => {
    const state = createGame('liu', 3);
    const garrison = jianglingGarrison(state);
    const target = state.officers['zhao-yun'];
    // 全员魅力压到 40 以下：意愿被压在中档之下，成算最多三成
    for (const officer of garrison) officer.stats = { ...officer.stats, charisma: 30 };
    const advice = recruitAdviceOf(state, garrison, target);

    expect(advice.viable).toBe(false);
    expect(advice.executorId).toBeUndefined();
    expect(advice.chance).toBeLessThan(RECRUIT_ADVICE_MIN_CHANCE);
    expect(advice.chance).toBeGreaterThan(0);
    // 未到门槛但并非必拒 → 不带必拒原因
    expect(advice.rejected).toBe(false);
    expect(advice.reasons).toEqual([]);

    // 成算归零（在仕忠诚高、意愿为负）：既不推举人选，也不算「必拒」
    const hopeless = recruitAdviceOf(state, garrison, state.officers['xun-yu']);
    expect(hopeless.viable).toBe(false);
    expect(hopeless.chance).toBe(0);
  });
});

describe('军师模块', () => {
  it('strategistOf：已任命的军师优先，未任命回退智力最高者', () => {
    const state = createGame('cao', 1);
    const force = state.forces.cao;
    const fallback = strategistOf(state, 'cao');
    expect(fallback?.stats.intelligence).toBeGreaterThanOrEqual(
      Object.values(state.officers).filter((o) => o.forceId === 'cao').reduce((max, o) => Math.max(max, o.stats.intelligence), 0),
    );
    // 任命低智武将后，任命优先于智力
    const appointed = Object.values(state.officers).find(
      (officer) => officer.forceId === 'cao' && officer.id !== force.leaderId && officer.stats.intelligence < 80,
    )!;
    force.strategistId = appointed.id;
    expect(strategistOf(state, 'cao')?.id).toBe(appointed.id);
  });

  it('军师评估：中档成功率（未超过 80%）同样不推举人选', () => {
    const state = createGame('liu', 1);
    // 宛的防御智力 = 郭嘉 98：智 90 的执行者判定 ≈ 60 + (90−98)×1.5 = 48，加抖动也够不到 80 门槛
    const mid = { ...state.officers['liu-bei'], stats: { ...state.officers['liu-bei'].stats, intelligence: 90 } };
    const advice = rumorAdviceOf(state, [mid], state.cities.wan);
    expect(advice.viable).toBe(false);
    expect(advice.chance).toBe(0);
  });

  it('军师评估：弱防守目标给出建议人选与成功率（超过门槛）', () => {
    const state = createGame('liu', 1);
    // 零陵（刘表）全部武将智力压到 20 → 防御智力 20
    for (const officer of Object.values(state.officers)) {
      if (officer.forceId === 'biao') withIntelligence(officer, 20);
    }
    const advice = rumorAdviceOf(state, [state.officers['liu-bei']], state.cities.lingling);
    expect(advice.viable).toBe(true);
    expect(advice.executorId).toBe('liu-bei');
    expect(advice.chance).toBeGreaterThanOrEqual(RUMOR_ADVICE_MIN_CHANCE);
  });

  it('军师评估：低于建议线则只出忠告、不推举人选', () => {
    const state = createGame('liu', 1);
    // 宛的防御智力 = 曹操势力最高智者郭嘉（智 98），智 20 的执行者判定值触底 15
    const weak = { ...state.officers['liu-bei'], stats: { ...state.officers['liu-bei'].stats, intelligence: 20 } };
    const advice = rumorAdviceOf(state, [weak], state.cities.wan);
    expect(advice.viable).toBe(false);
    expect(advice.chance).toBe(0);
  });

  it('流言成功率预估：智力持平约六成，智力差每点 ±1.5%，收敛 15 ~ 95', () => {
    const state = createGame('liu', 1);
    const base = state.officers['liu-bei'];
    const at = (intelligence: number) => ({ ...base, stats: { ...base.stats, intelligence } });
    const evenChance = rumorSuccessChanceOf(state, at(98), state.cities.wan);
    // 宛的防御智力 = 曹操势力最高智者郭嘉 98；智力持平 → 基础 60 起，另加 0~9 抖动 → 均值 64.5
    expect(evenChance).toBeCloseTo(64.5, 1);
    // 每高出 1 点智力 +1.5%：智 108 时判定值 75 起
    expect(rumorSuccessChanceOf(state, at(108), state.cities.wan)).toBeGreaterThan(evenChance);
    // 上限 95：对无主空城（防御智力 0）也不会必胜
    expect(rumorSuccessChanceOf(state, at(100), state.cities.xiangping)).toBe(RUMOR_MAX_CHANCE);
    // 下限 15：实力悬殊也留一线赌一把的机会
    expect(rumorSuccessChanceOf(state, at(10), state.cities.wan)).toBe(RUMOR_MIN_CHANCE);
  });

  it('rumorTargetOptions：列全部敌城与有人关隘，排除己方据点与空关', () => {
    const state = createGame('liu', 1);
    const options = rumorTargetOptions(state, 'liu');
    const ids = options.map((option) => option.id);
    // 敌城：宛/襄阳（曹操）、江夏/长沙（孙）、零陵/桂阳（刘表）
    expect(ids).toEqual(expect.arrayContaining(['wan', 'xiangyang', 'jiangxia', 'changsha', 'lingling', 'guiyang']));
    // 己方城池不列
    expect(ids).not.toContain('jiangling');
    expect(ids).not.toContain('wuling');
    // 空关隘（函谷关属曹操但无守将）不列
    expect(ids).not.toContain('hanguguan');
    // 派驻守将后列入
    staffPass(state, 'hanguguan', 80);
    const withGuard = rumorTargetOptions(state, 'liu').find((option) => option.id === 'hanguguan');
    expect(withGuard?.kind).toBe('pass');
    expect(withGuard?.officerCount).toBe(1);
  });

  it('对关隘散布流言（启程当旬不结算）：执行武将进入去程差旅，目标据点无变化', () => {
    const { state, guard } = startRumorJourney(2 ** 30 + 7919);
    const orderBefore = state.passes!.hanguguan.order;

    expect(state.officers['liu-bei'].location).toMatchObject({ kind: 'rumorJourney', phase: 'outbound' });
    expect(state.officers['liu-bei'].acted).toBe(true);
    // 情报未落地：治安与守将忠诚都还动不了
    expect(state.passes!.hanguguan.order).toBe(orderBefore);
    expect(state.officers[guard.id].location).toMatchObject({ kind: 'pass', passId: 'hanguguan' });
  });

  it('对关隘散布流言（成功路径）：抵达当旬治安下降、守将降忠，随后原路返程', () => {
    const { seed, executorInt, guardInt } = findRumorJourneySeed('success');
    const { state, guard } = arriveRumorJourney(seed, executorInt, guardInt);
    const orderBefore = createGame('liu', seed).passes!.hanguguan.order;

    expect(state.passes!.hanguguan.order).toBeLessThan(orderBefore);
    expect(state.logs.some((log) => log.message.includes('散布流言成功'))).toBe(true);
    // 成功后转入返程（去程=返程）
    expect(state.officers['liu-bei'].location).toMatchObject({ kind: 'rumorJourney', phase: 'return' });
    expect(state.officers[guard.id].location).toMatchObject({ kind: 'pass', passId: 'hanguguan' });
  });

  it('对关隘散布流言（被捕路径）：抵达当旬被识破，俘虏关入关隘所属城池且不再返程', () => {
    const { seed, executorInt, guardInt } = findRumorJourneySeed('captured');
    const { state } = arriveRumorJourney(seed, executorInt, guardInt);

    expect(state.officers['liu-bei'].location).toMatchObject({ kind: 'captive', cityId: 'wan', captorForceId: 'cao' });
  });

  it('流言差旅返程到点：回到出发城恢复待命', () => {
    const { seed, executorInt, guardInt } = findRumorJourneySeed('fail');
    const state = arriveRumorJourney(seed, executorInt, guardInt).state;
    const location = state.officers['liu-bei'].location;
    if (location.kind !== 'rumorJourney') throw new Error('执行武将不在返程中');
    location.remainingTenDays = 1;
    const home = settleTenDay(state);

    expect(home.officers['liu-bei'].location).toMatchObject({ kind: 'city', cityId: 'jiangling' });
    expect(home.officers['liu-bei'].acted).toBe(false);
  });

  it('差旅在途视同已行动：旬末重置不解除占用，无法被再次指派', () => {
    const { state, guard } = startRumorJourney(2 ** 30 + 7919);
    const location = state.officers['liu-bei'].location;
    if (location.kind !== 'rumorJourney') throw new Error('执行武将未进入流言差旅');
    location.remainingTenDays = 5;
    state.tenDay = 1;

    const next = settleTenDay(state);
    expect(officerIsBusy(next.officers['liu-bei'])).toBe(true);
    expect(next.officers['liu-bei'].acted).toBe(true);
    // 目标据点本旬毫发无损（流言尚未散布）
    expect(next.passes!.hanguguan.order).toBe(state.passes!.hanguguan.order);
    expect(next.officers[guard.id].location).toMatchObject({ kind: 'pass', passId: 'hanguguan' });
  });

  it('抵达时目标据点已归本方：无功而返并原路返程', () => {
    const { state } = startRumorJourney(2 ** 30 + 7919);
    const location = state.officers['liu-bei'].location;
    if (location.kind !== 'rumorJourney') throw new Error('执行武将未进入流言差旅');
    location.remainingTenDays = 1;
    state.tenDay = 1;
    // 途中函谷关已被我方攻取
    state.passes!.hanguguan.ownerId = 'liu';
    const orderBefore = state.passes!.hanguguan.order;

    const next = settleTenDay(state);

    expect(next.logs.some((log) => log.message.includes('已无需散布流言'))).toBe(true);
    expect(next.passes!.hanguguan.order).toBe(orderBefore);
    expect(next.officers['liu-bei'].location).toMatchObject({ kind: 'rumorJourney', phase: 'return' });
  });

  it('resolveRumor：对城池目标结算（回归）', () => {
    // 城池防御智力取目标势力最高智者郭嘉 98（太守智力只在无军师时兜底）
    const seed = findRumorSeed(120, 98, true);
    const state = createGame('liu', seed);
    withIntelligence(state.officers['liu-bei'], 120);
    const result = resolveRumor(state, state.officers['liu-bei'], state.cities.wan);
    expect(result.judgment).toBeGreaterThanOrEqual(RUMOR_MIN_CHANCE);
    expect(result.judgment).toBeLessThanOrEqual(RUMOR_MAX_CHANCE);
    expect(result.success).toBe(true);
    expect(result.orderLoss).toBeGreaterThan(0);
    expect(state.cities.wan.order).toBeLessThan(82);
  });
});
