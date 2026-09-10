import { act, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { initialArmaments } from '../game/armaments';
import { deployTransportUnit, deployUnit, deployUnitPreviewWithId, movementCells } from '../game/battle/actions';
import { movementAllowanceForProfile } from '../game/battle/definitions';
import { deploymentCells, chooseDelegateSpawnCell } from '../game/battle/deployment';
import { getDeploymentTargets } from '../game/battle/queries';
import { gridKey, neighborsOf, sevenCellCityFootprint } from '../game/battle/grid';
import { computeDelegatePath, setMoveDelegate } from '../game/battle/delegate';
import { deployUnitWithId } from '../game/battle/deployment';
import { executeCommand } from '../game/commands';
import { createGame } from '../game/scenario/jingxiang208';
import { GameProvider } from '../game/store/GameProvider';
import { settleTenDay } from '../game/turn';
import { GameShell } from './GameShell';

function renderState(state = createGame('liu', 3)) {
  return render(
    <GameProvider initialState={state}>
      <GameShell />
    </GameProvider>,
  );
}

// 默认最高角度视野约 30 格且中心在地图中心 (100,100)；测试视口 fallback 1280×720。
// 地图层等比（方格不变形）渲染：横向 1 格约 42.7px，纵向每格与横向相同。
function panMapTo(q: number, r: number) {
  // 单机开局镜头会自动居中到君主城池；先复位到地图中心，保证下面的平移量计算成立
  fireEvent.click(screen.getByRole('button', { name: '复位地图' }));
  const cellPxX = (1280 * 6.67) / 200;
  const cellPxY = cellPxX; // 等比后纵向每格像素 = 横向每格像素
  const viewport = screen.getByTestId('map-viewport');
  fireEvent.pointerDown(viewport, { pointerId: 1, button: 0, buttons: 1, clientX: 640, clientY: 360 });
  fireEvent.pointerMove(viewport, { pointerId: 1, clientX: 640 + (100 - q) * cellPxX, clientY: 360 + (100 - r) * cellPxY });
  fireEvent.pointerUp(viewport, { pointerId: 1 });
}

function officerNamesIn(dialog: HTMLElement) {
  return within(dialog).getAllByRole('rowheader').map((header) => header.textContent ?? '');
}

async function chooseDeployLeader(user: ReturnType<typeof userEvent.setup>, officerName = '刘备') {
  const deployDialog = screen.getByRole('dialog', { name: '出征编制' });
  await user.click(within(deployDialog).getByRole('button', { name: '选择武将' }));
  const officerDialog = screen.getByRole('dialog', { name: '武将选择' });
  await user.click(within(officerDialog).getByRole('button', { name: `选择${officerName}为主将` }));
  await user.click(within(officerDialog).getByRole('button', { name: '确定武将' }));
  return screen.getByRole('dialog', { name: '出征编制' });
}

function cityKeys(state: ReturnType<typeof createGame>) {
  return new Set(Object.values(state.cities).flatMap((city) => (
    sevenCellCityFootprint({ q: city.gridQ, r: city.gridR }).map(gridKey)
  )));
}

function passableNonCityCell(state: ReturnType<typeof createGame>, coord: { q: number; r: number }) {
  const cell = state.grid.find((candidate) => candidate.q === coord.q && candidate.r === coord.r);
  return Boolean(cell && !['mountain', 'deepWater'].includes(cell.terrain) && !cityKeys(state).has(gridKey(coord)));
}

function destinationWithEnemyNeighbor(state: ReturnType<typeof createGame>, unitId: string) {
  for (const destination of movementCells(state, unitId)) {
    const enemyPosition = neighborsOf(destination.q, destination.r)
      .find((coord) => (
        passableNonCityCell(state, coord) &&
        !Object.values(state.units).some((unit) => unit.q === coord.q && unit.r === coord.r)
      ));
    if (enemyPosition) return { destination, enemyPosition };
  }
  throw new Error('No destination with enemy neighbor found');
}

describe('command interface', { timeout: 30000 }, () => {
  it('shows and enables every 百出 strategy at the shared one-energy cost', async () => {
    const user = userEvent.setup();
    const state = deployUnit(createGame('liu', 1), 'liu', {
      cityId: 'jiangling', officerId: 'liu-bei', troops: 3000, food: 3000,
    });
    const caster = Object.values(state.units)[0];
    state.officers['liu-bei'].skill = '百出';
    state.officers['liu-bei'].location = { kind: 'unit', unitId: caster.id };
    Object.assign(caster, { q: 10, r: 10, energy: 1, moved: false, acted: false, movementRemaining: 22 });
    state.officers['cao-ren'].location = { kind: 'unit', unitId: 'strategy-menu-target' };
    state.units['strategy-menu-target'] = {
      id: 'strategy-menu-target', kind: 'combat', forceId: 'cao', leaderId: 'cao-ren', officerIds: ['cao-ren'],
      homeCityId: 'xiangyang', troopType: 'sword', q: 11, r: 10, troops: 3000, food: 3000,
      energy: 100, movementRemaining: 20, moved: false, acted: false,
    };
    renderState(state);
    panMapTo(10, 10);

    const marker = screen.getAllByTestId('battle-unit-marker')
      .find((candidate) => candidate.getAttribute('data-grid-position') === '10,10')!;
    fireEvent.pointerDown(marker, { button: 0, buttons: 1, clientX: 240, clientY: 180 });
    fireEvent.pointerDown(marker, { button: 0, buttons: 1, clientX: 240, clientY: 180 });
    const strategyCommand = within(screen.getByTestId('unit-command-menu')).getByRole('button', { name: '计略' });

    expect(strategyCommand).toBeEnabled();
    await user.click(strategyCommand);
    const strategyMenu = screen.getByTestId('unit-strategy-menu');
    for (const button of within(strategyMenu).getAllByRole('button')) {
      expect(button).toHaveTextContent(/（1）$/);
    }
    expect(within(strategyMenu).getByRole('button', { name: '火计（1）' })).toBeEnabled();
    expect(within(strategyMenu).getByRole('button', { name: '扰乱（1）' })).toBeEnabled();

    await user.click(within(strategyMenu).getByRole('button', { name: '火计（1）' }));
    expect(screen.getByTestId('strategy-target-11-10')).toBeVisible();
    const enemyUnit = screen.getAllByTestId('battle-unit-marker')
      .find((candidate) => candidate.getAttribute('data-grid-position') === '11,10')!;
    fireEvent.pointerDown(enemyUnit, { button: 0, buttons: 1, clientX: 280, clientY: 180 });

    expect(screen.queryByTestId('unit-command-menu')).not.toBeInTheDocument();

    const actedCaster = screen.getAllByTestId('battle-unit-marker')
      .find((candidate) => candidate.getAttribute('data-grid-position') === '10,10')!;
    fireEvent.pointerDown(actedCaster, { button: 0, buttons: 1, clientX: 240, clientY: 180 });
    fireEvent.pointerDown(actedCaster, { button: 0, buttons: 1, clientX: 240, clientY: 180 });
    expect(screen.queryByTestId('unit-command-menu')).not.toBeInTheDocument();
  });

  it('confirms before ending a month with legal actions remaining', async () => {
    const user = userEvent.setup();
    renderState();

    await user.click(screen.getByRole('button', { name: '进行到下月' }));

    expect(screen.getByRole('dialog', { name: '结束本月' })).toBeVisible();
    await user.click(screen.getByRole('button', { name: '确认进行' }));
    expect(screen.queryByRole('dialog', { name: '结束本月' })).not.toBeInTheDocument();
    expect(screen.getByText('五月')).toBeVisible();
  });

  it('closes the end-month confirmation popup on right click', async () => {
    const user = userEvent.setup();
    renderState();

    await user.click(screen.getByTestId('end-month-button'));
    const dialog = screen.getAllByRole('dialog')[0];

    const defaultWasAllowed = fireEvent.contextMenu(dialog);

    expect(defaultWasAllowed).toBe(false);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('opens a categorized force officer list with ownership, stats, skills, aptitudes, and status', async () => {
    const user = userEvent.setup();
    renderState();

    await user.click(screen.getByTestId('open-officer-list-button'));

    const dialog = screen.getByRole('dialog', { name: '武将一览' });
    expect(within(dialog).getByRole('button', { name: '所属' })).toHaveClass('is-active');
    expect(within(dialog).getByRole('button', { name: '能力' })).toBeVisible();
    expect(within(dialog).getByRole('button', { name: '特技' })).toBeVisible();
    expect(within(dialog).getByRole('button', { name: '适性' })).toBeVisible();
    expect(within(dialog).getByRole('button', { name: '状态' })).toBeVisible();
    const officerRow = (name: string) => within(dialog).getByRole('rowheader', { name }).closest('tr')!;

    const ownershipRow = officerRow('刘备');
    expect(ownershipRow).toHaveTextContent('江陵');
    expect(ownershipRow).toHaveTextContent('47岁');

    await user.click(within(dialog).getByRole('button', { name: '能力' }));
    const abilityRow = officerRow('刘备');
    expect(within(dialog).getByText('统帅')).toBeVisible();
    expect(within(dialog).getByText('武力')).toBeVisible();
    expect(within(dialog).getByText('智力')).toBeVisible();
    expect(within(dialog).getByText('政治')).toBeVisible();
    expect(within(dialog).getByText('魅力')).toBeVisible();
    expect(abilityRow).toHaveTextContent('78');
    expect(within(abilityRow).getByText('75')).toBeVisible();
    expect(within(abilityRow).getByText('99')).toBeVisible();

    await user.click(within(dialog).getByRole('button', { name: '特技' }));
    expect(within(dialog).getByRole('button', { name: '按说明排序' })).toBeVisible();
    expect(officerRow('刘备')).toHaveTextContent('仁德');
    expect(officerRow('刘备')).toHaveTextContent('项目自定义特技，效果将在单独规则设计中启用');
    const noSkillCells = within(officerRow('糜芳')).getAllByRole('cell');
    expect(noSkillCells[0].textContent).toBe('—');
    expect(noSkillCells[1].textContent).toBe('');

    await user.click(within(dialog).getByRole('button', { name: '适性' }));
    expect(within(dialog).getByText('枪')).toBeVisible();
    expect(within(dialog).getByText('戟')).toBeVisible();
    expect(within(dialog).getByText('弩')).toBeVisible();
    expect(within(dialog).getByText('骑')).toBeVisible();
    expect(within(dialog).getByText('兵器')).toBeVisible();
    expect(within(dialog).getByText('水军')).toBeVisible();
    const aptitudeCells = within(officerRow('刘备')).getAllByRole('cell').map((cell) => cell.textContent);
    expect(aptitudeCells).toEqual(['A', 'A', 'B', 'B', 'C', 'C']);
  });

  it('sorts every officer-list column from its header and toggles direction', async () => {
    const user = userEvent.setup();
    const state = createGame('liu', 3);
    renderState(state);

    await user.click(screen.getByTestId('open-officer-list-button'));
    const dialog = screen.getByRole('dialog', { name: '武将一览' });
    const playerOfficers = Object.values(state.officers).filter((officer) => officer.forceId === state.playerForceId);

    for (const header of ['武将', '城池', '所在']) {
      expect(within(dialog).getByRole('button', { name: `按${header}排序` })).toBeVisible();
    }

    await user.click(within(dialog).getByRole('button', { name: '按武将排序' }));
    expect(officerNamesIn(dialog)).toEqual(
      [...playerOfficers].sort((left, right) => right.name.localeCompare(left.name) || left.id.localeCompare(right.id)).map((officer) => officer.name),
    );

    await user.click(within(dialog).getByRole('button', { name: '按武将排序' }));
    expect(officerNamesIn(dialog)).toEqual(
      [...playerOfficers].sort((left, right) => left.name.localeCompare(right.name) || left.id.localeCompare(right.id)).map((officer) => officer.name),
    );

    await user.click(within(dialog).getByRole('button', { name: '能力' }));
    for (const header of ['武将', '统帅', '武力', '智力', '政治', '魅力']) {
      expect(within(dialog).getByRole('button', { name: `按${header}排序` })).toBeVisible();
    }

    await user.click(within(dialog).getByRole('button', { name: '按智力排序' }));
    expect(officerNamesIn(dialog).slice(0, 3)).toEqual(['诸葛亮', '黄月英', '马谡']);

    await user.click(within(dialog).getByRole('button', { name: '按智力排序' }));
    expect(officerNamesIn(dialog).slice(0, 3)).toEqual(['甘氏', '张飞', '糜芳']);

    await user.click(within(dialog).getByRole('button', { name: '适性' }));
    for (const header of ['武将', '枪', '戟', '弩', '骑', '兵器', '水军']) {
      expect(within(dialog).getByRole('button', { name: `按${header}排序` })).toBeVisible();
    }

    await user.click(within(dialog).getByRole('button', { name: '按枪排序' }));
    expect(officerNamesIn(dialog).slice(0, 2)).toEqual(['关羽', '张飞']);

    await user.click(within(dialog).getByRole('button', { name: '按枪排序' }));
    expect(officerNamesIn(dialog).slice(0, 2)).toEqual(['黄月英', '简雍']);

    await user.click(within(dialog).getByRole('button', { name: '特技' }));
    for (const header of ['武将', '特技']) {
      expect(within(dialog).getByRole('button', { name: `按${header}排序` })).toBeVisible();
    }

    await user.click(within(dialog).getByRole('button', { name: '状态' }));
    for (const header of ['武将', '状态', '任务', '性别']) {
      expect(within(dialog).getByRole('button', { name: `按${header}排序` })).toBeVisible();
    }
  });

  it('closes the officer list popup on right click', async () => {
    const user = userEvent.setup();
    renderState();

    await user.click(screen.getByTestId('open-officer-list-button'));
    const dialog = screen.getAllByRole('dialog')[0];

    const defaultWasAllowed = fireEvent.contextMenu(dialog);

    expect(defaultWasAllowed).toBe(false);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('flags officers at or above 58 with an elder age-warning style and monthly risk', async () => {
    const user = userEvent.setup();
    const state = createGame('liu', 3);
    // 刘备 161 年生：把出生年改早 16 年 → 208 年时 63 岁（每月 10% 寿终风险）
    state.officers['liu-bei'].birthYear = 145;
    renderState(state);

    await user.click(screen.getByTestId('open-officer-list-button'));
    const dialog = screen.getByRole('dialog', { name: '武将一览' });
    const officerRow = (name: string) => within(dialog).getByRole('rowheader', { name }).closest('tr')!;

    const liuBeiRow = officerRow('刘备');
    expect(liuBeiRow).toHaveTextContent('63岁');
    const ageCell = within(liuBeiRow).getByTitle('58 岁起每月寿终风险 10%（强运免疫）');
    expect(ageCell).toHaveClass('is-elder');

    // 对照：47 岁的关羽无警示
    const guanYuRow = officerRow('关羽');
    expect(within(guanYuRow).queryByTitle(/58 岁起每月寿终风险/)).not.toBeInTheDocument();
  });

  it('shows an injury badge next to wounded officers in the list and deployment picker', async () => {
    const user = userEvent.setup();
    const state = createGame('liu', 3);
    state.officers['guan-yu'].health = { level: 'severe', remainingTenDays: 27 };
    state.officers['zhang-fei'].health = { level: 'light', remainingTenDays: 6 };
    state.officers['zhang-fei'].location = { kind: 'city', cityId: 'jiangling' };
    state.officers['zhang-fei'].cityId = 'jiangling';
    state.officers['zhang-fei'].acted = false;
    renderState(state);

    await user.click(screen.getByTestId('open-officer-list-button'));
    const dialog = screen.getByRole('dialog', { name: '武将一览' });
    const guanYuRow = within(dialog).getByRole('rowheader', { name: /关羽/ }).closest('tr')!;
    const severeBadge = within(guanYuRow).getByText('重伤');
    expect(severeBadge.title).toContain('能力下降 50%');
    expect(severeBadge.title).toContain('27 旬');

    const zhangFeiRow = within(dialog).getByRole('rowheader', { name: /张飞/ }).closest('tr')!;
    expect(within(zhangFeiRow).getByText('轻伤').title).toContain('能力下降 10%');
  });

  it('shows current officer task and time only when a task is active', async () => {
    const user = userEvent.setup();
    const transporting = deployTransportUnit(createGame('liu', 3), 'liu', {
      cityId: 'jiangling',
      officerId: 'jian-yong',
      troops: 1000,
      gold: 500,
      food: 500,
    });
    const state = executeCommand(transporting, 'liu', {
      type: 'transfer',
      cityId: 'jiangling',
      targetCityId: 'wuling',
      officerIds: ['guan-yu'],
    });
    renderState(state);

    await user.click(screen.getByTestId('open-officer-list-button'));

    const dialog = screen.getByRole('dialog', { name: '武将一览' });
    await user.click(within(dialog).getByRole('button', { name: '状态' }));
    const guanYuRow = within(dialog).getByRole('row', { name: /关羽/ });
    const jianYongRow = within(dialog).getByRole('row', { name: /简雍/ });
    const liuBeiRow = within(dialog).getByRole('row', { name: /刘备/ });
    expect(guanYuRow).toHaveTextContent('执行中');
    expect(guanYuRow).toHaveTextContent('移动 江陵→武陵');
    expect(jianYongRow).toHaveTextContent('输送');
    expect(liuBeiRow).not.toHaveTextContent('执行中');
    expect(liuBeiRow).toHaveTextContent('待命');
  });

  it('executes a patrol through the command dialog', async () => {
    const user = userEvent.setup();
    renderState();

    await user.click(screen.getByRole('button', { name: /^江陵 刘备/ }));
    const menu = screen.getByTestId('city-command-menu');
    await user.click(within(menu).getByTestId('city-command-section-urban'));
    await user.click(within(menu).getByTestId('city-command-command-patrol'));
    const dialog = screen.getByRole('dialog', { name: '巡察' });
    // 打开执行武将勾选弹窗：默认已按增益贪心勾选统率 Top3（关羽、陈到、刘备）。
    // 反选关羽+陈到，只留刘备 1 人执行
    await user.click(within(dialog).getByRole('button', { name: '执行武将' }));
    const picker = screen.getByRole('dialog', { name: '选择执行武将' });
    await user.click(within(picker).getByLabelText('陈到'));
    await user.click(within(picker).getByLabelText('关羽'));
    await user.click(within(picker).getByRole('button', { name: '确定（1人）' }));
    expect(screen.queryByRole('dialog', { name: '选择执行武将' })).not.toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: '决定·巡察' }));

    expect(screen.queryByRole('dialog', { name: '巡察' })).not.toBeInTheDocument();
    expect(screen.getByText(/刘备巡察江陵/)).toBeVisible();
    // 本势力概览切到武将页签：刘备本旬已行动（行文本为「江陵 / 已行动」）
    await user.click(within(screen.getByTestId('force-overview-panel')).getByRole('button', { name: '武将' }));
    expect(screen.getByText(/已行动/)).toBeVisible();
  });

  it('buys grain by dragging the merchant slider right and sells by dragging it left', async () => {
    const user = userEvent.setup();
    const state = createGame('liu', 3);
    state.cities.jiangling.merchantPresent = true;
    renderState(state);

    await user.click(screen.getByRole('button', { name: /^江陵 刘备/ }));
    const menu = screen.getByTestId('city-command-menu');
    await user.click(within(menu).getByTestId('city-command-section-urban'));
    await user.click(within(menu).getByTestId('city-command-command-trade'));
    const dialog = screen.getByRole('dialog', { name: '商人' });
    expect(within(dialog).getByText(/粮价 1金=5粮/)).toBeVisible();
    const slider = within(dialog).getByLabelText('交易数量') as HTMLInputElement;
    // 滑块居中（0）时不交易，执行按钮禁用
    expect(slider).toHaveValue('0');
    expect(within(dialog).getByRole('button', { name: '决定·商人' })).toBeDisabled();

    // 向右拖动 = 买入兵粮：兵粮预览增加
    fireEvent.change(slider, { target: { value: '5000' } });
    expect(within(dialog).getByText(/38,000 → 43,000/)).toBeVisible();
    await user.click(within(dialog).getByRole('button', { name: '决定·商人' }));
    expect(screen.queryByRole('dialog', { name: '商人' })).not.toBeInTheDocument();
    expect(screen.getByText(/以1金5粮的价格购入5,000兵粮/)).toBeVisible();
  });

  it('sells grain by dragging the merchant slider to the left', async () => {
    const user = userEvent.setup();
    const state = createGame('liu', 3);
    state.cities.jiangling.merchantPresent = true;
    renderState(state);

    await user.click(screen.getByRole('button', { name: /^江陵 刘备/ }));
    const menu = screen.getByTestId('city-command-menu');
    await user.click(within(menu).getByTestId('city-command-section-urban'));
    await user.click(within(menu).getByTestId('city-command-command-trade'));
    const dialog = screen.getByRole('dialog', { name: '商人' });
    const slider = within(dialog).getByLabelText('交易数量') as HTMLInputElement;

    // 向左拖动 = 卖出兵粮：兵粮预览减少
    fireEvent.change(slider, { target: { value: '-3000' } });
    expect(within(dialog).getByText(/38,000 → 35,000/)).toBeVisible();
    await user.click(within(dialog).getByRole('button', { name: '决定·商人' }));

    expect(screen.queryByRole('dialog', { name: '商人' })).not.toBeInTheDocument();
    expect(screen.getByText(/以1金5粮的价格卖出3,000兵粮/)).toBeVisible();
  });

  it('moves focus into the command dialog, closes on Escape, and restores focus', async () => {
    const user = userEvent.setup();
    renderState();

    await user.click(screen.getByRole('button', { name: /^江陵 刘备/ }));
    const menu = screen.getByTestId('city-command-menu');
    await user.click(within(menu).getByTestId('city-command-section-urban'));
    // 命令菜单项在弹出指令窗口时随菜单收起；弹窗关闭后焦点交还给文档主体
    await user.click(within(menu).getByTestId('city-command-command-patrol'));
    expect(screen.getByRole('button', { name: '执行武将' })).toHaveFocus();
    await user.keyboard('{Escape}');

    expect(screen.queryByRole('dialog', { name: '巡察' })).not.toBeInTheDocument();
    expect(document.body).toHaveFocus();
  });

  it('closes a city command dialog on right click', async () => {
    const user = userEvent.setup();
    renderState();

    await user.click(screen.getByRole('button', { name: /^江陵 刘备/ }));
    const menu = screen.getByTestId('city-command-menu');
    await user.click(within(menu).getByTestId('city-command-section-urban'));
    await user.click(within(menu).getByTestId('city-command-command-patrol'));
    const dialog = screen.getAllByRole('dialog')[0];

    const defaultWasAllowed = fireEvent.contextMenu(dialog);

    expect(defaultWasAllowed).toBe(false);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('opens a personnel-only transfer dialog and starts a transfer', async () => {
    const user = userEvent.setup();
    renderState();

    await user.click(screen.getByRole('button', { name: /^江陵 刘备/ }));
    const menu = screen.getByTestId('city-command-menu');
    await user.click(within(menu).getByTestId('city-command-section-talent'));
    await user.click(within(menu).getByTestId('city-command-command-transfer'));
    const dialog = screen.getByRole('dialog', { name: '移动' });
    expect(within(dialog).queryByLabelText('执行武将')).not.toBeInTheDocument();
    expect(within(dialog).queryByLabelText('移动资金')).not.toBeInTheDocument();
    expect(within(dialog).queryByText('移动兵粮')).not.toBeInTheDocument();
    expect(within(dialog).queryByText('移动兵力')).not.toBeInTheDocument();

    await user.click(within(dialog).getByRole('button', { name: '移动人员' }));
    const picker = screen.getByRole('dialog', { name: '选择执行武将' });
    await user.click(within(picker).getByLabelText(/关羽/));
    await user.click(within(picker).getByRole('button', { name: '确定（1人）' }));
    expect(screen.queryByRole('dialog', { name: '选择执行武将' })).not.toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: '决定·移动' }));

    expect(screen.queryByRole('dialog', { name: '移动' })).not.toBeInTheDocument();
    expect(screen.getByText(/移动关羽/)).toBeVisible();
  });

  it('defaults the summon picker to the 召唤 tab with days sorted ascending', async () => {
    const user = userEvent.setup();
    const state = createGame('liu', 3);
    // 江夏归刘备并贴近江陵（10 格 = 1 旬），制造一个 1 旬的召唤来源
    state.cities['jiangxia'].ownerId = 'liu';
    state.cities['jiangxia'].governorId = null;
    state.cities['jiangxia'].gridQ = state.cities['jiangling'].gridQ + 10;
    state.cities['jiangxia'].gridR = state.cities['jiangling'].gridR;
    for (const id of ['zhuge-liang', 'zhang-fei']) {
      state.officers[id].location = { kind: 'city', cityId: 'jiangxia' };
      state.officers[id].cityId = 'jiangxia';
      state.officers[id].acted = false;
    }
    renderState(state);

    await user.click(screen.getByRole('button', { name: /^江陵 刘备/ }));
    const menu = screen.getByTestId('city-command-menu');
    await user.click(within(menu).getByTestId('city-command-section-talent'));
    await user.click(within(menu).getByTestId('city-command-command-summon'));
    const dialog = screen.getByRole('dialog', { name: '召唤' });
    await user.click(within(dialog).getByRole('button', { name: '召唤武将' }));

    const picker = screen.getByRole('dialog', { name: '选择执行武将' });
    // 默认显示「召唤」分类
    expect(within(picker).getByRole('button', { name: '召唤' })).toHaveClass('is-active');
    // 十列：武将/军团/所在/日数/身份/统帅/武力/智力/政治/魅力
    for (const header of ['武将', '军团', '所在', '日数', '身份', '统帅', '武力', '智力', '政治', '魅力']) {
      expect(within(picker).getByRole('button', { name: `按${header}排序` })).toBeVisible();
    }

    const rowOf = (name: string) => within(picker).getByRole('rowheader', { name }).closest('tr')!;
    // 军团=所属势力名，所在=据点，1 旬显示 10 天
    expect(rowOf('诸葛亮')).toHaveTextContent('刘备军');
    expect(rowOf('诸葛亮')).toHaveTextContent('江夏');
    expect(rowOf('诸葛亮')).toHaveTextContent('10天');
    expect(rowOf('廖化')).toHaveTextContent('武陵');
    expect(rowOf('廖化')).toHaveTextContent('40天');

    // 按召唤所需旬数从低到高：1 旬（诸葛亮/张飞）排在 4 旬（武陵诸将）之前
    const names = officerNamesIn(picker);
    expect(names.slice(0, 2).sort()).toEqual(['张飞', '诸葛亮']);
    expect(names.indexOf('廖化')).toBeGreaterThan(names.indexOf('诸葛亮'));
  });

  it('closes the deployment setup popup on right click', async () => {
    const user = userEvent.setup();
    renderState();

    await user.click(screen.getAllByTestId('city-marker')[2]);
    await user.click(screen.getByTestId('city-command-section-military'));
    await user.click(screen.getByTestId('city-command-action-deploy'));
    const dialog = screen.getAllByRole('dialog')[0];

    const defaultWasAllowed = fireEvent.contextMenu(dialog);

    expect(defaultWasAllowed).toBe(false);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('selects the recommended officer by default when opening deployment', async () => {
    const user = userEvent.setup();
    renderState();

    await user.click(screen.getAllByTestId('city-marker')[2]);
    await user.click(screen.getByTestId('city-command-section-military'));
    await user.click(screen.getByTestId('city-command-action-deploy'));
    const dialog = screen.getByRole('dialog', { name: '出征编制' });

    expect(within(dialog).getByTestId('deploy-officer-summary')).toHaveTextContent('关羽');
    expect(within(dialog).getByRole('button', { name: '确定出征' })).toBeEnabled();
  });

  it('updates the recommended deployment officer when the troop type changes', async () => {
    const user = userEvent.setup();
    const state = createGame('liu', 3);
    state.cities['jiangling'].armaments = { ...initialArmaments(), ram: 5 };
    state.officers['zhuge-liang'].location = { kind: 'city', cityId: 'jiangling' };
    state.officers['zhuge-liang'].cityId = 'jiangling';
    renderState(state);

    await user.click(screen.getAllByTestId('city-marker')[2]);
    await user.click(screen.getByTestId('city-command-section-military'));
    await user.click(screen.getByTestId('city-command-action-deploy'));
    const dialog = screen.getByRole('dialog', { name: '出征编制' });

    expect(within(dialog).getByTestId('deploy-officer-summary')).toHaveTextContent(state.officers['guan-yu'].name);

    await user.click(within(dialog).getByRole('button', { name: '冲车' }));

    expect(within(dialog).getByTestId('deploy-officer-summary')).toHaveTextContent(state.officers['zhuge-liang'].name);
  });

  it('opens a deployment dialog from the city menu and deploys the selected troop type', async () => {
    const user = userEvent.setup();
    renderState();

    const jianglingMarker = screen.getAllByTestId('city-marker').find((marker) => marker.textContent?.includes('江陵'));
    expect(jianglingMarker).toBeTruthy();
    await user.click(jianglingMarker!);
    const menu = screen.getByTestId('city-command-menu');
    await user.click(within(menu).getByRole('button', { name: '军事' }));
    await user.click(within(menu).getByRole('button', { name: '出征' }));

    const dialog = screen.getByRole('dialog', { name: '出征编制' });
    expect(within(dialog).getByLabelText('主将')).toBeVisible();
    expect(within(dialog).queryByLabelText('目标城池')).not.toBeInTheDocument();
    const shipButton = within(dialog).getByRole('button', { name: '楼船' });
    expect(shipButton).toBeVisible();
    expect(shipButton).toBeDisabled();
    expect(within(dialog).getByRole('button', { name: '小舟' })).toBeEnabled();
    await user.click(within(dialog).getByRole('button', { name: '枪兵' }));
    const confirmedDialog = await chooseDeployLeader(user, '刘备');
    await user.click(within(confirmedDialog).getByRole('button', { name: '确定出征' }));

    expect(screen.queryByRole('dialog', { name: '出征编制' })).not.toBeInTheDocument();
    expect(screen.queryByTestId('battle-unit-marker')).not.toBeInTheDocument();
    panMapTo(92, 120); // 等比后江陵(120)在初始视野外，平移让部署格渲染
    const deploymentCell = screen.getAllByTestId(/move-target-/)[0];
    fireEvent.pointerDown(deploymentCell, { button: 0, buttons: 1 });
    await user.click(within(screen.getByTestId('unit-command-menu')).getByRole('button', { name: '待命' }));

    const unitMarker = screen.getByTestId('battle-unit-marker');
    expect(unitMarker).toBeVisible();
    expect(unitMarker).toHaveAttribute('data-troop-type', 'spear');
    expect(within(unitMarker).getByText('枪')).toBeVisible();
    expect(within(unitMarker).getByText('刘备')).toBeVisible();
    expect(within(unitMarker).getByText('4,000')).toBeVisible();
  });

  it('确定出征后城中心显示待出发部队预览，取消出征后预览消失', async () => {
    const user = userEvent.setup();
    renderState();

    const jianglingMarker = screen.getAllByTestId('city-marker').find((marker) => marker.textContent?.includes('江陵'));
    expect(jianglingMarker).toBeTruthy();
    await user.click(jianglingMarker!);
    const menu = screen.getByTestId('city-command-menu');
    await user.click(within(menu).getByRole('button', { name: '军事' }));
    await user.click(within(menu).getByRole('button', { name: '出征' }));

    const dialog = screen.getByRole('dialog', { name: '出征编制' });
    await user.click(within(dialog).getByRole('button', { name: '枪兵' }));
    const confirmedDialog = await chooseDeployLeader(user, '刘备');
    await user.click(within(confirmedDialog).getByRole('button', { name: '确定出征' }));

    // 城中心应显示待出发部队预览（主将名 + 兵种字）
    const preview = screen.getByTestId('deploy-preview-marker');
    expect(preview).toBeVisible();
    expect(preview).toHaveTextContent('刘备');

    // 右键空白取消出征：预览消失，未真正出兵
    fireEvent.contextMenu(screen.getByTestId('map-viewport'), { clientX: 300, clientY: 200 });
    expect(screen.queryByTestId('deploy-preview-marker')).not.toBeInTheDocument();
    expect(screen.queryByTestId('battle-unit-marker')).not.toBeInTheDocument();
  });

  it('enables the ship vehicle button and shows its stock when the city has ships', async () => {
    const user = userEvent.setup();
    const state = createGame('liu', 1);
    state.cities['jiangling'].armaments = { ...initialArmaments(), ship: 3 };
    renderState(state);

    const jianglingMarker = screen.getAllByTestId('city-marker').find((marker) => marker.textContent?.includes('江陵'));
    expect(jianglingMarker).toBeTruthy();
    await user.click(jianglingMarker!);
    const menu = screen.getByTestId('city-command-menu');
    await user.click(within(menu).getByRole('button', { name: '军事' }));
    await user.click(within(menu).getByRole('button', { name: '出征' }));

    const dialog = screen.getByRole('dialog', { name: '出征编制' });
    const shipButton = within(dialog).getByRole('button', { name: '楼船' });
    expect(shipButton).toBeEnabled();
    expect(shipButton).toHaveTextContent('3');
  });

  it('shows the chosen siege weapon glyph on the deployed unit marker', () => {
    const game = createGame('liu', 1);
    game.cities['jiangling'].armaments = { ...initialArmaments(), ram: 5 };
    const state = deployUnit(game, 'liu', {
      cityId: 'jiangling',
      officerId: 'guan-yu',
      troopType: 'siege',
      siegeWeapon: 'ram',
      troops: 4000,
      food: 6000,
    });
    renderState(state);

    const unitMarker = screen.getByTestId('battle-unit-marker');
    expect(within(unitMarker).getByText('冲')).toBeVisible();
    expect(unitMarker).toHaveAttribute('data-troop-type', 'siege');
  });

  it('opens the strategy menu for Ma Su during the first deployment action', async () => {
    const user = userEvent.setup();
    renderState();
    panMapTo(69, 155);

    await user.click(screen.getByRole('button', { name: /^武陵 刘备/ }));
    const menu = screen.getByTestId('city-command-menu');
    await user.click(within(menu).getByRole('button', { name: '军事' }));
    await user.click(within(menu).getByRole('button', { name: '出征' }));
    const deployDialog = await chooseDeployLeader(user, '马谡');
    await user.click(within(deployDialog).getByRole('button', { name: '确定出征' }));

    fireEvent.pointerDown(screen.getAllByTestId(/move-target-/)[0], { button: 0, buttons: 1 });
    const unitMenu = screen.getByTestId('unit-command-menu');
    await user.click(within(unitMenu).getByRole('button', { name: '计略' }));

    expect(screen.getByTestId('unit-strategy-menu')).toBeVisible();
  });

  it('completes Ma Su deployment after selecting 火计 and a target cell', async () => {
    const user = userEvent.setup();
    renderState();
    panMapTo(69, 155);

    await user.click(screen.getByRole('button', { name: /^武陵 刘备/ }));
    const menu = screen.getByTestId('city-command-menu');
    await user.click(within(menu).getByRole('button', { name: '军事' }));
    await user.click(within(menu).getByRole('button', { name: '出征' }));
    const deployDialog = await chooseDeployLeader(user, '马谡');
    await user.click(within(deployDialog).getByRole('button', { name: '确定出征' }));

    fireEvent.pointerDown(screen.getAllByTestId(/move-target-/)[0], { button: 0, buttons: 1 });
    const unitMenu = screen.getByTestId('unit-command-menu');
    await user.click(within(unitMenu).getByRole('button', { name: '计略' }));
    await user.click(within(screen.getByTestId('unit-strategy-menu')).getByRole('button', { name: /火计/ }));

    const target = screen.getAllByTestId(/strategy-target-/)[0];
    fireEvent.pointerDown(target, { button: 0, buttons: 1 });

    expect(screen.getByTestId('battle-unit-marker')).toBeVisible();
    expect(screen.queryByTestId('unit-command-menu')).not.toBeInTheDocument();
  });

  it('shows 强行 deployment targets for the selected officer', async () => {
    const user = userEvent.setup();
    const state = createGame('liu', 3);
    state.officers['liu-bei'].skill = '强行';
    const base = deploymentCells(state, 'jiangling', movementAllowanceForProfile('sword'), 'sword');
    const enhanced = deploymentCells(state, 'jiangling', movementAllowanceForProfile('sword') + 5, 'sword');
    const destination = enhanced.find((coord) => !base.some((cell) => cell.q === coord.q && cell.r === coord.r));
    expect(destination).toBeDefined();
    renderState(state);
    panMapTo(destination!.q, destination!.r); // 等比后部署目标格在初始视野外，平移到目标让部署格渲染

    await user.click(screen.getByRole('button', { name: /^江陵 刘备/ }));
    const menu = screen.getByTestId('city-command-menu');
    await user.click(within(menu).getByRole('button', { name: '军事' }));
    await user.click(within(menu).getByRole('button', { name: '出征' }));
    const dialog = await chooseDeployLeader(user, '刘备');
    await user.click(within(dialog).getByRole('button', { name: '确定出征' }));

    expect(screen.getByTestId(`move-target-${destination!.q}-${destination!.r}`)).toBeVisible();
  });

  it('opens a separate officer picker and assigns one leader with two deputies', async () => {
    const user = userEvent.setup();
    renderState();

    const jianglingMarker = screen.getAllByTestId('city-marker').find((marker) => marker.textContent?.includes('江陵'));
    await user.click(jianglingMarker!);
    const menu = screen.getByTestId('city-command-menu');
    await user.click(within(menu).getByRole('button', { name: '军事' }));
    await user.click(within(menu).getByRole('button', { name: '出征' }));

    const deployDialog = screen.getByRole('dialog', { name: '出征编制' });
    await user.click(within(deployDialog).getByRole('button', { name: '选择武将' }));

    const officerDialog = screen.getByRole('dialog', { name: '武将选择' });
    expect(within(officerDialog).getByText('主将', { selector: '.officer-slot span' })).toBeVisible();
    expect(within(officerDialog).getByText('副将 1')).toBeVisible();
    expect(within(officerDialog).getByText('副将 2')).toBeVisible();

    await user.click(within(officerDialog).getByRole('button', { name: '选择关羽为主将' }));
    await user.click(within(officerDialog).getByRole('button', { name: '选择刘备为副将' }));
    await user.click(within(officerDialog).getByRole('button', { name: '选择简雍为副将' }));
    await user.click(within(officerDialog).getByRole('button', { name: '确定武将' }));

    expect(screen.getByRole('dialog', { name: '出征编制' })).toBeVisible();
    expect(screen.getByTestId('deploy-officer-summary')).toHaveTextContent('关羽 / 刘备 / 简雍');
    expect(within(screen.getByRole('dialog', { name: '出征编制' })).getByText('攻击')).toBeVisible();
    expect(within(screen.getByRole('dialog', { name: '出征编制' })).getByTestId('deploy-attack')).toHaveTextContent('95');
    expect(within(screen.getByRole('dialog', { name: '出征编制' })).getByTestId('deploy-defense')).toHaveTextContent('95');
  });

  it('switches the deploy officer picker fixed list area between ability, skill, and aptitude views', async () => {
    const user = userEvent.setup();
    renderState();

    const jianglingMarker = screen.getAllByTestId('city-marker').find((marker) => marker.textContent?.includes('江陵'));
    await user.click(jianglingMarker!);
    const menu = screen.getByTestId('city-command-menu');
    await user.click(within(menu).getByRole('button', { name: '军事' }));
    await user.click(within(menu).getByRole('button', { name: '出征' }));
    await user.click(within(screen.getByRole('dialog', { name: '出征编制' })).getByRole('button', { name: '选择武将' }));

    const officerDialog = screen.getByRole('dialog', { name: '武将选择' });
    const fixedArea = within(officerDialog).getByRole('region', { name: '可出征武将' });

    expect(within(officerDialog).getByRole('button', { name: '能力' })).toHaveClass('is-active');
    expect(within(fixedArea).getByText('统帅')).toBeVisible();
    expect(within(fixedArea).getByText('智力')).toBeVisible();
    expect(within(fixedArea).getByText('魅力')).toBeVisible();

    await user.click(within(officerDialog).getByRole('button', { name: '特技' }));

    expect(within(officerDialog).getByRole('button', { name: '特技' })).toHaveClass('is-active');
    expect(within(fixedArea).getByText('神将')).toBeVisible();
    expect(within(fixedArea).queryByText('智力')).not.toBeInTheDocument();

    await user.click(within(officerDialog).getByRole('button', { name: '适性' }));

    expect(within(officerDialog).getByRole('button', { name: '适性' })).toHaveClass('is-active');
    for (const label of ['枪', '戟', '弩', '骑', '兵器', '水军']) {
      expect(within(fixedArea).getByText(label)).toBeVisible();
    }
    const guanYuRow = within(fixedArea).getByText('关羽').closest('.officer-picker-row');
    expect(guanYuRow).toBeTruthy();
    expect(guanYuRow).toHaveTextContent('SSBACC');
  });

  it('sorts the deploy officer picker by clickable ability and aptitude headers', async () => {
    const user = userEvent.setup();
    renderState();

    const jianglingMarker = screen.getAllByTestId('city-marker').find((marker) => marker.textContent?.includes('江陵'));
    await user.click(jianglingMarker!);
    const menu = screen.getByTestId('city-command-menu');
    await user.click(within(menu).getByRole('button', { name: '军事' }));
    await user.click(within(menu).getByRole('button', { name: '出征' }));
    await user.click(within(screen.getByRole('dialog', { name: '出征编制' })).getByRole('button', { name: '选择武将' }));

    const officerDialog = screen.getByRole('dialog', { name: '武将选择' });
    const fixedArea = within(officerDialog).getByRole('region', { name: '可出征武将' });
    const names = () => [...fixedArea.querySelectorAll('.officer-picker-row > strong')].map((name) => name.textContent ?? '');

    await user.click(within(fixedArea).getByRole('button', { name: '按统帅排序' }));
    expect(names()[0]).toBe('关羽');

    await user.click(within(fixedArea).getByRole('button', { name: '按统帅排序' }));
    expect(names()[0]).toBe('甘氏');

    await user.click(within(officerDialog).getByRole('button', { name: '适性' }));
    await user.click(within(fixedArea).getByRole('button', { name: '按枪排序' }));
    expect(names()[0]).toBe('关羽');
  });

  it('clears the previous leader when a different leader is selected', async () => {
    const user = userEvent.setup();
    renderState();

    const jianglingMarker = screen.getAllByTestId('city-marker').find((marker) => marker.textContent?.includes('江陵'));
    await user.click(jianglingMarker!);
    const menu = screen.getByTestId('city-command-menu');
    await user.click(within(menu).getByRole('button', { name: '军事' }));
    await user.click(within(menu).getByRole('button', { name: '出征' }));
    const deployDialog = screen.getByRole('dialog', { name: '出征编制' });
    await user.click(within(deployDialog).getByRole('button', { name: '选择武将' }));

    const officerDialog = screen.getByRole('dialog', { name: '武将选择' });
    const liuBeiLeader = within(officerDialog).getByRole('button', { name: '选择刘备为主将' });
    const guanYuLeader = within(officerDialog).getByRole('button', { name: '选择关羽为主将' });
    await user.click(liuBeiLeader);
    expect(liuBeiLeader).toHaveClass('is-active');

    await user.click(guanYuLeader);

    expect(guanYuLeader).toHaveClass('is-active');
    expect(liuBeiLeader).not.toHaveClass('is-active');
    expect(within(officerDialog).getByRole('region', { name: '已选武将' })).toHaveTextContent('主将关羽');
    expect(within(officerDialog).getByRole('region', { name: '已选武将' })).not.toHaveTextContent('刘备');
  });

  it('uses range sliders for troops and food and caps weapon troops by armament stock', async () => {
    const user = userEvent.setup();
    const state = createGame('liu', 3);
    state.cities.jiangling.armaments!.spear = 1500;
    state.cities.jiangling.food = 10000;
    renderState(state);

    const jianglingMarker = screen.getAllByTestId('city-marker').find((marker) => marker.textContent?.includes('江陵'));
    await user.click(jianglingMarker!);
    const menu = screen.getByTestId('city-command-menu');
    await user.click(within(menu).getByRole('button', { name: '军事' }));
    await user.click(within(menu).getByRole('button', { name: '出征' }));
    const dialog = screen.getByRole('dialog', { name: '出征编制' });

    await user.click(within(dialog).getByRole('button', { name: '枪兵' }));
    const troopSlider = within(dialog).getByRole('slider', { name: '出征士兵' });
    const foodSlider = within(dialog).getByRole('slider', { name: '出征兵粮' });
    expect(troopSlider).toHaveAttribute('max', '1500');
    expect(troopSlider).toHaveValue('1500');
    expect(foodSlider).toHaveAttribute('max', '10000');

    fireEvent.change(troopSlider, { target: { value: '1000' } });
    fireEvent.change(foodSlider, { target: { value: '2000' } });

    expect(troopSlider).toHaveValue('1000');
    expect(foodSlider).toHaveValue('2000');
    expect(within(dialog).getByTestId('deploy-troop-value')).toHaveTextContent('1,000');
    expect(within(dialog).getByTestId('deploy-food-value')).toHaveTextContent('2,000');
  });

  it('uses a gold slider for combat deployment and carries that gold on the unit', async () => {
    const user = userEvent.setup();
    const state = createGame('liu', 3);
    state.cities.jiangling.gold = 5000;
    renderState(state);

    const jianglingMarker = screen.getByRole('button', { name: /^江陵 刘备/ });
    await user.click(jianglingMarker);
    const menu = screen.getByTestId('city-command-menu');
    await user.click(within(menu).getByTestId('city-command-section-military'));
    await user.click(within(menu).getByTestId('city-command-action-deploy'));
    const dialog = screen.getByRole('dialog', { name: '出征编制' });
    const goldSlider = within(dialog).getByRole('slider', { name: '出征资金' });

    expect(goldSlider).toHaveAttribute('max', '5000');
    expect(goldSlider).toHaveValue('1000');
    fireEvent.change(goldSlider, { target: { value: '900' } });
    expect(within(dialog).getByTestId('deploy-gold-value')).toHaveTextContent('900');

    await user.click(within(dialog).getByRole('button', { name: '确定出征' }));
    panMapTo(92, 120); // 等比后江陵(120)在初始视野外，平移让部署格渲染
    fireEvent.pointerDown(screen.getAllByTestId(/move-target-/)[0], { button: 0, buttons: 1 });
    await user.click(within(screen.getByTestId('unit-command-menu')).getByRole('button', { name: '待命' }));

    expect(screen.getByTestId('battle-unit-marker')).toBeVisible();
    expect(window.localStorage.getItem('jingxiang-208-autosave-v1')).toContain('"gold":900');
  });

  it('shows deployed unit gold in the UI and spends it when building a facility', async () => {
    const user = userEvent.setup();
    const state = createGame('liu', 3);
    state.cities.jiangling.gold = 5000;
    renderState(state);

    await user.click(screen.getByRole('button', { name: /^江陵 刘备/ }));
    const menu = screen.getByTestId('city-command-menu');
    await user.click(within(menu).getByTestId('city-command-section-military'));
    await user.click(within(menu).getByTestId('city-command-action-deploy'));
    const dialog = screen.getByRole('dialog', { name: '出征编制' });
    fireEvent.change(within(dialog).getByRole('slider', { name: '出征资金' }), { target: { value: '900' } });
    await user.click(within(dialog).getByRole('button', { name: '确定出征' }));
    panMapTo(92, 120); // 等比后江陵(120)在初始视野外，平移让部署格渲染

    fireEvent.pointerDown(screen.getAllByTestId(/move-target-/)[0], { button: 0, buttons: 1, clientX: 320, clientY: 220 });
    await user.click(within(screen.getByTestId('unit-command-menu')).getByRole('button', { name: '待命' }));

    // 出征后重新点击江陵城标唤出都市信息面板：城市资金 5,000 - 900 = 4,100
    await user.click(screen.getByRole('button', { name: /^江陵 刘备/ }));
    expect(screen.getByTestId('city-status-panel')).toHaveTextContent('4,100');
    const unitMarker = screen.getByTestId('battle-unit-marker');
    fireEvent.pointerEnter(unitMarker, { clientX: 300, clientY: 180 });
    expect(screen.getByTestId('unit-info-panel')).toHaveTextContent('900');
    fireEvent.pointerLeave(unitMarker);

    await user.click(screen.getByTestId('end-ten-day-button'));
    fireEvent.pointerDown(screen.getByTestId('battle-unit-marker'), { button: 0, buttons: 1, clientX: 300, clientY: 180 });
    fireEvent.pointerDown(screen.getByTestId('battle-unit-marker'), { button: 0, buttons: 1, clientX: 300, clientY: 180 });
    await user.click(within(screen.getByTestId('unit-command-menu')).getByRole('button', { name: '设置' }));
    await user.click(within(screen.getByTestId('unit-facility-menu')).getByRole('button', { name: /箭楼/ }));
    fireEvent.pointerDown(screen.getAllByTestId(/strategy-target-/)[0], { button: 0, buttons: 1 });

    fireEvent.pointerEnter(screen.getByTestId('battle-unit-marker'), { clientX: 300, clientY: 180 });
    expect(screen.getByTestId('unit-info-panel')).toHaveTextContent('300');
  });

  it('caps weapon troop slider at available armament stock and disables it below 1000', async () => {
    const user = userEvent.setup();
    const state = createGame('liu', 3);
    state.cities.jiangling.armaments!.spear = 500;
    renderState(state);

    const jianglingMarker = screen.getAllByTestId('city-marker').find((marker) => marker.textContent?.includes('江陵'));
    await user.click(jianglingMarker!);
    const menu = screen.getByTestId('city-command-menu');
    await user.click(within(menu).getByRole('button', { name: '军事' }));
    await user.click(within(menu).getByRole('button', { name: '出征' }));
    const dialog = screen.getByRole('dialog', { name: '出征编制' });
    await user.click(within(dialog).getByRole('button', { name: '枪兵' }));

    const troopSlider = within(dialog).getByRole('slider', { name: '出征士兵' });
    expect(troopSlider).toHaveAttribute('max', '1000');
    expect(troopSlider).toBeDisabled();
    expect(within(dialog).getByTestId('deploy-troop-value')).toHaveTextContent('1,000 / 1,000');
    expect(within(dialog).getByRole('alert')).toHaveTextContent('枪兵兵装不足');
    expect(within(dialog).getByRole('button', { name: '确定出征' })).toBeDisabled();
  });

  it('closes the transport setup popup on right click', async () => {
    const user = userEvent.setup();
    renderState();

    await user.click(screen.getAllByTestId('city-marker')[2]);
    await user.click(screen.getByTestId('city-command-section-military'));
    await user.click(screen.getByTestId('city-command-action-transport'));
    const dialog = screen.getAllByRole('dialog')[0];

    const defaultWasAllowed = fireEvent.contextMenu(dialog);

    expect(defaultWasAllowed).toBe(false);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('opens a transport dialog from the military menu and places a transport unit', async () => {
    const user = userEvent.setup();
    const state = createGame('liu', 3);
    state.officers['liu-bei'].health = { level: 'light', remainingTenDays: 6 };
    renderState(state);

    const jianglingMarker = screen.getAllByTestId('city-marker').find((marker) => marker.textContent?.includes('江陵'));
    expect(jianglingMarker).toBeTruthy();
    await user.click(jianglingMarker!);
    const menu = screen.getByTestId('city-command-menu');
    await user.click(within(menu).getByRole('button', { name: '军事' }));
    await user.click(within(menu).getByRole('button', { name: '输送' }));

    const dialog = screen.getByRole('dialog', { name: '输送编制' });
    expect(within(dialog).getByLabelText('执行武将')).toBeVisible();
    // 带伤武将：选项显示衰减后的统/政并带伤标注（刘备统78→70、政80→72 @轻伤90%）
    const beisOption = within(dialog).getByRole('option', { name: /刘备/ });
    expect(beisOption).toHaveTextContent('统70');
    expect(beisOption).toHaveTextContent('政72');
    expect(beisOption).toHaveTextContent('（轻伤）');
    expect(within(dialog).getByLabelText('输送士兵')).toBeVisible();
    expect(within(dialog).getByLabelText('输送资金')).toBeVisible();
    expect(within(dialog).getByLabelText('输送兵粮')).toBeVisible();
    await user.clear(within(dialog).getByLabelText('输送资金'));
    await user.type(within(dialog).getByLabelText('输送资金'), '900');
    await user.click(within(dialog).getByRole('button', { name: '确定输送' }));

    expect(screen.queryByRole('dialog', { name: '输送编制' })).not.toBeInTheDocument();
    panMapTo(92, 120); // 等比后江陵(120)在初始视野外，平移让输送部署格渲染
    const transportCell = screen.getAllByTestId(/deploy-target-/)[0];
    fireEvent.pointerDown(transportCell, { button: 0, buttons: 1 });

    const unitMarker = screen.getByTestId('battle-unit-marker');
    expect(unitMarker).toBeVisible();
    expect(unitMarker).toHaveAttribute('data-unit-kind', 'transport');
    expect(within(unitMarker).getByText('输')).toBeVisible();
    expect(within(unitMarker).getByText('1,000')).toBeVisible();
  });

  it('shows unit commands on a selected unit and moves to a selected cell only after wait is chosen', async () => {
    const user = userEvent.setup();
    renderState();

    const jianglingMarker = screen.getAllByTestId('city-marker').find((marker) => marker.textContent?.includes('江陵'));
    expect(jianglingMarker).toBeTruthy();
    await user.click(jianglingMarker!);
    const menu = screen.getByTestId('city-command-menu');
    await user.click(within(menu).getByRole('button', { name: '军事' }));
    await user.click(within(menu).getByRole('button', { name: '出征' }));

    const dialog = screen.getByRole('dialog', { name: '出征编制' });
    const confirmedDialog = await chooseDeployLeader(user, '刘备');
    await user.click(within(confirmedDialog).getByRole('button', { name: '确定出征' }));
    panMapTo(92, 120); // 等比后江陵(120)在初始视野外，平移让部署/移动格渲染
    fireEvent.pointerDown(screen.getAllByTestId(/move-target-/)[0], { button: 0, buttons: 1 });
    await user.click(within(screen.getByTestId('unit-command-menu')).getByRole('button', { name: '待命' }));

    await user.click(screen.getByTestId('end-ten-day-button'));
    const unitMarker = screen.getByTestId('battle-unit-marker');
    fireEvent.pointerDown(unitMarker, { button: 0, buttons: 1 });
    expect(screen.getAllByTestId(/move-target-/).length).toBeGreaterThan(0);

    const rightClickedMoveTarget = screen.getAllByTestId(/move-target-/)[0];
    fireEvent.pointerDown(rightClickedMoveTarget, { button: 2, buttons: 2, clientX: 300, clientY: 220 });
    expect(screen.queryByTestId('unit-command-menu')).not.toBeInTheDocument();

    fireEvent.contextMenu(rightClickedMoveTarget, { clientX: 300, clientY: 220 });

    expect(screen.queryByTestId(/move-target-/)).not.toBeInTheDocument();
    expect(screen.queryByTestId('map-context-menu')).not.toBeInTheDocument();

    fireEvent.pointerDown(unitMarker, { button: 0, buttons: 1 });

    fireEvent.pointerDown(unitMarker, { button: 0, buttons: 1, clientX: 240, clientY: 180 });
    const unitMenu = screen.getByTestId('unit-command-menu');
    for (const label of ['待命', '攻击', '齐攻', '战法', '单挑', '计略', '设置', '修补']) {
      expect(within(unitMenu).getByRole('button', { name: label })).toBeVisible();
    }
    fireEvent.pointerDown(screen.getByTestId('map-viewport'), { button: 0 });
    expect(screen.queryByTestId('unit-command-menu')).not.toBeInTheDocument();

    const moveTarget = screen.getAllByTestId(/move-target-/)[0];
    const [, q, r] = moveTarget.getAttribute('data-testid')!.match(/move-target-(\d+)-(\d+)/)!;
    fireEvent.pointerDown(moveTarget, { button: 0, buttons: 1, clientX: 320, clientY: 220 });

    const targetMenu = screen.getByTestId('unit-command-menu');
    for (const label of ['待命', '攻击', '齐攻', '战法', '单挑', '计略', '设置', '修补']) {
      expect(within(targetMenu).getByRole('button', { name: label })).toBeVisible();
    }
    expect(screen.getByTestId('battle-unit-marker')).not.toHaveAttribute('data-grid-position', `${q},${r}`);

    fireEvent.contextMenu(screen.getByTestId('map-viewport'), { clientX: 360, clientY: 260 });
    expect(screen.queryByTestId('unit-command-menu')).not.toBeInTheDocument();
    expect(screen.queryByTestId('map-context-menu')).not.toBeInTheDocument();

    fireEvent.pointerDown(moveTarget, { button: 0, buttons: 1, clientX: 320, clientY: 220 });

    await user.click(within(screen.getByTestId('unit-command-menu')).getByRole('button', { name: '待命' }));

    expect(screen.queryByTestId(/move-target-/)).not.toBeInTheDocument();
    expect(screen.queryByTestId('unit-command-menu')).not.toBeInTheDocument();
    expect(screen.getByTestId('battle-unit-marker')).toHaveAttribute('data-grid-position', `${q},${r}`);
  });

  it('超距点击可移动范围外的地点：弹出移动/设置委任菜单，点击移动后部队沿路径前进', async () => {
    const user = userEvent.setup();
    const state = deployUnit(createGame('liu', 1), 'liu', {
      cityId: 'jiangling', officerId: 'liu-bei', troops: 3000, food: 3000,
    });
    const ready = settleTenDay(state);
    const unit = Object.values(ready.units)[0];
    const moveKeys = new Set(movementCells(ready, unit.id).map(gridKey));
    const cityKeysOf = cityKeys(ready);
    // 在部队附近有界 BFS：找一处「可移动范围外、委任路径可达且第一步可走」的格
    let target: { q: number; r: number } | undefined;
    const visited = new Set<string>([gridKey(unit)]);
    let frontier = [{ q: unit.q, r: unit.r }];
    for (let distance = 1; distance <= 8 && !target; distance += 1) {
      const next: { q: number; r: number }[] = [];
      for (const cell of frontier) {
        for (const neighbor of neighborsOf(cell.q, cell.r)) {
          const key = gridKey(neighbor);
          if (visited.has(key)) continue;
          visited.add(key);
          if (cityKeysOf.has(key)) continue;
          if (Object.values(ready.facilities ?? {}).some((facility) => facility.q === neighbor.q && facility.r === neighbor.r)) continue;
          next.push(neighbor);
          if (moveKeys.has(key)) continue;
          const path = computeDelegatePath(ready, unit.id, neighbor);
          if (path && path.length > 2 && moveKeys.has(gridKey(path[1]))) {
            target = neighbor;
            break;
          }
        }
        if (target) break;
      }
      frontier = next;
    }
    expect(target).toBeDefined();
    if (!target) return;

    renderState(ready);
    panMapTo(target.q, target.r);
    fireEvent.pointerDown(screen.getByTestId('battle-unit-marker'), { button: 0, buttons: 1 });
    expect(screen.getAllByTestId(/move-target-/).length).toBeGreaterThan(0);

    fireEvent.pointerDown(screen.getByTestId(`map-cell-${target.q}-${target.r}`), { button: 0, buttons: 1, clientX: 320, clientY: 220 });
    const menu = screen.getByTestId('delegate-menu');
    expect(within(menu).getByRole('button', { name: '移动' })).toBeVisible();
    expect(within(menu).getByRole('button', { name: '设置' })).toBeVisible();

    await user.click(within(menu).getByRole('button', { name: '移动' }));
    expect(screen.queryByTestId('delegate-menu')).not.toBeInTheDocument();
    const position = screen.getByTestId('battle-unit-marker').getAttribute('data-grid-position')!;
    const [mq, mr] = position.split(',').map(Number);
    expect(mq !== unit.q || mr !== unit.r).toBe(true);
  });

  it('出征时选择可移动范围外的地点：弹出移动/设置委任菜单，点击移动后部队出征并记录委任', async () => {
    const user = userEvent.setup();
    const state = createGame('liu', 3);
    const deployQuery: { cityId: 'jiangling'; troopType: 'sword'; officerIds: string[] } = { cityId: 'jiangling', troopType: 'sword', officerIds: ['liu-bei'] };
    const deployKeys = new Set(getDeploymentTargets(state, deployQuery).map(gridKey));
    const preview = deployUnitPreviewWithId(state, state.playerForceId, {
      cityId: 'jiangling', officerIds: ['liu-bei'], troopType: 'sword', troops: 4000, food: 6000,
    });
    const spawnUnit = preview.state.units[preview.unitId];
    const spawn = { q: spawnUnit.q, r: spawnUnit.r };
    const cityKeysOf = cityKeys(state);
    const facilityKeys = new Set(Object.values(state.facilities ?? {}).map((facility) => gridKey(facility)));
    // 在出征出生点附近 BFS：找一处「出征范围外、委任路径可达」的格
    let target: { q: number; r: number } | undefined;
    const visited = new Set<string>([gridKey(spawn)]);
    let frontier = [spawn];
    for (let distance = 1; distance <= 8 && !target; distance += 1) {
      const next: { q: number; r: number }[] = [];
      for (const cell of frontier) {
        for (const neighbor of neighborsOf(cell.q, cell.r)) {
          const key = gridKey(neighbor);
          if (visited.has(key)) continue;
          visited.add(key);
          if (cityKeysOf.has(key) || facilityKeys.has(key)) continue;
          if (!passableNonCityCell(state, neighbor)) continue;
          next.push(neighbor);
          if (deployKeys.has(key)) continue;
          const path = computeDelegatePath(preview.state, preview.unitId, neighbor);
          if (path && path.length > 1) {
            target = neighbor;
            break;
          }
        }
        if (target) break;
      }
      frontier = next;
    }
    expect(target).toBeDefined();
    if (!target) return;

    renderState(state);
    panMapTo(target.q, target.r);
    await user.click(screen.getByRole('button', { name: /^江陵 刘备/ }));
    const cityMenu = screen.getByTestId('city-command-menu');
    await user.click(within(cityMenu).getByRole('button', { name: '军事' }));
    await user.click(within(cityMenu).getByRole('button', { name: '出征' }));
    const deployDialog = await chooseDeployLeader(user, '刘备');
    await user.click(within(deployDialog).getByRole('button', { name: '确定出征' }));
    expect(screen.getAllByTestId(/move-target-/).length).toBeGreaterThan(0);

    fireEvent.pointerDown(screen.getByTestId(`map-cell-${target.q}-${target.r}`), { button: 0, buttons: 1, clientX: 320, clientY: 220 });
    const delegateMenu = screen.getByTestId('delegate-menu');
    expect(within(delegateMenu).getByRole('button', { name: '移动' })).toBeVisible();
    expect(within(delegateMenu).getByRole('button', { name: '设置' })).toBeVisible();

    await user.click(within(delegateMenu).getByRole('button', { name: '移动' }));
    expect(screen.queryByTestId('delegate-menu')).not.toBeInTheDocument();
    const marker = screen.getByTestId('battle-unit-marker');
    expect(marker).toBeVisible();
    // 出征委任：部队本旬即沿最优路径行军到最远处（出生格为朝目标最近的部署格），
    // 与 intentReducer.deployUnitDelegate 的行为一致：部署→放开 moved→setMoveDelegate。
    const fallbackSpawn = chooseDelegateSpawnCell(getDeploymentTargets(state, deployQuery), target);
    const sim = deployUnitWithId(state, 'liu', {
      cityId: 'jiangling', officerIds: ['liu-bei'], troopType: 'sword',
      troops: 4000, food: 6000, destination: fallbackSpawn,
    });
    sim.state.units[sim.unitId].moved = false;
    const simNext = setMoveDelegate(sim.state, 'liu', sim.unitId, target);
    const simUnit = simNext.units[sim.unitId];
    expect(simUnit).toBeDefined();
    expect(marker).toHaveAttribute('data-grid-position', `${simUnit.q},${simUnit.r}`);
    expect(screen.queryByTestId(/move-target-/)).not.toBeInTheDocument();
  });

  it('出征委任菜单弹出后右键：仅退出菜单，不取消出征流程', async () => {
    const user = userEvent.setup();
    const state = createGame('liu', 3);
    const deployQuery: { cityId: 'jiangling'; troopType: 'sword'; officerIds: string[] } = { cityId: 'jiangling', troopType: 'sword', officerIds: ['liu-bei'] };
    const deployKeys = new Set(getDeploymentTargets(state, deployQuery).map(gridKey));
    const preview = deployUnitPreviewWithId(state, state.playerForceId, {
      cityId: 'jiangling', officerIds: ['liu-bei'], troopType: 'sword', troops: 4000, food: 6000,
    });
    const spawnUnit = preview.state.units[preview.unitId];
    const cityKeysOf = cityKeys(state);
    const facilityKeys = new Set(Object.values(state.facilities ?? {}).map((facility) => gridKey(facility)));
    let target: { q: number; r: number } | undefined;
    const visited = new Set<string>([gridKey(spawnUnit)]);
    let frontier = [{ q: spawnUnit.q, r: spawnUnit.r }];
    for (let distance = 1; distance <= 8 && !target; distance += 1) {
      const next: { q: number; r: number }[] = [];
      for (const cell of frontier) {
        for (const neighbor of neighborsOf(cell.q, cell.r)) {
          const key = gridKey(neighbor);
          if (visited.has(key)) continue;
          visited.add(key);
          if (cityKeysOf.has(key) || facilityKeys.has(key)) continue;
          if (!passableNonCityCell(state, neighbor)) continue;
          next.push(neighbor);
          if (deployKeys.has(key)) continue;
          const path = computeDelegatePath(preview.state, preview.unitId, neighbor);
          if (path && path.length > 1) {
            target = neighbor;
            break;
          }
        }
        if (target) break;
      }
      frontier = next;
    }
    expect(target).toBeDefined();
    if (!target) return;

    renderState(state);
    panMapTo(target.q, target.r);
    await user.click(screen.getByRole('button', { name: /^江陵 刘备/ }));
    const cityMenu = screen.getByTestId('city-command-menu');
    await user.click(within(cityMenu).getByRole('button', { name: '军事' }));
    await user.click(within(cityMenu).getByRole('button', { name: '出征' }));
    const deployDialog = await chooseDeployLeader(user, '刘备');
    await user.click(within(deployDialog).getByRole('button', { name: '确定出征' }));

    const targetCell = screen.getByTestId(`map-cell-${target.q}-${target.r}`);
    fireEvent.pointerDown(targetCell, { button: 0, buttons: 1, clientX: 320, clientY: 220 });
    expect(screen.getByTestId('delegate-menu')).toBeVisible();

    // 右键空白处：委任菜单关闭，出征流程保留（仍可再次点击同一超距格弹出菜单）
    fireEvent.contextMenu(screen.getByTestId('map-viewport'), { clientX: 360, clientY: 260 });
    expect(screen.queryByTestId('delegate-menu')).not.toBeInTheDocument();
    expect(screen.queryByTestId('map-context-menu')).not.toBeInTheDocument();
    expect(screen.getAllByTestId(/move-target-/).length).toBeGreaterThan(0);

    fireEvent.pointerDown(screen.getByTestId(`map-cell-${target.q}-${target.r}`), { button: 0, buttons: 1, clientX: 320, clientY: 220 });
    expect(screen.getByTestId('delegate-menu')).toBeVisible();
  });

  it('attacks an enemy city from the unit command menu when no enemy unit is in range', async () => {
    const user = userEvent.setup();
    const game = createGame('liu', 1);
    game.cities['jiangling'].armaments = { ...initialArmaments(), ram: 5 };
    const deployed = deployUnit(game, 'liu', {
      cityId: 'jiangling',
      officerId: 'guan-yu',
      targetCityId: 'xiangyang',
      troopType: 'siege',
      siegeWeapon: 'ram',
      troops: 4000,
      food: 6000,
    });
    const state = deployed;
    const attacker = Object.values(state.units)[0];
    const target = state.cities.xiangyang;
    const attackCell = sevenCellCityFootprint({ q: target.gridQ, r: target.gridR })
      .flatMap((coord) => neighborsOf(coord.q, coord.r))
      .find((coord) => !cityKeys(state).has(gridKey(coord)))!;
    state.units[attacker.id].q = attackCell.q;
    state.units[attacker.id].r = attackCell.r;
    state.units[attacker.id].moved = false;
    state.units[attacker.id].acted = false;
    state.units[attacker.id].movementRemaining = 16;
    renderState(state);

    const unitMarker = screen.getAllByTestId('battle-unit-marker')
      .find((marker) => marker.getAttribute('data-grid-position') === `${attacker.q},${attacker.r}`)!;
    fireEvent.pointerDown(unitMarker, { button: 0, buttons: 1, clientX: 240, clientY: 180 });
    fireEvent.pointerDown(unitMarker, { button: 0, buttons: 1, clientX: 240, clientY: 180 });

    const unitMenu = screen.getByTestId('unit-command-menu');
    await user.click(within(unitMenu).getByRole('button', { name: '攻击' }));

    const xiangyang = screen.getAllByTestId('city-marker')
      .find((marker) => marker.textContent?.includes('襄阳'))!;
    const troopsBefore = Number(within(xiangyang).getByTestId('city-marker-troops').textContent);
    await user.click(xiangyang);

    expect(Number(within(xiangyang).getByTestId('city-marker-troops').textContent)).toBeLessThan(troopsBefore);
    expect(screen.queryByTestId('unit-command-menu')).not.toBeInTheDocument();
  });

  it('disables attack commands when no enemy unit or city is in range', () => {
    const deployed = deployUnit(createGame('liu', 1), 'liu', {
      cityId: 'jiangling',
      officerId: 'guan-yu',
      troopType: 'spear',
      troops: 4000,
      food: 6000,
    });
    renderState(settleTenDay(deployed));

    const unitMarker = screen.getByTestId('battle-unit-marker');
    fireEvent.pointerDown(unitMarker, { button: 0, buttons: 1, clientX: 240, clientY: 180 });
    fireEvent.pointerDown(unitMarker, { button: 0, buttons: 1, clientX: 240, clientY: 180 });

    const unitMenu = screen.getByTestId('unit-command-menu');
    for (const label of ['攻击', '齐攻', '战法', '单挑']) {
      expect(within(unitMenu).getByRole('button', { name: label })).toBeDisabled();
    }
  });

  it('enables attack, tactics, and duel from a move destination adjacent to an enemy unit', () => {
    const deployed = deployUnit(createGame('liu', 1), 'liu', {
      cityId: 'jiangling',
      officerId: 'guan-yu',
      troopType: 'spear',
      troops: 4000,
      food: 6000,
    });
    const state = settleTenDay(deployed);
    for (const cell of state.grid) cell.terrain = 'plain';
    const attacker = Object.values(state.units)[0];
    const { destination, enemyPosition } = destinationWithEnemyNeighbor(state, attacker.id);
    state.units['enemy-after-move'] = {
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
    renderState(state);
    // 等比后攻击/齐攻的目标格(江陵附近)在初始视野外，平移到目的地格让 move-target 渲染
    panMapTo(destination.q, destination.r);

    const playerUnit = screen.getAllByTestId('battle-unit-marker')
      .find((marker) => marker.getAttribute('data-grid-position') === `${attacker.q},${attacker.r}`)!;
    fireEvent.pointerDown(playerUnit, { button: 0, buttons: 1, clientX: 240, clientY: 180 });
    fireEvent.pointerDown(screen.getByTestId(`move-target-${destination.q}-${destination.r}`), { button: 0, buttons: 1, clientX: 320, clientY: 220 });

    const menu = screen.getByTestId('unit-command-menu');
    expect(within(menu).getByRole('button', { name: '攻击' })).toBeEnabled();
    expect(within(menu).getByRole('button', { name: '战法' })).toBeEnabled();
    expect(within(menu).getByRole('button', { name: '单挑' })).toBeEnabled();
    expect(within(menu).getByRole('button', { name: '齐攻' })).toBeDisabled();

    fireEvent.click(within(menu).getByRole('button', { name: '攻击' }));

    expect(screen.getByTestId('attack-target-arrow')).toBeVisible();
  });

  it('opens troop tactics from the unit command menu and executes the selected tactic', async () => {
    const user = userEvent.setup();
    const state = deployUnit(createGame('liu', 1), 'liu', {
      cityId: 'jiangling',
      officerId: 'guan-yu',
      troopType: 'spear',
      troops: 3000,
      food: 3000,
    });
    const attacker = Object.values(state.units)[0];
    // 血色衣冠地图下 (10,10) 附近为山地，改用西北平原区 (2,23)（偶数列，邻接与推动落点关系一致）
    state.units[attacker.id].q = 2;
    state.units[attacker.id].r = 23;
    state.units[attacker.id].moved = false;
    state.units[attacker.id].acted = false;
    state.units[attacker.id].energy = 100;
    state.units[attacker.id].movementRemaining = 22;
    state.units['enemy-tactic-target'] = {
      id: 'enemy-tactic-target',
      forceId: 'cao',
      leaderId: 'cao-ren',
      homeCityId: 'xiangyang',
      q: 3,
      r: 23,
      troops: 3000,
      food: 3000,
      energy: 100,
      movementRemaining: 5,
      moved: false,
      acted: false,
    };
    renderState(state);
    // 等比后(2,23)部队区域在初始视野外，平移到该区域让目标/部队格渲染
    panMapTo(2, 23);

    const playerUnit = screen.getAllByTestId('battle-unit-marker')
      .find((marker) => marker.getAttribute('data-grid-position') === '2,23')!;
    fireEvent.pointerDown(playerUnit, { button: 0, buttons: 1, clientX: 240, clientY: 180 });
    fireEvent.pointerDown(playerUnit, { button: 0, buttons: 1, clientX: 240, clientY: 180 });

    await user.click(within(screen.getByTestId('unit-command-menu')).getByRole('button', { name: '战法' }));

    const tacticMenu = screen.getByTestId('unit-tactic-menu');
    expect(within(tacticMenu).getByRole('button', { name: '突刺' })).toBeVisible();
    expect(within(tacticMenu).getByRole('button', { name: '螺旋突刺' })).toBeVisible();
    expect(within(tacticMenu).getByRole('button', { name: '二段突刺' })).toBeVisible();

    await user.click(within(tacticMenu).getByRole('button', { name: '突刺' }));
    expect(screen.getByTestId('attack-target-arrow')).toBeVisible();

    const enemyUnit = screen.getAllByTestId('battle-unit-marker')
      .find((marker) => marker.getAttribute('data-grid-position') === '3,23')!;
    fireEvent.pointerDown(enemyUnit, { button: 0, buttons: 1, clientX: 280, clientY: 180 });

    expect(screen.getAllByTestId('battle-unit-marker')
      .find((marker) => marker.getAttribute('data-grid-position') === '4,24')).toBeTruthy();
    expect(screen.getByTestId('battle-damage-number')).toBeVisible();
  });

  it('shows all troop tactics while locking tiers above the formation aptitude', async () => {
    const user = userEvent.setup();
    const state = deployUnit(createGame('liu', 1), 'liu', {
      cityId: 'jiangling',
      officerId: 'guan-yu',
      troopType: 'spear',
      troops: 3000,
      food: 3000,
    });
    const attacker = Object.values(state.units)[0];
    state.officers['guan-yu'].aptitudes = { ...state.officers['guan-yu'].aptitudes!, spear: 'B' };
    Object.assign(attacker, { q: 10, r: 10, energy: 100, moved: false, acted: false, movementRemaining: 22 });
    state.units['enemy-aptitude-target'] = {
      id: 'enemy-aptitude-target',
      forceId: 'cao',
      leaderId: 'cao-ren',
      homeCityId: 'xiangyang',
      q: 11,
      r: 10,
      troops: 3000,
      food: 3000,
      energy: 100,
      movementRemaining: 5,
      moved: false,
      acted: false,
    };
    renderState(state);

    const marker = screen.getAllByTestId('battle-unit-marker')
      .find((candidate) => candidate.getAttribute('data-grid-position') === '10,10')!;
    fireEvent.pointerDown(marker, { button: 0, buttons: 1, clientX: 240, clientY: 180 });
    fireEvent.pointerDown(marker, { button: 0, buttons: 1, clientX: 240, clientY: 180 });
    const tacticCommand = within(screen.getByTestId('unit-command-menu')).getByRole('button', { name: '战法' });

    expect(tacticCommand).toBeEnabled();
    await user.click(tacticCommand);

    const tacticMenu = screen.getByTestId('unit-tactic-menu');
    expect(within(tacticMenu).getByRole('button', { name: '突刺' })).toBeEnabled();
    expect(within(tacticMenu).getByRole('button', { name: '螺旋突刺' })).toBeDisabled();
    expect(within(tacticMenu).getByRole('button', { name: '螺旋突刺' })).toHaveAttribute('title', '需要枪兵适性 A');
    expect(within(tacticMenu).getByRole('button', { name: '二段突刺' })).toBeDisabled();
    expect(within(tacticMenu).getByRole('button', { name: '二段突刺' })).toHaveAttribute('title', '需要枪兵适性 S');
  });

  it('locks tactics that cost more stamina while keeping an affordable tactic usable', async () => {
    const user = userEvent.setup();
    const state = deployUnit(createGame('liu', 1), 'liu', {
      cityId: 'jiangling',
      officerId: 'guan-yu',
      troopType: 'spear',
      troops: 3000,
      food: 3000,
    });
    const attacker = Object.values(state.units)[0];
    Object.assign(attacker, { q: 10, r: 10, stamina: 19, moved: false, acted: false, movementRemaining: 22 });
    state.units['enemy-energy-target'] = {
      id: 'enemy-energy-target',
      forceId: 'cao',
      leaderId: 'cao-ren',
      homeCityId: 'xiangyang',
      q: 11,
      r: 10,
      troops: 3000,
      food: 3000,
      energy: 100,
      movementRemaining: 5,
      moved: false,
      acted: false,
    };
    renderState(state);

    const marker = screen.getAllByTestId('battle-unit-marker')
      .find((candidate) => candidate.getAttribute('data-grid-position') === '10,10')!;
    fireEvent.pointerDown(marker, { button: 0, buttons: 1, clientX: 240, clientY: 180 });
    fireEvent.pointerDown(marker, { button: 0, buttons: 1, clientX: 240, clientY: 180 });
    const tacticCommand = within(screen.getByTestId('unit-command-menu')).getByRole('button', { name: '战法' });

    expect(tacticCommand).toBeEnabled();
    await user.click(tacticCommand);

    const tacticMenu = screen.getByTestId('unit-tactic-menu');
    expect(within(tacticMenu).getByRole('button', { name: '突刺' })).toBeEnabled();
    expect(within(tacticMenu).getByRole('button', { name: '螺旋突刺' })).toBeDisabled();
    expect(within(tacticMenu).getByRole('button', { name: '螺旋突刺' })).toHaveAttribute('title', '战力不足');
  });

  it('locks a tactic without a valid target while another tactic keeps the primary command enabled', async () => {
    const user = userEvent.setup();
    const state = deployUnit(createGame('liu', 1), 'liu', {
      cityId: 'jiangling',
      officerId: 'guan-yu',
      troopType: 'crossbow',
      troops: 2000,
      food: 3000,
    });
    const attacker = Object.values(state.units)[0];
    state.officers['guan-yu'].aptitudes = { ...state.officers['guan-yu'].aptitudes!, crossbow: 'S' };
    Object.assign(attacker, { q: 10, r: 10, energy: 100, moved: false, acted: false, movementRemaining: 19 });
    state.units['enemy-crossbow-target'] = {
      id: 'enemy-crossbow-target',
      forceId: 'cao',
      leaderId: 'cao-ren',
      homeCityId: 'xiangyang',
      q: 11,
      r: 10,
      troops: 3000,
      food: 3000,
      energy: 100,
      movementRemaining: 5,
      moved: false,
      acted: false,
    };
    renderState(state);

    const marker = screen.getAllByTestId('battle-unit-marker')
      .find((candidate) => candidate.getAttribute('data-grid-position') === '10,10')!;
    fireEvent.pointerDown(marker, { button: 0, buttons: 1, clientX: 240, clientY: 180 });
    fireEvent.pointerDown(marker, { button: 0, buttons: 1, clientX: 240, clientY: 180 });
    const tacticCommand = within(screen.getByTestId('unit-command-menu')).getByRole('button', { name: '战法' });

    expect(tacticCommand).toBeEnabled();
    await user.click(tacticCommand);

    const tacticMenu = screen.getByTestId('unit-tactic-menu');
    expect(within(tacticMenu).getByRole('button', { name: '火矢' })).toBeDisabled();
    expect(within(tacticMenu).getByRole('button', { name: '火矢' })).toHaveAttribute('title', '无有效目标');
    expect(within(tacticMenu).getByRole('button', { name: '贯箭' })).toBeDisabled();
    expect(within(tacticMenu).getByRole('button', { name: '乱射' })).toBeEnabled();
  });

  it('disables the primary tactic command when every tactic is unavailable', () => {
    const state = deployUnit(createGame('liu', 1), 'liu', {
      cityId: 'jiangling',
      officerId: 'guan-yu',
      troopType: 'spear',
      troops: 3000,
      food: 3000,
    });
    const attacker = Object.values(state.units)[0];
    Object.assign(attacker, { q: 10, r: 10, stamina: 14, moved: false, acted: false, movementRemaining: 22 });
    state.units['enemy-unavailable-target'] = {
      id: 'enemy-unavailable-target',
      forceId: 'cao',
      leaderId: 'cao-ren',
      homeCityId: 'xiangyang',
      q: 11,
      r: 10,
      troops: 3000,
      food: 3000,
      energy: 100,
      movementRemaining: 5,
      moved: false,
      acted: false,
    };
    renderState(state);

    const marker = screen.getAllByTestId('battle-unit-marker')
      .find((candidate) => candidate.getAttribute('data-grid-position') === '10,10')!;
    fireEvent.pointerDown(marker, { button: 0, buttons: 1, clientX: 240, clientY: 180 });
    fireEvent.pointerDown(marker, { button: 0, buttons: 1, clientX: 240, clientY: 180 });

    expect(within(screen.getByTestId('unit-command-menu')).getByRole('button', { name: '战法' })).toBeDisabled();
  });

  it('does not enter target selection when a locked tactic is clicked', async () => {
    const user = userEvent.setup();
    const state = deployUnit(createGame('liu', 1), 'liu', {
      cityId: 'jiangling',
      officerId: 'guan-yu',
      troopType: 'spear',
      troops: 3000,
      food: 3000,
    });
    const attacker = Object.values(state.units)[0];
    state.officers['guan-yu'].aptitudes = { ...state.officers['guan-yu'].aptitudes!, spear: 'B' };
    Object.assign(attacker, { q: 10, r: 10, energy: 100, moved: false, acted: false, movementRemaining: 22 });
    state.units['enemy-locked-target'] = {
      id: 'enemy-locked-target',
      forceId: 'cao',
      leaderId: 'cao-ren',
      homeCityId: 'xiangyang',
      q: 11,
      r: 10,
      troops: 3000,
      food: 3000,
      energy: 100,
      movementRemaining: 5,
      moved: false,
      acted: false,
    };
    renderState(state);

    const marker = screen.getAllByTestId('battle-unit-marker')
      .find((candidate) => candidate.getAttribute('data-grid-position') === '10,10')!;
    fireEvent.pointerDown(marker, { button: 0, buttons: 1, clientX: 240, clientY: 180 });
    fireEvent.pointerDown(marker, { button: 0, buttons: 1, clientX: 240, clientY: 180 });
    await user.click(within(screen.getByTestId('unit-command-menu')).getByRole('button', { name: '战法' }));

    const lockedTactic = within(screen.getByTestId('unit-tactic-menu')).getByRole('button', { name: '螺旋突刺' });
    fireEvent.click(lockedTactic);

    expect(screen.queryByTestId('attack-target-arrow')).not.toBeInTheDocument();
    expect(screen.getByTestId('unit-tactic-menu')).toBeVisible();
  });

  it('ignites a completed fire ball facility when clicked as a fire strategy target', async () => {
    const user = userEvent.setup();
    const state = deployUnit(createGame('liu', 1), 'liu', {
      cityId: 'jiangling',
      officerId: 'guan-yu',
      troops: 4000,
      food: 6000,
    });
    const attacker = Object.values(state.units)[0];
    Object.assign(attacker, { q: 10, r: 10, energy: 100, moved: false, acted: false, movementRemaining: 22 });
    state.facilities = {
      ball: { id: 'ball', type: 'fireBall', forceId: 'liu', q: 11, r: 10, durability: 200, completed: true },
    };
    renderState(state);
    panMapTo(10, 10);

    const marker = screen.getAllByTestId('battle-unit-marker')
      .find((candidate) => candidate.getAttribute('data-grid-position') === '10,10')!;
    fireEvent.pointerDown(marker, { button: 0, buttons: 1, clientX: 240, clientY: 180 });
    fireEvent.pointerDown(marker, { button: 0, buttons: 1, clientX: 240, clientY: 180 });
    await user.click(within(screen.getByTestId('unit-command-menu')).getAllByRole('button')[5]);
    await user.click(within(screen.getByTestId('unit-strategy-menu')).getAllByRole('button')[0]);

    expect(screen.getByTestId('strategy-target-11-10')).toBeVisible();
    fireEvent.pointerDown(screen.getByTestId('battle-facility-marker'), { button: 0, buttons: 1, clientX: 280, clientY: 180 });

    expect(screen.queryByTestId('battle-facility-marker')).not.toBeInTheDocument();
    expect(screen.getAllByTestId('fire-cell-marker')).toHaveLength(3);
  });

  it('ignites a completed fire ball facility when clicked as a fire arrow tactic target', async () => {
    const user = userEvent.setup();
    const state = deployUnit(createGame('liu', 1), 'liu', {
      cityId: 'jiangling',
      officerId: 'guan-yu',
      troopType: 'crossbow',
      troops: 1000,
      food: 6000,
    });
    const attacker = Object.values(state.units)[0];
    Object.assign(attacker, { q: 10, r: 10, energy: 100, moved: false, acted: false, movementRemaining: 22 });
    state.facilities = {
      ball: { id: 'ball', type: 'fireBall', forceId: 'liu', q: 12, r: 11, durability: 200, completed: true },
    };
    renderState(state);

    const marker = screen.getAllByTestId('battle-unit-marker')
      .find((candidate) => candidate.getAttribute('data-grid-position') === '10,10')!;
    fireEvent.pointerDown(marker, { button: 0, buttons: 1, clientX: 240, clientY: 180 });
    fireEvent.pointerDown(marker, { button: 0, buttons: 1, clientX: 240, clientY: 180 });
    await user.click(within(screen.getByTestId('unit-command-menu')).getByRole('button', { name: '战法' }));
    await user.click(within(screen.getByTestId('unit-tactic-menu')).getByRole('button', { name: '火矢' }));

    expect(screen.getByTestId('attack-facility-target-arrow')).toBeVisible();
    fireEvent.pointerDown(screen.getByTestId('battle-facility-marker'), { button: 0, buttons: 1, clientX: 300, clientY: 180 });

    expect(screen.queryByTestId('battle-facility-marker')).not.toBeInTheDocument();
    expect(screen.getAllByTestId('fire-cell-marker')).toHaveLength(3);
  });

  it('enables joint attack from a move destination when another actionable friendly unit also neighbors the enemy', () => {
    const deployed = deployUnit(createGame('liu', 1), 'liu', {
      cityId: 'jiangling',
      officerId: 'guan-yu',
      troops: 4000,
      food: 6000,
    });
    const state = settleTenDay(deployed);
    const attacker = Object.values(state.units)[0];
    const { destination, enemyPosition } = destinationWithEnemyNeighbor(state, attacker.id);
    const allyPosition = neighborsOf(enemyPosition.q, enemyPosition.r)
      .find((coord) => (
        (coord.q !== destination.q || coord.r !== destination.r) &&
        passableNonCityCell(state, coord) &&
        !Object.values(state.units).some((unit) => unit.q === coord.q && unit.r === coord.r)
      ))!;
    state.units['ally-joint'] = {
      id: 'ally-joint',
      forceId: 'liu',
      leaderId: 'zhang-fei',
      homeCityId: 'wuling',
      q: allyPosition.q,
      r: allyPosition.r,
      troops: 3000,
      food: 3000,
      energy: 100,
      movementRemaining: 5,
      moved: false,
      acted: false,
    };
    state.units['enemy-after-move'] = {
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
    renderState(state);
    // 等比后攻击/齐攻的目标格(江陵附近)在初始视野外，平移到目的地格让 move-target 渲染
    panMapTo(destination.q, destination.r);

    const playerUnit = screen.getAllByTestId('battle-unit-marker')
      .find((marker) => marker.getAttribute('data-grid-position') === `${attacker.q},${attacker.r}`)!;
    fireEvent.pointerDown(playerUnit, { button: 0, buttons: 1, clientX: 240, clientY: 180 });
    fireEvent.pointerDown(screen.getByTestId(`move-target-${destination.q}-${destination.r}`), { button: 0, buttons: 1, clientX: 320, clientY: 220 });

    expect(within(screen.getByTestId('unit-command-menu')).getByRole('button', { name: '齐攻' })).toBeEnabled();

    fireEvent.click(within(screen.getByTestId('unit-command-menu')).getByRole('button', { name: '齐攻' }));
    const enemy = screen.getAllByTestId('battle-unit-marker')
      .find((marker) => marker.getAttribute('data-grid-position') === `${enemyPosition.q},${enemyPosition.r}`)!;
    fireEvent.pointerDown(enemy, { button: 0, buttons: 1, clientX: 360, clientY: 260 });

    const jointDamage = screen.getAllByTestId('battle-damage-number')
      .find((node) => node.getAttribute('class')?.includes('is-jointAttack'));
    expect(jointDamage).toBeTruthy();
    expect(jointDamage!.textContent).toMatch(/^-/);
    expect(Number(jointDamage!.textContent!.replace(/[^0-9]/g, ''))).toBeGreaterThan(0);
  });

  it('shows yellow arrows above enemy units that can be attacked', async () => {
    const user = userEvent.setup();
    const deployed = deployUnit(createGame('liu', 1), 'liu', {
      cityId: 'jiangling',
      officerId: 'guan-yu',
      troops: 4000,
      food: 6000,
    });
    const state = settleTenDay(deployed);
    const attacker = Object.values(state.units)[0];
    const targetPosition = neighborsOf(attacker.q, attacker.r)[0];
    state.units['enemy-target'] = {
      id: 'enemy-target',
      forceId: 'cao',
      leaderId: 'cao-ren',
      homeCityId: 'xiangyang',
      q: targetPosition.q,
      r: targetPosition.r,
      troops: 3000,
      food: 3000,
      energy: 100,
      movementRemaining: 5,
      moved: false,
      acted: false,
    };
    renderState(state);
    // 等比后攻击目标(江陵附近)在初始视野外，平移到单位处让目标格/敌人显示
    panMapTo(attacker.q, attacker.r);

    const playerUnit = screen.getAllByTestId('battle-unit-marker')
      .find((marker) => marker.getAttribute('data-grid-position') === `${attacker.q},${attacker.r}`)!;
    fireEvent.pointerDown(playerUnit, { button: 0, buttons: 1, clientX: 240, clientY: 180 });
    fireEvent.pointerDown(playerUnit, { button: 0, buttons: 1, clientX: 240, clientY: 180 });

    const unitMenu = screen.getByTestId('unit-command-menu');
    expect(within(unitMenu).getByRole('button', { name: '攻击' })).toBeEnabled();
    await user.click(within(unitMenu).getByRole('button', { name: '攻击' }));

    expect(screen.getByTestId('attack-target-arrow')).toBeVisible();
    expect(screen.getByTestId('attack-target-arrow')).toHaveTextContent('▼');
  });

  it('attacks a selected enemy unit and shows damage numbers above both units for two seconds after counterattack', async () => {
    vi.useFakeTimers();
    const deployed = deployUnit(createGame('liu', 1), 'liu', {
      cityId: 'jiangling',
      officerId: 'guan-yu',
      troops: 4000,
      food: 6000,
    });
    const state = settleTenDay(deployed);
    const attacker = Object.values(state.units)[0];
    const targetPosition = neighborsOf(attacker.q, attacker.r)[0];
    state.units['enemy-target'] = {
      id: 'enemy-target',
      forceId: 'cao',
      leaderId: 'cao-ren',
      homeCityId: 'xiangyang',
      q: targetPosition.q,
      r: targetPosition.r,
      troops: 3000,
      food: 3000,
      energy: 100,
      movementRemaining: 5,
      moved: false,
      acted: false,
    };
    try {
      renderState(state);

      const playerUnit = screen.getAllByTestId('battle-unit-marker')
        .find((marker) => marker.getAttribute('data-grid-position') === `${attacker.q},${attacker.r}`)!;
      fireEvent.pointerDown(playerUnit, { button: 0, buttons: 1, clientX: 240, clientY: 180 });
      fireEvent.pointerDown(playerUnit, { button: 0, buttons: 1, clientX: 240, clientY: 180 });

      fireEvent.click(within(screen.getByTestId('unit-command-menu')).getByRole('button', { name: '攻击' }));
      const enemyUnit = screen.getAllByTestId('battle-unit-marker')
        .find((marker) => marker.getAttribute('data-grid-position') === `${targetPosition.q},${targetPosition.r}`)!;
      fireEvent.pointerDown(enemyUnit, { button: 0, buttons: 1, clientX: 280, clientY: 180 });

      const damageNumbers = screen.getAllByTestId('battle-damage-number');
      expect(damageNumbers).toHaveLength(2);
      expect(damageNumbers.every((node) => node.textContent?.startsWith('-'))).toBe(true);
      expect(screen.queryByTestId('attack-target-arrow')).not.toBeInTheDocument();

      act(() => vi.advanceTimersByTime(1999));
      expect(screen.getAllByTestId('battle-damage-number')).toHaveLength(2);

      act(() => vi.advanceTimersByTime(1));
      expect(screen.queryByTestId('battle-damage-number')).not.toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it('shows failed strategy feedback for two seconds without rendering successful outcomes', () => {
    vi.useFakeTimers();
    const state = createGame('liu', 1);
    state.strategyResultReports = [
      {
        id: 'strategy-failed',
        strategyId: 'fire',
        q: 10,
        r: 10,
        label: '计略失败',
        succeeded: false,
      },
      {
        id: 'strategy-succeeded',
        strategyId: 'fire',
        q: 11,
        r: 10,
        label: '计略成功',
        succeeded: true,
      },
    ];

    try {
      renderState(state);

      expect(screen.getByTestId('strategy-result-label')).toHaveTextContent('计略失败');
      expect(screen.queryByText('计略成功')).not.toBeInTheDocument();

      act(() => vi.advanceTimersByTime(1999));
      expect(screen.getByTestId('strategy-result-label')).toBeVisible();

      act(() => vi.advanceTimersByTime(1));
      expect(screen.queryByTestId('strategy-result-label')).not.toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not show old damage numbers again after advancing the ten-day turn', () => {
    vi.useFakeTimers();
    const deployed = deployUnit(createGame('liu', 1), 'liu', {
      cityId: 'jiangling',
      officerId: 'guan-yu',
      troops: 4000,
      food: 6000,
    });
    const state = settleTenDay(deployed);
    const attacker = Object.values(state.units)[0];
    const targetPosition = neighborsOf(attacker.q, attacker.r)[0];
    state.units['enemy-target'] = {
      id: 'enemy-target',
      forceId: 'cao',
      leaderId: 'cao-ren',
      homeCityId: 'xiangyang',
      q: targetPosition.q,
      r: targetPosition.r,
      troops: 3000,
      food: 3000,
      energy: 100,
      movementRemaining: 5,
      moved: false,
      acted: false,
    };

    try {
      renderState(state);

      const playerUnit = screen.getAllByTestId('battle-unit-marker')
        .find((marker) => marker.getAttribute('data-grid-position') === `${attacker.q},${attacker.r}`)!;
      fireEvent.pointerDown(playerUnit, { button: 0, buttons: 1, clientX: 240, clientY: 180 });
      fireEvent.pointerDown(playerUnit, { button: 0, buttons: 1, clientX: 240, clientY: 180 });
      fireEvent.click(within(screen.getByTestId('unit-command-menu')).getByRole('button', { name: '攻击' }));

      const enemyUnit = screen.getAllByTestId('battle-unit-marker')
        .find((marker) => marker.getAttribute('data-grid-position') === `${targetPosition.q},${targetPosition.r}`)!;
      fireEvent.pointerDown(enemyUnit, { button: 0, buttons: 1, clientX: 280, clientY: 180 });
      expect(screen.getAllByTestId('battle-damage-number')).toHaveLength(2);

      act(() => vi.advanceTimersByTime(2000));
      expect(screen.queryByTestId('battle-damage-number')).not.toBeInTheDocument();

      fireEvent.click(screen.getByTestId('end-ten-day-button'));
      expect(screen.queryByTestId('battle-damage-number')).not.toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not show old damage numbers again after recruiting troops', () => {
    vi.useFakeTimers();
    const state = createGame('liu', 1);
    // 征兵需先建兵舍：为江陵预置一座兵舍
    const emptyPlot = (state.cities.jiangling.plots ?? []).find((plot) => plot && plot.type === 'empty' && !plot.constructing);
    if (emptyPlot) {
      emptyPlot.type = 'barracks';
      emptyPlot.level = 1;
    }
    state.battleDamageReports = [{
      id: 'old-damage',
      unitId: 'old-target',
      q: 10,
      r: 10,
      amount: 900,
      kind: 'attack',
    }];

    try {
      renderState(state);

      expect(screen.getByTestId('battle-damage-number')).toHaveTextContent('-900');
      act(() => vi.advanceTimersByTime(2000));
      expect(screen.queryByTestId('battle-damage-number')).not.toBeInTheDocument();

      const jianglingMarker = screen.getAllByTestId('city-marker').find((marker) => marker.textContent?.includes(state.cities.jiangling.name));
      expect(jianglingMarker).toBeTruthy();
      fireEvent.click(jianglingMarker!);
      fireEvent.click(screen.getByTestId('city-command-section-urban'));
      fireEvent.click(screen.getByTestId('city-command-command-recruit'));
      fireEvent.submit(screen.getByRole('dialog'));

      expect(screen.queryByTestId('battle-damage-number')).not.toBeInTheDocument();
      expect(screen.getByTestId('city-effect-number')).toBeVisible();
    } finally {
      vi.useRealTimers();
    }
  });

  it('closes the unit command menu and suppresses the browser menu when right clicking on it', () => {
    const deployed = deployUnit(createGame('liu', 1), 'liu', {
      cityId: 'jiangling',
      officerId: 'guan-yu',
      troops: 4000,
      food: 6000,
    });
    renderState(settleTenDay(deployed));

    const unitMarker = screen.getByTestId('battle-unit-marker');
    fireEvent.pointerDown(unitMarker, { button: 0, buttons: 1, clientX: 240, clientY: 180 });
    fireEvent.pointerDown(unitMarker, { button: 0, buttons: 1, clientX: 240, clientY: 180 });
    const menu = screen.getByTestId('unit-command-menu');

    const defaultWasAllowed = fireEvent.contextMenu(menu);

    expect(defaultWasAllowed).toBe(false);
    expect(screen.queryByTestId('unit-command-menu')).not.toBeInTheDocument();
  });

  it('opens unit intel actions from a unit right click and shows detailed unit information', async () => {
    const user = userEvent.setup();
    const deployed = deployUnit(createGame('liu', 1), 'liu', {
      cityId: 'jiangling',
      officerIds: ['guan-yu', 'liu-bei', 'jian-yong'],
      troopType: 'spear',
      troops: 3600,
      food: 6100,
    });
    const unit = Object.values(deployed.units)[0];
    renderState(deployed);

    const defaultWasAllowed = fireEvent.contextMenu(screen.getByTestId('battle-unit-marker'), { clientX: 260, clientY: 190 });

    expect(defaultWasAllowed).toBe(false);
    const intelMenu = screen.getByTestId('unit-intel-context-menu');
    expect(within(intelMenu).getByTestId('unit-detail-button')).toBeVisible();
    expect(within(intelMenu).getByTestId('unit-officers-button')).toBeVisible();
    expect(screen.queryByTestId('unit-command-menu')).not.toBeInTheDocument();

    await user.click(within(intelMenu).getByTestId('unit-detail-button'));

    const dialog = screen.getByTestId('unit-detail-dialog');
    expect(dialog).toHaveTextContent(deployed.officers['guan-yu'].name);
    expect(dialog).toHaveTextContent(deployed.officers['liu-bei'].name);
    expect(dialog).toHaveTextContent(deployed.forces[unit.forceId].name);
    expect(dialog).toHaveTextContent(unit.troops.toLocaleString('en-US'));
    expect(dialog).toHaveTextContent(unit.food.toLocaleString('en-US'));
    expect(dialog).toHaveTextContent(String(unit.energy));
    expect(dialog).toHaveTextContent(String(unit.movementRemaining));
    expect(screen.queryByTestId('unit-intel-context-menu')).not.toBeInTheDocument();
  });

  it('closes the unit right-click intel menu when left clicking another friendly unit', () => {
    let state = deployUnit(createGame('liu', 1), 'liu', {
      cityId: 'jiangling',
      officerId: 'guan-yu',
      troopType: 'spear',
      troops: 3600,
      food: 6100,
    });
    state = deployUnit(state, 'liu', {
      cityId: 'wuling',
      officerId: 'zhang-fei',
      troopType: 'sword',
      troops: 3200,
      food: 5000,
    });
    state = settleTenDay(state);
    const units = Object.values(state.units);
    state.units[units[0].id].q = 10;
    state.units[units[0].id].r = 10;
    state.units[units[1].id].q = 11;
    state.units[units[1].id].r = 10;
    renderState(state);

    const markers = screen.getAllByTestId('battle-unit-marker');
    fireEvent.contextMenu(markers[0], { clientX: 260, clientY: 190 });

    expect(screen.getByTestId('unit-intel-context-menu')).toBeVisible();

    fireEvent.pointerDown(markers[1], { button: 0, buttons: 1, clientX: 300, clientY: 190 });

    expect(screen.queryByTestId('unit-intel-context-menu')).not.toBeInTheDocument();
  });

  it('opens the selected unit officer list from a unit right click', async () => {
    const user = userEvent.setup();
    const deployed = deployUnit(createGame('liu', 1), 'liu', {
      cityId: 'jiangling',
      officerIds: ['guan-yu', 'liu-bei', 'jian-yong'],
      troopType: 'spear',
      troops: 3600,
      food: 6100,
    });
    renderState(deployed);

    fireEvent.contextMenu(screen.getByTestId('battle-unit-marker'), { clientX: 260, clientY: 190 });
    await user.click(within(screen.getByTestId('unit-intel-context-menu')).getByTestId('unit-officers-button'));

    const dialog = screen.getByTestId('unit-officer-list-dialog');
    expect(officerNamesIn(dialog)).toEqual(['guan-yu', 'liu-bei', 'jian-yong'].map((id) => deployed.officers[id].name));
    expect(within(dialog).queryByRole('rowheader', { name: deployed.officers['zhang-fei'].name })).not.toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: '能力' })).toHaveClass('is-active');
  });
});

describe('final settlement', () => {
  it('shows rankings and restart controls after month 24', () => {
    const state = createGame('liu', 5);
    state.month = 24;
    state.phase = 'finished';
    renderState(state);

    expect(screen.getByRole('heading', { name: '荆襄国力结算' })).toBeVisible();
    expect(screen.getAllByRole('row')).toHaveLength(5);
    expect(screen.getByRole('button', { name: '重新开局' })).toBeEnabled();
    expect(screen.getByRole('button', { name: '查看最终地图' })).toBeEnabled();
  });

  it('can return from the final map to the settlement', async () => {
    const user = userEvent.setup();
    const state = createGame('liu', 5);
    state.month = 24;
    state.phase = 'finished';
    renderState(state);

    await user.click(screen.getByRole('button', { name: '查看最终地图' }));
    expect(screen.getByRole('button', { name: '返回结算' })).toBeVisible();
    expect(screen.queryByRole('button', { name: '巡察' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '返回结算' }));
    expect(screen.getByRole('heading', { name: '荆襄国力结算' })).toBeVisible();
  });

  it('labels every row in a multi-way tied settlement', () => {
    const state = createGame('liu', 5);
    state.month = 24;
    state.phase = 'finished';
    for (const city of Object.values(state.cities)) {
      Object.assign(city, { gold: 5000, food: 20000, population: 90000, troops: 10000, commerce: 50, agriculture: 50, order: 80, training: 70 });
    }
    for (const officer of Object.values(state.officers)) {
      if (officer.forceId) Object.assign(officer.stats, { leadership: 70, war: 70, intelligence: 70, politics: 70, charisma: 70 });
    }

    renderState(state);

    expect(screen.getAllByText('并列 1')).toHaveLength(4);
    expect(screen.getByText(/最终并列第/)).toBeVisible();
  });
});

describe('占领空城后武将状态', () => {
  it('进驻空城后，随军武将状态显示为已行动', async () => {
    const user = userEvent.setup();
    const state = deployUnit(createGame('liu', 1), 'liu', {
      cityId: 'jiangling',
      officerIds: ['liu-bei', 'guan-yu'],
      troops: 4000,
      food: 6000,
    });
    const unit = Object.values(state.units)[0];
    const city = state.cities.nanpi;
    const footprint = sevenCellCityFootprint({ q: city.gridQ, r: city.gridR });
    const footprintKeys = new Set(footprint.map(gridKey));
    const spawn = footprint
      .flatMap((coord) => neighborsOf(coord.q, coord.r))
      .find((coord) => !footprintKeys.has(gridKey(coord)) && passableNonCityCell(state, coord))!;
    Object.assign(unit, { q: spawn.q, r: spawn.r, moved: false, acted: false, movementRemaining: 22 });
    state.officers['liu-bei'].acted = false;
    state.officers['guan-yu'].acted = false;

    renderState(state);
    panMapTo(unit.q, unit.r);
    fireEvent.pointerDown(screen.getByTestId('battle-unit-marker'), { button: 0, buttons: 1 });

    const cityMarker = screen.getAllByTestId('city-marker')
      .find((marker) => marker.getAttribute('aria-label')?.startsWith('南皮'))!;
    fireEvent.click(cityMarker);
    await user.click(screen.getByTestId('return-city-confirm-yes'));

    // 进驻后城池易主，随军武将进城且本旬已行动
    expect(state.cities.nanpi.ownerId).not.toBe('liu');
    fireEvent.contextMenu(cityMarker);
    await user.click(screen.getByTestId('city-info-officers-button'));
    const dialog = screen.getByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: '状态' }));
    expect(within(dialog).getAllByText('已行动')).toHaveLength(2);
    expect(within(dialog).queryAllByText('待命')).toHaveLength(0);
  });
});
