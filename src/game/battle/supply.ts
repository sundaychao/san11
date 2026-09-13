import { COMBAT_UNIT_FOOD_CAP, COMBAT_UNIT_GOLD_CAP } from './catalog';
import { gridKey, neighborsOf, type GridCoord } from './grid';
import { assertUnitTurn } from './shared';
import { unitTroopCapOf } from '../ranks';
import type { ArmamentType, ArmyUnit, CityArmaments, ForceId, GameState, TroopType } from '../types';

/**
 * 运输队「补给」：把随队的士兵 / 资金 / 兵粮 / 兵装转给周围 6 格内的**己方作战部队**。
 *
 * 与「输送」（deployTransportUnit，从据点往外押运）是两件事：补给是野外资源转移，
 * 不涉及据点；接收方的容量口径见 `supplyCarryCapOf`。
 */

/** 可随队补给的单件兵装（枪/戟/弩/马；冲车井阑楼船不走野外补给） */
export type SupplyArmament = Pick<CityArmaments, 'spear' | 'halberd' | 'crossbow' | 'cavalry'>;
export type SupplyArmamentType = keyof SupplyArmament;

/** 一次补给转移的资源（全为 0 的补给没有意义，`supplyUnit` 会拒绝） */
export interface SupplyAmount {
  troops: number;
  gold: number;
  food: number;
  armaments?: Partial<SupplyArmament>;
}

/** 接收部队的随身携带上限 */
export interface SupplyCarryCap {
  troops: number;
  gold: number;
  food: number;
}

/**
 * 运输队周围 6 格内可补给的己方**作战部队**（运输队之间不能互相补给——
 * 两支辎重队倒手资源应走据点，野外不允许）。
 * `origin` 为菜单点击的目标格（部队尚未走过去，按落点算邻居）。
 */
export function suppliableUnits(state: GameState, unitId: string, origin?: GridCoord): ArmyUnit[] {
  const unit = state.units[unitId];
  if (!unit || unit.kind !== 'transport') return [];
  const source = origin ?? unit;
  const neighborKeys = new Set(neighborsOf(source.q, source.r).map(gridKey));
  return Object.values(state.units).filter((candidate) => (
    candidate.id !== unitId &&
    candidate.kind !== 'transport' &&
    candidate.forceId === unit.forceId &&
    neighborKeys.has(gridKey(candidate))
  ));
}

/**
 * 接收部队的随身携带上限：兵力 = 主将带兵上限（官职/爵位 + 科技「节度使」），
 * 资金 / 兵粮为固定死数（`COMBAT_UNIT_GOLD_CAP` / `COMBAT_UNIT_FOOD_CAP`）。
 */
export function supplyCarryCapOf(state: GameState, forceId: ForceId, target: ArmyUnit): SupplyCarryCap {
  return {
    troops: unitTroopCapOf(state, forceId, target.leaderId),
    gold: COMBAT_UNIT_GOLD_CAP,
    food: COMBAT_UNIT_FOOD_CAP,
  };
}

/** 各项资源最多还能塞进接收部队多少（上限 − 现存量，负数按 0 处理） */
export function supplyHeadroomOf(state: GameState, forceId: ForceId, target: ArmyUnit): SupplyCarryCap {
  const cap = supplyCarryCapOf(state, forceId, target);
  return {
    troops: Math.max(0, cap.troops - target.troops),
    gold: Math.max(0, cap.gold - (target.gold ?? 0)),
    food: Math.max(0, cap.food - target.food),
  };
}

/** 兵装补给日志用的中文名（与 armaments.CITY_ARMAMENT_CAPS 的键同名） */
export const ARMAMENT_SUPPLY_LABELS: Partial<Record<ArmamentType, string>> = {
  spear: '枪',
  halberd: '戟',
  crossbow: '弩',
  cavalry: '军马',
};

/**
 * 接收部队兵种对应的可补兵装：枪队收枪、戟队收戟、弩队收弩、骑兵收军马；
 * 剑兵/攻城器械没有对应兵装（返回 null，不可补给兵装）。
 */
export function suppliableArmamentOf(troopType: TroopType | undefined): SupplyArmamentType | null {
  switch (troopType) {
    case 'spear':
    case 'halberd':
    case 'crossbow':
    case 'cavalry':
      return troopType;
    default:
      return null;
  }
}

/**
 * 兵装补给上限：只按接收部队的兵种给对应一件兵装，且每兵一件 ——
 * 最多补到「士兵数 − 已携带数」，再与运输队携带量取较小。
 */
export function supplyArmamentHeadroomOf(giver: ArmyUnit, target: ArmyUnit): Partial<SupplyArmament> {
  const type = suppliableArmamentOf(target.troopType);
  if (!type) return {};
  const held = target.armaments?.[type] ?? 0;
  const bySoldiers = Math.max(0, target.troops - held);
  return { [type]: Math.min(giver.armaments?.[type] ?? 0, bySoldiers) };
}

/**
 * 士兵补给上限（补给页士兵拖动条的唯一口径）：
 * 接收部队兵种有对应兵装时，每补一兵必须随带一件兵装 ——
 * 上限 = min(运输队士兵数, 运输队该兵装携带量, 接收部队带兵余量)；
 * 运输队没带该兵装则一名兵都补不了。剑兵/攻城器械无对应兵装，不受兵装卡口。
 */
