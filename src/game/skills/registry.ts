import { ATTACK_SKILLS } from './catalog/attack';
import { CUSTOM_SKILLS } from './catalog/custom';
import { DEFENSE_SKILLS } from './catalog/defense';
import { DISASTER_SKILLS } from './catalog/disaster';
import { DOMESTIC_SKILLS } from './catalog/domestic';
import { INCOME_SKILLS } from './catalog/income';
import { MOVEMENT_SKILLS } from './catalog/movement';
import { RELATIONSHIP_SKILLS } from './catalog/relationship';
import { STRATEGY_SKILLS } from './catalog/strategy';
import { SUPPORT_SKILLS } from './catalog/support';
import type { SkillDefinition } from './types';

export const ORIGINAL_SKILLS: ReadonlyArray<SkillDefinition> = [
  ...MOVEMENT_SKILLS,
  ...ATTACK_SKILLS,
  ...DEFENSE_SKILLS,
  ...STRATEGY_SKILLS,
  ...SUPPORT_SKILLS,
  ...DOMESTIC_SKILLS,
  ...INCOME_SKILLS,
  ...DISASTER_SKILLS,
  ...RELATIONSHIP_SKILLS,
];

export { CUSTOM_SKILLS };

const definitions = [...ORIGINAL_SKILLS, ...CUSTOM_SKILLS];
const byName = new Map(definitions.map((definition) => [definition.name, definition]));

export function skillDefinition(name: string): SkillDefinition | undefined {
  return byName.get(name);
}
