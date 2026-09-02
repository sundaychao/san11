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
  activeMovementSkill('强行', '非兵器、非运输陆地部队移动力增加5', [
    { kind: 'movementAllowance', add: 5, excludeKinds: ['transport'], troopTypes: ['sword', 'spear', 'halberd', 'crossbow', 'cavalry'] },
  ]),
  activeMovementSkill('遁走', '陆地移动忽略敌方ZOC', [
    { kind: 'ignoreEnemyZoc', terrain: 'land' },
  ]),
  activeMovementSkill('长驱', '骑兵移动力增加3', [
    { kind: 'movementAllowance', add: 3, troopTypes: ['cavalry'] },
  ]),
  activeMovementSkill('推进', '水上移动忽略敌方ZOC', [
    { kind: 'ignoreEnemyZoc', terrain: 'water' },
  ]),
  activeMovementSkill('操舵', '水上移动力增加', [
    { kind: 'movementAllowance', add: 6, waterOnly: true },
  ]),
  movementSkill('踏破', '降低栈道、落石等地形伤害'),
  activeMovementSkill('搬运', '运输部队移动力增加5', [
    { kind: 'movementAllowance', add: 5, kinds: ['transport'] },
  ]),
  movementSkill('解毒', '免受毒泉伤害'),
];
