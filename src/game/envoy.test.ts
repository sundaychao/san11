import { describe, expect, it } from 'vitest';
import { envoyTravelTenDays, executeCommand, officerIsBusy, strongholdTransferDistance, strongholdTransferDuration } from './commands';
import { DIPLOMACY_ACTIONS, DIPLOMACY_GOLD_STEP, NEUTRAL_DIPLOMACY, forceDiplomacy, leaderCityOf, requiredAllianceGold, requiredTruceGold, resolveAlliance, resolveTruce } from './diplomacy';
import { createGame } from './scenario/jingxiang208';
import { diplomacyAdviceOf } from './strategist';
import { settleTenDay } from './turn';
import type { ForceId, GameState, Officer, OfficerLocation } from './types';

/**
 * 外交出使行程（`OfficerLocation['kind'] === 'envoy'`）：
 * 使者真的走这一趟 —— 去程按「出发据点 → 对方君主所在城池」的移动旬数计（1旬 = 10天），
 * 抵达当旬才结算外交效果，随后自动返程，回到出发据点才恢复可用。
 *
 * 场景固定值（江陵 → 宛 = 曼哈顿距离 50 → 5 旬 = 50 天，曹操的君主曹操驻宛）。
 */
const PLAYER: ForceId = 'liu';
const CITY = 'jiangling';
const TARGET: ForceId = 'cao';
const OUTBOUND = 5;

function game() {
  return createGame('liu', 1);
}

/** 江陵待命、本旬未行动的己方武将（对话框默认按政治降序取首位） */
function idleOfficer(state: GameState): Officer {
  const found = Object.values(state.officers)
    .filter((officer) =>
      officer.forceId === PLAYER && !officer.acted && !officer.deathMonth
      && officer.location.kind === 'city' && officer.location.cityId === CITY)
    .sort((a, b) => b.stats.politics - a.stats.politics)[0];
  if (!found) throw new Error('江陵没有待命武将');
  return found;
}

function dispatch(state: GameState, action: (typeof DIPLOMACY_ACTIONS)[number] = 'goodwill') {
  const officer = idleOfficer(state);
  const next = executeCommand(state, PLAYER, {
    type: 'diplomacy',
    cityId: CITY,
    officerId: officer.id,
    targetForceId: TARGET,
    action,
    gold: action === 'alliance' || action === 'truce' ? 2000 : undefined,
    months: action === 'truce' ? 6 : undefined,
  });
  const location = next.officers[officer.id].location;
  if (location.kind !== 'envoy') throw new Error('未生成外交使者');
  return { next, officer, location };
}

function locationOf(state: GameState, officerId: string): OfficerLocation {
  return state.officers[officerId].location;
}

/** 推进 n 旬 */
function advance(state: GameState, tenDays: number) {
  let next = state;
  for (let index = 0; index < tenDays; index += 1) next = settleTenDay(next);
  return next;
}

/**
 * 模拟江陵被曹操攻占：驻将撤往武陵、太守清空、归属易主。
 * 只改 ownerId 会留下「己方武将住在敌城」的不自洽状态，验证不到使者返程这条路径。
 */
function loseJiangling(state: GameState) {
  for (const officer of Object.values(state.officers)) {
    if (officer.forceId !== PLAYER) continue;
    if (officer.location.kind !== 'city' || officer.location.cityId !== CITY) continue;
    officer.location = { kind: 'city', cityId: 'wuling' };
    officer.cityId = 'wuling';
  }
  state.cities[CITY].ownerId = TARGET;
  state.cities[CITY].governorId = null;
  state.cities[CITY].troops = 0;
}