export function supplyTroopMaxOf(giver: ArmyUnit, target: ArmyUnit, troopHeadroom: number): number {
  const type = suppliableArmamentOf(target.troopType);
  if (!type) return Math.min(giver.troops, troopHeadroom);
  return Math.min(giver.troops, giver.armaments?.[type] ?? 0, troopHeadroom);
}

/**
 * 执行补给：从运输队转移 {troops, gold, food, armaments} 给目标部队。
 * 兵装只按接收方兵种收对应一件（`suppliableArmamentOf`），上限为「士兵数 − 已携带」。
 * 运输队本旬行动结束（acted = true）；接收方不受影响（仍可正常行动）。
 */
export function supplyUnit(
  state: GameState,
  forceId: ForceId,
  unitId: string,
  targetId: string,
  amount: SupplyAmount,
): GameState {
  const unit = assertUnitTurn(state, forceId, unitId);
  if (unit.kind !== 'transport') throw new Error('只有运输队可以执行补给');
  const target = state.units[targetId];
  if (!target) throw new Error('目标部队不存在');
  if (target.forceId !== forceId) throw new Error('只能补给己方部队');
  if (target.kind === 'transport') throw new Error('运输队之间不能互相补给');
  if (!suppliableUnits(state, unitId).some((candidate) => candidate.id === targetId)) {
    throw new Error('目标部队不在补给范围');
  }

  const troops = Math.max(0, Math.floor(amount.troops));
  const gold = Math.max(0, Math.floor(amount.gold));
  const food = Math.max(0, Math.floor(amount.food));

  const carriedGold = unit.gold ?? 0;
  if (troops > unit.troops) throw new Error('补给士兵超过运输队携带量');
  if (gold > carriedGold) throw new Error('补给资金超过运输队携带量');
  if (food > unit.food) throw new Error('补给兵粮超过运输队携带量');

  const headroom = supplyHeadroomOf(state, forceId, target);
  if (troops > headroom.troops) throw new Error(`超过目标部队带兵上限（${headroom.troops + target.troops}）`);
  if (gold > headroom.gold) throw new Error(`超过目标部队资金携带上限（${COMBAT_UNIT_GOLD_CAP}）`);
  if (food > headroom.food) throw new Error(`超过目标部队兵粮携带上限（${COMBAT_UNIT_FOOD_CAP}）`);

  // 兵装：只收兵种对应的那一件，每兵一件。补 s 兵后总持有不得超过总士兵：
  // held + qty ≤ target.troops + troops（单独补兵装时 troops=0，退化为「士兵数 − 已携带」口径）
  const armamentType = suppliableArmamentOf(target.troopType);
  const armamentQty = armamentType ? Math.max(0, Math.floor(amount.armaments?.[armamentType] ?? 0)) : 0;
  if (armamentType && armamentQty > 0) {
    if (armamentQty > (unit.armaments?.[armamentType] ?? 0)) throw new Error('补给兵装超过运输队携带量');
    const maxQty = Math.max(0, target.troops + troops - (target.armaments?.[armamentType] ?? 0));
    if (armamentQty > maxQty) throw new Error(`超过目标部队兵装上限（每兵一件，最多再补${maxQty}）`);
  }
  // 士兵与兵装 1:1 联动：兵种有对应兵装时，补士兵必须按每兵一件随带兵装（补给页强制）
  if (armamentType && troops > 0 && armamentQty !== troops) {
    throw new Error(`补给士兵须按每兵一件随带${ARMAMENT_SUPPLY_LABELS[armamentType] ?? '兵装'}`);
  }
  if (troops === 0 && gold === 0 && food === 0 && armamentQty === 0) throw new Error('至少补给一种资源');

  const next = structuredClone(state);
  const giver = next.units[unitId];
  const receiver = next.units[targetId];
  giver.troops -= troops;
  giver.gold = carriedGold - gold;
  giver.food -= food;
  receiver.troops += troops;
  receiver.gold = (receiver.gold ?? 0) + gold;
  receiver.food += food;
  if (armamentType && armamentQty > 0) {
    giver.armaments = { ...giver.armaments, [armamentType]: (giver.armaments?.[armamentType] ?? 0) - armamentQty };
    receiver.armaments = { ...receiver.armaments, [armamentType]: (receiver.armaments?.[armamentType] ?? 0) + armamentQty };
  }

  // 补给消耗运输队本旬行动（与修补/设置同口径）；接收方保持原行动状态
  giver.acted = true;
  giver.moved = true;
  giver.movementRemaining = 0;
  delete giver.delegate;

  const giverName = next.officers[giver.leaderId]?.name ?? '运输队';
  const receiverName = next.officers[receiver.leaderId]?.name ?? '部队';
  const armamentLabel = armamentType ? ARMAMENT_SUPPLY_LABELS[armamentType] ?? '' : '';
  const parts = [
    troops > 0 ? `士兵 ${troops}` : '',
    gold > 0 ? `资金 ${gold}` : '',
    food > 0 ? `兵粮 ${food}` : '',
    armamentQty > 0 ? `${armamentLabel} ${armamentQty}` : '',
  ].filter(Boolean).join('、');
  next.logs ??= [];
  next.logs.push({
    id: `supply-${next.month}-${next.tenDay}-${unitId}-${next.logs.length}`,
    month: next.month,
    forceId,
    message: `${giverName}向${receiverName}补给${parts}。`,
  });

  next.battleDamageReports = [];
  next.cityEffectReports = [];
  next.strategyResultReports = [];
  return next;
}
