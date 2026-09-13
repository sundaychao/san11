import type { SkillDefinition } from '../types';

const CUSTOM_SKILL_DESCRIPTION = '项目自定义特技，效果将在单独规则设计中启用';

/** 尚未接入规则的自定义特技：只保证界面能正常显示，效果为空 */
const PLANNED_CUSTOM_SKILLS: SkillDefinition[] = [
  '奸雄',
  '坚守',
  '王佐',
  '刚将',
  '仁德',
  '白毦',
  '明君',
].map((name) => ({
  name,
  displayCategory: '辅助',
  description: CUSTOM_SKILL_DESCRIPTION,
  implementationStatus: 'planned',
  effects: [],
}));

/**
 * 已接入规则的自定义特技。
 *
 * 「布阵」是《血色衣冠》在**原版 101 个特技之外**新增的特技（原版没有），
 * 因此不放进 `catalog/defense.ts`，否则会打破 `registry.test.ts` 对原版数量的断言。
 */
const ACTIVE_CUSTOM_SKILLS: SkillDefinition[] = [
  {
    name: '布阵',
    displayCategory: '防御',
    description: '规避兵种相克带来的负面效果（但保留有利加成），并防止被战法暴击',
    implementationStatus: 'active',
    effects: [
      { kind: 'ignoreMatchupPenalty' },
      { kind: 'tacticCriticalImmune' },
    ],
  },
];

export const CUSTOM_SKILLS: SkillDefinition[] = [...PLANNED_CUSTOM_SKILLS, ...ACTIVE_CUSTOM_SKILLS];
