import { AlertCircle, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { useAudioEventAdapter } from '../audio/reactAudioEventAdapter';
import { ARMAMENT_GOLD_COST, ARMAMENT_TYPES, armamentCost, armamentLabelFor, armamentProductionIntelligence, armamentProductionTenDays, armamentsOf, isDelayedArmament, produceArmamentYield } from '../game/armaments';
import { COMMAND_AP, COMMAND_LABELS, SELL_FEE_RATIO, TRADE_MAX_GRAIN, envoyTravelTenDays, grainPriceOf, patrolGoldCost, passAvailableOfficers, quoteTrade, researchTechPCost, rumorTravelTenDays, strongholdTransferDuration, tradeEffectMultiplier, tradeEffectPercent, validateCommand } from '../game/commands';
import { TECH_NODES, TECH_SYSTEMS, canBuildFacility, facilityGateNode, hasTech, moraleCapOf, researchTenDays, researchableTechs, techCostOf, techNodeOf } from '../game/techs';
import { EXPLORE_AP_PER_OFFICER, EXPLORE_GOLD_PER_OFFICER, treasureDefinition, treasureEffectText } from '../game/treasures';
import { REWARD_GOLD_COST, loyaltyCapOf, officerLoyalty, recruitWillOf, recruitWillTier, rewardLoyaltyGain, talentTargetStationAllows } from '../game/loyalty';
import { ABILITY_CENTER, ABILITY_NODE_MAP, ABILITY_NODES, ABILITY_RESEARCH_GOLD, ABILITY_START_ID, ABILITY_TREE_COLS, ABILITY_TREE_ROWS, abilityCultivateRemaining, abilityEffectText, abilityKindLabel, abilityNodeStatus, canCultivateOfficer } from '../game/abilityResearch';
import { POSITIONS, forceRankOf, officerIsOnCampaign, officerMerit, positionDefinition, rankDefinition, rankIndex } from '../game/ranks';
import { capturableByLoyalty, captivesOf, recruitCaptiveChance, captiveRecruitLoyaltyThreshold } from '../game/captives';
import { DIPLOMACY_ACTION_LABELS, DIPLOMACY_GOLD_MAX, DIPLOMACY_GOLD_STEP, GOODWILL_GOLD_COST, NEUTRAL_DIPLOMACY, TRUCE_MONTHS_MAX, TRUCE_MONTHS_MIN, areAllies, forceDiplomacy, forceRelationView } from '../game/diplomacy';
import { LEGION_LABELS, PLOT_LABELS, ARMAMENT_FACILITY, COMMAND_OFFICER_MAX, armamentFacilityLabel, armamentInProgressCount, armamentProductionBlockReason, armamentTimesLeft, armamentYieldMultiplier, barracksYieldMultiplier, constructionPolitics, constructTenDaysForOfficers, defaultOfficersFor, hasEmptyPlot, hasPlotFacility, isImmediateArmamentFacility, patrolOrderGain, plotBuiltCount, plotConstructingCount, plotCost, plotCountIncludingConstructing, plotTotalLevel, recruitBaseYield, recruitTimesLeft, recruitTimesPerTenDay, trainMoraleGain, legionContaining, legionsOf, UNIQUE_FACILITIES as UNIQUE_PLOT_FACILITIES, type PlotType } from '../game/innerAffairs';
import { cityResourceCaps } from '../game/strongholdCapacity';
import { hasCityTrait } from '../game/cityTraits';
import { MARRY_TECHP_COST, relationCandidates } from '../game/relationship';
import { POACH_GOLD_COST, RUMOR_GOLD_COST, canPoach, poachChance, rumorTargetOptions } from '../game/rumor';
import { RUMOR_ADVICE_MIN_CHANCE, diplomacyAdviceOf, recruitAdviceOf, rumorAdviceOf, strategistOf } from '../game/strategist';
import { armamentProductionSpeedMultiplier, commandYieldMultiplier } from '../game/skills/rules/city';
import { useGame } from '../game/store/GameProvider';
import type { ArmamentType, CityId, DiplomacyAction, ForceId, GameCommand, Officer, PassId, TechNodeId } from '../game/types';
import { ForceRelationDialog } from './ForceRelationDialog';
import { OfficerPickerDialog } from './OfficerPickerDialog';
import { OfficerPortrait } from './OfficerPortrait';
import { TalentTargetPickerDialog } from './TalentTargetPickerDialog';
import { RumorTargetPickerDialog } from './RumorTargetPickerDialog';
import { TechTreePanel, type TechNodeStatus } from './TechTreePanel';
import { closePopupOnContextMenu } from './popupEvents';

interface CommandDialogProps {
  type: GameCommand['type'];
  cityId: CityId;
  /** 可选：关隘据点（存在时指令以关隘为资源与武将宿主，视为无都市选项的城池） */
  passId?: PassId;
  /** 可选：外交指令的初始行动（由命令菜单「外交」段选定；缺省按亲善） */
  diplomacyAction?: DiplomacyAction;
  onClose(): void;
  /** 可选：覆盖默认的提交行为（用于需要后续地图点击的指令，如建设） */
  onSubmitOverride?(data: { command: GameCommand; close: () => void }): void;
}

/** 多人执行指令（勾选1~3名武将共同执行） */
const MULTI_OFFICER_TYPES: GameCommand['type'][] = ['recruit', 'produceArmament', 'train', 'patrol', 'research', 'buildFacilityPlot'];

/**
 * 礼金拖动条的「静置」判定（毫秒）：拖动途中 range 连续派发 change，
 * 军师若逐个变化都开口就会一闪而过——因此拖动期间先收起提示，
 * 待连续变动停下这么久之后再让军师给出评估。
 */
const DIPLOMACY_HINT_SETTLE_MS = 250;

/** 军师提示框的视图模型（流言与外交共用同一套渲染） */
interface StrategistHintView {
  /** 说话人（流言可行时是建议人选，其余是军师本人） */
  speaker: Officer;
  /** 军师是否认可当前条件（决定提示框配色） */
  viable: boolean;
  text: string;
  /** 右下角小字（如「预估成功率 34% · 点击任意处采纳」） */
  meta?: string;
  /** 有值时：点击任意区域即把该武将填进「执行武将」 */
  adoptId?: string;
}

type ExecutorStatKey = keyof Officer['stats'];
const EXECUTOR_STAT_LABELS: Record<ExecutorStatKey, string> = {
  leadership: '统率',
  war: '武力',
  intelligence: '智力',
  politics: '政治',
  charisma: '魅力',
};

export function CommandDialog({ type, cityId, passId, diplomacyAction: initialDiplomacyAction, onClose, onSubmitOverride }: CommandDialogProps) {
  const { state, issueCommand } = useGame();
  const audio = useAudioEventAdapter();
  const [officerId, setOfficerId] = useState('');
  const [armamentType, setArmamentType] = useState<ArmamentType>('spear');
  const [targetCityId, setTargetCityId] = useState<CityId | ''>('');
  const [officerIds, setOfficerIds] = useState<string[]>([]);
  // 移动/召唤：选择武将弹窗开关
  const [transferPickerOpen, setTransferPickerOpen] = useState(false);
  const [explorePickerOpen, setExplorePickerOpen] = useState(false);
  // 褒奖：勾选的被奖赏武将列表 + 选将弹窗开关
  const [rewardOfficerIds, setRewardOfficerIds] = useState<string[]>([]);
  const [rewardPickerOpen, setRewardPickerOpen] = useState(false);
  // 多人执行指令（建设/兵装/征兵/训练/巡查/科技研究）：勾选的执行武将 + 勾选弹窗开关
  const [executorIds, setExecutorIds] = useState<string[]>([]);
  const [executorPickerOpen, setExecutorPickerOpen] = useState(false);
  // 交易滑块：0=不交易，负值=卖出兵粮，正值=买入兵粮（单位：兵粮）
  const [tradeValue, setTradeValue] = useState(0);
  // 技巧研究：选中的科技节点 id（'' = 用默认节点：第一个可研究节点）
  const [techNodeId, setTechNodeId] = useState<TechNodeId>('');
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
  // 流言：目标据点（'' = 未手选，需玩家先选定）+ 目标列表页开关 + 执行武将列表页开关
  const [rumorTargetCityId, setRumorTargetCityId] = useState<CityId | ''>('');
  const [rumorTargetPassId, setRumorTargetPassId] = useState<PassId | ''>('');
  const [rumorPickerOpen, setRumorPickerOpen] = useState(false);
  const [rumorExecutorPickerOpen, setRumorExecutorPickerOpen] = useState(false);
  /** 军师提示已被采纳/已被点掉 → 收起提示框（流言与外交共用；改选目标/礼金时重置） */
  const [hintSettled, setHintSettled] = useState(false);
  // 登庸：对象武将（'' = 未手选，回退到默认候选）+ 全武将列表页开关
  const [talentTargetId, setTalentTargetId] = useState('');
  const [talentPickerOpen, setTalentPickerOpen] = useState(false);
  // 挖角：目标城市 + 目标武将
  const [poachTargetCityId, setPoachTargetCityId] = useState<CityId | ''>('');
  const [poachTargetOfficerId, setPoachTargetOfficerId] = useState('');
  // 外交：目标势力 + 行动（两者默认都不预选，须玩家先选定势力）
  const [diplomacyForceId, setDiplomacyForceId] = useState<ForceId | ''>('');
  // 外交：出使武将（使者，'' = 未选，须玩家点开武将列表选择）
  const [diplomacyOfficerId, setDiplomacyOfficerId] = useState('');
  // 外交：出使武将选择弹窗（单击即选定并返回）
  const [diplomacyOfficerPickerOpen, setDiplomacyOfficerPickerOpen] = useState(false);
  // 外交：行动由命令菜单「外交」段选定（页内不再提供切换），直接跟随 prop；缺省按亲善
  const diplomacyAction: DiplomacyAction = initialDiplomacyAction ?? 'goodwill';
  const [diplomacyGold, setDiplomacyGold] = useState(0);
  const [diplomacyMonths, setDiplomacyMonths] = useState(TRUCE_MONTHS_MIN);
  /** 外交：礼金或停战月数被玩家动过 → 军师这时才开口（见 diplomacyAdvice） */
  const [diplomacyHintArmed, setDiplomacyHintArmed] = useState(false);
  /** 礼金拖动条的「静置」计时器：拖停 DIPLOMACY_HINT_SETTLE_MS 之后才置 diplomacyHintArmed */
  const diplomacyHintTimerRef = useRef<number | null>(null);
  // 外交：打开「选择对象势力」一览页（选定后回到本页继续选行动）
  const [forceSelectOpen, setForceSelectOpen] = useState(false);
  // 处置俘虏：目标 + 行动
  const [captiveOfficerId, setCaptiveOfficerId] = useState('');
  const [captiveAction, setCaptiveAction] = useState<'recruit' | 'release' | 'execute'>('recruit');
  // 仲介（婚姻/结义）
  const [marryOfficerA, setMarryOfficerA] = useState('');
  const [marryOfficerB, setMarryOfficerB] = useState('');
  const [marryOfficerIds, setMarryOfficerIds] = useState<string[]>([]);
  const [marryRelation, setMarryRelation] = useState<'spouse' | 'sworn'>('spouse');
  // 义兄弟：勾选的结义武将（2~3名同性）
  const [swornOfficerIds, setSwornOfficerIds] = useState<string[]>([]);
  /** 仲介选择的弹窗：sworn=义兄弟（打开即直接弹出），marriage=婚姻 */
  const [relatePicker, setRelatePicker] = useState<'sworn' | 'marriage' | null>(() => type === 'sworn' ? 'sworn' : null);
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
      dialog?.querySelector<HTMLElement>('.command-executor-toggle') ??
      dialog?.querySelector<HTMLElement>('button:not([disabled])');
    firstControl?.focus();
    return () => previousFocus.current?.focus();
  }, []);

  // 卸载时清掉礼金拖动条的静置计时器，避免对话框已关闭还去 setState
  useEffect(() => () => {
    if (diplomacyHintTimerRef.current !== null) {
      window.clearTimeout(diplomacyHintTimerRef.current);
      diplomacyHintTimerRef.current = null;
    }
  }, []);

  if (!state) return null;
  const pass = passId ? state.passes?.[passId] : undefined;
  const city = state.cities[cityId];
  const garrison = pass ?? city;
  const garrisonName = pass ? pass.name : city.name;
  const garrisonGold = pass ? pass.gold : city.gold;
  const garrisonFood = pass ? pass.food : city.food;
  const garrisonTroops = pass ? pass.troops : city.troops;
  const garrisonTraining = pass ? pass.training : city.training;
  const garrisonOrder = pass ? pass.order : city.order;
  const officers = Object.values(state.officers).filter((officer) =>
    officer.forceId === state.playerForceId &&
    (pass
      ? officer.location.kind === 'pass' && officer.location.passId === passId
      : officer.location.kind === 'city' && officer.location.cityId === cityId),
  );
  const availableOfficers = officers.filter((officer) => !officer.acted);
  const tradeOfficers = [...availableOfficers].sort((a, b) => b.stats.politics - a.stats.politics);
  // 探索：按智力降序排列，勾选数量受行动力限制（每人20）
  const exploreOfficers = [...availableOfficers].sort((a, b) => b.stats.intelligence - a.stats.intelligence);
  const exploreMaxCount = Math.floor(state.actionPoints[state.playerForceId] / EXPLORE_AP_PER_OFFICER);
  const exploreSelected = exploreOfficerIds.filter((id) => availableOfficers.some((officer) => officer.id === id));
  // 收授宝物：本势力已出土宝物
  const ownedTreasures = Object.values(state.treasures ?? {}).filter((treasure) => treasure.ownerId === state.playerForceId);
  const activeTreasureId = treasureId || ownedTreasures[0]?.id || '';
  const activeTreasure = activeTreasureId ? state.treasures?.[activeTreasureId] : undefined;
  const activeTreasureDef = activeTreasureId ? treasureDefinition(activeTreasureId) : undefined;
  const forceOfficers = Object.values(state.officers).filter((officer) => officer.forceId === state.playerForceId);
  // 褒奖：本势力所有未出征武将（非君主/本旬未受褒奖/忠诚未达基准值），按忠诚从低到高排列
  const leaderId = state.forces[state.playerForceId]?.leaderId;
  const rewardCandidates = forceOfficers
    .filter((officer) => officer.id !== leaderId && officerLoyalty(officer) < loyaltyCapOf(state, officer) && !officer.rewarded && !officerIsOnCampaign(state, officer.id))
    .sort((a, b) => officerLoyalty(a) - officerLoyalty(b));
  // 任命官职：非君主且未随军出城的武将按功绩降序；可选官职 = 功绩与爵位均满足的官职（不占用行动力）
  const appointableOfficers = forceOfficers
    .filter((officer) => officer.id !== state.forces[state.playerForceId]?.leaderId)
    .filter((officer) => !officerIsOnCampaign(state, officer.id))
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
  // 技巧研究：默认选中第一个可研究节点（无任何可研究节点时回退到科技树第一个节点）
  const researchableNodeIds = researchableTechs(state, state.playerForceId);
  const activeTechNodeId: string = techNodeId || researchableNodeIds[0] || TECH_NODES[0].id;
  const activeTechNode = techNodeOf(activeTechNodeId);
  const activeTechCost = techCostOf(activeTechNodeId);
  const activeTechSystem = TECH_SYSTEMS.find((system) => system.id === activeTechNode?.system);
  // 本势力正在研究的节点（每旬每势力只允许一项）
  const researchingNodeIds = new Set<string>(Object.values(state.officers).flatMap((officer) => {
    const location = officer.location;
    return officer.forceId === state.playerForceId && location.kind === 'task' && location.task === 'research'
      ? [location.nodeId]
      : [];
  }));
  /** 科技树节点状态：已研究／正在研究／可研究／前置未满足 */
  const techNodeStatus = (nodeId: string): TechNodeStatus => {
    if (hasTech(state, state.playerForceId, nodeId)) return 'done';
    if (researchingNodeIds.has(nodeId)) return 'researching';
    return researchableNodeIds.includes(nodeId) ? 'current' : 'locked';
  };
  // 技巧研究：按所选节点的研究属性排序武将
  const researchStatKey: ExecutorStatKey = activeTechNode?.stat ?? 'politics';
  const forceTechP = state.forces[state.playerForceId]?.techP ?? 0;
  const activeTechPrevId = activeTechNode?.prev;
  /** 选中节点的研究状态提示：已研究／正在研究中／需先研究「前置」／可研究 */
  const researchStatusText = !activeTechNode
    ? '节点无效'
    : hasTech(state, state.playerForceId, activeTechNodeId)
      ? '已研究'
      : researchingNodeIds.has(activeTechNodeId)
        ? '正在研究中'
        : activeTechPrevId && !hasTech(state, state.playerForceId, activeTechPrevId)
          ? `需先研究「${techNodeOf(activeTechPrevId)?.name ?? '前置科技'}」`
          : '可研究';
  // 多人执行指令：默认推荐 1~3 名武将，达到最佳效果即停止增加
  const isMultiOfficer = MULTI_OFFICER_TYPES.includes(type);
  const executorStatKey: ExecutorStatKey = type === 'recruit' ? 'charisma'
    : type === 'produceArmament' ? 'intelligence'
      : type === 'train' ? 'war'
        : type === 'patrol' ? 'leadership'
          : type === 'research' ? researchStatKey
            : 'politics';
  const executorCandidates = [...availableOfficers].sort((a, b) => b.stats[executorStatKey] - a.stats[executorStatKey]);
  const defaultRecIds = useMemo(() => {
    if (!isMultiOfficer) return [];
    switch (type) {
      case 'buildFacilityPlot':
        return defaultOfficersFor(garrison, availableOfficers, { type: 'buildFacilityPlot' });
      case 'produceArmament': {
        const speedMul = type === 'produceArmament' && armamentType
          ? armamentProductionSpeedMultiplier(state, {
            type: 'produceArmament', cityId, passId, officerIds: [], armamentType,
          })
          : 1;
        return defaultOfficersFor(garrison, availableOfficers, { type: 'produceArmament', armamentType: armamentType!, speedMultiplier: speedMul });
      }
      case 'recruit':
        return defaultOfficersFor(garrison, availableOfficers, { type: 'recruit' });
      case 'train':
        return defaultOfficersFor(garrison, availableOfficers, { type: 'train' }, moraleCapOf(state, garrison.ownerId));
      case 'patrol':
        return defaultOfficersFor(garrison, availableOfficers, { type: 'patrol' });
      case 'research':
        return defaultOfficersFor(garrison, availableOfficers, { type: 'research', nodeId: activeTechNodeId });
      default:
        return executorCandidates[0] ? [executorCandidates[0].id] : [];
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isMultiOfficer, type, garrison.id, availableOfficers.length, armamentType, activeTechNodeId, state.actionPoints[state.playerForceId] // actionPoints 作校验标识，避免无限重算
  ]);
  const validExecutorIds = executorIds.filter((id) => executorCandidates.some((officer) => officer.id === id));
  const activeExecutorIds = validExecutorIds.length > 0
    ? validExecutorIds
    : defaultRecIds;
  const activeExecutors = activeExecutorIds
    .map((id) => state.officers[id])
    .filter((officer): officer is Officer => Boolean(officer));
  const activeOfficerId = officerId
    || (type === 'trade' ? tradeOfficers[0]?.id : availableOfficers[0]?.id)
    || '';
  // 委任军团直辖城市（军团只辖城池）
  const targetCities = Object.values(state.cities).filter((item) => item.ownerId === state.playerForceId && item.id !== cityId);
  // 移动/召唤目标：己方城池 + 己方关隘（城池模式排除自身城池；关隘模式排除自身关隘，可移回所属城池）
  const transferTargets = [
    ...Object.values(state.cities)
      .filter((item) => item.ownerId === state.playerForceId && (pass || item.id !== cityId))
      .map((item) => ({ id: item.id as string, name: item.name })),
    ...Object.values(state.passes ?? {})
      .filter((item) => item.ownerId === state.playerForceId && item.id !== passId)
      .map((item) => ({ id: item.id as string, name: item.name })),
  ];
  const activeTargetId = targetCityId || transferTargets[0]?.id || '';
  const activeTarget = activeTargetId
    ? state.passes?.[activeTargetId as PassId] ?? state.cities[activeTargetId as CityId]
    : undefined;
  const activeTransferDuration = activeTarget ? strongholdTransferDuration(state, garrison, activeTarget) : null;
  // 召唤：目标据点（城池/关隘）内的待命武将（排除已行动/死亡武将；太守也可召唤）
  const summonOfficers = transferTargets.length > 0
    ? Object.values(state.officers).filter((officer) =>
        officer.forceId === state.playerForceId && !officer.deathMonth && !officer.acted
        && transferTargets.some((target) =>
          (officer.location.kind === 'city' && officer.location.cityId === target.id)
          || (officer.location.kind === 'pass' && officer.location.passId === target.id)),
      )
    : [];
  const activeOfficer = activeOfficerId ? state.officers[activeOfficerId] : undefined;
  // 流言：目标据点选项（全部敌城 + 有守将的敌关隘）；默认不预选，须玩家先选定据点
  const rumorOptions = type === 'rumor' ? rumorTargetOptions(state, state.playerForceId) : [];
  const activeRumorTargetId = rumorTargetPassId || rumorTargetCityId;
  const activeRumorOption = rumorOptions.find((option) => option.id === activeRumorTargetId);
  const activeRumorStronghold = activeRumorOption
    ? (activeRumorOption.kind === 'pass'
      ? state.passes?.[activeRumorOption.id as PassId]
      : state.cities[activeRumorOption.id as CityId])
    : undefined;
  // 军师对流言的评估：从本据点可用武将中预估成功率——有可能→建议人选；无可能→军师出面说明
  const rumorAdvice = type === 'rumor' && activeRumorStronghold
    ? rumorAdviceOf(state, availableOfficers, activeRumorStronghold)
    : null;
  const rumorSpeaker = rumorAdvice?.viable
    ? state.officers[rumorAdvice.executorId!]
    : strategistOf(state, state.playerForceId);
  /**
   * 流言差旅：执行武将须亲赴目标据点，去程与返程同距，
   * 单程 = 出发据点 → 目标据点的移动旬数（1旬=10天），全程 = 单程 × 2。
   */
  const rumorTravel = type === 'rumor' && activeRumorStronghold
    ? (() => {
        const origin = pass ? (state.cities[pass.homeCityId] ?? city) : city;
        if (!origin) return null;
        const travel = rumorTravelTenDays(state, origin, activeRumorStronghold);
        return { name: activeRumorStronghold.name, travel };
      })()
    : null;
  // 挖角：目标敌城 + 目标武将
  const poachCities = type === 'poach' ? rumorTargetOptions(state, state.playerForceId).filter((option) => option.kind === 'city') : [];
  const activePoachTargetCityId = poachTargetCityId || poachCities[0]?.id || '';
  const poachCandidates = activePoachTargetCityId
    ? Object.values(state.officers).filter(
        (officer) => officer.location.kind === 'city' && officer.location.cityId === activePoachTargetCityId,
      ).filter((officer) => canPoach(state, state.playerForceId, officer))
    : [];
  const activePoachOfficerId = poachTargetOfficerId || poachCandidates[0]?.id || '';
  // 血色衣冠 6.0：挖角目标的「登用接受意愿」（四档颜色：深绿/浅绿/浅黄/白）
  const activePoachTarget = activePoachOfficerId ? state.officers[activePoachOfficerId] : undefined;
  const poachExecutor = type === 'poach' ? activeOfficer : undefined;
  const poachWill = activePoachTarget && poachExecutor ? recruitWillOf(state, poachExecutor, activePoachTarget) : null;
  const poachWillTier = poachWill ? recruitWillTier(poachWill.verdict === 'accept' ? 999 : poachWill.will) : null;
  // 外交：目标势力（非己方、非已破盟）；默认不预选，须玩家先选定
  const diplomacyForces = Object.values(state.forces).filter((force) => force.id !== state.playerForceId);
  const activeDiplomacyForceId = diplomacyForceId;
  const activeDiplomacyForce = activeDiplomacyForceId ? state.forces[activeDiplomacyForceId] : undefined;
  const diplomacyForced = activeDiplomacyForceId ? forceDiplomacy(state, state.playerForceId, activeDiplomacyForceId) : NEUTRAL_DIPLOMACY;
  const activeDiplomacyRelation = activeDiplomacyForceId
    ? forceRelationView(state, state.playerForceId, activeDiplomacyForceId)
    : undefined;
  /** 外交礼金上限：受本据点资金与规则上限双重限制（拖动条的 max） */
  const diplomacyGoldMax = Math.min(garrisonGold, DIPLOMACY_GOLD_MAX);
  const diplomacyGoldClamped = Math.min(Math.max(0, diplomacyGold), diplomacyGoldMax);
  // 外交执行武将（使者）：默认不预选（须点开武将列表选择），故单独一份 state 而不复用通用 officerId；
  // 候选按政治降序 —— 判定式中执行者政治直接入算，越高越好
  const diplomacyOfficerCandidates = [...availableOfficers].sort((a, b) => b.stats.politics - a.stats.politics);
  const activeDiplomacyOfficer = diplomacyOfficerId ? state.officers[diplomacyOfficerId] : undefined;
  /**
   * 出使行程：单程 = 出发据点 → 对方势力君主所在城池的移动旬数（1旬=10天）。
   * 未选对象势力时为 null；`envoyDaysText` 即对话框里的「抵达日期」。
   */
  const envoyTenDays = type === 'diplomacy' && activeDiplomacyForceId
    ? envoyTravelTenDays(state, garrison, activeDiplomacyForceId)
    : null;
  const envoyDaysText = envoyTenDays === null ? '—' : `${envoyTenDays * 10}天`;
  /**
   * 军师对同盟/停战交涉的评估：判定式是确定式（无随机），故直接给「能否谈成」；
   * 谈不成时报出所需最低礼金。评估人取「已选使者」，未选时取政治最高的可用武将
   * （此时提示里会推举他，点击任意处即采纳）。
   * 仅在玩家动过礼金或停战月数之后出现（`diplomacyHintArmed`）——刚打开就报结论太吵。
   */
  const diplomacyAdvisor = activeDiplomacyOfficer ?? diplomacyOfficerCandidates[0];
  const diplomacyAdvice = type === 'diplomacy'
    && (diplomacyAction === 'alliance' || diplomacyAction === 'truce')
    && activeDiplomacyForceId
    && diplomacyHintArmed
    ? diplomacyAdviceOf(
        state, state.playerForceId, activeDiplomacyForceId as ForceId, diplomacyAction,
        diplomacyAdvisor, diplomacyGoldClamped, diplomacyMonths,
      )
    : null;
  // 血色衣冠 6.0：登庸对象 = 全地图在野武将与其他势力武将（君主除外）；默认取同城在野，可点开列表改选
  // 默认口径：寄居在其他势力城池的在野武将不可登庸（`talentTargetStationAllows`）
  const talentCandidates = type === 'talent'
    ? Object.values(state.officers).filter((officer) =>
        !officer.deathMonth
        && officer.location.kind !== 'captive'
        && (officer.forceId === null || officer.forceId !== state.playerForceId)
        && !(officer.forceId && state.forces[officer.forceId]?.leaderId === officer.id)
        && talentTargetStationAllows(state, state.playerForceId, officer))
    : [];
  const talentDefaultTargetId = type === 'talent'
    ? (talentCandidates.find((officer) => officer.forceId === null && officer.location.kind === 'unaffiliated' && officer.location.cityId === cityId)?.id
      ?? talentCandidates[0]?.id
      ?? '')
    : '';
  const activeTalentTargetId = talentTargetId || talentDefaultTargetId;
  const talentTarget = type === 'talent' && activeTalentTargetId ? state.officers[activeTalentTargetId] : undefined;
  const talentWill = talentTarget && activeOfficer ? recruitWillOf(state, activeOfficer, talentTarget) : null;
  const talentWillTier = talentWill ? recruitWillTier(talentWill.verdict === 'accept' ? 999 : talentWill.will) : null;
  /**
   * 军师对登庸任务的评估：从本据点待命武将中预估各人登用成功率，给出建议人选。
   * 达到门槛 → 指名我方行动武将（点击任意处采纳）；达不到 → 只出忠告（必拒时带原因）。
   */
  const recruitAdvice = type === 'talent' && talentTarget ? recruitAdviceOf(state, availableOfficers, talentTarget) : null;
  /** 军师提示框内容（流言与外交共用一套：说话人、台词、可采纳的人选） */
  const strategistHint: StrategistHintView | null = (() => {
    if (type === 'rumor' && rumorAdvice && rumorSpeaker) {
      return {
        speaker: rumorSpeaker,
        viable: rumorAdvice.viable,
        text: rumorAdvice.viable
          ? '此任务，还请务必交由我来担任。'
          : '处于这种情况之下，能够达成任务的可能性，可说是微乎其微啊。',
        meta: rumorAdvice.viable ? `预估成功率 ${rumorAdvice.chance}% · 点击任意处采纳` : undefined,
        adoptId: rumorAdvice.viable ? rumorAdvice.executorId : undefined,
      };
    }
    if (diplomacyAdvice) {
      const speaker = strategistOf(state, state.playerForceId);
      if (!speaker) return null;
      const chosen = Boolean(activeDiplomacyOfficer);
      // 所需礼金超过「本据点资金 / 规则上限」时，再怎么加钱也谈不成
      const affordable = Math.min(garrisonGold, DIPLOMACY_GOLD_MAX);
      const canAdopt = diplomacyAdvice.viable && !chosen;
      return {
        speaker,
        viable: diplomacyAdvice.viable,
        text: diplomacyAdvice.viable
          ? (chosen ? '此条件足以成事，请照此办理。' : `此条件足以成事，可遣${diplomacyAdvice.executorName}为使。`)
          : (diplomacyAdvice.requiredGold > affordable
            ? '纵是倾尽礼金，恐怕亦难如愿啊。'
            : `以此条件恐难如愿——礼金至少需 ${diplomacyAdvice.requiredGold.toLocaleString('en-US')} 金。`),
        meta: canAdopt ? `点击任意处采纳 · 遣${diplomacyAdvice.executorName}前往` : undefined,
        adoptId: canAdopt ? diplomacyAdvice.executorId : undefined,
      };
    }
    if (recruitAdvice && talentTarget) {
      const chosenId = recruitAdvice.viable ? recruitAdvice.executorId : undefined;
      const speaker = chosenId ? state.officers[chosenId] : strategistOf(state, state.playerForceId);
      if (!speaker) return null;
      if (recruitAdvice.viable) {
        // 建议人选自己开口请缨（与流言同款）；已被默认选中的话只需点头
        const adopted = activeOfficerId === chosenId;
        return {
          speaker,
          viable: true,
          text: adopted
            ? `凭我这三寸之舌，${talentTarget.name}定当应允。`
            : `这趟差事，还请务必交予我去说服${talentTarget.name}。`,
          meta: adopted
            ? `预估成功率 ${recruitAdvice.chance}%`
            : `预估成功率 ${recruitAdvice.chance}% · 点击任意处采纳`,
          adoptId: adopted ? undefined : chosenId,
        };
      }
      return {
        speaker,
        viable: false,
        text: recruitAdvice.rejected && recruitAdvice.reasons.length > 0
          ? `依我看来，${recruitAdvice.reasons[0]}，此事恐难如愿啊。`
          : recruitAdvice.chance > 0
            ? '依我看来，此番成算恐怕不足一半啊。'
            : '依我看来，说动此人恐是难如登天啊。',
        meta: recruitAdvice.chance > 0 ? `我方最高预估成功率 ${recruitAdvice.chance}%` : undefined,
      };
    }
    return null;
  })();
  /** 军师提示框的可见性（左键点击任意区域即收起，见下方 effect） */
  const hintVisible = Boolean(strategistHint && !hintSettled);
  /** 采纳军师建议：把人选填进对应的执行武将项，并收起提示框 */
  const adoptHint = (id: string) => {
    if (type === 'diplomacy') setDiplomacyOfficerId(id);
    else setOfficerId(id);
    setHintSettled(true);
  };
  /**
   * 收起军师提示：左键点击**任意区域**都生效（提示框本身没有关闭按钮），
   * 若有建议人选则同时填入执行武将；对话框本身保持打开。
   * 用 document 捕获阶段监听 mouseup——既在目标元素的 click 之前触发（点被提示框遮住的
   * 按钮时不会误触），又不会误伤「刚选定目标、提示框才出现」的那一次点击。
   */
  useEffect(() => {
    if (!hintVisible) return undefined;
    const dismissOnMouseUp = (event: MouseEvent) => {
      if (event.button !== 0) return;
      // 松开礼金拖动条的那一下不算「点任意区域」：拖动结束时提示本就该出现（或刚出现），
      // 若把它一并收掉，拖动结束仍会是一闪而过
      const target = event.target as HTMLElement | null;
      if (target instanceof HTMLInputElement && target.type === 'range') return;
      if (strategistHint?.adoptId) adoptHint(strategistHint.adoptId);
      else setHintSettled(true);
    };
    document.addEventListener('mouseup', dismissOnMouseUp, true);
    return () => document.removeEventListener('mouseup', dismissOnMouseUp, true);
  }, [hintVisible, strategistHint]);
  /**
   * 生产兵装：默认选中第一种「本据点当前可生产」的兵装。
   * 否则被卡住的兵装（缺设施 / 本旬次数用尽 / 设施全在产）会置灰却仍是选中态（金框 + 灰），
   * 读数看着能造其实不能；全部不可生产时保留原值，由 validateCommand 报原因拦下。
   */
  useEffect(() => {
    if (type !== 'produceArmament') return;
    if (!armamentProductionBlockReason(state, garrison, armamentType)) return;
    const firstAvailable = ARMAMENT_TYPES.find((item) => !armamentProductionBlockReason(state, garrison, item));
    if (firstAvailable) setArmamentType(firstAvailable);
  }, [type, garrison, armamentType, state]);
  /** 外交页的行动效果说明（亲善无额外说明，返回空串时整行不渲染） */
  const diplomacyNote = diplomacyAction === 'alliance'
    ? (activeDiplomacyForceId && areAllies(state, state.playerForceId, activeDiplomacyForceId)
      ? '双方已是同盟'
      : `礼金越高成功率越高（上限${DIPLOMACY_GOLD_MAX.toLocaleString('en-US')}金），同盟后不可互相攻击`)
    : diplomacyAction === 'truce'
      ? '约定期限内双方互不交战'
      : diplomacyAction === 'requestTroops'
        ? '仅限同盟；对方将派兵驰援最近的我方战事'
        : diplomacyAction === 'break'
          ? '立即解除同盟，友好度大幅下降'
          : '';
  // 跨城登庸：对象不在本市时，执行武将需先启程前往其所在城（行程按据点间距计旬）
  const talentTravelNote = type === 'talent' && talentTarget
    ? (() => {
        const targetCityId = talentTarget.location.kind === 'city' || talentTarget.location.kind === 'unaffiliated'
          ? talentTarget.location.cityId
          : talentTarget.cityId;
        if (!targetCityId || targetCityId === cityId) return null;
        const origin = pass ? state.cities[pass.homeCityId] ?? city : city;
        const dest = state.cities[targetCityId];
        if (!origin || !dest) return null;
        const travel = Math.max(1, strongholdTransferDuration(state, origin, dest));
        return { name: dest.name, travel };
      })()
    : null;
  // 处置俘虏：关押在本据点的俘虏
  const captiveOfficers = captivesOf(state, state.playerForceId);
  const activeCaptiveId = captiveOfficerId || captiveOfficers[0]?.id || '';
  const activeCaptive = activeCaptiveId ? state.officers[activeCaptiveId] : undefined;
  const activeCaptiveExecutor = availableOfficers.find((o) => o.id !== state.forces[state.playerForceId]?.leaderId);
  const captiveRecruitChance = activeCaptive && activeCaptiveExecutor
    ? recruitCaptiveChance(state, state.playerForceId, activeCaptiveExecutor, activeCaptive)
    : 0;
  // 血色衣冠 6.0：俘虏的「登用接受意愿」（四档颜色）
  const captiveWill = activeCaptive && activeCaptiveExecutor && type === 'captiveDispose'
    ? recruitWillOf(state, activeCaptiveExecutor, activeCaptive)
    : null;
  const captiveWillTier = captiveWill ? recruitWillTier(captiveWill.verdict === 'accept' ? 999 : captiveWill.will) : null;
  // 仲介（婚姻/结义）：同城待命武将作为候选人
  const marryCandidates = availableOfficers.filter((o) => o.id !== state.forces[state.playerForceId]?.leaderId && !o.deathMonth);
  const activeMarryOfficerA = marryOfficerA || marryCandidates[0]?.id || '';
  const marrySelf = activeMarryOfficerA ? state.officers[activeMarryOfficerA] : undefined;
  const marryPartners = marrySelf ? relationCandidates(state, state.playerForceId, pass ? { kind: 'pass', passId: passId! } : { kind: 'city', cityId }, marrySelf, marryRelation) : [];
  const activeMarryOfficerB = marryOfficerB || marryPartners[0]?.id || '';
  // 义兄弟：同城待命武将（非君主、非故）供勾选，选 2~3 名同性
  const swornCandidates = availableOfficers.filter((o) => o.id !== state.forces[state.playerForceId]?.leaderId && !o.deathMonth);
  // 婚姻候选人：仅当男、女均存在时才列入，避免强行把某一性别的武将塞进来
  const eligibleMale = availableOfficers.filter((o) => o.id !== state.forces[state.playerForceId]?.leaderId && !o.deathMonth && (o.gender ?? 'male') === 'male');
  const eligibleFemale = availableOfficers.filter((o) => o.id !== state.forces[state.playerForceId]?.leaderId && !o.deathMonth && (o.gender ?? 'male') === 'female');
  const marriageCandidates = eligibleMale.length > 0 && eligibleFemale.length > 0 ? [...eligibleMale, ...eligibleFemale] : [];
  // 委任军团：军团长候选人 + 直辖城市
  const legionCommanders = forceOfficers.filter((o) => o.id !== state.forces[state.playerForceId]?.leaderId && !o.deathMonth);
  const legionCities = targetCities;
  const activeLegionCityId = legionCityId || legionCities[0]?.id || '';
  const activeLegion = activeLegionCityId ? legionContaining(state, state.playerForceId, activeLegionCityId) : undefined;
  const legionCityConnected = Boolean(activeLegion);
  const cityArmaments = armamentsOf(garrison.armaments);
  const grainPrice = grainPriceOf(garrison);
  const tradeEffect = activeOfficer ? tradeEffectMultiplier(activeOfficer.stats.politics) : 1;
  const tradePercent = activeOfficer ? tradeEffectPercent(activeOfficer.stats.politics) : 100;
  // 交易/生产的容纳上限与指令校验同口径：按城池归属势力的科技（修筑要塞）计算，基准值由 strongholdCapacity 统一收口
  const cityCaps = cityResourceCaps(state, city);
  // 滑块左卖右买、居中为0：右侧可买上限受资金与城池兵粮余量限制，
  // 左侧可卖上限受兵粮与城池资金余量限制（两端都不得突破据点容纳上限），均不超过单次30000
  const tradeBuyMax = activeOfficer
    ? Math.min(TRADE_MAX_GRAIN, Math.floor(garrisonGold * grainPrice * tradeEffect), Math.max(0, cityCaps.food - city.food))
    : 0;
  // 卖出上限：兵粮、单次上限，以及目标城池的资金余量（卖出的金不能超过资金容纳上限）
  const sellGoldPerGrain = (tradeEffect * SELL_FEE_RATIO) / grainPrice;
  const tradeSellMax = Math.min(
    TRADE_MAX_GRAIN,
    garrisonFood,
    sellGoldPerGrain > 0 ? Math.floor(Math.max(0, cityCaps.gold - city.gold) / sellGoldPerGrain) : TRADE_MAX_GRAIN,
  );
  const tradeValueClamped = Math.max(-tradeSellMax, Math.min(tradeValue, tradeBuyMax));
  const tradeIdle = tradeValueClamped === 0;
  const tradeMode: 'buy' | 'sell' = tradeValueClamped >= 0 ? 'buy' : 'sell';
  const tradeAmount = Math.abs(tradeValueClamped);
  const tradeQuote = activeOfficer && !tradeIdle
    ? quoteTrade(garrison, activeOfficer.stats.politics, tradeMode, tradeAmount)
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
      // 目标为关隘时：targetPassId 携带真实目标，targetCityId 仅作类型占位（校验层优先读取 targetPassId）
      const isTargetPass = Boolean(state.passes?.[activeTargetId as PassId]);
      return {
        type,
        cityId,
        passId,
        targetCityId: (isTargetPass ? cityId : activeTargetId) as CityId,
        targetPassId: isTargetPass ? (activeTargetId as PassId) : undefined,
        officerIds,
      };
    }
    if (type === 'summon') {
      return { type, cityId, passId, officerIds };
    }
    if (type === 'sworn') {
      return { type, cityId, passId, officerIds: swornOfficerIds };
    }
    if (type === 'abilityResearch') {
      if (abilityNode && abilityStatus === 'done') {
        // 已研究完成：仅允许培育（次数用尽时返回 cultivate 命令，由验证拦截报错）
        return { type: 'cultivate', cityId, passId, officerId: cultivateOfficerChosen, nodeId: abilityNode.id };
      }
      return { type: 'abilityResearch', cityId, passId, nodeId: abilityNodeId };
    }
    if (type === 'reward') {
      return { type, cityId, passId, officerIds: rewardOfficerIds };
    }
    if (type === 'explore') {
      return { type, cityId, passId, officerIds: exploreOfficerIds };
    }
    if (type === 'grantTreasure') {
      return { type, cityId, passId, treasureId: activeTreasureId, officerId: grantOfficerId };
    }
    if (type === 'appointPosition') {
      return { type, cityId, passId, officerId: activePositionOfficer?.id ?? '', positionId: activePositionId || null };
    }
    if (type === 'rumor') {
      return activeRumorOption?.kind === 'pass'
        ? { type, cityId, passId, officerId: activeOfficerId, targetPassId: activeRumorOption.id as PassId }
        : { type, cityId, passId, officerId: activeOfficerId, targetCityId: activeRumorTargetId as CityId };
    }
    if (type === 'talent') {
      return { type, cityId, passId, officerId: activeOfficerId, targetOfficerId: activeTalentTargetId };
    }
    if (type === 'poach') {
      return { type, cityId, passId, officerId: activeOfficerId, targetCityId: activePoachTargetCityId as CityId, targetOfficerId: activePoachOfficerId };
    }
    if (type === 'diplomacy') {
      return {
        type,
        cityId,
        passId,
        officerId: diplomacyOfficerId,
        targetForceId: activeDiplomacyForceId as ForceId,
        action: diplomacyAction,
        months: diplomacyAction === 'truce' ? diplomacyMonths : undefined,
        gold: diplomacyAction === 'alliance' || diplomacyAction === 'truce' ? diplomacyGold : undefined,
      };
    }
    if (type === 'captiveDispose') {
      return { type, cityId, passId, targetOfficerId: activeCaptiveId, action: captiveAction };
    }
    if (type === 'marry') {
      return { type, cityId, passId, officerIdA: activeMarryOfficerA, officerIdB: activeMarryOfficerB, relation: marryRelation };
    }
    if (type === 'legion') {
      return {
        type,
        cityId,
        passId,
        commanderId: legionCommanderId === 'none' ? null : legionCommanderId || null,
        targetCityId: (legionCityId || null) as CityId | null,
        policy: legionPolicy,
      };
    }
    if (type === 'buildFacilityPlot') {
      // 地格在弹窗确认后由地图点击决定，此处占位 0，不参与地格校验
      return { type, cityId, passId, officerIds: activeExecutorIds, plotIndex: 0, facility: plotFacility };
    }
    if (type === 'appointStrategist') {
      // '' = 未改动（沿用现任军师），'__clear__' = 解除任命
      const effective = strategistOfficerId === '__clear__'
        ? null
        : strategistOfficerId || state.forces[state.playerForceId]?.strategistId || null;
      return { type, cityId, passId, officerId: effective };
    }
    if (type === 'produceArmament') return { type, cityId, passId, officerIds: activeExecutorIds, armamentType };
    if (type === 'research') return { type, cityId, passId, officerIds: activeExecutorIds, nodeId: activeTechNodeId };
    if (isMultiOfficer) return { type, cityId, passId, officerIds: activeExecutorIds } as GameCommand;
    const base = { cityId, passId, officerId: activeOfficerId };
    if (type === 'trade') return { ...base, type, mode: tradeValue >= 0 ? 'buy' : 'sell', amount: Math.min(Math.abs(tradeValue), TRADE_MAX_GRAIN) };
    return { ...base, type } as GameCommand;
  }, [abilityNode, abilityNodeId, activeCaptiveId, activeDiplomacyForceId, activeExecutorIds, activeMarryOfficerA, activeMarryOfficerB, activeOfficerId, activePoachOfficerId, activePoachTargetCityId, activePositionId, activePositionOfficer, activeRumorTargetId, activeTalentTargetId, activeTargetId, activeTechNodeId, activeTreasureId, armamentType, captiveAction, cityId, cultivateMode, cultivateOfficerChosen, diplomacyAction, diplomacyGold, diplomacyMonths, exploreOfficerIds, grantOfficerId, isMultiOfficer, legionCityId, legionCommanderId, legionPolicy, marryRelation, officerIds, passId, plotFacility, poachTargetCityId, poachTargetOfficerId, strategistOfficerId, swornOfficerIds, tradeValue, type, rewardOfficerIds]);

  const errors = validateCommand(state, state.playerForceId, command);
  // 外交：标题随子行动变化（行动已由命令菜单选定），形如「外交 · 同盟」
  const label = type === 'diplomacy' ? `外交 · ${DIPLOMACY_ACTION_LABELS[diplomacyAction]}` : COMMAND_LABELS[type];
  // 开发：地格在地图上选择，弹窗阶段跳过地格类校验（资金/封锁等仍校验）；
  // 若本据点已无空闲建设用地，直接提示无法开发（与命令菜单的置灰判据同一函数）
  const noEmptyPlot = type === 'buildFacilityPlot' && !pass && !hasEmptyPlot(city);
  const actionableErrors = type === 'buildFacilityPlot'
    ? [...errors.filter((error) => !error.includes('地格')), ...(noEmptyPlot ? ['本城没有空闲的建设用地，无法开发'] : [])]
    : errors;
  // 滑块居中（0）时只显示商人到访/封锁/交易次数类错误，隐藏数量类校验
  const visibleErrors = type === 'trade' && tradeIdle
    ? errors.filter((error) => error.includes('商人') || (error.includes('交易') && !error.includes('数量')))
    // 流言：面板默认不预选据点，未选定弹出的「只能对敌方城池/关隘散布流言」不进提示区
    // （校验本身保留，仍由 actionableErrors 禁用「决定」按钮，执行层另有目标无效兜底）
    : type === 'rumor'
      ? actionableErrors.filter((error) => !error.includes('散布流言'))
      // 外交：同样默认不预选「对象势力」与「使者」，未选定时的「武将不在目标城市 / 目标势力无效」
      // 属未填完的噪音，不进提示区（校验仍由 actionableErrors 禁用「决定」按钮）
      : type === 'diplomacy'
        ? actionableErrors.filter((error) => !error.includes('武将不在') && !error.includes('目标势力无效'))
        : actionableErrors;

  // 多人执行指令效果预估（与 commands.ts 结算公式保持一致）
  const hasExecutors = activeExecutors.length > 0;
  // 征兵：1000 + 魅力总和 × (治安+20) × 5 ÷ 100，再乘特技/兵舍修正
  const recruitEstimate = type === 'recruit' && hasExecutors
    ? Math.round(recruitBaseYield(activeExecutors, garrison)
      * commandYieldMultiplier(state, command)
      * barracksYieldMultiplier(garrison))
    : 0;
  // 兵装生产数量：1000 + 最高智力×10 + 其余2人智力各×5，再乘特技/设施修正
  const productionGain = type === 'produceArmament' && hasExecutors
    ? Math.round(produceArmamentYield(activeExecutors, armamentType)
      * commandYieldMultiplier(state, command)
      * armamentYieldMultiplier(garrison, armamentType))
    : 0;
  // 兵器/舰船工期：⌈(220 − 综合智力) ÷ 12⌉ × 10 日（发明/造船日数减半），换算为旬
  const productionTenDays = type === 'produceArmament' && isDelayedArmament(armamentType) && hasExecutors
    ? armamentProductionTenDays(activeExecutors, armamentProductionSpeedMultiplier(state, command as Extract<GameCommand, { type: 'produceArmament' }>))
    : 0;
  // 训练：士气 +【(武力总和 + 武力最大值) ÷ 基数】+ 3（封顶为据点士气上限），据点建有兵部时效果翻倍
  const trainEstimate = type === 'train' && hasExecutors
    ? Math.min(trainMoraleGain(activeExecutors, garrisonTroops) * (hasPlotFacility(garrison, 'bingbu') ? 2 : 1), moraleCapOf(state, garrison.ownerId) - garrisonTraining)
    : 0;
  // 巡查：治安 +【统率总和 ÷ 28】+ 2（封顶100）
  const patrolEstimate = type === 'patrol' && hasExecutors
    ? Math.min(patrolOrderGain(activeExecutors), 100 - garrisonOrder)
    : 0;
  // 建设：综合政治 = 最高政治 + 其余政治之和 ÷ 3
  const constructionPoliticsValue = hasExecutors ? constructionPolitics(activeExecutors) : 0;
  const constructionTenDays = hasExecutors ? constructTenDaysForOfficers(activeExecutors) : 0;
  // 科技研究：相关能力纯等权重加和（统率／政治／智力，按节点所属系统而定）
  const researchStatSum = hasExecutors
    ? activeExecutors.reduce((sum, officer) => sum + officer.stats[researchStatKey], 0)
    : 0;
  // 技巧P消耗（「指导」特技可减半，非执行武将时取基础值）
  const researchTechCost = researchTechPCost(state, activeTechNodeId, activeExecutorIds);
  const researchTenDaysEstimate = activeTechCost ? researchTenDays(activeTechCost.baseDays, researchStatSum) : 0;

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
        ? talentWill && talentWillTier && talentTarget
          ? `资金 500 · ${talentTarget.name}：${talentWill.verdict === 'refuse' ? '必拒' : talentWill.verdict === 'accept' ? '必定同意' : `意愿${talentWillTier.label}`}${talentTravelNote ? ` · 启程前往${talentTravelNote.name}（单程${talentTravelNote.travel}旬）` : ''}`
          : '资金 500'
    : type === 'recruit'
      ? `资金 800 · 兵粮 500 · 士兵 +${recruitEstimate.toLocaleString('en-US')} · 本旬剩余 ${recruitTimesLeft(garrison)}/${recruitTimesPerTenDay(garrison)} 次`
      : type === 'train'
        ? `兵粮 300 · 士气 +${trainEstimate}`
        : type === 'produceArmament'
          ? `资金 ${armamentCost(garrison, armamentType)} · ${armamentLabelFor(state, state.playerForceId, armamentType)} +${productionGain.toLocaleString('en-US')} · ${isDelayedArmament(armamentType)
            ? `${productionTenDays}旬 · 同时生产 ${armamentInProgressCount(state, garrison, ARMAMENT_FACILITY[armamentType])}/${plotBuiltCount(garrison, ARMAMENT_FACILITY[armamentType])} 件`
            : `即时 · 本旬剩余 ${armamentTimesLeft(garrison, ARMAMENT_FACILITY[armamentType])}/${plotBuiltCount(garrison, ARMAMENT_FACILITY[armamentType])} 次`}`
          : type === 'patrol'
            ? `资金 ${patrolGoldCost(garrison)} · 治安 +${patrolEstimate}`
            : type === 'trade'
              ? `粮价 1金=${grainPrice}粮 · 交易效果 ${tradePercent}%`
              : type === 'reward'
                ? `资金 ${REWARD_GOLD_COST * (rewardOfficerIds.length || 1)} · 忠诚+${rewardLoyaltyGain(0)}/人`
                : type === 'research'
                ? (() => {
                  if (!activeTechCost) return '科技节点无效';
                  if (hasTech(state, state.playerForceId, activeTechNodeId)) return '该科技已研究完成';
                  return `资金 ${activeTechCost.gold} · 技巧P ${researchTechCost} · ${researchTenDaysEstimate}旬`;
                })()
                : type === 'abilityResearch'
                  ? cultivateMode
                    ? `培育武将 · 30日（3旬）· 剩余培育次数 ${abilityRemaining}`
                    : `资金 ${ABILITY_RESEARCH_GOLD} · 研究 ${abilityNode?.months ?? 0} 个月`
                  : type === 'rumor'
                    ? `资金 ${RUMOR_GOLD_COST} · 降低敌城民心与武将忠诚${rumorTravel ? ` · 单程${rumorTravel.travel}旬（往返约${rumorTravel.travel * 2}旬）` : ''}`
                    : type === 'poach'
                      ? `资金 ${POACH_GOLD_COST} · 登用敌城武将`
                      : type === 'diplomacy'
                        ? (() => {
                          switch (diplomacyAction) {
                            case 'goodwill': return `资金 ${GOODWILL_GOLD_COST} · 提升友好度`;
                            case 'alliance': return `礼金 ${diplomacyGoldClamped.toLocaleString('en-US')} · ${DIPLOMACY_ACTION_LABELS.alliance}`;
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
                            ? `婚姻 · 技巧P ${MARRY_TECHP_COST}`
                            : type === 'sworn'
                              ? `结义 · 技巧P ${MARRY_TECHP_COST}`
                              : type === 'legion'
                              ? '委任军团 · 自动内政'
                              : type === 'buildFacilityPlot'
                                ? ''
                                : type === 'appointStrategist'
                                ? '谋略加成 · 外交/流言/登用'
                                : type === 'summon'
                                  ? '召唤其他城武将'
                                  : activeTransferDuration
                ? `移动所需 · ${activeTransferDuration}旬`
                : '移动武将';

  return (
    // 军师提示显示时，点击弹窗外的暗色区域只收起提示、不关闭流言界面（其余情况照旧点外面即关闭）
    <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && !hintVisible && onClose()} onContextMenu={(event) => closePopupOnContextMenu(event, onClose, audio)}>
      <form ref={dialogRef} className="command-dialog tool-panel" role="dialog" aria-modal="true" aria-labelledby="command-title" onSubmit={submit} onKeyDown={handleDialogKeyDown}>
        <header>
          <div><p>{garrisonName}政务 · 行动力 {type === 'explore' ? `${EXPLORE_AP_PER_OFFICER}/人` : COMMAND_AP[type]}</p><h2 id="command-title">{label}</h2></div>
          <button type="button" className="icon-button" aria-label="关闭指令" title="关闭" onClick={onClose}><X /></button>
        </header>

        {isMultiOfficer && (
          <div className="command-executor-row">
            <button type="button" className="command-executor-toggle" onClick={() => setExecutorPickerOpen(true)}>
              执行武将
            </button>
            <div className="command-executor-slots">
              {Array.from({ length: COMMAND_OFFICER_MAX }, (_, index) => {
                const officer = activeExecutors[index];
                return (
                  <button
                    key={officer?.id ?? `executor-slot-${index}`}
                    type="button"
                    className={`command-executor-slot${officer ? ' is-filled' : ''}`}
                    onClick={() => setExecutorPickerOpen(true)}
                    title={officer
                      ? `${officer.name} · ${EXECUTOR_STAT_LABELS[executorStatKey]}${officer.stats[executorStatKey]}`
                      : '点击选择执行武将'}
                  >
                    {officer ? (
                      <>
                        <OfficerPortrait officer={officer} size={92} className="command-executor-portrait" />
                        <span className="command-executor-caption">{EXECUTOR_STAT_LABELS[executorStatKey]}{officer.stats[executorStatKey]}</span>
                      </>
                    ) : (
                      <span className="command-executor-portrait is-empty" aria-hidden="true">＋</span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {type === 'talent' && (
          <div className="field-row">
            <span>对象武将</span>
            <button
              type="button"
              className="officer-picker-trigger"
              aria-label="选择对象武将"
              aria-haspopup="dialog"
              onClick={() => setTalentPickerOpen(true)}
            >
              <strong>{talentTarget ? talentTarget.name : '选择对象武将'}</strong>
              <small>
                {talentTarget
                  ? `${talentTarget.forceId === null ? '在野' : state.forces[talentTarget.forceId]?.name ?? '—'} · 点击打开全武将列表改选`
                  : '点击打开全武将列表选择'}
              </small>
            </button>
          </div>
        )}

        {!isMultiOfficer && type !== 'transfer' && type !== 'summon' && type !== 'sworn' && type !== 'abilityResearch' && type !== 'explore' && type !== 'grantTreasure' && type !== 'appointPosition' && type !== 'captiveDispose' && type !== 'marry' && type !== 'legion' && type !== 'appointStrategist' && type !== 'reward' && type !== 'diplomacy' && type !== 'rumor' && (
          <label className="field-row">
            <span>执行武将</span>
            <select aria-label="执行武将" value={activeOfficerId} onChange={(event) => setOfficerId(event.target.value)}>
              {officers.map((officer) => (
                <option key={officer.id} value={officer.id} disabled={officer.acted}>
                  {officer.name} · 政{officer.stats.politics} 智{officer.stats.intelligence}{officer.acted ? '（已行动）' : ''}
                </option>
              ))}
            </select>
          </label>
        )}

        {type === 'reward' && (
          <div className="transfer-fields">
            <div className="command-note">
              按忠诚度从低到高排列 · 君主与忠诚已达基准值者不显示 · 每位忠诚 +{rewardLoyaltyGain(0)}（上限为忠诚度基准值）
            </div>
            <label className="field-row">
              <span>奖赏武将</span>
              <button type="button" className="command-executor-toggle" onClick={() => setRewardPickerOpen(true)}>
                {rewardOfficerIds.length > 0
                  ? `已选 ${rewardOfficerIds.map((id) => state.officers[id]?.name).join('、')}（点击重选）`
                  : '点击选择武将'}
              </button>
            </label>
            {rewardOfficerIds.length > 0 && (
              <div className="command-note">共 {rewardOfficerIds.length} 人 · 耗金 {REWARD_GOLD_COST * rewardOfficerIds.length}</div>
            )}
          </div>
        )}

        {rewardPickerOpen && (
          <OfficerPickerDialog
            officers={rewardCandidates}
            selectedIds={rewardOfficerIds}
            max={rewardCandidates.length}
            min={0}
            tabs={['奖赏', '所属', '能力', '特技', '适性', '状态']}
            initialTab="奖赏"
            hint="按忠诚度从低到高排列，君主与忠诚满100者不可选"
            selectAllable
            onConfirm={(ids) => { setRewardOfficerIds(ids); setRewardPickerOpen(false); }}
            onClose={() => setRewardPickerOpen(false)}
          />
        )}

        {type === 'explore' && (
          <div className="transfer-fields">
            <div className="command-note">
              每人行动力{EXPLORE_AP_PER_OFFICER} · 资金{EXPLORE_GOLD_PER_OFFICER}，最多{exploreMaxCount}人
            </div>
            <label className="field-row">
              <span>探索武将</span>
              <button type="button" className="command-executor-toggle" onClick={() => setExplorePickerOpen(true)}>
                {exploreOfficerIds.length > 0 ? `已选 ${exploreOfficerIds.map((id) => state.officers[id]?.name).join('、')}（点击重选）` : '点击选择武将'}
              </button>
            </label>
          </div>
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
                    <div><dt>所需</dt><dd>{activePositionDef.merit > 0 ? `功绩 ${activePositionDef.merit}` : '功绩无需'} · 爵位{rankDefinition(activePositionDef.rankNeeded).name}</dd></div>
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
                // 唯一判据：缺设施 / 本旬次数用尽（锻冶厂·厩舍）/ 设施已全部投入生产（工房·造船厂）
                const blockReason = armamentProductionBlockReason(state, garrison, item);
                const facilityMissing = !hasPlotFacility(garrison, ARMAMENT_FACILITY[item]);
                const nextStock = selected && !blockReason ? stock + productionGain : stock;
                return (
                  <button
                    key={item}
                    type="button"
                    aria-label={armamentLabelFor(state, state.playerForceId, item)}
                    className={selected ? 'is-active' : ''}
                    disabled={Boolean(blockReason)}
                    title={blockReason ?? undefined}
                    onClick={() => setArmamentType(item)}
                  >
                    <strong>{armamentLabelFor(state, state.playerForceId, item)}</strong>
                    <span>{facilityMissing ? `需${armamentFacilityLabel(item)}` : selected ? `${stock.toLocaleString('en-US')} → ${nextStock.toLocaleString('en-US')}` : stock.toLocaleString('en-US')}</span>
                  </button>
                );
              })}
            </div>
            <dl className="produce-stock">
              <div><dt>资金</dt><dd>{garrisonGold.toLocaleString('en-US')} → {Math.max(0, garrisonGold - armamentCost(garrison, armamentType)).toLocaleString('en-US')}{armamentCost(garrison, armamentType) < ARMAMENT_GOLD_COST ? '（特色优惠）' : ''}</dd></div>
              <div><dt>期间</dt><dd>{isDelayedArmament(armamentType) ? `${productionTenDays}旬（综合智${armamentProductionIntelligence(activeExecutors)}）` : '即时'}</dd></div>
              <div>
                <dt>产能</dt>
                <dd>{isImmediateArmamentFacility(ARMAMENT_FACILITY[armamentType])
                  ? `本旬剩余 ${armamentTimesLeft(garrison, ARMAMENT_FACILITY[armamentType])}/${plotBuiltCount(garrison, ARMAMENT_FACILITY[armamentType])} 次`
                  : `同时生产 ${armamentInProgressCount(state, garrison, ARMAMENT_FACILITY[armamentType])}/${plotBuiltCount(garrison, ARMAMENT_FACILITY[armamentType])} 件`}</dd>
              </div>
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
              <div><dt>资金</dt><dd>{garrisonGold.toLocaleString('en-US')} → {Math.min(cityCaps.gold, Math.max(0, garrisonGold + tradeQuote.goldDelta)).toLocaleString('en-US')}</dd></div>
              <div><dt>兵粮</dt><dd>{garrisonFood.toLocaleString('en-US')} → {Math.min(cityCaps.food, Math.max(0, garrisonFood + tradeQuote.foodDelta)).toLocaleString('en-US')}</dd></div>
            </dl>
          </section>
        )}

        {type === 'research' && (
          <section className="tech-research-panel" aria-label="科技研究">
            <TechTreePanel
              nodeStatus={techNodeStatus}
              selectedNodeId={activeTechNodeId}
              onSelectNode={setTechNodeId}
            />
            {activeTechNode && activeTechCost ? (
              <dl className="tech-info">
                <div><dt>资金</dt><dd>{activeTechCost.gold.toLocaleString('en-US')}／{garrisonGold.toLocaleString('en-US')}</dd></div>
                <div><dt>技巧P</dt><dd>{researchTechCost.toLocaleString('en-US')}／{forceTechP.toLocaleString('en-US')}</dd></div>
                <div><dt>相关能力</dt><dd>{EXECUTOR_STAT_LABELS[researchStatKey]}总和 {researchStatSum}</dd></div>
                <div><dt>期间</dt><dd>{researchStatusText === '已研究' || researchStatusText === '正在研究中' ? '—' : `${researchTenDaysEstimate}旬`}</dd></div>
                <div className="tech-effect"><dt>效果</dt><dd>{activeTechNode.description}</dd></div>
              </dl>
            ) : (
              <div className="command-note">科技节点数据缺失，无法研究</div>
            )}
          </section>
        )}

        {type === 'abilityResearch' && (
          <section className="ability-panel" aria-label="能力研究">
            <div
              className="ability-tree"
              style={{ gridTemplateColumns: `repeat(${ABILITY_TREE_COLS}, minmax(0, 1fr))`, gridTemplateRows: `repeat(${ABILITY_TREE_ROWS}, 1fr)` }}
            >
              {/* 研究顺序箭头：前置节点 → 本节点，颜色随目标节点状态（金色=可研究、绿色=已研究、暗色=未解锁） */}
              <svg className="ability-arrows" viewBox="0 0 900 560" preserveAspectRatio="none" aria-hidden="true">
                {ABILITY_NODES.flatMap((node) =>
                  node.prereq
                    .map((pid) => {
                      // 「研究开始」虚拟箭头：从中心节点指向四个+5低节点
                      const from = pid === ABILITY_START_ID
                        ? { id: ABILITY_START_ID, col: ABILITY_CENTER.col, row: ABILITY_CENTER.row }
                        : ABILITY_NODE_MAP[pid];
                      if (!from) return null;
                      const status = abilityNodeStatus(state, state.playerForceId, node);
                      const stroke = status === 'done'
                        ? 'rgba(158, 206, 138, 0.85)'
                        : status === 'available'
                          ? '#e8c96a'
                          : status === 'active'
                            ? '#e0a077'
                            : 'rgba(196, 186, 158, 0.32)';
                      // 单元格中心坐标（x:100/格，y:80/格）；奇数行整体右移半格，箭头需同步
                      const off = (row: number) => (row % 2 === 1 ? 50 : 0);
                      const fx = (from.col - 0.5) * 100 + off(from.row);
                      const fy = (from.row - 0.5) * 80;
                      const tx = (node.col - 0.5) * 100 + off(node.row);
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
                    className={`ability-node cat-${node.category} is-${status}${selected ? ' is-selected' : ''}${node.row % 2 === 1 ? ' is-off' : ''}`}
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
                <div className="command-note">本据点没有符合「{abilityNode?.label}」培育条件的待命武将</div>
              )
            )}
          </section>
        )}

        {type === 'transfer' && (
          <div className="transfer-fields">
            <label className="field-row">
              <span>目标据点</span>
              <select aria-label="目标据点" value={activeTargetId} onChange={(event) => setTargetCityId(event.target.value as CityId)}>
                {transferTargets.map((target) => <option key={target.id} value={target.id}>{target.name}</option>)}
              </select>
            </label>
            <div className="command-note">
              {activeTarget ? `${garrisonName} → ${activeTarget.name}，预计${activeTransferDuration}旬抵达` : '没有可移动的己方据点'}
            </div>
            <label className="field-row">
              <span>移动人员</span>
              <button type="button" className="command-executor-toggle" onClick={() => setTransferPickerOpen(true)}>
                {officerIds.length > 0 ? `已选 ${officerIds.map((id) => state.officers[id]?.name).join('、')}（点击重选）` : '点击选择武将'}
              </button>
            </label>
          </div>
        )}

        {type === 'summon' && (
          <div className="transfer-fields">
            <div className="command-note">
              {summonOfficers.length > 0 ? '选择其他据点（城池/关隘）的待命武将，将召唤至本据点，耗时与移动相同' : '当前没有其他己方据点可召唤的待命武将'}
            </div>
            <label className="field-row">
              <span>召唤武将</span>
              <button type="button" className="command-executor-toggle" disabled={summonOfficers.length === 0} onClick={() => setTransferPickerOpen(true)}>
                {officerIds.length > 0 ? `已选 ${officerIds.map((id) => state.officers[id]?.name).join('、')}（点击重选）` : summonOfficers.length === 0 ? '没有可召唤的武将' : '点击选择武将'}
              </button>
            </label>
          </div>
        )}

        {type === 'rumor' && (
          <section className="grant-treasure-panel" aria-label="流言">
            {rumorOptions.length === 0 ? (
              <div className="command-note">当前没有可散布流言的敌方据点</div>
            ) : (
              <>
                <div className="field-row">
                  <span>目标城市</span>
                  <button
                    type="button"
                    className="officer-picker-trigger"
                    aria-label="选择流言目标据点"
                    aria-haspopup="dialog"
                    data-testid="rumor-target-trigger"
                    onClick={() => setRumorPickerOpen(true)}
                  >
                    <strong>{activeRumorOption ? `${activeRumorOption.name}（${state.forces[activeRumorOption.ownerId]?.name ?? ''}·${activeRumorOption.kind === 'pass' ? '关隘' : '都市'}）` : '选择目标据点'}</strong>
                    <small>{activeRumorOption ? '点击打开据点列表改选' : '点击打开据点列表选择'}</small>
                  </button>
                </div>
                {/* 流言页次序：先选目标城市，选定后才出现执行武将（军师亦在此时才给建议） */}
                {activeRumorOption && (
                  <div className="field-row">
                    <span>执行武将</span>
                    <button
                      type="button"
                      className="officer-picker-trigger"
                      aria-label="选择执行武将"
                      aria-haspopup="dialog"
                      data-testid="rumor-executor-trigger"
                      onClick={() => setRumorExecutorPickerOpen(true)}
                    >
                      <strong>{activeOfficer ? activeOfficer.name : '选择武将'}</strong>
                      <small>
                        {activeOfficer
                          ? `智力${activeOfficer.stats.intelligence} · 点击打开武将选择页改选`
                          : '点击打开武将选择页'}
                      </small>
                    </button>
                  </div>
                )}
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
                    {poachCandidates.map((officer) => {
                      const will = poachExecutor ? recruitWillOf(state, poachExecutor, officer) : null;
                      const tier = will ? recruitWillTier(will.verdict === 'accept' ? 999 : will.will) : null;
                      return (
                        <option key={officer.id} value={officer.id}>
                          {officer.name} · 忠{officerLoyalty(officer)} 智{officer.stats.intelligence}{tier ? ` · ${tier.label}` : ''}
                        </option>
                      );
                    })}
                  </select>
                </label>
                {activePoachTarget && poachWill && poachWillTier && (
                  <dl className="produce-stock">
                    <div>
                      <dt>登用意愿</dt>
                      <dd><span className={`will-dot will-${poachWillTier.key}`} aria-hidden="true" />{poachWillTier.label}{poachWill.verdict === 'accept' ? '（必定同意）' : ''}{poachWill.verdict === 'refuse' ? `（${poachWill.reasons[0] ?? '必定拒绝'}）` : ''}</dd>
                    </div>
                    <div>
                      <dt>挖角成功率</dt>
                      <dd>{!poachExecutor || poachWill.verdict === 'refuse' ? '0%（必定拒绝）' : poachWill.verdict === 'accept' ? '100%（必定同意）' : `${poachChance(state, poachExecutor, activePoachTarget)}%`}</dd>
                    </div>
                  </dl>
                )}
                <div className="command-note">挖角成败由「登用接受意愿」决定：相性、忠诚、魅力与武将关系都在起作用；失败后目标短期内无法再被登用</div>
              </>
            )}
          </section>
        )}

        {type === 'diplomacy' && (
          <section className="grant-treasure-panel" aria-label="外交">
            <div className="field-row">
              <span>对象势力</span>
              <button
                type="button"
                className="force-select-trigger"
                aria-label="选择对象势力"
                aria-haspopup="dialog"
                data-testid="diplomacy-force-trigger"
                onClick={() => setForceSelectOpen(true)}
              >
                <strong>
                  {activeDiplomacyForce ? activeDiplomacyForce.name : '选择势力'}
                  {activeDiplomacyRelation?.allied ? '（同盟）' : ''}
                </strong>
                <small>
                  {activeDiplomacyRelation
                    ? `${activeDiplomacyRelation.tierLabel} · 友好度 ${activeDiplomacyRelation.friendly} · 点击改选`
                    : '点击查看各势力关系'}
                </small>
              </button>
            </div>
            {/* 外交页次序：先选对象势力，选定后才出现使者与礼金（军师也要等礼金被拖动才开口） */}
            {activeDiplomacyForceId && (
              <>
                <div className="field-row">
                  <span>执行武将</span>
                  <button
                    type="button"
                    className="officer-picker-trigger"
                    aria-label="选择执行武将"
                    aria-haspopup="dialog"
                    data-testid="diplomacy-envoy-trigger"
                    onClick={() => setDiplomacyOfficerPickerOpen(true)}
                  >
                    <strong>{activeDiplomacyOfficer ? activeDiplomacyOfficer.name : '选择武将'}</strong>
                    <small>
                      {activeDiplomacyOfficer
                        ? `政治${activeDiplomacyOfficer.stats.politics} · 点击从武将列表改选`
                        : '点击从武将列表中选择'}
                    </small>
                  </button>
                </div>
                <dl className="produce-stock">
                  <div>
                    <dt>交情</dt>
                    <dd>{`${activeDiplomacyRelation?.tierLabel ?? '—'} · 友好度 ${diplomacyForced}`}</dd>
                  </div>
                  <div><dt>抵达日期</dt><dd>{envoyDaysText}</dd></div>
                </dl>
                {diplomacyNote && (
                  <div className="command-note">{diplomacyNote}</div>
                )}
                {(diplomacyAction === 'alliance' || diplomacyAction === 'truce') && (
                  <div className="field-row">
                    <span>礼金</span>
                    <div className="diplomacy-slider">
                      <input
                        type="range"
                        min={0}
                        max={diplomacyGoldMax}
                        step={DIPLOMACY_GOLD_STEP}
                        value={diplomacyGoldClamped}
                        onChange={(event) => {
                          setDiplomacyGold(Math.max(0, Number(event.target.value)));
                          // 拖动途中 range 连续派发 change：此刻先收起提示（军师别一闪而过），
                          // 连续变动停下 DIPLOMACY_HINT_SETTLE_MS 之后军师才重新评估并开口
                          setDiplomacyHintArmed(false);
                          setHintSettled(false);
                          if (diplomacyHintTimerRef.current !== null) window.clearTimeout(diplomacyHintTimerRef.current);
                          diplomacyHintTimerRef.current = window.setTimeout(() => {
                            diplomacyHintTimerRef.current = null;
                            setDiplomacyHintArmed(true);
                          }, DIPLOMACY_HINT_SETTLE_MS);
                        }}
                        aria-label="礼金"
                        aria-valuetext={`礼金 ${diplomacyGoldClamped} 金`}
                      />
                      <strong>{diplomacyGoldClamped.toLocaleString('en-US')}</strong>
                    </div>
                  </div>
                )}
                {diplomacyAction === 'truce' && (
                  <label className="field-row">
                    <span>停战月数</span>
                    <select
                      aria-label="停战月数"
                      value={diplomacyMonths}
                      onChange={(event) => {
                        setDiplomacyMonths(Number(event.target.value));
                        // 期限同样影响判定，改动后军师重新评估
                        setDiplomacyHintArmed(true);
                        setHintSettled(false);
                      }}
                    >
                      {Array.from({ length: TRUCE_MONTHS_MAX - TRUCE_MONTHS_MIN + 1 }, (_, index) => TRUCE_MONTHS_MIN + index).map((months) => (
                        <option key={months} value={months}>{months}个月</option>
                      ))}
                    </select>
                  </label>
                )}
              </>
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
                    {captiveOfficers.map((officer) => {
                      const will = activeCaptiveExecutor ? recruitWillOf(state, activeCaptiveExecutor, officer) : null;
                      const tier = will ? recruitWillTier(will.verdict === 'accept' ? 999 : will.will) : null;
                      return (
                        <option key={officer.id} value={officer.id}>
                          {officer.name} · 忠{officerLoyalty(officer)}（原属{(officer.forceId && state.forces[officer.forceId]?.name) || '在野'}）{tier ? ` · ${tier.label}` : ''}
                        </option>
                      );
                    })}
                  </select>
                </label>
                <label className="field-row">
                  <span>处置</span>
                  <select aria-label="处置方式" value={captiveAction} onChange={(event) => setCaptiveAction(event.target.value as typeof captiveAction)}>
                    <option value="recruit">劝降登用（忠诚高于{captiveRecruitLoyaltyThreshold()}必拒）</option>
                    <option value="release">释放</option>
                    <option value="execute">处斩</option>
                  </select>
                </label>
                {activeCaptive && (
                  <dl className="produce-stock">
                    <div><dt>忠诚</dt><dd>{officerLoyalty(activeCaptive)}</dd></div>
                    {captiveWill && captiveWillTier && (
                      <div>
                        <dt>登用意愿</dt>
                        <dd><span className={`will-dot will-${captiveWillTier.key}`} aria-hidden="true" />{captiveWillTier.label}{captiveWill.verdict === 'accept' ? '（必定同意）' : ''}{captiveWill.verdict === 'refuse' ? `（${captiveWill.reasons[0] ?? '必定拒绝'}）` : ''}</dd>
                      </div>
                    )}
                    <div><dt>{captiveAction === 'recruit' ? '登用成功率' : captiveAction === 'release' ? '释放效果' : '处斩效果'}</dt><dd>
                      {captiveAction === 'recruit'
                        ? `${captiveRecruitChance}%${captiveRecruitChance <= 0 ? '（必定拒绝，可等待其忠诚下降）' : ''}`
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
          <section className="grant-treasure-panel" aria-label="婚姻">
            <div className="command-note">选择一男一女结为夫妻，消耗技巧P {MARRY_TECHP_COST}，双方须同在我方城市待命且均未行动；夫妻若一方有「内助」特技则双方全能力+1</div>
            <label className="field-row">
              <span>结婚对象</span>
              <button
                type="button"
                className="command-executor-toggle"
                disabled={marriageCandidates.length === 0}
                onClick={() => setRelatePicker('marriage')}
              >
                {marryOfficerIds.length === 2 ? `${state.officers[marryOfficerIds[0]]?.name} ✕ ${state.officers[marryOfficerIds[1]]?.name}` : marriageCandidates.length === 0 ? '无可结婚的异性武将' : '选择一男一女'}
              </button>
            </label>
          </section>
        )}

        {type === 'sworn' && (
          <section className="grant-treasure-panel" aria-label="义兄弟">
            <div className="command-note">选择 2~3 名同性武将结为义兄弟，消耗技巧P {MARRY_TECHP_COST}，须同在我方城市待命且均未行动</div>
            {relatePicker !== 'sworn' && (
              <label className="field-row">
                <span>结义武将</span>
                <button
                  type="button"
                  className="command-executor-toggle"
                  disabled={swornCandidates.length === 0}
                  onClick={() => setRelatePicker('sworn')}
                >
                  {swornOfficerIds.length > 0 ? `已选 ${swornOfficerIds.map((id) => state.officers[id]?.name).join('、')}（点击重选）` : swornCandidates.length === 0 ? '无可结义的武将' : '选择 2~3 名同性武将'}
                </button>
              </label>
            )}
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
          const isUniqueBuilt = (f: PlotType) => UNIQUE_FACILITIES.includes(f) && facilityCounts[f] > 0;
          // 城池特性限制：水港才能建造造船厂，学术才能建太学
          const traitBlockedReason = (f: PlotType): string | undefined => {
            if (f === 'shipyard' && !hasCityTrait(city.id, 'waterPort')) return '只有水港城市可以建造造船厂';
            if (f === 'taixue' && !hasCityTrait(city.id, 'academy')) return '只有学术城市可以建造太学';
            return undefined;
          };
          // 科技门槛（与 commands.ts validateCommand 同一判定 canBuildFacility）：
          // 1 级即需科技的设施（鱼市/军屯农/六部衙门）未研究时置灰，悬停提示前置科技名。
          const techLockedReason = (f: PlotType): string | undefined => {
            if (canBuildFacility(state, state.playerForceId, f)) return undefined;
            const node = facilityGateNode(f, 1);
            return `需先研究「${node ? techNodeOf(node)?.name ?? '前置科技' : '前置科技'}」`;
          };
          return (
            <section className="grant-treasure-panel" aria-label="开发">
              <div className="plot-facility-grid">
                {ALL_FACILITIES.map((f) => {
                  const selected = plotFacility === f;
                  const traitReason = traitBlockedReason(f);
                  const techReason = techLockedReason(f);
                  const disabled = isUniqueBuilt(f) || !!traitReason || !!techReason;
                  // 名称右侧只显示一个合计数量（如「市场(2)」）= 已建成 + 建设中；
                  // 只要还有地格在施工，这个数字就用淡蓝色，提示「其中含在建的」。
                  const builtCount = plotBuiltCount(city, f);
                  const buildingCount = plotConstructingCount(city, f);
                  const totalCount = builtCount + buildingCount;
                  return (
                    <button
                      key={f}
                      type="button"
                      className={`plot-facility-card${selected ? ' is-selected' : ''}${disabled ? ' is-disabled' : ''}`}
                      onClick={() => !disabled && setPlotFacility(f)}
                      disabled={disabled}
                      title={
                        (traitReason ?? techReason) ??
                        (totalCount === 0
                          ? undefined
                          : buildingCount > 0
                            ? `共 ${totalCount} 座：已建成 ${builtCount} 座，${buildingCount} 座建设中`
                            : `已建成 ${totalCount} 座`)
                      }
                    >
                      <div className="plot-facility-card-title">
                        <span className="plot-facility-card-name">
                          {PLOT_LABELS[f]}
                          {totalCount > 0 && (
                            <span className={`plot-facility-count${buildingCount > 0 ? ' is-building' : ''}`}>
                              ({totalCount})
                            </span>
                          )}
                        </span>
                        {disabled ? (
                          <span className="plot-facility-card-level">{traitReason ? '特性不符' : techReason ? '未解锁' : '已建'}</span>
                        ) : null}
                      </div>
                      <div className="plot-facility-card-cost">{plotCost(f)} 金</div>
                    </button>
                  );
                })}
              </div>
              <dl className="produce-stock plot-produce-inline">
                <div><dt>资金</dt><dd>{garrisonGold.toLocaleString('en-US')} → {Math.max(0, garrisonGold - plotCost(plotFacility)).toLocaleString('en-US')}</dd></div>
                <div><dt>期间</dt><dd>约 {constructionTenDays} 旬（综合政{constructionPoliticsValue}）</dd></div>
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

      {/* 军师提示框：显示在游戏界面底部（仿原版忠告框），覆盖在弹窗层之上 —— 流言与外交共用 */}
      {hintVisible && strategistHint && (
        <div
          className={`strategist-hint${strategistHint.viable ? ' is-viable' : ''}`}
          data-testid="strategist-hint"
          aria-live="polite"
        >
          <OfficerPortrait officer={strategistHint.speaker} size={72} className="strategist-hint-portrait" />
          <div className="strategist-hint-main">
            <p className="strategist-hint-text">{strategistHint.text}</p>
            <div className="strategist-hint-meta">
              <span className="strategist-hint-name">
                {strategistHint.speaker.name}{strategistHint.viable ? '' : ' · 军师'}
              </span>
              {strategistHint.meta && (
                <span className="strategist-hint-adopt">{strategistHint.meta}</span>
              )}
            </div>
          </div>
        </div>
      )}

      {forceSelectOpen && (
        <ForceRelationDialog
          state={state}
          selectedForceId={activeDiplomacyForceId}
          onPick={(id) => {
            setDiplomacyForceId(id);
            // 换了对象势力 → 军师依新关系重新评估（提示框若已收起则重新可见）
            setHintSettled(false);
            setForceSelectOpen(false);
          }}
          onClose={() => setForceSelectOpen(false)}
        />
      )}

      {talentPickerOpen && (
        <TalentTargetPickerDialog
          state={state}
          executorId={activeOfficerId}
          selectedId={activeTalentTargetId}
          onPick={(id) => {
            setTalentTargetId(id);
            // 换了登庸对象 → 军师依新对象重新评估，提示框重新可见
            setHintSettled(false);
            setTalentPickerOpen(false);
          }}
          onClose={() => setTalentPickerOpen(false)}
        />
      )}

      {rumorPickerOpen && (
        <RumorTargetPickerDialog
          state={state}
          origin={pass ? (state.cities[pass.homeCityId] ?? city) : city}
          selectedId={activeRumorTargetId}
          onPick={(id) => {
            const option = rumorOptions.find((item) => item.id === id);
            if (option?.kind === 'pass') {
              setRumorTargetPassId(id as PassId);
              setRumorTargetCityId('');
            } else {
              setRumorTargetCityId(id as CityId);
              setRumorTargetPassId('');
            }
            // 换了目标据点 → 军师重新评估，提示框重新可见
            setHintSettled(false);
            setRumorPickerOpen(false);
          }}
          onClose={() => setRumorPickerOpen(false)}
        />
      )}

      {/* 流言执行武将：点开「武将选择页」，默认停在「计略」分类（军师推荐 ○ + 智力） */}
      {rumorExecutorPickerOpen && (
        <OfficerPickerDialog
          officers={availableOfficers}
          selectedIds={activeOfficerId ? [activeOfficerId] : []}
          pickMode="single"
          tabs={['计略', '所属', '能力', '特技', '适性', '状态']}
          initialTab="计略"
          tacticTarget={activeRumorStronghold}
          hint={`按流言成功率评估：○ 为军师推荐（预估成功率超过 ${RUMOR_ADVICE_MIN_CHANCE}%），点击即选定并返回`}
          onConfirm={(ids) => {
            if (ids[0]) {
              setOfficerId(ids[0]);
              setHintSettled(true);
            }
            setRumorExecutorPickerOpen(false);
          }}
          onClose={() => setRumorExecutorPickerOpen(false)}
        />
      )}

      {executorPickerOpen && (
        <OfficerPickerDialog
          officers={executorCandidates}
          selectedIds={activeExecutorIds}
          max={COMMAND_OFFICER_MAX}
          hint={`${label}效果受${EXECUTOR_STAT_LABELS[executorStatKey]}影响，已按${EXECUTOR_STAT_LABELS[executorStatKey]}降序排列`}
          onConfirm={(ids) => {
            setExecutorIds(ids);
            setExecutorPickerOpen(false);
          }}
          onClose={() => setExecutorPickerOpen(false)}
        />
      )}

      {/* 外交使者：政治越高判定值越高，故按政治降序排列 */}
      {diplomacyOfficerPickerOpen && (
        <OfficerPickerDialog
          officers={diplomacyOfficerCandidates}
          selectedIds={activeDiplomacyOfficer ? [activeDiplomacyOfficer.id] : []}
          pickMode="single"
          hint="按政治降序排列；点击即选定并返回。出使者需往返对方君主所在城池，往返期间不可再被指派"
          onConfirm={(ids) => {
            if (ids[0]) {
              setDiplomacyOfficerId(ids[0]);
              // 换了使者 → 判定式里的政治变了，军师重新评估
              setHintSettled(false);
            }
            setDiplomacyOfficerPickerOpen(false);
          }}
          onClose={() => setDiplomacyOfficerPickerOpen(false)}
        />
      )}

      {transferPickerOpen && (
        <OfficerPickerDialog
            officers={type === 'summon' ? summonOfficers : availableOfficers}
            selectedIds={officerIds}
            max={type === 'summon' ? summonOfficers.length : availableOfficers.length}
            selectAllable
            tabs={type === 'summon' ? ['召唤', '所属', '能力', '特技', '适性', '状态'] : undefined}
            initialTab={type === 'summon' ? '召唤' : undefined}
            summonTarget={type === 'summon' ? garrison : undefined}
            hint={type === 'summon' ? '选择其他据点（城池/关隘）的待命武将，召唤至本据点' : '选择本据点待命武将，移动至目标据点'}
          onConfirm={(ids) => {
            setOfficerIds(ids);
            setTransferPickerOpen(false);
          }}
          onClose={() => setTransferPickerOpen(false)}
        />
      )}

      {explorePickerOpen && (
        <OfficerPickerDialog
          officers={exploreOfficers}
          selectedIds={exploreOfficerIds}
          max={exploreMaxCount}
          selectAllable
          selectAllLimit={exploreMaxCount}
          hint={`探索武将（每人行动力${EXPLORE_AP_PER_OFFICER} · 资金${EXPLORE_GOLD_PER_OFFICER}，最多${exploreMaxCount}人）`}
          onConfirm={(ids) => {
            setExploreOfficerIds(ids);
            setExplorePickerOpen(false);
          }}
          onClose={() => setExplorePickerOpen(false)}
        />
      )}

      {relatePicker === 'sworn' && (
        <OfficerPickerDialog
          officers={swornCandidates}
          selectedIds={swornOfficerIds}
          max={3}
          min={2}
          genderRule="same"
          hint={`选择 2~3 名同性武将结为义兄弟，消耗技巧P ${MARRY_TECHP_COST}`}
          onConfirm={(ids) => {
            setSwornOfficerIds(ids);
            setRelatePicker(null);
          }}
          onClose={() => setRelatePicker(null)}
        />
      )}

      {relatePicker === 'marriage' && (
        <OfficerPickerDialog
          officers={marriageCandidates}
          selectedIds={marryOfficerIds}
          max={2}
          min={2}
          genderRule="opposite"
          hint={`选择一男一女结为夫妻，消耗技巧P ${MARRY_TECHP_COST}`}
          onConfirm={(ids) => {
            setMarryOfficerIds(ids);
            setMarryOfficerA(ids[0] ?? '');
            setMarryOfficerB(ids[1] ?? '');
            setRelatePicker(null);
          }}
          onClose={() => setRelatePicker(null)}
        />
      )}
    </div>
  );
}
