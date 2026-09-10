import { useMemo, useState } from 'react';
import { useAudioEventAdapter } from '../audio/reactAudioEventAdapter';
import type { ForceId, GameState, TerrainType } from '../game/types';
import { GameProvider } from '../game/store/GameProvider';
import {
  createBlankMap,
  createEditorState,
  commitPlots,
  eraseStronghold,
  exportEditorJson,
  paintTerrain,
  placeCity,
  placePass,
  redoEditor,
  undoEditor,
  type EditorCityPlot,
  type EditorMapPayload,
  type MapEditorState,
  type MapEditorTool,
} from '../game/map-editor/editor';
import { SCENARIO_FORCES } from '../game/scenario/jingxiang208';
import { addSessionMap, getMap, updateSessionMap } from '../game/mapRegistry';
import { downloadTextFile } from '../utils/download';
import { StrategicMap } from './StrategicMap';
import { MapEditorPanel } from './MapEditorPanel';

/** 编辑器所需的极简 GameState stub：仅满足 StrategicMap editorMode 分支的字段读取 */
function editorStub(editor: MapEditorState): GameState {
  return {
    schemaVersion: 2,
    scenarioId: 'jingxiang-208',
    seed: 1,
    rngCursor: 0,
    month: 0,
    tenDay: 1,
    turnForceId: 'cao',
    playerForceId: 'cao',
    phase: 'playing',
    actionPoints: { cao: 0, liu: 0, sun: 0, biao: 0 },
    forces: {} as GameState['forces'],
    cities: {} as GameState['cities'],
    officers: {},
    grid: editor.grid,
    gridWidth: editor.width,
    gridHeight: editor.height,
    units: {},
    logs: [],
    facilities: {} as GameState['facilities'],
    passes: {} as GameState['passes'],
    firePlots: [],
  } as GameState;
}

type PendingPlacement = { tool: 'city' | 'pass'; q: number; r: number };
/** 角色可选：现行 4 势力 + 无主 */
const FORCE_CHOICES: Array<{ forceId: ForceId | null; label: string }> = [
  { forceId: 'cao', label: '曹操' },
  { forceId: 'liu', label: '刘备' },
  { forceId: 'sun', label: '孙权' },
  { forceId: 'biao', label: '刘表' },
  { forceId: null, label: '无主' },
];

interface MapEditorScreenProps {
  mapId: 'new' | string;
  onSave(payload: EditorMapPayload, name: string): void;
  onBack(): void;
}

