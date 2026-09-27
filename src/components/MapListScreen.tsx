import { useEffect, useRef, useState } from 'react';
import { FileJson, MapPlus, Trash2 } from 'lucide-react';
import { importMapJson, listMaps, loadRuntimeMaps, removeSessionMap, type SessionMap } from '../game/mapRegistry';
import { SCENARIO_FORCES } from '../game/scenario/jingxiang208';
import { forcesOfMap } from '../game/scenario/customMap';

interface MapListScreenProps {
  mode: 'edit' | 'start';
  onSelect(mapId: string): void;
  onCreateNew?(): void;
  onBack(): void;
}

/**
 * 地图列表：平铺当前所有可用地图（内置荆襄图 + localStorage 持久化的自定义图）。
 * edit 模式末尾带「+」新建占位符和「导入 JSON」按钮；start 模式过滤无有主城的地图。
 */
export function MapListScreen({ mode, onSelect, onCreateNew, onBack }: MapListScreenProps) {
  const [maps, setMaps] = useState<SessionMap[]>(() => listMaps());
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // 热拔插：异步拉取 public/maps 下的运行时地图，完成后刷新列表
  useEffect(() => {
    let active = true;
    void loadRuntimeMaps().then(() => { if (active) setMaps(listMaps()); });
    return () => { active = false; };
  }, []);

  // start 模式下「没有有主城池」的地图无法开局：仍然列出但置灰（见 unplayableForStart），
  // 不直接过滤掉 —— 过滤会让用户以为刚保存的地图丢了
  const unplayableForStart = (map: SessionMap) => mode === 'start' && forcesOfMap(map.payload).length === 0;
  const unplayableCount = maps.filter(unplayableForStart).length;

  const handleImportClick = () => fileInputRef.current?.click();
  const handleImportFile = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const payload = JSON.parse(String(reader.result));
        if (payload.schemaVersion !== 2 || !payload.width || !payload.height || !Array.isArray(payload.grid)) {
          alert('不是有效的地图 JSON 文件');
          return;
        }
        importMapJson(payload, payload.name ?? file.name.replace(/\.json$/i, ''));
        // 刷新列表
        event.target.value = '';
        window.location.reload();
      } catch (error) {
        // 归一化失败时 importMapJson 会抛出玩家看得懂的原因，别用笼统文案盖掉
        alert(error instanceof Error && error.message ? error.message : 'JSON 文件解析失败');
      }
    };
    reader.readAsText(file);
  };

  const handleDelete = (event: React.MouseEvent, mapId: string, name: string) => {
    event.stopPropagation();
    if (!confirm(`确定要删除地图「${name}」吗？此操作不可撤销。`)) return;
    removeSessionMap(mapId);
    window.location.reload();
  };

  return (
    <main className="map-list-screen" data-testid="map-list-screen">
      <header className="map-list-header">
        <button type="button" className="secondary-button" onClick={onBack}>{'< 返回'}</button>
        <h1>{mode === 'edit' ? '编辑地图' : '选择地图'}</h1>
        {mode === 'edit' && <p>自定义地图自动保存到浏览器本地；也可以导出 JSON 备份、导入他人地图。</p>}
        {mode === 'start' && unplayableCount > 0 && (
          <p>灰显的地图没有「有主城池」，无法开局 —— 到「编辑地图」里给城池设置归属势力即可。</p>
        )}
      </header>

      {mode === 'edit' && (
        <div className="map-list-toolbar">
          <button type="button" className="secondary-button" onClick={handleImportClick}>
            <FileJson /> 导入 JSON 文件
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".json,application/json"
            hidden
            onChange={handleImportFile}
          />
          <button type="button" className="secondary-button" onClick={() => {
            // 清除所有自定义地图
            const customIds = listMaps().filter((m) => !m.builtin).map((m) => m.id);
            if (customIds.length === 0) { alert('没有可删除的自定义地图'); return; }
            if (!confirm(`确定要删除全部 ${customIds.length} 张自定义地图吗？`)) return;
            customIds.forEach((id) => removeSessionMap(id));
            window.location.reload();
          }}>
            <Trash2 /> 清空全部自定义
          </button>
        </div>
      )}

      <div className="map-list-grid" aria-label="可用地图">
        {maps.map((map) => {
          const forces = forcesOfMap(map.payload);
          const unplayable = unplayableForStart(map);
          return (
            <div key={map.id} className="map-card-wrapper">
              <button
                type="button"
                className={unplayable ? 'map-card is-unplayable' : 'map-card'}
                data-testid={`map-card-${map.id}`}
                disabled={unplayable}
                title={unplayable ? '该地图没有有主城池，无法开局 —— 请先到「编辑地图」给城池设置归属势力' : undefined}
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
              {mode === 'edit' && !map.builtin && (
                <button
                  type="button"
                  className="map-card-delete"
                  data-testid={`map-delete-${map.id}`}
                  title="删除此地图"
                  onClick={(event) => handleDelete(event, map.id, map.name)}
                >
                  <Trash2 />
                </button>
              )}
            </div>
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