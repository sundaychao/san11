import { useState } from 'react';
import {
  Brush, Castle, Download, Droplets, Eraser, FileText, Grid3x3, Mountain, RotateCcw, RotateCw, Save, Swords, TreePine, Waves,
} from 'lucide-react';
import { useAudioEventAdapter } from '../audio/reactAudioEventAdapter';
import type { MapEditorTool } from '../game/map-editor/editor';
import type { TerrainType } from '../game/types';

export interface MapEditorPanelProps {
  activeTool: MapEditorTool;
  /** 既有地图的原名，进入编辑时预填地图名输入框；新建地图为空串 */
  defaultName: string;
  /** 本图「有主城池」座数：0 表示无法用于单机开局，需提示用户给城池设归属势力 */
  forceCityCount?: number;
  /** 编辑对象是内置图：无法覆盖保存，保存会另存为新的自定义地图 */
  builtinSource?: boolean;
  canRedo: boolean;
  canUndo: boolean;
  plotCity?: { id: string; label: string } | null;
  /** 当前选中城池已圈定的建设用地格数（放城不再自动分配，这里让玩家看清现有几格） */
  plotCount?: number;
  canConfirmPlots: boolean;
  /** 「军事设施」工具当前选中的归属城（军事设施随城的势力） */
  facilityCity?: { id: string; label: string; forceLabel: string } | null;
  onBack(): void;
  onClear(): void;
  onClearPlotCity(): void;
  onClearFacilityCity(): void;
  /** 把当前选中的城重置为「自动圈地」的标准一份（作为草稿，确定后才入库） */
  onAutoPlots?(): void;
  onConfirmPlots(): void;
  onRedo(): void;
  /** cache＝仅写入浏览器缓存；local＝写入缓存并下载 JSON 文件 */
  onSave(name: string, mode: 'cache' | 'local'): void;
  onSelectTool(tool: MapEditorTool): void;
  onUndo(): void;
}

export const TERRAIN_TOOLS: Array<{ tool: TerrainType; label: string; icon: typeof Brush }> = [
  { tool: 'plain', label: '平地', icon: Brush },
  { tool: 'grass', label: '草地', icon: Brush },
  { tool: 'road', label: '主径', icon: FileText },
  { tool: 'path', label: '小径', icon: FileText },
  { tool: 'plank', label: '栈道', icon: FileText },
  { tool: 'forest', label: '森林', icon: TreePine },
  { tool: 'hill', label: '丘陵', icon: Mountain },
  { tool: 'mountain', label: '山崖', icon: Mountain },
  { tool: 'sand', label: '沙地', icon: Brush },
  { tool: 'wasteland', label: '荒地', icon: Brush },
  { tool: 'wetland', label: '湿地', icon: Droplets },
  { tool: 'poison', label: '毒泉', icon: Droplets },
  { tool: 'shallow', label: '浅滩', icon: Waves },
  { tool: 'ferry', label: '渡口', icon: Waves },
  { tool: 'shore', label: '岸', icon: Waves },
  { tool: 'stream', label: '川', icon: Waves },
  { tool: 'river', label: '河', icon: Waves },
  { tool: 'sea', label: '海', icon: Waves },
  { tool: 'water', label: '水域', icon: Waves },
];

