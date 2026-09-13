import { isBattleShip, siegeWeaponKindOf } from '../armaments';
import { injuryMultiplier } from '../health';
import { troopAttackTechBonus, troopDefenseTechBonus } from '../techs';
import type { AptitudeGrade, ArmyUnit, GameState, Officer, OfficerAptitudes } from '../types';
import {
  APTITUDE_COMBAT_MULTIPLIER,
  clamp,
  COMBAT_RATING_SCALE,
  NEUTRAL_APTITUDE_MULTIPLIER,
  TRANSPORT_COMBAT_RATING,
  TROOP_BASE_ATTACK,
  TROOP_BASE_DEFENSE,
  type TroopCombatForm,
} from './catalog';

export interface SourcedAbility<T> {
  value: T;
  officerId: string;
}

export interface SourcedAptitude {
  grade: AptitudeGrade | null;
  officerId: string | null;
}

export interface EffectiveUnitAbilities {
  leadership: SourcedAbility<number>;
  war: SourcedAbility<number>;
  intelligence: SourcedAbility<number>;
  aptitude: SourcedAptitude;
}

export const DEFAULT_OFFICER_APTITUDES: OfficerAptitudes = {
  spear: 'B',
  halberd: 'B',
  crossbow: 'B',
  cavalry: 'B',
  siege: 'C',
  navy: 'C',
};

const APTITUDE_RANK: Record<AptitudeGrade, number> = { C: 0, B: 1, A: 2, S: 3, 'S+': 4, 'S++': 5 };
/** 按适性档位索引的战法最高等级（C/B/A/S/S+/S++ → 0/1/2/3/3/3） */
const TACTIC_TIER_BY_RANK = [0, 1, 2, 3, 3, 3];
/** 按适性档位索引的战法暴击率加成（C/B/A/S/S+/S++ → 0/0/4/8/10/12） */
const CRITICAL_BONUS_BY_RANK = [0, 0, 4, 8, 10, 12];

function formationOfficers(state: GameState, unit: ArmyUnit) {
  const leader = state.officers[unit.leaderId];
  if (!leader) return [];

  const seen = new Set([leader.id]);
  const deputies = (unit.officerIds ?? [])
    .map((id) => state.officers[id])
    .filter((officer): officer is Officer => Boolean(officer))
    .filter((officer) => {
      if (seen.has(officer.id)) return false;
      seen.add(officer.id);
      return true;
    });
  return [leader, ...deputies];
}

function firstMaximum(officers: Officer[], value: (officer: Officer) => number) {
  return officers.slice(1).reduce(
    (best, officer) => value(officer) > value(best) ? officer : best,
    officers[0],
  );
}

/** 编队中某适性键的最高等级（与主将是谁无关） */
function highestAptitudeGrade(officers: Officer[], key: keyof OfficerAptitudes): AptitudeGrade {
  const best = firstMaximum(officers, (officer) => APTITUDE_RANK[(officer.aptitudes ?? DEFAULT_OFFICER_APTITUDES)[key]]);
  return (best.aptitudes ?? DEFAULT_OFFICER_APTITUDES)[key];
}

/** 编队最高统率（带伤衰减后） */
function highestLeadership(officers: Officer[]): number {
  const best = firstMaximum(officers, (officer) => Math.round(officer.stats.leadership * injuryMultiplier(officer)));
  return Math.round(best.stats.leadership * injuryMultiplier(best));
}

export function effectiveUnitAbilities(state: GameState, unit: ArmyUnit): EffectiveUnitAbilities {
  const officers = formationOfficers(state, unit);
  const leader = state.officers[unit.leaderId] ?? officers[0];
  if (!leader) throw new Error('Unit leader does not exist');

  // 带伤武将能力按伤势衰减（轻伤90%/中等75%/重伤50%）。
  // 统率同样取编队最高——主将副将均可，不再固定取主将。
  const leadershipOfficer = firstMaximum(officers, (officer) => Math.round(officer.stats.leadership * injuryMultiplier(officer)));
  const warOfficer = firstMaximum(officers, (officer) => Math.round(officer.stats.war * injuryMultiplier(officer)));
  const intelligenceOfficer = firstMaximum(officers, (officer) => Math.round(officer.stats.intelligence * injuryMultiplier(officer)));
  const aptitudeKey = unit.kind === 'transport' || unit.troopType === 'sword'
    ? null
    : unit.troopType ?? null;
  const aptitudeOfficer = aptitudeKey
    ? firstMaximum(officers, (officer) => APTITUDE_RANK[(officer.aptitudes ?? DEFAULT_OFFICER_APTITUDES)[aptitudeKey]])
    : null;

  return {
    leadership: { value: Math.round(leader.stats.leadership * injuryMultiplier(leader)), officerId: leader.id },
    war: { value: Math.round(warOfficer.stats.war * injuryMultiplier(warOfficer)), officerId: warOfficer.id },
    intelligence: { value: Math.round(intelligenceOfficer.stats.intelligence * injuryMultiplier(intelligenceOfficer)), officerId: intelligenceOfficer.id },
    aptitude: aptitudeOfficer && aptitudeKey
      ? { grade: (aptitudeOfficer.aptitudes ?? DEFAULT_OFFICER_APTITUDES)[aptitudeKey], officerId: aptitudeOfficer.id }
      : { grade: null, officerId: null },
  };
}

export function effectiveNavyAptitude(state: GameState, unit: ArmyUnit): SourcedAptitude {
  const officers = formationOfficers(state, unit);
  const aptitudeOfficer = officers.length > 0
    ? firstMaximum(officers, (officer) => APTITUDE_RANK[(officer.aptitudes ?? DEFAULT_OFFICER_APTITUDES).navy])
    : null;
  return aptitudeOfficer
    ? { grade: (aptitudeOfficer.aptitudes ?? DEFAULT_OFFICER_APTITUDES).navy, officerId: aptitudeOfficer.id }
    : { grade: null, officerId: null };
}

