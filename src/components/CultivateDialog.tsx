import { X } from 'lucide-react';
import { useMemo, useState } from 'react';
import { COMMAND_AP } from '../game/commands';
import {
  ABILITY_NODES,
  ABILITY_NODE_MAP,
  APTITUDE_NAMES,
  STAT_NAMES,
  abilityEffectText,
  canCultivateOfficer,
  abilityCultivateRemaining,
  isAbilityResearched,
} from '../game/abilityResearch';
import { useGame } from '../game/store/GameProvider';
import { officerSkillsText } from '../game/skills';
import type { CityId, Officer, PassId } from '../game/types';

export type CultivateCategory = 'stat' | 'aptitude' | 'skill';

interface CultivateDialogProps {
  cityId: CityId;
  /** 关隘据点 id：存在时以关隘为宿主（执行武将从关隘驻军中选取） */
  passId?: PassId;
  category: CultivateCategory;
  onClose: () => void;
}

const CATEGORY_TITLE: Record<CultivateCategory, string> = {
  stat: '培育基础能力',
  aptitude: '培育兵种适性',
  skill: '培育特技',
};

/** 把节点按截图 UI 顺序分类（基础：按属性+档次；适性：按兵种+档；特技：按列表顺序） */
function getStatRows() {
  // 5 属性 × 3 档（低、中、高）= 15 节点，2 行 5 属性，其中属性顺序：统/武/智/政/魅
  const order: Array<keyof typeof STAT_NAMES> = ['leadership', 'war', 'intelligence', 'politics', 'charisma'];
  return order.map((stat) => {
    const low = ABILITY_NODES.find((n) => n.kind === 'stat' && n.stat === stat && n.cap === 70);
    const mid = ABILITY_NODES.find((n) => n.kind === 'stat' && n.stat === stat && n.cap === 80);
    const high = ABILITY_NODES.find((n) => n.kind === 'stat' && n.stat === stat && n.cap === 95);
    return { stat, nodes: [low, mid, high] as const };
  });
}

function getAptitudeRows() {
  // 6 兵种 B/A，两行三列（每列一个兵种 B+A）
  const order: Array<keyof typeof APTITUDE_NAMES> = ['spear', 'halberd', 'crossbow', 'cavalry', 'siege', 'navy'];
  return order.map((apt) => {
    const b = ABILITY_NODES.find((n) => n.kind === 'aptitude' && n.aptitude === apt && n.toGrade === 'B');
    const a = ABILITY_NODES.find((n) => n.kind === 'aptitude' && n.aptitude === apt && n.toGrade === 'A');
    return { aptitude: apt, nodes: [b, a] as const };
  });
}

function getSkillRows(): Array<Array<typeof ABILITY_NODES[number] | undefined>> {
  // 按列表顺序 8+9+5 排列（参考截图三行：8列、9列、5列）
  const skills = ABILITY_NODES.filter((n) => n.kind === 'skill');
  return [skills.slice(0, 8), skills.slice(8, 17), skills.slice(17, 22)];
}

const STAT_LABEL_ORDER = ['统', '武', '智', '政', '魅'] as const;
const STAT_KEY_ORDER: Array<keyof typeof STAT_NAMES> = ['leadership', 'war', 'intelligence', 'politics', 'charisma'];

function statBadgeColor(stat: keyof typeof STAT_NAMES): string {
  switch (stat) {
    case 'war':
      return 'var(--cult-stat-war)';
    case 'leadership':
      return 'var(--cult-stat-lead)';
    case 'intelligence':
      return 'var(--cult-stat-int)';
    case 'politics':
      return 'var(--cult-stat-pol)';
    case 'charisma':
      return 'var(--cult-stat-cha)';
  }
}

function categoryCssClass(cat: CultivateCategory): string {
  return cat === 'stat' ? 'cultivate-stat' : cat === 'aptitude' ? 'cultivate-apt' : 'cultivate-skill';
}

