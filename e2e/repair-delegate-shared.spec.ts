import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';

/**
 * 实机验证「委任修补的设施被别人修好后，委任部队立刻恢复正常」：
 * 注入存档（关羽 (80,136) 挂着太鼓台 (80,133) 的修补委任、「委」徽章可见；张飞 (80,134) 站在设施旁；
 * 设施 799/800 只差 1 点）→ 继续进度 → 点设施 → 设施菜单「委任修补」（挑中最远的可达部队＝张飞）
 * → 确认即当场修满 → 断言「委」徽章消失、耐久 800/800。
 * fixture 缺失时先跑：node node_modules/vitest/vitest.mjs run src/game/e2e-repair-fixture.test.ts
 */
test('委任修补的设施被另一支部队抢先修好后，原委任部队立刻恢复正常', async ({ page }) => {
  const autosave = readFileSync('e2e/.tmp-autosave-shared.json', 'utf8');
  await page.addInitScript(([save]) => {
    window.localStorage.setItem('jingxiang-208-auth-session-v1', JSON.stringify({
      token: 'test-token', userId: 'test-user', username: 'tester',
    }));
    window.localStorage.setItem('jingxiang-208-autosave-v1', save!);
  }, [autosave] as unknown as string[]);

  await page.goto('/');
  await page.getByRole('button', { name: '继续上次进度' }).click();
  await expect(page.getByTestId('battle-grid-overlay')).toBeVisible();

  // 关羽挂着修补委任：推旬前徽章就是「委」
  const badge = page.getByTestId('battle-unit-ready-badge');
  await expect(badge.filter({ hasText: '委' })).toHaveCount(1);
  await page.screenshot({ path: 'e2e/.tmp-shared-before.png', fullPage: false });

  // 点设施 → 「委任修补」：远处挂委任的关羽不可达？不 —— 两人都可达，挑最近的是张飞（设施旁）
  const facility = page.locator('[data-facility-id="repair-target"]:visible').first();
  await expect(facility).toHaveCount(1);
  const facilityBox = (await facility.boundingBox())!;
  await page.mouse.click(facilityBox.x + facilityBox.width / 2, facilityBox.y + facilityBox.height / 2);
  await expect(page.getByTestId('facility-context-menu')).toBeVisible();
  await page.getByTestId('facility-repair-button').click();

  await expect(page.getByTestId('repair-confirm-menu')).toBeVisible();
  // 确认框只有标题与「是/否」，不带任何说明文字
  await expect(page.getByTestId('repair-confirm-note')).toHaveCount(0);
  await page.getByTestId('repair-confirm-yes').click();
  await expect(page.getByTestId('repair-confirm-menu')).toHaveCount(0);

  // 张飞当场把设施修满 → 关羽的委任已达成，必须立刻解除：「委」徽章数必须归零
  await expect(badge.filter({ hasText: '委' })).toHaveCount(0);

  // 耐久面板确认设施真的满了（hover 主地图上的设施）
  const box = (await facility.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await expect(page.getByTestId('facility-info-durability')).toHaveText('800/800');

  await page.screenshot({ path: 'e2e/.tmp-shared-after.png', fullPage: false });
});
