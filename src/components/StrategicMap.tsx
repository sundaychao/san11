import { Maximize2, ZoomIn, ZoomOut } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type CSSProperties, type MouseEvent, type PointerEvent, type WheelEvent } from 'react';
import { unitIsIncapacitated } from '../game/battle/actions';
import { unitAuraRange } from '../game/battle/aura';
import { isWaterTerrain } from '../game/battle/catalog';
import { coordsWithinRange, gridKey, sevenCellCityFootprint, type GridCoord } from '../game/battle/grid';
import { GRID_HEIGHT as DEFAULT_GRID_HEIGHT, GRID_WIDTH as DEFAULT_GRID_WIDTH } from '../game/battle/scenario';
import { china42Passes } from '../game/scenario/jingxiang208';
import { passAt, passAttackRangeCoords, passBlockedKeys } from '../game/passes';
import { PLOT_LABELS, CITY_ATTACK_RANGE, CITY_ATTACK_MIN } from '../game/innerAffairs';
import { rulerCityOf } from '../game/territory';
import type { EditableCityMarker, EditorCityPlot } from '../game/map-editor/editor';
import type { MapCamera } from '../game/saveSlots';
import { useGame } from '../game/store/GameProvider';
import type { ArmyUnit, BattleDamageReport, CityEffectReport, CityId, FacilityRepairReport, FacilityType, FirePlot, GridCell, PassId, StrategyResultReport, TerrainType, TroopType } from '../game/types';

interface MapView {
  x: number;
  y: number;
  scale: number;
}

// 缩放范围按横向可见格数定义：最高角度视野约 30 格，最低角度约 11 格
const FARTHEST_VISIBLE_CELLS = 30;
const NEAREST_VISIBLE_CELLS = 11;
/** 编辑器模式下允许的最远视野列数：放宽可见范围以呈现一大片地形网格，同时避免全量 200×200 渲染卡顿 */
const EDITOR_FARTHEST_CELLS = 64;
// 每次缩放的倍率（视野格数按此比例增减）
const ZOOM_FACTOR = 1.2;
const CELL_SIZE = 43;
// 实心地形（自带深色边界、以色块+描边表现）：不叠八角浅白方格线，保留自身描边
const SOLID_TERRAIN = new Set(['mountain', 'shore', 'stream', 'river']);
// 地形格四角斜切量（微切）：正方形四角各切掉一个小直角，轮廓变八边形
const CELL_CORNER_CUT = 3;
// 八角描边点：四角各内缩 CELL_CORNER_CUT，形成连续可见的八角线
const octagonPoints = (x: number, y: number, size: number, cut: number): string =>
  `${x + cut},${y} ${x + size - cut},${y} ${x + size},${y + cut} ${x + size},${y + size - cut} ${x + size - cut},${y + size} ${x + cut},${y + size} ${x},${y + size - cut} ${x},${y + cut}`;
// 垂直（行）方向裁剪保留的行缓冲：水平方向按用户诉求精确到 30 格，纵向仅保留少量余量，防止边缘取整缺格
const ROW_CULL_BUFFER = 3;
// 边缘自动滚动：鼠标越过视口边缘该像素带后锁定滚动方向并持续平移
const EDGE_PAN_ZONE_PX = 56;
// 以接近 60fps 的小步长连续移动（而非低频大步长跳变），避免画面抖动/模糊；
// 每帧 60px ≈ 3750px/s
const EDGE_PAN_INTERVAL_MS = 16;
const EDGE_PAN_MAX_STEP_PX = 60;
const TROOP_TEXTURES: Record<TroopType, { glyph: string; label: string }> = {
  sword: { glyph: '剑', label: '剑兵' },
  spear: { glyph: '枪', label: '枪兵' },
  halberd: { glyph: '戟', label: '戟兵' },
  crossbow: { glyph: '弩', label: '弩兵' },
  cavalry: { glyph: '骑', label: '骑兵' },
  siege: { glyph: '械', label: '兵器' },
};

const VEHICLE_TEXTURES: Record<'boat' | 'ship', { glyph: string; label: string }> = {
  boat: { glyph: '舟', label: '小舟' },
  ship: { glyph: '船', label: '楼船' },
};

const SIEGE_TEXTURES: Record<'ram' | 'tower', { glyph: string; label: string }> = {
  ram: { glyph: '冲', label: '冲车' },
  tower: { glyph: '井', label: '井阑' },
};

const FACILITY_GLYPHS: Partial<Record<FacilityType, string>> = {
  drum: '鼓',
  arrowTower: '箭',
  musicTower: '乐',
  earthwork: '垒',
  fireSeed: '火',
  fireBall: '球',
};
FACILITY_GLYPHS.fortress = '塞';

const FACILITY_RANGE: Partial<Record<FacilityType, number>> = {
  arrowTower: 2,
  drum: 2,
  musicTower: 2,
  fortress: 3,
};
const FORCE_COLORED_FACILITIES = new Set<FacilityType>(['drum', 'arrowTower', 'musicTower', 'fortress']);

/** 无主城市的中性色（城牌/小地图圆点） */
const NEUTRAL_CITY_COLOR = '#ffffff';

/** 小地图缩略图：每个地图格烘焙成 N×N 像素（取 2 避免高 DPI 屏放大发糊） */
const MINIMAP_PIXELS_PER_CELL = 2;
/** 小地图合成底色：与 .map-region 背景一致，半透明地形色叠加在它上面 */
const MINIMAP_BASE_RGB = [0x5f, 0x6d, 0x5f] as const;
/** 地形填充色（RGB + alpha），数值与 global.css 的 .terrain-* 规则保持同源 */
const MINIMAP_TERRAIN_FILL: Record<TerrainType, readonly [number, number, number, number]> = {
  road: [222, 222, 222, 0.5],
  path: [200, 172, 120, 0.42],
  plank: [160, 110, 60, 0.46],
  plain: [196, 170, 108, 0.42],
  grass: [112, 178, 86, 0.42],
  sand: [224, 202, 138, 0.42],
  wasteland: [178, 168, 122, 0.42],
  wetland: [108, 158, 142, 0.44],
  poison: [148, 72, 172, 0.46],
  forest: [28, 95, 42, 0.5],
  hill: [160, 103, 54, 0.42],
  mountain: [30, 33, 34, 1],
  shore: [119, 120, 94, 1],
  water: [38, 125, 168, 0.48],
  stream: [102, 140, 153, 1],
  river: [46, 108, 182, 0.5],
  sea: [18, 58, 122, 0.56],
  shallow: [96, 186, 196, 0.44],
  ferry: [160, 116, 64, 0.55],
  pass: [122, 96, 56, 0.62],
  construction: [190, 193, 198, 0.45],
};

/**
 * 把全量地图格烘焙成一张位图：逐格写像素数组后一次 putImageData，只有一次绘制调用。
 * 生成后即为静态图片，与镜头/部队无关；地图数据不变则结果不变。
 * 无 2D 上下文（例如 jsdom 测试环境）时返回 null，调用方退回纯色底图。
 */
function bakeMiniMapThumb(cells: GridCell[], gridWidth: number, gridHeight: number): string | null {
  if (typeof document === 'undefined') return null;
  const step = MINIMAP_PIXELS_PER_CELL;
  const canvas = document.createElement('canvas');
  canvas.width = gridWidth * step;
  canvas.height = gridHeight * step;
  const context = canvas.getContext('2d');
  if (!context) return null;
  const image = context.createImageData(canvas.width, canvas.height);
  const data = image.data;
  const [baseR, baseG, baseB] = MINIMAP_BASE_RGB;
  for (let i = 0; i < data.length; i += 4) {
    data[i] = baseR;
    data[i + 1] = baseG;
    data[i + 2] = baseB;
    data[i + 3] = 255;
  }
  for (const cell of cells) {
    if (cell.q < 0 || cell.r < 0 || cell.q >= gridWidth || cell.r >= gridHeight) continue;
    const fill = MINIMAP_TERRAIN_FILL[cell.terrain];
    if (!fill) continue;
    const [r, g, b, alpha] = fill;
    const keep = 1 - alpha;
    const originX = cell.q * step;
    const originY = cell.r * step;
    for (let dy = 0; dy < step; dy += 1) {
      for (let dx = 0; dx < step; dx += 1) {
        const index = ((originY + dy) * canvas.width + originX + dx) * 4;
        data[index] = r * alpha + data[index] * keep;
        data[index + 1] = g * alpha + data[index + 1] * keep;
        data[index + 2] = b * alpha + data[index + 2] * keep;
      }
    }
  }
  context.putImageData(image, 0, 0);
  return canvas.toDataURL('image/png');
}

/** 原版 10 关所锚点（china42x 全图标记） */
const PASS_ANCHORS = china42Passes();

function cellPosition(q: number, r: number) {
  return {
    x: q * CELL_SIZE,
    y: r * CELL_SIZE + (q % 2 === 0 ? -CELL_SIZE / 2 : 0),
  };
}

const VIEWPORT_CULL_THRESHOLD = 1500;
// 最低角度（11 格视野）下可见格子约 11×11，阈值余量充足；culling 之后才做判定
const MAX_TERRAIN_CELLS = 8000;

