import type { SkillDefinition, SkillEffect, SkillSystemDependency } from '../types';

function attackSkill(name: string, description: string, effects: SkillEffect[] = [], blockedBy?: SkillSystemDependency[]): SkillDefinition {
  return {
    name,
    displayCategory: '攻击',
    description,
    implementationStatus: blockedBy ? 'blocked' : 'planned',
    effects,
    ...(blockedBy ? { blockedBy } : {}),
  };
}

function activeAttackSkill(name: string, description: string, effects: SkillEffect[]): SkillDefinition {
  return { ...attackSkill(name, description, effects), implementationStatus: 'active' };
}

export const ATTACK_SKILLS: SkillDefinition[] = [
  attackSkill('扫讨', '攻击时降低敌方少量气力'),
  attackSkill('威风', '攻击时降低敌方大量气力'),
  attackSkill('昂扬', '击破敌军后恢复气力'),
  activeAttackSkill('连战', '普通攻击有50%概率连续攻击两次', [{ kind: 'repeatNormalAttack', chance: 0.5 }]),
  attackSkill('急袭', '陆地普通攻击时有50%概率不受反击伤害'),
  activeAttackSkill('强袭', '水上普通攻击时有50%概率不受反击伤害', [
    { kind: 'noCounterAttack', chance: 0.5, terrain: 'water' },
  ]),
  attackSkill('乱战', '森林地形攻击时必定暴击'),
  attackSkill('攻城', '增加对城市和设施的耐久伤害'),
  attackSkill('掎角', '一齐攻击时有概率使敌军混乱'),
  attackSkill('捕缚', '击破敌军时必定俘虏敌将', [], ['capture']),
  attackSkill('精妙', '击破敌军获得双倍技巧值', [], ['technique']),
  attackSkill('强夺', '击破敌军时夺取敌将宝物', [], ['treasure']),
  attackSkill('心攻', '攻击时吸收敌军部分士兵'),
  attackSkill('驱逐', '普通攻击武力较低目标时必定暴击'),
  attackSkill('射程', '井阑和投石射程增加1'),
  attackSkill('白马', '骑兵未研究骑射时仍可远程攻击'),
  attackSkill('辅佐', '不受人际关系限制发动支援攻击'),
  attackSkill('枪将', '枪兵战法攻击武力较低目标时必定暴击'),
  attackSkill('戟将', '戟兵战法攻击武力较低目标时必定暴击'),
  attackSkill('弓将', '弩兵战法攻击武力较低目标时必定暴击'),
  attackSkill('骑将', '骑兵战法攻击武力较低目标时必定暴击'),
  activeAttackSkill('水将', '水军战法攻击武力较低目标时必定暴击', [
    { kind: 'tacticCritical', condition: { kind: 'targetWarLower' }, navalOnly: true },
  ]),
  attackSkill('勇将', '全部战法攻击武力较低目标时必定暴击'),
  activeAttackSkill('神将', '普通攻击和全部战法攻击武力较低目标时必定暴击', [
    { kind: 'normalAttackCritical', condition: { kind: 'targetWarLower' } },
    { kind: 'tacticCritical', condition: { kind: 'targetWarLower' } },
  ]),
  attackSkill('斗神', '枪兵和戟兵战法必定暴击'),
  attackSkill('枪神', '枪兵战法必定暴击'),
  attackSkill('戟神', '戟兵战法必定暴击'),
  attackSkill('弓神', '弩兵战法必定暴击'),
  attackSkill('骑神', '骑兵战法必定暴击'),
  attackSkill('工神', '兵器战法必定暴击'),
  activeAttackSkill('水神', '水军战法必定暴击', [
    { kind: 'tacticCritical', condition: { kind: 'always' }, navalOnly: true },
  ]),
  attackSkill('霸王', '全部战法必定暴击'),
  attackSkill('疾走', '骑兵战法攻击能力较低目标时必定使其混乱'),
  attackSkill('射手', '弩兵可对森林中的目标施展战法'),
  attackSkill('猛者', '攻击时有50%概率使敌将负伤', [], ['injury']),
];
