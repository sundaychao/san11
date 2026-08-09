import { Maximize2, ZoomIn, ZoomOut } from 'lucide-react';
import { useRef, useState, type CSSProperties, type MouseEvent, type PointerEvent, type WheelEvent } from 'react';
import { sevenCellCityFootprint, type GridCoord } from '../game/battle/grid';
import { GRID_HEIGHT, GRID_WIDTH } from '../game/battle/scenario';
import type { EditableCityMarker } from '../game/map-editor/editor';
import { useGame } from '../game/store/GameProvider';
import type { ArmyUnit, BattleDamageReport, CityEffectReport, CityId, GridCell, TroopType } from '../game/types';

interface MapView {
  x: number;
  y: number;
  scale: number;
}

const INITIAL_VIEW: MapView = { x: 0, y: 0, scale: 1 };
const CELL_SIZE = 43;
const WORLD_WIDTH = GRID_WIDTH * CELL_SIZE;
const WORLD_HEIGHT = GRID_HEIGHT * CELL_SIZE;
const TROOP_TEXTURES: Record<TroopType, { glyph: string; label: string }> = {
  sword: { glyph: '剑', label: '剑兵' },
  spear: { glyph: '枪', label: '枪兵' },
  halberd: { glyph: '戟', label: '戟兵' },
  crossbow: { glyph: '弩', label: '弩兵' },
  cavalry: { glyph: '骑', label: '骑兵' },
  siege: { glyph: '械', label: '兵器' },
};

function cellPosition(q: number, r: number) {
  return {
    x: q * CELL_SIZE,
    y: r * CELL_SIZE + (q % 2 === 0 ? -CELL_SIZE / 2 : 0),
  };
}

function cellCenterPercent(q: number, r: number) {
  const position = cellPosition(q, r);
  return {
    left: ((position.x + CELL_SIZE / 2) / WORLD_WIDTH) * 100,
    top: ((position.y + CELL_SIZE / 2) / WORLD_HEIGHT) * 100,
  };
}

function clampScale(value: number) {
  return Math.min(2.4, Math.max(0.85, Math.round(value * 100) / 100));
}

interface StrategicMapProps {
  onCityMenu?(cityId: CityId, position: { x: number; y: number }): void;
  backgroundImage?: string;
  editorGrid?: GridCell[];
  editorCities?: EditableCityMarker[];
  editorMode?: boolean;
  onEditorCellPaint?(coord: GridCoord): void;
  deployTargets?: GridCoord[];
  selectedDeployTarget?: GridCoord | null;
  onDeployTargetSelect?(coord: GridCoord): void;
  moveTargets?: GridCoord[];
  attackTargetCityIds?: CityId[];
  attackTargetUnitIds?: string[];
  damageReports?: BattleDamageReport[];
  cityEffectReports?: CityEffectReport[];
  selectedUnitId?: string | null;
  onCellHover?(cell: GridCell | null): void;
  onMoveTargetSelect?(coord: GridCoord, position: { x: number; y: number }): void;
  onUnitSelect?(unitId: string, position: { x: number; y: number }): void;
  onUnitContextMenu?(unitId: string, position: { x: number; y: number }): void;
  onUnitHover?(unitId: string, position: { x: number; y: number }): void;
  onUnitLeave?(): void;
  onCityHover?(cityId: CityId, position: { x: number; y: number }): void;
  onCityLeave?(): void;
  onAttackTargetSelect?(unitId: string): void;
  onAttackCityTargetSelect?(cityId: CityId): void;
  onMapContextMenu?(position: { x: number; y: number }): void;
  onMapContextClose?(): void;
}