export function CultivateDialog({ cityId, passId, category, onClose }: CultivateDialogProps) {
  const { state, issueCommand } = useGame();
  const forceId = state?.playerForceId;
  const garrison = passId ? state?.passes?.[passId] : state?.cities[cityId];
  if (!state || !forceId || !garrison) return null;

  const officers: Officer[] = useMemo(
    () =>
      Object.values(state.officers).filter(
        (officer) =>
          officer.forceId === forceId &&
          (passId
            ? officer.location.kind === 'pass' && officer.location.passId === passId
            : officer.location.kind === 'city' && officer.location.cityId === cityId),
      ),
    [state, forceId, cityId, passId],
  );

  const [selectedOfficerId, setSelectedOfficerId] = useState<string | null>(officers[0]?.id ?? null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);

  const selectedOfficer = selectedOfficerId ? state.officers[selectedOfficerId] : null;
  const selectedNode = selectedNodeId ? ABILITY_NODE_MAP[selectedNodeId] ?? null : null;

  const ap = state.actionPoints[forceId] ?? 0;

  const onSubmit = () => {
    if (!selectedOfficer || !selectedNode) return;
    const remain = abilityCultivateRemaining(state, forceId, selectedNode.id);
    if (remain <= 0 || !canCultivateOfficer(selectedOfficer, selectedNode)) return;
    if (ap < COMMAND_AP.cultivate) return;
    issueCommand({ type: 'cultivate', cityId, passId, officerId: selectedOfficer.id, nodeId: selectedNode.id });
    onClose();
  };

  // —— 渲染部分 ——
  const statRows = useMemo(() => getStatRows(), []);
  const aptRows = useMemo(() => getAptitudeRows(), []);
  const skillRows = useMemo(() => getSkillRows(), []);

  const canSubmit =
    Boolean(selectedOfficer) &&
    Boolean(selectedNode) &&
    abilityCultivateRemaining(state, forceId, selectedNode!.id) > 0 &&
    canCultivateOfficer(selectedOfficer!, selectedNode!) &&
    ap >= COMMAND_AP.cultivate;

  return (
    <div className="modal-backdrop" aria-label={`${CATEGORY_TITLE[category]}对话框`} onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <form
        className={`dialog cultivate-dialog ${categoryCssClass(category)}`}
        data-testid={`cultivate-${category}-dialog`}
        onClick={(e) => e.stopPropagation()}
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit();
        }}
      >
        <header className="dialog-header">
          <span>{CATEGORY_TITLE[category]}</span>
          <button type="button" className="dialog-close" aria-label="关闭" onClick={onClose}><X aria-hidden="true" /></button>
        </header>

        {/* 执行武将卡片 */}
        <section className="cultivate-officer-card">
          <label className="field-label" aria-hidden="true">执行武将</label>
          <div className="cultivate-officer-body">
            <div className="cultivate-officer-avatar">
              <span className="officer-avatar-badge">{selectedOfficer?.name?.slice(0, 1) ?? '—'}</span>
              <span className="cultivate-officer-name">{selectedOfficer?.name ?? '未选择'}</span>
            </div>
            <select
              aria-label="执行武将"
              className="cultivate-officer-select"
              value={selectedOfficerId ?? ''}
              onChange={(e) => setSelectedOfficerId(e.target.value || null)}
            >
              {officers.map((officer) => (
                <option key={officer.id} value={officer.id}>
                  {officer.name}
                </option>
              ))}
            </select>

            {category === 'stat' && (
              <div className="cultivate-stats-grid">
                {STAT_LABEL_ORDER.map((label, i) => (
                  <div key={label} className="cultivate-stat-item">
                    <span className="cultivate-stat-label" style={{ color: statBadgeColor(STAT_KEY_ORDER[i]) }}>
                      {label}
                    </span>
                    <span className="cultivate-stat-value">
                      {selectedOfficer ? selectedOfficer.stats[STAT_KEY_ORDER[i]] : '—'}
                    </span>
                  </div>
                ))}
              </div>
            )}

            {category === 'aptitude' && selectedOfficer && (
              <div className="cultivate-aptitude-grid">
                {(Object.keys(APTITUDE_NAMES) as Array<keyof typeof APTITUDE_NAMES>).map((k) => (
                  <div key={k} className="cultivate-apt-item">
                    <span className="cultivate-apt-name">{APTITUDE_NAMES[k]}</span>
                    <span className="cultivate-apt-grade">
                      {selectedOfficer.aptitudes?.[k] ?? 'C'}
                    </span>
                  </div>
                ))}
              </div>
            )}

            {category === 'skill' && selectedOfficer && (
              <div className="cultivate-skill-row">
                <span className="cultivate-skill-label">特技</span>
                <span className="cultivate-skill-value">{officerSkillsText(selectedOfficer)}</span>
              </div>
            )}
          </div>
        </section>

        {/* 节点网格 */}
        <section className="cultivate-grid-panel">
          {category === 'stat' && (
            <div className="cultivate-grid cultivate-grid-stat" aria-label="基础能力节点">
              {statRows.map(({ stat, nodes }) => (
                <div key={stat} className="cultivate-stat-row" style={{ borderColor: statBadgeColor(stat) }}>
                  {nodes.map((node) =>
                    node ? (
                      <CultivateNode
                        key={node.id}
                        node={node}
                        selected={selectedNodeId === node.id}
                        researched={isAbilityResearched(state, forceId, node.id)}
                        remaining={abilityCultivateRemaining(state, forceId, node.id)}
                        eligible={selectedOfficer ? canCultivateOfficer(selectedOfficer, node) : false}
                        onClick={() => setSelectedNodeId(node.id)}
                      />
                    ) : null,
                  )}
                </div>
              ))}
            </div>
          )}

          {category === 'aptitude' && (
            <div className="cultivate-grid cultivate-grid-apt" aria-label="兵种适性节点">
              {aptRows.map(({ aptitude, nodes }) => (
                <div key={aptitude} className="cultivate-apt-col">
                  {nodes.map((node) =>
                    node ? (
                      <CultivateNode
                        key={node.id}
                        node={node}
                        selected={selectedNodeId === node.id}
                        researched={isAbilityResearched(state, forceId, node.id)}
                        remaining={abilityCultivateRemaining(state, forceId, node.id)}
                        eligible={selectedOfficer ? canCultivateOfficer(selectedOfficer, node) : false}
                        onClick={() => setSelectedNodeId(node.id)}
                      />
                    ) : null,
                  )}
                </div>
              ))}
            </div>
          )}

          {category === 'skill' && (
            <div className="cultivate-grid cultivate-grid-skill" aria-label="特技节点">
              {skillRows.map((row, r) => (
                <div key={r} className="cultivate-skill-row-grid" style={{ gridTemplateColumns: `repeat(${row.length}, minmax(0, 1fr))` }}>
                  {row.map((node) =>
                    node ? (
                      <CultivateNode
                        key={node.id}
                        node={node}
                        selected={selectedNodeId === node.id}
                        researched={isAbilityResearched(state, forceId, node.id)}
                        remaining={abilityCultivateRemaining(state, forceId, node.id)}
                        eligible={selectedOfficer ? canCultivateOfficer(selectedOfficer, node) : false}
                        onClick={() => setSelectedNodeId(node.id)}
                      />
                    ) : null,
                  )}
                </div>
              ))}
            </div>
          )}
        </section>

        {/* 期间 / 效果 / 特技栏 */}
        <section className="cultivate-info" aria-label="培育说明">
          <div><span>期间</span><strong>{selectedNode ? '30日（3旬）' : '—'}</strong></div>
          <div><span>效果</span><strong>{selectedNode ? abilityEffectText(selectedNode) : '请从上方选择培育项目'}</strong></div>
          {category === 'skill' && (
            <div><span>特技</span><strong>{selectedNode ? selectedNode.label : '—'}</strong></div>
          )}
        </section>

        {/* 行动力 + 按钮 */}
        <footer className="cultivate-footer">
          <div className="cultivate-ap">
            <span>行动力</span>
            <strong>
              {COMMAND_AP.cultivate}/{ap}
            </strong>
          </div>
          <div className="cultivate-actions">
            <button type="button" className="primary-button" onClick={onClose}>返回</button>
            <button
              type="submit"
              className="primary-button danger"
              disabled={!canSubmit}
              title={
                !selectedOfficer
                  ? '请选择执行武将'
                  : !selectedNode
                    ? '请选择培育项目'
                    : abilityCultivateRemaining(state, forceId, selectedNode.id) <= 0
                      ? '该项目培育次数已用完'
                      : !canCultivateOfficer(selectedOfficer, selectedNode)
                        ? '选中武将不满足培育条件'
                        : ap < COMMAND_AP.cultivate
                          ? '行动力不足'
                          : `决定·培育`
              }
            >
              决定
            </button>
          </div>
        </footer>
      </form>
    </div>
  );
}

