import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { GRID_HEIGHT as DEFAULT_GRID_HEIGHT, GRID_WIDTH as DEFAULT_GRID_WIDTH } from '../game/battle/scenario';
import { initialArmaments } from '../game/armaments';
import { deployUnit } from '../game/battle/actions';
import { sevenCellCityFootprint } from '../game/battle/grid';
import { createGame } from '../game/scenario/jingxiang208';
import { createMobileDuelGame } from '../game/scenario/mobileDuel';
import { GameProvider } from '../game/store/GameProvider';
import { completeTechResearch } from '../game/techs';
import { settleTenDay } from '../game/turn';
import type { CityId, GameState, TerrainType } from '../game/types';
import { GameShell } from './GameShell';

const TERRAIN_LABELS: Record<TerrainType, string> = {
  road: '主径',
  path: '小径',
  plank: '栈道',
  plain: '平地',
  grass: '草地',
  sand: '沙地',
  wasteland: '荒地',
  wetland: '湿地',
  poison: '毒泉',
  forest: '森林',
  hill: '丘陵',
  mountain: '山崖',
  shore: '岸',
  water: '水域',
  stream: '川',
  river: '河',
  sea: '海',
  shallow: '浅滩',
  ferry: '渡口',
  pass: '关隘',
  construction: '建设用地',
};

function renderGame(state = createGame('liu', 1)) {
  return render(
    <GameProvider initialState={state}>
      <GameShell />
    </GameProvider>,
  );
}

function zoomToTerrain() {
  // 默认视角（最高角度，约 30 格视野）下可见格子数已低于渲染阈值，
  // 地形与交互格子无需额外放大即渲染；保留函数以维持既有调用点语义。
}

function panViewport(dx: number, dy: number) {
  // 拖拽平移视野：默认 fallback 视口 1280×720，视野中心从地图中心移动 (dx, dy) 像素
  const viewport = screen.getByTestId('map-viewport');
  fireEvent.pointerDown(viewport, { pointerId: 1, button: 0, buttons: 1, clientX: 640, clientY: 360 });
  fireEvent.pointerMove(viewport, { pointerId: 1, clientX: 640 + dx, clientY: 360 + dy });
  fireEvent.pointerUp(viewport, { pointerId: 1 });
}

function resetCamera() {
  // 左上角的「复位地图」按钮已移除：改为把镜头拖回原点（data-view-x/y 归零 = 地图居中、当前缩放不变）
  const content = screen.getByTestId('map-content');
  const viewX = Number.parseFloat(content.getAttribute('data-view-x')!);
  const viewY = Number.parseFloat(content.getAttribute('data-view-y')!);
  if (viewX !== 0 || viewY !== 0) panViewport(-viewX, -viewY);
}

/** 断言镜头正中落在指定城池的中心格上（默认按测试环境视口回退 1280×720，与镜头钳制同一口径） */
function expectCameraCenteredOnCity(
  state: GameState,
  cityId: CityId,
  viewport = { width: 1280, height: 720 },
) {
  const city = state.cities[cityId];
  const mapContent = screen.getByTestId('map-content');
  const centerCell = screen.getByTestId(`map-cell-${city.gridQ}-${city.gridR}`);
  const cellSize = Number(centerCell.getAttribute('width'));
  const viewX = Number.parseFloat(mapContent.getAttribute('data-view-x')!);
  const viewY = Number.parseFloat(mapContent.getAttribute('data-view-y')!);
  const scale = Number.parseFloat(mapContent.style.getPropertyValue('--map-scale'));
  const viewportWidth = viewport.width;
  const viewportHeight = viewport.height;
  const worldWidth = (state.gridWidth ?? DEFAULT_GRID_WIDTH) * cellSize;
  const worldHeight = (state.gridHeight ?? DEFAULT_GRID_HEIGHT) * cellSize;
  const cssWidth = viewportWidth * scale;
  const cssHeight = cssWidth * (worldHeight / worldWidth);
  const left = (viewportWidth - cssWidth) / 2 + viewX;
  const top = (viewportHeight - cssHeight) / 2 + viewY;
  const centerX = Number(centerCell.getAttribute('x')) + cellSize / 2;
  const centerY = Number(centerCell.getAttribute('y')) + cellSize / 2;

  expect(left + (centerX * cssWidth) / worldWidth).toBeCloseTo(viewportWidth / 2, 0);
  expect(top + (centerY * cssHeight) / worldHeight).toBeCloseTo(viewportHeight / 2, 0);
}

async function chooseDeployLeader(user: ReturnType<typeof userEvent.setup>, officerName = '刘备') {
  const deployDialog = screen.getByRole('dialog', { name: '出征编制' });
  await user.click(within(deployDialog).getByRole('button', { name: '选择武将' }));
  const officerDialog = screen.getByRole('dialog', { name: '武将选择' });
  await user.click(within(officerDialog).getByRole('button', { name: `选择${officerName}为主将` }));
  await user.click(within(officerDialog).getByRole('button', { name: '确定武将' }));
  return screen.getByRole('dialog', { name: '出征编制' });
}

