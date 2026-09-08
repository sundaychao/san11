import type { SkillDefinition, SkillEffect, SkillSystemDependency } from '../types';

function strategySkill(name: string, description: string, effects: SkillEffect[] = [], blockedBy?: SkillSystemDependency[]): SkillDefinition {
  return {
    name,
    displayCategory: '计略',
    description,
    implementationStatus: blockedBy ? 'blocked' : 'planned',
    effects,
    ...(blockedBy ? { blockedBy } : {}),
  };
}

function activeStrategySkill(name: string, description: string, effects: SkillEffect[]): SkillDefinition {
  return { ...strategySkill(name, description, effects), implementationStatus: 'active' };
}

export const STRATEGY_SKILLS: SkillDefinition[] = [
  strategySkill('待伏', '伏兵成功时必定暴击'),
  activeStrategySkill('火攻', '对智力较低目标施放火计必定成功', [
    { kind: 'strategyGuaranteed', strategyIds: ['fire'], condition: { kind: 'targetIntelligenceLower' } },
  ]),
  activeStrategySkill('言毒', '对智力较低目标施放伪报必定成功', [
    { kind: 'strategyGuaranteed', strategyIds: ['false-report'], condition: { kind: 'targetIntelligenceLower' } },
  ]),
  activeStrategySkill('机智', '对智力较低目标施放扰乱必定成功', [
    { kind: 'strategyGuaranteed', strategyIds: ['disturb'], condition: { kind: 'targetIntelligenceLower' } },
  ]),
  activeStrategySkill('诡计', '对智力较低目标施放内讧必定成功', [
    { kind: 'strategyGuaranteed', strategyIds: ['discord'], condition: { kind: 'targetIntelligenceLower' } },
  ]),
  activeStrategySkill('虚实', '对智力较低目标施放敌对计略必定成功', [
    {
      kind: 'strategyGuaranteed',
      strategyIds: ['fire', 'false-report', 'disturb', 'discord'],
      condition: { kind: 'targetIntelligenceLower' },
    },
  ]),
  activeStrategySkill('妙计', '敌军对本部队施放计略失败后陷入混乱', [{ kind: 'strategyCastFailConfuse' }]),
  activeStrategySkill('秘计', '对智力较高目标计略成功时必定暴击', [
    { kind: 'strategyCritical', condition: { kind: 'targetIntelligenceHigher' } },
  ]),
  activeStrategySkill('看破', '必定识破智力较低敌军的计略', [
    {
      kind: 'strategyImmunity',
      strategyIds: ['fire', 'false-report', 'disturb', 'discord'],
      condition: { kind: 'targetIntelligenceLower' },
    },
  ]),
  activeStrategySkill('洞察', '免疫全部敌方部队计略', [{ kind: 'strategyImmunity', strategyIds: 'all' }]),
  activeStrategySkill('火神', '强化火计成功率和伤害并免疫敌方火计', [
    { kind: 'strategyGuaranteed', strategyIds: ['fire'], condition: { kind: 'targetIntelligenceLower' } },
    { kind: 'fireDamageMultiplier', multiplier: 2 },
    { kind: 'strategyImmunity', strategyIds: ['fire'] },
  ]),
  activeStrategySkill('神算', '对智力较低目标的计略必定成功并获得计略优待', [
    {
      kind: 'strategyGuaranteed',
      strategyIds: ['fire', 'false-report', 'disturb', 'discord'],
      condition: { kind: 'targetIntelligenceLower' },
    },
    { kind: 'strategySuccessBonus', add: 10 },
  ]),
  activeStrategySkill('百出', '使用计略时战力消耗固定为1', [{ kind: 'strategyEnergyCost', set: 1 }]),
  activeStrategySkill('鬼谋', '计略施放距离增加1', [{ kind: 'strategyRangeBonus', add: 1 }]),
  activeStrategySkill('连环', '敌对计略成功后波及与目标相邻的敌军', [{ kind: 'complexHandler', handler: 'chainStrategy' }]),
  activeStrategySkill('深谋', '敌对计略成功时必定暴击', [{ kind: 'strategyCritical', condition: { kind: 'always' } }]),
  activeStrategySkill('反计', '识破敌方计略后将计略反作用于敌军', [{ kind: 'reflectStrategy' }]),
  activeStrategySkill('倾国', '提高对非女性武将部队的计略成功率', [
    { kind: 'strategySuccessBonus', add: 10, nonFemaleOnly: true },
  ]),
  strategySkill('妖术', '可以使用妖术'),
  strategySkill('鬼门', '可以使用妖术和落雷'),
];
