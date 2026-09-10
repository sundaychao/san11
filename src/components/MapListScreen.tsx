import { MapPlus } from 'lucide-react';
import { listMaps } from '../game/mapRegistry';
import { SCENARIO_FORCES } from '../game/scenario/jingxiang208';
import { forcesOfMap } from '../game/scenario/customMap';

interface MapListScreenProps {
  mode: 'edit' | 'start';
  onSelect(mapId: string): void;
  onCreateNew?(): void;
  onBack(): void;
}

/**
 * 地图列表：平铺当前所有可用地图（内置荆襄图 + 本会话自定义图）。
 * edit 模式末尾带「+」新建占位符；start 模式过滤无有主城的地图。
 */
export function MapListScreen({ mode, onSelect, onCreateNew, onBack }: MapListScreenProps) {
  const maps = listMaps();

  const available = mode === 'start'
    ? maps.filter((map) => forcesOfMap(map.payload).length > 0)
    : maps;

  return (
    <main className="map-list-screen" data-testid="map-list-screen">
      <header className="map-list-header">
        <button type="button" className="secondary-button" onClick={onBack}>{'< 返回'}</button>
        <h1>{mode === 'edit' ? '编辑地图' : '选择地图'}</h1>
        {mode === 'edit' && <p>地图以 JSON 文件保存，刷新后需重新导入才会保留。</p>}
      </header>

      <div className="map-list-grid" aria-label="可用地图">
        {available.map((map) => {
          const forces = forcesOfMap(map.payload);
          return (
            <button
              key={map.id}
              type="button"
              className="map-card"
              data-testid={`map-card-${map.id}`}
              onClick={() => onSelect(map.id)}
            >
              <span className="map-card-name">{map.name}</span>
              <span className="map-card-meta">
                {map.builtin ? '内置地图' : '自定义地图'} · {map.payload.width}×{map.payload.height}
              </span>
              <span className="map-card-forces" aria-hidden="true">
                {forces.length > 0
                  ? forces.map((forceId) => (
                    <i key={forceId} style={{ backgroundColor: SCENARIO_FORCES[forceId]?.color }} title={SCENARIO_FORCES[forceId]?.name} />
                  ))
                  : <em className="map-card-empty">无有主城</em>}
              </span>
            </button>
          );
        })}

        {mode === 'edit' && onCreateNew && (
          <button
            type="button"
            className="map-card map-card-new"
            data-testid="map-create-new"
            onClick={onCreateNew}
            aria-label="新建地图"
          >
            <MapPlus aria-hidden="true" />
            <span className="map-card-name">新建地图</span>
          </button>
        )}
      </div>
    </main>
  );
}