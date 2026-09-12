import { expect, test } from '@playwright/test';

// 科技研究弹窗的布局回归防护。
//
// 三件事只能在真浏览器里证，jsdom 没有布局：
//  1. 弹窗宽度 —— 需求是「科技项左右收窄、整窗窄 1/3」，原为 1180px，现为 780px。
//     画布 750（TechTreePanel 的 CANVAS_W）+ 左右各 14 内边距 + 2 边框 = 780，
//     改 CANVAS_W 时必须同步改 `.command-dialog:has(.tech-tree-panel)` 的宽度，
//     否则 SVG 会被 width:100% 缩放、字跟着变小。
//  2. 常规视口（高 ≥ 600px）下整窗一屏可见 —— 曾经 1366×768 时内容 771px > 可视 734px，
//     「决定·科技研究」要滚动才够得着。现在靠纵向 flex + dvh 自适应高度保证。
//     注意科技树面板**自己**也不能出现滚动条：`.tech-tree-svg` 的 max-height 必须小于
//     「可视高 − 334px 固定开销」（334 是实测值，改动页脚/信息表后要重新标定）。
//  3. 极矮视口（手机横屏 844×390）内容必然放不下，此时只要求页脚吸底、
//     确认键始终够得着，不要求一屏可见。
//
// 本用例自行设置视口，跑一遍即可。
test.skip(({ viewport }) => viewport?.width !== 1440, '用例内部自行切换视口，单跑一次即可');

/** 需求上限：原宽 1180 的 2/3 ≈ 787，留一点余量取 800 */
const MAX_DIALOG_WIDTH = 800;

const VIEWPORTS = [
  { name: 'desktop-1920x1080', width: 1920, height: 1080, fitsWithoutScroll: true },
  { name: 'desktop-1440x900', width: 1440, height: 900, fitsWithoutScroll: true },
  { name: 'laptop-1366x768', width: 1366, height: 768, fitsWithoutScroll: true },
  { name: 'window-1024x600', width: 1024, height: 600, fitsWithoutScroll: true },
  { name: 'tablet-768x1024', width: 768, height: 1024, fitsWithoutScroll: true },
  // 移动端：科技树按 min-width 620 横向滚动（设计如此），纵向仍须一屏放得下
  { name: 'mobile-390x844', width: 390, height: 844, fitsWithoutScroll: true },
  // 极矮视口（手机横屏 844×390）：内容必然放不下，只要求页脚吸底、确认键够得着
  { name: 'landscape-844x390', width: 844, height: 390, fitsWithoutScroll: false },
];

test('tech research dialog stays compact and keeps its confirm button on screen', async ({ page }) => {
  for (const vp of VIEWPORTS) {
    await page.setViewportSize({ width: vp.width, height: vp.height });
    await page.addInitScript(() => {
      window.localStorage.setItem('jingxiang-208-auth-session-v1', JSON.stringify({
        token: 'test-token', userId: 'test-user', username: 'tester',
      }));
    });
    await page.goto('/');
    await page.getByRole('button', { name: /重新开始新游戏/ }).click();
    await page.getByTestId('map-card-china42x').click();
    await page.getByRole('button', { name: '选择刘备' }).click();
    await expect(page.getByTestId('battle-grid-overlay')).toBeVisible();

    // 城池名牌（city-marker）是 pointer-events:none 的装饰层，真正可点的是 footprint 色块
    await page.locator('[data-testid^="city-footprint-jiangling-"]').first().click();
    await page.getByTestId('city-command-section-research').click();
    await page.getByTestId('city-command-command-research').click();

    const dialog = page.getByRole('dialog', { name: '科技研究' });
    await expect(dialog).toBeVisible();

    const measured = await page.evaluate(() => {
      const d = document.querySelector('.command-dialog') as HTMLElement;
      const submit = d.querySelector('button[type="submit"]') as HTMLElement;
      const panel = d.querySelector('.tech-tree-panel') as HTMLElement;
      const rect = submit.getBoundingClientRect();
      return {
        width: Math.round(d.getBoundingClientRect().width),
        scrollH: d.scrollHeight,
        clientH: d.clientHeight,
        treeScrolls: panel.scrollHeight > panel.clientHeight + 2,
        submitBottom: rect.bottom,
        submitTop: rect.top,
      };
    });

    // 1) 整窗宽度保持在紧凑区间
    expect(measured.width, `${vp.name} 弹窗宽度`).toBeLessThanOrEqual(MAX_DIALOG_WIDTH);

    // 2) 确认按钮完整落在视口内（所有视口都必须满足）
    expect(measured.submitTop, `${vp.name} 确认键顶部`).toBeGreaterThanOrEqual(0);
    expect(measured.submitBottom, `${vp.name} 确认键底部`).toBeLessThanOrEqual(vp.height);

    if (vp.fitsWithoutScroll) {
      // 3) 弹窗自身与科技树面板都不出现纵向滚动条（内容一屏放得下）
      expect(measured.scrollH, `${vp.name} 弹窗纵向滚动`).toBeLessThanOrEqual(measured.clientH + 2);
      expect(measured.treeScrolls, `${vp.name} 科技树面板纵向滚动`).toBe(false);
    }
  }
});
