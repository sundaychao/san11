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

function activeDefenseSkill(name: string, description: string, effects: SkillEffect[]): SkillDefinition {
  return { ...defenseSkill(name, description, effects), implementationStatus: 'active' };
}

export const DEFENSE_SKILLS: SkillDefinition[] = [
  activeDefenseSkill('不屈', '兵力少于3000时有50%概率免除受到的攻击伤害', [
    { kind: 'negateIncomingDamage', chance: 0.5, condition: { kind: 'troopsBelow', amount: 3000 }, sources: ['normalAttack', 'counter', 'tactic'] },
  ]),
  activeDefenseSkill('金刚', '受到低于500的伤害时完全免除', [
    { kind: 'negateIncomingDamage', chance: 1, condition: { kind: 'damageBelow', amount: 500 }, sources: ['normalAttack', 'counter', 'tactic'] },
  ]),
  activeDefenseSkill('铁壁', '一齐攻击只按一次普通攻击处理', [
    { kind: 'jointAttackSingle' },
  ]),
  activeDefenseSkill('怒发', '受到敌方战法后恢复气力(5)', [
    { kind: 'recoverEnergyOnTacticHit', amount: 5 },
  ]),
  activeDefenseSkill('藤甲', '降低非火伤害但增加火焰伤害', [
    { kind: 'nonFireDamageMultiplier', multiplier: 0.5 },
    { kind: 'fireDamageMultiplier', multiplier: 2 },
  ]),
  activeDefenseSkill('强运', '部队武将不会战死、负伤或被俘', [
    { kind: 'captureImmune' },
    { kind: 'injuryImmune' },
  ]),
  activeDefenseSkill('血路', '部队被击破时同部队武将不会被俘', [
    { kind: 'captureImmune' },
  ]),
  defenseSkill('护卫', '同部队武将不会战死或负伤', [], ['injury']),
];
