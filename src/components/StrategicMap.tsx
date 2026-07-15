import { Maximize2, ZoomIn, ZoomOut } from 'lucide-react';
import { useRef, useState, type CSSProperties, type PointerEvent, type WheelEvent } from 'react';
import { sevenCellCityFootprint } from '../game/battle/grid';
import { GRID_HEIGHT, GRID_WIDTH } from '../game/battle/scenario';
import { useGame } from '../game/store/GameProvider';
import type { CityId } from '../game/types';

interface MapView {
  x: number;
  y: number;
  scale: number;
}

const INITIAL_VIEW: MapView = { x: 0, y: 0, scale: 1 };
const CELL_SIZE = 43;
const WORLD_WIDTH = GRID_WIDTH * CELL_SIZE;
const WORLD_HEIGHT = GRID_HEIGHT * CELL_SIZE;

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
}

export function StrategicMap({ onCityMenu }: StrategicMapProps) {
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
    >
      <div
        className="map-content"
        data-testid="map-content"
        style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})` }}
      >
        <img
          className="map-image"
          data-testid="map-image"
          src="/assets/jingxiang-map.png"
          alt="水墨画风格的荆襄山川地形图"
          draggable={false}
        />
        <svg className="battle-grid-overlay" viewBox={`0 0 ${WORLD_WIDTH} ${WORLD_HEIGHT}`} aria-hidden="true">
          {state.grid.map((cell) => {
            const position = cellPosition(cell.q, cell.r);
            return (
              <rect
                key={`${cell.q},${cell.r}`}
                x={position.x}
                y={position.y}
                width={CELL_SIZE}
                height={CELL_SIZE}
                className={`battle-cell terrain-${cell.terrain}`}
              />
            );
          })}
          {Object.values(state.cities).flatMap((city) => (
            sevenCellCityFootprint({ q: city.gridQ, r: city.gridR }).map((coord) => {
              const position = cellPosition(coord.q, coord.r);
              return (
                <rect
                  key={`${city.id}-${coord.q},${coord.r}`}
                  x={position.x + 2}
                  y={position.y + 2}
                  width={CELL_SIZE - 4}
                  height={CELL_SIZE - 4}
                  className="city-footprint-cell"
                  style={{ '--force-color': state.forces[city.ownerId].color } as CSSProperties}
                />
              );
            })
          ))}
          {Object.values(state.units).map((unit) => {
            const position = cellPosition(unit.q, unit.r);
            return (
              <g key={unit.id} data-testid="battle-unit-marker" className="battle-unit-marker">
                <circle
                  cx={position.x + CELL_SIZE / 2}
                  cy={position.y + CELL_SIZE / 2}
                  r={CELL_SIZE * 0.34}
                  style={{ '--force-color': state.forces[unit.forceId].color } as CSSProperties}
                />
                <text x={position.x + CELL_SIZE / 2} y={position.y + CELL_SIZE / 2 + 4}>{Math.floor(unit.troops / 1000)}</text>
              </g>
            );
          })}
        </svg>
        <div className="city-marker-layer" aria-label="荆襄城市">
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
                  onCityMenu?.(city.id, { x: event.clientX + 12, y: event.clientY });
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
        <img src="/assets/jingxiang-map.png" alt="" draggable={false} />
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
