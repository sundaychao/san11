import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';

/**
 * 实机验证「出征部队的修补委任会真的移动并修补」（用户四连问的端到端回归防线）：
 * 注入存档（关羽出征落位 (80,136)、受损太鼓台 (80,133) 相距 3 格）→ 继续进度 →
 * 点设施 → 设施菜单「委任修补」→ 确认（当旬即执行一步，本旬行动完不显示任何字）→ 右键推旬 → 断言部队已到设施旁。
 * jsdom 已验证引擎链路，此 spec 排除「用户端旧代码 / 真实地图数据差异」两类嫌疑。
 * fixture 缺失时先跑：node node_modules/vitest/vitest.mjs run src/game/e2e-repair-fixture.test.ts
 */
test('出征部队下修补委任后，推旬会自动走向设施', async ({ page }) => {
  const autosave = readFileSync('e2e/.tmp-autosave.json', 'utf8');
  await page.addInitScript(([save]) => {
    window.localStorage.setItem('jingxiang-208-auth-session-v1', JSON.stringify({
      token: 'test-token', userId: 'test-user', username: 'tester',
    }));
    window.localStorage.setItem('jingxiang-208-autosave-v1', save!);
  }, [autosave] as unknown as string[]);

  await page.goto('/');
  await page.getByRole('button', { name: '继续上次进度' }).click();
  await expect(page.getByTestId('battle-grid-overlay')).toBeVisible();

  const unitPositionBefore = await page.getByTestId('battle-unit-marker')
    .first()
    .getAttribute('data-grid-position');
  console.log('[e2e] unit before:', unitPositionBefore);
  expect(unitPositionBefore).toBe('80,136');

  // 点设施（SVG onPointerDown；主地图/小地图/势力图各渲染一份 data-facility-id，取可见的那个）
  const facility = page.locator('[data-facility-id="repair-target"]:visible').first();
  await expect(facility).toHaveCount(1);
  const facilityBox = (await facility.boundingBox())!;
  await page.mouse.click(facilityBox.x + facilityBox.width / 2, facilityBox.y + facilityBox.height / 2);
  await expect(page.getByTestId('facility-context-menu')).toBeVisible();
  await page.getByTestId('facility-repair-button').click();

  // 确认弹窗只有标题与「是/否」，不带任何说明文字
  await expect(page.getByTestId('repair-confirm-menu')).toBeVisible();
  await expect(page.getByTestId('repair-confirm-note')).toHaveCount(0);
  await page.getByTestId('repair-confirm-yes').click();
  await expect(page.getByTestId('repair-confirm-menu')).toHaveCount(0);

  // 确认当旬：出征落位还剩出征移动力，委任立即执行一步 —— 本旬行动完不显示任何字（下一旬旬初恢复亮色「委」）
  const positionAfterConfirm = await page.getByTestId('battle-unit-marker')
    .first()
    .getAttribute('data-grid-position');
  console.log('[e2e] unit after confirm:', positionAfterConfirm);
  await expect(page.getByTestId("battle-unit-ready-badge")).toHaveCount(0);

  // 右键推旬（避开左上工具按钮组：取地图 45% / 20% 处，同 game.spec.ts）
  const mapBox = (await page.getByTestId('map-viewport').boundingBox())!;
  const contextPoint = { x: mapBox.width * 0.45, y: mapBox.height * 0.2 };
  await page.getByTestId('map-viewport').click({ button: 'right', position: contextPoint });
  await page.getByTestId('map-context-proceed-button').click();
  await expect(page.getByTestId('map-context-menu')).toHaveCount(0);

  // 部队必须已走到设施旁：delegateMoveStep 一次走满（移动力允许时直达设施邻格），而非每旬一格。
  // (80,136) 出征落位 → 推一旬 → (80,134)（设施 (80,133) 的相邻格，下一旬起就地修补）。
  const unitPositionAfter = await page.getByTestId('battle-unit-marker')
    .first()
    .getAttribute('data-grid-position');
  console.log('[e2e] unit after one ten-day:', unitPositionAfter);
  expect(unitPositionAfter).toBe('80,134');

  await page.screenshot({ path: 'e2e/.tmp-repair-after-advance.png', fullPage: false });
});
