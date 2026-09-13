import { describe, expect, it } from 'vitest';
import { GAME_RULES } from './gameRulesContent';
import {
  DIPLOMACY_AP_COST,
  DIPLOMACY_GOLD_MAX,
  GOODWILL_GOLD_COST,
  RELATION_TIER_LABELS,
  TRUCE_MONTHS_MAX,
  TRUCE_MONTHS_MIN,
  relationTierOf,
} from '../game/diplomacy';
import { MARRY_TECHP_COST } from '../game/relationship';
import {
  LOYALTY_CAP_POSITION_MAX,
  LOYALTY_CAP_SERVICE_MAX,
  RECRUIT_REFUSE_LOYALTY,
  RECRUIT_WILL_BASE,
  REWARD_GOLD_COST,
  REWARD_LOYALTY_GAIN,
} from '../game/loyalty';

/** 把某章节的全部展示文案拍平成一个字符串，便于做「数值是否抄对」的包含断言 */
function flatten(id: string): string {
  const entry = GAME_RULES.find((item) => item.id === id);
  if (!entry) throw new Error(`缺少规则章节：${id}`);
  return entry.blocks
    .map((block) => {
      switch (block.kind) {
        case 'heading':
        case 'paragraph':
        case 'note':
          return block.text;
        case 'bullets':
          return block.items.join('\n');
        case 'formula':
          return `${block.caption ?? ''} ${block.text}`;
        case 'table':
          return [block.head.join(' '), ...block.rows.map((row) => row.join(' '))].join('\n');
        default:
          return '';
      }
    })
    .join('\n');
}

/** 断言某个数值在文案里独立出现（不被更长数字吞掉，如 1000 不应匹配到 10000） */
function expectStandaloneNumber(text: string, value: number) {
  expect(text).toMatch(new RegExp(`(?<![0-9])${value}(?![0-9])`));
}

describe('游戏规则面板内容', () => {
  it('每个章节都有 id、标题、简介与非空内容块', () => {
    expect(GAME_RULES.length).toBeGreaterThanOrEqual(4);
    const ids = GAME_RULES.map((entry) => entry.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const entry of GAME_RULES) {
      expect(entry.id).toBeTruthy();
      expect(entry.title).toBeTruthy();
      expect(entry.summary).toBeTruthy();
      expect(entry.blocks.length).toBeGreaterThan(0);
    }
  });

  it('包含外交与武将关系两个章节', () => {
    expect(GAME_RULES.map((entry) => entry.id)).toContain('diplomacy');
    expect(GAME_RULES.map((entry) => entry.id)).toContain('relationship');
    expect(GAME_RULES.find((entry) => entry.id === 'diplomacy')?.title).toBe('外交与势力关系');
    expect(GAME_RULES.find((entry) => entry.id === 'relationship')?.title).toBe('武将关系（仲介）');
  });

  it('外交章节抄录的消耗与上限与源码常量一致', () => {
    const text = flatten('diplomacy');
    expectStandaloneNumber(text, GOODWILL_GOLD_COST);
    expectStandaloneNumber(text, DIPLOMACY_AP_COST);
    expectStandaloneNumber(text, DIPLOMACY_GOLD_MAX);
    expectStandaloneNumber(text, TRUCE_MONTHS_MIN);
    expectStandaloneNumber(text, TRUCE_MONTHS_MAX);
    expect(text).toContain('行动力');
  });

  it('外交章节列出全部交情档位，且与源码切分一致', () => {
    const text = flatten('diplomacy');
    for (const label of Object.values(RELATION_TIER_LABELS)) {
      expect(text).toContain(label);
    }
    // 区间与原版一致：0 ~ 100，50 = 中立，每 20 点一档
    expect(text).toContain('0 ~ 100');
    expect(text).toContain('50 表示彼此中立');
    expect(relationTierOf(80)).toBe('intimate');
    expect(relationTierOf(60)).toBe('friendly');
    expect(relationTierOf(40)).toBe('neutral');
    expect(relationTierOf(20)).toBe('discord');
    expect(relationTierOf(19)).toBe('hostile');
    expect(relationTierOf(0)).toBe('hostile');
  });

  it('外交章节覆盖五种行动与势力关系一览', () => {
    const text = flatten('diplomacy');
    for (const action of ['亲善', '同盟', '停战', '请求援军', '破弃']) {
      expect(text).toContain(action);
    }
    for (const tab of ['对象', '状态', '战力', '兵装', '外交', '资金', '兵粮']) {
      expect(text).toContain(tab);
    }
    expect(text).toContain('相性差');
    expect(text).toContain('互不侵犯');
  });

  it('武将关系章节抄录仲介消耗并覆盖三项实际效果', () => {
    const text = flatten('relationship');
    expectStandaloneNumber(text, MARRY_TECHP_COST);
    expect(text).toContain('义兄弟');
    expect(text).toContain('夫妻');
    expect(text).toContain('忠诚');
    expect(text).toContain('内助');
  });

  it('忠诚章节抄录褒奖消耗与血色衣冠常量，并覆盖三个子系统', () => {
    const text = flatten('loyalty');
    expectStandaloneNumber(text, REWARD_GOLD_COST);
    expectStandaloneNumber(text, REWARD_LOYALTY_GAIN);
    expectStandaloneNumber(text, RECRUIT_WILL_BASE);
    expectStandaloneNumber(text, RECRUIT_REFUSE_LOYALTY);
    expectStandaloneNumber(text, LOYALTY_CAP_SERVICE_MAX);
    expectStandaloneNumber(text, LOYALTY_CAP_POSITION_MAX);
    for (const name of ['忠诚度基准值', '季初忠诚下降', '登用接受意愿', '仕龄', '克己复礼', '仁政', '论客']) {
      expect(text).toContain(name);
    }
  });

  // 伤害章节是给玩家看的，一律用中文名。出现源码里的抽象名说明又抄回代码写法了。
  it('伤害章节的公式只用中文名，不出现源码里的抽象符号', () => {
    const text = flatten('damage');
    for (const banned of ['raw', 'scale', 'committed', 'clamp', 'Math.', 'min(', 'max(', '⌊', '⌉']) {
      expect(text).not.toContain(banned);
    }
    for (const name of ['残兵系数', '投入兵力', '随机浮点', '统率修正', '四舍五入', '向下取整']) {
      expect(text).toContain(name);
    }
  });

  it('伤害章节先给完整公式，再排参数解释', () => {
    const entry = GAME_RULES.find((item) => item.id === 'damage');
    if (!entry) throw new Error('缺少规则章节：damage');
    const firstFormula = entry.blocks.findIndex((block) => block.kind === 'formula');
    const firstParams = entry.blocks.findIndex(
      (block) => block.kind === 'heading' && block.text.includes('逐项参数解释'),
    );
    expect(firstFormula).toBeGreaterThanOrEqual(0);
    expect(firstParams).toBeGreaterThan(firstFormula);
    // 完整公式只写在第一个 formula 块里，不能被参数解释拆成多段
    expect(entry.blocks.filter((block) => block.kind === 'heading' && block.text.includes('参数解释')).length)
      .toBeGreaterThanOrEqual(4);
  });
});
