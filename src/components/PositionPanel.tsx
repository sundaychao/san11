import { useEffect, useMemo, useRef, useState } from 'react';
import { POSITIONS, forceRankOf, officerIsOnCampaign, officerMerit, positionDefinition, rankDefinition, rankIndex, type PositionDef } from '../game/ranks';
import { useGame } from '../game/store/GameProvider';
import type { CityId, ForceId, GameState, Officer } from '../game/types';

interface PositionPanelProps {
  /** 锁定本势力（右键城菜单时传入；undefined 时可切换查看所有势力） */
  lockForceId?: ForceId;
  onClose(): void;
}

/** 功绩要求文案：0 表示无需功绩 */
function meritRequirementText(merit: number): string {
  return merit > 0 ? `需功绩 ${merit}` : '无需功绩';
}

const STAT_LABEL: Record<keyof PositionDef['statBonus'], string> = {
  leadership: '统',
  war: '武',
  intelligence: '智',
  politics: '政',
  charisma: '魅',
};

function formatStatBonus(bonus: PositionDef['statBonus']): string {
  const parts = Object.entries(bonus)
    .filter(([, v]) => v)
    .map(([k, v]) => `${STAT_LABEL[k as keyof PositionDef['statBonus']] ?? k}+${v}`);
  return parts.join(' ');
}

/** 获取武将所在城（用于 issueCommand 必填的 cityId）。非在城则取首城。 */
function officerCityId(state: GameState, officer: Officer): CityId {
  const loc = officer.location;
  if (loc.kind === 'city' || loc.kind === 'unaffiliated' || loc.kind === 'task' || loc.kind === 'captive') {
    return loc.cityId;
  }
  if (loc.kind === 'transfer') return loc.fromCityId;
  return Object.values(state.cities)[0]?.id ?? 'wan';
}

interface DragPayload {
  officerId: string;
  from: 'list' | 'position';
  positionId?: string;
}

