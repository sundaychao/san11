import { describe, expect, it } from 'vitest';
import { CUSTOM_SKILLS, ORIGINAL_SKILLS, skillDefinition } from './registry';

const FIRST_STAGE_SKILLS = [
  '强行', '飞将', '神将', '连击', '不屈', '百出', '火神', '洞察', '连环', '筑城', '乐奏', '富豪', '米道', '名声', '能吏',
] as const;

const NAVAL_SKILLS = [
  '推进', '操舵', '强袭', '水将', '水神',
] as const;

const ACTIVE_SKILLS = [...FIRST_STAGE_SKILLS, ...NAVAL_SKILLS] as const;

describe('skill registry', () => {
  it('registers exactly one hundred and one original skills in the confirmed category counts', () => {
    expect(ORIGINAL_SKILLS).toHaveLength(101);
    expect(new Set(ORIGINAL_SKILLS.map((skill) => skill.name)).size).toBe(101);
    expect(Object.fromEntries(
      ['行军', '攻击', '防御', '计略', '辅助', '内政', '收入', '灾害', '关系'].map((category) => [
        category,
        ORIGINAL_SKILLS.filter((skill) => skill.displayCategory === category).length,
      ]),
    )).toEqual({ 行军: 9, 攻击: 35, 防御: 8, 计略: 20, 辅助: 7, 内政: 9, 收入: 4, 灾害: 8, 关系: 1 });
  });

  it('activates the fifteen first-stage skills plus the five naval skills and leaves the other eighty-one inactive', () => {
    const active = ORIGINAL_SKILLS.filter((skill) => skill.implementationStatus === 'active');
    const inactive = ORIGINAL_SKILLS.filter((skill) => skill.implementationStatus !== 'active');

    expect(active.map((skill) => skill.name).sort()).toEqual([...ACTIVE_SKILLS].sort());
    expect(active).toHaveLength(20);
    expect(inactive).toHaveLength(81);
    expect(inactive.every((skill) => skill.implementationStatus === 'planned' || skill.implementationStatus === 'blocked'))
      .toBe(true);
  });

  it('keeps known custom skills displayable without activating an undefined effect', () => {
    expect(CUSTOM_SKILLS.every((skill) => skill.implementationStatus === 'planned' && skill.effects.length === 0)).toBe(true);
    expect(skillDefinition('奸雄')).toMatchObject({ name: '奸雄', implementationStatus: 'planned', effects: [] });
    expect(skillDefinition('不存在的特技')).toBeUndefined();
  });
});
