import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { buildFacility, deployUnit } from '../game/battle/actions';
import { FACILITIES, FACILITY_BUILD_DURABILITY_PER_TEN_THOUSAND } from '../game/battle/catalog';
import { canUnitReachRepairFacility, movementAllowanceForUnit } from '../game/battle/delegate';
import { deploymentCells, hexGridDistance } from '../game/battle/deployment';
import { neighborsOf } from '../game/battle/grid';
import { createGame } from '../game/scenario/jingxiang208';
import { GameProvider } from '../game/store/GameProvider';
import { GameShell } from './GameShell';
import type { GameState } from '../game/types';

/** 出征一支部队，并在其出生点附近放一座受损的己方设施（本旬已移动的部队不能被点击选中，
 *  修补委任一律经设施菜单自动挑选下达 —— 与真实操作一致） */
function setupDeployedRepairState(opts: { facilityOffset: number; unitActed?: boolean }): GameState {
  const state = deployUnit(createGame('liu', 1), 'liu', {
    cityId: 'jiangling',
    officerId: 'guan-yu',
    targetCityId: 'xiangyang',
    troopType: 'spear',
    troops: 4000,
    food: 6000,
  });
  const unit = Object.values(state.units).find((candidate) => candidate.forceId === 'liu')!;
  if (opts.unitActed) {
    // 模拟部队本旬已完成其他行动：本旬无法再移动/修补，委任自下个旬起执行
    unit.acted = true;
    unit.movementRemaining = 0;
  }
  state.facilities = {
    'repair-target': {
      id: 'repair-target',
      type: 'drum',
      forceId: 'liu',
      q: unit.q,
      r: unit.r + opts.facilityOffset,
      durability: 200,
      completed: true,
    },
  };
  return state;
}

/** 通过设施菜单发起并确认委任修补（自动挑选最近的可达部队，含本旬已行动的出征部队） */
async function confirmRepairViaMenu(user: ReturnType<typeof userEvent.setup>) {
  const facility = document.querySelector('[data-facility-id="repair-target"]')!;
  fireEvent.pointerDown(facility, { button: 0, buttons: 1, clientX: 240, clientY: 180 });
  await user.click(screen.getByTestId('facility-repair-button'));
  await user.click(screen.getByTestId('repair-confirm-yes'));
}

/** 悬停设施，读取耐久面板文本 */
function readFacilityDurability() {
  const facility = document.querySelector('[data-facility-id="repair-target"]')!;
  fireEvent.pointerEnter(facility, { clientX: 240, clientY: 180 });
  const panel = screen.queryByTestId('facility-info-durability');
  const text = panel?.textContent ?? null;
  fireEvent.pointerLeave(facility);
  return text;
}