export function PositionPanel({ lockForceId, onClose }: PositionPanelProps) {
  const game = useGame();
  const state = game.state;
  const issueCommand = game.issueCommand;
  const [viewForceId, setViewForceId] = useState<ForceId>(
    lockForceId ?? state?.playerForceId ?? 'cao',
  );
  const [drag, setDrag] = useState<DragPayload | null>(null);
  const [hoverPositionId, setHoverPositionId] = useState<string | null>(null);
  const [hoverList, setHoverList] = useState(false);
  // 记录最近一次任免事件：用于在武将名右侧显示↑/↓稳定徽标（同档不写入，toPosId='' 代表免职回列表）
  const [lastAppointment, setLastAppointment] = useState<{ officerId: string; fromPosId: string; toPosId: string } | null>(null);

  // 展示顺序与原版一致：高爵在前（丞相置顶）、低爵在后；
  // sort 稳定，同功绩组保持数据原序（文官在前、武官在后）
  const positions = useMemo(() => [...POSITIONS].sort((a, b) => b.merit - a.merit), []);
  const positionListRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = positionListRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, []);

  if (!state) return null;
  const safeState = state;

  const force = safeState.forces[viewForceId];
  const forceRankIdx = rankIndex(forceRankOf(safeState, viewForceId));
  const isPlayerView = viewForceId === safeState.playerForceId;

  const officers = useMemo(() => {
    const leaderId = safeState.forces[viewForceId]?.leaderId;
    return Object.values(safeState.officers)
      .filter((o) => o.forceId === viewForceId && o.id !== leaderId)
      .sort((a, b) => officerMerit(b) - officerMerit(a));
  }, [safeState.officers, safeState.forces, viewForceId]);

  // 右列表只显示尚未任官职的武将；已任者以"holder"形式出现在左侧官职行
  const availableOfficers = useMemo(() => {
    return officers.filter((o) => !o.positionId);
  }, [officers]);

  // 右列表排序：列名 → 方向
  type SortKey = 'name' | 'merit' | 'position' | 'command' | 'leadership' | 'war' | 'intelligence' | 'politics';
  const [sortKey, setSortKey] = useState<SortKey>('merit');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const toggleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir(sortDir === 'asc' ? 'desc' : 'asc');
    } else {
      setSortKey(key);
      setSortDir(key === 'name' || key === 'position' ? 'asc' : 'desc');
    }
  };
  const sortedAvailable = useMemo(() => {
    const dir = sortDir === 'asc' ? 1 : -1;
    const valueOf = (officer: typeof availableOfficers[number]) => {
      switch (sortKey) {
        case 'name': return officer.name;
        case 'merit': return officerMerit(officer);
        case 'position': return officer.positionId ? positionDefinition(officer.positionId)?.name ?? '' : '—';
        case 'command': return officer.positionId ? positionDefinition(officer.positionId)?.troopCommand ?? 0 : 0;
        case 'leadership': return officer.stats.leadership;
        case 'war': return officer.stats.war;
        case 'intelligence': return officer.stats.intelligence;
        case 'politics': return officer.stats.politics;
      }
    };
    return [...availableOfficers].sort((a, b) => {
      const va = valueOf(a);
      const vb = valueOf(b);
      if (typeof va === 'number' && typeof vb === 'number') return (va - vb) * dir;
      return String(va).localeCompare(String(vb), 'zh-Hans-CN') * dir;
    });
  }, [availableOfficers, sortKey, sortDir]);

  const canDropTo = (positionId: string, officerId: string): boolean => {
    const officer = safeState.officers[officerId];
    const pos = positionDefinition(positionId);
    if (!officer || !pos) return false;
    if (safeState.forces[viewForceId]?.leaderId === officerId) return false;
    if (!isPlayerView) return false;
    if (officerIsOnCampaign(safeState, officerId)) return false;
    return officerMerit(officer) >= pos.merit && forceRankIdx >= rankIndex(pos.rankNeeded);
  };

  // 官职行上的"⊙ 可晋升"静态标志：现任 holder 功绩已达更高官职（且爵位足、目标空缺）时，
  // 在其能晋升到的最高目标官职行标记；key = 目标官职 id，value = 可晋升到该官职的武将名
  const promotionMap = new Map<string, string[]>();
  if (isPlayerView) {
    const heldIds = new Set(officers.map((o) => o.positionId).filter(Boolean) as string[]);
    officers.forEach((officer) => {
      if (!officer.positionId || officerIsOnCampaign(safeState, officer.id)) return;
      const current = positionDefinition(officer.positionId);
      const merit = officerMerit(officer);
      if (!current || merit < current.merit) return;
      let target: PositionDef | null = null;
      for (const candidate of POSITIONS) {
        if (
          candidate.merit > current.merit &&
          candidate.merit <= merit &&
          rankIndex(candidate.rankNeeded) <= forceRankIdx &&
          !heldIds.has(candidate.id)
        ) {
          target = candidate;
        }
      }
      if (target) {
        const names = promotionMap.get(target.id) ?? [];
        names.push(officer.name);
        promotionMap.set(target.id, names);
      }
    });
  }

  // 拖拽悬停时的临时标志：晋升↑ / 降格↓；首次授职也视为晋升，调至同功绩档不显示
  const dragFlagOf = (pos: PositionDef): { kind: 'up' | 'down'; text: string } | null => {
    if (!drag) return null;
    const officer = safeState.officers[drag.officerId];
    if (!officer) return null;
    const source = officer.positionId ? positionDefinition(officer.positionId) : null;
    if (!source) return { kind: 'up', text: `任命晋升 → ${pos.name}` };
    if (source.id === pos.id) return null;
    return pos.merit > source.merit
      ? { kind: 'up', text: `晋升：${source.name} → ${pos.name}` }
      : { kind: 'down', text: `降格：${source.name} → ${pos.name}` };
  };

  const handleDragStart = (payload: DragPayload) => (event: React.DragEvent) => {
    if (!isPlayerView) {
      event.preventDefault();
      return;
    }
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('application/json', JSON.stringify(payload));
    setDrag(payload);
  };

  const handleDragEnd = () => {
    setDrag(null);
    setHoverPositionId(null);
    setHoverList(false);
  };

  const handlePositionDragOver = (positionId: string) => (event: React.DragEvent) => {
    if (!drag) return;
    const allowed = canDropTo(positionId, drag.officerId);
    event.preventDefault();
    event.dataTransfer.dropEffect = allowed ? 'move' : 'none';
    if (allowed) setHoverPositionId(positionId);
  };

  const handlePositionDrop = (positionId: string) => (event: React.DragEvent) => {
    event.preventDefault();
    if (!drag || !canDropTo(positionId, drag.officerId)) {
      handleDragEnd();
      return;
    }
    const officer = safeState.officers[drag.officerId];
    const fromPosId = officer.positionId ?? '';
    // 平级（同档）：不写 lastAppointment，holder 处不显示徽标
    const target = positionDefinition(positionId);
    const source = fromPosId ? positionDefinition(fromPosId) : null;
    if (!(source && target && source.id !== target.id && source.merit === target.merit)) {
      setLastAppointment({ officerId: drag.officerId, fromPosId, toPosId: positionId });
    }
    issueCommand({
      type: 'appointPosition',
      cityId: officerCityId(safeState, officer),
      officerId: drag.officerId,
      positionId,
    });
    handleDragEnd();
  };

  const handleListDragOver = (event: React.DragEvent) => {
    if (!drag) return;
    if (drag.from === 'position') {
      event.preventDefault();
      event.dataTransfer.dropEffect = 'move';
      setHoverList(true);
    }
  };

  const handleListDrop = (event: React.DragEvent) => {
    event.preventDefault();
    if (!drag || drag.from !== 'position') {
      handleDragEnd();
      return;
    }
    const officer = safeState.officers[drag.officerId];
    if (!officer.positionId || officerIsOnCampaign(safeState, officer.id)) {
      handleDragEnd();
      return;
    }
    setLastAppointment({ officerId: drag.officerId, fromPosId: officer.positionId, toPosId: '' });
    issueCommand({
      type: 'appointPosition',
      cityId: officerCityId(safeState, officer),
      officerId: drag.officerId,
      positionId: '',
    });
    handleDragEnd();
  };

  const handleRemoveAll = () => {
    if (!isPlayerView) return;
    officers.forEach((officer) => {
      if (officer.positionId && !officerIsOnCampaign(safeState, officer.id)) {
        issueCommand({
          type: 'appointPosition',
          cityId: officerCityId(safeState, officer),
          officerId: officer.id,
          positionId: '',
        });
      }
    });
  };

  const handleAutoAssign = () => {
    if (!isPlayerView) return;
    const sorted = [...officers].sort((a, b) => officerMerit(b) - officerMerit(a));
    const usedPositionIds = new Set<string>();
    sorted.forEach((officer) => {
      if (safeState.forces[viewForceId]?.leaderId === officer.id) return;
      if (officerIsOnCampaign(safeState, officer.id)) {
        // 城外带兵者不可任免：保留其现职并占位，避免目标官职被重复分配
        if (officer.positionId) usedPositionIds.add(officer.positionId);
        return;
      }
      const merit = officerMerit(officer);
      const candidate = [...POSITIONS]
        .reverse()
        .find((pos) => pos.merit <= merit && rankIndex(pos.rankNeeded) <= forceRankIdx && !usedPositionIds.has(pos.id));
      if (candidate) {
        const current = officer.positionId ? positionDefinition(officer.positionId) : null;
        const need = !current || current.merit > merit;
        if (need) {
          usedPositionIds.add(candidate.id);
          issueCommand({
            type: 'appointPosition',
            cityId: officerCityId(safeState, officer),
            officerId: officer.id,
            positionId: candidate.id,
          });
        } else if (current) {
          usedPositionIds.add(current.id);
        }
      } else if (officer.positionId) {
        issueCommand({
          type: 'appointPosition',
          cityId: officerCityId(safeState, officer),
          officerId: officer.id,
          positionId: '',
        });
      }
    });
  };

  if (!force) return null;

  return (
    <div className="position-panel-overlay" role="dialog" aria-label="官职任命">
      <div className="position-panel">
        <header className="position-panel-header">
          <h2>官职</h2>
          {lockForceId === undefined ? (
            <select
              aria-label="切换势力"
              value={viewForceId}
              onChange={(event) => {
                setViewForceId(event.target.value as ForceId);
                setDrag(null);
              }}
            >
              {Object.values(safeState.forces).map((f) => (
                <option key={f.id} value={f.id}>{f.name}</option>
              ))}
            </select>
          ) : (
            <span className="position-panel-force">{force.name}</span>
          )}
          <span className="position-panel-rank">爵位：{rankDefinition(forceRankOf(safeState, viewForceId)).name}</span>
        </header>

        <div className="position-panel-body">
          <div className="position-panel-left" ref={positionListRef}>
            <table className="position-table" aria-label="官职列表">
              <thead>
                <tr>
                  <th>官职名</th>
                  <th>功绩</th>
                  <th>指挥</th>
                  <th>俸禄</th>
                  <th>效果</th>
                  <th>武将</th>
                </tr>
              </thead>
              <tbody>
                {positions.map((pos) => {
                  // 白/灰分档：拖拽中按被拖武将的功绩划线，默认按我方（在城可调动的）武将最高功绩划线；
                  // 官职要求随档位单调，故逐行判断即等价于"最高可授档（含）及以下为白"
                  const eligible = drag
                    ? canDropTo(pos.id, drag.officerId)
                    : isPlayerView &&
                      forceRankIdx >= rankIndex(pos.rankNeeded) &&
                      officers.some((o) => officerMerit(o) >= pos.merit && !officerIsOnCampaign(safeState, o.id));
                  const occupied = officers.find((o) => o.positionId === pos.id);
                  const holderLocked = occupied ? officerIsOnCampaign(safeState, occupied.id) : false;
                  const isHover = hoverPositionId === pos.id;
                  const canReceive = drag && canDropTo(pos.id, drag.officerId);
                  const promotable = promotionMap.get(pos.id);
                  return (
                    <tr
                      key={pos.id}
                      className={[
                        eligible ? 'position-row-eligible' : 'position-row-locked',
                        occupied ? 'position-row-occupied' : '',
                        isHover && canReceive ? 'position-row-accept' : '',
                        isHover && !canReceive ? 'position-row-reject' : '',
                      ].filter(Boolean).join(' ')}
                      onDragOver={handlePositionDragOver(pos.id)}
                      onDragLeave={() => setHoverPositionId((id) => (id === pos.id ? null : id))}
                      onDrop={handlePositionDrop(pos.id)}
                    >
                      <td className="position-name">
                        {pos.name}
                        {promotable ? (
                          <span
                            className="merit-badge merit-available"
                            title={`可晋升：${promotable.join('、')}（${meritRequirementText(pos.merit)}）`}
                          >
                            ⊙
                          </span>
                        ) : null}
                      </td>
                      <td>{pos.merit}</td>
                      <td>{pos.troopCommand}</td>
                      <td>{pos.salary}</td>
                      <td className="position-effect">{formatStatBonus(pos.statBonus) || '—'}</td>
                      <td className="position-holder-cell">
                        {occupied ? (() => {
                          // 放下后稳定显示的升降徽标：仅当 lastAppointment 指向当前 holder 且 toPosId === pos.id
                          let status: { kind: 'up' | 'down'; text: string } | null = null;
                          if (lastAppointment && lastAppointment.officerId === occupied.id && lastAppointment.toPosId === pos.id) {
                            const fromDef = lastAppointment.fromPosId ? positionDefinition(lastAppointment.fromPosId) : null;
                            const toDef = positionDefinition(pos.id);
                            if (toDef) {
                              if (fromDef && fromDef.merit !== toDef.merit) {
                                status = toDef.merit > fromDef.merit
                                  ? { kind: 'up', text: `晋升：${fromDef.name} → ${toDef.name}` }
                                  : { kind: 'down', text: `降格：${fromDef.name} → ${toDef.name}` };
                              } else if (!fromDef) {
                                status = { kind: 'up', text: `首次任职：${toDef.name}` };
                              }
                            }
                          }
                          return (
                            <span
                              className={`position-holder${holderLocked ? ' position-holder-locked' : ''}`}
                              draggable={isPlayerView && !holderLocked}
                              onDragStart={handleDragStart({ officerId: occupied.id, from: 'position', positionId: pos.id })}
                              onDragEnd={handleDragEnd}
                              title={holderLocked ? '正带部队在城外，不可任免' : '拖到右侧武将列表即可免官'}
                            >
                              {occupied.name}
                              {status ? (
                                <span className={`merit-badge merit-${status.kind}`} title={status.text}>
                                  {status.kind === 'up' ? '↑' : '↓'}
                                </span>
                              ) : null}
                            </span>
                          );
                        })() : (
                          <span className="position-empty">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="position-panel-arrows" aria-hidden="true">
            <div className="position-arrow">← 任命</div>
            <div className="position-arrow">免职 →</div>
          </div>

          <div
            className={`position-panel-right ${hoverList ? 'position-list-hover' : ''}`}
            onDragOver={handleListDragOver}
            onDragLeave={() => setHoverList(false)}
            onDrop={handleListDrop}
          >
            <table className="officer-table" aria-label="武将列表">
              <thead>
                <tr>
                  {(
                    [
                      ['name', '武将'],
                      ['merit', '功绩'],
                      ['position', '旧官职'],
                      ['command', '指挥'],
                      ['leadership', '统率'],
                      ['war', '武力'],
                      ['intelligence', '智力'],
                      ['politics', '政治'],
                    ] as Array<[SortKey, string]>
                  ).map(([key, label]) => {
                    const active = sortKey === key;
                    return (
                      <th key={key} className={`sortable${active ? ' is-active' : ''}`} aria-sort={active ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none'}>
                        <button type="button" onClick={() => toggleSort(key)}>
                          <span>{label}</span>
                          <span className="sort-arrow">{active ? (sortDir === 'asc' ? '↑' : '↓') : ''}</span>
                        </button>
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {sortedAvailable.map((officer) => {
                  const current = officer.positionId ? positionDefinition(officer.positionId) : null;
                  const fieldLocked = officerIsOnCampaign(safeState, officer.id);
                  return (
                    <tr
                      key={officer.id}
                      className={[
                        'officer-row',
                        isPlayerView && !fieldLocked ? 'officer-row-draggable' : '',
                        current ? 'officer-row-has-position' : '',
                        fieldLocked ? 'officer-row-field-locked' : '',
                      ].filter(Boolean).join(' ')}
                    >
                      <td>
                        <span
                          className="officer-name"
                          draggable={isPlayerView && !fieldLocked}
                          onDragStart={handleDragStart({ officerId: officer.id, from: 'list' })}
                          onDragEnd={handleDragEnd}
                          title={fieldLocked ? '正带部队在城外，不可任免' : undefined}
                        >
                          {officer.name}
                        </span>
                      </td>
                      <td>{officerMerit(officer)}</td>
                      <td>{current?.name ?? '—'}</td>
                      <td>{current?.troopCommand ?? 5000}</td>
                      <td>{officer.stats.leadership}</td>
                      <td>{officer.stats.war}</td>
                      <td>{officer.stats.intelligence}</td>
                      <td>{officer.stats.politics}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        <footer className="position-panel-footer">
          <div className="position-panel-actions">
            <button type="button" onClick={handleAutoAssign} disabled={!isPlayerView}>自动设定</button>
            <button type="button" onClick={handleRemoveAll} disabled={!isPlayerView}>全部解除</button>
            <button type="button" onClick={onClose}>决定</button>
            <button type="button" onClick={onClose}>返回</button>
          </div>
          <div className="position-panel-legend">
            <span><span className="merit-badge merit-up">↑</span> 晋升</span>
            <span><span className="merit-badge merit-down">↓</span> 降格</span>
            <span><span className="merit-badge merit-available">⊙</span> 可晋升</span>
          </div>
        </footer>
      </div>
    </div>
  );
}
