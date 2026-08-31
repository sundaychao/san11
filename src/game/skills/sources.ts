import { skillDefinition } from './registry';
import type { ActiveSkill } from './types';
import { treasureDefinition } from '../treasures';
import type { ArmyUnit, CityId, GameCommand, GameState, Officer } from '../types';

/** 武将装备宝物所附带的特技名（无装备或宝物无特技时为空） */
export function officerTreasureSkillName(officer: Officer): string | null {
  if (!officer.treasureId) return null;
  return treasureDefinition(officer.treasureId)?.skill ?? null;
}

/** 武将拥有的全部特技名（主特技 + 能力研究习得特技 + 宝物特技，去重且忽略占位符） */
export function officerSkillNames(officer: Officer): string[] {
  const names: string[] = [];
  if (officer.skill && officer.skill !== '无') names.push(officer.skill);
  for (const name of officer.learnedSkills ?? []) {
    if (!names.includes(name)) names.push(name);
  }
  const treasureSkill = officerTreasureSkillName(officer);
  if (treasureSkill && !names.includes(treasureSkill)) names.push(treasureSkill);
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
    // 主特技 + 能力研究习得特技 + 宝物特技（去重）
    const skillNames = new Set<string>(officerSkillNames(officer));

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
  if (command.type === 'transfer' || command.type === 'abilityResearch' || command.type === 'grantTreasure') return [];
  if (command.type === 'explore') return resolveOfficerSkills(state, command.officerIds);
  return resolveOfficerSkills(state, [command.officerId]);
}
