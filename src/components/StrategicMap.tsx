import { Maximize2, ZoomIn, ZoomOut } from 'lucide-react';
import { useEffect, useRef, useState, type CSSProperties, type MouseEvent, type PointerEvent, type WheelEvent } from 'react';
import { unitIsIncapacitated } from '../game/battle/actions';
import { coordsWithinRange, gridKey, sevenCellCityFootprint, type GridCoord } from '../game/battle/grid';
import { GRID_HEIGHT as DEFAULT_GRID_HEIGHT, GRID_WIDTH as DEFAULT_GRID_WIDTH } from '../game/battle/scenario';
import type { EditableCityMarker } from '../game/map-editor/editor';
import { useGame } from '../game/store/GameProvider';
import type { ArmyUnit, BattleDamageReport, CityEffectReport, CityId, FacilityRepairReport, FacilityType, FirePlot, GridCell, StrategyResultReport, TroopType } from '../game/types';

interface MapView {
  x: number;
  y: number;
  scale: number;
}

// 缩放范围按横向可见格数定义：最高角度视野约 30 格，最低角度约 11 格
const FARTHEST_VISIBLE_CELLS = 30;
const NEAREST_VISIBLE_CELLS = 11;
// 每次缩放的倍率（视野格数按此比例增减）
const ZOOM_FACTOR = 1.2;
const CELL_SIZE = 43;
// 垂直（行）方向裁剪保留的行缓冲：水平方向按用户诉求精确到 30 格，纵向仅保留少量余量，防止边缘取整缺格
const ROW_CULL_BUFFER = 3;
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
  backgroundImage?: string;
  editorGrid?: GridCell[];
  editorCities?: EditableCityMarker[];
  editorMode?: boolean;
  onEditorCellPaint?(coord: GridCoord): void;
  deployTargets?: GridCoord[];
  selectedDeployTarget?: GridCoord | null;
  onDeployTargetSelect?(coord: GridCoord, position: { x: number; y: number }): void;
  moveTargets?: GridCoord[];
  firePlotTargets?: GridCoord[];
  firePlots?: FirePlot[];
  attackTargetCityIds?: CityId[];
  attackTargetFacilityIds?: string[];
  attackTargetUnitIds?: string[];
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
  onFacilityTargetSelect?(facilityId: string): void;
  onFacilityContextMenu?(facilityId: string, position: { x: number; y: number }): void;
  onFacilityHover?(facilityId: string, position: { x: number; y: number }): void;
  onFacilityLeave?(): void;
  onMapContextMenu?(position: { x: number; y: number }): void;
  onMapContextClose?(): void;
}

