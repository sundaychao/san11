import { expect, test } from '@playwright/test';

test('plays, restores, and completes the Jingxiang scenario', async ({ page }, testInfo) => {
  await page.goto('/');
  await page.getByRole('button', { name: '选择刘备' }).click();

  const mapImage = page.getByTestId('map-image');
  await expect(mapImage).toBeVisible();
  expect(await mapImage.evaluate((image: HTMLImageElement) => image.naturalWidth)).toBeGreaterThan(0);
  expect(await page.getByTestId('city-marker').count()).toBe(8);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(await page.evaluate(() => document.documentElement.clientWidth));

  if (testInfo.project.name === 'mobile-390') {
    await page.getByRole('button', { name: '收起城市面板' }).click();
    await page.getByRole('button', { name: /零陵.*刘表/ }).click();
    await expect(page.getByRole('heading', { name: '零陵' })).toBeVisible();
    await page.getByRole('button', { name: '展开城市面板' }).click();
  }

  const mapBox = await page.getByTestId('map-viewport').boundingBox();
  expect(mapBox).not.toBeNull();
  for (const marker of await page.getByTestId('city-marker').all()) {
    const markerBox = await marker.boundingBox();
    expect(markerBox).not.toBeNull();
    expect(markerBox!.x).toBeGreaterThanOrEqual(mapBox!.x);
    expect(markerBox!.x + markerBox!.width).toBeLessThanOrEqual(mapBox!.x + mapBox!.width);
    expect(markerBox!.y).toBeGreaterThanOrEqual(mapBox!.y);
    expect(markerBox!.y + markerBox!.height).toBeLessThanOrEqual(mapBox!.y + mapBox!.height);
  }

  await page.getByRole('button', { name: /江陵.*刘备/ }).click();
  await page.getByRole('button', { name: '巡察', exact: true }).click();
  await page.getByLabel('执行武将').selectOption('liu-bei');
  await page.getByRole('button', { name: '执行巡察' }).click();
  await expect(page.getByTestId('action-points')).toHaveText('65');

  await page.reload();
  await page.getByRole('button', { name: '继续游戏' }).click();
  await expect(page.getByTestId('action-points')).toHaveText('65');

  for (let month = 1; month <= 24; month += 1) {
    await page.getByRole('button', { name: '进行到下月' }).click();
    const confirm = page.getByRole('button', { name: '确认进行' });
    if (await confirm.isVisible()) await confirm.click();
  }

  await expect(page.getByRole('heading', { name: '荆襄国力结算' })).toBeVisible();
  await expect(page.getByRole('button', { name: '重新开局' })).toBeEnabled();
  await expect(page.getByRole('button', { name: '查看最终地图' })).toBeEnabled();
  await page.getByRole('button', { name: '查看最终地图' }).click();
  await expect(page.getByRole('button', { name: '返回结算' })).toBeVisible();
  await page.getByRole('button', { name: '返回结算' }).click();
  await expect(page.getByRole('heading', { name: '荆襄国力结算' })).toBeVisible();
});
