import { useState } from 'react';
import {
  Brush, Castle, Droplets, Eraser, FileText, Grid3x3, Mountain, RotateCcw, RotateCw, Save, TreePine, Waves,
} from 'lucide-react';
import { useAudioEventAdapter } from '../audio/reactAudioEventAdapter';
import type { MapEditorTool } from '../game/map-editor/editor';
import type { TerrainType } from '../game/types';

export interface MapEditorPanelProps {
  activeTool: MapEditorTool;
  canRedo: boolean;
  canUndo: boolean;
  plotCity?: { id: string; label: string } | null;
  canConfirmPlots: boolean;
  onBack(): void;
  onClear(): void;
  onClearPlotCity(): void;
  onConfirmPlots(): void;
  onRedo(): void;
  onSave(name: string): void;
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
  canRedo,
  canUndo,
  plotCity,
  canConfirmPlots,
  onBack,
  onClear,
  onClearPlotCity,
  onConfirmPlots,
  onRedo,
  onSave,
  onSelectTool,
  onUndo,
}: MapEditorPanelProps) {
  const audio = useAudioEventAdapter();
  const [saveName, setSaveName] = useState('');

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
                <div className="map-editor-plot-actions">
                  <button
                    type="button"
                    className="primary-button"
                    disabled={!canConfirmPlots}
                    onClick={onConfirmPlots}
                  >
                    确定
                  </button>
                  <button type="button" className="secondary-button" onClick={onClearPlotCity}>取消选择</button>
                </div>
              </>
            ) : (
              <span>请先点击一座城池，选择要圈建设用地的归属城</span>
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
        <p>输入地图名字后保存，返回地图列表可再次进入编辑。</p>
        <label className="map-editor-background-field">
          <span>地图名</span>
          <input
            aria-label="地图名"
            value={saveName}
            onChange={(event) => setSaveName(event.currentTarget.value)}
            placeholder="输入地图名字"
          />
        </label>
        <button
          type="button"
          className="primary-button map-editor-full-button"
          onClick={() => {
            if (saveName.trim()) onSave(saveName.trim());
          }}
          disabled={!saveName.trim()}
        >
          <Save />保存地图
        </button>
      </section>
    </section>
  );
}