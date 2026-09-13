import { describe, expect, it } from 'vitest';
import { CUSTOM_SKILLS, ORIGINAL_SKILLS, skillDefinition } from './registry';

const FIRST_STAGE_SKILLS = [
  '强行', '飞将', '神将', '连击', '不屈', '百出', '火神', '洞察', '连环', '筑城', '乐奏', '富豪', '米道', '名声', '能吏',
] as const;

const NAVAL_SKILLS = [
  '推进', '操舵', '强袭', '水将', '水神',
] as const;

const COMBAT_SKILLS = [
  // 攻击类
  '扫讨', '威风', '昂扬', '连击', '急袭', '强袭', '乱战', '攻城', '掎角', '捕缚',
  '心攻', '驱逐', '枪将', '戟将', '弓将', '骑将', '水将', '勇将', '神将', '斗神',
  '枪神', '戟神', '弓神', '骑神', '工神', '水神', '霸王', '疾走', '射手',
  '精妙', '强夺', '射程', '白马',
  // 防御类
  '不屈', '金刚', '铁壁', '怒发', '藤甲', '强运', '血路',
] as const;

const STRATEGY_SKILLS = [
  // 计略类
  '火攻', '言毒', '机智', '诡计', '虚实', '妙计', '秘计', '看破', '神算', '鬼谋', '深谋', '反计', '倾国',
  // 辅助类（计略免疫）
  '规律', '沉着', '明镜',
] as const;

const MOVEMENT_INTERNAL_DISASTER_SKILLS = [
  // 行军类
  '遁走', '长驱', '搬运',
  // 内政类
  '繁殖', '发明', '造船', '度支', '指导', '眼力',
  // 辅助类
  '诗想',
  // 灾害类
  '祈祷',
] as const;

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

  it('activates the fifteen first-stage skills, the five naval skills, the completed combat skills, and the strategy skills', () => {
    const active = ORIGINAL_SKILLS.filter((skill) => skill.implementationStatus === 'active');
    const activeNames = new Set(active.map((skill) => skill.name));

    for (const name of [...FIRST_STAGE_SKILLS, ...NAVAL_SKILLS, ...COMBAT_SKILLS, ...STRATEGY_SKILLS, ...MOVEMENT_INTERNAL_DISASTER_SKILLS]) {
      expect(activeNames.has(name), `${name} 应为 active`).toBe(true);
    }
    expect(active).toHaveLength(new Set([...FIRST_STAGE_SKILLS, ...NAVAL_SKILLS, ...COMBAT_SKILLS, ...STRATEGY_SKILLS, ...MOVEMENT_INTERNAL_DISASTER_SKILLS]).size);

    const inactive = ORIGINAL_SKILLS.filter((skill) => skill.implementationStatus !== 'active');
    expect(inactive.every((skill) => skill.implementationStatus === 'planned' || skill.implementationStatus === 'blocked'))
      .toBe(true);
  });

  it('keeps known custom skills displayable without activating an undefined effect', () => {
    const planned = CUSTOM_SKILLS.filter((skill) => skill.implementationStatus === 'planned');
    expect(planned.every((skill) => skill.effects.length === 0)).toBe(true);
    expect(skillDefinition('奸雄')).toMatchObject({ name: '奸雄', implementationStatus: 'planned', effects: [] });
    expect(skillDefinition('不存在的特技')).toBeUndefined();
  });

  it('activates 布阵 as a 血色衣冠 custom skill with real effects', () => {
    // 原版没有「布阵」，它是血色衣冠新增的防御特技，故登记在 CUSTOM_SKILLS 而非 DEFENSE_SKILLS
    expect(skillDefinition('布阵')).toMatchObject({
      name: '布阵',
      displayCategory: '防御',
      implementationStatus: 'active',
    });
    expect(skillDefinition('布阵')!.effects.map((effect) => effect.kind))
      .toEqual(['ignoreMatchupPenalty', 'tacticCriticalImmune']);
  });
});
