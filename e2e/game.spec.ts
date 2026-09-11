import { expect, test } from '@playwright/test';

test('plays, restores, and completes the Jingxiang scenario', async ({ page }, testInfo) => {
  // 现在进游戏要先过账号登录 + 主菜单「重新开始新游戏」→ 选图 → 选势力，
  // 直接 goto 会停在登录页。写入会话绕过登录。
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
  // china42 全图共 42 座城池（关隘是独立的 pass-marker，不计入这里）
  expect(await page.getByTestId('city-marker').count()).toBe(42);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(await page.evaluate(() => document.documentElement.clientWidth));

  if (testInfo.project.name === 'mobile-390') {
    await page.getByRole('button', { name: '收起城市面板' }).click();
    await page.getByRole('button', { name: /零陵.*刘表/ }).click();
    await expect(page.getByRole('heading', { name: '零陵' })).toBeVisible();
    await page.getByRole('button', { name: '展开城市面板' }).click();
  }

  const mapBox = (await page.getByTestId('map-viewport').boundingBox())!;
  // china42 全图 42 座城，初始镜头只覆盖江陵周边，绝大多数城本来就在视口外，
  // 所以不能再断言「所有标记都在视口内」。这里校验的是标记定位正常：
  // 坐标有限、尺寸有效，且镜头至少能看到一座城（否则说明缩放/镜头出了问题）。
  let markersInViewport = 0;
  for (const marker of await page.getByTestId('city-marker').all()) {
    const markerBox = await marker.boundingBox();
    expect(markerBox).not.toBeNull();
    expect(Number.isFinite(markerBox!.x)).toBe(true);
    expect(Number.isFinite(markerBox!.y)).toBe(true);
    expect(markerBox!.width).toBeGreaterThan(0);
    expect(markerBox!.height).toBeGreaterThan(0);
    if (
      markerBox!.x >= mapBox.x &&
      markerBox!.x + markerBox!.width <= mapBox.x + mapBox.width &&
      markerBox!.y >= mapBox.y &&
      markerBox!.y + markerBox!.height <= mapBox.y + mapBox.height
    ) {
      markersInViewport += 1;
    }
  }
  expect(markersInViewport).toBeGreaterThan(0);

  // 城池名牌（city-marker）是 pointer-events:none 的装饰层，真正接收点击的是 footprint 色块，
  // 直接点名牌会被 Playwright 的可命中性检查拦下（footprint rect intercepts pointer events）。
  await page.locator('[data-testid^="city-footprint-jiangling-"]').first().click();
  // 城市指令菜单里该指令写作「巡查」，但指令弹窗标题沿用 COMMAND_LABELS 的「巡察」，
  // 确认按钮是「决定·巡察」。巡查属于多人执行指令，默认已自动推荐武将，
  // 不再有单人的「执行武将」下拉框，因此直接确认即可。
  await page.getByTestId('city-command-section-urban').click();
  await page.getByTestId('city-command-command-patrol').click();
  await page.getByRole('button', { name: '决定·巡察' }).click();
  await expect(page.getByTestId('action-points')).toHaveText('65');

  await page.reload();
  // 主菜单上恢复进度的按钮现在叫「继续上次进度」（自动存档存在时才渲染）
  await page.getByRole('button', { name: '继续上次进度' }).click();
  await expect(page.getByTestId('action-points')).toHaveText('65');

  // 顶栏的「进行·下月」已移除：改走地图右键菜单的「进行」，一旬一旬推进（下旬后自动进入下月）
  // 右键点必须避开覆盖层：左上角 14px 处是 .map-tools 缩放按钮组（点了会命中 button，
  // 地图右键处理会直接 return），右下角是小地图，左下是事件日志，右侧是势力概览。
  // 这里取地图区域中部偏上（45% 宽 / 20% 高），三种视口下都落在空地上。
  const mapRegionBox = (await page.getByTestId('map-viewport').boundingBox())!;
  const contextPoint = { x: mapRegionBox.width * 0.45, y: mapRegionBox.height * 0.2 };
  for (let tenDay = 1; tenDay <= 72; tenDay += 1) {
    await page.getByTestId('map-viewport').click({ button: 'right', position: contextPoint });
    await page.getByTestId('map-context-proceed-button').click();
  }

  await expect(page.getByRole('heading', { name: '荆襄国力结算' })).toBeVisible();
  await expect(page.getByRole('button', { name: '重新开局' })).toBeEnabled();
  await expect(page.getByRole('button', { name: '查看最终地图' })).toBeEnabled();
  await page.getByRole('button', { name: '查看最终地图' }).click();
  await expect(page.getByRole('button', { name: '返回结算' })).toBeVisible();
  await page.getByRole('button', { name: '返回结算' }).click();
  await expect(page.getByRole('heading', { name: '荆襄国力结算' })).toBeVisible();
});
