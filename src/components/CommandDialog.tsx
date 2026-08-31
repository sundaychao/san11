import { AlertCircle, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { useAudioEventAdapter } from '../audio/reactAudioEventAdapter';
import { ARMAMENT_GOLD_COST, ARMAMENT_LABELS, ARMAMENT_TYPES, armamentsOf, isDelayedArmament, produceArmamentYield } from '../game/armaments';
import { COMMAND_AP, COMMAND_LABELS, TRADE_MAX_GRAIN, grainPriceOf, quoteTrade, tradeEffectMultiplier, tradeEffectPercent, transferDuration, validateCommand } from '../game/commands';
import { MAX_TECH_LEVEL, TECH_BRANCHES, TECH_COSTS, researchTenDays, techLevelOf } from '../game/techs';
import { ABILITY_CENTER, ABILITY_NODE_MAP, ABILITY_NODES, ABILITY_RESEARCH_GOLD, ABILITY_TREE_COLS, ABILITY_TREE_ROWS, abilityCultivateRemaining, abilityEffectText, abilityKindLabel, abilityNodeStatus, canCultivateOfficer } from '../game/abilityResearch';
import { useGame } from '../game/store/GameProvider';
import type { ArmamentType, CityId, GameCommand, TechBranchId } from '../game/types';
import { closePopupOnContextMenu } from './popupEvents';

interface CommandDialogProps {
  type: GameCommand['type'];
  cityId: CityId;
  onClose(): void;
}

export function CommandDialog({ type, cityId, onClose }: CommandDialogProps) {
  const { state, issueCommand } = useGame();
  const audio = useAudioEventAdapter();
  const [officerId, setOfficerId] = useState('');
  const [focus, setFocus] = useState<'commerce' | 'agriculture'>('commerce');
  const [armamentType, setArmamentType] = useState<ArmamentType>('spear');
  const [targetCityId, setTargetCityId] = useState<CityId | ''>('');
  const [officerIds, setOfficerIds] = useState<string[]>([]);
  // 交易滑块：0=不交易，负值=卖出兵粮，正值=买入兵粮（单位：兵粮）
  const [tradeValue, setTradeValue] = useState(0);
  // 技巧研究：选中的科技方向
  const [researchBranch, setResearchBranch] = useState<TechBranchId>('spear');
  // 能力研究：选中的节点 + 培育武将
  const [abilityNodeId, setAbilityNodeId] = useState<string>('warLow');
  const [cultivateOfficerId, setCultivateOfficerId] = useState('');
  const [submitError, setSubmitError] = useState<string | null>(null);
  const dialogRef = useRef<HTMLFormElement>(null);
  const previousFocus = useRef<HTMLElement | null>(null);

  useEffect(() => {
    previousFocus.current = document.activeElement as HTMLElement | null;
    const dialog = dialogRef.current;
    const firstControl = dialog?.querySelector<HTMLElement>('select:not([disabled]), input:not([disabled])') ??
      dialog?.querySelector<HTMLElement>('button:not([disabled])');
    firstControl?.focus();
    return () => previousFocus.current?.focus();
  }, []);

  if (!state) return null;
  const city = state.cities[cityId];
  const officers = Object.values(state.officers).filter((officer) =>
    officer.forceId === state.playerForceId && officer.location.kind === 'city' && officer.location.cityId === cityId,
  );
  const availableOfficers = officers.filter((officer) => !officer.acted);
  const tradeOfficers = [...availableOfficers].sort((a, b) => b.stats.politics - a.stats.politics);
  // 技巧研究：按所选方向的研究属性排序武将
  const researchBranchDef = TECH_BRANCHES.find((branch) => branch.id === researchBranch)!;
  const researchStatKey = researchBranchDef.researchStat;
  const researchOfficers = [...availableOfficers].sort((a, b) => b.stats[researchStatKey] - a.stats[researchStatKey]);
  const researchOfficerId = officerId || researchOfficers[0]?.id || '';
  const activeOfficerId = type === 'research'
    ? researchOfficerId
    : officerId
      || (type === 'trade' ? tradeOfficers[0]?.id : availableOfficers[0]?.id)
      || '';
  const targetCities = Object.values(state.cities).filter((item) => item.ownerId === state.playerForceId && item.id !== cityId);
  const activeTargetId = targetCityId || targetCities[0]?.id || '';
  const activeTargetCity = activeTargetId ? state.cities[activeTargetId] : undefined;
  const activeTransferDuration = activeTargetCity ? transferDuration(city, activeTargetCity) : null;
  const activeOfficer = activeOfficerId ? state.officers[activeOfficerId] : undefined;
  const cityArmaments = armamentsOf(city.armaments);
  const productionGain = activeOfficer ? produceArmamentYield(activeOfficer, armamentType) : 0;
  const grainPrice = grainPriceOf(city);
  const tradeEffect = activeOfficer ? tradeEffectMultiplier(activeOfficer.stats.politics) : 1;
  const tradePercent = activeOfficer ? tradeEffectPercent(activeOfficer.stats.politics) : 100;
  // 滑块左卖右买、居中为0：右侧可买上限受资金限制，左侧可卖上限受兵粮限制，均不超过单次30000
  const tradeBuyMax = activeOfficer
    ? Math.min(TRADE_MAX_GRAIN, Math.floor(city.gold * grainPrice * tradeEffect))
    : 0;
  const tradeSellMax = Math.min(TRADE_MAX_GRAIN, city.food);
  const tradeValueClamped = Math.max(-tradeSellMax, Math.min(tradeValue, tradeBuyMax));
  const tradeIdle = tradeValueClamped === 0;
  const tradeMode: 'buy' | 'sell' = tradeValueClamped >= 0 ? 'buy' : 'sell';
  const tradeAmount = Math.abs(tradeValueClamped);
  const tradeQuote = activeOfficer && !tradeIdle
    ? quoteTrade(city, activeOfficer.stats.politics, tradeMode, tradeAmount)
    : { goldDelta: 0, foodDelta: 0 };

  // —— 能力研究 ——
  const abilityNode = ABILITY_NODE_MAP[abilityNodeId];
  const abilityStatus = abilityNode ? abilityNodeStatus(state, state.playerForceId, abilityNode) : 'locked';
  const abilityRemaining = abilityNode ? abilityCultivateRemaining(state, state.playerForceId, abilityNode.id) : 0;
  const abilityActive = state.forces[state.playerForceId]?.abilityResearch?.active;
  const cultivateMode = abilityStatus === 'done' && abilityRemaining > 0;
  const cultivateCandidates = abilityNode
    ? availableOfficers.filter((officer) => canCultivateOfficer(officer, abilityNode))
    : [];
  const cultivateOfficerChosen = cultivateOfficerId || cultivateCandidates[0]?.id || '';

  const command = useMemo<GameCommand>(() => {
    if (type === 'transfer') {
      return { type, cityId, targetCityId: activeTargetId as CityId, officerIds };
    }
    if (type === 'abilityResearch') {
      if (abilityNode && abilityStatus === 'done') {
        // 已研究完成：仅允许培育（次数用尽时返回 cultivate 命令，由验证拦截报错）
        return { type: 'cultivate', cityId, officerId: cultivateOfficerChosen, nodeId: abilityNode.id };
      }
      return { type: 'abilityResearch', cityId, nodeId: abilityNodeId };
    }
    const base = { cityId, officerId: activeOfficerId };
    if (type === 'develop') return { ...base, type, focus };
    if (type === 'produceArmament') return { ...base, type, armamentType };
    if (type === 'research') return { ...base, type, branch: researchBranch };
    if (type === 'trade') return { ...base, type, mode: tradeValue >= 0 ? 'buy' : 'sell', amount: Math.min(Math.abs(tradeValue), TRADE_MAX_GRAIN) };
    return { ...base, type } as GameCommand;
  }, [abilityNode, abilityNodeId, activeOfficerId, activeTargetId, armamentType, cityId, cultivateMode, cultivateOfficerChosen, focus, officerIds, researchBranch, tradeValue, type]);

  const errors = validateCommand(state, state.playerForceId, command);
  const label = COMMAND_LABELS[type];
  // 滑块居中（0）时只显示商人到访/交易次数类错误，隐藏数量类校验
  const visibleErrors = type === 'trade' && tradeIdle
    ? errors.filter((error) => error.includes('商人') || error.includes('交易'))
    : errors;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (errors.length > 0) return;
    try {
      issueCommand(command);
      onClose();
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : '指令执行失败');
    }
  };

  const toggleTransferOfficer = (id: string) => {
    setOfficerIds((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
  };

  const handleDialogKeyDown = (event: ReactKeyboardEvent<HTMLFormElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      onClose();
      return;
    }
    if (event.key !== 'Tab') return;
    const focusable = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('button:not([disabled]), select:not([disabled]), input:not([disabled])'));
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable.at(-1)!;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  const estimatedCost = type === 'develop' || type === 'talent'
    ? '资金 500'
    : type === 'recruit'
      ? '资金 800 · 兵粮 500'
      : type === 'train'
        ? '兵粮 300'
        : type === 'produceArmament'
          ? `资金 ${ARMAMENT_GOLD_COST} · ${ARMAMENT_LABELS[armamentType]} +${productionGain.toLocaleString('en-US')} · ${isDelayedArmament(armamentType) ? '1个月' : '即时'}`
          : type === 'patrol'
            ? '资金 300'
            : type === 'trade'
              ? `粮价 1金=${grainPrice}粮 · 交易效果 ${tradePercent}%`
              : type === 'research'
                ? (() => {
                  const level = techLevelOf(state, state.playerForceId, researchBranch);
                  if (level >= MAX_TECH_LEVEL) return '该方向已研究完毕';
                  const cost = TECH_COSTS[level];
                  const statValue = activeOfficer ? activeOfficer.stats[researchStatKey] : 50;
                  return `资金 ${cost.gold} · 技巧P ${cost.techP} · ${researchTenDays(cost.baseTenDays, statValue)}旬`;
                })()
                : type === 'abilityResearch'
                  ? cultivateMode
                    ? `培育武将 · 30日（3旬）· 剩余培育次数 ${abilityRemaining}`
                    : `资金 ${ABILITY_RESEARCH_GOLD} · 研究 ${abilityNode?.months ?? 0} 个月`
                  : activeTransferDuration
              ? `人员调动 · ${activeTransferDuration}旬`
              : '人员调动';

  return (
    <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()} onContextMenu={(event) => closePopupOnContextMenu(event, onClose, audio)}>
      <form ref={dialogRef} className="command-dialog tool-panel" role="dialog" aria-modal="true" aria-labelledby="command-title" onSubmit={submit} onKeyDown={handleDialogKeyDown}>
        <header>
          <div><p>{city.name}政务 · 行动力 {COMMAND_AP[type]}</p><h2 id="command-title">{label}</h2></div>
          <button type="button" className="icon-button" aria-label="关闭指令" title="关闭" onClick={onClose}><X /></button>
        </header>

        {type !== 'transfer' && type !== 'abilityResearch' && (
          <label className="field-row">
            <span>执行武将</span>
            <select aria-label="执行武将" value={activeOfficerId} onChange={(event) => setOfficerId(event.target.value)}>
              {officers.map((officer) => (
                <option key={officer.id} value={officer.id} disabled={officer.acted}>
                  {officer.name} · {type === 'research' && researchStatKey === 'leadership' ? `统${officer.stats.leadership}` : `政${officer.stats.politics}`} 智{officer.stats.intelligence}{officer.acted ? '（已行动）' : ''}
                </option>
              ))}
            </select>
          </label>
        )}

        {type === 'develop' && (
          <fieldset className="segmented-field">
            <legend>开发方向</legend>
            <div>
              <label><input type="radio" name="focus" checked={focus === 'commerce'} onChange={() => setFocus('commerce')} /><span>商业</span></label>
              <label><input type="radio" name="focus" checked={focus === 'agriculture'} onChange={() => setFocus('agriculture')} /><span>农业</span></label>
            </div>
          </fieldset>
        )}

        {type === 'produceArmament' && (
          <section className="produce-armament-panel" aria-label="生产兵装选择">
            <div className="produce-armament-grid">
              {ARMAMENT_TYPES.map((item) => {
                const selected = armamentType === item;
                const stock = cityArmaments[item];
                const nextStock = selected ? stock + productionGain : stock;
                return (
                  <button
                    key={item}
                    type="button"
                    aria-label={ARMAMENT_LABELS[item]}
                    className={selected ? 'is-active' : ''}
                    onClick={() => setArmamentType(item)}
                  >
                    <strong>{ARMAMENT_LABELS[item]}</strong>
                    <span>{selected ? `${stock.toLocaleString('en-US')} → ${nextStock.toLocaleString('en-US')}` : stock.toLocaleString('en-US')}</span>
                  </button>
                );
              })}
            </div>
            <dl className="produce-stock">
              <div><dt>资金</dt><dd>{city.gold.toLocaleString('en-US')} → {Math.max(0, city.gold - ARMAMENT_GOLD_COST).toLocaleString('en-US')}</dd></div>
              <div><dt>期间</dt><dd>{isDelayedArmament(armamentType) ? '1个月' : '即时'}</dd></div>
              <div><dt>效果</dt><dd>有利于对应兵种出征</dd></div>
            </dl>
          </section>
        )}

        {type === 'trade' && (
          <section className="trade-panel" aria-label="商人交易">
            <div className={`trade-slider-wrap${tradeIdle ? '' : tradeMode === 'buy' ? ' is-buy' : ' is-sell'}`}>
              <input
                type="range"
                min={-TRADE_MAX_GRAIN}
                max={TRADE_MAX_GRAIN}
                step={100}
                value={tradeValueClamped}
                onChange={(event) => {
                  const raw = Number(event.target.value);
                  setTradeValue(raw > 0 ? Math.min(raw, tradeBuyMax) : Math.max(raw, -tradeSellMax));
                }}
                aria-label="交易数量"
                aria-valuetext={tradeIdle ? '不交易' : `${tradeMode === 'buy' ? '买入' : '卖出'}${tradeAmount}兵粮`}
              />
            </div>
            <dl className="trade-quote">
              <div><dt>资金</dt><dd>{city.gold.toLocaleString('en-US')} → {Math.max(0, city.gold + tradeQuote.goldDelta).toLocaleString('en-US')}</dd></div>
              <div><dt>兵粮</dt><dd>{city.food.toLocaleString('en-US')} → {Math.max(0, city.food + tradeQuote.foodDelta).toLocaleString('en-US')}</dd></div>
            </dl>
            <div className="command-note">向左拖动卖出兵粮（八成折价），向右拖动买入兵粮；单次最多交易{TRADE_MAX_GRAIN.toLocaleString('en-US')}兵粮</div>
          </section>
        )}

        {type === 'research' && (
          <section className="tech-research-panel" aria-label="科技研究">
            <table className="tech-table">
              <thead>
                <tr>
                  <th scope="col">等级</th>
                  {[1, 2, 3, 4].map((lv) => <th key={lv} scope="col">{lv}</th>)}
                </tr>
                <tr className="tech-cost-row">
                  <th scope="row">技巧P／资金</th>
                  {TECH_COSTS.map((cost) => (
                    <th key={cost.gold}>{cost.techP.toLocaleString('en-US')}／{cost.gold.toLocaleString('en-US')}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {TECH_BRANCHES.map((branch) => {
                  const level = techLevelOf(state, state.playerForceId, branch.id);
                  return (
                    <tr key={branch.id}>
                      <th scope="row">{branch.name}</th>
                      {branch.levels.map((tech, index) => {
                        const done = index < level;
                        const isNext = index === level && level < MAX_TECH_LEVEL;
                        const selected = isNext && researchBranch === branch.id;
                        return (
                          <td key={tech.name}>
                            {isNext ? (
                              <button
                                type="button"
                                className={selected ? 'is-selected' : ''}
                                aria-pressed={selected}
                                title={tech.description}
                                onClick={() => setResearchBranch(branch.id)}
                              >
                                {tech.name}
                              </button>
                            ) : (
                              <span className={done ? 'is-done' : 'is-locked'} title={done ? tech.description : `需先研究${branch.levels[index - 1]?.name ?? '前置科技'}`}>
                                {tech.name}
                              </span>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {(() => {
              const level = techLevelOf(state, state.playerForceId, researchBranch);
              const cost = TECH_COSTS[level];
              const tech = researchBranchDef.levels[level];
              const statValue = activeOfficer ? activeOfficer.stats[researchStatKey] : 50;
              const forceTechP = state.forces[state.playerForceId]?.techP ?? 0;
              return (
                <dl className="tech-info">
                  <div><dt>技巧P</dt><dd>{level < MAX_TECH_LEVEL ? `${cost.techP.toLocaleString('en-US')}／${forceTechP.toLocaleString('en-US')}` : forceTechP.toLocaleString('en-US')}</dd></div>
                  <div><dt>资金</dt><dd>{level < MAX_TECH_LEVEL ? `${cost.gold.toLocaleString('en-US')}／${city.gold.toLocaleString('en-US')}` : city.gold.toLocaleString('en-US')}</dd></div>
                  <div><dt>相关能力</dt><dd>{researchStatKey === 'leadership' ? '统率' : '政治'}</dd></div>
                  <div className="tech-effect"><dt>效果</dt><dd>{level < MAX_TECH_LEVEL ? tech.description : `${researchBranchDef.name}系科技已研究完毕`}</dd></div>
                  <div><dt>期间</dt><dd>{level < MAX_TECH_LEVEL ? `${researchTenDays(cost.baseTenDays, statValue) * 10}日` : '已研究完毕'}</dd></div>
                </dl>
              );
            })()}
          </section>
        )}

        {type === 'abilityResearch' && (
          <section className="ability-panel" aria-label="能力研究">
            <div
              className="ability-tree"
              style={{ gridTemplateColumns: `repeat(${ABILITY_TREE_COLS}, minmax(0, 1fr))`, gridTemplateRows: `repeat(${ABILITY_TREE_ROWS}, 1fr)` }}
            >
              {/* 研究顺序箭头：前置节点 → 本节点，颜色随目标节点状态（金色=可研究、绿色=已研究、暗色=未解锁） */}
              <svg className="ability-arrows" viewBox="0 0 900 560" aria-hidden="true">
                {ABILITY_NODES.flatMap((node) =>
                  node.prereq
                    .map((pid) => {
                      const from = ABILITY_NODE_MAP[pid];
                      if (!from) return null;
                      const status = abilityNodeStatus(state, state.playerForceId, node);
                      const stroke = status === 'done'
                        ? 'rgba(158, 206, 138, 0.85)'
                        : status === 'available'
                          ? '#e8c96a'
                          : status === 'active'
                            ? '#e0a077'
                            : 'rgba(196, 186, 158, 0.32)';
                      // 单元格中心坐标（x:100/格，y:80/格）
                      const fx = (from.col - 0.5) * 100;
                      const fy = (from.row - 0.5) * 80;
                      const tx = (node.col - 0.5) * 100;
                      const ty = (node.row - 0.5) * 80;
                      const dx = tx - fx;
                      const dy = ty - fy;
                      const len = Math.hypot(dx, dy);
                      if (len < 70) return null;
                      const ux = dx / len;
                      const uy = dy / len;
                      // 起终点收进节点边缘（向量归一化，落点夹逼防止反向）
                      const x1 = fx + ux * 38;
                      const y1 = fy + uy * 30;
                      const x2 = tx - ux * 42;
                      const y2 = ty - uy * 34;
                      // 箭头羽：垂直于连线方向构造
                      const px = -uy;
                      const py = ux;
                      const bx = x2 - ux * 12;
                      const by = y2 - uy * 12;
                      return (
                        <g key={`${from.id}-${node.id}`} stroke={stroke} strokeWidth={2.4} fill="none" strokeLinecap="round" strokeLinejoin="round">
                          <line x1={x1} y1={y1} x2={x2} y2={y2} />
                          <line x1={x2} y1={y2} x2={bx + px * 7} y2={by + py * 7} />
                          <line x1={x2} y1={y2} x2={bx - px * 7} y2={by - py * 7} />
                        </g>
                      );
                    })
                    .filter(Boolean),
                )}
              </svg>
              <div className="ability-center" style={{ gridColumn: ABILITY_CENTER.col, gridRow: ABILITY_CENTER.row }}>研究开始</div>
              {ABILITY_NODES.map((node) => {
                const status = abilityNodeStatus(state, state.playerForceId, node);
                const remaining = abilityCultivateRemaining(state, state.playerForceId, node.id);
                const selected = abilityNodeId === node.id;
                const locked = status === 'locked';
                return (
                  <button
                    key={node.id}
                    type="button"
                    style={{ gridColumn: node.col, gridRow: node.row }}
                    className={`ability-node cat-${node.category} is-${status}${selected ? ' is-selected' : ''}`}
                    aria-pressed={selected}
                    disabled={locked}
                    title={locked ? '前置能力尚未研究' : abilityEffectText(node)}
                    onClick={() => {
                      if (status !== 'locked') setAbilityNodeId(node.id);
                    }}
                  >
                    {node.label}
                    {status === 'done' && remaining > 0 && <em>×{remaining}</em>}
                  </button>
                );
              })}
            </div>
            {abilityNode && (
              <dl className="tech-info ability-info">
                <div><dt>种类</dt><dd>{abilityKindLabel(abilityNode)}</dd></div>
                <div><dt>期间</dt><dd>{cultivateMode ? '30日（3旬）' : abilityStatus === 'done' ? '已研究' : `${abilityNode.months}个月`}</dd></div>
                <div><dt>消耗</dt><dd>{cultivateMode ? `行动力 ${COMMAND_AP.cultivate}` : `资金 ${ABILITY_RESEARCH_GOLD} · 行动力 ${COMMAND_AP.abilityResearch}`}</dd></div>
                <div><dt>状态</dt><dd>
                  {abilityStatus === 'done'
                    ? (abilityRemaining > 0 ? `已研究·可培育${abilityRemaining}名武将` : '培育次数已用完')
                    : abilityStatus === 'active' || abilityActive?.nodeId === abilityNode.id
                      ? `研究中（剩余${abilityActive?.remainingMonths ?? abilityNode.months}个月）`
                      : abilityActive
                        ? '另有能力研究中'
                        : abilityStatus === 'available'
                          ? '可研究'
                          : '前置能力尚未研究'}
                </dd></div>
                <div className="tech-effect"><dt>效果</dt><dd>{abilityEffectText(abilityNode)}</dd></div>
              </dl>
            )}
            {cultivateMode && (
              cultivateCandidates.length > 0 ? (
                <label className="field-row">
                  <span>培育武将</span>
                  <select aria-label="培育武将" value={cultivateOfficerChosen} onChange={(event) => setCultivateOfficerId(event.target.value)}>
                    {availableOfficers.map((officer) => {
                      const eligible = canCultivateOfficer(officer, abilityNode);
                      return (
                        <option key={officer.id} value={officer.id} disabled={!eligible}>
                          {officer.name} · 统{officer.stats.leadership} 武{officer.stats.war} 智{officer.stats.intelligence}{eligible ? '' : '（不符合条件）'}
                        </option>
                      );
                    })}
                  </select>
                </label>
              ) : (
                <div className="command-note">本城没有符合「{abilityNode?.label}」培育条件的在城武将</div>
              )
            )}
          </section>
        )}

        {type === 'transfer' && (
          <div className="transfer-fields">
            <label className="field-row">
              <span>目标城市</span>
              <select aria-label="目标城市" value={activeTargetId} onChange={(event) => setTargetCityId(event.target.value as CityId)}>
                {targetCities.map((target) => <option key={target.id} value={target.id}>{target.name}</option>)}
              </select>
            </label>
            <div className="command-note">
              {activeTargetCity ? `${city.name} → ${activeTargetCity.name}，预计${activeTransferDuration}旬抵达` : '没有可调往的己方城市'}
            </div>
            <fieldset className="transfer-officers">
              <legend>调动人员</legend>
              <div>
                {officers.map((officer) => (
                  <label key={officer.id}>
                    <input type="checkbox" checked={officerIds.includes(officer.id)} disabled={city.governorId === officer.id} onChange={() => toggleTransferOfficer(officer.id)} />
                    <span>{officer.name}{city.governorId === officer.id ? '（太守）' : ''}</span>
                  </label>
                ))}
              </div>
            </fieldset>
          </div>
        )}

        {type !== 'research' && type !== 'abilityResearch' && (
          <div className="command-cost">
            <span>行动力</span><strong>-{COMMAND_AP[type]}</strong>
            <span>预计消耗</span><strong>{estimatedCost}</strong>
          </div>
        )}

        {(visibleErrors.length > 0 || submitError) && (
          <div className="validation-errors" role="alert"><AlertCircle /> <span>{submitError ?? visibleErrors.join('；')}</span></div>
        )}

        <footer>
          <button type="button" className="secondary-button" onClick={onClose}>返回</button>
          <button type="submit" className="primary-button" disabled={errors.length > 0 || (type === 'trade' && tradeIdle) || (type === 'abilityResearch' && cultivateMode && cultivateCandidates.length === 0)}>
            {type === 'abilityResearch' && abilityStatus === 'done'
              ? (abilityRemaining > 0 ? '决定培育' : '已研究完毕')
              : `决定·${label}`}
          </button>
        </footer>
      </form>
    </div>
  );
}
