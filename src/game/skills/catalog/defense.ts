import type { SkillDefinition, SkillEffect, SkillSystemDependency } from '../types';

function defenseSkill(name: string, description: string, effects: SkillEffect[] = [], blockedBy?: SkillSystemDependency[]): SkillDefinition {
  return {
    name,
    displayCategory: '防御',
    description,
    implementationStatus: blockedBy ? 'blocked' : 'planned',
    effects,
    ...(blockedBy ? { blockedBy } : {}),
  };
}

export const DEFENSE_SKILLS: SkillDefinition[] = [
  defenseSkill('不屈', '兵力少于3000时有50%概率免除受到的攻击伤害', [
    { kind: 'negateIncomingDamage', chance: 0.5, condition: { kind: 'troopsBelow', amount: 3000 }, sources: ['normalAttack', 'counter', 'tactic'] },
  ]),
  defenseSkill('金刚', '受到少量伤害时有50%概率完全免除'),
  defenseSkill('铁壁', '一齐攻击只按一次普通攻击处理'),
  defenseSkill('怒发', '受到敌方战法后恢复气力'),
  defenseSkill('藤甲', '降低非火伤害但增加火焰伤害'),
  defenseSkill('强运', '部队武将不会战死、负伤或被俘', [], ['capture', 'injury']),
  defenseSkill('血路', '部队被击破时同部队武将不会被俘', [], ['capture']),
  defenseSkill('护卫', '同部队武将不会战死或负伤', [], ['injury']),
];