export function MapEditorScreen({ mapId, onSave, onBack }: MapEditorScreenProps) {
  const { emit: emitAudioEvent } = useAudioEventAdapter();
  const [editor, setEditor] = useState<MapEditorState>(() => {
    if (mapId === 'new') return createBlankMap(200, 200);
    // 重新编辑已有地图（内置或自定义）：直接以当前荷载进入编辑器
    const payload = getMap(mapId)?.payload;
    return payload
      ? createEditorState(payload.grid, payload.cities, payload.width, payload.height, payload.plots ?? [])
      : createBlankMap(200, 200);
  });
  // 既有地图的原名：进入编辑时预填地图名输入框，保存时用于判断「是否改名另存」
  const [originalName] = useState(() => (mapId === 'new' ? '' : getMap(mapId)?.name ?? ''));
  // 新建地图时先确认尺寸（宽×高格数）；已有地图编辑时为哨兵值，跳过尺寸输入页
  const [requestedDims, setRequestedDims] = useState<{ w: number; h: number } | null>(() =>
    mapId === 'new' ? null : { w: 0, h: 0 },
  );
  const [activeTool, setActiveTool] = useState<MapEditorTool>('plain');
  const [pendingPlacement, setPendingPlacement] = useState<PendingPlacement | null>(null);
  // 新建据点选完归属后：待命名的势主（确认名字才真正落地）
  const [pendingName, setPendingName] = useState<{ forceId: ForceId | null } | null>(null);
  // 「建设用地」模式下当前圈地归属的城
  const [plotCityId, setPlotCityId] = useState<string | null>(null);
  // 「建设用地」草稿：确定前不落库，取消即整体丢弃
  const [draftAdds, setDraftAdds] = useState<EditorCityPlot[]>([]);
  const [draftRemoves, setDraftRemoves] = useState<string[]>([]);

  const stub = useMemo(() => editorStub(editor), [editor]);

  const markerAt = (q: number, r: number) => editor.cities.find((c) => c.q === q && c.r === r);
  const placementMarker = pendingPlacement ? markerAt(pendingPlacement.q, pendingPlacement.r) : undefined;
  const plotCity = plotCityId ? editor.cities.find((c) => c.id === plotCityId) : undefined;

  // 预览图：已提交 + 本轮草稿（草稿覆盖同坐标、草稿移除剔除）
  const previewPlots = useMemo(() => {
    const byKey = new Map<string, EditorCityPlot>();
    const removeSet = new Set(draftRemoves);
    for (const plot of editor.plots) {
      if (removeSet.has(`${plot.q},${plot.r}`)) continue;
      byKey.set(`${plot.q},${plot.r}`, plot);
    }
    for (const plot of draftAdds) byKey.set(`${plot.q},${plot.r}`, plot);
    return [...byKey.values()];
  }, [editor.plots, draftAdds, draftRemoves]);
  const hasPlotDraft = draftAdds.length > 0 || draftRemoves.length > 0;

  const resetPlotDraft = () => {
    setDraftAdds([]);
    setDraftRemoves([]);
  };

  const selectPlotCity = (id: string | null) => {
    setPlotCityId(id);
    resetPlotDraft();
  };

  const confirmPlots = () => {
    setEditor((current) => (current ? commitPlots(current, draftAdds, draftRemoves) : current));
    resetPlotDraft();
    setPlotCityId(null);
  };

  const handleSelectTool = (tool: MapEditorTool) => {
    setActiveTool(tool);
    if (tool !== 'plot') selectPlotCity(null);
  };

  const handlePaint = (coord: { q: number; r: number }) => {
    if (activeTool === 'plot') {
      // 点击城址（type==='city'）→ 选中该城作为圈地归属（并丢弃上一轮草稿）
      const city = editor.cities.find((c) => c.q === coord.q && c.r === coord.r && c.type === 'city');
      if (city) {
        emitAudioEvent({ type: 'menu-click-on' });
        selectPlotCity(plotCityId === city.id ? null : city.id);
        return;
      }
      if (!plotCityId) return;
      const key = `${coord.q},${coord.r}`;
      setDraftAdds((adds) => {
        if (adds.some((p) => p.q === coord.q && p.r === coord.r)) {
          // 已在草稿：本格原是已提交归属 → 转为「取消」；否则恢复「无归属」
          if (editor.plots.some((p) => p.q === coord.q && p.r === coord.r && p.cityId === plotCityId)) {
            setDraftRemoves((removes) => {
              const rest = removes.filter((k) => k !== key);
              return rest.includes(key) ? rest : [...rest, key];
            });
            return adds.filter((p) => p.q !== coord.q || p.r !== coord.r);
          }
          return adds.filter((p) => p.q !== coord.q || p.r !== coord.r);
        }
        // 本条自主：从「取消」恢复为「归属」；然后加入草稿（原属他城/无归属 → 归属本城）
        setDraftRemoves((removes) => removes.filter((k) => k !== key));
        return [...adds, { cityId: plotCityId, q: coord.q, r: coord.r }];
      });
      return;
    }
    if (activeTool === 'erase') {
      const marker = editor.cities.find((c) => c.q === coord.q && c.r === coord.r);
      if (marker && marker.id === plotCityId) selectPlotCity(null);
      setEditor((current) => {
        if (!current) return current;
        const marker = current.cities.find((c) => c.q === coord.q && c.r === coord.r);
        let next = current;
        if (marker) next = eraseStronghold(next, marker.id);
        else if (current.grid.find((cell) => cell.q === coord.q && cell.r === coord.r)?.terrain !== 'plain') {
          next = paintTerrain(next, coord, 'plain');
        }
        return next;
      });
      return;
    }
    if (activeTool === 'city' || activeTool === 'pass') {
      emitAudioEvent({ type: 'menu-click-on' });
      setPendingPlacement({ tool: activeTool, q: coord.q, r: coord.r });
      return;
    }
    setEditor((current) => (current ? paintTerrain(current, coord, activeTool as TerrainType) : current));
  };

  /** 落地据点（已确定名字） */
  const commitPlacement = (label: string, forceId: ForceId | null) => {
    if (!pendingPlacement) return;
    const coord = { q: pendingPlacement.q, r: pendingPlacement.r };
    const id = `${pendingPlacement.tool}-${coord.q}-${coord.r}`;
    const isCity = pendingPlacement.tool === 'city';
    setEditor((current) => {
      if (!current) return current;
      const marker = { id, label, q: coord.q, r: coord.r, forceId };
      return isCity ? placeCity(current, marker) : placePass(current, marker);
    });
    setPendingPlacement(null);
    setPendingName(null);
  };

  /** 选择归属：新建据点先弹命名框；已存在的据点仅改归属、保留原名 */
  const chooseForce = (forceId: ForceId | null) => {
    if (!pendingPlacement) return;
    const existing = markerAt(pendingPlacement.q, pendingPlacement.r);
    if (existing) {
      commitPlacement(existing.label, forceId);
      return;
    }
    setPendingName({ forceId });
  };

  const closePlacement = () => {
    setPendingPlacement(null);
    setPendingName(null);
  };

  const deletePlacementMarker = () => {
    if (!pendingPlacement) return;
    const marker = markerAt(pendingPlacement.q, pendingPlacement.r);
    if (marker) setEditor((current) => (current ? eraseStronghold(current, marker.id) : current));
    closePlacement();
  };

  /**
   * 保存：cache＝仅浏览器缓存；local＝缓存 + 下载 JSON。
   * 改名即「另存为新地图」（生成新的自定义图，原图保留）；原名则原地更新。
   * 内置图无法覆盖写回，改名后同样会落到一张新的自定义图上，否则刷新即丢。
   */
  const handleSave = (name: string, mode: 'cache' | 'local') => {
    const payload = JSON.parse(exportEditorJson(editor, name)) as EditorMapPayload;
    const renamed = name !== originalName;
    if (mapId === 'new' || renamed) addSessionMap(payload, name);
    else updateSessionMap(mapId, payload);
    if (mode === 'local') downloadTextFile(`${name}.json`, JSON.stringify(payload, null, 2));
    onSave(payload, name);
  };

  const forceName = (forceId: ForceId | null | undefined) =>
    forceId ? SCENARIO_FORCES[forceId]?.name ?? forceId : '无主';
  const placementTitle = pendingPlacement?.tool === 'city' ? '设置城池' : '设置关隘';

  // 新建地图：先让用户填写地图尺寸（宽×高格数），确认后再进入画布
  if (requestedDims === null) {
    return (
      <div className="map-editor-screen" data-testid="map-editor-screen">
        <div className="map-editor-size-dialog tool-panel" data-testid="editor-size-dialog">
          <header>
            <h2>新建地图</h2>
            <p>设置地图大小（格子数）</p>
          </header>
          <EditorSizeFields
            defaultWidth={200}
            defaultHeight={200}
            onCancel={onBack}
            onSubmit={(w, h) => {
              emitAudioEvent({ type: 'menu-click-on' });
              setEditor(createBlankMap(w, h));
              setRequestedDims({ w, h });
            }}
          />
        </div>
      </div>
    );
  }

  return (
    <GameProvider initialState={stub}>
      <div className="map-editor-screen" data-testid="map-editor-screen">
        <div className="map-editor-canvas">
          <StrategicMap
            editorMode
            editorGrid={editor.grid}
            editorCities={editor.cities}
            editorPlots={activeTool === 'plot' ? previewPlots : editor.plots}
            editorPlotCityId={activeTool === 'plot' ? plotCityId : null}
            onEditorCellPaint={handlePaint}
          />
        </div>
        <MapEditorPanel
          activeTool={activeTool}
          defaultName={originalName}
          canUndo={editor.history.length > 0}
          canRedo={editor.future.length > 0}
          plotCity={plotCity ? { id: plotCity.id, label: plotCity.label } : null}
          canConfirmPlots={hasPlotDraft}
          onBack={onBack}
          onClear={() => {
            selectPlotCity(null);
            setEditor((current) => (current ? eraseStrongholdCurrentMap(current) : current));
          }}
          onConfirmPlots={confirmPlots}
          onClearPlotCity={() => selectPlotCity(null)}
          onRedo={() => setEditor((current) => (current ? redoEditor(current) : current))}
          onSave={handleSave}
          onSelectTool={handleSelectTool}
          onUndo={() => setEditor((current) => (current ? undoEditor(current) : current))}
        />

        {pendingPlacement && !pendingName && (
          <nav
            className="city-command-menu tool-panel"
            data-testid="editor-placement-menu"
            style={{ left: 260, top: 120 }}
            aria-label={placementTitle}
            onContextMenu={(event) => {
              event.preventDefault();
              closePlacement();
            }}
          >
            <div className="city-command-secondary">
              <div className="city-command-menu-title">{placementTitle}</div>
              {placementMarker ? (
                <>
                  <div className="city-command-menu-title">当前归属：{forceName(placementMarker.forceId)}</div>
                  {FORCE_CHOICES.map(({ forceId, label }) => (
                    <button key={label} type="button" data-testid={`placement-force-${label}`} onClick={() => { emitAudioEvent({ type: 'menu-click-on' }); chooseForce(forceId); }}>
                      {forceId === placementMarker.forceId ? '✓ ' : ''}{label}
                    </button>
                  ))}
                  <button type="button" data-testid="placement-delete" onClick={deletePlacementMarker}>删除</button>
                </>
              ) : (
                FORCE_CHOICES.map(({ forceId, label }) => (
                  <button key={label} type="button" data-testid={`placement-force-${label}`} onClick={() => { emitAudioEvent({ type: 'menu-click-on' }); chooseForce(forceId); }}>
                    {label}
                  </button>
                ))
              )}
              <button type="button" data-testid="placement-cancel" onClick={closePlacement}>取消</button>
            </div>
          </nav>
        )}

        {pendingPlacement && pendingName && (
          <StrongholdNameDialog
            kind={pendingPlacement.tool}
            forceLabel={forceName(pendingName.forceId)}
            onCancel={() => setPendingName(null)}
            onSubmit={(name) => commitPlacement(name, pendingName.forceId)}
          />
        )}
      </div>
    </GameProvider>
  );
}

