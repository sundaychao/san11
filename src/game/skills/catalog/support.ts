import type { SkillDefinition, SkillEffect, SkillSystemDependency } from '../types';

function supportSkill(name: string, description: string, effects: SkillEffect[] = [], blockedBy?: SkillSystemDependency[]): SkillDefinition {
  return {
    name,
    displayCategory: '辅助',
    description,
    implementationStatus: blockedBy ? 'blocked' : 'planned',
    effects,
    ...(blockedBy ? { blockedBy } : {}),
  };
}

function activeSupportSkill(name: string, description: string, effects: SkillEffect[]): SkillDefinition {
  return { ...supportSkill(name, description, effects), implementationStatus: 'active' };
}

export const SUPPORT_SKILLS: SkillDefinition[] = [
  activeSupportSkill('规律', '免疫伪报', [{ kind: 'strategyImmunity', strategyIds: ['false-report'] }]),
  activeSupportSkill('沉着', '免疫扰乱', [{ kind: 'strategyImmunity', strategyIds: ['disturb'] }]),
  activeSupportSkill('明镜', '免疫伪报和扰乱', [
    { kind: 'strategyImmunity', strategyIds: ['false-report', 'disturb'] },
  ]),
  activeSupportSkill('乐奏', '所属势力回合开始前恢复5点气力', [{ kind: 'turnStartEnergy', add: 5 }]),
  activeSupportSkill('诗想', '军乐台气力恢复效果加倍', [{ kind: 'musicTowerEnergyMultiplier', multiplier: 2 }]),
  activeSupportSkill('筑城', '建设和修补设施的耐久增加量加倍', [{ kind: 'buildPowerMultiplier', multiplier: 2 }]),
  supportSkill('屯田', '驻扎关所或港口时降低粮食消耗'),
];
