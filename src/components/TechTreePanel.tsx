import { TECH_TREE_LEVELS, TECH_TREE_NODES, TECH_TREE_SYSTEMS, type TechSystemId } from './techTreeData';

/**
 * 新版科技树界面（展示用）。
 *
 * 按参考图排布：顶部六层箭头标题+各层资金／技巧值需求；中部九大系统科技节点，
 * 同层内用箭头连到「下一个可研究层次」；底部为系统图例。
 * 目前只呈现名称、等级与连线，节点不可点击，也不对接 src/game/techs.ts 的既有研究机制。
 */

/** 六列的左上角 x 坐标（与参考图列位一致） */
const COLUMN_X = [40, 220, 400, 579, 759, 938];
const BOX_W = 139;
const BOX_H = 25;
/** 第 1 行节点框顶部 y */
const FIRST_ROW_TOP = 74;
const ROW_PITCH = 37;
const CANVAS_W = 1129;
const CANVAS_H = 700;

const HEADER_TOP = 4;
const HEADER_H = 28;
const HEADER_W = 148;
const HEADER_NOTCH = 18;
const COST_TEXT_Y = HEADER_TOP + HEADER_H + 18;

const LEGEND_TOP = 668;
const LEGEND_H = 25;
const LEGEND_W = 106;
const LEGEND_GAP = 8;

/** 连线／箭头：深色底上取暖灰，与面板描边同系 */
const LINE_COLOR = '#8b8272';

const systemOf = (id: TechSystemId) => TECH_TREE_SYSTEMS.find((system) => system.id === id)!;
const nodeById = (id: string) => TECH_TREE_NODES.find((node) => node.id === id);
const boxX = (level: number) => COLUMN_X[level - 1];
const boxY = (row: number) => FIRST_ROW_TOP + (row - 1) * ROW_PITCH;

interface Connector {
  key: string;
  trunk: string | null;
  arrow: string;
}

/** 计算「前置 → 本节点」的连接线：同行为直线，跨行先画竖直主干再横向入节点 */
function buildConnectors(): Connector[] {
  return TECH_TREE_NODES.filter((node) => node.prev).map((node) => {
    const parent = nodeById(node.prev!)!;
    const parentCenterX = boxX(parent.level) + BOX_W / 2;
    const parentCenterY = boxY(parent.row) + BOX_H / 2;
    const childCenterY = boxY(node.row) + BOX_H / 2;
    const childLeft = boxX(node.level);
    const arrow = `M${boxX(parent.level) + BOX_W},${parentCenterY} H${childLeft - 9}`;
    if (parent.row === node.row) {
      return { key: `${parent.id}->${node.id}`, trunk: null, arrow };
    }
    const trunk = `M${parentCenterX},${Math.min(parentCenterY, childCenterY)} V${Math.max(parentCenterY, childCenterY)}`;
    return {
      key: `${parent.id}->${node.id}`,
      trunk,
      arrow: `M${parentCenterX},${childCenterY} H${childLeft - 9}`,
    };
  });
}

const NODE_TEXT_STYLE = { fontFamily: 'STKaiti, KaiTi, "Noto Serif SC", serif' } as const;
const UI_TEXT_STYLE = { fontFamily: '"Microsoft YaHei", "Segoe UI", sans-serif' } as const;

