import { expect, test } from '@playwright/test';

/** 临时探针：量各指令弹窗在矮屏下的尺寸与确认键可见性。用完即删。 */
const VIEWPORTS = [
  { name: 'desktop-1440x900', width: 1440, height: 900 },
  { name: 'laptop-1366x768', width: 1366, height: 768 },
];

/** 弹窗入口：分区 testid → 指令 testid */
const DIALOGS = [
  { name: '开发建设', section: 'urban', command: 'buildFacilityPlot' },
  { name: '能力研究', section: 'research', command: 'abilityResearch' },
  { name: '科技研究', section: 'research', command: 'research' },
  { name: '征兵', section: 'urban', command: 'recruit' },
];

for (const vp of VIEWPORTS) {
  for (const dlg of DIALOGS) {
    test(`measure ${dlg.name} @ ${vp.name}`, async ({ page }) => {
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
      await page.locator('[data-testid^="city-footprint-jiangling-"]').first().click();
      await page.getByTestId(`city-command-section-${dlg.section}`).click();

      const entry = page.getByTestId(`city-command-command-${dlg.command}`);
      if (await entry.isDisabled()) {
        console.log(`MEASURE ${dlg.name} @ ${vp.name}`, JSON.stringify({ skipped: '入口按钮被禁用' }));
        return;
      }
      await entry.click();

      const dialog = page.locator('.command-dialog').first();
      await expect(dialog).toBeVisible();
      const box = (await dialog.boundingBox())!;

      const m = await page.evaluate(() => {
        const d = document.querySelector('.command-dialog') as HTMLElement;
        const submit = d.querySelector('button[type="submit"]') as HTMLElement | null;
        const sr = submit?.getBoundingClientRect();
        return {
          scrollH: d.scrollHeight,
          clientH: d.clientHeight,
          submitBottom: sr ? Math.round(sr.bottom) : null,
          submitVisible: sr ? sr.bottom <= window.innerHeight && sr.top >= 0 : null,
          innerScrollers: Array.from(d.querySelectorAll('*'))
            .filter((el) => {
              const s = getComputedStyle(el);
              const h = el as HTMLElement;
              return h.scrollHeight > h.clientHeight + 2 && (s.overflowY === 'auto' || s.overflowY === 'scroll');
            })
            .map((el) => (el as HTMLElement).className),
        };
      });

      console.log(`MEASURE ${dlg.name} @ ${vp.name}`, JSON.stringify({
        dialog: { w: Math.round(box.width), h: Math.round(box.height) },
        ...m,
      }));
    });
  }
}