function eraseStrongholdCurrentMap(state: MapEditorState): MapEditorState {
  let next = state;
  for (const marker of state.cities) next = eraseStronghold(next, marker.id);
  return next;
}

/** 据点命名：选完归属后输入名字，确认才落地 */
function StrongholdNameDialog({ kind, forceLabel, onCancel, onSubmit }: {
  kind: 'city' | 'pass';
  forceLabel: string;
  onCancel(): void;
  onSubmit(name: string): void;
}) {
  const isCity = kind === 'city';
  const [name, setName] = useState('');
  const trimmed = name.trim();
  const submit = () => {
    if (trimmed) onSubmit(trimmed);
  };

  return (
    <div className="map-editor-size-dialog tool-panel editor-name-dialog" data-testid="editor-name-dialog">
      <header>
        <h2>{isCity ? '命名城池' : '命名关隘'}</h2>
        <p>归属：{forceLabel}</p>
      </header>
      <label className="editor-size-field">
        <span>{isCity ? '城池名' : '关隘名'}</span>
        <input
          autoFocus
          data-testid="editor-name-input"
          value={name}
          maxLength={12}
          placeholder={isCity ? '请输入城池名字' : '请输入关隘名字'}
          onChange={(event) => setName(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') submit();
            if (event.key === 'Escape') onCancel();
          }}
        />
      </label>
      <div className="editor-name-actions">
        <button type="button" className="secondary-button" data-testid="editor-name-cancel" onClick={onCancel}>取消</button>
        <button type="button" className="primary-button" data-testid="editor-name-confirm" disabled={!trimmed} onClick={submit}>确定</button>
      </div>
    </div>
  );
}