export function TechTreePanel() {
  const connectors = buildConnectors();

  return (
    <div className="tech-tree-panel" data-testid="tech-tree-panel">
      <svg
        className="tech-tree-svg"
        viewBox={`0 0 ${CANVAS_W} ${CANVAS_H}`}
        role="img"
        aria-label="科技树"
        data-testid="tech-tree"
      >
        <defs>
          <linearGradient id="tech-tree-header-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#5b5040" />
            <stop offset="100%" stopColor="#332e25" />
          </linearGradient>
          <marker
            id="tech-tree-arrow-head"
            markerWidth="9"
            markerHeight="9"
            refX="8"
            refY="4.5"
            orient="auto"
            markerUnits="userSpaceOnUse"
          >
            <path d="M0,0 L9,4.5 L0,9 Z" fill={LINE_COLOR} />
          </marker>
        </defs>

        {/* 底色交给 CSS 面板（与游戏 UI 同一深色系），此处不铺白底 */}
        <rect x={0} y={0} width={CANVAS_W} height={CANVAS_H} fill="transparent" />

        {/* 主干连线（画在节点下方，被节点框遮住中段） */}
        <g className="tech-tree-trunks">
          {connectors.map((connector) => (connector.trunk ? (
            <path key={connector.key} d={connector.trunk} fill="none" stroke={LINE_COLOR} strokeWidth={1.4} />
          ) : null))}
        </g>

        {/* 科技节点 */}
        <g className="tech-tree-nodes">
          {TECH_TREE_NODES.map((node) => {
            const system = systemOf(node.system);
            const x = boxX(node.level);
            const y = boxY(node.row);
            return (
              <g key={node.id} data-testid={`tech-node-${node.id}`}>
                <rect
                  x={x}
                  y={y}
                  width={BOX_W}
                  height={BOX_H}
                  rx={3}
                  fill={system.fill}
                  stroke={system.color}
                  strokeWidth={1.6}
                />
                <text
                  x={x + BOX_W / 2}
                  y={y + BOX_H / 2}
                  textAnchor="middle"
                  dominantBaseline="central"
                  fill="#ffffff"
                  fontSize={12.5}
                  fontWeight={700}
                  style={NODE_TEXT_STYLE}
                >
                  {node.name}
                </text>
              </g>
            );
          })}
        </g>

        {/* 横向箭头（到各科技左侧） */}
        <g className="tech-tree-arrows">
          {connectors.map((connector) => (
            <path
              key={connector.key}
              d={connector.arrow}
              fill="none"
              stroke={LINE_COLOR}
              strokeWidth={1.4}
              markerEnd="url(#tech-tree-arrow-head)"
            />
          ))}
        </g>

        {/* 层级标题与各层费用 */}
        <g className="tech-tree-headers">
          {TECH_TREE_LEVELS.map((item, index) => {
            const left = COLUMN_X[index] - 34;
            const midY = HEADER_TOP + HEADER_H / 2;
            const right = left + HEADER_W;
            const bottom = HEADER_TOP + HEADER_H;
            const d = [
              `M${left},${HEADER_TOP}`,
              `L${right - HEADER_NOTCH},${HEADER_TOP}`,
              `L${right},${midY}`,
              `L${right - HEADER_NOTCH},${bottom}`,
              `L${left},${bottom}`,
              `L${left + HEADER_NOTCH},${midY}`,
              'Z',
            ].join(' ');
            return (
              <g key={item.level} data-testid={`tech-level-${item.level}`}>
                <path d={d} fill="url(#tech-tree-header-fill)" stroke="#928873" strokeWidth={1} />
                <text
                  x={left + HEADER_W / 2 - HEADER_NOTCH / 2}
                  y={midY}
                  textAnchor="middle"
                  dominantBaseline="central"
                  fill="#e8d9ac"
                  fontSize={16}
                  fontWeight={700}
                  style={UI_TEXT_STYLE}
                >
                  {`Lv${item.level}`}
                </text>
                <text
                  x={left + HEADER_W / 2}
                  y={COST_TEXT_Y}
                  textAnchor="middle"
                  dominantBaseline="central"
                  fill="#cdc2a0"
                  fontSize={12}
                  fontWeight={700}
                  style={UI_TEXT_STYLE}
                >
                  {`金${item.gold}｜技${item.techP}`}
                </text>
              </g>
            );
          })}
        </g>

        {/* 系统图例 */}
        <g className="tech-tree-legend">
          {TECH_TREE_SYSTEMS.map((system, index) => {
            const x = 6 + index * (LEGEND_W + LEGEND_GAP);
            return (
              <g key={system.id} data-testid={`tech-system-${system.id}`}>
                <rect
                  x={x}
                  y={LEGEND_TOP}
                  width={LEGEND_W}
                  height={LEGEND_H}
                  rx={4}
                  fill={system.fill}
                  stroke={system.color}
                  strokeWidth={1.4}
                />
                <text
                  x={x + LEGEND_W / 2}
                  y={LEGEND_TOP + LEGEND_H / 2 - 1}
                  textAnchor="middle"
                  dominantBaseline="central"
                  fill="#ffffff"
                  fontSize={12}
                  fontWeight={700}
                  style={NODE_TEXT_STYLE}
                >
                  {system.name}
                </text>
              </g>
            );
          })}
        </g>
      </svg>
    </div>
  );
}