describe('委任修补：弹字必须与耐久实际变化一致', () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.unstubAllGlobals();
  });

  function mockAudio() {
    const play = vi.fn().mockResolvedValue(undefined);
    const AudioMock = vi.fn(function AudioMock(this: { play: typeof play; volume: number }) {
      this.play = play;
      this.volume = 1;
    });
    vi.stubGlobal('Audio', AudioMock);
  }

  it('出征落位（本旬已移动）部队的修补委任：到达当旬边走边修（+200 弹字伴随耐久真实增加），推进旬不重复修补', async () => {
    mockAudio();
    const user = userEvent.setup();
    const state = setupDeployedRepairState({ facilityOffset: 2 });
    render(
      <GameProvider initialState={state} storage={window.localStorage}>
        <GameShell />
      </GameProvider>,
    );

    await confirmRepairViaMenu(user);

    // 到达当旬边走边修（移动+修补合计一次行动）：+200 弹字与面板耐久 400/800 同时成立
    expect(screen.getByTestId('facility-repair-number').textContent).toBe('+200');
    expect(readFacilityDurability()).toBe('400/800');

    // 推进一旬：本旬行动已用掉（delegateActed），不会重复修补第二次
    fireEvent.contextMenu(screen.getByTestId('map-viewport'), { clientX: 320, clientY: 180 });
    await user.click(screen.getByTestId('map-context-proceed-button'));
    expect(readFacilityDurability()).toBe('400/800');

    // 再推进一旬：第二次修补，+200 弹字与面板耐久 600/800 同时成立
    fireEvent.contextMenu(screen.getByTestId('map-viewport'), { clientX: 320, clientY: 180 });
    await user.click(screen.getByTestId('map-context-proceed-button'));
    expect(screen.getByTestId('facility-repair-number').textContent).toBe('+200');
    expect(readFacilityDurability()).toBe('600/800');
  });

  it('本旬已行动部队确认修补委任：残留的旧建设弹字立即清除', async () => {
    mockAudio();
    const user = userEvent.setup();
    const state = setupDeployedRepairState({ facilityOffset: 2, unitActed: true });
    const unit = Object.values(state.units).find((candidate) => candidate.forceId === 'liu')!;
    // 模拟此前一次建设产生的报告（尚未被任何指令清除）
    state.facilityRepairReports = [{
      id: 'facility-repair-1-1-repair-target',
      facilityId: 'repair-target',
      q: unit.q,
      r: unit.r + 2,
      amount: 200,
      kind: 'build',
    }];
    render(
      <GameProvider initialState={state} storage={window.localStorage}>
        <GameShell />
      </GameProvider>,
    );

    // 确认前：旧 +200 弹字仍在显示
    expect(screen.getByTestId('facility-repair-number').textContent).toBe('+200');

    await confirmRepairViaMenu(user);

    // 本旬已行动的部队确认委任后不会移动/修补，但旧弹字必须消失，
    // 否则玩家会把残留弹字误读成「已修补而耐久没加」
    expect(screen.queryByTestId('facility-repair-number')).toBeNull();
  });

  it('出征落位中点设施确认修补：部队立即出征并向设施行军（本旬已行动，头顶不显示任何字）', async () => {
    mockAudio();
    const user = userEvent.setup();
    const base = createGame('liu', 1);
    const cells = deploymentCells(base, 'jiangling');
    const facilityPos = { q: cells[0]!.q + 3, r: cells[0]!.r };
    base.facilities = {
      'repair-target': {
        id: 'repair-target',
        type: 'arrowTower',
        forceId: 'liu',
        q: facilityPos.q,
        r: facilityPos.r,
        durability: 100,
        completed: false,
      },
    };
    render(
      <GameProvider initialState={base} storage={window.localStorage}>
        <GameShell />
      </GameProvider>,
    );

    // 出征编制 → 确定出征：进入落位模式，预览部队停在城池中心
    const jianglingMarker = screen.getAllByTestId('city-marker').find((marker) => marker.textContent?.includes('江陵'))!;
    await user.click(jianglingMarker);
    const menu = screen.getByTestId('city-command-menu');
    await user.click(within(menu).getByRole('button', { name: '军事' }));
    await user.click(within(menu).getByRole('button', { name: '出征' }));
    const dialog = screen.getByRole('dialog', { name: '出征编制' });
    await user.click(within(dialog).getByRole('button', { name: '确定出征' }));
    expect(screen.getByTestId('deploy-preview-marker')).toBeVisible();

    // 直接点设施：必须走「出征 + 修补委任」一次结算，而不是把委任落到别的真实部队
    const facility = document.querySelector('[data-facility-id="repair-target"]')!;
    fireEvent.pointerDown(facility, { button: 0, buttons: 1, clientX: 240, clientY: 180 });
    const confirmMenu = screen.getByTestId('repair-confirm-menu');
    expect(confirmMenu).toHaveTextContent('出征部队');
    // 出征落位部队在 state 里还不存在（unitId 是占位），确认框不再附带额外说明文字
    expect(screen.queryByTestId('repair-confirm-note')).toBeNull();
    await user.click(screen.getByTestId('repair-confirm-yes'));

    // 部队真正出征：预览消失，真实部队已抵达设施旁（不再停在城池中心）。
    // 出征+靠近就是本旬的委任行动（delegateActed）：部队本旬行动完，头顶不显示任何字，下一旬旬初才重新出现「委」
    expect(screen.queryByTestId('deploy-preview-marker')).toBeNull();
    const unitMarker = screen.getByTestId('battle-unit-marker');
    expect(screen.queryByTestId('battle-unit-ready-badge')).toBeNull();
    const [unitQ, unitR] = unitMarker.getAttribute('data-grid-position')!.split(',').map(Number);
    // 出生格取朝设施最近的部署格（可能就是设施格），委任立即把部队贴近到设施旁：距离 ≤ 1，下个旬起就地修补
    expect(hexGridDistance({ q: unitQ, r: unitR }, facilityPos)).toBeLessThanOrEqual(1);
  });

  /**
   * 玩家原话：「委任我方武将 A 修复我方武将 B 新建的军事设施没效果」。
   * 「B 新建」＝还没建成的设施（completed:false、耐久未满）—— 它同样是「耐久未满」，
   * 而且当初的建设委任一旦被手动移动清掉，这座半成品就只剩「委任另一支部队来修」这一条路。
   * 旧实现用 facilityIsCompleted 把设施菜单里的「委任修补」挡在门外，玩家点 B 新建的设施
   * 只看到「撤销」，于是表现为「委任了也没效果」。
   */
  it('B 新建、还没建成的设施：设施菜单同样给出「委任修补」，确认后推旬耐久真的上涨', async () => {
    mockAudio();
    const user = userEvent.setup();
    const state = deployUnit(createGame('liu', 1), 'liu', {
      cityId: 'jiangling',
      officerId: 'guan-yu',
      targetCityId: 'xiangyang',
      troopType: 'spear',
      troops: 4000,
      food: 6000,
    });
    const unit = Object.values(state.units).find((candidate) => candidate.forceId === 'liu')!;
    // 箭楼只建到 200/700：B 一次建不完，设施仍是「建设中」
    state.facilities = {
      'repair-target': {
        id: 'repair-target',
        type: 'arrowTower',
        forceId: 'liu',
        q: unit.q,
        r: unit.r + 2,
        durability: 200,
        completed: false,
      },
    };
    render(
      <GameProvider initialState={state} storage={window.localStorage}>
        <GameShell />
      </GameProvider>,
    );

    // 不选中部队直接点设施：菜单里必须有「委任修补」，并能自动挑到可达部队
    const facility = document.querySelector('[data-facility-id="repair-target"]')!;
    fireEvent.pointerDown(facility, { button: 0, buttons: 1, clientX: 240, clientY: 180 });
    await user.click(screen.getByTestId('facility-repair-button'));
    await user.click(screen.getByTestId('repair-confirm-yes'));

    // 确认当旬边走边修（移动+修补合计一次行动）：耐久立刻上涨 200 → 400
    expect(readFacilityDurability()).toBe('400/700');

    // 推进一旬：本旬行动已用掉，不会重复修补
    fireEvent.contextMenu(screen.getByTestId('map-viewport'), { clientX: 320, clientY: 180 });
    await user.click(screen.getByTestId('map-context-proceed-button'));
    expect(readFacilityDurability()).toBe('400/700');

    // 再推进一旬：第二次修补 400 → 600
    fireEvent.contextMenu(screen.getByTestId('map-viewport'), { clientX: 320, clientY: 180 });
    await user.click(screen.getByTestId('map-context-proceed-button'));
    expect(readFacilityDurability()).toBe('600/700');
  });

  it('委任修补的设施被其他部队抢先修好：原委任部队立刻恢复正常（徽章不再显示「委」）', async () => {
    mockAudio();
    const user = userEvent.setup();
    const state = setupDeployedRepairState({ facilityOffset: 2 });
    const delegatedUnit = Object.values(state.units).find((candidate) => candidate.forceId === 'liu')!;
    // 设施只差 1 点耐久：任何部队补一次就修满
    state.facilities!['repair-target'] = {
      ...state.facilities!['repair-target'],
      durability: 799,
      completed: true,
    };
    // 关羽（远处）挂着修补委任 —— 此时应显示「委」
    delegatedUnit.delegate = { kind: 'repair', facilityId: 'repair-target' };
    delete delegatedUnit.delegateActed;
    delegatedUnit.moved = false;
    delegatedUnit.acted = false;
    // 张飞（第二支部队）就站在设施旁，可当场把它修满
    const helperUnit = { ...delegatedUnit, id: 'helper-unit', leaderId: 'zhang-fei', r: delegatedUnit.r + 1 };
    delete helperUnit.delegate;
    state.units['helper-unit'] = helperUnit;

    render(
      <GameProvider initialState={state} storage={window.localStorage}>
        <GameShell />
      </GameProvider>,
    );

    const badgeTexts = () => screen.queryAllByTestId('battle-unit-ready-badge').map((badge) => badge.textContent);
    expect(badgeTexts()).toContain('委');

    // 委任张飞修补：他当场把设施修满 → 关羽的委任已无意义，必须立刻解除
    await confirmRepairViaMenu(user);

    expect(readFacilityDurability()).toBe('800/800');
    // 委任解除后徽章整体消失：不能只剩待执行的灰徽章
    expect(badgeTexts().filter((text) => text?.startsWith('委'))).toHaveLength(0);
  });
});

