import type { TerrainType } from './types';

/**
 * 地形中文名：底部坐标/地形/疆域提示条的唯一口径。
 * 游戏中（GameShell）与地图编辑器（MapEditorScreen）共用本表，别再各写一份。
 */
export const TERRAIN_LABELS: Record<TerrainType, string> = {
  road: '主径',
  path: '小径',
  plank: '栈道',
  plain: '平地',
  grass: '草地',
  sand: '沙地',
  wasteland: '荒地',
  wetland: '湿地',
  poison: '毒泉',
  forest: '森林',
  hill: '丘陵',
  mountain: '山崖',
  shore: '岸',
  water: '水域',
  stream: '川',
  river: '河',
  sea: '海',
  shallow: '浅滩',
  ferry: '渡口',
  pass: '关隘',
  construction: '建设用地',
};
