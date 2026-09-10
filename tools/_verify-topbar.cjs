const { chromium } = require('@playwright/test');

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await page.addInitScript(() => {
    localStorage.setItem('jingxiang-208-auth-token-v1', 'stub-token');
    localStorage.setItem('jingxiang-208-auth-session-v1', JSON.stringify({ token: 'stub-token', userId: 'u1', username: 'shot' }));
  });
  await page.goto('http://localhost:5173/', { waitUntil: 'load' });
  await page.waitForTimeout(1800);

  const startNew = page.getByTestId('start-new');
  if (await startNew.count()) {
    await startNew.click();
    await page.waitForTimeout(900);
  }
  await page.getByTestId('map-card-china42x').click();
  await page.waitForTimeout(900);
  await page.locator('.force-select-screen button').nth(1).click();
  await page.waitForTimeout(2500);

  const info = await page.evaluate(() => {
    const bar = document.querySelector('.top-bar');
    const battle = document.querySelector('.battle-panel');
    return {
      topBarButtons: bar ? [...bar.querySelectorAll('button')].map((b) => b.textContent.trim()) : null,
      battlePanelText: battle ? battle.textContent.trim() : null,
      removed: {
        officer: Boolean(document.querySelector('[data-testid="open-officer-list-button"]')),
        endTenDay: Boolean(document.querySelector('[data-testid="end-ten-day-button"]')),
        endMonth: Boolean(document.querySelector('[data-testid="end-month-button"]')),
        quickDeploy: Boolean(document.querySelector('[data-testid="quick-deploy-button"]')),
        saveIcon: Boolean(document.querySelector('.top-actions .icon-button')),
      },
    };
  });
  console.log('UI', JSON.stringify(info));

  // 右键菜单仍能推进回合
  await page.getByTestId('map-viewport').click({ button: 'right', position: { x: 40, y: 40 } });
  await page.waitForTimeout(300);
  const proceed = await page.getByTestId('map-context-proceed-button').count();
  console.log('PROCEED_IN_MENU', proceed);
  const before = await page.getByTestId('ten-day-label').textContent();
  if (proceed) {
    await page.getByTestId('map-context-proceed-button').click();
    await page.waitForTimeout(600);
  }
  const after = await page.getByTestId('ten-day-label').textContent();
  console.log('TENDAY', before, '->', after);

  await page.screenshot({ path: 'tools/_ui.png' });
  await browser.close();
})();
