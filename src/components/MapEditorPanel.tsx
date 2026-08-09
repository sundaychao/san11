import { Brush, Castle, FileImage, FileJson, FileText, Mountain, RotateCcw, RotateCw, Trash2, Waves } from 'lucide-react';
import type { MapEditorTool } from '../game/map-editor/editor';
import type { TerrainType } from '../game/types';
import { closePopupOnContextMenu } from './popupEvents';

interface MapEditorPanelProps {
  activeTool: MapEditorTool;
  backgroundImage: string;
  canRedo: boolean;
  canUndo: boolean;
  calibrationMode: boolean;
  exportValue: string;
  onBackgroundImageChange(value: string): void;
  onBackgroundImageUpload(file: File): void;
  onCalibrationModeChange(value: boolean): void;
  onClear(): void;
  onClose(): void;
  onExportJson(): void;
  onExportMasks(): void;
  onExportTerrainControl(): void;
  onImportJsonFile(file: File): void;
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
  { tool: 'shallowWater', label: '浅水', icon: Waves },
  { tool: 'deepWater', label: '深水', icon: Waves },
];

export function MapEditorPanel({
  activeTool,
  backgroundImage,
  canRedo,
  canUndo,
  calibrationMode,
  exportValue,
  onBackgroundImageChange,
  onBackgroundImageUpload,
  onCalibrationModeChange,
  onClear,
  onClose,
  onExportJson,
  onExportMasks,
  onExportTerrainControl,
  onImportJsonFile,
  onRedo,
  onSelectTool,
  onUndo,
}: MapEditorPanelProps) {
  const activeLabel = activeTool === 'city' ? '城市' : TERRAIN_TOOLS.find((item) => item.tool === activeTool)?.label;

  return (
    <section className="map-editor-panel tool-panel" data-testid="map-editor-panel" aria-label="地图编辑器" onContextMenu={(event) => closePopupOnContextMenu(event, onClose)}>
      <header>
        <div>
          <p>方格图</p>
          <h2>地图编辑器</h2>
        </div>
        <button type="button" className="secondary-button" onClick={onClose}>关闭</button>
      </header>

      <section className="map-editor-step">
        <h3>第一步：编辑规则地形</h3>
        <p>这里编辑的是游戏规则数据，移动、战斗和城市占地都以这些方格为准。</p>
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
      </section>

      <section className="map-editor-step">
        <h3>第二步：导出给 AI 的素材</h3>
        <p>先导出控制图和分层遮罩，再用生成地图流程制作水墨底图。</p>
        <p>导出后，把 terrain-control.svg 和所有 mask-*.svg 文件交给 AI，用 san11-map-generation 生成水墨地图图片。</p>
        <div className="map-editor-actions map-editor-actions-stack">
          <button type="button" className="secondary-button" onClick={onExportTerrainControl}><FileImage />导出 AI 控制图</button>
          <button type="button" className="secondary-button" onClick={onExportMasks}><FileImage />导出 AI 分层遮罩</button>
        </div>
      </section>

      <section className="map-editor-step">
        <h3>第三步：导入生成地图并校准</h3>
        <p>把生成后的水墨地图作为底图显示，再逐格修正不匹配的地形标记。</p>
        <p>AI 生成图片后，直接选择图片文件；编辑器会自动显示底图并进入校准模式。</p>
        <label className="map-editor-upload-field">
          <span>选择 AI 生成的地图图片</span>
          <input
            aria-label="选择 AI 生成的地图图片"
            type="file"
            accept="image/png,image/jpeg,image/webp,image/svg+xml"
            onChange={(event) => {
              const file = event.currentTarget.files?.[0];
              if (file) onBackgroundImageUpload(file);
              event.currentTarget.value = '';
            }}
          />
        </label>
        <label className="map-editor-calibration">
          <input
            type="checkbox"
            checked={calibrationMode}
            onChange={(event) => onCalibrationModeChange(event.currentTarget.checked)}
          />
          <span>显示生成地图，进入校准模式</span>
        </label>

        <details className="map-editor-advanced-path">
          <summary>手动输入图片路径</summary>
          <label className="map-editor-background-field">
            <span>底图地址</span>
            <input
              aria-label="底图地址"
              value={backgroundImage}
              onChange={(event) => onBackgroundImageChange(event.currentTarget.value)}
              placeholder="exports/watercolor-map-realistic-preview.png"
            />
          </label>
        </details>
      </section>

      <section className="map-editor-step">
        <h3>第四步：导出最终游戏数据</h3>
        <p>校准完成后导出 JSON；之后也可以把这份 JSON 导入回来，让当前游戏地图读取它。</p>
        <button type="button" className="primary-button map-editor-full-button" onClick={onExportJson}><FileJson />导出最终游戏地图 JSON</button>
        <label className="map-editor-upload-field">
          <span>导入最终游戏地图 JSON</span>
          <input
            aria-label="导入最终游戏地图 JSON"
            type="file"
            accept="application/json,.json"
            onChange={(event) => {
              const file = event.currentTarget.files?.[0];
              if (file) onImportJsonFile(file);
              event.currentTarget.value = '';
            }}
          />
        </label>
      </section>

      <p className="map-editor-status">当前工具：{activeLabel}</p>
      <textarea data-testid="map-editor-export" readOnly value={exportValue} aria-label="地图编辑导出结果" />
    </section>
  );
}
