import { TECH_TREE_LEVELS, TECH_TREE_NODES, TECH_TREE_SYSTEMS, type TechSystemId } from './techTreeData';

/**
 * 新版科技树界面。
 *
 * 按参考图排布：顶部六层箭头标题+各层资金／技巧值需求；中部九大系统科技节点，
 * 同层内用箭头连到「下一个可研究层次」；底部为系统图例。
 *
 * 状态与选中均为**可选**：不传 `nodeStatus` / `onSelectNode` 时与纯展示版完全一致
 * （节点不可点击、统一系统配色）；传入后按状态着色并支持点击选点。
 */

/** 节点状态：done=已研究／researching=正在研究／current=当前可研究／available=可研究（非当前选择）／locked=前置未满足 */
export type TechNodeStatus = 'done' | 'current' | 'available' | 'locked' | 'researching';

export interface TechTreePanelProps {
  /** 可选：查询某节点状态（不传则所有节点按普通样式绘制） */
  nodeStatus?(nodeId: string): TechNodeStatus;
  /** 可选：当前选中的节点 id（额外加一圈外框） */
  selectedNodeId?: string;
  /** 可选：点击节点回调（传入后节点可点击；不传则纯展示） */
  onSelectNode?(nodeId: string): void;
}

/** 各状态的描边／透明度覆写（未列出的状态用系统配色）。
 *  「可研究（current）」是默认状态、节点数量最多，不画描边，避免整棵树被浅色框线塞满、压住文字；
 *  真正需要突出的只有：已研究（绿）、正在研究（橙）、未解锁（暗），以及被选中的那一个（外框虚线）。 */
const STATUS_STROKE: Record<TechNodeStatus, { stroke: string; strokeWidth: number }> = {
  // 已研究：不画框，只用右上角对勾表示（避免整片浅色框线压住文字）
  done: { stroke: 'none', strokeWidth: 0 },
  researching: { stroke: '#e0a077', strokeWidth: 2.4 },
  current: { stroke: 'none', strokeWidth: 0 },
  available: { stroke: 'none', strokeWidth: 0 },
  locked: { stroke: '#6f6a5d', strokeWidth: 1.4 },
};

/** 未解锁节点整体压暗（含文字），与「可研究」形成对比 */
const LOCKED_OPACITY = 0.42;

/** 未研究科技的统一底色（深灰）——只有一个已研究的节点才显示系统配色 */
const UNRESEARCHED_FILL = '#3a3a36';

/** 六列的左上角 x 坐标：列间距 120 = 节点框 96 + 24 的箭头走线空间 */
const COLUMN_X = [34, 154, 274, 394, 514, 634];
/** 节点框宽度：科技名最长 4 字（12.5px ≈ 50px），96 足够放下名字与右上角状态角标 */
const BOX_W = 96;
const BOX_H = 23;
/** 第 1 行节点框顶部 y */
const FIRST_ROW_TOP = 56;
const ROW_PITCH = 29;
/** 画布宽度 = 左右各留一点边距后刚好包住六列，比原来的 1129 窄约 1/3 */
const CANVAS_W = 750;
const CANVAS_H = 522;

const HEADER_TOP = 4;
const HEADER_H = 28;
/** 层级标题条宽度取「列间距 - 4」，六条首尾相接成一条绶带 */
const HEADER_W = 116;
const HEADER_NOTCH = 12;
/** 标题条相对节点框左边缘的偏移：让标题条居中在本列的列位上 */
const HEADER_LEFT_OFFSET = (BOX_W - HEADER_W) / 2;
const COST_TEXT_Y = HEADER_TOP + HEADER_H + 14;

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

