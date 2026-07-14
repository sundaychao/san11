import { Maximize2, ZoomIn, ZoomOut } from 'lucide-react';
import { useRef, useState, type CSSProperties, type PointerEvent, type WheelEvent } from 'react';
import { useGame } from '../game/store/GameProvider';

interface MapView {
  x: number;
  y: number;
  scale: number;
}

const INITIAL_VIEW: MapView = { x: 0, y: 0, scale: 1 };

function clampScale(value: number) {
  return Math.min(2.4, Math.max(0.85, Math.round(value * 100) / 100));
}

export function StrategicMap() {
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
    event.currentTarget.setPointerCapture(event.pointerId);
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
                onClick={() => selectCity(city.id)}
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
