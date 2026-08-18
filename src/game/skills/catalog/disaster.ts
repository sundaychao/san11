import type { SkillDefinition, SkillEffect, SkillSystemDependency } from '../types';

function disasterSkill(name: string, description: string, effects: SkillEffect[] = [], blockedBy?: SkillSystemDependency[]): SkillDefinition {
  return {
    name,
    displayCategory: '灾害',
    description,
    implementationStatus: blockedBy ? 'blocked' : 'planned',
    effects,
    ...(blockedBy ? { blockedBy } : {}),
  };
}

export const DISASTER_SKILLS: SkillDefinition[] = [
  disasterSkill('亲乌', '降低所属城市领内乌丸据点带来的危害', [], ['tribe']),
  disasterSkill('亲羌', '降低所属城市领内羌族据点带来的危害', [], ['tribe']),
  disasterSkill('亲越', '降低所属城市领内山越据点带来的危害', [], ['tribe']),
  disasterSkill('亲蛮', '降低所属城市领内南蛮据点带来的危害', [], ['tribe']),
  disasterSkill('威压', '所属城市领内不会出现贼军和异民族据点', [], ['tribe']),
  disasterSkill('仁政', '所属城市武将忠诚度不会降低', [], ['loyalty']),
  disasterSkill('风水', '所属城市免疫疫病'),
  disasterSkill('祈祷', '提高所属城市发生丰收的概率'),
];
