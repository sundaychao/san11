import type { SkillDefinition, SkillEffect, SkillSystemDependency } from '../types';

function movementSkill(name: string, description: string, effects: SkillEffect[] = [], blockedBy?: SkillSystemDependency[]): SkillDefinition {
  return {
    name,
    displayCategory: '行军',
    description,
    implementationStatus: blockedBy ? 'blocked' : 'planned',
    effects,
    ...(blockedBy ? { blockedBy } : {}),
  };
}

function activeMovementSkill(name: string, description: string, effects: SkillEffect[]): SkillDefinition {
  return { ...movementSkill(name, description, effects), implementationStatus: 'active' };
}

export const MOVEMENT_SKILLS: SkillDefinition[] = [
  activeMovementSkill('飞将', '陆地移动忽略敌方ZOC；对武力较低目标成功施展非兵器陆战战法时必定暴击', [
    { kind: 'ignoreEnemyZoc', terrain: 'land' },
    { kind: 'tacticCritical', condition: { kind: 'targetWarLower' }, excludeTroopTypes: ['siege'] },
  ]),
  movementSkill('遁走', '陆地移动忽略敌方ZOC'),
  activeMovementSkill('强行', '非兵器、非运输陆地部队移动力增加5', [
    { kind: 'movementAllowance', add: 5, excludeKinds: ['transport'], troopTypes: ['sword', 'spear', 'halberd', 'crossbow', 'cavalry'] },
  ]),
  movementSkill('长驱', '骑兵移动力增加'),
  movementSkill('推进', '水上移动忽略敌方ZOC', [], ['navy']),
  movementSkill('操舵', '水上移动力增加', [], ['navy']),
  movementSkill('踏破', '降低栈道、落石等地形伤害'),
  movementSkill('运搬', '运输部队移动力增加'),
  movementSkill('解毒', '免受毒泉伤害'),
];
