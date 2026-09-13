import { expect, test } from '@playwright/test';

// 输送（运输队）弹窗的布局回归防护。
//
// 背景：旧版右栏塞了「陆上 / 水上」切换 + 五维雷达图，左栏又有 10 条拖动条，
// 内容高约 860px，超过 `.deploy-dialog` 的 760px 上限 —— 2K 屏（2560×1440）上
// 依然要滚动才能看到「确定输送」。现已删掉这两个板块、并把各行压到 26px。
//
// 只能在真浏览器里测：jsdom 没有布局，scrollHeight 恒为 0。
test.skip(({ viewport }) => viewport?.width !== 1440, '用例内部自行切换视口，单跑一次即可');

/** 紧凑上限：旧版 880，精简后 840 仍留余量 */
const MAX_DIALOG_WIDTH = 860;

const VIEWPORTS = [
  { name: '2k-2560x1440', width: 2560, height: 1440 },
  { name: 'desktop-1920x1080', width: 1920, height: 1080 },
  { name: 'desktop-1600x900', width: 1600, height: 900 },
  { name: 'desktop-1440x900', width: 1440, height: 900 },
  { name: 'laptop-1366x768', width: 1366, height: 768 },
];

test('transport dialog is compact enough to fit on one screen', async ({ page }) => {
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
    const menu = page.getByTestId('city-command-menu');
    await menu.getByRole('button', { name: '军事' }).click();
    await menu.getByRole('button', { name: '输送' }).click();

    const dialog = page.getByRole('dialog', { name: '输送编制' });
    await expect(dialog).toBeVisible();

    // 精简过的东西不该回来：「陆上 / 水上」切换与五维雷达图
    await expect(dialog.locator('.transport-march-tabs')).toHaveCount(0);
    await expect(dialog.locator('.transport-radar')).toHaveCount(0);

    const measured = await page.evaluate(() => {
      const d = document.querySelector('.transport-dialog') as HTMLElement;
      const submit = d.querySelector('button[type="submit"]') as HTMLElement;
      const rect = submit.getBoundingClientRect();
      return {
        width: Math.round(d.getBoundingClientRect().width),
        scrollH: d.scrollHeight,
        clientH: d.clientHeight,
        submitTop: rect.top,
        submitBottom: rect.bottom,
      };
    });

    expect(measured.width, `${vp.name} 弹窗宽度`).toBeLessThanOrEqual(MAX_DIALOG_WIDTH);

    // 弹窗自身不出现纵向滚动条（内容一屏放得下）
    expect(measured.scrollH, `${vp.name} 弹窗纵向滚动`).toBeLessThanOrEqual(measured.clientH + 2);

    // 确认键完整落在视口内，不用滚动去够
    expect(measured.submitTop, `${vp.name} 确认键顶部`).toBeGreaterThanOrEqual(0);
    expect(measured.submitBottom, `${vp.name} 确认键底部`).toBeLessThanOrEqual(vp.height);
  }
});
