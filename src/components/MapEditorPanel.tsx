import { Brush, Castle, FileJson, FileText, Mountain, RotateCcw, RotateCw, Trash2, Waves } from 'lucide-react';
import type { MapEditorTool } from '../game/map-editor/editor';
import type { TerrainType } from '../game/types';

interface MapEditorPanelProps {
  activeTool: MapEditorTool;
  canRedo: boolean;
  canUndo: boolean;
  exportValue: string;
  onClear(): void;
  onClose(): void;
  onExportJson(): void;
  onExportSvg(): void;
  onRedo(): void;
  onSelectTool(tool: MapEditorTool): void;
  onUndo(): void;
}

const TERRAIN_TOOLS: Array<{ tool: TerrainType; label: string; icon: typeof Brush }> = [
  { tool: 'plain', label: '平地', icon: Brush },
  { tool: 'road', label: '道路', icon: FileText },
  { tool: 'forest', label: '森林', icon: Brush },
  { tool: 'hill', label: '丘陵', icon: Mountain },
  { tool: 'mountain', label: '高山', icon: Mountain },
  { tool: 'deepWater', label: '深水', icon: Waves },
];

export function MapEditorPanel({
  activeTool,
  canRedo,
  canUndo,
  exportValue,
  onClear,
  onClose,
  onExportJson,
  onExportSvg,
  onRedo,
  onSelectTool,
  onUndo,
}: MapEditorPanelProps) {
  const activeLabel = activeTool === 'city' ? '城市' : TERRAIN_TOOLS.find((item) => item.tool === activeTool)?.label;

  return (
    <section className="map-editor-panel tool-panel" aria-label="地图编辑器">
      <header>
        <div>
          <p>方格图</p>
          <h2>地图编辑器</h2>
        </div>
        <button type="button" className="secondary-button" onClick={onClose}>关闭</button>
      </header>

      <div className="map-editor-tools" aria-label="地形刷子">
        {TERRAIN_TOOLS.map(({ tool, label, icon: Icon }) => (
          <button
            key={tool}
            type="button"
            className={activeTool === tool ? 'is-active' : ''}
            aria-pressed={activeTool === tool}
            onClick={() => onSelectTool(tool)}
          >
            <Icon />
            <span>{label}</span>
          </button>
        ))}
        <button
          type="button"
          className={activeTool === 'city' ? 'is-active' : ''}
          aria-pressed={activeTool === 'city'}
          onClick={() => onSelectTool('city')}
        >
          <Castle />
          <span>城市</span>
        </button>
      </div>

      <div className="map-editor-actions">
        <button type="button" className="secondary-button" onClick={onUndo} disabled={!canUndo}><RotateCcw />撤销</button>
        <button type="button" className="secondary-button" onClick={onRedo} disabled={!canRedo}><RotateCw />重做</button>
        <button type="button" className="secondary-button" onClick={onClear}><Trash2 />清空</button>
      </div>

      <div className="map-editor-actions">
        <button type="button" className="primary-button" onClick={onExportJson}><FileJson />导出 JSON</button>
        <button type="button" className="secondary-button" onClick={onExportSvg}><FileText />导出 SVG</button>
      </div>

      <p className="map-editor-status">当前工具：{activeLabel}</p>
      <textarea data-testid="map-editor-export" readOnly value={exportValue} aria-label="地图编辑导出结果" />
    </section>
  );
}
