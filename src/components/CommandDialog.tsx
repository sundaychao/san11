import { AlertCircle, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { useAudioEventAdapter } from '../audio/reactAudioEventAdapter';
import { ARMAMENT_GOLD_COST, ARMAMENT_LABELS, ARMAMENT_TYPES, armamentsOf, isDelayedArmament, produceArmamentYield } from '../game/armaments';
import { COMMAND_AP, COMMAND_LABELS, TRADE_MAX_GRAIN, grainPriceOf, patrolGoldCost, quoteTrade, researchTechPCost, tradeEffectMultiplier, tradeEffectPercent, transferDuration, validateCommand } from '../game/commands';
import { MAX_TECH_LEVEL, TECH_BRANCHES, TECH_COSTS, researchTenDays, techLevelOf } from '../game/techs';
import { EXPLORE_AP_PER_OFFICER, EXPLORE_GOLD_PER_OFFICER, treasureDefinition, treasureEffectText } from '../game/treasures';
import { REWARD_GOLD_COST, officerLoyalty, rewardLoyaltyGain } from '../game/loyalty';
import { ABILITY_CENTER, ABILITY_NODE_MAP, ABILITY_NODES, ABILITY_RESEARCH_GOLD, ABILITY_TREE_COLS, ABILITY_TREE_ROWS, abilityCultivateRemaining, abilityEffectText, abilityKindLabel, abilityNodeStatus, canCultivateOfficer } from '../game/abilityResearch';
import { POSITIONS, forceRankOf, officerMerit, positionDefinition, rankDefinition, rankIndex } from '../game/ranks';
import { capturableByLoyalty, captivesOf, recruitCaptiveChance, CAPTIVE_RECRUIT_LOYALTY_THRESHOLD } from '../game/captives';
import { DIPLOMACY_GOLD_MAX, GOODWILL_GOLD_COST, TRUCE_MONTHS_MAX, TRUCE_MONTHS_MIN, areAllies, forceDiplomacy } from '../game/diplomacy';
import { LEGION_LABELS, PLOT_LABELS, ARMAMENT_FACILITY, armamentFacilityLabel, constructTenDaysFor, hasPlotFacility, plotCost, plotCountIncludingConstructing, plotTotalLevel, legionContaining, legionsOf, UNIQUE_FACILITIES as UNIQUE_PLOT_FACILITIES, type PlotType } from '../game/innerAffairs';
import { MARRY_TECHP_COST, relationCandidates } from '../game/relationship';
import { POACH_GOLD_COST, RUMOR_GOLD_COST, canPoach, rumorTargets } from '../game/rumor';
import { useGame } from '../game/store/GameProvider';
import type { ArmamentType, CityId, ForceId, GameCommand, TechBranchId } from '../game/types';
import { closePopupOnContextMenu } from './popupEvents';

interface CommandDialogProps {
  type: GameCommand['type'];
  cityId: CityId;
  onClose(): void;
  /** 可选：覆盖默认的提交行为（用于需要后续地图点击的指令，如建设） */
  onSubmitOverride?(data: { command: GameCommand; close: () => void }): void;
}

export function CommandDialog({ type, cityId, onClose, onSubmitOverride }: CommandDialogProps) {
  const { state, issueCommand } = useGame();
  const audio = useAudioEventAdapter();
  const [officerId, setOfficerId] = useState('');
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
  // 探索：勾选的武将列表（每人20行动力）
  const [exploreOfficerIds, setExploreOfficerIds] = useState<string[]>([]);
  // 收授宝物：选中的宝物 + 授予目标（null=收回归主公）
  const [treasureId, setTreasureId] = useState('');
  const [grantOfficerId, setGrantOfficerId] = useState<string | null>(null);
  // 任命官职：选中的武将 + 官职（null=免官）
  const [positionOfficerId, setPositionOfficerId] = useState('');
  const [positionChoice, setPositionChoice] = useState<string>('');
  // 流言：目标城市
  const [rumorTargetCityId, setRumorTargetCityId] = useState<CityId | ''>('');
  // 挖角：目标城市 + 目标武将
  const [poachTargetCityId, setPoachTargetCityId] = useState<CityId | ''>('');
  const [poachTargetOfficerId, setPoachTargetOfficerId] = useState('');
  // 外交：目标势力 + 行动
  const [diplomacyForceId, setDiplomacyForceId] = useState<ForceId | ''>('');
  const [diplomacyAction, setDiplomacyAction] = useState<'goodwill' | 'alliance' | 'truce' | 'requestTroops' | 'break'>('goodwill');
  const [diplomacyGold, setDiplomacyGold] = useState(0);
  const [diplomacyMonths, setDiplomacyMonths] = useState(TRUCE_MONTHS_MIN);
  // 处置俘虏：目标 + 行动
  const [captiveOfficerId, setCaptiveOfficerId] = useState('');
  const [captiveAction, setCaptiveAction] = useState<'recruit' | 'release' | 'execute'>('recruit');
  // 仲介（婚姻/结义）
  const [marryOfficerA, setMarryOfficerA] = useState('');
  const [marryOfficerB, setMarryOfficerB] = useState('');
  const [marryRelation, setMarryRelation] = useState<'spouse' | 'sworn'>('spouse');
  // 委任军团：军团长 + 城市 + 方针（null=解散）
  const [legionCommanderId, setLegionCommanderId] = useState('');
  const [legionCityId, setLegionCityId] = useState<CityId | ''>('');
  const [legionPolicy, setLegionPolicy] = useState<'civil' | 'military' | 'balanced'>('balanced');
  // 开发：设施类型
  const [plotFacility, setPlotFacility] = useState<PlotType>('market');
  // 任命军师：'' = 保持现状，'__clear__' = 解除任命，否则为军师武将id
  const [strategistOfficerId, setStrategistOfficerId] = useState<string>(() => state?.forces[state.playerForceId]?.strategistId ?? '');
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
  // 探索：按智力降序排列，勾选数量受行动力限制（每人20）
  const exploreOfficers = [...availableOfficers].sort((a, b) => b.stats.intelligence - a.stats.intelligence);
  const exploreMaxCount = Math.floor(state.actionPoints[state.playerForceId] / EXPLORE_AP_PER_OFFICER);
  const exploreSelected = exploreOfficerIds.filter((id) => availableOfficers.some((officer) => officer.id === id));
  // 一并：按默认顺序（智力降序）勾选，直至填满当前可用行动力所能支持的武将数
  const exploreSelectAll = () => {
    const selected = new Set(exploreOfficerIds);
    for (const officer of exploreOfficers) {
      if (selected.size >= exploreMaxCount) break;
      selected.add(officer.id);
    }
    setExploreOfficerIds([...selected]);
  };
  // 收授宝物：本势力已出土宝物
  const ownedTreasures = Object.values(state.treasures ?? {}).filter((treasure) => treasure.ownerId === state.playerForceId);
  const activeTreasureId = treasureId || ownedTreasures[0]?.id || '';
  const activeTreasure = activeTreasureId ? state.treasures?.[activeTreasureId] : undefined;
  const activeTreasureDef = activeTreasureId ? treasureDefinition(activeTreasureId) : undefined;
  const forceOfficers = Object.values(state.officers).filter((officer) => officer.forceId === state.playerForceId);
  // 任命官职：非君主武将按功绩降序；可选官职 = 功绩与爵位均满足的官职（不占用行动力）
  const appointableOfficers = forceOfficers
    .filter((officer) => officer.id !== state.forces[state.playerForceId]?.leaderId)
    .sort((a, b) => officerMerit(b) - officerMerit(a));
  const activePositionOfficer = positionOfficerId ? state.officers[positionOfficerId] : appointableOfficers[0];
  const activePositionId = positionChoice
    || (activePositionOfficer?.positionId ?? '');
  const forceRankNow = forceRankOf(state, state.playerForceId);
  const eligiblePositions = POSITIONS.filter((position) =>
    officerMerit(activePositionOfficer ?? appointableOfficers[0]) >= position.merit
    && rankIndex(forceRankNow) >= rankIndex(position.rankNeeded),
  );
  const activePositionDef = activePositionId ? positionDefinition(activePositionId) : null;
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
  // 流言：目标敌城
  const enemyCities = rumorTargets(state, state.playerForceId);
  const activeRumorTargetId = rumorTargetCityId || enemyCities[0]?.id || '';
  // 挖角：目标敌城 + 目标武将
  const poachCities = enemyCities;
  const activePoachTargetCityId = poachTargetCityId || poachCities[0]?.id || '';
  const poachCandidates = activePoachTargetCityId
    ? Object.values(state.officers).filter(
        (officer) => officer.location.kind === 'city' && officer.location.cityId === activePoachTargetCityId,
      ).filter((officer) => canPoach(state, state.playerForceId, officer))
    : [];
  const activePoachOfficerId = poachTargetOfficerId || poachCandidates[0]?.id || '';
  // 外交：目标势力（非己方、非已破盟）
  const diplomacyForces = Object.values(state.forces).filter((force) => force.id !== state.playerForceId);
  const activeDiplomacyForceId = diplomacyForceId || diplomacyForces[0]?.id || '';
  const activeDiplomacyForce = activeDiplomacyForceId ? state.forces[activeDiplomacyForceId] : undefined;
  const diplomacyForced = activeDiplomacyForceId ? forceDiplomacy(state, state.playerForceId, activeDiplomacyForceId) : 0;
  const diplomacyGoldClamped = Math.min(Math.max(0, diplomacyGold), Math.min(city.gold, DIPLOMACY_GOLD_MAX));
  // 处置俘虏：关押在本城的俘虏
  const captiveOfficers = captivesOf(state, state.playerForceId);
  const activeCaptiveId = captiveOfficerId || captiveOfficers[0]?.id || '';
  const activeCaptive = activeCaptiveId ? state.officers[activeCaptiveId] : undefined;
  const activeCaptiveExecutor = availableOfficers.find((o) => o.id !== state.forces[state.playerForceId]?.leaderId);
  const captiveRecruitChance = activeCaptive && activeCaptiveExecutor
    ? recruitCaptiveChance(state, state.playerForceId, activeCaptiveExecutor, activeCaptive)
    : 0;
  // 仲介（婚姻/结义）：同城待命武将作为候选人
  const marryCandidates = availableOfficers.filter((o) => o.id !== state.forces[state.playerForceId]?.leaderId && !o.deathMonth);
  const activeMarryOfficerA = marryOfficerA || marryCandidates[0]?.id || '';
  const marrySelf = activeMarryOfficerA ? state.officers[activeMarryOfficerA] : undefined;
  const marryPartners = marrySelf ? relationCandidates(state, state.playerForceId, cityId, marrySelf, marryRelation) : [];
  const activeMarryOfficerB = marryOfficerB || marryPartners[0]?.id || '';
  // 委任军团：军团长候选人 + 直辖城市
  const legionCommanders = forceOfficers.filter((o) => o.id !== state.forces[state.playerForceId]?.leaderId && !o.deathMonth);
  const legionCities = targetCities;
  const activeLegionCityId = legionCityId || legionCities[0]?.id || '';
  const activeLegion = activeLegionCityId ? legionContaining(state, state.playerForceId, activeLegionCityId) : undefined;
  const legionCityConnected = Boolean(activeLegion);
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
    if (type === 'explore') {
      return { type, cityId, officerIds: exploreOfficerIds };
    }
    if (type === 'grantTreasure') {
      return { type, cityId, treasureId: activeTreasureId, officerId: grantOfficerId };
    }
    if (type === 'appointPosition') {
      return { type, cityId, officerId: activePositionOfficer?.id ?? '', positionId: activePositionId || null };
    }
    if (type === 'rumor') {
      return { type, cityId, officerId: activeOfficerId, targetCityId: activeRumorTargetId as CityId };
    }
    if (type === 'poach') {
      return { type, cityId, officerId: activeOfficerId, targetCityId: activePoachTargetCityId as CityId, targetOfficerId: activePoachOfficerId };
    }
    if (type === 'diplomacy') {
      return {
        type,
        cityId,
        officerId: activeOfficerId,
        targetForceId: activeDiplomacyForceId as ForceId,
        action: diplomacyAction,
        months: diplomacyAction === 'truce' ? diplomacyMonths : undefined,
        gold: diplomacyAction === 'alliance' || diplomacyAction === 'truce' ? diplomacyGold : undefined,
      };
    }
    if (type === 'captiveDispose') {
      return { type, cityId, targetOfficerId: activeCaptiveId, action: captiveAction };
    }
    if (type === 'marry') {
      return { type, cityId, officerIdA: activeMarryOfficerA, officerIdB: activeMarryOfficerB, relation: marryRelation };
    }
    if (type === 'legion') {
      return {
        type,
        cityId,
        commanderId: legionCommanderId === 'none' ? null : legionCommanderId || null,
        targetCityId: (legionCityId || null) as CityId | null,
        policy: legionPolicy,
      };
    }
    if (type === 'buildFacilityPlot') {
      // 地格在弹窗确认后由地图点击决定，此处占位 0，不参与地格校验
      return { type, cityId, officerId: activeOfficerId, plotIndex: 0, facility: plotFacility };
    }
    if (type === 'appointStrategist') {
      // '' = 未改动（沿用现任军师），'__clear__' = 解除任命
      const effective = strategistOfficerId === '__clear__'
        ? null
        : strategistOfficerId || state.forces[state.playerForceId]?.strategistId || null;
      return { type, cityId, officerId: effective };
    }
    const base = { cityId, officerId: activeOfficerId };
    if (type === 'produceArmament') return { ...base, type, armamentType };
    if (type === 'research') return { ...base, type, branch: researchBranch };
    if (type === 'trade') return { ...base, type, mode: tradeValue >= 0 ? 'buy' : 'sell', amount: Math.min(Math.abs(tradeValue), TRADE_MAX_GRAIN) };
    return { ...base, type } as GameCommand;
  }, [abilityNode, abilityNodeId, activeCaptiveId, activeDiplomacyForceId, activeMarryOfficerA, activeMarryOfficerB, activeOfficerId, activePoachOfficerId, activePoachTargetCityId, activePositionId, activePositionOfficer, activeRumorTargetId, activeTargetId, activeTreasureId, armamentType, captiveAction, cityId, cultivateMode, cultivateOfficerChosen, diplomacyAction, diplomacyGold, diplomacyMonths, exploreOfficerIds, grantOfficerId, legionCityId, legionCommanderId, legionPolicy, marryRelation, officerIds, plotFacility, poachTargetCityId, poachTargetOfficerId, researchBranch, strategistOfficerId, tradeValue, type]);

  const errors = validateCommand(state, state.playerForceId, command);
  const label = COMMAND_LABELS[type];
  // 开发：地格在地图上选择，弹窗阶段跳过地格类校验（资金/封锁等仍校验）；
  // 若本城已无空闲建设用地，直接提示无法开发
  const noEmptyPlot = type === 'buildFacilityPlot'
    && !(city.plots ?? []).some((plot) => plot && plot.type === 'empty' && !plot.constructing);
  const actionableErrors = type === 'buildFacilityPlot'
    ? [...errors.filter((error) => !error.includes('地格')), ...(noEmptyPlot ? ['本城没有空闲的建设用地，无法开发'] : [])]
    : errors;
  // 滑块居中（0）时只显示商人到访/交易次数类错误，隐藏数量类校验
  const visibleErrors = type === 'trade' && tradeIdle
    ? errors.filter((error) => error.includes('商人') || error.includes('交易'))
    : actionableErrors;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (actionableErrors.length > 0) return;
    try {
      if (onSubmitOverride) {
        onSubmitOverride({ command, close: onClose });
      } else {
        issueCommand(command);
        onClose();
      }
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

  const estimatedCost = type === 'explore'
    ? `行动力 ${EXPLORE_AP_PER_OFFICER * exploreOfficerIds.length} · 资金 ${EXPLORE_GOLD_PER_OFFICER * exploreOfficerIds.length}`
    : type === 'grantTreasure'
      ? '宝物授予/收回'
      : type === 'appointPosition'
        ? activePositionDef
          ? `俸禄${activePositionDef.salary}金/月 · 指挥${activePositionDef.troopCommand}`
          : '免除官职'
      : type === 'talent'
        ? '资金 500'
    : type === 'recruit'
      ? '资金 800 · 兵粮 500'
      : type === 'train'
        ? '兵粮 300'
        : type === 'produceArmament'
          ? `资金 ${ARMAMENT_GOLD_COST} · ${ARMAMENT_LABELS[armamentType]} +${productionGain.toLocaleString('en-US')} · ${isDelayedArmament(armamentType) ? '1个月' : '即时'}`
          : type === 'patrol'
            ? `资金 ${patrolGoldCost(city)}`
            : type === 'trade'
              ? `粮价 1金=${grainPrice}粮 · 交易效果 ${tradePercent}%`
              : type === 'reward'
                ? `资金 ${REWARD_GOLD_COST} · 忠诚+${activeOfficer ? rewardLoyaltyGain(officerLoyalty(activeOfficer)) : 2}`
                : type === 'research'
                ? (() => {
                  const level = techLevelOf(state, state.playerForceId, researchBranch);
                  if (level >= MAX_TECH_LEVEL) return '该方向已研究完毕';
                  const cost = TECH_COSTS[level];
                  const statValue = activeOfficer ? activeOfficer.stats[researchStatKey] : 50;
                  const techCost = activeOfficer
                    ? researchTechPCost(state, state.playerForceId, researchBranch, activeOfficer.id)
                    : cost.techP;
                  return `资金 ${cost.gold} · 技巧P ${techCost} · ${researchTenDays(cost.baseTenDays, statValue)}旬`;
                })()
                : type === 'abilityResearch'
                  ? cultivateMode
                    ? `培育武将 · 30日（3旬）· 剩余培育次数 ${abilityRemaining}`
                    : `资金 ${ABILITY_RESEARCH_GOLD} · 研究 ${abilityNode?.months ?? 0} 个月`
                  : type === 'rumor'
                    ? `资金 ${RUMOR_GOLD_COST} · 降低敌城民心与武将忠诚`
                    : type === 'poach'
                      ? `资金 ${POACH_GOLD_COST} · 登用敌城武将`
                      : type === 'diplomacy'
                        ? (() => {
                          switch (diplomacyAction) {
                            case 'goodwill': return `资金 ${GOODWILL_GOLD_COST} · 提升友好度`;
                            case 'alliance': return `礼金 ${diplomacyGoldClamped.toLocaleString('en-US')} · 缔结同盟`;
                            case 'truce': return `礼金 ${diplomacyGoldClamped.toLocaleString('en-US')} · 停战 ${diplomacyMonths}个月`;
                            case 'requestTroops': return '请求援军（需同盟）';
                            case 'break': return '破弃同盟';
                          }
                        })()
                        : type === 'captiveDispose'
                          ? captiveAction === 'recruit'
                            ? '劝降登用俘虏'
                            : captiveAction === 'release'
                              ? '释放俘虏'
                              : '处斩俘虏'
                          : type === 'marry'
                            ? `技巧P ${MARRY_TECHP_COST}`
                            : type === 'legion'
                              ? '委任军团 · 自动内政'
                              : type === 'buildFacilityPlot'
                                ? ''
                                : type === 'appointStrategist'
                                ? '谋略加成 · 外交/流言/登用'
                                : activeTransferDuration
              ? `人员调动 · ${activeTransferDuration}旬`
              : '人员调动';

  return (
    <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()} onContextMenu={(event) => closePopupOnContextMenu(event, onClose, audio)}>
      <form ref={dialogRef} className="command-dialog tool-panel" role="dialog" aria-modal="true" aria-labelledby="command-title" onSubmit={submit} onKeyDown={handleDialogKeyDown}>
        <header>
          <div><p>{city.name}政务 · 行动力 {type === 'explore' ? `${EXPLORE_AP_PER_OFFICER}/人` : COMMAND_AP[type]}</p><h2 id="command-title">{label}</h2></div>
          <button type="button" className="icon-button" aria-label="关闭指令" title="关闭" onClick={onClose}><X /></button>
        </header>

        {type !== 'transfer' && type !== 'abilityResearch' && type !== 'explore' && type !== 'grantTreasure' && type !== 'appointPosition' && type !== 'captiveDispose' && type !== 'marry' && type !== 'legion' && type !== 'appointStrategist' && (
          <label className="field-row">
            <span>执行武将</span>
            <select aria-label="执行武将" value={activeOfficerId} onChange={(event) => setOfficerId(event.target.value)}>
              {officers.map((officer) => (
                <option key={officer.id} value={officer.id} disabled={officer.acted}>
                  {officer.name} · {type === 'reward'
                    ? `忠${officerLoyalty(officer)}`
                    : type === 'research' && researchStatKey === 'leadership'
                      ? `统${officer.stats.leadership}`
                      : `政${officer.stats.politics}`} 智{officer.stats.intelligence}{officer.acted ? '（已行动）' : ''}
                </option>
              ))}
            </select>
          </label>
        )}

        {type === 'explore' && (
          <fieldset className="transfer-officers explore-officers" aria-label="探索武将">
            <legend>探索武将（每人行动力{EXPLORE_AP_PER_OFFICER} · 资金{EXPLORE_GOLD_PER_OFFICER}，最多{exploreMaxCount}人）</legend>
            <div className="explore-list">
              {exploreOfficers.map((officer) => {
                const checked = exploreOfficerIds.includes(officer.id);
                const overLimit = !checked && exploreOfficerIds.length >= exploreMaxCount;
                return (
                  <label key={officer.id} className={overLimit ? 'is-over-limit' : undefined}>
                    <input
                      type="checkbox"
                      checked={checked}
                      disabled={overLimit}
                      onChange={() => setExploreOfficerIds((current) => current.includes(officer.id) ? current.filter((item) => item !== officer.id) : [...current, officer.id])}
                    />
                    <span>{officer.name} · 智{officer.stats.intelligence} 政{officer.stats.politics}</span>
                  </label>
                );
              })}
            </div>
            <div className="explore-actions">
              <button type="button" className="explore-select-all" onClick={exploreSelectAll}>一并</button>
              <button type="button" className="explore-select-all" onClick={() => setExploreOfficerIds([])}>一并解除</button>
            </div>
          </fieldset>
        )}

        {type === 'grantTreasure' && (
          <section className="grant-treasure-panel" aria-label="收授宝物">
            {ownedTreasures.length === 0 ? (
              <div className="command-note">本势力尚无已出土的宝物，可先派武将探索获取。</div>
            ) : (
              <>
                <label className="field-row">
                  <span>宝物</span>
                  <select aria-label="宝物" value={activeTreasureId} onChange={(event) => setTreasureId(event.target.value)}>
                    {ownedTreasures.map((treasure) => (
                      <option key={treasure.id} value={treasure.id}>
                        {treasureDefinition(treasure.id)?.name ?? treasure.id}{treasure.holderId ? `（${state.officers[treasure.holderId]?.name ?? ''}装备中）` : '（未装备）'}
                      </option>
                    ))}
                  </select>
                </label>
                {activeTreasureDef && (
                  <dl className="produce-stock">
                    <div><dt>效果</dt><dd>{treasureEffectText(activeTreasureDef)}</dd></div>
                    <div><dt>说明</dt><dd>{activeTreasureDef.description}</dd></div>
                  </dl>
                )}
                <label className="field-row">
                  <span>授予武将</span>
                  <select aria-label="授予武将" value={grantOfficerId ?? ''} onChange={(event) => setGrantOfficerId(event.target.value || null)}>
                    <option value="">收回·归主公所有</option>
                    {forceOfficers.map((officer) => (
                      <option key={officer.id} value={officer.id}>
                        {officer.name} · 统{officer.stats.leadership} 武{officer.stats.war} 智{officer.stats.intelligence}{officer.treasureId ? `（已装备${treasureDefinition(officer.treasureId)?.name ?? ''}）` : ''}
                      </option>
                    ))}
                  </select>
                </label>
              </>
            )}
          </section>
        )}

        {type === 'appointPosition' && (
          <section className="grant-treasure-panel" aria-label="任命官职">
            {appointableOfficers.length === 0 ? (
              <div className="command-note">本势力没有可任命官职的武将（君主不需要官职）。</div>
            ) : (
              <>
                <label className="field-row">
                  <span>武将</span>
                  <select aria-label="武将" value={activePositionOfficer?.id ?? ''} onChange={(event) => { setPositionOfficerId(event.target.value); setPositionChoice(''); }}>
                    {appointableOfficers.map((officer) => (
                      <option key={officer.id} value={officer.id}>
                        {officer.name} · 功绩{officerMerit(officer)}{officer.positionId ? `（现任${positionDefinition(officer.positionId)?.name ?? ''}）` : '（无官职）'}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field-row">
                  <span>官职</span>
                  <select aria-label="官职" value={activePositionId} onChange={(event) => setPositionChoice(event.target.value)}>
                    <option value="">免除官职</option>
                    {eligiblePositions.map((position) => (
                      <option key={position.id} value={position.id}>
                        {position.name} · 指挥{position.troopCommand} · 俸禄{position.salary}金{Object.entries(position.statBonus).some(([, value]) => value > 0) ? ` · ${Object.entries(position.statBonus).filter(([, value]) => value > 0).map(([key, value]) => `${({ leadership: '统', war: '武', intelligence: '智', politics: '政', charisma: '魅' } as const)[key as keyof typeof position.statBonus]}${value}`).join('+')}` : ''}
                      </option>
                    ))}
                  </select>
                </label>
                {activePositionDef && (
                  <dl className="produce-stock">
                    <div><dt>效果</dt><dd>指挥兵数上限 {activePositionDef.troopCommand} · 每月俸禄 {activePositionDef.salary}金</dd></div>
                    {Object.keys(activePositionDef.statBonus).length > 0 && (
                      <div><dt>能力</dt><dd>{Object.entries(activePositionDef.statBonus).map(([key, value]) => `${({ leadership: '统率', war: '武力', intelligence: '智力', politics: '政治', charisma: '魅力' } as const)[key as keyof typeof activePositionDef.statBonus]}+${value}`).join('、')}</dd></div>
                    )}
                    <div><dt>所需</dt><dd>功绩 {activePositionDef.merit} · 爵位{rankDefinition(activePositionDef.rankNeeded).name}</dd></div>
                  </dl>
                )}
              </>
            )}
          </section>
        )}

        {type === 'produceArmament' && (
          <section className="produce-armament-panel" aria-label="生产兵装选择">
            <div className="produce-armament-grid">
              {ARMAMENT_TYPES.map((item) => {
                const selected = armamentType === item;
                const stock = cityArmaments[item];
                const nextStock = selected ? stock + productionGain : stock;
                const facilityMissing = !hasPlotFacility(city, ARMAMENT_FACILITY[item]);
                return (
                  <button
                    key={item}
                    type="button"
                    aria-label={ARMAMENT_LABELS[item]}
                    className={selected ? 'is-active' : ''}
                    disabled={facilityMissing}
                    title={facilityMissing ? `需先建设${armamentFacilityLabel(item)}才能生产` : undefined}
                    onClick={() => setArmamentType(item)}
                  >
                    <strong>{ARMAMENT_LABELS[item]}</strong>
                    <span>{facilityMissing ? `需${armamentFacilityLabel(item)}` : selected ? `${stock.toLocaleString('en-US')} → ${nextStock.toLocaleString('en-US')}` : stock.toLocaleString('en-US')}</span>
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
              const techCost = activeOfficer
                ? researchTechPCost(state, state.playerForceId, researchBranch, activeOfficer.id)
                : cost.techP;
              const forceTechP = state.forces[state.playerForceId]?.techP ?? 0;
              return (
                <dl className="tech-info">
                  <div><dt>技巧P</dt><dd>{level < MAX_TECH_LEVEL ? `${techCost.toLocaleString('en-US')}／${forceTechP.toLocaleString('en-US')}` : forceTechP.toLocaleString('en-US')}</dd></div>
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

        {type === 'rumor' && (
          <section className="grant-treasure-panel" aria-label="流言">
            {enemyCities.length === 0 ? (
              <div className="command-note">当前没有可散布流言的敌城</div>
            ) : (
              <>
                <label className="field-row">
                  <span>目标城市</span>
                  <select aria-label="流言目标城市" value={activeRumorTargetId} onChange={(event) => setRumorTargetCityId(event.target.value as CityId)}>
                    {enemyCities.map((target) => (
                      <option key={target.id} value={target.id}>{target.name}（{state.forces[target.ownerId!]?.name ?? ''}）</option>
                    ))}
                  </select>
                </label>
                <div className="command-note">散布流言可降低目标城市治安与武将忠诚，成功率受执行武将智力与对方军师智力影响</div>
              </>
            )}
          </section>
        )}

        {type === 'poach' && (
          <section className="grant-treasure-panel" aria-label="挖角">
            {poachCities.length === 0 || poachCandidates.length === 0 ? (
              <div className="command-note">当前没有可挖角的敌城武将</div>
            ) : (
              <>
                <label className="field-row">
                  <span>目标城市</span>
                  <select aria-label="挖角目标城市" value={activePoachTargetCityId} onChange={(event) => { setPoachTargetCityId(event.target.value as CityId); setPoachTargetOfficerId(''); }}>
                    {poachCities.map((target) => (
                      <option key={target.id} value={target.id}>{target.name}（{state.forces[target.ownerId!]?.name ?? ''}）</option>
                    ))}
                  </select>
                </label>
                <label className="field-row">
                  <span>目标武将</span>
                  <select aria-label="挖角目标武将" value={activePoachOfficerId} onChange={(event) => setPoachTargetOfficerId(event.target.value)}>
                    {poachCandidates.map((officer) => (
                      <option key={officer.id} value={officer.id}>{officer.name} · 忠{officerLoyalty(officer)} 智{officer.stats.intelligence}</option>
                    ))}
                  </select>
                </label>
                <div className="command-note">挖角成功率受执行武将魅力与目标忠诚影响，失败后目标短期内无法再被登用</div>
              </>
            )}
          </section>
        )}

        {type === 'diplomacy' && (
          <section className="grant-treasure-panel" aria-label="外交">
            <label className="field-row">
              <span>对象势力</span>
              <select aria-label="外交对象势力" value={activeDiplomacyForceId} onChange={(event) => setDiplomacyForceId(event.target.value as ForceId)}>
                {diplomacyForces.map((force) => (
                  <option key={force.id} value={force.id}>{force.name}{areAllies(state, state.playerForceId, force.id) ? '（同盟）' : ''}</option>
                ))}
              </select>
            </label>
            <label className="field-row">
              <span>行动</span>
              <select aria-label="外交行动" value={diplomacyAction} onChange={(event) => setDiplomacyAction(event.target.value as typeof diplomacyAction)}>
                <option value="goodwill">亲善（资金{GOODWILL_GOLD_COST}）</option>
                <option value="alliance">缔结同盟</option>
                <option value="truce">停战协议</option>
                <option value="requestTroops">请求援军</option>
                <option value="break">破弃同盟</option>
              </select>
            </label>
            {activeDiplomacyForce && (
              <dl className="produce-stock">
                <div><dt>友好度</dt><dd>{diplomacyForced}</dd></div>
                <div><dt>说明</dt><dd>
                  {diplomacyAction === 'goodwill' && `消耗资金${GOODWILL_GOLD_COST}，逐步提升双方友好度`}
                  {diplomacyAction === 'alliance' && (areAllies(state, state.playerForceId, activeDiplomacyForceId) ? '双方已是同盟' : `礼金越高成功率越高（上限${DIPLOMACY_GOLD_MAX.toLocaleString('en-US')}金），同盟后不可互相攻击`)}
                  {diplomacyAction === 'truce' && '约定期限内双方互不交战'}nnn
                  {diplomacyAction === 'requestTroops' && '仅限同盟；对方将派兵驰援最近的我方战事'}
                  {diplomacyAction === 'break' && '立即解除同盟，友好度大幅下降'}
                </dd></div>
              </dl>
            )}
            {(diplomacyAction === 'alliance' || diplomacyAction === 'truce') && (
              <label className="field-row">
                <span>礼金</span>
                <input
                  type="number"
                  min={0}
                  max={Math.min(city.gold, DIPLOMACY_GOLD_MAX)}
                  step={500}
                  value={diplomacyGoldClamped}
                  onChange={(event) => setDiplomacyGold(Math.max(0, Number(event.target.value)))}
                  aria-label="礼金"
                />
              </label>
            )}
            {diplomacyAction === 'truce' && (
              <label className="field-row">
                <span>停战月数</span>
                <select aria-label="停战月数" value={diplomacyMonths} onChange={(event) => setDiplomacyMonths(Number(event.target.value))}>
                  {Array.from({ length: TRUCE_MONTHS_MAX - TRUCE_MONTHS_MIN + 1 }, (_, index) => TRUCE_MONTHS_MIN + index).map((months) => (
                    <option key={months} value={months}>{months}个月</option>
                  ))}
                </select>
              </label>
            )}
          </section>
        )}

        {type === 'captiveDispose' && (
          <section className="grant-treasure-panel" aria-label="处置俘虏">
            {captiveOfficers.length === 0 ? (
              <div className="command-note">本势力当前没有关押任何俘虏（击破敌军部队或赢得单挑可俘获敌将）</div>
            ) : (
              <>
                <label className="field-row">
                  <span>俘虏</span>
                  <select aria-label="俘虏" value={activeCaptiveId} onChange={(event) => setCaptiveOfficerId(event.target.value)}>
                    {captiveOfficers.map((officer) => (
                      <option key={officer.id} value={officer.id}>{officer.name} · 忠{officerLoyalty(officer)}（原属{(officer.forceId && state.forces[officer.forceId]?.name) || '在野'}）</option>
                    ))}
                  </select>
                </label>
                <label className="field-row">
                  <span>处置</span>
                  <select aria-label="处置方式" value={captiveAction} onChange={(event) => setCaptiveAction(event.target.value as typeof captiveAction)}>
                    <option value="recruit">劝降登用（忠诚须降至{CAPTIVE_RECRUIT_LOYALTY_THRESHOLD}以下）</option>
                    <option value="release">释放</option>
                    <option value="execute">处斩</option>
                  </select>
                </label>
                {activeCaptive && (
                  <dl className="produce-stock">
                    <div><dt>忠诚</dt><dd>{officerLoyalty(activeCaptive)}</dd></div>
                    <div><dt>{captiveAction === 'recruit' ? '登用成功率' : captiveAction === 'release' ? '释放效果' : '处斩效果'}</dt><dd>
                      {captiveAction === 'recruit'
                        ? `${activeCaptiveExecutor ? recruitCaptiveChance(state, state.playerForceId, activeCaptiveExecutor, activeCaptive) : 0}%${capturableByLoyalty(activeCaptive) ? '' : '（忠诚未达标，可等待其随时间下降）'}`
                        : captiveAction === 'release'
                          ? '释放俘虏可提升本势力名声'
                          : '处斩俘虏将招致对方势力仇恨'}
                    </dd></div>
                  </dl>
                )}
              </>
            )}
          </section>
        )}

        {type === 'marry' && (
          <section className="grant-treasure-panel" aria-label="仲介">
            <label className="field-row">
              <span>关系</span>
              <select aria-label="关系类型" value={marryRelation} onChange={(event) => { setMarryRelation(event.target.value as typeof marryRelation); setMarryOfficerB(''); }}>
                <option value="spouse">结为夫妻</option>
                <option value="sworn">歃血结义</option>
              </select>
            </label>
            <label className="field-row">
              <span>武将甲</span>
              <select aria-label="武将甲" value={activeMarryOfficerA} onChange={(event) => { setMarryOfficerA(event.target.value); setMarryOfficerB(''); }}>
                {marryCandidates.map((officer) => (
                  <option key={officer.id} value={officer.id}>{officer.name} · 统{officer.stats.leadership} 武{officer.stats.war} 智{officer.stats.intelligence}</option>
                ))}
              </select>
            </label>
            {marrySelf && (
              <label className="field-row">
                <span>武将乙</span>
                <select aria-label="武将乙" value={activeMarryOfficerB} onChange={(event) => setMarryOfficerB(event.target.value)}>
                  {marryPartners.length === 0
                    ? <option value="">无合适人选</option>
                    : marryPartners.map((officer) => (
                      <option key={officer.id} value={officer.id}>{officer.name} · 统{officer.stats.leadership} 武{officer.stats.war} 智{officer.stats.intelligence}</option>
                    ))}
                </select>
              </label>
            )}
            <div className="command-note">仲介消耗技巧P {MARRY_TECHP_COST}，双方必须同在我方城市待命且均未行动；结为夫妻或结义会提升忠诚，夫妻若一方有「内助」特技则双方全能力+1</div>
          </section>
        )}

        {type === 'legion' && (
          <section className="grant-treasure-panel" aria-label="委任军团">
            <label className="field-row">
              <span>军团长</span>
              <select aria-label="军团长" value={legionCommanderId} onChange={(event) => setLegionCommanderId(event.target.value)}>
                <option value="">请选择军团长</option>
                {legionCommanders.map((officer) => (
                  <option key={officer.id} value={officer.id}>{officer.name} · 统{officer.stats.leadership} 政{officer.stats.politics}{legionContaining(state, state.playerForceId, cityId)?.commanderId === officer.id ? '（现任）' : ''}</option>
                ))}
                <option value="none">解散军团</option>
              </select>
            </label>
            <label className="field-row">
              <span>城市</span>
              <select aria-label="委任城市" value={activeLegionCityId} onChange={(event) => setLegionCityId(event.target.value as CityId)}>
                {legionCities.map((target) => (
                  <option key={target.id} value={target.id}>{target.name}{legionContaining(state, state.playerForceId, target.id) ? '（已委任）' : '（直辖）'}</option>
                ))}
              </select>
            </label>
            {legionCommanderId !== '' && legionCommanderId !== 'none' && (
              <label className="field-row">
                <span>方针</span>
                <select aria-label="军团方针" value={legionPolicy} onChange={(event) => setLegionPolicy(event.target.value as typeof legionPolicy)}>
                  {Object.entries(LEGION_LABELS).map(([key, label]) => (
                    <option key={key} value={key}>{label}</option>
                  ))}
                </select>
              </label>
            )}
            {legionCommanderId === 'none' ? (
              <div className="command-note">{legionContaining(state, state.playerForceId, activeLegionCityId)
                ? `解散包含 ${state.cities[activeLegionCityId].name} 的军团，该城回归直辖`
                : `${state.cities[activeLegionCityId]?.name ?? ''}不属于任何军团，无需解散`}</div>
            ) : (
              <div className="command-note">委任后军团长将在行动力许可内自动为所辖城市开发、训练、征兵（方针影响优先级）；解散军团使城市回归君主直辖</div>
            )}
          </section>
        )}

        {type === 'buildFacilityPlot' && (() => {
          const ALL_FACILITIES: PlotType[] = [
            // 第一行：市场、造币厂、黑市、大市场、鱼市、户部、刑部
            'market', 'mint', 'blackmarket', 'grandmarket', 'fishmarket', 'hubu', 'xingbu',
            // 第二行：农场、谷仓、军屯农、兵部、工部、礼部、吏部
            'farm', 'granary', 'garrisonfarm', 'bingbu', 'gongbu', 'libu', 'personnel',
            // 第三行：兵舍、锻冶厂、厩舍、工房、造船厂、太学、铜雀台
            'barracks', 'forge', 'stable', 'smithy', 'shipyard', 'taixue', 'tongqueta',
          ];
          // 一城限一：造币、谷仓、大市场、鱼市、军屯农、六部、太学、铜雀台
          const UNIQUE_FACILITIES = UNIQUE_PLOT_FACILITIES;
          const facilityCounts: Record<PlotType, number> = Object.fromEntries(
            ALL_FACILITIES.map((f) => [f, plotCountIncludingConstructing(city, f)])
          ) as Record<PlotType, number>;
          const activeOfficer = state.officers[activeOfficerId];
          const estimatedTenDays = activeOfficer ? constructTenDaysFor(activeOfficer.stats.politics) : 10;
          const isUniqueBuilt = (f: PlotType) => UNIQUE_FACILITIES.includes(f) && facilityCounts[f] > 0;
          return (
            <section className="grant-treasure-panel" aria-label="开发">
              <div className="plot-facility-grid">
                {ALL_FACILITIES.map((f) => {
                  const selected = plotFacility === f;
                  const disabled = isUniqueBuilt(f);
                  const level = facilityCounts[f];
                  return (
                    <button
                      key={f}
                      type="button"
                      className={`plot-facility-card${selected ? ' is-selected' : ''}${disabled ? ' is-disabled' : ''}`}
                      onClick={() => !disabled && setPlotFacility(f)}
                      disabled={disabled}
                    >
                      <div className="plot-facility-card-title">
                        <span>{PLOT_LABELS[f]}</span>
                        {disabled ? (
                          <span className="plot-facility-card-level">已建</span>
                        ) : level > 0 ? (
                          <span className="plot-facility-card-level">Lv.{level}</span>
                        ) : null}
                      </div>
                      <div className="plot-facility-card-desc">{plotCost(f)} 金{UNIQUE_FACILITIES.includes(f) ? ' · 限一' : ''}</div>
                    </button>
                  );
                })}
              </div>
              <dl className="produce-stock plot-produce-inline">
                <div><dt>资金</dt><dd>{city.gold.toLocaleString('en-US')} → {Math.max(0, city.gold - plotCost(plotFacility)).toLocaleString('en-US')}</dd></div>
                <div><dt>期间</dt><dd>约 {estimatedTenDays} 旬（武将政{activeOfficer?.stats.politics ?? 0}）</dd></div>
              </dl>
            </section>
          );
        })()}

        {type === 'appointStrategist' && (
          <section className="grant-treasure-panel" aria-label="任命军师">
            <label className="field-row">
              <span>军师</span>
              <select
                aria-label="军师"
                value={strategistOfficerId === '__clear__' ? '__clear__' : strategistOfficerId || state.forces[state.playerForceId]?.strategistId || ''}
                onChange={(event) => setStrategistOfficerId(event.target.value)}
              >
                <option value="">（沿用现任军师）</option>
                <option value="__clear__">解除军师任命</option>
                {forceOfficers.map((officer) => (
                  <option key={officer.id} value={officer.id}>{officer.name} · 智{officer.stats.intelligence}{state.forces[state.playerForceId]?.strategistId === officer.id ? '（现任）' : ''}</option>
                ))}
              </select>
            </label>
            <div className="command-note">军师在流言、挖角、外交、登用俘虏等谋略行动中提供智力加成；职务调整即时生效</div>
          </section>
        )}

        {type !== 'explore' && type !== 'research' && type !== 'abilityResearch' && type !== 'appointPosition' && (
          <div className="command-cost">
            <span>行动力</span><strong>-{COMMAND_AP[type]}</strong>
            {estimatedCost && (
              <>
                <span>预计消耗</span><strong>{estimatedCost}</strong>
              </>
            )}
          </div>
        )}

        {(visibleErrors.length > 0 || submitError) && (
          <div className="validation-errors" role="alert"><AlertCircle /> <span>{submitError ?? visibleErrors.join('；')}</span></div>
        )}

        <footer>
          <button type="button" className="secondary-button" onClick={onClose}>返回</button>
          <button type="submit" className="primary-button" disabled={actionableErrors.length > 0 || (type === 'trade' && tradeIdle) || (type === 'abilityResearch' && cultivateMode && cultivateCandidates.length === 0)}>
            {type === 'abilityResearch' && abilityStatus === 'done'
              ? (abilityRemaining > 0 ? '决定培育' : '已研究完毕')
              : `决定·${label}`}
          </button>
        </footer>
      </form>
    </div>
  );
}