/** 单个培育节点按钮（椭圆胶囊 + 剩余次数方框） */
function CultivateNode({
  node,
  selected,
  researched,
  remaining,
  eligible,
  onClick,
}: {
  node: typeof ABILITY_NODES[number];
  selected: boolean;
  /** 该节点是否已研究完成（无论培育次数是否用尽） */
  researched: boolean;
  remaining: number;
  eligible: boolean;
  onClick: () => void;
}) {
  const kindClass =
    node.kind === 'skill'
      ? 'is-skill'
      : node.kind === 'aptitude'
        ? 'is-apt'
        : 'is-stat';
  const catClass = node.kind === 'stat' && node.stat ? `cat-stat-${node.stat}` : `cat-${node.category}`;
  // 已研究的节点（含次数用尽）统一用分类填充色；未研究置灰；选中金色、可培育亮金框
  const statusClass = !researched
    ? 'is-locked'
    : selected
      ? 'is-selected'
      : eligible && remaining > 0
        ? 'is-eligible'
        : 'is-done';

  return (
    <button
      type="button"
      className={`cultivate-node ${kindClass} ${catClass} ${statusClass}`}
      onClick={onClick}
      disabled={!researched}
      title={!researched ? '尚未研究完成' : remaining > 0 ? undefined : '培育次数已用完'}
    >
      <span className="cultivate-node-label">{node.label}</span>
      <span className={`cultivate-node-box ${remaining > 0 ? 'has-count' : ''}`}>
        {remaining > 0 ? `剩${remaining}次` : researched ? '已用完' : ''}
      </span>
    </button>
  );
}
