import type { SkillDefinition } from '../types';

const CUSTOM_SKILL_DESCRIPTION = '项目自定义特技，效果将在单独规则设计中启用';

export const CUSTOM_SKILLS: SkillDefinition[] = [
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
