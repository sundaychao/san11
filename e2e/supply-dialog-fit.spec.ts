import { expect, test } from '@playwright/test';

// 运输队「补给」弹窗的布局回归防护（照 tech/transport-dialog-fit 模式）：
// 补给页是双面板 + 三条拖动条，必须一屏放得下、决定键不出视口。
// 前置链路较长：部署运输队 → 邻格部署战斗部队 → 推进一旬 → 开补给页，
// 每个视口一个独立用例（整链路 ~90s，塞进单 test 的循环会撞测试总超时）。

const MAX_DIALOG_WIDTH = 800;

const VIEWPORTS = [
  { name: '2k-2560x1440', width: 2560, height: 1440 },
  { name: 'desktop-1920x1080', width: 1920, height: 1080 },
  { name: 'desktop-1440x900', width: 1440, height: 900 },
];

/** 与 src/game/battle/grid.ts 的 neighborsOf 同一份六边形邻居公式 */
function neighborsOf(q: number, r: number): [number, number][] {
  if (q % 2 === 0) {
    return [[q, r - 1], [q, r + 1], [q - 1, r - 1], [q - 1, r], [q + 1, r - 1], [q + 1, r]];
  }
  return [[q, r - 1], [q, r + 1], [q - 1, r], [q - 1, r + 1], [q + 1, r], [q + 1, r + 1]];
}

for (const vp of VIEWPORTS) {
  test(`supply dialog fits on one screen [${vp.name}]`, async ({ page }) => {
    test.setTimeout(240_000);
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

    // 1) 从江陵输送一支运输队（主将明确选刘备，避免默认选将漂移）
    await page.locator('[data-testid^="city-footprint-jiangling-"]').first().click();
    let menu = page.getByTestId('city-command-menu');
    await menu.getByRole('button', { name: '军事' }).click();
    await menu.getByRole('button', { name: '输送' }).click();
    const transportDialog = page.getByRole('dialog', { name: '输送编制' });
    await expect(transportDialog).toBeVisible();
    await transportDialog.getByTestId('transport-officer-trigger').click();
    const transportPicker = page.getByRole('dialog', { name: '武将选择' });
    await transportPicker.getByLabel('选择刘备为主将').click();
    await transportPicker.getByRole('button', { name: '确定武将' }).click();
    await transportDialog.getByLabel('输送士兵').fill('1000');
    await transportDialog.getByRole('button', { name: '确定输送' }).click();
    await page.locator('[data-testid^="deploy-target-"]').first().click();
    // 落位后与出征一致弹出命令菜单，点「待命」才真正出城
    await page.getByTestId('unit-command-menu').getByRole('button', { name: '待命' }).click();
    const transportMarker = page.locator('[data-testid="battle-unit-marker"][data-unit-kind="transport"]');
    await expect(transportMarker).toBeVisible();
    const [tq, tr] = (await transportMarker.getAttribute('data-grid-position'))!.split(',').map(Number);

    // 2) 从江陵出征一支战斗部队，落在运输队邻格
    // 注意：出征落位复用普通移动的高亮，格子 testid 是 move-target-*（deploy-target-* 只用于输送）
    await page.locator('[data-testid^="city-footprint-jiangling-"]').first().click();
    menu = page.getByTestId('city-command-menu');
    await menu.getByRole('button', { name: '军事' }).click();
    await menu.getByRole('button', { name: '出征' }).click();
    const deployDialog = page.getByRole('dialog', { name: '出征编制' });
    await expect(deployDialog).toBeVisible();
    await deployDialog.getByRole('button', { name: '选择武将' }).click();
    const deployPicker = page.getByRole('dialog', { name: '武将选择' });
    await deployPicker.getByLabel('选择关羽为主将').click();
    await deployPicker.getByRole('button', { name: '确定武将' }).click();
    await deployDialog.getByRole('button', { name: '确定出征' }).click();
    const neighborIds = new Set(neighborsOf(tq, tr).map(([q, r]) => `move-target-${q}-${r}`));
    const adjacentId = await page.locator('[data-testid^="move-target-"]').evaluateAll((cells, ids: string[]) => {
      const hit = cells.find((cell) => ids.includes(cell.getAttribute('data-testid') ?? ''));
      return hit ? hit.getAttribute('data-testid') : null;
    }, [...neighborIds])
      ?? (await page.locator('[data-testid^="move-target-"]').first().getAttribute('data-testid'));
    await page.locator(`[data-testid="${adjacentId}"]`).click();
    // 落点点击后弹出出征 followup 菜单，点「待命」完成落地
    await page.getByTestId('unit-command-menu').getByRole('button', { name: '待命' }).click();
    const combatMarker = page.locator('[data-testid="battle-unit-marker"][data-troop-type]:not([data-unit-kind="transport"])');
    await expect(combatMarker.first()).toBeVisible();

    // 刚部署的部队 moved=true，本旬不能再行动：推进一旬回到刘备回合。
    // 「进行」一次即整旬结算（含全部 AI 势力），结束后回到玩家回合。
    // 右键要落在开阔地块上，避开部队/城池/侧栏（点中单位会弹部队情报而非地图命令菜单）。
    const view = await page.getByTestId('map-viewport').boundingBox();
    if (!view) throw new Error('找不到地图视口');
    let proceeded = false;
    for (let attempt = 0; attempt < 4 && !proceeded; attempt += 1) {
      await page.mouse.click(view.x + view.width * 0.5, view.y + view.height * 0.8, { button: 'right' });
      const proceed = page.getByTestId('map-context-proceed-button');
      if (await proceed.isVisible().catch(() => false)) {
        await proceed.click();
        proceeded = true;
      }
    }
    if (!proceeded) throw new Error('地图命令菜单未打开，无法推进旬');
    await expect(transportMarker).toBeVisible();

    // 3) 选中运输队 → 命令菜单 → 补给
    // 两支部队相邻且图形重叠，物理点击会落到下层部队上：直接对运输队标记派发 pointerdown
    const markerBox = await transportMarker.boundingBox();
    if (!markerBox) throw new Error('找不到运输队标记');
    const pointer = { button: 0, buttons: 1, clientX: markerBox.x + markerBox.width / 2, clientY: markerBox.y + markerBox.height / 2 };
    await transportMarker.dispatchEvent('pointerdown', pointer);
    await transportMarker.dispatchEvent('pointerdown', pointer);
    const supplyButton = page.getByTestId('unit-command-supply');
    await expect(supplyButton).toBeEnabled();
    await supplyButton.click();

    // 选目标模式：可补给部队头顶出现箭头，点击部队标记才弹补给页
    const supplyArrow = page.locator('[data-testid="supply-target-arrow"]');
    await expect(supplyArrow.first()).toBeVisible();
    await combatMarker.first().dispatchEvent('pointerdown', pointer);

    const supplyDialog = page.getByRole('dialog', { name: '补给' });
    await expect(supplyDialog).toBeVisible();

    const measured = await page.evaluate(() => {
      const d = document.querySelector('.supply-dialog') as HTMLElement;
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
    expect(measured.scrollH, `${vp.name} 弹窗纵向滚动`).toBeLessThanOrEqual(measured.clientH + 2);
    expect(measured.submitTop, `${vp.name} 确认键顶部`).toBeGreaterThanOrEqual(0);
    expect(measured.submitBottom, `${vp.name} 确认键底部`).toBeLessThanOrEqual(vp.height);
  });
}