export function MapEditorPanel({
  activeTool,
  defaultName,
  forceCityCount,
  builtinSource,
  canRedo,
  canUndo,
  plotCity,
  plotCount,
  canConfirmPlots,
  facilityCity,
  onAutoPlots,
  onBack,
  onClear,
  onClearPlotCity,
  onClearFacilityCity,
  onConfirmPlots,
  onRedo,
  onSave,
  onSelectTool,
  onUndo,
}: MapEditorPanelProps) {
  const audio = useAudioEventAdapter();
  const [saveName, setSaveName] = useState(defaultName);

  return (
    <section className="map-editor-panel tool-panel" data-testid="map-editor-panel" aria-label="地图编辑器">
      <header>
        <div>
          <p>地图编辑</p>
          <h2>地形 / 城池 / 关隘</h2>
        </div>
        <button type="button" className="secondary-button" onClick={onBack}>{'< 返回'}</button>
      </header>

      <section className="map-editor-step">
        <h3>地形刷子</h3>
        <div className="map-editor-tools" aria-label="地形刷子">
          {TERRAIN_TOOLS.map(({ tool, label, icon: Icon }) => (
            <button
              key={tool}
              type="button"
              className={`terrain-tool terrain-tool-${tool}${activeTool === tool ? ' is-active' : ''}`}
              aria-pressed={activeTool === tool}
              onClick={() => onSelectTool(tool)}
            >
              <Icon />
              <span>{label}</span>
            </button>
          ))}
        </div>
      </section>

      <section className="map-editor-step">
        <h3>标记刷子</h3>
        <div className="map-editor-tools" aria-label="标记刷子">
          <button
            type="button"
            className={activeTool === 'city' ? 'is-active' : ''}
            aria-pressed={activeTool === 'city'}
            onClick={() => onSelectTool('city')}
          >
            <Castle />
            <span>城池</span>
          </button>
          <button
            type="button"
            className={activeTool === 'pass' ? 'is-active' : ''}
            aria-pressed={activeTool === 'pass'}
            onClick={() => onSelectTool('pass')}
          >
            <TreePine />
            <span>关隘</span>
          </button>
          <button
            type="button"
            className={activeTool === 'plot' ? 'is-active' : ''}
            aria-pressed={activeTool === 'plot'}
            onClick={() => onSelectTool('plot')}
          >
            <Grid3x3 />
            <span>建设用地</span>
          </button>
          <button
            type="button"
            className={activeTool === 'facility' ? 'is-active' : ''}
            aria-pressed={activeTool === 'facility'}
            data-testid="editor-tool-facility"
            onClick={() => onSelectTool('facility')}
          >
            <Swords />
            <span>军事设施</span>
          </button>
          <button
            type="button"
            className={activeTool === 'erase' ? 'is-active' : ''}
            aria-pressed={activeTool === 'erase'}
            onClick={() => onSelectTool('erase')}
          >
            <Eraser />
            <span>擦除</span>
          </button>
        </div>
        {activeTool === 'plot' && (
          <div className="map-editor-plot-hint" data-testid="editor-plot-hint">
            {plotCity ? (
              <>
                <span>为「<strong>{plotCity.label}</strong>」圈地（点击地块归属此城，再次点击同一地块取消）</span>
                <span data-testid="editor-plot-count">
                  {typeof plotCount === 'number'
                    ? `本城已圈 ${plotCount} 格${plotCount === 0 ? ' —— 放城不再自动分配，没圈地就是 0 格，可用「自动圈地」一键取标准 9 格' : ''}`
                    : null}
                </span>
                <div className="map-editor-plot-actions">
                  <button
                    type="button"
                    className="primary-button"
                    disabled={!canConfirmPlots}
                    onClick={onConfirmPlots}
                  >
                    确定
                  </button>
                  {onAutoPlots && (
                    <button
                      type="button"
                      className="secondary-button"
                      data-testid="editor-plot-auto"
                      title="把本城重置为自动圈定的标准一份（中城 9 格）"
                      onClick={onAutoPlots}
                    >
                      自动圈地
                    </button>
                  )}
                  <button type="button" className="secondary-button" onClick={onClearPlotCity}>取消选择</button>
                </div>
              </>
            ) : (
              <span>请先点击一座城池，选择要圈建设用地的归属城</span>
            )}
          </div>
        )}
        {activeTool === 'facility' && (
          <div className="map-editor-plot-hint" data-testid="editor-facility-hint">
            {facilityCity ? (
              <>
                <span>
                  为「<strong>{facilityCity.label}</strong>」放置军事设施（归属：<strong>{facilityCity.forceLabel}</strong>）
                </span>
                <span>点击地图上的空地，弹出设施选项后直接放置；同一格重复放置会替换</span>
                <div className="map-editor-plot-actions">
                  <button type="button" className="secondary-button" data-testid="editor-facility-clear-city" onClick={onClearFacilityCity}>
                    取消选择
                  </button>
                </div>
              </>
            ) : (
              <span data-testid="editor-facility-need-city">请先点击一座城池，军事设施将归属该城的势力</span>
            )}
          </div>
        )}
        <div className="map-editor-actions">
          <button type="button" className="secondary-button" onClick={onUndo} disabled={!canUndo}><RotateCcw />撤销</button>
          <button type="button" className="secondary-button" onClick={onRedo} disabled={!canRedo}><RotateCw />重做</button>
          <button type="button" className="secondary-button" onClick={onClear}><Eraser />清空</button>
        </div>
      </section>

      <section className="map-editor-step">
        <h3>保存</h3>
        {typeof forceCityCount === 'number' && (
          <p
            className={forceCityCount > 0 ? 'map-editor-force-count' : 'map-editor-force-count is-warning'}
            data-testid="editor-force-count"
          >
            {forceCityCount > 0
              ? `本图有主城池 ${forceCityCount} 座，可用于单机开局。`
              : '本图还没有「有主城池」，无法用于单机开局 —— 放置城池时请选择归属势力。'}
          </p>
        )}
        {builtinSource && (
          <p className="map-editor-force-count is-warning" data-testid="editor-builtin-hint">
            这是内置地图：单机开局恒走内置场景，直接改它不会生效 —— 保存将另存为新的自定义地图。
          </p>
        )}
        <p>
          {builtinSource
            ? '内置图不能覆盖保存，保存会另存为新的自定义地图（默认名加「（副本）」）。缓存保存仅写入浏览器；本地保存同时下载 JSON 文件。'
            : '改名保存会另存为新地图，沿用原名则覆盖原图。缓存保存仅写入浏览器；本地保存同时下载 JSON 文件。'}
        </p>
        <label className="map-editor-background-field">
          <span>地图名</span>
          <input
            aria-label="地图名"
            value={saveName}
            onChange={(event) => setSaveName(event.currentTarget.value)}
            placeholder="输入地图名字"
          />
        </label>
        <div className="map-editor-save-actions">
          <button
            type="button"
            className="secondary-button map-editor-full-button"
            data-testid="editor-save-cache"
            title="仅保存在浏览器缓存中，不下载文件"
            onClick={() => {
              if (saveName.trim()) onSave(saveName.trim(), 'cache');
            }}
            disabled={!saveName.trim()}
          >
            <Save />缓存保存
          </button>
          <button
            type="button"
            className="primary-button map-editor-full-button"
            data-testid="editor-save-local"
            title="保存在浏览器缓存中，并下载地图文件"
            onClick={() => {
              if (saveName.trim()) onSave(saveName.trim(), 'local');
            }}
            disabled={!saveName.trim()}
          >
            <Download />本地保存
          </button>
        </div>
      </section>
    </section>
  );
}