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
  activeAttackSkill('扫讨', '攻击时降低敌方少量士气(5)', [{ kind: 'attackDrainEnergy', amount: 5 }]),
  activeAttackSkill('威风', '攻击时降低敌方大量士气(20)', [{ kind: 'attackDrainEnergy', amount: 20 }]),
  activeAttackSkill('昂扬', '击破敌军后恢复士气(10)', [{ kind: 'breakUnitEnergy', amount: 10 }]),
  activeAttackSkill('连击', '普通攻击有50%概率连续攻击两次', [{ kind: 'repeatNormalAttack', chance: 0.5 }]),
  activeAttackSkill('急袭', '陆地普通攻击时有50%概率不受反击伤害', [
    { kind: 'noCounterAttack', chance: 0.5, terrain: 'land' },
  ]),
  activeAttackSkill('强袭', '水上普通攻击时有50%概率不受反击伤害', [
    { kind: 'noCounterAttack', chance: 0.5, terrain: 'water' },
  ]),
  activeAttackSkill('乱战', '森林地形攻击时必定暴击', [
    { kind: 'normalAttackCritical', condition: { kind: 'attackerTerrain', terrain: 'forest' } },
    { kind: 'tacticCritical', condition: { kind: 'attackerTerrain', terrain: 'forest' } },
  ]),
  activeAttackSkill('攻城', '增加对城市和设施的耐久伤害(1.5倍)', [{ kind: 'siegeDamageMultiplier', multiplier: 1.5 }]),
  activeAttackSkill('掎角', '一齐攻击时有50%概率使敌军混乱', [{ kind: 'jointAttackConfuse', chance: 0.5 }]),
  activeAttackSkill('捕缚', '击破敌军时必定俘虏敌将', [{ kind: 'guaranteedCapture' }]),
  activeAttackSkill('精妙', '击破敌军获得双倍技巧值', [{ kind: 'techPDoubleOnBreak' }]),
  activeAttackSkill('强夺', '击破敌军时夺取敌将宝物', [{ kind: 'stealTreasureOnBreak' }]),
  activeAttackSkill('心攻', '攻击会心时吸收敌军士兵(约20%)', [{ kind: 'absorbTroops', ratio: 0.2 }]),
  activeAttackSkill('驱逐', '普通攻击武力较低目标时必定暴击', [
    { kind: 'normalAttackCritical', condition: { kind: 'targetWarLower' } },
  ]),
  activeAttackSkill('射程', '井阑和投石射程增加1', [{ kind: 'siegeRangeBonus', add: 1 }]),
  activeAttackSkill('白马', '骑兵可进行远程攻击（骑射）', [{ kind: 'unitAttackRangeBonus', add: 1, troopTypes: ['cavalry'] }]),
  attackSkill('辅佐', '不受人际关系限制发动支援攻击'),
  activeAttackSkill('枪将', '枪兵战法攻击武力较低目标时必定暴击', [
    { kind: 'tacticCritical', condition: { kind: 'targetWarLower' }, troopTypes: ['spear'] },
  ]),
  activeAttackSkill('戟将', '戟兵战法攻击武力较低目标时必定暴击', [
    { kind: 'tacticCritical', condition: { kind: 'targetWarLower' }, troopTypes: ['halberd'] },
  ]),
  activeAttackSkill('弓将', '弩兵战法攻击武力较低目标时必定暴击', [
    { kind: 'tacticCritical', condition: { kind: 'targetWarLower' }, troopTypes: ['crossbow'] },
  ]),
  activeAttackSkill('骑将', '骑兵战法攻击武力较低目标时必定暴击', [
    { kind: 'tacticCritical', condition: { kind: 'targetWarLower' }, troopTypes: ['cavalry'] },
  ]),
  activeAttackSkill('水将', '水军战法攻击武力较低目标时必定暴击', [
    { kind: 'tacticCritical', condition: { kind: 'targetWarLower' }, navalOnly: true },
  ]),
  activeAttackSkill('勇将', '全部战法攻击武力较低目标时必定暴击', [
    { kind: 'tacticCritical', condition: { kind: 'targetWarLower' } },
  ]),
  activeAttackSkill('神将', '普通攻击和全部战法攻击武力较低目标时必定暴击', [
    { kind: 'normalAttackCritical', condition: { kind: 'targetWarLower' } },
    { kind: 'tacticCritical', condition: { kind: 'targetWarLower' } },
  ]),
  activeAttackSkill('斗神', '枪兵和戟兵战法必定暴击', [
    { kind: 'tacticCritical', condition: { kind: 'always' }, troopTypes: ['spear', 'halberd'] },
  ]),
  activeAttackSkill('枪神', '枪兵战法必定暴击', [
    { kind: 'tacticCritical', condition: { kind: 'always' }, troopTypes: ['spear'] },
  ]),
  activeAttackSkill('戟神', '戟兵战法必定暴击', [
    { kind: 'tacticCritical', condition: { kind: 'always' }, troopTypes: ['halberd'] },
  ]),
  activeAttackSkill('弓神', '弩兵战法必定暴击', [
    { kind: 'tacticCritical', condition: { kind: 'always' }, troopTypes: ['crossbow'] },
  ]),
  activeAttackSkill('骑神', '骑兵战法必定暴击', [
    { kind: 'tacticCritical', condition: { kind: 'always' }, troopTypes: ['cavalry'] },
  ]),
  activeAttackSkill('工神', '兵器战法必定暴击', [
    { kind: 'tacticCritical', condition: { kind: 'always' }, troopTypes: ['siege'] },
  ]),
  activeAttackSkill('水神', '水军战法必定暴击', [
    { kind: 'tacticCritical', condition: { kind: 'always' }, navalOnly: true },
  ]),
  activeAttackSkill('霸王', '全部战法必定暴击', [
    { kind: 'tacticCritical', condition: { kind: 'always' } },
  ]),
  activeAttackSkill('疾走', '骑兵战法攻击武力较低目标时必定使其混乱', [
    { kind: 'tacticConfuse', condition: { kind: 'targetWarLower' }, troopTypes: ['cavalry'] },
  ]),
  activeAttackSkill('射手', '弩兵可攻击森林中的目标', [{ kind: 'ignoreForestBlock' }]),
  attackSkill('猛者', '攻击时有50%概率使敌将负伤', [], ['injury']),
];
