import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { deployUnit } from '../game/battle/actions';
import { deploymentCells, hexGridDistance } from '../game/battle/deployment';
import { createGame } from '../game/scenario/jingxiang208';
import { GameProvider } from '../game/store/GameProvider';
import { GameShell } from './GameShell';
import type { GameState } from '../game/types';

/** 出征一支部队，并在其出生点附近放一座建设中的己方设施 */
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
      completed: false,
    },
  };
  return state;
}

/** 通过设施菜单发起并确认委任修补 */
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

  it('出征部队委任修补建设中设施：推进一旬后 +200 弹字伴随耐久真实增加', async () => {
    mockAudio();
    const user = userEvent.setup();
    const state = setupDeployedRepairState({ facilityOffset: 2 });
    render(
      <GameProvider initialState={state} storage={window.localStorage}>
        <GameShell />
      </GameProvider>,
    );

    await confirmRepairViaMenu(user);

    // 推进一旬：委任自动执行（靠近并修补）
    fireEvent.contextMenu(screen.getByTestId('map-viewport'), { clientX: 320, clientY: 180 });
    await user.click(screen.getByTestId('map-context-proceed-button'));

    // 弹字 +200 与面板耐久 400/800 必须同时成立（弹字不得脱离实际耐久）
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
    expect(screen.getByTestId('repair-confirm-note').textContent).toBe('部队出征后立即赶赴该设施修补，直至耐久修满');
    await user.click(screen.getByTestId('repair-confirm-yes'));

    // 部队真正出征：预览消失，真实部队带「委」徽章且已抵达设施旁（不再停在城池中心）
    expect(screen.queryByTestId('deploy-preview-marker')).toBeNull();
    const unitMarker = screen.getByTestId('battle-unit-marker');
    expect(screen.getByTestId('battle-unit-ready-badge').textContent).toBe('委');
    const [unitQ, unitR] = unitMarker.getAttribute('data-grid-position')!.split(',').map(Number);
    // 出生格取朝设施最近的部署格（可能就是设施格），委任立即把部队贴近到设施旁：距离 ≤ 1，下个旬起就地修补
    expect(hexGridDistance({ q: unitQ, r: unitR }, facilityPos)).toBeLessThanOrEqual(1);
  });
});
