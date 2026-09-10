import { expect, test } from '@playwright/test';

// 临时验证：存档弹窗右侧信息是否跟随鼠标悬停的档位
test('存档弹窗悬停跟随', async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem(
      'jingxiang-208-auth-session-v1',
      JSON.stringify({ token: 'token', userId: 'host', username: 'Host' }),
    );
  });
  await page.goto('/');
  await page.getByRole('button', { name: '重新开始新游戏' }).click();
  await page.getByRole('button', { name: /荆襄地图/ }).click();
  await page.getByRole('button', { name: '选择刘备' }).click();
  await expect(page.getByTestId('battle-grid-overlay')).toBeVisible();

  const saveTo = async (slot: number, note: string) => {
    await page.getByTestId('map-viewport').click({ button: 'right', position: { x: 320, y: 240 } });
    await page.getByTestId('map-context-menu').getByRole('button', { name: '储存' }).click();
    const dialog = page.getByTestId('save-load-dialog');
    await expect(dialog).toBeVisible();
    await dialog.getByTestId(`save-slot-${slot}`).click();
    await page.getByTestId('save-confirm-note').fill(note);
    await page.getByTestId('save-confirm-submit').click();
    await expect(page.getByTestId('save-confirm')).toHaveCount(0);
    await dialog.getByTestId('save-dialog-back').click();
    await expect(dialog).toHaveCount(0);
  };

  await saveTo(3, '开局存档');
  await saveTo(7, '第二份存档');

  await page.getByTestId('map-viewport').click({ button: 'right', position: { x: 320, y: 240 } });
  await page.getByTestId('map-context-menu').getByRole('button', { name: '载入' }).click();
  const dialog = page.getByTestId('save-load-dialog');
  await expect(dialog).toBeVisible();

  // 默认停在最新存档 07
  await expect(dialog.getByTestId('save-detail-slot')).toHaveText('07');
  await page.screenshot({ path: 'docs/save-slots/05-悬停前-默认最新.png' });

  // 悬停 03 → 右侧切到 03，且出现悬停高亮
  await dialog.getByTestId('save-slot-3').hover();
  await expect(dialog.getByTestId('save-detail-slot')).toHaveText('03');
  await expect(dialog.getByText('开局存档')).toBeVisible();
  await expect(dialog.getByTestId('save-slot-3')).toHaveClass(/is-previewed/);
  await page.screenshot({ path: 'docs/save-slots/06-悬停03号-信息跟随.png' });

  // 移开 → 回落到 07
  await page.mouse.move(20, 20);
  await expect(dialog.getByTestId('save-detail-slot')).toHaveText('07');
  await expect(dialog.getByTestId('save-slot-3')).not.toHaveClass(/is-previewed/);
});