export function maxTacticTier(grade: AptitudeGrade | null): 0 | 1 | 2 | 3 {
  if (grade === null) return 0;
  return TACTIC_TIER_BY_RANK[APTITUDE_RANK[grade]] as 0 | 1 | 2 | 3;
}

export function tacticCriticalChance(war: number, grade: AptitudeGrade) {
  const bonus = CRITICAL_BONUS_BY_RANK[APTITUDE_RANK[grade]];
  return clamp(Math.round(5 + Math.max(0, war - 60) * 0.35 + bonus), 5, 30);
}

export function harmfulStrategySuccessChance(source: number, target: number) {
  return clamp(70 + source - target, 10, 95);
}

export function fireStrategySuccessChance(source: number) {
  return clamp(Math.round(55 + (source - 50) * 0.8), 55, 95);
}

/**
 * 部队的战斗形态：器械优先，其次（仅在水上）舰船，最后按基础兵种。
 * 舰船在本项目里是**载具**而非独立兵种，所以陆地上仍按枪/戟/弩/骑的基础攻防计算，
 * 只有部队真的位于水上时才切到走舸/楼船/斗舰的船体数值。
 */
export function troopCombatFormOf(
  state: GameState,
  unit: Pick<ArmyUnit, 'forceId' | 'troopType' | 'vehicle' | 'siegeWeapon'>,
  options?: { onWater?: boolean },
): TroopCombatForm {
  const siegeKind = siegeWeaponKindOf(state, unit);
  if (siegeKind) return siegeKind;
  if (options?.onWater && unit.vehicle) {
    if (unit.vehicle === 'ship') return isBattleShip(state, unit) ? 'battleShip' : 'ship';
    return 'boat';
  }
  // 兵器兵种却缺 siegeWeapon 的异常数据回退到冲车
  if (unit.troopType === 'siege') return 'ram';
  return unit.troopType ?? 'sword';
}

/** 战斗形态对应的适性键：舰船读水军适性；剑兵与运输队无适性（返回 null，按 1.0 计） */
export function aptitudeKeyOfForm(
  unit: Pick<ArmyUnit, 'kind' | 'troopType'>,
  form: TroopCombatForm,
): keyof OfficerAptitudes | null {
  if (form === 'boat' || form === 'ship' || form === 'battleShip') return 'navy';
  if (unit.kind === 'transport' || unit.troopType === 'sword') return null;
  return unit.troopType ?? null;
}

export interface UnitCombatRating {
  attack: number;
  defense: number;
  /** 本次计算采用的战斗形态，供相克判定复用（避免重复解析） */
  form: TroopCombatForm;
}

/**
 * 部队攻防力 = floor(编队最高统率 × 最高适性乘数 × 基础攻防 / 100)。
 * 统率与适性各自取编队最高值，可与主将是谁无关（血色衣冠口径）。
 *
 * 科技「武器精造 / 防具精造」（各＋10）**直接加在基础攻防上**（bonusAttack / bonusDefense），
 * 与兵种基础值同层，即在乘适性、除以 100 之前生效。
 * 不加在这里的话，＋10 会被 /100 稀释成几乎不可见，也和玩家在科技树里看到的「攻击＋10」对不上。
 *
 * 无武将时返回 0，由调用方决定回退展示。
 */
export function troopCombatRating(input: {
  officers: Officer[];
  form: TroopCombatForm;
  aptitudeKey: keyof OfficerAptitudes | null;
  bonusAttack?: number;
  bonusDefense?: number;
}): UnitCombatRating {
  const { officers, form, aptitudeKey } = input;
  if (officers.length === 0) return { attack: 0, defense: 0, form };
  const leadership = highestLeadership(officers);
  const multiplier = aptitudeKey
    ? APTITUDE_COMBAT_MULTIPLIER[highestAptitudeGrade(officers, aptitudeKey)]
    : NEUTRAL_APTITUDE_MULTIPLIER;
  const baseAttack = TROOP_BASE_ATTACK[form] + (input.bonusAttack ?? 0);
  const baseDefense = TROOP_BASE_DEFENSE[form] + (input.bonusDefense ?? 0);
  return {
    attack: Math.floor(leadership * multiplier * baseAttack / COMBAT_RATING_SCALE),
    defense: Math.floor(leadership * multiplier * baseDefense / COMBAT_RATING_SCALE),
    form,
  };
}

/**
 * 从部队实例直接算攻防力（自动解析战斗形态、适性键与武器/防具精造加成）。
 *
 * 运输队是例外：攻防力**固定为 `TRANSPORT_COMBAT_RATING`（20）**，不解析形态、统率与科技
 * —— 辎重队的战斗力不该随押运武将的统率浮动（见该常量注释）。
 */
export function unitCombatRating(
  state: GameState,
  unit: ArmyUnit,
  options?: { onWater?: boolean },
): UnitCombatRating {
  const form = troopCombatFormOf(state, unit, options);
  if (unit.kind === 'transport') {
    return { attack: TRANSPORT_COMBAT_RATING, defense: TRANSPORT_COMBAT_RATING, form };
  }
  return troopCombatRating({
    officers: formationOfficers(state, unit),
    form,
    aptitudeKey: aptitudeKeyOfForm(unit, form),
    bonusAttack: troopAttackTechBonus(state, unit.forceId, unit),
    bonusDefense: troopDefenseTechBonus(state, unit.forceId, unit),
  });
}