export function StrategicMap({
  backgroundImage,
  deployTargets = [],
  editorCities,
  editorGrid,
  editorMode = false,
  moveTargets = [],
  attackTargetCityIds = [],
  attackTargetUnitIds = [],
  damageReports = [],
  cityEffectReports = [],
  onCityMenu,
  onCellHover,
  onDeployTargetSelect,
  onEditorCellPaint,
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
  selectedDeployTarget,
  selectedUnitId,
}: StrategicMapProps) {
  const { state, selectedCityId, selectCity } = useGame();
  const [view, setView] = useState<MapView>(INITIAL_VIEW);
  const drag = useRef<{ pointerId: number; x: number; y: number } | null>(null);

  if (!state) return null;

  const zoom = (amount: number) => {
    setView((current) => ({ ...current, scale: clampScale(current.scale + amount) }));
  };

  const handleWheel = (event: WheelEvent<HTMLDivElement>) => {
    event.preventDefault();
    zoom(event.deltaY < 0 ? 0.15 : -0.15);
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
  const deployTargetKeys = new Set(deployTargets.map((coord) => `${coord.q},${coord.r}`));
  const deployMode = deployTargetKeys.size > 0;
  const moveTargetKeys = new Set(moveTargets.map((coord) => `${coord.q},${coord.r}`));
  const attackTargetCityIdSet = new Set(attackTargetCityIds);
  const attackTargetUnitIdSet = new Set(attackTargetUnitIds);
  const moveMode = moveTargetKeys.size > 0;
  const selectedDeployKey = selectedDeployTarget ? `${selectedDeployTarget.q},${selectedDeployTarget.r}` : null;
  const dismissUnitHover = () => onUnitLeave?.();
  const dismissCityHover = () => onCityLeave?.();
  const renderUnitMarker = (unit: ArmyUnit) => {
    const position = cellPosition(unit.q, unit.r);
    const leaderName = state.officers[unit.leaderId]?.name ?? '';
    const troopType = unit.troopType ?? 'sword';
    const unitKind = unit.kind ?? 'combat';
    const texture = unitKind === 'transport' ? { glyph: '输', label: '输送队' } : TROOP_TEXTURES[troopType];
    const centerX = position.x + CELL_SIZE / 2;
    const centerY = position.y + CELL_SIZE / 2;
    const canActThisTurn = unit.forceId === state.turnForceId && !unit.moved && !unit.acted && unit.movementRemaining > 0;
    const isAttackTarget = attackTargetUnitIdSet.has(unit.id);
    return (
      <g
        key={unit.id}
        data-testid="battle-unit-marker"
        data-grid-position={`${unit.q},${unit.r}`}
        data-troop-type={troopType}
        data-unit-kind={unitKind}
        className={`battle-unit-marker troop-${troopType} unit-${unitKind}${selectedUnitId === unit.id ? ' is-selected' : ''}`}
        aria-label={`${leaderName} ${texture.label}`}
        onPointerDown={(event) => {
          if (event.button === 0 || event.button === 2) dismissUnitHover();
          if (event.button !== 0) return;
          event.stopPropagation();
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
        onPointerEnter={(event) => onUnitHover?.(unit.id, { x: event.clientX + 14, y: event.clientY + 4 })}
        onPointerLeave={() => onUnitLeave?.()}
      >
        <text
          className="battle-unit-leader-name"
          x={centerX}
          y={Math.max(12, position.y - 5)}
        >
          {leaderName}
        </text>
        <g className="battle-unit-model" style={{ '--force-color': state.forces[unit.forceId].color } as CSSProperties}>
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
      </g>
    );
  };

  const renderDamageNumber = (report: BattleDamageReport) => {
    const position = cellPosition(report.q, report.r);
    const centerX = position.x + CELL_SIZE / 2;
    return (
      <text
        key={report.id}
        className={`battle-damage-number is-${report.kind}`}
        data-testid="battle-damage-number"
        x={centerX}
        y={Math.max(12, position.y - 31)}
      >
        -{report.amount.toLocaleString('en-US')}
      </text>
    );
  };

  return (
    <section
      className={`map-region${editorMode ? ' is-editing' : ''}`}
      aria-label="战略地图区域"
      data-testid="map-viewport"
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
        style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})` }}
      >
        {backgroundImage && (
          <img
            src={backgroundImage}
            alt=""
            className="map-image"
            data-testid="map-image"
            draggable={false}
          />
        )}
        <svg className={`battle-grid-overlay${editorMode ? ' is-editing' : ''}${deployMode ? ' is-deploying' : ''}${moveMode ? ' is-moving' : ''}`} data-testid="battle-grid-overlay" viewBox={`0 0 ${WORLD_WIDTH} ${WORLD_HEIGHT}`} aria-hidden="true">
          {displayGrid.map((cell) => {
            const position = cellPosition(cell.q, cell.r);
            const cellKey = `${cell.q},${cell.r}`;
            const isDeployTarget = deployTargetKeys.has(cellKey);
            const isMoveTarget = moveTargetKeys.has(cellKey);
            const isSelectedDeployTarget = selectedDeployKey === cellKey;
            return (
              <rect
                key={`${cell.q},${cell.r}`}
                data-testid={editorMode ? `editor-cell-${cell.q}-${cell.r}` : isDeployTarget ? `deploy-target-${cell.q}-${cell.r}` : isMoveTarget ? `move-target-${cell.q}-${cell.r}` : `map-cell-${cell.q}-${cell.r}`}
                x={position.x}
                y={position.y}
                width={CELL_SIZE}
                height={CELL_SIZE}
                className={`battle-cell terrain-${cell.terrain}${isDeployTarget ? ' is-deploy-target' : ''}${isMoveTarget ? ' is-move-target' : ''}${isSelectedDeployTarget ? ' is-selected-deploy-target' : ''}`}
                onPointerDown={(event) => {
                  if (event.button !== 0) return;
                  if (isDeployTarget) {
                    event.stopPropagation();
                    onDeployTargetSelect?.({ q: cell.q, r: cell.r });
                    return;
                  }
                  if (isMoveTarget) {
                    event.stopPropagation();
                    onMoveTargetSelect?.({ q: cell.q, r: cell.r }, { x: event.clientX + 12, y: event.clientY + 4 });
                    return;
                  }
                  if (!editorMode) return;
                  event.stopPropagation();
                  onEditorCellPaint?.({ q: cell.q, r: cell.r });
                }}
                onPointerEnter={(event) => {
                  onCellHover?.(cell);
                  if (!editorMode || event.buttons !== 1) return;
                  event.stopPropagation();
                  onEditorCellPaint?.({ q: cell.q, r: cell.r });
                }}
              />
            );
          })}
          {displayCities.flatMap((city) => (
            sevenCellCityFootprint(city).map((coord) => {
              const position = cellPosition(coord.q, coord.r);
              return (
                <rect
                  key={`${city.id}-${coord.q},${coord.r}`}
                  x={position.x + 2}
                  y={position.y + 2}
                  width={CELL_SIZE - 4}
                  height={CELL_SIZE - 4}
                  className="city-footprint-cell"
                  style={{ '--force-color': city.forceColor } as CSSProperties}
                />
              );
            })
          ))}
        </svg>
        <div className={`city-marker-layer${editorMode || deployMode || moveMode ? ' is-editing' : ''}`} aria-label="荆襄城市">
          {Object.values(state.cities).map((city) => {
            const force = state.forces[city.ownerId];
            const selected = selectedCityId === city.id;
            const isAttackTarget = attackTargetCityIdSet.has(city.id);
            const markerPosition = cellCenterPercent(city.gridQ, city.gridR);
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
                  dismissCityHover();
                  if (isAttackTarget) {
                    onAttackCityTargetSelect?.(city.id);
                    return;
                  }
                  selectCity(city.id);
                  if (city.ownerId === state.playerForceId) {
                    onCityMenu?.(city.id, { x: event.clientX + 12, y: event.clientY });
                  }
                }}
                onPointerEnter={(event) => onCityHover?.(city.id, { x: event.clientX + 14, y: event.clientY + 4 })}
                onPointerLeave={() => onCityLeave?.()}
                onMouseEnter={(event) => onCityHover?.(city.id, { x: event.clientX + 14, y: event.clientY + 4 })}
                onMouseLeave={() => onCityLeave?.()}
              >
                {cityEffect && (
                  <span className={`city-effect-number is-${cityEffect.kind}`} data-testid="city-effect-number">
                    {cityEffect.label} +{cityEffect.amount.toLocaleString('en-US')}
                  </span>
                )}
                {isAttackTarget && <span className="city-attack-target-arrow" data-testid="attack-city-target-arrow">▼</span>}
                <span className="city-fort" aria-hidden="true"><i /></span>
                <span className="city-marker-copy">
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
        <svg className="battle-unit-layer" data-testid="battle-unit-layer" viewBox={`0 0 ${WORLD_WIDTH} ${WORLD_HEIGHT}`} aria-label="战场部队">
          {Object.values(state.units).map(renderUnitMarker)}
          {damageReports.map(renderDamageNumber)}
        </svg>
      </div>

      <div className="map-tools tool-panel" aria-label="地图工具">
        <button type="button" className="icon-button" aria-label="放大地图" title="放大地图" onClick={() => zoom(0.15)}><ZoomIn /></button>
        <button type="button" className="icon-button" aria-label="缩小地图" title="缩小地图" onClick={() => zoom(-0.15)}><ZoomOut /></button>
        <button type="button" className="icon-button" aria-label="复位地图" title="复位地图" onClick={() => setView(INITIAL_VIEW)}><Maximize2 /></button>
      </div>

      <div className="mini-map tool-panel" aria-label="荆襄小地图">
        {Object.values(state.cities).map((city) => (
          <button
            key={city.id}
            type="button"
            className={selectedCityId === city.id ? 'is-selected' : ''}
            style={{ left: `${city.mapX * 100}%`, top: `${city.mapY * 100}%`, backgroundColor: state.forces[city.ownerId].color }}
            aria-label={`在小地图选择${city.name}`}
            onClick={() => selectCity(city.id)}
          />
        ))}
      </div>
    </section>
  );
}