export function StrategicMap({
  backgroundImage,
  deployTargets = [],
  editorCities,
  editorGrid,
  editorMode = false,
  firePlotTargets = [],
  firePlots = [],
  moveTargets = [],
  attackTargetCityIds = [],
  attackTargetFacilityIds = [],
  attackTargetUnitIds = [],
  damageReports = [],
  strategyResultReports = [],
  cityEffectReports = [],
  facilityRepairReports = [],
  onCityMenu,
  onCellHover,
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
  onFacilityTargetSelect,
  onFacilityContextMenu,
  onFacilityHover,
  onFacilityLeave,
  selectedDeployTarget,
  selectedUnitId,
}: StrategicMapProps) {
  const { state, selectedCityId, selectCity } = useGame();
  const [view, setView] = useState<MapView>(() => ({
    x: 0,
    y: 0,
    scale: Math.round(((state?.gridWidth ?? DEFAULT_GRID_WIDTH) / FARTHEST_VISIBLE_CELLS) * 100) / 100,
  }));
  const [hoveredFacilityId, setHoveredFacilityId] = useState<string | null>(null);
  const [viewport, setViewport] = useState<{ width: number; height: number } | null>(null);
  const drag = useRef<{ pointerId: number; x: number; y: number } | null>(null);
  const regionRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const region = regionRef.current;
    if (!region || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setViewport({ width: entry.contentRect.width, height: entry.contentRect.height });
      }
    });
    observer.observe(region);
    return () => observer.disconnect();
  }, []);

  if (!state) return null;

  const gridWidth = state.gridWidth ?? DEFAULT_GRID_WIDTH;
  const gridHeight = state.gridHeight ?? DEFAULT_GRID_HEIGHT;
  const worldWidth = gridWidth * CELL_SIZE;
  const worldHeight = gridHeight * CELL_SIZE;
  // 视野格数 = gridWidth / scale：最高角度约 30 格（scale 小），最低角度约 11 格（scale 大）
  const minScale = gridWidth / FARTHEST_VISIBLE_CELLS;
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
  const localCity = Object.values(state.cities).find((city) => city.ownerId === state.playerForceId);
  const opponentCity = Object.values(state.cities).find((city) => city.ownerId !== state.playerForceId);
  const perspectiveRotated = state.scenarioId === 'mobile-duel' && Boolean(
    localCity && opponentCity && localCity.gridR < opponentCity.gridR,
  );
  const displayCellPosition = (q: number, r: number) => {
    const position = cellPosition(q, r);
    return perspectiveRotated
      ? { x: worldWidth - position.x - CELL_SIZE, y: worldHeight - position.y - CELL_SIZE }
      : position;
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
      { ...current, scale: clampScale(current.scale * (direction > 0 ? ZOOM_FACTOR : 1 / ZOOM_FACTOR)) }
    ));
  };

  const handleWheel = (event: WheelEvent<HTMLDivElement>) => {
    event.preventDefault();
    zoom(event.deltaY < 0 ? 1 : -1);
  };

  const handleContextMenu = (event: MouseEvent<HTMLDivElement>) => {
    if ((event.target as HTMLElement).closest('button')) return;
    event.preventDefault();
    onMapContextMenu?.({ x: event.clientX + 10, y: event.clientY + 4 });
  };

  const handlePointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if ((event.target as HTMLElement).closest('button')) return;
    if (event.button !== 0) return;
    drag.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY };
    event.currentTarget.setPointerCapture?.(event.pointerId);
  };

  const handlePointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (!drag.current || drag.current.pointerId !== event.pointerId) return;
    const dx = event.clientX - drag.current.x;
    const dy = event.clientY - drag.current.y;
    drag.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY };
    setView((current) => ({ ...current, x: current.x + dx, y: current.y + dy }));
  };

  const stopDragging = (event: PointerEvent<HTMLDivElement>) => {
    if (drag.current?.pointerId === event.pointerId) drag.current = null;
  };

  const displayGrid = editorGrid ?? state.grid;
  const displayCities = editorMode
    ? (editorCities ?? []).map((city) => ({ ...city, forceColor: '#d1b943' }))
    : Object.values(state.cities).map((city) => ({
      id: city.id,
      label: city.name,
      q: city.gridQ,
      r: city.gridR,
      forceColor: state.forces[city.ownerId].color,
    }));

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
  const firePlotTargetKeys = new Set(firePlotTargets.map((coord) => `${coord.q},${coord.r}`));
  const attackTargetCityIdSet = new Set(attackTargetCityIds);
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
  const moveMode = moveTargetKeys.size > 0;
  const firePlotMode = firePlotTargetKeys.size > 0;
  const renderTerrain = renderTerrainByScale;
  // 全图视图下地形格子不渲染时，模式目标格子（部署/移动/火计）仍需独立渲染，否则玩家无法看到可点击目标
  const modeTargetCells = !renderTerrain && (deployMode || moveMode || firePlotMode)
    ? (() => {
        const cellByKey = new Map(displayGrid.map((cell) => [gridKey(cell), cell]));
        const seen = new Set<string>();
        const cells: GridCell[] = [];
        for (const coord of [...deployTargets, ...moveTargets, ...firePlotTargets]) {
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
  const dismissUnitHover = () => onUnitLeave?.();
  const dismissCityHover = () => onCityLeave?.();
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
  const renderUnitMarker = (unit: ArmyUnit) => {
    const position = displayCellPosition(unit.q, unit.r);
    const leaderName = state.officers[unit.leaderId]?.name ?? '';
    const troopType = unit.troopType ?? 'sword';
    const unitKind = unit.kind ?? 'combat';
    const vehicle = unit.vehicle;
    const terrain = state.grid.find((cell) => cell.q === unit.q && cell.r === unit.r)?.terrain;
    const onWater = terrain === 'water';
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
        data-testid="battle-unit-marker"
        data-grid-position={`${unit.q},${unit.r}`}
        data-troop-type={troopType}
        data-unit-kind={unitKind}
        data-vehicle={onWater ? (vehicle ?? undefined) : undefined}
        data-force-id={unit.forceId}
        data-unit-status={statusFlags || undefined}
        className={`battle-unit-marker troop-${troopType} unit-${unitKind}${onWater && vehicle ? ` vehicle-${vehicle}` : ''}${selectedUnitId === unit.id ? ' is-selected' : ''}${statusFlags ? ' has-status' : ''}`}
        style={{ '--force-color': forceColor } as CSSProperties}
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
        onPointerEnter={(event) => onUnitHover?.(unit.id, { x: event.clientX + 57, y: event.clientY + 47 })}
        onPointerLeave={() => onUnitLeave?.()}
      >
        <text
          className="battle-unit-leader-name"
          x={centerX}
          y={Math.max(12, position.y - 5)}
        >
          {leaderName}
        </text>
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
        {canActThisTurn && (
          <text className="battle-unit-ready-badge" data-testid="battle-unit-ready-badge" x={centerX + 17} y={centerY - 15}>未</text>
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
      onPointerLeave={() => onCellHover?.(null)}
      onContextMenu={handleContextMenu}
    >
      <div
        className="map-content"
        data-testid="map-content"
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
        <svg className={`battle-grid-overlay${editorMode ? ' is-editing' : ''}${deployMode ? ' is-deploying' : ''}${moveMode ? ' is-moving' : ''}${firePlotMode ? ' is-strategy-targeting' : ''}`} data-testid="battle-grid-overlay" viewBox={`0 0 ${worldWidth} ${worldHeight}`} preserveAspectRatio="none" aria-hidden="true" style={zoomStyle()}>
          {cellsToRender.map((cell) => {
            const position = displayCellPosition(cell.q, cell.r);
            const cellKey = `${cell.q},${cell.r}`;
            const isDeployTarget = deployTargetKeys.has(cellKey);
            const isMoveTarget = moveTargetKeys.has(cellKey);
            const isFirePlotTarget = firePlotTargetKeys.has(cellKey);
            const isSelectedDeployTarget = selectedDeployKey === cellKey;
            const isFacilityOccupied = facilityOccupiedKeys.has(cellKey);
            const cityIdAtCell = cityFootprintByKey.get(cellKey);
            return (
              <rect
                key={`${cell.q},${cell.r}`}
                data-testid={editorMode ? `editor-cell-${cell.q}-${cell.r}` : isDeployTarget ? `deploy-target-${cell.q}-${cell.r}` : isMoveTarget ? `move-target-${cell.q}-${cell.r}` : isFirePlotTarget ? `strategy-target-${cell.q}-${cell.r}` : `map-cell-${cell.q}-${cell.r}`}
                x={position.x}
                y={position.y}
                width={CELL_SIZE}
                height={CELL_SIZE}
                className={`battle-cell terrain-${cell.terrain}${isFacilityOccupied ? ' is-facility-occupied' : ''}${isDeployTarget ? ' is-deploy-target' : ''}${isMoveTarget ? ' is-move-target' : ''}${isFirePlotTarget ? ' is-strategy-target' : ''}${isSelectedDeployTarget ? ' is-selected-deploy-target' : ''}`}
                onPointerDown={(event) => {
                  if (event.button !== 0) return;
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
                  if (cityIdAtCell) {
                    event.stopPropagation();
                    selectCityFromMap(cityIdAtCell, { x: event.clientX + 12, y: event.clientY });
                    return;
                  }
                  if (!editorMode) return;
                  event.stopPropagation();
                  onEditorCellPaint?.({ q: cell.q, r: cell.r });
                }}
                onContextMenu={(event) => {
                  if (!cityIdAtCell) return;
                  dismissCityHover();
                  event.preventDefault();
                  event.stopPropagation();
                  onMapContextClose?.();
                }}
                onPointerEnter={(event) => {
                  onCellHover?.(cell);
                  if (cityIdAtCell) {
                    onCityHover?.(cityIdAtCell, { x: event.clientX + 57, y: event.clientY + 47 });
                  }
                  if (!editorMode || event.buttons !== 1) return;
                  event.stopPropagation();
                  onEditorCellPaint?.({ q: cell.q, r: cell.r });
                }}
                onPointerLeave={() => {
                  if (cityIdAtCell) onCityLeave?.();
                }}
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
                  className="city-footprint-cell"
                  style={{ '--force-color': city.forceColor } as CSSProperties}
                  onPointerDown={(event) => {
                    if (!gameCity || event.button !== 0) return;
                    event.stopPropagation();
                    selectCityFromMap(gameCity.id, { x: event.clientX + 12, y: event.clientY });
                  }}
                  onContextMenu={(event) => {
                    if (!gameCity) return;
                    dismissCityHover();
                    event.preventDefault();
                    event.stopPropagation();
                    onMapContextClose?.();
                  }}
                  onPointerEnter={(event) => {
                    if (!gameCity) return;
                    onCityHover?.(gameCity.id, { x: event.clientX + 57, y: event.clientY + 47 });
                  }}
                  onPointerLeave={() => {
                    if (!gameCity) return;
                    onCityLeave?.();
                  }}
                />
              );
            })
          ))}
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
                  }
                }}
                onContextMenu={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  onFacilityContextMenu?.(facility.id, { x: event.clientX + 10, y: event.clientY + 4 });
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
          {Object.values(state.cities).map((city) => {
            const force = state.forces[city.ownerId];
            const selected = selectedCityId === city.id;
            const isAttackTarget = attackTargetCityIdSet.has(city.id);
            const markerPosition = displayCellCenterPercent(city.gridQ, city.gridR);
            const cityEffect = cityEffectReports.find((report) => report.cityId === city.id);
            return (
              <button
                key={city.id}
                type="button"
                className={`city-marker${selected ? ' is-selected' : ''}${isAttackTarget ? ' is-attack-target' : ''}`}
                style={{
                  left: `${markerPosition.left}%`,
                  top: `${markerPosition.top}%`,
                  '--force-color': force.color,
                } as CSSProperties}
                aria-label={`${city.name} ${force.name} ${city.troops.toLocaleString('en-US')}兵 ${city.population.toLocaleString('en-US')}人`}
                data-testid="city-marker"
                onContextMenu={(event) => {
                  dismissCityHover();
                  event.preventDefault();
                  event.stopPropagation();
                  onMapContextClose?.();
                }}
                onClick={(event) => {
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
          {Object.values(state.units).map(renderUnitMarker)}
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

      <div className="mini-map tool-panel" aria-label="荆襄小地图">
        {Object.values(state.cities).map((city) => (
          <button
            key={city.id}
            type="button"
            className={selectedCityId === city.id ? 'is-selected' : ''}
            style={{
              left: `${(perspectiveRotated ? 1 - city.mapX : city.mapX) * 100}%`,
              top: `${(perspectiveRotated ? 1 - city.mapY : city.mapY) * 100}%`,
              backgroundColor: state.forces[city.ownerId].color,
            }}
            aria-label={`在小地图选择${city.name}`}
            onClick={() => selectCity(city.id)}
          />
        ))}
      </div>
    </section>
  );
}