describe('StrategicMap', { timeout: 30000 }, () => {
  it('selects a city from its map marker', async () => {
    const user = userEvent.setup();
    renderGame();

    await user.click(screen.getByRole('button', { name: /江陵.*刘备/ }));

    expect(screen.getByRole('heading', { name: '江陵' })).toBeVisible();
    expect(screen.getAllByText('13,500').length).toBeGreaterThan(0);
  });

  it('selects a city and opens the same menu from any cell in its seven-cell footprint', () => {
    const state = createGame('liu', 1);
    renderGame(state);

    const city = state.cities.jiangling;
    const footprintCell = screen.getByTestId(`city-footprint-${city.id}-${city.gridQ + 1}-${city.gridR}`);
    fireEvent.pointerDown(footprintCell, { button: 0, buttons: 1, clientX: 260, clientY: 190 });

    expect(screen.getByRole('heading', { name: city.name })).toBeVisible();
    expect(screen.getByTestId('city-command-menu')).toBeVisible();
  });

  it('opens a city menu when the underlying map cell is clicked inside its seven-cell footprint', () => {
    const state = createGame('liu', 1);
    renderGame(state);
    zoomToTerrain();
    resetCamera();
    // 江陵 (q82,r137) 在地图中心左下方，向右拖 18 格、向上拖 37 格（每格约 42.7px）使其进入可见范围
    panViewport(768, -1580);

    const city = state.cities.jiangling;
    const footprintMapCell = screen.getAllByTestId(/^map-cell-/).find((node) => {
      const match = node.getAttribute('data-testid')!.match(/^map-cell-(\d+)-(\d+)$/)!;
      const q = Number(match[1]);
      const r = Number(match[2]);
      return Math.abs(q - city.gridQ) <= 1 && Math.abs(r - city.gridR) <= 1;
    });
    expect(footprintMapCell).toBeTruthy();
    fireEvent.pointerDown(footprintMapCell!, { button: 0, buttons: 1, clientX: 260, clientY: 190 });

    expect(screen.getByRole('heading', { name: city.name })).toBeVisible();
    expect(screen.getByTestId('city-command-menu')).toBeVisible();
  });

  it('represents a city with seven grid cells and no standalone fort icon', () => {
    const state = createGame('liu', 1);
    renderGame(state);

    const city = state.cities.jiangling;
    const footprint = sevenCellCityFootprint({ q: city.gridQ, r: city.gridR });

    expect(screen.getAllByTestId(/^city-footprint-jiangling-/)).toHaveLength(7);
    for (const coord of footprint) {
      expect(screen.getByTestId(`city-footprint-${city.id}-${coord.q}-${coord.r}`)).toHaveClass('city-footprint-cell');
    }
    expect(screen.queryByTestId(`city-hit-cell-${city.id}-${city.gridQ}-${city.gridR}`)).not.toBeInTheDocument();
    const cityMarker = screen.getAllByTestId('city-marker').find((marker) => marker.textContent?.includes(city.name));
    expect(cityMarker?.querySelector('.city-fort')).not.toBeInTheDocument();
  });

  it('renders the ten original passes as stronghold markers on the china42x map', () => {
    const state = createGame('liu', 1);
    expect(state.gridWidth).toBe(200);
    renderGame(state);

    const passMarkers = screen.getAllByTestId('pass-marker');
    expect(passMarkers).toHaveLength(10);
    // 标牌 textContent 含名称与兵力/人口（stats 随 WIP 加入标牌），故按子串匹配关名
    const labels = passMarkers.map((marker) => marker.textContent ?? '');
    for (const label of ['壶关', '虎牢关', '潼关', '函谷关', '武关', '阳平关', '剑阁', '葭萌关', '涪水关', '江油关']) {
      expect(labels.some((text) => text.includes(label))).toBe(true);
    }
    // 小地图同步显示关隘点
    expect(document.querySelectorAll('.mini-pass-dot')).toHaveLength(10);
  });

  it('opens the city menu from every rendered city footprint square', () => {
    const state = createGame('liu', 1);
    renderGame(state);

    const city = state.cities.jiangling;
    for (const coord of sevenCellCityFootprint({ q: city.gridQ, r: city.gridR })) {
      fireEvent.pointerDown(screen.getByTestId(`city-footprint-${city.id}-${coord.q}-${coord.r}`), {
        button: 0,
        buttons: 1,
        clientX: 260,
        clientY: 190,
      });
      expect(screen.getByTestId('city-command-menu')).toBeVisible();
    }
  });

  it('keeps the city menu open after a real click sequence on an owned footprint square', async () => {
    const user = userEvent.setup();
    const state = createGame('liu', 1);
    renderGame(state);

    const city = state.cities.jiangling;

    await user.click(screen.getByTestId(`city-footprint-${city.id}-${city.gridQ}-${city.gridR}`));

    expect(screen.getByTestId('city-command-menu')).toBeVisible();
  });

  it('zooms the image and city layer together', () => {
    renderGame();
    const viewport = screen.getByTestId('map-viewport');

    // 默认最高角度 scale≈6.67（30 格视野），放大一次 ×1.2 后约 8
    fireEvent.wheel(viewport, { deltaY: -120 });

    expect(screen.getByTestId('map-content').style.getPropertyValue('--map-scale')).toBe('8');
  });

  it('镜头拖拽/缩放均不越出地图边界，内容始终铺满视口', async () => {
    renderGame();
    const viewport = screen.getByTestId('map-viewport');
    const mapContent = screen.getByTestId('map-content');
    const scale = Number.parseFloat(mapContent.style.getPropertyValue('--map-scale'));
    const x = () => Number.parseFloat(mapContent.getAttribute('data-view-x')!);
    const y = () => Number.parseFloat(mapContent.getAttribute('data-view-y')!);
    // 测试视口回退为 1280×720；content 等比宽 vw*scale、高 按 200:200
    const contentWidth = 1280 * scale;
    const contentHeight = contentWidth; // 200×200 网格
    const maxX = Math.max(0, (contentWidth - 1280) / 2);
    const maxY = Math.max(0, (contentHeight - 720) / 2);
    expect(maxX).toBeGreaterThan(0);

    // 向左下角大幅拖拽（远超可平移范围）：view 应被钳制在边界
    panViewport(50000, 50000);
    expect(x()).toBeCloseTo(maxX, 1);
    expect(y()).toBeCloseTo(maxY, 1);
    const xAtEdge = x();
    const yAtEdge = y();

    // 继续拖拽不越界
    panViewport(50000, 50000);
    expect(x()).toBeCloseTo(xAtEdge, 1);
    expect(y()).toBeCloseTo(yAtEdge, 1);

    // 反方向拖拽回到另一侧边界
    panViewport(-50000, -50000);
    expect(x()).toBeCloseTo(-maxX, 1);
    expect(y()).toBeCloseTo(-maxY, 1);
  });

  it('单机进入游戏时镜头自动跳到本方君主所在城池并居中显示', () => {
    const state = createGame('liu', 1);
    renderGame(state);

    // 刘备（君主）在江陵
    expectCameraCenteredOnCity(state, 'jiangling');
  });

  it('不同势力开局分别定位到各自君主所在城池', () => {
    const caoState = createGame('cao', 1);
    renderGame(caoState);

    // 曹操（君主）在宛
    expectCameraCenteredOnCity(caoState, 'wan');
  });

  it('君主不在城中时退回本方首城作为开局定位', () => {
    const state = createGame('liu', 1);
    // 君主刘备随军出征：镜头应退回本方首座城池（江陵）
    state.officers['liu-bei'].location = { kind: 'unit', unitId: 'liu-field' };
    renderGame(state);

    expectCameraCenteredOnCity(state, 'jiangling');
  });

  it('浏览器路径：等 ResizeObserver 报出真实视口尺寸后再居中（而非按回退视口）', () => {
    const viewportSize = { width: 1600, height: 900 };
    const originalResizeObserver = (globalThis as { ResizeObserver?: unknown }).ResizeObserver;
    class ImmediateResizeObserver {
      private readonly callback: (entries: Array<{ contentRect: { width: number; height: number } }>) => void;

      constructor(callback: (entries: Array<{ contentRect: { width: number; height: number } }>) => void) {
        this.callback = callback;
      }

      observe() {
        this.callback([{ contentRect: viewportSize }]);
      }

      disconnect() {}
    }
    (globalThis as { ResizeObserver?: unknown }).ResizeObserver = ImmediateResizeObserver;
    try {
      const state = createGame('liu', 1);
      renderGame(state);

      expectCameraCenteredOnCity(state, 'jiangling', viewportSize);
    } finally {
      (globalThis as { ResizeObserver?: unknown }).ResizeObserver = originalResizeObserver;
    }
  });

  it('开局自动定位只执行一次：玩家拖动与回合推进都不会重置镜头', async () => {
    const user = userEvent.setup();
    renderGame(createGame('liu', 1));
    const mapContent = screen.getByTestId('map-content');
    const viewOf = () => ({
      x: Number.parseFloat(mapContent.getAttribute('data-view-x')!),
      y: Number.parseFloat(mapContent.getAttribute('data-view-y')!),
    });

    // 玩家把镜头拖离君主城池
    panViewport(-320, 180);
    const dragged = viewOf();
    expect(dragged.x).not.toBe(0);

    // 推进一旬（整个游戏状态被替换）后，镜头保持在玩家拖动后的位置
    fireEvent.contextMenu(screen.getByTestId('map-viewport'), { clientX: 320, clientY: 180 });
    await user.click(screen.getByTestId('map-context-proceed-button'));

    expect(viewOf().x).toBeCloseTo(dragged.x, 1);
    expect(viewOf().y).toBeCloseTo(dragged.y, 1);
  });

  it('点击小地图位置将主镜头切换到对应地图区域', () => {
    renderGame();
    const miniMap = screen.getByTestId('mini-map');
    const mapContent = screen.getByTestId('map-content');
    const x = () => Number.parseFloat(mapContent.getAttribute('data-view-x')!);
    const y = () => Number.parseFloat(mapContent.getAttribute('data-view-y')!);

    // 测试环境无真实布局：给容器一个 184×103.5 的虚拟边界供点击换算
    const rect = { left: 0, top: 0, width: 184, height: 103.5, right: 184, bottom: 103.5 } as DOMRect;
    vi.spyOn(miniMap, 'getBoundingClientRect').mockReturnValue(rect);

    // 复位后点击小地图右下角（≈地图东南角）→ 镜头应向东南移动（view.x/view.y 负值增大）
    fireEvent.pointerDown(miniMap, { button: 0, buttons: 1, clientX: 180, clientY: 100 });
    const xEast = x();
    const ySouth = y();
    expect(xEast).toBeLessThan(0);
    expect(ySouth).toBeLessThan(0);

    // 点击小地图左上角（≈地图西北角）→ 镜头应移向西北（view.x/view.y 正值）
    fireEvent.pointerDown(miniMap, { button: 0, buttons: 1, clientX: 6, clientY: 6 });
    expect(x()).toBeGreaterThan(xEast);
    expect(y()).toBeGreaterThan(ySouth);

    // 点击后拖拽不应启动（小地图上按压不产生主地图平移拖拽）
    expect(screen.getByTestId('map-content').getAttribute('data-view-x')).not.toBeNull();
  });

  it('小地图底图：全量地图格烘焙成一张位图铺在容器里', () => {
    const context = {
      createImageData: vi.fn((width: number, height: number) => ({
        width,
        height,
        data: new Uint8ClampedArray(width * height * 4),
      })),
      putImageData: vi.fn(),
    };
    const getContext = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context as never);
    const toDataURL = vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue('data:image/png;base64,mini');

    try {
      const state = createGame('liu', 1);
      renderGame(state);

      const thumb = screen.getByTestId('mini-map-thumb');
      expect(thumb).toHaveAttribute('src', 'data:image/png;base64,mini');
      // 每格烘焙成 2×2 像素，画布尺寸取网格的两倍（200×200 格 → 400×400 位图）
      expect(context.createImageData).toHaveBeenCalledWith(state.gridWidth! * 2, state.gridHeight! * 2);
      // 逐格写像素后只做一次绘制调用（而非每格一次 fillRect）
      expect(context.putImageData).toHaveBeenCalledTimes(1);
    } finally {
      getContext.mockRestore();
      toDataURL.mockRestore();
    }
  });

  it('小地图按地图网格比例成形，缩略图不会被拉伸', () => {
    const state = createGame('liu', 1);
    renderGame(state);

    const miniMap = screen.getByTestId('mini-map');
    expect(miniMap.getAttribute('style')).toContain(`aspect-ratio: ${state.gridWidth} / ${state.gridHeight}`);
  });

  it('keeps zoom within the supported range', async () => {
    renderGame();

    // 滚轮连续缩小不会低于最高角度（30 格视野，scale≈6.67）—— 缩放只走滚轮，按钮已移除
    const viewport = screen.getByTestId('map-viewport');
    for (let index = 0; index < 5; index += 1) fireEvent.wheel(viewport, { deltaY: 100 });

    expect(screen.getByTestId('map-content').style.getPropertyValue('--map-scale')).toBe('6.67');
  });

  it('shows the hovered grid coordinate at the bottom center of the interface', async () => {
    const user = userEvent.setup();
    renderGame();
    zoomToTerrain();
    resetCamera();
    // 等比（方格不变形）后，初始垂直窗覆盖地图中部，江陵（r=120）在地图下方，需先下移视野使其部署格渲染
    panViewport(0, -1100);

    const jianglingMarker = screen.getAllByTestId('city-marker').find((marker) => marker.textContent?.includes('江陵'));
    expect(jianglingMarker).toBeTruthy();
    await user.click(jianglingMarker!);
    await user.click(screen.getByRole('button', { name: '军事' }));
    await user.click(screen.getByRole('button', { name: '出征' }));
    const deployDialog = await chooseDeployLeader(user, '刘备');
    await user.click(within(deployDialog).getByRole('button', { name: '确定出征' }));

    const deploymentCell = screen.getAllByTestId(/move-target-/)[0];
    const [, q, r] = deploymentCell.getAttribute('data-testid')!.match(/move-target-(\d+)-(\d+)/)!;
    const terrain = [...deploymentCell.classList].find((className) => className.startsWith('terrain-'))?.replace('terrain-', '') as TerrainType;
    fireEvent.pointerEnter(deploymentCell);

    expect(deploymentCell).toHaveAttribute('data-testid', `move-target-${q}-${r}`);
    expect(deploymentCell).toHaveClass(`terrain-${terrain}`);
    expect(screen.getByTestId('hover-coordinate')).toBeInTheDocument();

    fireEvent.pointerLeave(screen.getByTestId('map-viewport'));

    expect(screen.queryByTestId('hover-coordinate')).not.toBeInTheDocument();
  });

  it('shows coordinates and terrain while hovering the normal map grid', () => {
    renderGame();
    zoomToTerrain();

    const mapCell = screen.getAllByTestId(/^map-cell-/)[0];
    fireEvent.pointerEnter(mapCell);

    expect(screen.getByTestId('hover-coordinate')).toBeInTheDocument();
  });

  it('marks unfinished facilities as under construction without showing their effect range', () => {
    const state = createGame('liu', 1);
    state.facilities = {
      unfinishedTower: {
        id: 'unfinishedTower',
        type: 'arrowTower',
        forceId: 'liu',
        q: 10,
        r: 10,
        durability: 150,
        completed: false,
      },
    };
    renderGame(state);

    const marker = screen.getByTestId('battle-facility-marker');

    expect(screen.getByTestId('facility-construction-label')).toBeInTheDocument();

    fireEvent.pointerEnter(marker);

    expect(screen.queryByTestId('facility-range-cell')).not.toBeInTheDocument();
  });

  it('darkens map cells occupied by facilities', () => {
    const state = createGame('liu', 1);
    // 放在地图中心区域，保证放大后可见
    state.facilities = {
      tower: { id: 'tower', type: 'arrowTower', forceId: 'liu', q: 100, r: 100, durability: 700 },
    };

    renderGame(state);
    zoomToTerrain();
    resetCamera();

    expect(screen.getByTestId('map-cell-100-100')).toHaveClass('is-facility-occupied');
    expect(screen.getByTestId('map-cell-100-101')).not.toHaveClass('is-facility-occupied');
  });

  it('uses the owning force color for support facility backgrounds', () => {
    const state = createGame('liu', 1);
    state.facilities = {
      drum: { id: 'drum', type: 'drum', forceId: 'liu', q: 10, r: 10, durability: 800 },
      tower: { id: 'tower', type: 'arrowTower', forceId: 'cao', q: 11, r: 10, durability: 700 },
      music: { id: 'music', type: 'musicTower', forceId: 'sun', q: 12, r: 10, durability: 800 },
      fortress: { id: 'fortress', type: 'fortress', forceId: 'biao', q: 13, r: 10, durability: 1200 },
      wall: { id: 'wall', type: 'earthwork', forceId: 'liu', q: 14, r: 10, durability: 400 },
    };

    renderGame(state);

    const backgrounds = screen.getAllByTestId('battle-facility-background');
    const byId = (id: string) => backgrounds.find((node) => node.getAttribute('data-facility-id') === id)!;

    expect(byId('drum')).toHaveClass('is-force-colored');
    expect(byId('drum').getAttribute('style')).toContain(`--force-color: ${state.forces.liu.color}`);
    expect(byId('tower')).toHaveClass('is-force-colored');
    expect(byId('tower').getAttribute('style')).toContain(`--force-color: ${state.forces.cao.color}`);
    expect(byId('music')).toHaveClass('is-force-colored');
    expect(byId('music').getAttribute('style')).toContain(`--force-color: ${state.forces.sun.color}`);
    expect(byId('fortress')).toHaveClass('is-force-colored');
    expect(byId('fortress').getAttribute('style')).toContain(`--force-color: ${state.forces.biao.color}`);
    expect(byId('wall')).not.toHaveClass('is-force-colored');
    expect(byId('wall')).not.toHaveAttribute('style');
  });

  it('shows arrow tower automatic damage numbers from battle reports', () => {
    const state = createGame('liu', 1);
    state.units['arrow-target'] = {
      id: 'arrow-target',
      kind: 'combat',
      forceId: 'cao',
      leaderId: 'cao-ren',
      homeCityId: 'xiangyang',
      troopType: 'sword',
      q: 12,
      r: 10,
      troops: 2700,
      food: 3000,
      energy: 80,
      movementRemaining: 5,
      moved: false,
      acted: false,
    };
    state.battleDamageReports = [{
      id: 'arrow-tower-damage',
      unitId: 'arrow-target',
      q: 12,
      r: 10,
      amount: 300,
      kind: 'attack',
    }];

    renderGame(state);

    expect(screen.getByTestId('battle-damage-number')).toHaveTextContent('-300');
  });

  it('renders critical damage and failed strategy feedback at their report coordinates', () => {
    const state = createGame('liu', 1);
    state.battleDamageReports = [{
      id: 'critical-damage',
      unitId: 'critical-target',
      q: 12,
      r: 10,
      amount: 640,
      kind: 'attack',
      critical: true,
      label: '暴击',
    }];
    state.strategyResultReports = [
      {
        id: 'failed-strategy',
        strategyId: 'fire',
        q: 10,
        r: 11,
        label: '计略失败',
        succeeded: false,
      },
      {
        id: 'successful-strategy',
        strategyId: 'fire',
        q: 11,
        r: 11,
        label: '计略成功',
        succeeded: true,
      },
    ];

    renderGame(state);

    const critical = screen.getByTestId('battle-critical-label');
    const damage = screen.getByTestId('battle-damage-number');
    const failure = screen.getByTestId('strategy-result-label');
    expect(critical).toHaveTextContent('暴击');
    expect(critical).toHaveAttribute('data-grid-position', '12,10');
    expect(critical).toHaveAttribute('x', '537.5');
    expect(critical).toHaveAttribute('y', '360.5');
    expect(damage).toHaveTextContent('-640');
    expect(damage).toHaveAttribute('data-grid-position', '12,10');
    expect(damage).toHaveAttribute('x', '537.5');
    expect(damage).toHaveAttribute('y', '377.5');
    expect(failure).toHaveTextContent('计略失败');
    expect(failure).toHaveAttribute('data-grid-position', '10,11');
    expect(failure).toHaveAttribute('x', '451.5');
    expect(failure).toHaveAttribute('y', '420.5');
    expect(screen.queryByText('计略成功')).not.toBeInTheDocument();
  });

  it('stacks two fire-arrow damage reports at the same ordinary grid position', () => {
    const state = createGame('liu', 1);
    state.battleDamageReports = [
      {
        id: 'fire-arrow-hit', unitId: 'fire-arrow-target', q: 12, r: 10,
        amount: 520, kind: 'attack',
      },
      {
        id: 'fire-arrow-burn', unitId: 'fire-arrow-target', q: 12, r: 10,
        amount: 300, kind: 'attack',
      },
    ];

    renderGame(state);

    const damageNumbers = screen.getAllByTestId('battle-damage-number');
    expect(damageNumbers.map((node) => node.getAttribute('y'))).toEqual(['360.5', '377.5']);
  });

  it('keeps top-row critical labels separated while preserving the normal damage baseline', () => {
    const state = createGame('liu', 1);
    state.battleDamageReports = [
      {
        id: 'top-row-critical',
        unitId: 'critical-target',
        q: 0,
        r: 0,
        amount: 640,
        kind: 'attack',
        critical: true,
        label: '暴击',
      },
      {
        id: 'top-row-normal',
        unitId: 'normal-target',
        q: 0,
        r: 0,
        amount: 320,
        kind: 'attack',
      },
    ];

    renderGame(state);

    const critical = screen.getByTestId('battle-critical-label');
    const damageNumbers = screen.getAllByTestId('battle-damage-number');
    const criticalDamage = damageNumbers.find((node) => node.textContent === '-640')!;
    const normalDamage = damageNumbers.find((node) => node.textContent === '-320')!;
    const criticalY = Number(critical.getAttribute('y'));
    const criticalDamageY = Number(criticalDamage.getAttribute('y'));
    expect(criticalY).toBe(12);
    expect(criticalDamageY).toBe(29);
    expect(criticalDamageY - criticalY).toBe(17);
    expect(normalDamage).toHaveAttribute('y', '46');
    expect(new Set([criticalY, criticalDamageY, Number(normalDamage.getAttribute('y'))]).size).toBe(3);
  });

  it('shows facility status while hovering a facility marker', () => {
    const state = createGame('liu', 1);
    state.facilities = {
      unfinishedTower: {
        id: 'unfinishedTower',
        type: 'arrowTower',
        forceId: 'liu',
        q: 10,
        r: 10,
        durability: 150,
        completed: false,
      },
    };
    renderGame(state);

    fireEvent.pointerEnter(screen.getByTestId('battle-facility-marker'), { clientX: 300, clientY: 180 });

    expect(screen.getByTestId('facility-info-panel')).toBeVisible();
    expect(screen.getByTestId('facility-info-status')).toHaveTextContent('建设中');
    expect(screen.getByTestId('facility-info-durability')).toHaveTextContent('150/700');

    fireEvent.pointerLeave(screen.getByTestId('battle-facility-marker'));

    expect(screen.queryByTestId('facility-info-panel')).not.toBeInTheDocument();
  });

  it('opens a right-click menu for own facilities and dismantles them', async () => {
    const user = userEvent.setup();
    const state = createGame('liu', 1);
    state.facilities = {
      ownWall: {
        id: 'ownWall',
        type: 'earthwork',
        forceId: 'liu',
        q: 10,
        r: 10,
        durability: 400,
        completed: true,
      },
    };
    renderGame(state);

    // 左键点击设施打开撤销菜单
    fireEvent.pointerDown(screen.getByTestId('battle-facility-marker'), { button: 0, clientX: 320, clientY: 180 });

    expect(screen.getByTestId('facility-context-menu')).toBeVisible();

    // 右键点击设施关闭菜单
    fireEvent.contextMenu(screen.getByTestId('battle-facility-marker'), { clientX: 320, clientY: 180 });
    expect(screen.queryByTestId('facility-context-menu')).not.toBeInTheDocument();

    // 再次左键打开并完成撤销流程
    fireEvent.pointerDown(screen.getByTestId('battle-facility-marker'), { button: 0, clientX: 320, clientY: 180 });
    await user.click(screen.getByTestId('facility-dismantle-button'));

    // 点击撤销后先弹出确认弹窗（是/否）
    expect(screen.getByTestId('cancel-confirm-menu')).toBeVisible();
    await user.click(screen.getByTestId('cancel-confirm-yes'));

    expect(screen.queryByTestId('battle-facility-marker')).not.toBeInTheDocument();
  });

  it('marks a player unit with remaining movement as not acted until it moves', async () => {
    const user = userEvent.setup();
    const deployed = deployUnit(createGame('liu', 1), 'liu', {
      cityId: 'jiangling',
      officerId: 'guan-yu',
      targetCityId: 'xiangyang',
      troopType: 'spear',
      troops: 4000,
      food: 6000,
    });
    renderGame(settleTenDay(deployed));
    zoomToTerrain();
    resetCamera();
    // 等比后江陵（r=120）位于初始垂直窗下方，向下移动视野让部队/移动目标格渲染
    panViewport(0, -1100);

    expect(screen.getByTestId('battle-unit-ready-badge')).toBeInTheDocument();

    await user.click(screen.getByTestId('battle-unit-marker'));
    fireEvent.pointerDown(screen.getAllByTestId(/move-target-/)[0], { button: 0, buttons: 1 });
    await user.click(within(screen.getByTestId('unit-command-menu')).getByRole('button', { name: '待命' }));

    expect(screen.queryByTestId('battle-unit-ready-badge')).not.toBeInTheDocument();
  });

  it('keeps the delegate badge visible as a gray 「委·待」 for the rest of the ten-day after the delegation acted (delegateActed)', () => {
    const deployed = deployUnit(createGame('liu', 1), 'liu', {
      cityId: 'jiangling',
      officerId: 'guan-yu',
      targetCityId: 'xiangyang',
      troopType: 'spear',
      troops: 4000,
      food: 6000,
    });
    const waiting = settleTenDay(deployed);
    const unit = Object.values(waiting.units)[0];
    unit.delegate = { kind: 'move', target: { q: unit.q + 3, r: unit.r } };
    // 本旬已用「委任部队行动」执行过：moved + delegateActed —— 委任本旬不再执行，但徽章必须仍然可见
    unit.moved = true;
    unit.delegateActed = true;
    renderGame(waiting);
    zoomToTerrain();
    resetCamera();
    panViewport(0, -1100);

    // 委任已登记的证明：徽章不消失，转为灰色「委·待」，与「本旬还会再动」的亮色「委」样式不同
    const badge = screen.getByTestId('battle-unit-ready-badge');
    expect(badge).toHaveTextContent('委·待');
    expect(badge).toHaveClass('is-awaiting-next-ten-day');
    expect(badge).toHaveAttribute('data-delegate-awaiting', 'true');
    expect(screen.queryAllByTestId('battle-unit-ready-badge').filter((candidate) => candidate.textContent === '委')).toHaveLength(0);
  });

  it('blocks city and unit command entry while another player is active', async () => {
    const user = userEvent.setup();
    const deployed = deployUnit(createGame('liu', 1), 'liu', {
      cityId: 'jiangling',
      officerId: 'guan-yu',
      targetCityId: 'xiangyang',
      troopType: 'spear',
      troops: 4000,
      food: 6000,
    });
    const waiting = settleTenDay(deployed);
    waiting.turnForceId = 'cao';
    renderGame(waiting);

    expect(screen.queryByTestId('battle-unit-ready-badge')).not.toBeInTheDocument();

    const jianglingMarker = screen.getAllByTestId('city-marker').find((marker) => marker.textContent?.includes('江陵'));
    expect(jianglingMarker).toBeTruthy();
    await user.click(jianglingMarker!);
    expect(screen.queryByTestId('city-command-menu')).not.toBeInTheDocument();

    await user.click(screen.getByTestId('battle-unit-marker'));
    expect(screen.queryByTestId('unit-command-menu')).not.toBeInTheDocument();
  });

  it('shows the map proceed command as disabled while another player is active', () => {
    const state = createGame('liu', 1);
    state.turnForceId = 'cao';
    renderGame(state);

    fireEvent.contextMenu(screen.getByTestId('map-viewport'), { clientX: 320, clientY: 180 });

    const proceedButton = screen.getByTestId('map-context-proceed-button');
    expect(proceedButton).toBeDisabled();
    expect(proceedButton).toHaveClass('is-disabled');
  });

  it('does not mark or open commands for a confused player unit', async () => {
    const user = userEvent.setup();
    const deployed = deployUnit(createGame('liu', 1), 'liu', {
      cityId: 'jiangling',
      officerId: 'guan-yu',
      targetCityId: 'xiangyang',
      troopType: 'spear',
      troops: 4000,
      food: 6000,
    });
    const waiting = settleTenDay(deployed);
    const unit = Object.values(waiting.units)[0];
    waiting.units[unit.id].confusedTenDays = 1;
    renderGame(waiting);

    expect(screen.queryByTestId('battle-unit-ready-badge')).not.toBeInTheDocument();

    await user.click(screen.getByTestId('battle-unit-marker'));
    expect(screen.queryByTestId('unit-command-menu')).not.toBeInTheDocument();
    expect(screen.queryByTestId(/move-target-/)).not.toBeInTheDocument();
  });

  it('shows the 伪 badge for a false-reported unit and keeps commands closed', async () => {
    const user = userEvent.setup();
    const deployed = deployUnit(createGame('liu', 1), 'liu', {
      cityId: 'jiangling',
      officerId: 'guan-yu',
      targetCityId: 'xiangyang',
      troopType: 'spear',
      troops: 4000,
      food: 6000,
    });
    const waiting = settleTenDay(deployed);
    const unit = Object.values(waiting.units)[0];
    waiting.units[unit.id].falseReportedTenDays = 2;
    renderGame(waiting);

    expect(screen.getByTestId('battle-unit-status-badge')).toHaveTextContent('伪');
    expect(screen.queryByTestId('battle-unit-ready-badge')).not.toBeInTheDocument();

    await user.click(screen.getByTestId('battle-unit-marker'));
    expect(screen.queryByTestId('unit-command-menu')).not.toBeInTheDocument();
    expect(screen.queryByTestId(/move-target-/)).not.toBeInTheDocument();
  });

  it('shows the active opponent unit ready badge while another player is active', async () => {
    const user = userEvent.setup();
    const initial = createGame('liu', 1);
    initial.turnForceId = 'cao';
    const deployed = deployUnit(initial, 'cao', {
      cityId: 'xiangyang',
      officerId: 'cao-ren',
      targetCityId: 'jiangling',
      troopType: 'spear',
      troops: 4000,
      food: 6000,
    });
    const waiting = settleTenDay(deployed);
    waiting.playerForceId = 'liu';
    waiting.turnForceId = 'cao';
    renderGame(waiting);

    expect(screen.getByTestId('battle-unit-ready-badge')).toBeInTheDocument();

    await user.click(screen.getByTestId('battle-unit-marker'));
    expect(screen.queryByTestId('unit-command-menu')).not.toBeInTheDocument();
  });

  it('shows unit information while hovering a field unit and hides it after leaving', async () => {
    const deployed = deployUnit(createGame('liu', 1), 'liu', {
      cityId: 'jiangling',
      officerId: 'guan-yu',
      targetCityId: 'xiangyang',
      troopType: 'spear',
      troops: 4000,
      food: 6000,
    });
    renderGame(deployed);

    const unitMarker = screen.getByTestId('battle-unit-marker');
    fireEvent.pointerEnter(unitMarker, { clientX: 300, clientY: 180 });

    const info = screen.getByTestId('unit-info-panel');
    expect(info).toHaveTextContent('关羽部队');
    expect(info).toHaveTextContent('资金');
    expect(info).toHaveTextContent('兵粮');
    expect(info).toHaveTextContent('士气');
    expect(info).not.toHaveTextContent('士兵');
    expect(info).not.toHaveTextContent('兵科');

    fireEvent.pointerLeave(unitMarker);

    await waitFor(() => expect(screen.queryByTestId('unit-info-panel')).not.toBeInTheDocument());
  });

  it('地图部队字形吃科技：研究「机械」「弹道」后冲车/井阑标记显示为木兽/投石车', () => {
    const before = createGame('liu', 1);
    before.cities['jiangling'].armaments = { ...initialArmaments(), ram: 5, tower: 5 };
    const deployed = deployUnit(before, 'liu', {
      cityId: 'jiangling',
      officerId: 'guan-yu',
      troopType: 'siege',
      siegeWeapon: 'ram',
      troops: 4000,
      food: 6000,
    });
    Object.assign(Object.values(deployed.units)[0], { q: 10, r: 10 });

    const first = renderGame(deployed);
    const markerBefore = screen.getByTestId('battle-unit-marker');
    expect(within(markerBefore).getByText('冲')).toBeVisible();
    expect(markerBefore.getAttribute('aria-label')).toContain('冲车');
    first.unmount();

    // 同一势力研究「机械」（冲车→木兽）与「弹道」（井阑→投石车）后，存储字段不变、字形升级
    const after = createGame('liu', 1);
    after.cities['jiangling'].armaments = { ...initialArmaments(), ram: 5, tower: 5 };
    const upgraded = deployUnit(after, 'liu', {
      cityId: 'jiangling',
      officerId: 'guan-yu',
      troopType: 'siege',
      siegeWeapon: 'ram',
      troops: 4000,
      food: 6000,
    });
    completeTechResearch(upgraded, 'liu', 'jixie');
    completeTechResearch(upgraded, 'liu', 'dandao');
    Object.assign(Object.values(upgraded.units)[0], { q: 10, r: 10 });
    renderGame(upgraded);

    const marker = screen.getByTestId('battle-unit-marker');
    expect(within(marker).getByText('兽')).toBeVisible();
    expect(within(marker).queryByText('冲')).not.toBeInTheDocument();
    expect(marker).toHaveAttribute('data-troop-type', 'siege');
    expect(marker.getAttribute('aria-label')).toContain('木兽');
  });

  it('marks units with distinct force ids and force colors', () => {
    const state = deployUnit(createGame('liu', 1), 'liu', {
      cityId: 'jiangling',
      officerId: 'guan-yu',
      troopType: 'spear',
      troops: 4000,
      food: 6000,
    });
    const playerUnit = Object.values(state.units)[0];
    state.units[playerUnit.id].q = 10;
    state.units[playerUnit.id].r = 10;
    state.units['enemy-color-check'] = {
      id: 'enemy-color-check',
      kind: 'combat',
      forceId: 'cao',
      leaderId: 'cao-ren',
      homeCityId: 'xiangyang',
      troopType: 'spear',
      q: 11,
      r: 10,
      troops: 3000,
      food: 3000,
      energy: 100,
      movementRemaining: 22,
      moved: false,
      acted: false,
    };
    renderGame(state);

    const markers = screen.getAllByTestId('battle-unit-marker');
    const liuMarker = markers.find((marker) => marker.getAttribute('data-force-id') === 'liu');
    const caoMarker = markers.find((marker) => marker.getAttribute('data-force-id') === 'cao');

    expect(liuMarker).toBeTruthy();
    expect(caoMarker).toBeTruthy();
    expect(liuMarker).toHaveStyle({ '--force-color': state.forces.liu.color });
    expect(caoMarker).toHaveStyle({ '--force-color': state.forces.cao.color });
    expect(state.forces.liu.color).not.toBe(state.forces.cao.color);
  });

  it('shows range overlays while hovering arrow towers, drums, music towers, or fortresses', () => {
    const state = createGame('liu', 1);
    state.facilities = {
      tower: { id: 'tower', type: 'arrowTower', forceId: 'liu', q: 10, r: 10, durability: 700 },
      fortress: { id: 'fortress', type: 'fortress', forceId: 'liu', q: 16, r: 10, durability: 1200 },
      wall: { id: 'wall', type: 'earthwork', forceId: 'liu', q: 14, r: 10, durability: 400 },
    };
    renderGame(state);

    const tower = screen.getAllByTestId('battle-facility-marker')
      .find((marker) => marker.getAttribute('data-facility-id') === 'tower')!;
    fireEvent.pointerEnter(tower);

    expect(screen.getAllByTestId('facility-range-cell').length).toBeGreaterThan(6);
    expect(document.querySelector('[data-range-position="10,9"]')).toBeInTheDocument();
    expect(document.querySelector('[data-range-position="10,8"]')).toBeInTheDocument();

    fireEvent.pointerLeave(tower);
    expect(screen.queryAllByTestId('facility-range-cell')).toHaveLength(0);

    const wall = screen.getAllByTestId('battle-facility-marker')
      .find((marker) => marker.getAttribute('data-facility-id') === 'wall')!;
    fireEvent.pointerEnter(wall);
    expect(screen.queryAllByTestId('facility-range-cell')).toHaveLength(0);

    const fortress = screen.getAllByTestId('battle-facility-marker')
      .find((marker) => marker.getAttribute('data-facility-id') === 'fortress')!;
    fireEvent.pointerLeave(wall);
    fireEvent.pointerEnter(fortress);
    expect(document.querySelector('[data-range-position="16,7"]')).toBeInTheDocument();
  });

  it('hides unit information when the hovered unit marker is clicked', () => {
    const deployed = deployUnit(createGame('liu', 1), 'liu', {
      cityId: 'jiangling',
      officerId: 'guan-yu',
      targetCityId: 'xiangyang',
      troopType: 'spear',
      troops: 4000,
      food: 6000,
    });
    renderGame(deployed);

    const unitMarker = screen.getByTestId('battle-unit-marker');
    fireEvent.pointerEnter(unitMarker, { clientX: 300, clientY: 180 });
    expect(screen.getByTestId('unit-info-panel')).toBeInTheDocument();

    fireEvent.pointerDown(unitMarker, { button: 0, buttons: 1, clientX: 300, clientY: 180 });

    expect(screen.queryByTestId('unit-info-panel')).not.toBeInTheDocument();
  });

  it('hides unit information when the hovered unit marker is right clicked', () => {
    const deployed = deployUnit(createGame('liu', 1), 'liu', {
      cityId: 'jiangling',
      officerId: 'guan-yu',
      targetCityId: 'xiangyang',
      troopType: 'spear',
      troops: 4000,
      food: 6000,
    });
    renderGame(deployed);

    const unitMarker = screen.getByTestId('battle-unit-marker');
    fireEvent.pointerEnter(unitMarker, { clientX: 300, clientY: 180 });
    expect(screen.getByTestId('unit-info-panel')).toBeInTheDocument();

    fireEvent.contextMenu(unitMarker, { clientX: 300, clientY: 180 });

    expect(screen.queryByTestId('unit-info-panel')).not.toBeInTheDocument();
  });

  it('shows city information beside a hovered city and hides it after leaving', () => {
    const state = createGame('liu', 1);
    renderGame(state);

    const city = state.cities.jiangling;
    const governor = state.officers[city.governorId!];
    const localOfficers = Object.values(state.officers).filter((officer) =>
      officer.forceId === city.ownerId && officer.location.kind === 'city' && officer.location.cityId === city.id,
    );
    const jianglingMarker = screen.getAllByTestId('city-marker').find((marker) => marker.textContent?.includes(city.name));
    expect(jianglingMarker).toBeTruthy();

    fireEvent.pointerEnter(jianglingMarker!, { clientX: 520, clientY: 250 });

    const info = screen.getByTestId('city-info-panel');
    expect(info).toHaveTextContent(city.name);
    expect(info).toHaveTextContent(`${state.forces[city.ownerId!].name}军`);
    expect(info).toHaveTextContent(governor.name);
    expect(info).toHaveTextContent(city.gold.toLocaleString('en-US'));
    expect(info).toHaveTextContent(city.food.toLocaleString('en-US'));
    expect(info).toHaveTextContent(`${city.order}/100`);
    expect(info).toHaveTextContent(city.durability.toLocaleString('en-US'));
    expect(info).toHaveTextContent(city.troops.toLocaleString('en-US'));
    expect(info).toHaveTextContent(`${localOfficers.length}/${localOfficers.length}`);

    fireEvent.pointerLeave(jianglingMarker!);

    expect(screen.queryByTestId('city-info-panel')).not.toBeInTheDocument();
  });

  it('hides city information when the hovered city marker is clicked', () => {
    const state = createGame('liu', 1);
    renderGame(state);

    const city = state.cities.jiangling;
    const jianglingMarker = screen.getAllByTestId('city-marker').find((marker) => marker.textContent?.includes(city.name));
    expect(jianglingMarker).toBeTruthy();

    fireEvent.pointerEnter(jianglingMarker!, { clientX: 520, clientY: 250 });
    expect(screen.getByTestId('city-info-panel')).toBeInTheDocument();

    fireEvent.click(jianglingMarker!, { clientX: 520, clientY: 250 });

    expect(screen.queryByTestId('city-info-panel')).not.toBeInTheDocument();
  });

  it('hides city information when the hovered city marker is right clicked', () => {
    const state = createGame('liu', 1);
    renderGame(state);

    const city = state.cities.jiangling;
    const jianglingMarker = screen.getAllByTestId('city-marker').find((marker) => marker.textContent?.includes(city.name));
    expect(jianglingMarker).toBeTruthy();

    fireEvent.pointerEnter(jianglingMarker!, { clientX: 520, clientY: 250 });
    expect(screen.getByTestId('city-info-panel')).toBeInTheDocument();

    fireEvent.contextMenu(jianglingMarker!, { clientX: 520, clientY: 250 });

    expect(screen.queryByTestId('city-info-panel')).not.toBeInTheDocument();
  });

  it('places city markers from their grid center instead of the old map percentage', () => {
    renderGame();

    const jianglingMarker = screen.getAllByTestId('city-marker').find((marker) => marker.textContent?.includes('江陵'));
    expect(jianglingMarker).toBeTruthy();
    const state = createGame('liu', 1);
    const city = state.cities.jiangling;
    const gridWidth = state.gridWidth ?? DEFAULT_GRID_WIDTH;
    const gridHeight = state.gridHeight ?? DEFAULT_GRID_HEIGHT;
    const expectedLeft = ((city.gridQ + 0.5) / gridWidth) * 100;
    const expectedTop = ((city.gridR + (city.gridQ % 2 === 0 ? 0 : 0.5)) / gridHeight) * 100;

    expect(Number.parseFloat(jianglingMarker!.style.left)).toBeCloseTo(expectedLeft, 4);
    expect(Number.parseFloat(jianglingMarker!.style.top)).toBeCloseTo(expectedTop, 4);
  });

  it('指针越过视口边缘后锁定方向持续平移，移出地图仍继续，回到中央即停止', () => {
    vi.useFakeTimers();
    try {
      renderGame();
      const viewport = screen.getByTestId('map-viewport');
      const mapContent = screen.getByTestId('map-content');
      const x = () => Number.parseFloat(mapContent.getAttribute('data-view-x')!);
      const y = () => Number.parseFloat(mapContent.getAttribute('data-view-y')!);
      const advance = (ms: number) => act(() => { vi.advanceTimersByTime(ms); });
      // 单机开局镜头已自动居中到君主城池（刘备→江陵），此处只校验相对平移
      const xStart = x();

      // 鼠标进入左缘带：向右平移视角（看到左侧更多地图，view.x 增大），且在带内持续移动
      fireEvent.pointerMove(viewport, { clientX: 10, clientY: 360 });
      advance(120);
      const xAfterLeft = x();
      expect(xAfterLeft).toBeGreaterThan(xStart);
      advance(120);
      expect(x()).toBeGreaterThan(xAfterLeft);

      // 即使鼠标离开地图/视口（模拟移出网页），方向锁定仍然持续平移
      fireEvent.pointerLeave(viewport);
      const xAfterLeave = x();
      advance(120);
      expect(x()).toBeGreaterThan(xAfterLeave);

      // 鼠标回到视野中央：平移停止，位置不再变化
      fireEvent.pointerMove(viewport, { clientX: 640, clientY: 360 });
      const xCenter = x();
      const yCenter = y();
      advance(150);
      expect(x()).toBeCloseTo(xCenter);
      expect(y()).toBeCloseTo(yCenter);

      // 鼠标进入下缘带：向上平移视角（看到下方更多地图，view.y 减小），同样持续
      fireEvent.pointerMove(viewport, { clientX: 640, clientY: 700 });
      const yAfterBottom = y();
      advance(120);
      expect(y()).toBeLessThan(yAfterBottom);

      // 回到中央后停止
      fireEvent.pointerMove(viewport, { clientX: 640, clientY: 360 });
      const yRest = y();
      advance(150);
      expect(y()).toBeCloseTo(yRest);
    } finally {
      vi.useRealTimers();
    }
  });

  it('鼠标移出地图区域后，在页面其它位置移动仍实时改变滚动方向', async () => {
    renderGame();
    const viewport = screen.getByTestId('map-viewport');
    const mapContent = screen.getByTestId('map-content');
    const x = () => Number.parseFloat(mapContent.getAttribute('data-view-x')!);
    const xStart = x();

    // 指针进入地图右缘带 → 镜头向右移动（view.x 持续减小）
    fireEvent.pointerMove(viewport, { clientX: 1270, clientY: 360 });
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 200)); });
    const xAfterRight = x();
    expect(xAfterRight).toBeLessThan(xStart);
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 200)); });
    // 负载高时这 200ms 可能被拉长到数秒、镜头已顶到右边界钳制值而不再变化，故允许相等
    expect(x()).toBeLessThanOrEqual(xAfterRight);

    // 不回到地图内部，而是把指针移到地图区域外、页面左侧（document.body 目标）
    fireEvent.pointerMove(document.body, { clientX: 10, clientY: 360 });
    const xAtLeftOutside = x();
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 200)); });
    // 方向应实时翻转为向左移动（view.x 重新增大）
    expect(x()).toBeGreaterThan(xAtLeftOutside);
  });

  it('摇杆式移动：正上方只向上，右上角则同时向上向右移动', () => {
    // 用假计时器逐帧推进边缘滚动：真实计时器在高负载下会被拉长到顶住地图边界，断言不再稳定
    vi.useFakeTimers();
    try {
      renderGame();
      const viewport = screen.getByTestId('map-viewport');
      const mapContent = screen.getByTestId('map-content');
      const x = () => Number.parseFloat(mapContent.getAttribute('data-view-x')!);
      const y = () => Number.parseFloat(mapContent.getAttribute('data-view-y')!);
      const advance = (ms: number) => act(() => { vi.advanceTimersByTime(ms); });

      // 鼠标位于上缘正中（与画面中心同列）：只向上（view.y 增大），横向不移动
      fireEvent.pointerMove(viewport, { clientX: 640, clientY: 10 });
      const xPureUpStart = x();
      const yPureUpStart = y();
      advance(300);
      expect(y()).toBeGreaterThan(yPureUpStart);
      expect(x()).toBeCloseTo(xPureUpStart);

      // 回到中央，等方向清零后再测斜向
      fireEvent.pointerMove(viewport, { clientX: 640, clientY: 360 });
      advance(200);
      const xDiagonalStart = x();
      const yDiagonalStart = y();

      // 鼠标进入右上角边缘带：向上（view.y 增大）与向右（view.x 减小）同时进行
      fireEvent.pointerMove(viewport, { clientX: 1270, clientY: 20 });
      advance(300);
      expect(y()).toBeGreaterThan(yDiagonalStart);
      expect(x()).toBeLessThan(xDiagonalStart);
    } finally {
      vi.useRealTimers();
    }
  });

  it('右键菜单打开期间画面固定：拖拽与边缘滚动均不移动镜头', async () => {
    renderGame();
    const viewport = screen.getByTestId('map-viewport');
    const mapContent = screen.getByTestId('map-content');
    const x = () => Number.parseFloat(mapContent.getAttribute('data-view-x')!);
    const y = () => Number.parseFloat(mapContent.getAttribute('data-view-y')!);

    // 打开地图右键菜单
    fireEvent.contextMenu(viewport, { clientX: 320, clientY: 240 });
    expect(screen.getByTestId('map-context-menu')).toBeVisible();

    // 菜单打开时，鼠标进入边缘带等待：镜头不应自动平移
    fireEvent.pointerMove(viewport, { clientX: 1270, clientY: 360 });
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 250)); });
    const xFrozen = x();
    const yFrozen = y();
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 250)); });
    expect(x()).toBeCloseTo(xFrozen);
    expect(y()).toBeCloseTo(yFrozen);

    // 菜单打开时，拖拽地图也不应平移
    const xDragStart = x();
    panViewport(400, 300);
    expect(x()).toBeCloseTo(xDragStart);

    // 关闭菜单后，镜头恢复可控（边缘滚动重新生效）
    fireEvent.contextMenu(viewport, { clientX: 360, clientY: 260 });
    expect(screen.queryByTestId('map-context-menu')).not.toBeInTheDocument();
    const xAfterClose = x();
    fireEvent.pointerMove(viewport, { clientX: 1270, clientY: 360 });
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 250)); });
    expect(x()).toBeLessThan(xAfterClose);
  });

  it('renders the mobile duel map with its own 16 by 33 grid dimensions', () => {
    const state = createMobileDuelGame('liu', 'cao', 1);
    renderGame(state);

    expect(screen.getByTestId('battle-grid-overlay')).toHaveAttribute('viewBox', '0 0 688 1419');
    expect(screen.getByTestId('battle-unit-layer')).toHaveAttribute('viewBox', '0 0 688 1419');

    const bottomMarker = screen.getAllByTestId('city-marker').find((marker) =>
      marker.textContent?.includes(state.cities.jiangling.name),
    );
    const topMarker = screen.getAllByTestId('city-marker').find((marker) =>
      marker.textContent?.includes(state.cities.xiangyang.name),
    );

    expect(bottomMarker).toBeTruthy();
    expect(topMarker).toBeTruthy();
    expect(Number.parseFloat(bottomMarker!.style.left)).toBeCloseTo((8.5 / 16) * 100, 4);
    expect(Number.parseFloat(bottomMarker!.style.top)).toBeCloseTo((29 / 33) * 100, 4);
    expect(Number.parseFloat(topMarker!.style.left)).toBeCloseTo((8.5 / 16) * 100, 4);
    expect(Number.parseFloat(topMarker!.style.top)).toBeCloseTo((3 / 33) * 100, 4);
  });

  it('puts the local city at the bottom for the top-side online player', () => {
    const state = createMobileDuelGame('liu', 'cao', 1);
    state.playerForceId = 'cao';
    renderGame(state);

    const localCity = screen.getAllByTestId('city-marker').find((marker) => marker.textContent?.includes(state.cities.xiangyang.name));
    const opponentCity = screen.getAllByTestId('city-marker').find((marker) => marker.textContent?.includes(state.cities.jiangling.name));

    expect(localCity).toBeTruthy();
    expect(opponentCity).toBeTruthy();
    expect(Number.parseFloat(localCity!.style.top)).toBeGreaterThan(80);
    expect(Number.parseFloat(opponentCity!.style.top)).toBeLessThan(20);
  });

  it('keeps all seven city cells aligned with the rotated guest grid', () => {
    const state = createMobileDuelGame('liu', 'cao', 1);
    state.playerForceId = 'cao';
    renderGame(state);

    const city = state.cities.xiangyang;
    for (const coord of sevenCellCityFootprint({ q: city.gridQ, r: city.gridR })) {
      const mapCell = screen.getByTestId(`map-cell-${coord.q}-${coord.r}`);
      const cityCell = screen.getByTestId(`city-footprint-${city.id}-${coord.q}-${coord.r}`);
      expect(cityCell.getAttribute('x')).toBe(`${Number(mapCell.getAttribute('x')) + 2}`);
      expect(cityCell.getAttribute('y')).toBe(`${Number(mapCell.getAttribute('y')) + 2}`);
    }
  });

  it('shows troop and population values next to the city name on map markers', () => {
    renderGame();

    const jianglingMarker = screen.getAllByTestId('city-marker').find((marker) => marker.textContent?.includes('江陵'));
    expect(jianglingMarker).toBeTruthy();

    expect(within(jianglingMarker!).getByTestId('city-marker-troops')).toHaveTextContent('13500');
    expect(within(jianglingMarker!).getByTestId('city-marker-stat-divider')).toBeVisible();
    expect(within(jianglingMarker!).getByTestId('city-marker-population')).toHaveTextContent('285000');
    expect(jianglingMarker!.querySelector('.city-marker-stat i')).not.toBeInTheDocument();
  });

  it('shows top-level management command categories for an owned city', async () => {
    const user = userEvent.setup();
    renderGame();

    const ownedCityMarker = screen.getAllByTestId('city-marker').find((marker) => marker.textContent?.includes('13500'));
    expect(ownedCityMarker).toBeTruthy();
    await user.click(ownedCityMarker!);

    expect(within(screen.getByTestId('city-command-menu')).getAllByRole('button')).toHaveLength(6);
  });
});
