import { Maximize2, ZoomIn, ZoomOut } from 'lucide-react';
import { useRef, useState, type CSSProperties, type MouseEvent, type PointerEvent, type WheelEvent } from 'react';
import { sevenCellCityFootprint, type GridCoord } from '../game/battle/grid';
import { GRID_HEIGHT, GRID_WIDTH } from '../game/battle/scenario';
import type { EditableCityMarker } from '../game/map-editor/editor';
import { useGame } from '../game/store/GameProvider';
import type { CityId, GridCell, TroopType } from '../game/types';

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

function clampScale(value: number) {
  return Math.min(2.4, Math.max(0.85, Math.round(value * 100) / 100));
}

interface StrategicMapProps {
  onCityMenu?(cityId: CityId, position: { x: number; y: number }): void;
  editorGrid?: GridCell[];
  editorCities?: EditableCityMarker[];
  editorMode?: boolean;
  onEditorCellPaint?(coord: GridCoord): void;
  deployTargets?: GridCoord[];
  selectedDeployTarget?: GridCoord | null;
  onDeployTargetSelect?(coord: GridCoord): void;
  moveTargets?: GridCoord[];
  selectedUnitId?: string | null;
  onCellHover?(cell: GridCell | null): void;
  onMoveTargetSelect?(coord: GridCoord): void;
  onUnitSelect?(unitId: string): void;
  onMapContextMenu?(position: { x: number; y: number }): void;
}

export function StrategicMap({
  deployTargets = [],
  editorCities,
  editorGrid,
  editorMode = false,
  moveTargets = [],
  onCityMenu,
  onCellHover,
  onDeployTargetSelect,
  onEditorCellPaint,
  onMapContextMenu,
  onMoveTargetSelect,
  onUnitSelect,
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
  const moveMode = moveTargetKeys.size > 0;
  const selectedDeployKey = selectedDeployTarget ? `${selectedDeployTarget.q},${selectedDeployTarget.r}` : null;

  return (
    <section
      className="map-region"
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
                data-testid={editorMode ? `editor-cell-${cell.q}-${cell.r}` : isDeployTarget ? `deploy-target-${cell.q}-${cell.r}` : isMoveTarget ? `move-target-${cell.q}-${cell.r}` : undefined}
                x={position.x}
                y={position.y}
                width={CELL_SIZE}
                height={CELL_SIZE}
                className={`battle-cell terrain-${cell.terrain}${isDeployTarget ? ' is-deploy-target' : ''}${isMoveTarget ? ' is-move-target' : ''}${isSelectedDeployTarget ? ' is-selected-deploy-target' : ''}`}
                onPointerDown={(event) => {
                  if (isDeployTarget) {
                    event.stopPropagation();
                    onDeployTargetSelect?.({ q: cell.q, r: cell.r });
                    return;
                  }
                  if (isMoveTarget) {
                    event.stopPropagation();
                    onMoveTargetSelect?.({ q: cell.q, r: cell.r });
                    return;
                  }
                  if (!editorMode || event.button !== 0) return;
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
          {Object.values(state.units).map((unit) => {
            const position = cellPosition(unit.q, unit.r);
            const leaderName = state.officers[unit.leaderId]?.name ?? '';
            const troopType = unit.troopType ?? 'sword';
            const texture = TROOP_TEXTURES[troopType];
            const centerX = position.x + CELL_SIZE / 2;
            const centerY = position.y + CELL_SIZE / 2;
            return (
              <g
                key={unit.id}
                data-testid="battle-unit-marker"
                data-grid-position={`${unit.q},${unit.r}`}
                data-troop-type={troopType}
                className={`battle-unit-marker troop-${troopType}${selectedUnitId === unit.id ? ' is-selected' : ''}`}
                aria-label={`${leaderName} ${texture.label}`}
                onPointerDown={(event) => {
                  if (event.button !== 0) return;
                  event.stopPropagation();
                  onUnitSelect?.(unit.id);
                }}
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
                <text className="battle-unit-troops" x={centerX} y={centerY + 24}>{Math.floor(unit.troops / 1000)}</text>
              </g>
            );
          })}
        </svg>
        <div className={`city-marker-layer${editorMode || deployMode || moveMode ? ' is-editing' : ''}`} aria-label="荆襄城市">
          {Object.values(state.cities).map((city) => {
            const force = state.forces[city.ownerId];
            const selected = selectedCityId === city.id;
            return (
              <button
                key={city.id}
                type="button"
                className={`city-marker${selected ? ' is-selected' : ''}`}
                style={{
                  left: `${city.mapX * 100}%`,
                  top: `${city.mapY * 100}%`,
                  '--force-color': force.color,
                } as CSSProperties}
                aria-label={`${city.name} ${force.name} ${city.troops.toLocaleString('en-US')}兵`}
                data-testid="city-marker"
                onClick={(event) => {
                  selectCity(city.id);
                  if (city.ownerId === state.playerForceId) {
                    onCityMenu?.(city.id, { x: event.clientX + 12, y: event.clientY });
                  }
                }}
              >
                <span className="city-fort" aria-hidden="true"><i /></span>
                <span className="city-marker-copy">
                  <strong>{city.name}</strong>
                  <small>{force.name} · {city.troops.toLocaleString('en-US')}</small>
                </span>
              </button>
            );
          })}
        </div>
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