interface StrategicMapProps {
  onCityMenu?(cityId: CityId, position: { x: number; y: number }): void;
  onCityInfoMenu?(cityId: CityId, position: { x: number; y: number }): void;
  /** 点击关隘中心锚点：打开关隘命令菜单（无都市段） */
  onPassMenu?(passId: PassId, position: { x: number; y: number }): void;
  /** 悬停关隘中心锚点：显示关隘信息弹窗 */
  onPassHover?(passId: PassId, position: { x: number; y: number }): void;
  onPassLeave?(): void;
  /** 右键关隘：打开关隘信息菜单（关隘详细信息/所属武将/势力武将） */
  onPassInfoMenu?(passId: PassId, position: { x: number; y: number }): void;
  backgroundImage?: string;
  editorGrid?: GridCell[];
  editorCities?: EditableCityMarker[];
  editorPlots?: EditorCityPlot[];
  editorPlotCityId?: string | null;
  editorMode?: boolean;
  onEditorCellPaint?(coord: GridCoord): void;
  deployTargets?: GridCoord[];
  selectedDeployTarget?: GridCoord | null;
  onDeployTargetSelect?(coord: GridCoord, position: { x: number; y: number }): void;
  moveTargets?: GridCoord[];
  /** 超距移动委任的最优路径（目标格含在内），路径上非当前可移动格用黄色高亮 */
  delegatePath?: GridCoord[];
  /** 出征部署中：点击出征范围外的格触发超距出征委任（移动/设置） */
  deployDelegateMode?: boolean;
  firePlotTargets?: GridCoord[];
  firePlots?: FirePlot[];
  attackTargetCityIds?: CityId[];
  attackTargetFacilityIds?: string[];
  attackTargetUnitIds?: string[];
  /** 可攻击的开发设施：`cityId:plotIndex` 集合，命中时高亮为攻击目标 */
  attackTargetPlotKeys?: Set<string>;
  damageReports?: BattleDamageReport[];
  strategyResultReports?: StrategyResultReport[];
  cityEffectReports?: CityEffectReport[];
  facilityRepairReports?: FacilityRepairReport[];
  selectedUnitId?: string | null;
  onCellHover?(cell: GridCell | null): void;
  onMoveTargetSelect?(coord: GridCoord, position: { x: number; y: number }): void;
  onFirePlotTargetSelect?(coord: GridCoord): void;
  onUnitSelect?(unitId: string, position: { x: number; y: number }): void;
  onUnitContextMenu?(unitId: string, position: { x: number; y: number }): void;
  onUnitHover?(unitId: string, position: { x: number; y: number }): void;
  onUnitLeave?(): void;
  onCityHover?(cityId: CityId, position: { x: number; y: number }): void;
  onCityLeave?(): void;
  onAttackTargetSelect?(unitId: string): void;
  onAttackCityTargetSelect?(cityId: CityId): void;
  attackTargetPassIds?: PassId[];
  onAttackPassTargetSelect?(passId: PassId): void;
  onFacilityTargetSelect?(facilityId: string): void;
  onFacilityContextMenu?(facilityId: string, position: { x: number; y: number }): void;
  /** 移动模式下点击未完成的己方军事设施：询问是否委任修补 */
  onFacilityRepairPrompt?(facilityId: string, position: { x: number; y: number }): void;
  /** 右键点击设施/城市设施：关闭撤销菜单 */
  onFacilityMenuClose?(): void;
  onFacilityHover?(facilityId: string, position: { x: number; y: number }): void;
  onFacilityLeave?(): void;
  onMapContextMenu?(position: { x: number; y: number }): void;
  onMapContextClose?(): void;
  /** 建设用地目标（等待玩家点击） */
  constructionTargets?: GridCoord[];
  /** 点击建设用地目标 */
  onConstructionTargetSelect?(coord: GridCoord, position: { x: number; y: number }): void;
  /** 点击城池建设用地设施（建设中/已建成），打开撤销菜单 */
  onCityPlotSelect?(cityId: string, plotIndex: number, position: { x: number; y: number }): void;
  /** 悬停城市设施（建设用地上的设施） */
  onCityPlotHover?(cityId: CityId, plotIndex: number, position: { x: number; y: number }): void;
  onCityPlotLeave?(): void;
  /** 出征编成确认后、落位前：在出发城池中心显示待出发部队预览（与正式部队共用渲染，取消出征即消失） */
  previewUnits?: ArmyUnit[];
  /** 右键菜单/浮层已打开时冻结镜头：禁止拖拽平移与边缘自动滚动 */
  freezeView?: boolean;
  /** 镜头变化时回报归一化描述，供存档记录（拖拽/缩放/边缘滚动都会触发） */
  onViewChange?(camera: MapCamera): void;
  /** 读档后要还原的镜头；与 restoreCameraToken 配合，token 变化即重新应用一次 */
  restoreCamera?: MapCamera | null;
  restoreCameraToken?: number;
  /** 外部列表（城池/武将/部队）请求把镜头居中到指定格；与 focusToken 配合，token 变化即执行一次 */
  focusCell?: GridCoord | null;
  focusToken?: number;
}

