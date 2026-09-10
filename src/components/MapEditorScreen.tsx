import { useMemo, useState } from 'react';
import { useAudioEventAdapter } from '../audio/reactAudioEventAdapter';
import type { ForceId, GameState, TerrainType } from '../game/types';
import { GameProvider } from '../game/store/GameProvider';
import {
  createBlankMap,
  createEditorState,
  eraseStronghold,
  exportEditorJson,
  paintTerrain,
  placeCity,
  placePass,
  redoEditor,
  undoEditor,
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
      ? createEditorState(payload.grid, payload.cities, payload.width, payload.height)
      : createBlankMap(200, 200);
  });
  // 新建地图时先确认尺寸（宽×高格数）；已有地图编辑时为哨兵值，跳过尺寸输入页
  const [requestedDims, setRequestedDims] = useState<{ w: number; h: number } | null>(() =>
    mapId === 'new' ? null : { w: 0, h: 0 },
  );
  const [activeTool, setActiveTool] = useState<MapEditorTool>('plain');
  const [pendingPlacement, setPendingPlacement] = useState<PendingPlacement | null>(null);

  const stub = useMemo(() => editorStub(editor), [editor]);

  const markerAt = (q: number, r: number) => editor.cities.find((c) => c.q === q && c.r === r);
  const placementMarker = pendingPlacement ? markerAt(pendingPlacement.q, pendingPlacement.r) : undefined;

  const handlePaint = (coord: { q: number; r: number }) => {
    if (activeTool === 'erase') {
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

  const placeWithForce = (forceId: ForceId | null) => {
    if (!pendingPlacement) return;
    const coord = { q: pendingPlacement.q, r: pendingPlacement.r };
    const id = `${pendingPlacement.tool}-${coord.q}-${coord.r}`;
    const label = pendingPlacement.tool === 'city' ? '新城' : '关隘';
    setEditor((current) => {
      if (!current) return current;
      if (pendingPlacement.tool === 'city') return placeCity(current, { id, label, q: coord.q, r: coord.r, forceId });
      return placePass(current, { id, label, q: coord.q, r: coord.r, forceId });
    });
    setPendingPlacement(null);
  };

  const deletePlacementMarker = () => {
    if (!pendingPlacement) return;
    const marker = markerAt(pendingPlacement.q, pendingPlacement.r);
    if (marker) setEditor((current) => (current ? eraseStronghold(current, marker.id) : current));
    setPendingPlacement(null);
  };

  const handleSave = (name: string) => {
    const payload = JSON.parse(exportEditorJson(editor, name)) as EditorMapPayload;
    if (mapId === 'new') addSessionMap(payload, name);
    else updateSessionMap(mapId, payload);
    downloadTextFile(`${name}.json`, JSON.stringify(payload, null, 2));
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
            onEditorCellPaint={handlePaint}
          />
        </div>
        <MapEditorPanel
          activeTool={activeTool}
          canUndo={editor.history.length > 0}
          canRedo={editor.future.length > 0}
          onBack={onBack}
          onClear={() => setEditor((current) => (current ? eraseStrongholdCurrentMap(current) : current))}
          onRedo={() => setEditor((current) => (current ? redoEditor(current) : current))}
          onSave={handleSave}
          onSelectTool={setActiveTool}
          onUndo={() => setEditor((current) => (current ? undoEditor(current) : current))}
        />

        {pendingPlacement && (
          <nav
            className="city-command-menu tool-panel"
            data-testid="editor-placement-menu"
            style={{ left: 260, top: 120 }}
            aria-label={placementTitle}
            onContextMenu={(event) => {
              event.preventDefault();
              setPendingPlacement(null);
            }}
          >
            <div className="city-command-secondary">
              <div className="city-command-menu-title">{placementTitle}</div>
              {placementMarker ? (
                <>
                  <div className="city-command-menu-title">当前归属：{forceName(placementMarker.forceId)}</div>
                  {FORCE_CHOICES.map(({ forceId, label }) => (
                    <button key={label} type="button" data-testid={`placement-force-${label}`} onClick={() => { emitAudioEvent({ type: 'menu-click-on' }); placeWithForce(forceId); }}>
                      {forceId === placementMarker.forceId ? '✓ ' : ''}{label}
                    </button>
                  ))}
                  <button type="button" data-testid="placement-delete" onClick={deletePlacementMarker}>删除</button>
                </>
              ) : (
                FORCE_CHOICES.map(({ forceId, label }) => (
                  <button key={label} type="button" data-testid={`placement-force-${label}`} onClick={() => placeWithForce(forceId)}>
                    {label}
                  </button>
                ))
              )}
              <button type="button" data-testid="placement-cancel" onClick={() => setPendingPlacement(null)}>取消</button>
            </div>
          </nav>
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
      <button type="button" data-testid="editor-size-create" disabled={!valid} onClick={submit}>
        创建地图
      </button>
      <button type="button" className="secondary-button" data-testid="editor-size-back" onClick={onCancel}>
        返回
      </button>
    </div>
  );
}