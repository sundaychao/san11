import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { TechTreePanel } from './TechTreePanel';
import { TECH_TREE_LEVELS, TECH_TREE_NODES, TECH_TREE_SYSTEMS } from './techTreeData';

/** 新版科技树界面（展示用）：锁定名称、层级、费用与图例，防止后续改动悄悄丢节点 */
describe('TechTreePanel（新版科技树界面）', () => {
  it('渲染六个层级标题与各层资金／技巧值需求', () => {
    render(<TechTreePanel />);

    expect(TECH_TREE_LEVELS).toHaveLength(6);
    for (const item of TECH_TREE_LEVELS) {
      const header = screen.getByTestId(`tech-level-${item.level}`);
      expect(header.textContent).toContain(`Lv${item.level}`);
      expect(header.textContent).toContain(`金${item.gold}｜技${item.techP}`);
    }
    // 与参考图完全一致的六组费用
    expect(TECH_TREE_LEVELS.map((item) => `金${item.gold}｜技${item.techP}`)).toEqual([
      '金1000｜技1000',
      '金2000｜技2000',
      '金3000｜技4000',
      '金4000｜技6000',
      '金6000｜技8000',
      '金8000｜技10000',
    ]);
  });

  it('渲染全部科技节点，名称与所处层级列一致', () => {
    render(<TechTreePanel />);

    expect(TECH_TREE_NODES).toHaveLength(64);
    const columnX = [40, 220, 400, 579, 759, 938];
    for (const node of TECH_TREE_NODES) {
      expect(screen.getByText(node.name)).toBeInTheDocument();
      const group = screen.getByTestId(`tech-node-${node.id}`);
      expect(group.querySelector('rect')?.getAttribute('x')).toBe(String(columnX[node.level - 1]));
    }
  });

  it('九大系统图例齐全', () => {
    render(<TechTreePanel />);

    expect(TECH_TREE_SYSTEMS.map((system) => system.name)).toEqual([
      '步战系', '射击系', '军制系', '骑牧系', '航行系', '理工系', '经济系', '文教系', '化工系',
    ]);
    for (const system of TECH_TREE_SYSTEMS) {
      expect(screen.getByTestId(`tech-system-${system.id}`).textContent).toBe(system.name);
    }
  });

  it('除根科技外每个节点都有一条指向前置的箭头', () => {
    const { container } = render(<TechTreePanel />);

    const roots = TECH_TREE_NODES.filter((node) => !node.prev);
    expect(roots.map((node) => node.name)).toEqual(['职业化', '良马育种', '工兵', '船坞', '公共教育']);
    expect(container.querySelectorAll('.tech-tree-arrows path')).toHaveLength(TECH_TREE_NODES.length - roots.length);
  });

  it('节点底色为深色、文字统一白色，白字对比度达到 WCAG AA', () => {
    render(<TechTreePanel />);

    /** 相对亮度（WCAG 2.x） */
    const luminance = (hex: string) => {
      const channels = [1, 3, 5].map((index) => parseInt(hex.slice(index, index + 2), 16) / 255);
      const linear = (value: number) => (value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
      const [r, g, b] = channels.map(linear);
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };

    for (const node of TECH_TREE_NODES) {
      const group = screen.getByTestId(`tech-node-${node.id}`);
      const fill = group.querySelector('rect')!.getAttribute('fill')!;
      expect(group.querySelector('text')!.getAttribute('fill'), `${node.name} 文字应为白色`).toBe('#ffffff');
      // 白字对比度 = 1.05 / (L + 0.05)，AA 要求正文 ≥ 4.5
      expect(1.05 / (luminance(fill) + 0.05), `${node.name} 底色 ${fill} 对白字对比不足`).toBeGreaterThanOrEqual(4.5);
    }
  });
});
