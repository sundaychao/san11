import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  TACTIC_POWER_NODES,
  TECH_EFFECT_GAPS,
  TECH_FACILITY_GATES,
  TECH_NODES,
  TECH_NODES_WITHOUT_EFFECT,
  TECH_NODE_MAP,
} from './techs';

/**
 * 科技效果的「接入守卫」。
 *
 * 背景：曾出现过科技节点写进了 TECH_NODES、界面上也能研究，但效果没有任何代码读取的情况
 * （玩家花了钱研究，游戏里毫无变化，且极难察觉）。本测试把这件事变成红灯。
 *
 * 判定方式：效果在本文件中只有三种落地写法，逐一识别——
 *   1. hasTech(state, forceId, '<id>')                        → 源码文本匹配
 *   2. TACTIC_POWER_NODES 里登记 '<id>'（战法威力训练/专精）   → 运行时读表
 *   3. TECH_FACILITY_GATES 里登记 node: '<id>'（设施解锁）     → 运行时读表
 *
 * 注意不能简单地统计 `'<id>'` 出现次数：节点会被别的节点用 prev 引用（如印刷术是克己复礼的前置），
 * 那样会把「只出现在科技表里」的节点误判成已接入。
 */
const SOURCE_PATH = resolve(process.cwd(), 'src/game/techs.ts');
const SOURCE_TEXT = readFileSync(SOURCE_PATH, 'utf8');

const TACTIC_POWER_IDS = new Set<string>(Object.values(TACTIC_POWER_NODES).flatMap((pair) => (pair ? [...pair] : [])));
const FACILITY_GATE_IDS = new Set<string>(TECH_FACILITY_GATES.map((gate) => gate.node));

function isImplemented(nodeId: string): boolean {
  if (TACTIC_POWER_IDS.has(nodeId) || FACILITY_GATE_IDS.has(nodeId)) return true;
  return new RegExp(`hasTech\\([^)]*'${nodeId}'`).test(SOURCE_TEXT);
}

describe('科技效果接入守卫', () => {
  it('每个科技节点都应有唯一 id', () => {
    const ids = TECH_NODES.map((node) => node.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('欠账清单里的节点 id 都真实存在', () => {
    for (const gap of TECH_EFFECT_GAPS) {
      expect(TECH_NODE_MAP[gap.node], `欠账清单引用了不存在的科技：${gap.node}`).toBeDefined();
    }
  });

  it('欠账清单之外的科技都已接入效果', () => {
    const exempt = new Set(TECH_EFFECT_GAPS.map((gap) => gap.node));
    const notImplemented = TECH_NODES
      .filter((node) => !exempt.has(node.id) && !isImplemented(node.id))
      .map((node) => `${node.name}(${node.id})`);

    expect(
      notImplemented,
      `以下科技可研究但没有任何代码读取其效果，请补实现或登记进 TECH_EFFECT_GAPS：${notImplemented.join('、')}`,
    ).toEqual([]);
  });

  it('标记为「完全未接入」的科技确实没有实现（防止台账过期）', () => {
    const stale = TECH_NODES_WITHOUT_EFFECT.filter(isImplemented);

    expect(
      stale,
      `以下科技已经接入效果，请从 TECH_EFFECT_GAPS 中删除：${stale.join('、')}`,
    ).toEqual([]);
  });
});