export function TechTreePanel({ nodeStatus, selectedNodeId, onSelectNode }: TechTreePanelProps = {}) {
  const connectors = buildConnectors();
  /** 可点击时节点框会显示手型并进入 Tab 顺序 */
  const clickable = Boolean(onSelectNode);

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

        {/* 科技节点（传入 nodeStatus / onSelectNode 时按状态着色并支持点击） */}
        <g className="tech-tree-nodes">
          {TECH_TREE_NODES.map((node) => {
            const system = systemOf(node.system);
            const x = boxX(node.level);
            const y = boxY(node.row);
            const status = nodeStatus?.(node.id);
            const stroke = status ? STATUS_STROKE[status] : null;
            // 底色：已研究 / 当前可研究 → 保留系统配色；
            // 还没轮到的（前置未满足、正在研究中）→ 统一深灰，形成一面「够不到的墙」
            const colored = !status || status === 'done' || status === 'current' || status === 'available';
            const fill = colored ? system.fill : UNRESEARCHED_FILL;
            const selected = selectedNodeId === node.id;
            const centerY = y + BOX_H / 2;
            return (
              <g
                key={node.id}
                data-testid={`tech-node-${node.id}`}
                className={`tech-tree-node${status ? ` is-${status}` : ''}${selected ? ' is-selected' : ''}`}
                style={{
                  cursor: clickable ? 'pointer' : undefined,
                  opacity: status === 'locked' ? LOCKED_OPACITY : undefined,
                }}
                role={clickable ? 'button' : undefined}
                tabIndex={clickable ? 0 : undefined}
                aria-pressed={clickable ? selected : undefined}
                aria-label={clickable ? `${node.name}（Lv${node.level}）` : undefined}
                onClick={clickable ? () => onSelectNode!(node.id) : undefined}
                onKeyDown={clickable ? (event) => {
                  if (event.key !== 'Enter' && event.key !== ' ') return;
                  event.preventDefault();
                  onSelectNode!(node.id);
                } : undefined}
              >
                <rect
                  x={x}
                  y={y}
                  width={BOX_W}
                  height={BOX_H}
                  rx={3}
                  fill={fill}
                  stroke={stroke ? stroke.stroke : system.color}
                  strokeWidth={stroke ? stroke.strokeWidth : 1.6}
                />
                <text
                  x={x + BOX_W / 2}
                  y={centerY}
                  textAnchor="middle"
                  dominantBaseline="central"
                  fill="#ffffff"
                  fontSize={12.5}
                  fontWeight={700}
                  style={NODE_TEXT_STYLE}
                >
                  {node.name}
                </text>
                {/* 已研究：右上角对勾 */}
                {status === 'done' && (
                  <path
                    d={`M${x + BOX_W - 21},${centerY} l4,4.5 l8,-10`}
                    fill="none"
                    stroke="#d7f0c6"
                    strokeWidth={2.2}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                )}
                {/* 研究中：右上角小座钟 */}
                {status === 'researching' && (
                  <g fill="none" stroke="#ffd9b0" strokeWidth={1.4} strokeLinecap="round">
                    <circle cx={x + BOX_W - 13} cy={centerY} r={6} />
                    <path d={`M${x + BOX_W - 13},${centerY - 3.6} V${centerY} H${x + BOX_W - 9.6}`} />
                  </g>
                )}
                {/* 选中：外圈虚线框（全树只有这一个，用来告诉玩家「点的是哪一个」） */}
                {selected && (
                  <rect
                    x={x - 3}
                    y={y - 3}
                    width={BOX_W + 6}
                    height={BOX_H + 6}
                    rx={5}
                    fill="none"
                    stroke="#fff6d6"
                    strokeWidth={1.6}
                    strokeDasharray="5 3"
                  />
                )}
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
            const left = COLUMN_X[index] + HEADER_LEFT_OFFSET;
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
                  fontSize={11}
                  fontWeight={700}
                  style={UI_TEXT_STYLE}
                >
                  {`金${item.gold}｜技${item.techP}`}
                </text>
              </g>
            );
          })}
        </g>
      </svg>
    </div>
  );
}