describe('据点间移动耗时（主径跳数口径）', () => {
  it('主径直接相连的城池：1 旬 = 10 天', () => {
    const state = game();
    // 江陵 → 襄阳：主径直连（直线口径本为 3 旬，按主径缩短为 1 旬）
    expect(strongholdTransferDuration(state, state.cities.jiangling, state.cities.xiangyang)).toBe(1);
    // 宛 → 许昌：主径直连
    expect(strongholdTransferDuration(state, state.cities.wan, state.cities.xuchang)).toBe(1);
  });

  it('主径链上中间隔一座据点：+1 旬（关隘也算节点）', () => {
    const state = game();
    // 洛阳 → 函谷关 → 宛：中间隔一座关隘 = 2 旬 = 20 天
    expect(state.passes?.hanguguan).toBeDefined();
    expect(strongholdTransferDuration(state, state.cities.luoyang, state.cities.wan)).toBe(2);
    // 长沙 → 零陵：主径链 2 旬（直线口径 6 旬，按主径缩短）
    expect(strongholdTransferDuration(state, state.cities.changsha, state.cities.lingling)).toBe(2);
  });

  it('主径链路比直线绕远时按直线口径保底，耗时不超过旧的直线旬数', () => {
    const state = game();
    // 襄阳 → 新野：直线 2 旬；主径链需绕行 9 旬 → 按直线口径取 2 旬
    const straight = Math.max(1, Math.ceil(strongholdTransferDistance(state.cities.xiangyang, state.cities.xinye) / 10));
    expect(straight).toBe(2);
    expect(strongholdTransferDuration(state, state.cities.xiangyang, state.cities.xinye)).toBe(2);
  });
});

describe('出使目的地与行程', () => {
  it('目的地取对方君主所在城池，行程 = 据点间移动旬数（1旬 = 10天）', () => {
    const state = game();
    const leaderCity = leaderCityOf(state, TARGET);
    expect(leaderCity?.id).toBe('wan');

    const tenDays = envoyTravelTenDays(state, state.cities[CITY], TARGET);
    expect(tenDays).toBe(strongholdTransferDuration(state, state.cities[CITY], leaderCity!));
    expect(tenDays).toBe(OUTBOUND);
    // 江陵 → 宛：主径链绕行 8 旬超过直线 5 旬 → 按直线口径 5 旬 = 50 天
    expect(tenDays! * 10).toBe(50);
  });

  it('君主换驻另一座城时目的地随之变化', () => {
    const state = game();
    const leader = state.officers[state.forces[TARGET].leaderId!];
    const other = Object.values(state.cities).find((city) => city.ownerId === TARGET && city.id !== 'wan')!;
    expect(other).toBeDefined();

    leader.location = { kind: 'city', cityId: other.id };
    expect(leaderCityOf(state, TARGET)?.id).toBe(other.id);
    expect(envoyTravelTenDays(state, state.cities[CITY], TARGET))
      .toBe(strongholdTransferDuration(state, state.cities[CITY], other));
  });

  it('目标势力已无城池时无法出使（leaderCityOf 返回 null）', () => {
    const state = game();
    for (const city of Object.values(state.cities)) if (city.ownerId === TARGET) city.ownerId = null;
    expect(leaderCityOf(state, TARGET)).toBeNull();
    expect(envoyTravelTenDays(state, state.cities[CITY], TARGET)).toBeNull();
  });
});