/** 新建地图尺寸输入：宽×高（左右宽 × 上下高）格数 */
function EditorSizeFields({ defaultWidth, defaultHeight, onCancel, onSubmit }: {
  defaultWidth: number;
  defaultHeight: number;
  onCancel(): void;
  onSubmit(width: number, height: number): void;
}) {
  const [width, setWidth] = useState(String(defaultWidth));
  const [height, setHeight] = useState(String(defaultHeight));

  const parsedW = Number.parseInt(width, 10);
  const parsedH = Number.parseInt(height, 10);
  const valid =
    Number.isInteger(parsedW) && Number.isInteger(parsedH) &&
    parsedW >= 2 && parsedW <= 200 && parsedH >= 2 && parsedH <= 200;

  const submit = () => {
    if (!valid) return;
    onSubmit(parsedW, parsedH);
  };

  return (
    <div className="editor-size-fields">
      <label className="editor-size-field">
        <span>宽</span>
        <input
          data-testid="editor-size-width"
          type="number"
          min={2}
          max={200}
          value={width}
          onChange={(event) => setWidth(event.target.value)}
          onKeyDown={(event) => { if (event.key === 'Enter') submit(); }}
        />
      </label>
      <label className="editor-size-field">
        <span>高</span>
        <input
          data-testid="editor-size-height"
          type="number"
          min={2}
          max={200}
          value={height}
          onChange={(event) => setHeight(event.target.value)}
          onKeyDown={(event) => { if (event.key === 'Enter') submit(); }}
        />
      </label>
      <button type="button" className="primary-button" data-testid="editor-size-create" disabled={!valid} onClick={submit}>
        创建地图
      </button>
      <button type="button" className="secondary-button" data-testid="editor-size-back" onClick={onCancel}>
        返回
      </button>
    </div>
  );
}