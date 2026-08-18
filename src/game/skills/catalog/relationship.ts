import type { SkillDefinition, SkillEffect, SkillSystemDependency } from '../types';

function relationshipSkill(name: string, description: string, effects: SkillEffect[] = [], blockedBy?: SkillSystemDependency[]): SkillDefinition {
  return {
    name,
    displayCategory: '关系',
    description,
    implementationStatus: blockedBy ? 'blocked' : 'planned',
    effects,
    ...(blockedBy ? { blockedBy } : {}),
  };
}

export const RELATIONSHIP_SKILLS: SkillDefinition[] = [
  relationshipSkill('内助', '结婚后夫妻双方全部能力增加1', [], ['marriage']),
];