describe('外交出使行程', () => {
  it('派出使者：武将转入在途、礼金出发即扣、友好度尚未变化', () => {
    const state = game();
    const officer = idleOfficer(state);
    const goldBefore = state.cities[CITY].gold;

    const { next, location } = dispatch(state);

    expect(location).toMatchObject({ phase: 'outbound', targetForceId: TARGET, action: 'goodwill' });
    expect(location.outboundTenDays).toBe(OUTBOUND);
    expect(location.returnTenDays).toBe(OUTBOUND);
    expect(location.remainingTenDays).toBe(OUTBOUND);
    expect(location.fromCityId).toBe(CITY);
    // 礼金随使者出发，效果要等抵达才生效
    expect(next.cities[CITY].gold).toBe(goldBefore - 1000);
    expect(forceDiplomacy(next, PLAYER, TARGET)).toBe(NEUTRAL_DIPLOMACY);
    // 武将整段出使期间不可再被指派
    expect(next.officers[officer.id].acted).toBe(true);
    expect(officerIsBusy(next.officers[officer.id])).toBe(true);
    // 原状态不被就地改写
    expect(state.officers[officer.id].location.kind).toBe('city');
  });

  it('抵达当旬才结算效果，之后自动返程，回到据点后恢复可用', () => {
    const state = game();
    const officer = idleOfficer(state);
    let next = dispatch(state).next;

    // 去程未走完：友好度不变、仍在途中
    for (let index = 1; index < OUTBOUND; index += 1) {
      next = settleTenDay(next);
      expect(forceDiplomacy(next, PLAYER, TARGET)).toBe(NEUTRAL_DIPLOMACY);
      expect(locationOf(next, officer.id).kind).toBe('envoy');
    }

    // 抵达当旬：结算亲善并转入返程
    next = settleTenDay(next);
    expect(forceDiplomacy(next, PLAYER, TARGET)).toBeGreaterThan(NEUTRAL_DIPLOMACY);
    const arrived = locationOf(next, officer.id);
    if (arrived.kind !== 'envoy') throw new Error('抵达当旬应转入返程，而不是直接回城');
    expect(arrived.phase).toBe('return');
    expect(arrived.remainingTenDays).toBe(OUTBOUND);
    expect(next.logs.some((log) => log.message.includes('增进双方友好度'))).toBe(true);

    // 返程未走完：效果已生效但人还没回来
    for (let index = 1; index < OUTBOUND; index += 1) next = settleTenDay(next);
    expect(locationOf(next, officer.id).kind).toBe('envoy');

    // 返程到点：回到出发城池并解除占用
    next = settleTenDay(next);
    expect(locationOf(next, officer.id)).toEqual({ kind: 'city', cityId: CITY });
    expect(next.officers[officer.id].acted).toBe(false);
    expect(officerIsBusy(next.officers[officer.id])).toBe(false);
    expect(next.logs.some((log) => log.message.includes('出使归来'))).toBe(true);
  });

  it('五种外交行动共用同一套行程规则', () => {
    for (const action of DIPLOMACY_ACTIONS) {
      const state = game();
      // 请求援军/破弃同盟要求双方为同盟；同盟本身则要求尚未结盟
      if (action === 'requestTroops' || action === 'break') state.forces[PLAYER].allies = [TARGET];
      const { location } = dispatch(state, action);

      expect(location.action).toBe(action);
      expect(location.outboundTenDays).toBe(OUTBOUND);
      expect(location.returnTenDays).toBe(OUTBOUND);
      expect(location.remainingTenDays).toBe(OUTBOUND);
      expect(location.phase).toBe('outbound');
    }
  });

  it('同盟要在使者抵达当旬才登记，点确定的那一刻不生效', () => {
    const state = game();
    const officer = idleOfficer(state);
    let next = dispatch(state, 'alliance').next;

    expect(next.forces[PLAYER].allies ?? []).toEqual([]);
    for (let index = 1; index < OUTBOUND; index += 1) {
      next = settleTenDay(next);
      expect(next.forces[PLAYER].allies ?? []).toEqual([]);
    }
    // 抵达当旬判定：无论成败，友好度都会变动（成功 +10 / 失败 −10）
    next = settleTenDay(next);
    expect(forceDiplomacy(next, PLAYER, TARGET)).not.toBe(NEUTRAL_DIPLOMACY);
    expect(locationOf(next, officer.id).kind).toBe('envoy');
  });

  it('目标势力在途中灭亡：不结算、友好度不变、使者无功而返', () => {
    const state = game();
    let next = dispatch(state).next;
    for (const city of Object.values(next.cities)) if (city.ownerId === TARGET) city.ownerId = null;

    next = advance(next, OUTBOUND);
    expect(forceDiplomacy(next, PLAYER, TARGET)).toBe(NEUTRAL_DIPLOMACY);
    expect(next.logs.some((log) => log.message.includes('无功而返'))).toBe(true);
    // 仍然会返程，不会把人卡在境外
    next = advance(next, OUTBOUND);
    expect(Object.values(next.officers).some((officer) => officer.location.kind === 'envoy')).toBe(false);
  });

  it('出发据点在途中被夺：返程改回本方仍持有的城池，而不是回到敌占城', () => {
    const state = game();
    const officer = idleOfficer(state);
    let next = dispatch(state).next;
    // 出使途中江陵被曹操攻占（刘备另有武陵）
    loseJiangling(next);

    next = advance(next, OUTBOUND * 2);
    expect(locationOf(next, officer.id)).toEqual({ kind: 'city', cityId: 'wuling' });
    expect(next.officers[officer.id].acted).toBe(false);
  });

  it('自己势力覆灭（无城可归）：使者不卡在境外，也不会占用敌方城池做落脚点', () => {
    const state = game();
    const officer = idleOfficer(state);
    let next = dispatch(state).next;
    // 出使途中刘备丢失全部城池与关隘：使者回来时已无本方据点可归
    for (const city of Object.values(next.cities)) if (city.ownerId === PLAYER) city.ownerId = TARGET;
    for (const pass of Object.values(next.passes ?? {})) if (pass.ownerId === PLAYER) pass.ownerId = TARGET;

    next = advance(next, OUTBOUND * 2);
    // 不能残留 envoy 把人永久锁在途中
    expect(Object.values(next.officers).some((item) => item.location.kind === 'envoy')).toBe(false);
    expect(locationOf(next, officer.id)).toEqual({ kind: 'unaffiliated', cityId: CITY });
    expect(next.officers[officer.id].acted).toBe(false);
  });

  it('使者跨月也保持已行动（不被旬末的 acted 重置释放）', () => {
    const state = game();
    const officer = idleOfficer(state);
    // 先推进到月底再出发，确保跨 settleMonth
    let next = settleTenDay(settleTenDay(state));
    const goldBefore = next.cities[CITY].gold;
    next = executeCommand(next, PLAYER, {
      type: 'diplomacy', cityId: CITY, officerId: officer.id, targetForceId: TARGET, action: 'goodwill',
    });
    expect(next.cities[CITY].gold).toBe(goldBefore - 1000);

    for (let index = 0; index < 3; index += 1) {
      next = settleTenDay(next);
      expect(next.officers[officer.id].acted).toBe(true);
    }
  });
});

