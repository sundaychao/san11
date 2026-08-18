import { skillDefinition } from './registry';
import type { ActiveSkill } from './types';
import type { ArmyUnit, CityId, GameCommand, GameState } from '../types';

export function resolveOfficerSkills(state: GameState, officerIds: string[]): ActiveSkill[] {
  const byName = new Map<string, ActiveSkill>();

  for (const officerId of new Set(officerIds)) {
    const officer = state.officers[officerId];
    const definition = officer?.skill ? skillDefinition(officer.skill) : undefined;
    if (!officer || !definition || definition.implementationStatus === 'blocked') continue;

    const active = byName.get(definition.name);
    if (active) active.sourceOfficerIds.push(officerId);
    else byName.set(definition.name, { definition, sourceOfficerIds: [officerId] });
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
  return command.type === 'transfer' ? [] : resolveOfficerSkills(state, [command.officerId]);
}
