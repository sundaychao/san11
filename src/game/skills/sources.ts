import { skillDefinition } from './registry';
import type { ActiveSkill } from './types';
import type { ArmyUnit, CityId, GameCommand, GameState, Officer } from '../types';

/** 武将拥有的全部特技名（主特技 + 能力研究习得特技，去重且忽略占位符） */
export function officerSkillNames(officer: Officer): string[] {
  const names: string[] = [];
  if (officer.skill && officer.skill !== '无') names.push(officer.skill);
  for (const name of officer.learnedSkills ?? []) {
    if (!names.includes(name)) names.push(name);
  }
  return names;
}

/** 武将特技显示文本（多特技用顿号分隔），无特技显示 — */
export function officerSkillsText(officer: Officer): string {
  const names = officerSkillNames(officer);
  return names.length > 0 ? names.join('、') : '—';
}

export function resolveOfficerSkills(state: GameState, officerIds: string[]): ActiveSkill[] {
  const byName = new Map<string, ActiveSkill>();

  for (const officerId of new Set(officerIds)) {
    const officer = state.officers[officerId];
    if (!officer) continue;
    // 主特技 + 能力研究习得的附加特技（去重）
    const skillNames = new Set<string>();
    if (officer.skill && officer.skill !== '无') skillNames.add(officer.skill);
    for (const name of officer.learnedSkills ?? []) skillNames.add(name);

    for (const name of skillNames) {
      const definition = skillDefinition(name);
      if (!definition || definition.implementationStatus === 'blocked') continue;
      const active = byName.get(definition.name);
      if (active) active.sourceOfficerIds.push(officerId);
      else byName.set(definition.name, { definition, sourceOfficerIds: [officerId] });
    }
  }

  return [...byName.values()];
}

export function resolveUnitSkills(state: GameState, unit: ArmyUnit): ActiveSkill[] {
  return resolveOfficerSkills(state, [unit.leaderId, ...(unit.officerIds ?? [])]);
}

export function resolveCitySkills(state: GameState, cityId: CityId): ActiveSkill[] {
  const city = state.cities[cityId];
  if (!city) return [];

  const officers = Object.values(state.officers)
    .filter((officer) => {
      if (officer.forceId !== city.ownerId) return false;
      return (officer.location.kind === 'city' || officer.location.kind === 'task')
        && officer.location.cityId === cityId;
    });
  const officerIds = [
    ...officers.filter((officer) => officer.location.kind === 'city'),
    ...officers.filter((officer) => officer.location.kind === 'task'),
  ].map((officer) => officer.id);

  return resolveOfficerSkills(state, officerIds);
}

export function resolveCommandSkills(state: GameState, command: GameCommand): ActiveSkill[] {
  return command.type === 'transfer' || command.type === 'abilityResearch'
    ? []
    : resolveOfficerSkills(state, [command.officerId]);
}
