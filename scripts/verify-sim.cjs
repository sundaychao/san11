const { chromium } = require('playwright');
const path = require('path');

const FILE = 'file:///' + path.resolve(__dirname, '..', 'damage-simulator.html').replace(/\\/g, '/');

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 1200 } });
  const errors = [];
  page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('CONSOLE: ' + m.text()); });

  await page.goto(FILE);
  await page.waitForTimeout(400);

  const snap = async (label) => {
    const v = await page.evaluate(() => ({
      num: document.getElementById('finalNum').textContent,
      note: document.getElementById('finalNote').textContent.slice(0, 60),
      rows: [...document.querySelectorAll('#steps tr')].map(tr =>
        [...tr.querySelectorAll('td')].map(td => td.textContent).join(' | ')),
      lbl: document.getElementById('finalLbl').textContent,
    }));
    console.log('\n===== ' + label + ' =====');
    console.log('[' + v.lbl + '] ' + v.num);
    v.rows.forEach(r => console.log('  ' + r));
    return v;
  };

  const base = await snap('默认 · 普通攻击（骑兵10000/统80/武80 vs 统80 平原）');
  console.log('\n期望 827，实得', base.num);

  await page.click('[data-preset="remnant"]');
  await page.waitForTimeout(200);
  const rem = await snap('残兵部队（40 兵）');
  console.log('\n期望 15，实得', rem.num);

  await page.click('[data-preset="crossbow"]');
  await page.waitForTimeout(200);
  const cb = await snap('弩兵乱射（适性A·距离2·训练）');
  console.log('\n期望 1172，实得', cb.num);

  await page.click('[data-preset="weak"]');
  await page.waitForTimeout(200);
  const wk = await snap('弱将打强将（统率差+丘陵+阵+防具精造+免伤）');

  await page.click('[data-preset="joint"]');
  await page.waitForTimeout(200);
  const jt = await snap('三队齐攻（砦）');

  await page.click('[data-mode="counter"]');
  await page.waitForTimeout(200);
  await snap('反击模式');

  await page.click('[data-mode="tactic"]');
  await page.waitForTimeout(200);
  await snap('战法模式 · C 适性（应提示不可发动）');

  await page.selectOption('#aptitude', 'C');
  await page.waitForTimeout(200);
  const cApt = await page.evaluate(() => document.getElementById('tacticNote').textContent);
  console.log('\nC 适性提示:', cApt.trim());

  await page.screenshot({ path: 'sim-shot.png', fullPage: true });

  console.log('\n===== 错误 =====');
  console.log(errors.length ? errors.join('\n') : '无');

  await browser.close();
})();