/**
 * 玩家报告复现：「我的地图2，选曹操势力，曹操先出城，张辽后出，摆了一个太鼓台，下一回合，
 * 点击曹操选择太鼓台，移动过去，**没有委任修复太鼓台**」—— 走的是「先选中部队、再点设施」
 * 这条入口（StrategicMap 用 facilityNeedsRepair 判定，不是设施菜单那条）。
 *
 * 太鼓台满耐久 800，一旬建设量 = `ceil(兵力 / 10000 × 500)`（`facilityBuildPower`）：
 *  - 张辽 7000 兵（无官职时的出征上限）→ 350/旬，一旬建不满 → 选中曹操点它**有**修补入口；
 *  - 张辽 16000 兵（高官职/加科技后的出征上限量级）→ 800/旬 → 一旬直接建满 800/800，
 *    此时**任何**修补入口都不该出现（规则文档：已建成且耐久已满的设施无需修补），
 *    设施菜单要给出置灰的「委任修补（耐久已满）」，让玩家看见「为什么不能修」。
 */
describe('选中部队点自家设施：耐久已满 / 未满 两种情形', () => {
  /** 太鼓台摆位：中原以外的空野（城池反击区内不许摆军事设施，故取远离各城的平原格） */
  const drumCell = { q: 0, r: 22 };
  const builderCell = { q: 0, r: 21 };

  /** 曹操势力「张辽先摆下一座太鼓台」的夹具：两支部队都摆在城外，曹操站在太鼓台相邻格。
   *  太鼓台走真实 `buildFacility`（不是手写设施夹具），耐久与 completed／续建委任都由引擎产生。 */
  function setupDrumScenario(opts: { zhangTroops: number; caoCell?: { q: number; r: number } }) {
    let state = createGame('cao', 1);
    // 张辽本在襄阳，先调驻宛 —— 与玩家描述一致：曹操、张辽同城先后出城
    state.officers['zhang-liao'].location = { kind: 'city', cityId: 'wan' };
    state = deployUnit(state, 'cao', {
      cityId: 'wan', officerId: 'cao-cao', targetCityId: 'xiangyang',
      troopType: 'sword', troops: 5000, gold: 2000, food: 12000,
    });
    state = deployUnit(state, 'cao', {
      cityId: 'wan', officerId: 'zhang-liao', targetCityId: 'xiangyang',
      troopType: 'sword', troops: 7000, gold: 2000, food: 12000,
    });
    const caoUnit = Object.values(state.units).find((unit) => unit.leaderId === 'cao-cao')!;
    const zhangUnit = Object.values(state.units).find((unit) => unit.leaderId === 'zhang-liao')!;
    // 两支部队行军到城外空野：张辽站在建造点旁，曹操站太鼓台另一侧相邻格（默认）
    zhangUnit.q = builderCell.q;
    zhangUnit.r = builderCell.r;
    const caoCell = opts.caoCell ?? neighborsOf(drumCell.q, drumCell.r)
      .find((cell) => cell.q !== builderCell.q || cell.r !== builderCell.r)!;
    caoUnit.q = caoCell.q;
    caoUnit.r = caoCell.r;
    // 出征上限由官职/爵位 + 科技决定（`unitTroopCapOf`），这里直接给兵力，只关心建设量公式
    zhangUnit.troops = opts.zhangTroops;
    state = buildFacility(state, 'cao', zhangUnit.id, 'drum', drumCell);
    const drumId = Object.keys(state.facilities!).find((id) => state.facilities![id].type === 'drum')!;
    // 曹操本旬未行动（模拟「下一旬」：旬初已重置 moved/acted/移动力），否则点击不会被选中
    const cao = state.units[caoUnit.id];
    cao.moved = false;
    cao.acted = false;
    cao.movementRemaining = movementAllowanceForUnit(cao);
    return { state, drumId, caoUnitId: caoUnit.id, zhangUnitId: zhangUnit.id, caoCell };
  }

  function mockAudio() {
    const play = vi.fn().mockResolvedValue(undefined);
    const AudioMock = vi.fn(function AudioMock(this: { play: typeof play; volume: number }) {
      this.play = play;
      this.volume = 1;
    });
    vi.stubGlobal('Audio', AudioMock);
  }

  function renderScenario(state: GameState) {
    render(
      <GameProvider initialState={state} storage={window.localStorage}>
        <GameShell />
      </GameProvider>,
    );
  }

  /** 点击曹操的部队标记（选中他） */
  function selectCao(caoCell: { q: number; r: number }) {
    const marker = screen.getAllByTestId('battle-unit-marker')
      .find((candidate) => candidate.getAttribute('data-grid-position') === `${caoCell.q},${caoCell.r}`)!;
    fireEvent.pointerDown(marker, { button: 0, buttons: 1, clientX: 240, clientY: 180 });
  }

  /** 点击太鼓台（选中部队后的「先选部队、再点设施」入口） */
  function clickDrum(drumId: string) {
    const facility = document.querySelector(`[data-facility-id="${drumId}"]`)!;
    fireEvent.pointerDown(facility, { button: 0, buttons: 1, clientX: 240, clientY: 180 });
  }

  beforeEach(() => {
    window.localStorage.clear();
    vi.unstubAllGlobals();
  });

  it('张辽一旬建满（800/800）：没有修补入口，设施菜单给出置灰的「委任修补（耐久已满）」', () => {
    mockAudio();
    // 一次建设量 ≥ 800 ⇔ 兵力 ≥ 16000（= 800 ÷ 500 × 10000，由耐久与每万兵力建设量推出，不写死数字）
    const drumDurability = FACILITIES.drum!.durability;
    const oneTenDayTroops = Math.ceil(drumDurability / FACILITY_BUILD_DURABILITY_PER_TEN_THOUSAND * 10000);
    const { state, drumId, caoCell } = setupDrumScenario({ zhangTroops: oneTenDayTroops });
    // 一旬建满：耐久满值、completed 为真、张辽的续建委任已被清除（引擎侧「无需修补」）
    expect(state.facilities![drumId]).toMatchObject({ durability: 800, completed: true });
    expect(state.units[Object.values(state.units).find((unit) => unit.leaderId === 'zhang-liao')!.id].delegate).toBeUndefined();

    renderScenario(state);
    selectCao(caoCell);
    clickDrum(drumId);

    // 耐久已满 → 不该弹修补确认；设施菜单必须打开，并给出「为什么不能修」的置灰项
    expect(screen.queryByTestId('repair-confirm-menu')).toBeNull();
    const menu = screen.getByTestId('facility-context-menu');
    const repairButton = within(menu).getByTestId('facility-repair-button');
    expect(repairButton).toBeDisabled();
    expect(repairButton.textContent).toBe('委任修补（耐久已满）');
  });

  it('张辽只建到一半（350/800）：选中曹操点太鼓台给出修补入口，确认后委任确实落在曹操头上', async () => {
    mockAudio();
    const user = userEvent.setup();
    const { state, drumId, caoUnitId, caoCell } = setupDrumScenario({ zhangTroops: 7000 });
    // 7000 兵 = 350/旬：一旬只能建到 350/800，completed 仍为 false
    expect(state.facilities![drumId]).toMatchObject({ durability: 350, completed: false });
    // 曹操就站在太鼓台相邻格，引擎口径下可执行修补委任
    expect(canUnitReachRepairFacility(state, caoUnitId, drumId)).toBe(true);

    renderScenario(state);
    selectCao(caoCell);
    clickDrum(drumId);

    // 选中曹操 → 直接弹修补确认，且确认框写的就是曹操（不是自动换成的别人）
    const confirm = screen.getByTestId('repair-confirm-menu');
    expect(confirm).toHaveTextContent('曹操');
    expect(screen.queryByTestId('facility-context-menu')).toBeNull();

    await user.click(screen.getByTestId('repair-confirm-yes'));

    const saved = JSON.parse(window.localStorage.getItem('jingxiang-208-autosave-v1')!) as {
      units: Record<string, { delegate?: { kind: string; facilityId?: string } }>;
    };
    expect(saved.units[caoUnitId].delegate).toEqual({ kind: 'repair', facilityId: drumId });
  });

  /**
   * 顺带核实的相邻缺陷：`promptRepairConfirm` 在「已选中的部队不可达」时会**静默改用最近的可达部队**
   * （`pickRepairCandidateUnit`）—— 玩家以为委任了曹操，实际派了张辽。这里把它钉死为现状：
   * 曹操被己方部队围死（六个邻格全占）→ 引擎判他不可达 → 点太鼓台弹出的确认框写的是张辽。
   */
  it('已选中的曹操不可达：确认框静默改用可达的张辽（现状，非本次故障直接原因）', () => {
    mockAudio();
    const caoCell = { q: 20, r: 20 };
    const { state, drumId, caoUnitId, zhangUnitId } = setupDrumScenario({ zhangTroops: 7000, caoCell });
    // 用六支己方部队把曹操围死（部队占据格在寻路里一律不可穿越）
    const blockerLeaders = ['xu-huang', 'yu-jin', 'yue-jin', 'xun-yu', 'cao-ren', 'xiahou-dun'];
    neighborsOf(caoCell.q, caoCell.r).forEach((cell, index) => {
      const blocker = {
        ...state.units[caoUnitId],
        id: `blocker-${index}`,
        leaderId: blockerLeaders[index]!,
        q: cell.q,
        r: cell.r,
      };
      delete blocker.delegate;
      state.units[blocker.id] = blocker;
    });
    expect(canUnitReachRepairFacility(state, caoUnitId, drumId)).toBe(false);
    expect(canUnitReachRepairFacility(state, zhangUnitId, drumId)).toBe(true);

    renderScenario(state);
    selectCao(caoCell);
    clickDrum(drumId);

    const confirm = screen.getByTestId('repair-confirm-menu');
    expect(confirm).toHaveTextContent('张辽');
    expect(confirm).not.toHaveTextContent('曹操');
  });
});
