import type { AptitudeGrade, ArmyUnit, GameState, Officer, OfficerAptitudes } from '../types';

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

const APTITUDE_RANK: Record<AptitudeGrade, number> = { C: 0, B: 1, A: 2, S: 3 };

const clamp = (value: number, minimum: number, maximum: number) =>
  Math.min(maximum, Math.max(minimum, value));

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

export function effectiveUnitAbilities(state: GameState, unit: ArmyUnit): EffectiveUnitAbilities {
  const officers = formationOfficers(state, unit);
  const leader = state.officers[unit.leaderId] ?? officers[0];
  if (!leader) throw new Error('Unit leader does not exist');

  const warOfficer = firstMaximum(officers, (officer) => officer.stats.war);
  const intelligenceOfficer = firstMaximum(officers, (officer) => officer.stats.intelligence);
  const aptitudeKey = unit.kind === 'transport' || unit.troopType === 'sword'
    ? null
    : unit.troopType ?? null;
  const aptitudeOfficer = aptitudeKey
    ? firstMaximum(officers, (officer) => APTITUDE_RANK[(officer.aptitudes ?? DEFAULT_OFFICER_APTITUDES)[aptitudeKey]])
    : null;

  return {
    leadership: { value: leader.stats.leadership, officerId: leader.id },
    war: { value: warOfficer.stats.war, officerId: warOfficer.id },
    intelligence: { value: intelligenceOfficer.stats.intelligence, officerId: intelligenceOfficer.id },
    aptitude: aptitudeOfficer && aptitudeKey
      ? { grade: (aptitudeOfficer.aptitudes ?? DEFAULT_OFFICER_APTITUDES)[aptitudeKey], officerId: aptitudeOfficer.id }
      : { grade: null, officerId: null },
  };
}

export function maxTacticTier(grade: AptitudeGrade | null): 0 | 1 | 2 | 3 {
  return grade === 'S' ? 3 : grade === 'A' ? 2 : grade === 'B' ? 1 : 0;
}

export function tacticCriticalChance(war: number, grade: AptitudeGrade) {
  const bonus = grade === 'S' ? 8 : grade === 'A' ? 4 : 0;
  return clamp(Math.round(5 + Math.max(0, war - 60) * 0.35 + bonus), 5, 30);
}

export function harmfulStrategySuccessChance(source: number, target: number) {
  return clamp(70 + source - target, 10, 95);
}

export function fireStrategySuccessChance(source: number) {
  return clamp(Math.round(55 + (source - 50) * 0.8), 55, 95);
}
