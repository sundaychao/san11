import { describe, expect, it } from 'vitest';
import { ORIGINAL_SKILLS, skillDefinition } from './registry';

describe('skill registry', () => {
  it('registers exactly one hundred original skills in the confirmed category counts', () => {
    expect(ORIGINAL_SKILLS).toHaveLength(100);
    expect(new Set(ORIGINAL_SKILLS.map((skill) => skill.name)).size).toBe(100);
    expect(Object.fromEntries(
      ['行军', '攻击', '防御', '计略', '辅助', '内政', '收入', '灾害', '关系'].map((category) => [
        category,
        ORIGINAL_SKILLS.filter((skill) => skill.displayCategory === category).length,
      ]),
    )).toEqual({ 行军: 9, 攻击: 35, 防御: 8, 计略: 20, 辅助: 7, 内政: 8, 收入: 4, 灾害: 8, 关系: 1 });
  });

  it('keeps known custom skills displayable without activating an undefined effect', () => {
    expect(skillDefinition('奸雄')).toMatchObject({ name: '奸雄', implementationStatus: 'planned', effects: [] });
    expect(skillDefinition('不存在的特技')).toBeUndefined();
  });
});