/**
 * 外交军师评估：同盟/停战判定式是确定式（无随机），军师据此报「能否谈成」与所需最低礼金。
 * 这组用例守的是「报出的礼金 = 恰好能谈成的最小值」——判定式一改，这里必然报出来。
 */
describe('外交军师评估：所需礼金与判定式一致', () => {
  /** 江陵待命武将中政治最高者（刘备 80）——军师未指定使者时用的就是他 */
  function topEnvoy(state: GameState): Officer {
    return Object.values(state.officers)
      .filter((officer) => officer.forceId === PLAYER
        && officer.location.kind === 'city' && officer.location.cityId === CITY)
      .sort((a, b) => b.stats.politics - a.stats.politics)[0];
  }

  it('同盟：给足所需礼金即谈成，少一个滑块步长即谈不成', () => {
    const state = createGame(PLAYER, 3);
    const envoy = topEnvoy(state);
    expect(envoy.name).toBe('刘备');
    const needed = requiredAllianceGold(state, PLAYER, 'cao', envoy);
    expect(needed).toBeGreaterThan(0);
    expect(needed % DIPLOMACY_GOLD_STEP).toBe(0);

    expect(resolveAlliance(state, PLAYER, 'cao', envoy, needed).success).toBe(true);
    expect(resolveAlliance(state, PLAYER, 'cao', envoy, needed - DIPLOMACY_GOLD_STEP).success).toBe(false);
  });

  it('停战：期限越长所需礼金越多（24 个月比 1 个月贵），给足即谈成', () => {
    const state = createGame(PLAYER, 3);
    const envoy = topEnvoy(state);
    const short = requiredTruceGold(state, PLAYER, 'biao', envoy, 1);
    const long = requiredTruceGold(state, PLAYER, 'biao', envoy, 24);
    expect(long).toBeGreaterThan(short);

    expect(resolveTruce(state, PLAYER, 'biao', envoy, long, 24).success).toBe(true);
    expect(resolveTruce(state, PLAYER, 'biao', envoy, long - DIPLOMACY_GOLD_STEP, 24).success).toBe(false);
  });

  it('军师评估：未指定使者即无从评估；礼金不足时报所需金额，给足则转为可行', () => {
    const state = createGame(PLAYER, 3);
    expect(diplomacyAdviceOf(state, PLAYER, 'cao', 'alliance', undefined, 0, 1)).toBeNull();

    const envoy = topEnvoy(state);
    const poor = diplomacyAdviceOf(state, PLAYER, 'cao', 'alliance', envoy, 0, 1)!;
    expect(poor.viable).toBe(false);
    expect(poor.requiredGold).toBe(requiredAllianceGold(state, PLAYER, 'cao', envoy));
    expect(poor.executorName).toBe('刘备');

    const rich = diplomacyAdviceOf(state, PLAYER, 'cao', 'alliance', envoy, poor.requiredGold, 1)!;
    expect(rich.viable).toBe(true);
    expect(rich.requiredGold).toBe(0);
  });
});
