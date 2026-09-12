import { expect, test } from '@playwright/test';

// 关隘可点性回归防护。
// jsdom 没有布局、fireEvent 会绕过命中检测，所以「关隘有没有可点区域」只能在真浏览器里证：
// 这里断言关隘所在屏幕坐标的最上层元素就是关隘 footprint 本身。
// 曾经 footprint 带内联 pointer-events:none、标记又是 pointer-events:none，
// 导致关隘可点区域为零，点关隘完全没反应。
// 窄视口（≤700px）会隐藏小地图，而本用例靠小地图把关隘移进视口；
// 关隘可点性与视口宽度无关，桌面端覆盖即可。
test.skip(({ viewport }) => (viewport?.width ?? 0) <= 700, '窄视口隐藏小地图，无法用它把关隘移进视口');

test('pass footprint is the real hit target', async ({ page }) => {
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

  // 取第一个小地图关隘点：它的位置就是该关隘的归一化坐标，点它即可把镜头跳过去。
  // 不写死具体关隘坐标，地图数据重生成也不会失效。
  const dot = page.locator('.mini-pass-dot').first();
  const dotBox = (await dot.boundingBox())!;
  const miniMapBox = (await page.getByTestId('mini-map').boundingBox())!;
  await page.mouse.click(dotBox.x + dotBox.width / 2, dotBox.y + dotBox.height / 2);
  // 小地图必须真的接收到了这次点击（点在面板范围内）
  expect(dotBox.x).toBeGreaterThanOrEqual(miniMapBox.x);
  expect(dotBox.y).toBeGreaterThanOrEqual(miniMapBox.y);

  const footprint = page.locator('[data-testid^="pass-footprint-"]').first();
  await expect(footprint).toBeVisible();
  const box = (await footprint.boundingBox())!;

  const hit = await page.evaluate(([x, y]) => {
    const el = document.elementFromPoint(x, y) as Element | null;
    return el ? {
      testid: el.getAttribute('data-testid'),
      pointerEvents: getComputedStyle(el).pointerEvents,
    } : null;
  }, [box.x + box.width / 2, box.y + box.height / 2] as const);

  expect(hit?.testid).toMatch(/^pass-footprint-/);
  expect(hit?.pointerEvents).not.toBe('none');
});
