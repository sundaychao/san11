import type { SkillDefinition, SkillEffect, SkillSystemDependency } from '../types';

function domesticSkill(name: string, description: string, effects: SkillEffect[] = [], blockedBy?: SkillSystemDependency[]): SkillDefinition {
  return {
    name,
    displayCategory: '内政',
    description,
    implementationStatus: blockedBy ? 'blocked' : 'planned',
    effects,
    ...(blockedBy ? { blockedBy } : {}),
  };
}

function activeDomesticSkill(name: string, description: string, effects: SkillEffect[]): SkillDefinition {
  return { ...domesticSkill(name, description, effects), implementationStatus: 'active' };
}

export const DOMESTIC_SKILLS: SkillDefinition[] = [
  activeDomesticSkill('名声', '执行征兵时增加征兵量', [{ kind: 'commandYieldMultiplier', command: 'recruit', multiplier: 1.5 }]),
  activeDomesticSkill('能吏', '执行枪、戟、弩兵装生产时增加产量', [
    { kind: 'commandYieldMultiplier', command: 'produceArmament', multiplier: 1.5, armamentTypes: ['spear', 'halberd', 'crossbow'] },
  ]),
  domesticSkill('繁殖', '执行军马生产时增加产量'),
  domesticSkill('发明', '缩短兵器生产周期'),
  domesticSkill('造船', '缩短舰船生产周期'),
  domesticSkill('度支', '所属城市士兵消费的兵粮减半'),
  domesticSkill('指导', '降低技巧研究费用', [], ['technique']),
  domesticSkill('眼力', '搜索时必定发现城市中的在野人才'),
  domesticSkill('论客', '提高同盟、停战和俘虏交换时的舌战效果', [], ['diplomacy']),
];
