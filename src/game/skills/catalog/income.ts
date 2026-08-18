import type { SkillDefinition, SkillEffect, SkillSystemDependency } from '../types';

function incomeSkill(name: string, description: string, effects: SkillEffect[] = [], blockedBy?: SkillSystemDependency[]): SkillDefinition {
  return {
    name,
    displayCategory: '收入',
    description,
    implementationStatus: blockedBy ? 'blocked' : 'planned',
    effects,
    ...(blockedBy ? { blockedBy } : {}),
  };
}

function activeIncomeSkill(name: string, description: string, effects: SkillEffect[]): SkillDefinition {
  return { ...incomeSkill(name, description, effects), implementationStatus: 'active' };
}

export const INCOME_SKILLS: SkillDefinition[] = [
  activeIncomeSkill('富豪', '所属城市每月金收入变为1.5倍', [{ kind: 'cityIncomeMultiplier', resource: 'gold', multiplier: 1.5 }]),
  activeIncomeSkill('米道', '所属城市每季度粮食收入变为1.5倍', [{ kind: 'cityIncomeMultiplier', resource: 'food', multiplier: 1.5 }]),
  incomeSkill('征税', '所属城市改为每旬获得月金收入的一半'),
  incomeSkill('征收', '所属城市每月获得季度粮食收入的一半'),
];
