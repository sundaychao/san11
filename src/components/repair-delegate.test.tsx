import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { deployUnit } from '../game/battle/actions';
import { deploymentCells, hexGridDistance } from '../game/battle/deployment';
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

  it('出征落位（本旬已移动）部队的修补委任：下达当旬已用于靠近，再推进一旬才首次修补（+200 弹字伴随耐久真实增加）', async () => {
    mockAudio();
    const user = userEvent.setup();
    const state = setupDeployedRepairState({ facilityOffset: 2 });
    render(
      <GameProvider initialState={state} storage={window.localStorage}>
        <GameShell />
      </GameProvider>,
    );

    await confirmRepairViaMenu(user);

    // 推进一旬：确认时的「靠近」已消耗本旬的委任行动（一旬只执行一次），本次结算不再修补
    fireEvent.contextMenu(screen.getByTestId('map-viewport'), { clientX: 320, clientY: 180 });
    await user.click(screen.getByTestId('map-context-proceed-button'));
    expect(screen.queryByTestId('facility-repair-number')).toBeNull();

    // 再推进一旬（下一旬结算）：首次修补，弹字 +200 与面板耐久 400/800 必须同时成立（弹字不得脱离实际耐久）
    fireEvent.contextMenu(screen.getByTestId('map-viewport'), { clientX: 320, clientY: 180 });
    await user.click(screen.getByTestId('map-context-proceed-button'));
    expect(screen.getByTestId('facility-repair-number').textContent).toBe('+200');
    expect(readFacilityDurability()).toBe('400/800');
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

  it('出征落位中点设施确认修补：部队立即出征并带「委」字向设施行军', async () => {
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
    // 出征+靠近就是本旬的委任行动（delegateActed）：「委」徽章隐藏，下一旬旬初重新显示
    expect(screen.queryByTestId('deploy-preview-marker')).toBeNull();
    const unitMarker = screen.getByTestId('battle-unit-marker');
    expect(screen.queryByTestId('battle-unit-ready-badge')).not.toBeInTheDocument();
    const [unitQ, unitR] = unitMarker.getAttribute('data-grid-position')!.split(',').map(Number);
    // 出生格取朝设施最近的部署格（可能就是设施格），委任立即把部队贴近到设施旁：距离 ≤ 1，下个旬起就地修补
    expect(hexGridDistance({ q: unitQ, r: unitR }, facilityPos)).toBeLessThanOrEqual(1);
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
    expect(badgeTexts()).not.toContain('委');
  });
});