export function StrategicMap({
  backgroundImage,
  constructionTargets = [],
  deployTargets = [],
  editorCities,
  editorGrid,
  editorPlots,
  editorPlotCityId,
  editorMode = false,
  firePlotTargets = [],
  firePlots = [],
  moveTargets = [],
  attackTargetCityIds = [],
  attackTargetPassIds = [],
  attackTargetFacilityIds = [],
  attackTargetUnitIds = [],
  attackTargetPlotKeys,
  damageReports = [],
  strategyResultReports = [],
  cityEffectReports = [],
  facilityRepairReports = [],
  delegatePath = [],
  deployDelegateMode = false,
  onCityMenu,
  onCityInfoMenu,
  onPassMenu,
  onPassHover,
  onPassLeave,
  onPassInfoMenu,
  onCellHover,
  onConstructionTargetSelect,
  onDeployTargetSelect,
  onEditorCellPaint,
  onFirePlotTargetSelect,
  onMapContextClose,
  onMapContextMenu,
  onMoveTargetSelect,
  onUnitSelect,
  onUnitContextMenu,
  onUnitHover,
  onUnitLeave,
  onCityHover,
  onCityLeave,
  onAttackTargetSelect,
  onAttackCityTargetSelect,
  onAttackPassTargetSelect,
  onFacilityTargetSelect,
  onFacilityContextMenu,
  onFacilityRepairPrompt,
  onFacilityMenuClose,
  onFacilityHover,
  onFacilityLeave,
  onCityPlotSelect,
  onCityPlotHover,
  onCityPlotLeave,
  selectedDeployTarget,
  selectedUnitId,
  previewUnits = [],
  freezeView = false,
  onViewChange,
  restoreCamera = null,
  restoreCameraToken = 0,
  focusCell = null,
  focusToken = 0,
}: StrategicMapProps) {
  const { state, selectedCityId, selectCity, online } = useGame();
  const [view, setView] = useState<MapView>(() => {
    const gw = state?.gridWidth ?? DEFAULT_GRID_WIDTH;
    // 编辑器模式下最远视角放宽（见 EDITOR_FARTHEST_CELLS），初始即呈现一大片可见地形网格
    const initial = editorMode
      ? Math.min(gw / FARTHEST_VISIBLE_CELLS, gw / EDITOR_FARTHEST_CELLS)
      : gw / FARTHEST_VISIBLE_CELLS;
    return { x: 0, y: 0, scale: Math.round(initial * 100) / 100 };
  });
  const [hoveredFacilityId, setHoveredFacilityId] = useState<string | null>(null);
  const [hoveredCityId, setHoveredCityId] = useState<CityId | null>(null);
  const [hoveredPassId, setHoveredPassId] = useState<PassId | null>(null);
  const [hoveredUnitId, setHoveredUnitId] = useState<string | null>(null);
  const [viewport, setViewport] = useState<{ width: number; height: number } | null>(null);
  /** 视口尺寸的 ref 副本：供常驻 interval（边缘滚动）读取最新布局，避免陈旧闭包 */
  const viewportRef = useRef<{ width: number; height: number } | null>(null);
  /** 地图网格宽高的 ref 副本：供常驻 interval 内镜头钳制读取最新比值 */
  const gridSizeRef = useRef<{ width: number; height: number } | null>(null);
  /** freezeView 的 ref 副本：供常驻 interval/pointermove 读取最新浮层冻结状态 */
  const freezeViewRef = useRef(freezeView);
  freezeViewRef.current = freezeView;
  const drag = useRef<{ pointerId: number; x: number; y: number } | null>(null);
  const regionRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (state) {
      gridSizeRef.current = {
        width: state.gridWidth ?? DEFAULT_GRID_WIDTH,
        height: state.gridHeight ?? DEFAULT_GRID_HEIGHT,
      };
    }
  }, [state]);

  useEffect(() => {
    const region = regionRef.current;
    if (!region || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const size = { width: entry.contentRect.width, height: entry.contentRect.height };
        viewportRef.current = size;
        setViewport(size);
      }
    });
    observer.observe(region);
    return () => observer.disconnect();
  }, []);

  const gridWidth = state?.gridWidth ?? DEFAULT_GRID_WIDTH;
  const gridHeight = state?.gridHeight ?? DEFAULT_GRID_HEIGHT;
  const worldWidth = gridWidth * CELL_SIZE;
  const worldHeight = gridHeight * CELL_SIZE;
  // 视野格数 = gridWidth / scale：最高角度约 30 格（scale 小），最低角度约 11 格（scale 大）
  // 编辑器模式放宽最远视野，让初始能呈现一大片地形网格
  const minScale = editorMode
    ? Math.min(gridWidth / FARTHEST_VISIBLE_CELLS, gridWidth / EDITOR_FARTHEST_CELLS)
    : gridWidth / FARTHEST_VISIBLE_CELLS;
  const maxScale = gridWidth / NEAREST_VISIBLE_CELLS;
  const clampScale = (value: number) => {
    const clamped = Math.min(maxScale, Math.max(minScale, value));
    return Math.round(clamped * 100) / 100;
  };
  const resetView = (): MapView => ({ x: 0, y: 0, scale: clampScale(minScale) });
  const zoomStyle = (): CSSProperties => {
    const scale = view.scale;
    const width = viewport ? Math.max(1, Math.round(viewport.width * scale)) : '100%';
    // 容器高度与宽度保持世界坐标宽高比，避免正方形网格被非正方形视口纵向压缩扭曲，
    // 同时让 HTML 标牌与 SVG 网格/单位层落在同一等比基准上（相互对齐）。
    const height = viewport
      ? Math.max(1, Math.round((width as number) * (worldHeight / worldWidth)))
      : '100%';
    const left = viewport ? Math.round((viewport.width - (width as number)) / 2 + view.x) : 0;
    const top = viewport ? Math.round((viewport.height - (height as number)) / 2 + view.y) : 0;
    return { left, top, width, height };
  };
  const localCity = state ? Object.values(state.cities).find((city) => city.ownerId === state.playerForceId) : undefined;
  const opponentCity = state ? Object.values(state.cities).find((city) => city.ownerId !== state.playerForceId) : undefined;
  const perspectiveRotated = state?.scenarioId === 'mobile-duel' && Boolean(
    localCity && opponentCity && localCity.gridR < opponentCity.gridR,
  );
  const displayCellPosition = (q: number, r: number) => {
    const position = cellPosition(q, r);
    return perspectiveRotated
      ? { x: worldWidth - position.x - CELL_SIZE, y: worldHeight - position.y - CELL_SIZE }
      : position;
  };
  // 把镜头中心对准指定格子的中心（世界坐标→CSS 像素→反推 view 偏移），并做边界钳制。
  // 小地图跳转与“单机开局定位到君主城池”共用同一套换算，保证点哪格/定位哪城就落在视口正中。
  const centerViewOnCell = (current: MapView, q: number, r: number): MapView => {
    const vw = viewportRef.current?.width ?? 1280;
    const vh = viewportRef.current?.height ?? 720;
    // 目标世界格的中心（旋转场景沿用主视图同一套翻转后的坐标，保证点哪看哪）
    const center = displayCellPosition(q, r);
    const targetX = center.x + CELL_SIZE / 2;
    const targetY = center.y + CELL_SIZE / 2;
    const cssWidth = Math.max(1, vw * current.scale);
    const cssHeight = cssWidth * (worldHeight / worldWidth);
    return clampViewToMap({
      ...current,
      x: cssWidth / 2 - (targetX * cssWidth) / worldWidth,
      y: cssHeight / 2 - (targetY * cssHeight) / worldHeight,
    });
  };
  // 小地图跳转：把主镜头中心移到“地图区域相对位置 (fx, fy)”（0..1）所在的格子上。
  // fx/fy 与小地图城市点按钮使用同一套 0..1 百分比坐标，保证点哪格就落到对应世界格。
  const moveCameraToMapFraction = (fx: number, fy: number) => {
    setView((current) => centerViewOnCell(
      current,
      Math.min(gridWidth - 1, Math.max(0, fx * gridWidth)),
      Math.min(gridHeight - 1, Math.max(0, fy * gridHeight)),
    ));
  };
  const displayCellCenterPercent = (q: number, r: number) => {
    const position = displayCellPosition(q, r);
    return {
      left: ((position.x + CELL_SIZE / 2) / worldWidth) * 100,
      top: ((position.y + CELL_SIZE / 2) / worldHeight) * 100,
    };
  };

  const zoom = (direction: number) => {
    setView((current) => (
      clampViewToMap({ ...current, scale: clampScale(current.scale * (direction > 0 ? ZOOM_FACTOR : 1 / ZOOM_FACTOR)) })
    ));
  };

  // 镜头边界钳制：地图内容（等比放大后）必须始终铺满视口，不露出视口外的空白。
  // 以“内容居中于视口”为 x/y=0，允许偏移量不超过 (内容尺寸 - 视口尺寸) / 2；
  // 若内容比视口小（理论只在极端宽高比下）则固定为居中 0。
  const clampViewToMap = (next: MapView): MapView => {
    const vw = viewportRef.current?.width ?? 1280;
    const vh = viewportRef.current?.height ?? 720;
    const gw = gridSizeRef.current?.width ?? gridWidth;
    const gh = gridSizeRef.current?.height ?? gridHeight;
    const contentWidth = Math.max(1, vw * next.scale);
    const contentHeight = Math.max(1, contentWidth * (gh / gw));
    const maxX = Math.max(0, (contentWidth - vw) / 2);
    const maxY = Math.max(0, (contentHeight - vh) / 2);
    return {
      ...next,
      x: Math.min(maxX, Math.max(-maxX, next.x)),
      y: Math.min(maxY, Math.max(-maxY, next.y)),
    };
  };

  const handleWheel = (event: WheelEvent<HTMLDivElement>) => {
    event.preventDefault();
    if (freezeViewRef.current) return; // 右键菜单打开时冻结，禁止缩放
    zoom(event.deltaY < 0 ? 1 : -1);
  };

  const handleContextMenu = (event: MouseEvent<HTMLDivElement>) => {
    if ((event.target as HTMLElement).closest('button')) return;
    // 编辑器模式：右键直接用于拖拽平移，不弹右键菜单
    if (editorMode) { event.preventDefault(); return; }
    event.preventDefault();
    onMapContextMenu?.({ x: event.clientX + 10, y: event.clientY + 4 });
  };

  const handlePointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (freezeViewRef.current) return; // 浮层菜单打开时画面固定，不启动拖拽
    if ((event.target as HTMLElement).closest('button')) return;
    // 常规模式：仅左键拖拽（左键也用于刷地形，两者由 button 区分）；
    // 编辑器模式：左键刷地形、右键拖拽
    const isDragButton = editorMode ? event.button === 2 : event.button === 0;
    if (!isDragButton) return;
    if (editorMode) event.preventDefault(); // 阻止右键触发浏览器默认菜单
    drag.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY };
    event.currentTarget.setPointerCapture?.(event.pointerId);
  };

  const handlePointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (!drag.current || drag.current.pointerId !== event.pointerId) return;
    if (freezeViewRef.current) return; // 浮层菜单打开期间不响应拖拽平移
    const dx = event.clientX - drag.current.x;
    const dy = event.clientY - drag.current.y;
    drag.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY };
    setView((current) => clampViewToMap({ ...current, x: current.x + dx, y: current.y + dy }));
  };

  const stopDragging = (event: PointerEvent<HTMLDivElement>) => {
    if (drag.current?.pointerId === event.pointerId) drag.current = null;
  };

  // 边缘自动滚动（摇杆式二维矢量）：以视口中心为原点，鼠标进入四边边缘带后，
  // 镜头沿“鼠标相对中心的方向”以恒定合速移动；方向由相对中心的偏移矢量归一化得到，
  // 因此纯上方只向上、偏右上则向上为主并叠加向右、正右上角上/右两分量并存。
  // 鼠标移出地图/窗口后，只要仍在页面内移动，方向会继续随鼠标实时变化；
  // 只有鼠标回到地图内部（脱离边缘带）才停止。
  useEffect(() => {
    // 记录当前平移的归一化速度矢量（已折算为 view.x/view.y 方向：相对中心向右→x 减小，向上→y 增大）
    const panDirection = { x: 0, y: 0 };
    const pointerMove = (event: globalThis.PointerEvent) => {
      if (drag.current) return;
      if (freezeViewRef.current) return; // 右键菜单打开时冻结：不进入边缘滚动方向计算
      const region = regionRef.current;
      if (!region) return;
      const target = event.target as Node | null;
      const hoverEl = target instanceof HTMLElement ? target : null;
      // 悬停在地图工具/小地图/按钮上时不滚动
      if (hoverEl?.closest?.('button, .map-tools, .mini-map')) {
        panDirection.x = 0;
        panDirection.y = 0;
        return;
      }
      const rect = region.getBoundingClientRect();
      // 布局未就绪（如测试环境）时回退到有效视口尺寸，仍以视口左上角为原点
      const bounds = rect.width > 0 && rect.height > 0
        ? rect
        : { left: 0, top: 0, width: 1280, height: 720 };
      const relX = event.clientX - bounds.left;
      const relY = event.clientY - bounds.top;
      // 滚动“激活”前，指针必须位于地图区域内（防止地图外 UI 上的移动误触发滚动）；
      // 激活后（方向非 0）允许指针移出地图/窗口，只要仍在页面内移动就按当前位置实时刷新方向。
      const insideRegion = target instanceof Node && region.contains(target);
      if (!insideRegion && panDirection.x === 0 && panDirection.y === 0) return;
      const zone = EDGE_PAN_ZONE_PX;
      const centerX = bounds.width / 2;
      const centerY = bounds.height / 2;
      const inBand = relX < zone || relX > bounds.width - zone
        || relY < zone || relY > bounds.height - zone;
      // 完全脱离边缘带（回到地图内部）即停止
      if (!inBand) {
        panDirection.x = 0;
        panDirection.y = 0;
        return;
      }
      // 摇杆方向：鼠标相对中心的方向矢量，归一化后即为各轴向速度占比
      const dx = relX - centerX;
      const dy = relY - centerY;
      const length = Math.hypot(dx, dy);
      if (length < 1) {
        panDirection.x = 0;
        panDirection.y = 0;
        return;
      }
      // view 偏移方向与“看到的镜头方向”相反：向右看→view.x 减小，向上看→view.y 增大
      panDirection.x = -dx / length;
      panDirection.y = -dy / length;
    };
    const timer = window.setInterval(() => {
      if (freezeViewRef.current) {
        // 右键菜单打开期间冻结：停止边缘滚动并清零方向，避免菜单关闭后残留移动
        panDirection.x = 0;
        panDirection.y = 0;
        return;
      }
      if (drag.current || (panDirection.x === 0 && panDirection.y === 0)) return;
      setView((current) => {
        const next = clampViewToMap({
          ...current,
          x: current.x + panDirection.x * EDGE_PAN_MAX_STEP_PX,
          y: current.y + panDirection.y * EDGE_PAN_MAX_STEP_PX,
        });
        // 已到地图边缘且钳制后无变化：避免持续触发重渲染
        if (next.x === current.x && next.y === current.y && next.scale === current.scale) return current;
        return next;
      });
    }, EDGE_PAN_INTERVAL_MS);
    document.addEventListener('pointermove', pointerMove);
    return () => {
      document.removeEventListener('pointermove', pointerMove);
      window.clearInterval(timer);
    };
  }, []);

  // 进入游戏（单机/联网）：镜头自动跳到本方君主所在城池，并让该城池显示在视口正中。
  // 每局只执行一次（进入/读档时），之后玩家的拖拽、缩放、边缘滚动都不会被重置。
  const initialFocusCity = state && !editorMode
    ? rulerCityOf(state, state.playerForceId)
    : undefined;
  const initialFocusAppliedRef = useRef(false);
  useEffect(() => {
    if (initialFocusAppliedRef.current || !initialFocusCity) return;
    // 读档进入时以存档镜头为准，不再把镜头拉回君主城池
    if (restoreCameraToken > 0) {
      initialFocusAppliedRef.current = true;
      return;
    }
    // 浏览器里等 ResizeObserver 首次回报真实视口尺寸后再居中，避免先按回退尺寸居中、布局就绪后再跳一次；
    // 无 ResizeObserver 的环境（如测试）直接用回退视口，行为确定可断言。
    if (!viewport && typeof ResizeObserver !== 'undefined') return;
    initialFocusAppliedRef.current = true;
    setView((current) => centerViewOnCell(current, initialFocusCity.gridQ, initialFocusCity.gridR));
  }, [viewport, initialFocusCity, restoreCameraToken]);

  /** 世界坐标内容尺寸（CSS 像素）——镜头描述与还原都以此为基准 */
  const contentSizeOf = (scale: number) => {
    const vw = viewportRef.current?.width ?? 1280;
    const contentWidth = Math.max(1, vw * scale);
    return { contentWidth, contentHeight: Math.max(1, contentWidth * (worldHeight / worldWidth)) };
  };

  /** 当前镜头 → 与视口尺寸无关的归一化描述 */
  const describeView = (current: MapView): MapCamera => {
    const { contentWidth, contentHeight } = contentSizeOf(current.scale);
    return {
      cx: 0.5 - current.x / contentWidth,
      cy: 0.5 - current.y / contentHeight,
      scale: current.scale,
    };
  };

  /** 归一化描述 → 当前视口下的镜头偏移（存档时的视口尺寸下与原样一致） */
  const applyCamera = (camera: MapCamera): MapView => {
    const scale = clampScale(camera.scale);
    const { contentWidth, contentHeight } = contentSizeOf(scale);
    return clampViewToMap({
      scale,
      x: (0.5 - camera.cx) * contentWidth,
      y: (0.5 - camera.cy) * contentHeight,
    });
  };

  // 读档请求：等真实视口回报后再落地，保证还原位置与原存档一致
  const pendingCameraRef = useRef<MapCamera | null>(null);
  const consumedCameraTokenRef = useRef(0);
  useEffect(() => {
    if (restoreCameraToken <= 0 || consumedCameraTokenRef.current === restoreCameraToken) return;
    pendingCameraRef.current = restoreCamera;
    if (!restoreCamera) consumedCameraTokenRef.current = restoreCameraToken;
  }, [restoreCamera, restoreCameraToken]);
  useEffect(() => {
    const pending = pendingCameraRef.current;
    if (!pending) return;
    // 有 ResizeObserver 的环境等真实视口回报后再落地；无该 API 的环境（如测试）直接用回退视口
    if (!viewportRef.current && typeof ResizeObserver !== 'undefined') return;
    pendingCameraRef.current = null;
    consumedCameraTokenRef.current = restoreCameraToken;
    setView(applyCamera(pending));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [restoreCameraToken, viewport]);

  // 列表点击跳转：把镜头居中到指定格。与读档还原同一套「等真实视口」的等待逻辑，
  // 但只改中心、保留当前缩放（玩家自己调的远近不该被列表点击重置）。
  const pendingFocusRef = useRef<GridCoord | null>(null);
  const consumedFocusTokenRef = useRef(0);
  useEffect(() => {
    if (focusToken <= 0 || consumedFocusTokenRef.current === focusToken) return;
    pendingFocusRef.current = focusCell;
    if (!focusCell) consumedFocusTokenRef.current = focusToken;
  }, [focusCell, focusToken]);
  useEffect(() => {
    const pending = pendingFocusRef.current;
    if (!pending) return;
    if (!viewportRef.current && typeof ResizeObserver !== 'undefined') return;
    pendingFocusRef.current = null;
    consumedFocusTokenRef.current = focusToken;
    setView((current) => centerViewOnCell(current, pending.q, pending.r));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusToken, viewport]);

  // 回报镜头变化（仅写入调用方 ref，不触发重渲染）
  const onViewChangeRef = useRef(onViewChange);
  onViewChangeRef.current = onViewChange;
  useEffect(() => {
    onViewChangeRef.current?.(describeView(view));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, viewport, worldWidth, worldHeight]);

  /** 小地图底图：只依赖地图数据，镜头移动/部队变化不会触发重烘焙 */
  const miniMapThumb = useMemo(() => {
    const grid = editorGrid ?? state?.grid;
    if (!grid || grid.length === 0) return null;
    return bakeMiniMapThumb(grid, state?.gridWidth ?? DEFAULT_GRID_WIDTH, state?.gridHeight ?? DEFAULT_GRID_HEIGHT);
  }, [editorGrid, state?.grid, state?.gridWidth, state?.gridHeight]);

  if (!state) return null;

  const displayGrid = editorGrid ?? state.grid;
  const displayCities = editorMode
    ? (editorCities ?? []).filter((m) => (m as any).type !== 'pass').map((city) => ({ ...city, forceColor: '#d1b943' }))
    : Object.values(state.cities).map((city) => ({
      id: city.id,
      label: city.name,
      q: city.gridQ,
      r: city.gridR,
      forceColor: (city.ownerId ? state.forces[city.ownerId]?.color : undefined) ?? NEUTRAL_CITY_COLOR,
    }));
  /** 编辑器模式：单独渲染关隘标记，只占 1 格（城池占 7 格） */
  const displayEditorPasses = editorMode
    ? (editorCities ?? []).filter((m) => (m as any).type === 'pass').map((city) => ({ ...city, forceColor: '#6b3a1f' }))
    : [];

  let visibleCells = displayGrid;
  const effectiveViewport = viewport ?? { width: 1280, height: 720 };
  // 屏幕上单个格子的像素尺寸，用于让城池标牌等 HTML 覆盖层与格子保持固定比例
  const cellPx = (effectiveViewport.width * view.scale) / gridWidth;
  if (displayGrid.length > VIEWPORT_CULL_THRESHOLD) {
    const cssWidth = effectiveViewport.width * view.scale;
    // 与 zoomStyle 保持一致：容器高度按世界坐标宽高比等比计算，否则裁剪范围与实际渲染错位
    const cssHeight = cssWidth * (gridHeight / gridWidth);
    const left = (effectiveViewport.width - cssWidth) / 2 + view.x;
    const top = (effectiveViewport.height - cssHeight) / 2 + view.y;
    // 仅裁剪视口实际覆盖的列（水平方向）：floor/ceil 取整本身包含边缘容差，无需额外 buffer，
    // 避免最高角度（左右 30 格视野）下多渲染出 37 格。行（垂直方向）保留少量缓冲，
    // 防止顶部/底部边缘格子因取整在极窄视野下缺失。
    const qMin = Math.floor(-left * gridWidth / cssWidth);
    const qMax = Math.ceil((effectiveViewport.width - left) * gridWidth / cssWidth);
    const rMin = Math.floor(-top * gridHeight / cssHeight) - ROW_CULL_BUFFER;
    const rMax = Math.ceil((effectiveViewport.height - top) * gridHeight / cssHeight) + ROW_CULL_BUFFER;
    visibleCells = displayGrid.filter((cell) => cell.q >= qMin && cell.q <= qMax && cell.r >= rMin && cell.r <= rMax);
  }
  const renderTerrainByScale = visibleCells.length <= MAX_TERRAIN_CELLS;
  const deployTargetKeys = new Set(deployTargets.map((coord) => `${coord.q},${coord.r}`));
  const deployMode = deployTargetKeys.size > 0;
  const moveTargetKeys = new Set(moveTargets.map((coord) => `${coord.q},${coord.r}`));
  const delegatePathKeys = new Set(delegatePath.map((coord) => `${coord.q},${coord.r}`));
  const firePlotTargetKeys = new Set(firePlotTargets.map((coord) => `${coord.q},${coord.r}`));
  const constructionTargetKeys = new Set(constructionTargets.map((coord) => `${coord.q},${coord.r}`));
  // 关隘翼格：不可通行且在游戏视图下隐藏渲染（仅编辑器模式保留显示）
  const blockedPassKeys = state ? passBlockedKeys(state) : new Set<string>();
  const attackTargetCityIdSet = new Set(attackTargetCityIds);
  const attackTargetPassIdSet = new Set(attackTargetPassIds);
  const attackTargetFacilityIdSet = new Set(attackTargetFacilityIds);
  const attackTargetUnitIdSet = new Set(attackTargetUnitIds);
  const facilityOccupiedKeys = new Set(Object.values(state.facilities ?? {}).map((facility) => `${facility.q},${facility.r}`));
  const cityFootprintByKey = new Map<string, CityId>();
  if (!editorMode) {
    for (const city of Object.values(state.cities)) {
      for (const coord of sevenCellCityFootprint({ q: city.gridQ, r: city.gridR })) {
        cityFootprintByKey.set(`${coord.q},${coord.r}`, city.id);
      }
    }
  }
  const moveMode = moveTargetKeys.size > 0 || delegatePathKeys.size > 0;
  const firePlotMode = firePlotTargetKeys.size > 0;
  const constructionMode = constructionTargetKeys.size > 0;
  const renderTerrain = editorMode || renderTerrainByScale;
  // 全图视图下地形格子不渲染时，模式目标格子（部署/移动/火计）仍需独立渲染，否则玩家无法看到可点击目标
  const modeTargetCells = !renderTerrain && (deployMode || moveMode || firePlotMode)
    ? (() => {
        const cellByKey = new Map(displayGrid.map((cell) => [gridKey(cell), cell]));
        const seen = new Set<string>();
        const cells: GridCell[] = [];
        for (const coord of [...deployTargets, ...moveTargets, ...delegatePath, ...firePlotTargets]) {
          const key = gridKey(coord);
          if (seen.has(key)) continue;
          seen.add(key);
          const cell = cellByKey.get(key);
          if (cell) cells.push(cell);
        }
        return cells;
      })()
    : [];
  const cellsToRender = renderTerrain ? visibleCells : modeTargetCells;
  const selectedDeployKey = selectedDeployTarget ? `${selectedDeployTarget.q},${selectedDeployTarget.r}` : null;
  const hoveredFacility = hoveredFacilityId ? state.facilities?.[hoveredFacilityId] : undefined;
  const hoveredFacilityRange = hoveredFacility && hoveredFacility.completed !== false ? FACILITY_RANGE[hoveredFacility.type] : undefined;
  const facilityRangeCells = hoveredFacility && hoveredFacilityRange
    ? (() => {
        const keys = new Set(displayGrid.map(gridKey));
        return coordsWithinRange(hoveredFacility, hoveredFacilityRange)
          .filter((coord) => keys.has(gridKey(coord)) && (coord.q !== hoveredFacility.q || coord.r !== hoveredFacility.r));
      })()
    : [];
  // 城池攻击范围格子（鼠标悬停城池时显示，外1~2圈）
  const cityAttackRangeCells = hoveredCityId
    ? (() => {
        const city = state.cities[hoveredCityId];
        if (!city) return [];
        const keys = new Set(displayGrid.map(gridKey));
        const coords: GridCoord[] = [];
        for (let d = CITY_ATTACK_MIN; d <= CITY_ATTACK_RANGE; d += 1) {
          coords.push(...coordsWithinRange({ q: city.gridQ, r: city.gridR }, d));
        }
        return coords.filter((c) => keys.has(gridKey(c)));
      })()
    : [];
  // 关隘攻击范围格子（鼠标悬停关隘时显示，外1~2圈，不含关隘本身）
  const passAttackRangeCells = hoveredPassId
    ? (() => {
        const pass = state.passes?.[hoveredPassId];
        if (!pass) return [];
        const keys = new Set(displayGrid.map(gridKey));
        return passAttackRangeCoords(pass).filter((coord) => keys.has(gridKey(coord)));
      })()
    : [];
  // 部队光环范围格子（鼠标悬停有光环的部队时显示，含自身格）
  const unitAuraRangeCells = hoveredUnitId
    ? (() => {
        const unit = state.units[hoveredUnitId];
        if (!unit) return [];
        const range = unitAuraRange(state, unit);
        if (range <= 0) return [];
        const keys = new Set(displayGrid.map(gridKey));
        return coordsWithinRange({ q: unit.q, r: unit.r }, range).filter((coord) => keys.has(gridKey(coord)));
      })()
    : [];
  const dismissUnitHover = () => onUnitLeave?.();
  const dismissCityHover = () => onCityLeave?.();
  const dismissPassHover = () => {
    setHoveredPassId(null);
    onPassLeave?.();
  };
  const selectCityFromMap = (cityId: CityId, position: { x: number; y: number }) => {
    const city = state.cities[cityId];
    if (!city) return;
    dismissCityHover();
    if (attackTargetCityIdSet.has(cityId)) {
      onAttackCityTargetSelect?.(cityId);
      return;
    }
    selectCity(cityId);
    if (city.ownerId === state.playerForceId) {
      onCityMenu?.(cityId, position);
    }
  };
  /** 点击关隘中心锚点：攻击目标优先，其次本方关隘命令菜单，最后非己方关隘弹情报 */
  const selectPassFromMap = (passId: PassId, position: { x: number; y: number }) => {
    const pass = state.passes?.[passId];
    if (!pass) return;
    dismissPassHover();
    if (attackTargetPassIdSet.has(passId)) {
      onAttackPassTargetSelect?.(passId);
      return;
    }
    if (pass.ownerId === state.playerForceId) {
      onPassMenu?.(passId, position);
      return;
    }
    // 非己方关隘：弹出关隘情报。城池点击会选中并显示城池面板，关隘没有对应的「选中」态，
    // 若不在这里给反馈，点敌方/无主关隘就完全没反应（玩家会以为关隘不可点）。
    onPassInfoMenu?.(passId, position);
  };
  const renderUnitMarker = (unit: ArmyUnit, preview = false) => {
    const position = displayCellPosition(unit.q, unit.r);
    const leaderName = state.officers[unit.leaderId]?.name ?? '';
    const troopType = unit.troopType ?? 'sword';
    const unitKind = unit.kind ?? 'combat';
    const vehicle = unit.vehicle;
    const terrain = state.grid.find((cell) => cell.q === unit.q && cell.r === unit.r)?.terrain;
    const onWater = isWaterTerrain(terrain);
    const texture = unitKind === 'transport'
      ? { glyph: '输', label: '输送队' }
      : onWater && vehicle
        ? VEHICLE_TEXTURES[vehicle]
        : troopType === 'siege' && unit.siegeWeapon
          ? SIEGE_TEXTURES[unit.siegeWeapon]
          : TROOP_TEXTURES[troopType];
    const centerX = position.x + CELL_SIZE / 2;
    const centerY = position.y + CELL_SIZE / 2;
    const canActThisTurn = unit.forceId === state.turnForceId && !unit.moved && !unit.acted && !unitIsIncapacitated(unit) && unit.movementRemaining > 0;
    const isAttackTarget = attackTargetUnitIdSet.has(unit.id);
    const isFirePlotTarget = firePlotTargetKeys.has(`${unit.q},${unit.r}`);
    const forceColor = state.forces[unit.forceId].color;
    const statusFlags = [
      unit.confusedTenDays ? 'confused' : null,
      unit.falseReportedTenDays ? 'false-report' : null,
      unit.burningTenDays ? 'burning' : null,
    ].filter(Boolean).join(' ');
    const statusLabel = unit.confusedTenDays ? '乱' : unit.falseReportedTenDays ? '报' : unit.burningTenDays ? '火' : '';
    return (
      <g
        key={unit.id}
        data-testid={preview ? 'deploy-preview-marker' : 'battle-unit-marker'}
        data-grid-position={`${unit.q},${unit.r}`}
        data-troop-type={troopType}
        data-unit-kind={unitKind}
        data-vehicle={onWater ? (vehicle ?? undefined) : undefined}
        data-force-id={unit.forceId}
        data-unit-status={statusFlags || undefined}
        data-preview={preview ? 'true' : undefined}
        className={`battle-unit-marker troop-${troopType} unit-${unitKind}${onWater && vehicle ? ` vehicle-${vehicle}` : ''}${selectedUnitId === unit.id ? ' is-selected' : ''}${statusFlags ? ' has-status' : ''}${preview ? ' is-deploy-preview' : ''}`}
        style={{ '--force-color': forceColor, ...(preview ? { pointerEvents: 'none' } : {}) } as CSSProperties}
        aria-label={`${leaderName} ${texture.label}`}
        onPointerDown={(event) => {
          if (event.button === 0 || event.button === 2) dismissUnitHover();
          if (event.button !== 0) return;
          event.stopPropagation();
          if (isFirePlotTarget) {
            onFirePlotTargetSelect?.({ q: unit.q, r: unit.r });
            return;
          }
          if (isAttackTarget) {
            onAttackTargetSelect?.(unit.id);
            return;
          }
          onUnitSelect?.(unit.id, { x: event.clientX + 12, y: event.clientY + 4 });
        }}
        onContextMenu={(event) => {
          event.preventDefault();
          event.stopPropagation();
          dismissUnitHover();
          onUnitContextMenu?.(unit.id, { x: event.clientX + 10, y: event.clientY + 4 });
        }}
        onPointerEnter={(event) => {
          setHoveredUnitId(unit.id);
          onUnitHover?.(unit.id, { x: event.clientX + 57, y: event.clientY + 47 });
        }}
        onPointerLeave={() => {
          setHoveredUnitId(null);
          onUnitLeave?.();
        }}
      >
        <text
          className="battle-unit-leader-name"
          x={centerX}
          y={Math.max(12, position.y - 5)}
        >
          {leaderName}
        </text>
        {unitKind === 'combat' && unit.stamina !== undefined && (
          <g className="battle-unit-stamina-bar">
            <rect
              className="battle-unit-stamina-track"
              x={centerX - CELL_SIZE * 0.35}
              y={position.y + 4}
              width={CELL_SIZE * 0.7}
              height={2}
              rx={1}
            />
            <rect
              className="battle-unit-stamina-fill"
              x={centerX - CELL_SIZE * 0.35}
              y={position.y + 4}
              width={CELL_SIZE * 0.7 * (Math.min(100, Math.max(0, unit.stamina)) / 100)}
              height={2}
              rx={1}
            />
          </g>
        )}
        {unitKind === 'combat' && (
          <g className="battle-unit-morale-bar" data-testid="battle-unit-morale-bar">
            <rect
              className="battle-unit-morale-track"
              x={centerX - CELL_SIZE * 0.35}
              y={position.y + 1}
              width={CELL_SIZE * 0.7}
              height={2}
              rx={1}
            />
            <rect
              className="battle-unit-morale-fill"
              x={centerX - CELL_SIZE * 0.35}
              y={position.y + 1}
              width={CELL_SIZE * 0.7 * (Math.min(100, Math.max(0, unit.energy)) / 100)}
              height={2}
              rx={1}
            />
          </g>
        )}
        <g className="battle-unit-model">
          <ellipse className="battle-unit-shadow" cx={centerX} cy={centerY + 15} rx={CELL_SIZE * 0.28} ry={CELL_SIZE * 0.08} />
          <path
            className="battle-unit-body"
            d={`M ${centerX - 15} ${centerY - 10} L ${centerX + 7} ${centerY - 15} L ${centerX + 17} ${centerY + 6} L ${centerX - 7} ${centerY + 16} L ${centerX - 18} ${centerY + 2} Z`}
          />
          <path
            className="battle-unit-crest"
            d={`M ${centerX - 8} ${centerY - 13} L ${centerX + 10} ${centerY - 16} L ${centerX + 4} ${centerY - 5} L ${centerX - 13} ${centerY - 1} Z`}
          />
          <text className="battle-unit-model-glyph" x={centerX} y={centerY + 4}>{texture.glyph}</text>
        </g>
        <text className="battle-unit-troops" x={centerX} y={centerY + 24}>{unit.troops.toLocaleString('en-US')}</text>
        {canActThisTurn && !preview && (
          <text className="battle-unit-ready-badge" data-testid="battle-unit-ready-badge" x={centerX + 17} y={centerY - 15}>{unit.delegate ? '委' : '未'}</text>
        )}
        {isAttackTarget && (
          <text className="attack-target-arrow" data-testid="attack-target-arrow" x={centerX} y={Math.max(12, position.y - 20)}>▼</text>
        )}
        {statusLabel && (
          <text className="battle-unit-status-badge" data-testid="battle-unit-status-badge" x={centerX - 17} y={centerY - 15}>{statusLabel}</text>
        )}
      </g>
    );
  };

  const damageLineHeight = 17;
  const damageLayout = new Map<string, { criticalY?: number; damageY: number }>();
  const damageGroups = new Map<string, BattleDamageReport[]>();
  for (const report of damageReports) {
    const key = `${report.q},${report.r}`;
    const group = damageGroups.get(key) ?? [];
    group.push(report);
    damageGroups.set(key, group);
  }
  for (const reports of damageGroups.values()) {
    const position = displayCellPosition(reports[0].q, reports[0].r);
    const lineCount = reports.reduce((count, report) => count + (report.critical ? 2 : 1), 0);
    const desiredBottomY = position.y - 31;
    const topY = Math.max(12, desiredBottomY - (lineCount - 1) * damageLineHeight);
    let lineIndex = 0;
    for (const report of reports) {
      const criticalY = report.critical ? topY + lineIndex++ * damageLineHeight : undefined;
      const damageY = topY + lineIndex++ * damageLineHeight;
      damageLayout.set(report.id, { criticalY, damageY });
    }
  }

  const renderDamageNumber = (report: BattleDamageReport) => {
    const position = displayCellPosition(report.q, report.r);
    const centerX = position.x + CELL_SIZE / 2;
    const layout = damageLayout.get(report.id)!;
    return (
      <g key={report.id}>
        {report.critical && (
          <text
            className="battle-critical-label"
            data-testid="battle-critical-label"
            data-grid-position={`${report.q},${report.r}`}
            x={centerX}
            y={layout.criticalY}
          >
            {report.label ?? '暴击'}
          </text>
        )}
        <text
          className={`battle-damage-number is-${report.kind}`}
          data-testid="battle-damage-number"
          data-grid-position={`${report.q},${report.r}`}
          x={centerX}
          y={layout.damageY}
        >
          -{report.amount.toLocaleString('en-US')}
        </text>
      </g>
    );
  };

  const renderStrategyResultLabel = (report: StrategyResultReport) => {
    if (report.succeeded) return null;
    const position = displayCellPosition(report.q, report.r);
    return (
      <text
        key={report.id}
        className="strategy-result-label"
        data-testid="strategy-result-label"
        data-grid-position={`${report.q},${report.r}`}
        x={position.x + CELL_SIZE / 2}
        y={Math.max(12, position.y - 31)}
      >
        {report.label || '计略失败'}
      </text>
    );
  };

  const renderFireMarker = (plot: FirePlot) => {
    const position = displayCellPosition(plot.q, plot.r);
    return (
      <text
        key={`fire-${plot.q}-${plot.r}`}
        className="fire-cell-marker"
        data-testid="fire-cell-marker"
        data-grid-position={`${plot.q},${plot.r}`}
        x={position.x + CELL_SIZE / 2}
        y={position.y + CELL_SIZE / 2 + 6}
      >
        火
      </text>
    );
  };

  const renderFacilityRepairNumber = (report: FacilityRepairReport) => {
    const position = displayCellPosition(report.q, report.r);
    const centerX = position.x + CELL_SIZE / 2;
    return (
      <text
        key={report.id}
        className={`facility-repair-number is-${report.kind}`}
        data-testid="facility-repair-number"
        x={centerX}
        y={Math.max(12, position.y - 31)}
      >
        +{report.amount.toLocaleString('en-US')}
      </text>
    );
  };

  return (
    <section
      className={`map-region${editorMode ? ' is-editing' : ''}`}
      aria-label="战略地图区域"
      data-testid="map-viewport"
      ref={regionRef}
      onWheel={handleWheel}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={stopDragging}
      onPointerCancel={stopDragging}
      onPointerLeave={() => { onCellHover?.(null); }}
      onContextMenu={handleContextMenu}
    >
      <div
        className="map-content"
        data-testid="map-content"
        data-view-x={view.x}
        data-view-y={view.y}
        style={{ '--map-scale': String(view.scale), '--cell-px': `${cellPx.toFixed(2)}px` } as CSSProperties}
      >
        {backgroundImage && (
          <img
            src={backgroundImage}
            alt=""
            className="map-image"
            data-testid="map-image"
            draggable={false}
            style={zoomStyle()}
          />
        )}
        <svg className={`battle-grid-overlay${editorMode ? ' is-editing' : ''}${deployMode ? ' is-deploying' : ''}${moveMode ? ' is-moving' : ''}${firePlotMode ? ' is-strategy-targeting' : ''}${constructionMode ? ' is-construction-targeting' : ''}`} data-testid="battle-grid-overlay" viewBox={`0 0 ${worldWidth} ${worldHeight}`} preserveAspectRatio="none" aria-hidden="true" style={zoomStyle()}>
          {cellsToRender.map((cell) => {
            const position = displayCellPosition(cell.q, cell.r);
            const cellKey = `${cell.q},${cell.r}`;
            // 关隘翼格：游戏视图下隐藏渲染（仅编辑器模式保留显示）
            if (!editorMode && cell.terrain === 'pass' && blockedPassKeys.has(cellKey)) return null;
            const isDeployTarget = deployTargetKeys.has(cellKey);
            const isMoveTarget = moveTargetKeys.has(cellKey);
            const isDelegatePath = delegatePathKeys.has(cellKey) && !isMoveTarget;
            const isFirePlotTarget = firePlotTargetKeys.has(cellKey);
            const isConstructionTarget = constructionTargetKeys.has(cellKey);
            const isSelectedDeployTarget = selectedDeployKey === cellKey;
            const isFacilityOccupied = facilityOccupiedKeys.has(cellKey);
            const cityIdAtCell = cityFootprintByKey.get(cellKey);
            const passAnchor = !editorMode ? passAt(state, cell) : undefined;
            return (
              <>
                <rect
                  key={`${cell.q},${cell.r}`}
                  data-testid={editorMode ? `editor-cell-${cell.q}-${cell.r}` : isConstructionTarget ? `construction-target-${cell.q}-${cell.r}` : isDeployTarget ? `deploy-target-${cell.q}-${cell.r}` : isMoveTarget ? `move-target-${cell.q}-${cell.r}` : isFirePlotTarget ? `strategy-target-${cell.q}-${cell.r}` : `map-cell-${cell.q}-${cell.r}`}
                  x={position.x}
                  y={position.y}
                  width={CELL_SIZE}
                  height={CELL_SIZE}
                  className={`battle-cell terrain-${cell.terrain}${isFacilityOccupied ? ' is-facility-occupied' : ''}${isDeployTarget ? ' is-deploy-target' : ''}${isMoveTarget ? ' is-move-target' : ''}${isDelegatePath ? ' is-delegate-path' : ''}${isFirePlotTarget ? ' is-strategy-target' : ''}${isConstructionTarget ? ' is-construction-target' : ''}${isSelectedDeployTarget ? ' is-selected-deploy-target' : ''}`}
                onPointerDown={(event) => {
                  if (event.button !== 0) return;
                  if (isConstructionTarget) {
                    event.stopPropagation();
                    onConstructionTargetSelect?.({ q: cell.q, r: cell.r }, { x: event.clientX + 12, y: event.clientY + 4 });
                    return;
                  }
                  if (isFirePlotTarget) {
                    event.stopPropagation();
                    onFirePlotTargetSelect?.({ q: cell.q, r: cell.r });
                    return;
                  }
                  if (isDeployTarget) {
                    event.stopPropagation();
                    onDeployTargetSelect?.({ q: cell.q, r: cell.r }, { x: event.clientX + 12, y: event.clientY + 4 });
                    return;
                  }
                  if (isMoveTarget) {
                    event.stopPropagation();
                    onMoveTargetSelect?.({ q: cell.q, r: cell.r }, { x: event.clientX + 12, y: event.clientY + 4 });
                    return;
                  }
                  // 出征部署中点击出征范围外的格：交给上层做超距出征委任（移动/设置）
                  if (deployDelegateMode && !editorMode) {
                    event.stopPropagation();
                    onDeployTargetSelect?.({ q: cell.q, r: cell.r }, { x: event.clientX + 12, y: event.clientY + 4 });
                    return;
                  }
                  // 选中部队时点击可移动范围外的格：交给上层做超距移动委任（移动/设置）
                  if (moveMode && !editorMode) {
                    event.stopPropagation();
                    onMoveTargetSelect?.({ q: cell.q, r: cell.r }, { x: event.clientX + 12, y: event.clientY + 4 });
                    return;
                  }
                  if (passAnchor) {
                    event.stopPropagation();
                    selectPassFromMap(passAnchor.id, { x: event.clientX + 12, y: event.clientY });
                    return;
                  }
                  if (cityIdAtCell) {
                    event.stopPropagation();
                    selectCityFromMap(cityIdAtCell, { x: event.clientX + 12, y: event.clientY });
                    return;
                  }
                  if (!editorMode) return;
                  event.stopPropagation();
                  onEditorCellPaint?.({ q: cell.q, r: cell.r });
                }}
                onPointerMove={(event) => {
                  // 编辑器模式下，按住左键拖动时连续刷地形：
                  // pointerenter 在快速拖动时可能跳格漏触发，pointermove 每次都在当前目标格上触发，更可靠
                  if (!editorMode || event.button !== 0 || event.buttons !== 1) return;
                  event.stopPropagation(); // 阻止冒泡到 map-region，避免干扰边缘自动滚动逻辑
                  onEditorCellPaint?.({ q: cell.q, r: cell.r });
                }}
                onContextMenu={(event) => {
                  if (!cityIdAtCell && !passAnchor) return;
                  dismissCityHover();
                  event.preventDefault();
                  event.stopPropagation();
                  if (passAnchor) {
                    dismissPassHover();
                    onPassInfoMenu?.(passAnchor.id, { x: event.clientX + 12, y: event.clientY });
                    return;
                  }
                  onMapContextClose?.();
                }}
                onPointerEnter={(event) => {
                  onCellHover?.(cell);
                  if (passAnchor) {
                    setHoveredPassId(passAnchor.id);
                    onPassHover?.(passAnchor.id, { x: event.clientX + 57, y: event.clientY + 47 });
                  }
                  if (cityIdAtCell) {
                    setHoveredCityId(cityIdAtCell);
                    onCityHover?.(cityIdAtCell, { x: event.clientX + 57, y: event.clientY + 47 });
                  }
                  if (!editorMode || event.buttons !== 1) return;
                  event.stopPropagation();
                  onEditorCellPaint?.({ q: cell.q, r: cell.r });
                }}
                onPointerLeave={() => {
                  if (passAnchor) {
                    setHoveredPassId(null);
                    onPassLeave?.();
                  }
                  if (cityIdAtCell) {
                    setHoveredCityId(null);
                    onCityLeave?.();
                  }
                }}
                />
                {/* 八角线层：四角微斜切的连续八角线；背景（上一格）保持方形（编辑器及实心地形隐藏） */}
                {!editorMode && !SOLID_TERRAIN.has(cell.terrain) && (
                  <polygon
                    key={`${cell.q},${cell.r}-outline`}
                    data-cell-outline={`${cell.q},${cell.r}`}
                    points={octagonPoints(position.x, position.y, CELL_SIZE, CELL_CORNER_CUT)}
                    className={`battle-cell-outline terrain-${cell.terrain}${isFacilityOccupied ? ' is-facility-occupied' : ''}${isDeployTarget ? ' is-deploy-target' : ''}${isMoveTarget ? ' is-move-target' : ''}${isDelegatePath ? ' is-delegate-path' : ''}${isFirePlotTarget ? ' is-strategy-target' : ''}${isConstructionTarget ? ' is-construction-target' : ''}${isSelectedDeployTarget ? ' is-selected-deploy-target' : ''}`}
                  />
                )}
              </>
            );
          })}
          {/* 建设用地设施覆盖层：显示已建成设施 / 建设中状态 */}
          {!editorMode && Object.values(state.cities).flatMap((city) =>
            (city.plots ?? []).map((plot, idx) => {
              if (!plot || plot.q == null || plot.r == null) return null;
              if (plot.type === 'empty' && !plot.constructing) return null;
              const position = displayCellPosition(plot.q, plot.r);
              const label = plot.constructing
                ? `建设中 ${plot.constructing.remainingTenDays}旬`
                : plot.type
                  ? `${PLOT_LABELS[plot.type]} Lv${plot.level}`
                  : null;
              if (!label) return null;
              const facilityLabel = plot.constructing
                ? PLOT_LABELS[plot.constructing.facility] ?? plot.type ?? '?'
                : (plot.type ? PLOT_LABELS[plot.type] : '?');
              const isAttackPlotTarget = attackTargetPlotKeys?.has(`${city.id}:${idx}`) ?? false;
              return (
                <g
                  key={`plot-${city.id}-${idx}`}
                  className={`construction-overlay${plot.constructing ? ' is-building' : ''}${isAttackPlotTarget ? ' is-attack-target' : ''}`}
                  data-testid="city-plot-overlay"
                  data-plot-id={plot.id}
                  onPointerDown={(event) => {
                    if (event.button !== 0) return;
                    // 火计目标：优先于地块菜单处理（否则覆盖层吞掉底层格子的瞄准点击）
                    if (plot.q != null && plot.r != null && firePlotTargetKeys.has(`${plot.q},${plot.r}`)) {
                      event.stopPropagation();
                      onFirePlotTargetSelect?.({ q: plot.q, r: plot.r });
                      return;
                    }
                    event.stopPropagation();
                    onCityPlotSelect?.(city.id, idx, { x: event.clientX + 12, y: event.clientY + 4 });
                  }}
                  onContextMenu={(event) => {
                    // 右键：关闭撤销菜单（左键打开）
                    event.preventDefault();
                    event.stopPropagation();
                    onFacilityMenuClose?.();
                  }}
                  onPointerEnter={(event) => {
                    onCityPlotHover?.(city.id, idx, { x: event.clientX + 57, y: event.clientY + 47 });
                  }}
                  onPointerLeave={() => {
                    onCityPlotLeave?.();
                  }}
                >
                  <rect x={position.x + 2} y={position.y + 2} width={CELL_SIZE - 4} height={CELL_SIZE - 4} rx={2} ry={2} fill="rgba(0,0,0,0.35)" stroke={plot.constructing ? '#ffb300' : '#d4b06a'} strokeWidth={1} />
                  <text x={position.x + CELL_SIZE / 2} y={position.y + CELL_SIZE / 2 - 3} textAnchor="middle" dominantBaseline="middle" fill={plot.constructing ? '#ffd842' : '#fff6d6'} fontSize={9} fontWeight={700}>{facilityLabel}</text>
                  {plot.constructing && (
                    <text x={position.x + CELL_SIZE / 2} y={position.y + CELL_SIZE / 2 + 8} textAnchor="middle" dominantBaseline="middle" fill="#ffe082" fontSize={8}>
                      {plot.constructing.remainingTenDays}
                    </text>
                  )}
                  {!plot.constructing && plot.level > 1 && (
                    <text x={position.x + CELL_SIZE - 6} y={position.y + CELL_SIZE - 5} textAnchor="middle" dominantBaseline="middle" fill="#ffd842" fontSize={8} fontWeight={700}>{plot.level}</text>
                  )}
                </g>
              );
            }).filter((x): x is NonNullable<typeof x> => x !== null)
          )}
          {/* 关隘单格色块：与城池 footprint 同色（无主=中性灰），使空关隘与空城池观感一致。
              必须与城池 footprint 一样可点击（className 自带 pointer-events:auto）：
              关隘标记是 pointer-events:none 的装饰层，锚点格又会被 moveMode 分支提前吞掉，
              所以这里就是关隘唯一的命中区域，少了它点击关隘会完全没反应。 */}
          {!editorMode && gridWidth === 200 && gridHeight === 200 && Object.values(state.passes ?? {}).map((pass) => {
            const force = pass.ownerId ? state.forces[pass.ownerId] : undefined;
            const position = displayCellPosition(pass.q, pass.r);
            const anchorKey = `${pass.q},${pass.r}`;
            const isAttackTarget = attackTargetPassIdSet.has(pass.id);
            return (
              <rect
                key={`pass-footprint-${pass.id}`}
                data-testid={`pass-footprint-${pass.id}`}
                data-pass-id={pass.id}
                x={position.x + 2}
                y={position.y + 2}
                width={CELL_SIZE - 4}
                height={CELL_SIZE - 4}
                className={`city-footprint-cell${force ? '' : ' is-neutral'}${isAttackTarget ? ' is-attack-target' : ''}`}
                style={{ '--force-color': force?.color ?? NEUTRAL_CITY_COLOR } as CSSProperties}
                onPointerDown={(event) => {
                  if (event.button !== 0) return;
                  event.stopPropagation();
                  // 火计目标优先（否则覆盖层吞掉对关隘格放火计的点击）
                  if (firePlotTargetKeys.has(anchorKey)) {
                    onFirePlotTargetSelect?.({ q: pass.q, r: pass.r });
                    return;
                  }
                  // 选中部队后进入攻击目标选择：点关隘即确认攻击
                  if (isAttackTarget) {
                    onAttackPassTargetSelect?.(pass.id);
                    return;
                  }
                  // 选中部队时点击可达的锚点格 → 回关/进驻
                  if (selectedUnitId && moveTargetKeys.has(anchorKey)) {
                    onMoveTargetSelect?.({ q: pass.q, r: pass.r }, { x: event.clientX + 12, y: event.clientY + 4 });
                    return;
                  }
                  // 选中部队时点击可达范围外的关隘 → 超距移动委任（与城池 footprint 一致）
                  if (selectedUnitId && moveMode) {
                    onMoveTargetSelect?.({ q: pass.q, r: pass.r }, { x: event.clientX + 12, y: event.clientY + 4 });
                    return;
                  }
                  // 出征部署中点击关隘格 → 超距出征委任
                  if (deployDelegateMode) {
                    onDeployTargetSelect?.({ q: pass.q, r: pass.r }, { x: event.clientX + 12, y: event.clientY + 4 });
                    return;
                  }
                  selectPassFromMap(pass.id, { x: event.clientX + 12, y: event.clientY });
                }}
                onContextMenu={(event) => {
                  dismissPassHover();
                  event.preventDefault();
                  event.stopPropagation();
                  onPassInfoMenu?.(pass.id, { x: event.clientX + 12, y: event.clientY });
                }}
                onPointerEnter={(event) => {
                  setHoveredPassId(pass.id);
                  onPassHover?.(pass.id, { x: event.clientX + 57, y: event.clientY + 47 });
                }}
                onPointerLeave={() => {
                  setHoveredPassId(null);
                  onPassLeave?.();
                }}
              />
            );
          })}
          {/* 编辑器：手动圈定的建设用地归属覆盖层 */}
          {editorMode && editorPlots?.map((plot) => {
            const position = displayCellPosition(plot.q, plot.r);
            const selected = plot.cityId === editorPlotCityId;
            return (
              <rect
                key={`editor-plot-${plot.cityId}-${plot.q}-${plot.r}`}
                data-testid="editor-plot-cell"
                data-plot-cell={`${plot.cityId}:${plot.q},${plot.r}`}
                x={position.x + 2}
                y={position.y + 2}
                width={CELL_SIZE - 4}
                height={CELL_SIZE - 4}
                className={`editor-plot-cell${selected ? ' is-selected' : ''}`}
              />
            );
          })}
          {displayCities.flatMap((city) => (
            sevenCellCityFootprint(city).map((coord) => {
              const position = displayCellPosition(coord.q, coord.r);
              const gameCity = editorMode ? undefined : state.cities[city.id as CityId];
              return (
                <rect
                  key={`${city.id}-${coord.q},${coord.r}`}
                  data-testid={gameCity ? `city-footprint-${gameCity.id}-${coord.q}-${coord.r}` : undefined}
                  data-city-id={gameCity?.id}
                  data-grid-position={`${coord.q},${coord.r}`}
                  x={position.x + 2}
                  y={position.y + 2}
                  width={CELL_SIZE - 4}
                  height={CELL_SIZE - 4}
                  className={`city-footprint-cell${gameCity && !gameCity.ownerId ? ' is-neutral' : ''}`}
                  style={{ '--force-color': city.forceColor } as CSSProperties}
                  onPointerDown={(event) => {
                    if (editorMode) {
                      // 编辑器：点击城址排不上号即选中该城（供建设用地圈地定位归属城）
                      if (event.button !== 0) return;
                      event.stopPropagation();
                      onEditorCellPaint?.({ q: city.q, r: city.r });
                      return;
                    }
                    if (!gameCity || event.button !== 0) return;
                    event.stopPropagation();
                    const footprintKey = `${coord.q},${coord.r}`;
                    // 火计目标：优先于移动回城/城池菜单（否则覆盖层吞掉对城池格放火计的点击）
                    if (firePlotTargetKeys.has(footprintKey)) {
                      onFirePlotTargetSelect?.({ q: coord.q, r: coord.r });
                      return;
                    }
                    // 选中部队时点击本方城池 footprint 内的可达格 → 回城，不弹城池菜单
                    if (selectedUnitId && moveTargetKeys.has(footprintKey)) {
                      onMoveTargetSelect?.({ q: coord.q, r: coord.r }, { x: event.clientX + 12, y: event.clientY + 4 });
                      return;
                    }
                    // 选中部队时点击可移动范围外的城池格 → 超距移动委任（移动/设置）
                    if (selectedUnitId && moveMode) {
                      onMoveTargetSelect?.({ q: coord.q, r: coord.r }, { x: event.clientX + 12, y: event.clientY + 4 });
                      return;
                    }
                    // 出征部署中点击出征范围外的城池格 → 超距出征委任（移动/设置）
                    if (deployDelegateMode && !deployTargetKeys.has(footprintKey)) {
                      onDeployTargetSelect?.({ q: coord.q, r: coord.r }, { x: event.clientX + 12, y: event.clientY + 4 });
                      return;
                    }
                    selectCityFromMap(gameCity.id, { x: event.clientX + 12, y: event.clientY });
                  }}
                  onContextMenu={(event) => {
                    if (!gameCity) return;
                    event.preventDefault();
                    event.stopPropagation();
                    onCityInfoMenu?.(gameCity.id, { x: event.clientX + 12, y: event.clientY });
                  }}
                  onPointerEnter={(event) => {
                    if (!gameCity) return;
                    setHoveredCityId(gameCity.id);
                    onCityHover?.(gameCity.id, { x: event.clientX + 57, y: event.clientY + 47 });
                  }}
                  onPointerLeave={() => {
                    if (!gameCity) return;
                    setHoveredCityId(null);
                    onCityLeave?.();
                  }}
                />
              );
            })
          ))}
          {/* 编辑器模式：关隘标记只占 1 格（区别于城池的 7 格 footprint） */}
          {displayEditorPasses.map((pass) => {
            const position = displayCellPosition(pass.q, pass.r);
            return (
              <rect
                key={`editor-pass-${pass.id}`}
                data-testid="editor-pass-footprint"
                x={position.x + 2}
                y={position.y + 2}
                width={CELL_SIZE - 4}
                height={CELL_SIZE - 4}
                className="pass-footprint-cell"
                style={{ '--force-color': pass.forceColor } as CSSProperties}
                onPointerDown={(event) => { event.stopPropagation(); event.preventDefault(); }}
              />
            );
          })}
          {facilityRangeCells.map((coord) => {
            const position = displayCellPosition(coord.q, coord.r);
            return (
              <rect
                key={`facility-range-${coord.q}-${coord.r}`}
                data-testid="facility-range-cell"
                data-range-position={`${coord.q},${coord.r}`}
                id={`facility-range-${coord.q}-${coord.r}`}
                x={position.x}
                y={position.y}
                width={CELL_SIZE}
                height={CELL_SIZE}
                className="facility-range-cell"
              />
            );
          })}
          {/* 城池攻击范围呼吸闪烁覆盖层（鼠标悬停城池时显示） */}
          {cityAttackRangeCells.map((coord) => {
            const position = displayCellPosition(coord.q, coord.r);
            return (
              <rect
                key={`city-attack-range-${coord.q}-${coord.r}`}
                data-testid="city-attack-range-cell"
                data-city-attack-position={`${coord.q},${coord.r}`}
                x={position.x}
                y={position.y}
                width={CELL_SIZE}
                height={CELL_SIZE}
                className="city-attack-range-cell"
              />
            );
          })}
          {/* 关隘攻击范围呼吸闪烁覆盖层（鼠标悬停关隘时显示） */}
          {passAttackRangeCells.map((coord) => {
            const position = displayCellPosition(coord.q, coord.r);
            return (
              <rect
                key={`pass-attack-range-${coord.q}-${coord.r}`}
                data-testid="pass-attack-range-cell"
                data-pass-attack-position={`${coord.q},${coord.r}`}
                x={position.x}
                y={position.y}
                width={CELL_SIZE}
                height={CELL_SIZE}
                className="city-attack-range-cell"
              />
            );
          })}
          {/* 部队光环范围呼吸闪烁覆盖层（鼠标悬停部队时显示） */}
          {unitAuraRangeCells.map((coord) => {
            const position = displayCellPosition(coord.q, coord.r);
            return (
              <rect
                key={`unit-aura-${coord.q}-${coord.r}`}
                data-testid="unit-aura-cell"
                data-aura-position={`${coord.q},${coord.r}`}
                x={position.x}
                y={position.y}
                width={CELL_SIZE}
                height={CELL_SIZE}
                className="unit-aura-cell"
              />
            );
          })}
          {Object.values(state.facilities ?? {}).map((facility) => {
            const position = displayCellPosition(facility.q, facility.r);
            const isFacilityTarget = attackTargetFacilityIdSet.has(facility.id);
            const isFirePlotTarget = firePlotTargetKeys.has(`${facility.q},${facility.r}`);
            const isCompleted = facility.completed !== false;
            const usesForceBackground = FORCE_COLORED_FACILITIES.has(facility.type);
            const ownerColor = state.forces[facility.forceId]?.color ?? '#f6e7a6';
            return (
              <g
                key={facility.id}
                data-facility-id={facility.id}
                data-facility-type={facility.type}
                data-grid-position={`${facility.q},${facility.r}`}
                className={`battle-facility${isFacilityTarget ? ' is-attack-target' : ''}${isFirePlotTarget ? ' is-strategy-target' : ''}${!isCompleted ? ' is-under-construction' : ''}`}
                onPointerDown={(event) => {
                  if (event.button !== 0) return;
                  event.stopPropagation();
                  if (isFirePlotTarget) {
                    onFirePlotTargetSelect?.({ q: facility.q, r: facility.r });
                    return;
                  }
                  if (isFacilityTarget) {
                    onFacilityTargetSelect?.(facility.id);
                    return;
                  }
                  // 移动模式下点击未完成的己方军事设施：交给上层询问是否委任修补（优先于打开设施菜单）
                  if (moveMode && selectedUnitId && !isCompleted && state && facility.forceId === state.playerForceId) {
                    onFacilityRepairPrompt?.(facility.id, { x: event.clientX + 10, y: event.clientY + 4 });
                    return;
                  }
                  onFacilityContextMenu?.(facility.id, { x: event.clientX + 10, y: event.clientY + 4 });
                }}
                onContextMenu={(event) => {
                  // 右键：关闭撤销菜单（左键打开）
                  event.preventDefault();
                  event.stopPropagation();
                  onFacilityMenuClose?.();
                }}
                onPointerEnter={(event) => {
                  setHoveredFacilityId(facility.id);
                  onFacilityHover?.(facility.id, { x: event.clientX + 57, y: event.clientY + 47 });
                }}
                onPointerLeave={() => {
                  setHoveredFacilityId((current) => current === facility.id ? null : current);
                  onFacilityLeave?.();
                }}
              >
                <rect
                  x={position.x}
                  y={position.y}
                  width={CELL_SIZE}
                  height={CELL_SIZE}
                  className={`battle-facility-hit battle-facility-background${usesForceBackground ? ' is-force-colored' : ''}`}
                  data-testid="battle-facility-background"
                  data-facility-id={facility.id}
                  data-facility-type={facility.type}
                  style={usesForceBackground ? { '--force-color': ownerColor } as CSSProperties : undefined}
                />
                <text
                  className={`battle-facility-marker facility-${facility.type}`}
                  data-testid="battle-facility-marker"
                  data-facility-id={facility.id}
                  data-facility-type={facility.type}
                  data-grid-position={`${facility.q},${facility.r}`}
                  x={position.x + CELL_SIZE / 2}
                  y={position.y + CELL_SIZE / 2 + 6}
                >
                  {FACILITY_GLYPHS[facility.type]}
                </text>
                {isFacilityTarget && (
                  <text className="attack-target-arrow" data-testid="attack-facility-target-arrow" x={position.x + CELL_SIZE / 2} y={Math.max(12, position.y - 18)}>鈻?</text>
                )}
                {!isCompleted && (
                  <text
                    className="facility-construction-label"
                    data-testid="facility-construction-label"
                    x={position.x + CELL_SIZE - 2}
                    y={position.y + 10}
                  >
                    建设中
                  </text>
                )}
              </g>
            );
          })}
          {facilityRepairReports.map(renderFacilityRepairNumber)}
        </svg>
        <div className={`city-marker-layer${editorMode || deployMode || moveMode ? ' is-editing' : ''}`} aria-label="荆襄城市" style={zoomStyle()}>
          {/* 原版关所锚点（china42x 200×200 全图；单格据点；标示牌与城池一致，无都市段） */}
          {gridWidth === 200 && gridHeight === 200 && Object.values(state.passes ?? {}).map((pass) => {
            const force = pass.ownerId ? state.forces[pass.ownerId] : undefined;
            const isAttackTarget = attackTargetPassIdSet.has(pass.id);
            const markerPosition = displayCellCenterPercent(pass.q, pass.r);
            const passEffect = cityEffectReports.find((report) => report.passId === pass.id);
            return (
              <button
                key={pass.id}
                type="button"
                className={`city-marker${isAttackTarget ? ' is-attack-target' : ''}`}
                style={{
                  left: `${markerPosition.left}%`,
                  top: `${markerPosition.top}%`,
                  '--force-color': force?.color ?? NEUTRAL_CITY_COLOR,
                } as CSSProperties}
                aria-label={`${pass.name} ${force?.name ?? '无主'} ${pass.troops.toLocaleString('en-US')}兵 ${pass.population.toLocaleString('en-US')}人`}
                data-testid="pass-marker"
                onContextMenu={(event) => {
                  dismissPassHover();
                  event.preventDefault();
                  event.stopPropagation();
                  onPassInfoMenu?.(pass.id, { x: event.clientX + 12, y: event.clientY });
                }}
                onClick={(event) => {
                  // 选中部队时点关隘：锚点格可达则优先回关/进驻（与城池标记一致）。
                  // 敌方关隘锚点不在 moveTargets 内，仍走 selectPassFromMap。
                  if (selectedUnitId && moveTargetKeys.has(`${pass.q},${pass.r}`)) {
                    onMoveTargetSelect?.({ q: pass.q, r: pass.r }, { x: event.clientX + 12, y: event.clientY + 4 });
                    return;
                  }
                  selectPassFromMap(pass.id, { x: event.clientX + 12, y: event.clientY });
                }}
                onPointerEnter={(event) => {
                  setHoveredPassId(pass.id);
                  onPassHover?.(pass.id, { x: event.clientX + 57, y: event.clientY + 47 });
                }}
                onPointerLeave={() => {
                  setHoveredPassId(null);
                  onPassLeave?.();
                }}
                onMouseEnter={(event) => {
                  setHoveredPassId(pass.id);
                  onPassHover?.(pass.id, { x: event.clientX + 57, y: event.clientY + 47 });
                }}
                onMouseLeave={() => {
                  setHoveredPassId(null);
                  onPassLeave?.();
                }}
              >
                {passEffect && (
                  <span className={`city-effect-number is-${passEffect.kind}`} data-testid="pass-effect-number">
                    {passEffect.label} +{passEffect.amount.toLocaleString('en-US')}
                  </span>
                )}
                <span className="city-marker-copy">
                  {isAttackTarget && <span className="city-attack-target-arrow" data-testid="attack-pass-target-arrow">▼</span>}
                  <strong>{pass.name}</strong>
                  <span className="city-marker-stats" aria-hidden="true">
                    <span className="city-marker-stat" data-testid="pass-marker-troops">{pass.troops}</span>
                    <span className="city-marker-stat-divider" data-testid="pass-marker-stat-divider" />
                    <span className="city-marker-stat" data-testid="pass-marker-population">{pass.population}</span>
                  </span>
                </span>
              </button>
            );
          })}
          {Object.values(state.cities).map((city) => {
            const force = city.ownerId ? state.forces[city.ownerId] : undefined;
            const selected = selectedCityId === city.id;
            const isAttackTarget = attackTargetCityIdSet.has(city.id);
            const markerPosition = displayCellCenterPercent(city.gridQ, city.gridR);
            const cityEffect = cityEffectReports.find((report) => report.cityId === city.id && !report.passId);
            return (
              <button
                key={city.id}
                type="button"
                className={`city-marker${selected ? ' is-selected' : ''}${isAttackTarget ? ' is-attack-target' : ''}`}
                style={{
                  left: `${markerPosition.left}%`,
                  top: `${markerPosition.top}%`,
                  '--force-color': force?.color ?? NEUTRAL_CITY_COLOR,
                } as CSSProperties}
                aria-label={`${city.name} ${force?.name ?? '无主'} ${city.troops.toLocaleString('en-US')}兵 ${city.population.toLocaleString('en-US')}人`}
                data-testid="city-marker"
                onContextMenu={(event) => {
                  dismissCityHover();
                  event.preventDefault();
                  event.stopPropagation();
                  onCityInfoMenu?.(city.id, { x: event.clientX + 12, y: event.clientY });
                }}
                onClick={(event) => {
                  // 选中部队时点本方城池：优先回城（footprint 内任一可达格，含中心格）
                  if (selectedUnitId) {
                    const footprint = sevenCellCityFootprint({ q: city.gridQ, r: city.gridR });
                    const reachable = footprint.find((coord) => moveTargetKeys.has(`${coord.q},${coord.r}`));
                    if (reachable) {
                      onMoveTargetSelect?.(reachable, { x: event.clientX + 12, y: event.clientY + 4 });
                      return;
                    }
                  }
                  // 出征部署中点击城池（出征范围外）→ 超距出征委任（移动/设置）
                  if (deployDelegateMode && !deployTargetKeys.has(`${city.gridQ},${city.gridR}`)) {
                    onDeployTargetSelect?.({ q: city.gridQ, r: city.gridR }, { x: event.clientX + 12, y: event.clientY + 4 });
                    return;
                  }
                  selectCityFromMap(city.id, { x: event.clientX + 12, y: event.clientY });
                }}
                onPointerEnter={(event) => onCityHover?.(city.id, { x: event.clientX + 57, y: event.clientY + 47 })}
                onPointerLeave={() => onCityLeave?.()}
                onMouseEnter={(event) => onCityHover?.(city.id, { x: event.clientX + 57, y: event.clientY + 47 })}
                onMouseLeave={() => onCityLeave?.()}
              >
                {cityEffect && (
                  <span className={`city-effect-number is-${cityEffect.kind}`} data-testid="city-effect-number">
                    {cityEffect.label} +{cityEffect.amount.toLocaleString('en-US')}
                  </span>
                )}
                <span className="city-marker-copy">
                  {isAttackTarget && <span className="city-attack-target-arrow" data-testid="attack-city-target-arrow">▼</span>}
                  <strong>{city.name}</strong>
                  <span className="city-marker-stats" aria-hidden="true">
                    <span className="city-marker-stat" data-testid="city-marker-troops">{city.troops}</span>
                    <span className="city-marker-stat-divider" data-testid="city-marker-stat-divider" />
                    <span className="city-marker-stat" data-testid="city-marker-population">{city.population}</span>
                  </span>
                </span>
              </button>
            );
          })}
        </div>
        <svg className="battle-unit-layer" data-testid="battle-unit-layer" viewBox={`0 0 ${worldWidth} ${worldHeight}`} preserveAspectRatio="none" aria-label="战场部队" style={zoomStyle()}>
          {previewUnits.map((unit) => renderUnitMarker(unit, true))}
          {Object.values(state.units).map((unit) => renderUnitMarker(unit))}
          {firePlots.map(renderFireMarker)}
          {damageReports.map(renderDamageNumber)}
          {strategyResultReports.map(renderStrategyResultLabel)}
        </svg>
      </div>

      <div className="map-tools tool-panel" aria-label="地图工具">
        <button type="button" className="icon-button" aria-label="放大地图" title="放大地图" onClick={() => zoom(1)}><ZoomIn /></button>
        <button type="button" className="icon-button" aria-label="缩小地图" title="缩小地图" onClick={() => zoom(-1)}><ZoomOut /></button>
        <button type="button" className="icon-button" aria-label="复位地图" title="复位地图" onClick={() => setView(resetView())}><Maximize2 /></button>
      </div>

      <div
        className="mini-map tool-panel"
        aria-label="荆襄小地图"
        data-testid="mini-map"
        style={{ aspectRatio: `${gridWidth} / ${gridHeight}` }}
        onPointerDown={(event) => {
          // 小地图上的按压只用于镜头跳转，不触发主地图拖拽/其他地图操作
          event.stopPropagation();
          if (event.button !== 0) return;
          if (freezeViewRef.current) return; // 右键菜单打开时冻结，禁止镜头跳转
          const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
          if (rect.width <= 0 || rect.height <= 0) return;
          const fx = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
          const fy = Math.min(1, Math.max(0, (event.clientY - rect.top) / rect.height));
          moveCameraToMapFraction(fx, fy);
        }}
      >
        {miniMapThumb && (
          <img
            src={miniMapThumb}
            alt=""
            className={`mini-map-thumb${perspectiveRotated ? ' is-rotated' : ''}`}
            data-testid="mini-map-thumb"
            draggable={false}
            aria-hidden="true"
          />
        )}
        {gridWidth === 200 && gridHeight === 200 && PASS_ANCHORS.map((pass) => {
          const runtimePass = state.passes?.[pass.id as PassId];
          const force = runtimePass?.ownerId ? state.forces[runtimePass.ownerId] : undefined;
          return (
            <span
              key={pass.id}
              className="mini-pass-dot"
              style={{
                left: `${(perspectiveRotated ? 1 - (pass.q + 0.5) / gridWidth : (pass.q + 0.5) / gridWidth) * 100}%`,
                top: `${(pass.r + 0.5) / gridHeight * 100}%`,
                backgroundColor: force?.color ?? NEUTRAL_CITY_COLOR,
              }}
              aria-hidden="true"
            />
          );
        })}
        {Object.values(state.cities).map((city) => (
          <span
            key={city.id}
            className={`mini-city-dot${selectedCityId === city.id ? ' is-selected' : ''}`}
            style={{
              left: `${(perspectiveRotated ? 1 - city.mapX : city.mapX) * 100}%`,
              top: `${city.mapY * 100}%`,
              backgroundColor: (city.ownerId ? state.forces[city.ownerId]?.color : undefined) ?? NEUTRAL_CITY_COLOR,
            }}
            aria-hidden="true"
          />
        ))}
      </div>
    </section>
  );
}
