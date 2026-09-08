/** 原版槽位11字节面 + 血色byte9与原版byte0的地理对应测试 */
const fs = require('fs');
const N = 200 * 200;
function readSlot(off) {
  const fd = fs.openSync('C:/san11/xsyg/xsyg6/xsyg6/San11Pk/Media/san11pkres.bin', 'r');
  const buf = Buffer.alloc(8 + N * 11);
  fs.readSync(fd, buf, 0, buf.length, off);
  fs.closeSync(fd);
  const planes = [];
  for (let p = 0; p < 11; p++) {
    const t = new Uint8Array(N);
    for (let i = 0; i < N; i++) t[i] = buf[8 + i * 11 + p];
    planes.push(t);
  }
  return planes;
}
const van = readSlot(0x26800119);
const blood = readSlot(0x20a40cb7);

console.log('== 原版槽位 11 字节面 ==');
for (let p = 0; p < 11; p++) {
  const t = van[p];
  const dist = {};
  for (let i = 0; i < N; i++) dist[t[i]] = (dist[t[i]] ?? 0) + 1;
  const nvals = Object.keys(dist).length;
  const top = Object.entries(dist).sort((a, b) => b[1] - a[1]).slice(0, 4);
  console.log(`byte${p}: ${nvals}种 top=${top.map(([v, c]) => v + '×' + c).join(' ')}`);
}

// 血色byte9 vs 原版byte0
const b9 = blood[9], v0 = van[0];
let same = 0;
for (let i = 0; i < N; i++) if (b9[i] === v0[i]) same++;
console.log(`\n血色byte9 与 原版byte0 同位置相同率: ${(same / N * 100).toFixed(1)}%`);

// 血色byte9 交叉表 (是否原版地理重排)
const cross = {};
for (let i = 0; i < N; i++) (cross[b9[i]] ??= {})[v0[i]] = (cross[b9[i]][v0[i]] ?? 0) + 1;
console.log('血色byte9 → 原版byte0 (占比>30%才显示):');
for (const bv of Object.keys(cross).map(Number).sort((a, b) => a - b)) {
  const entries = Object.entries(cross[bv]).sort((a, b) => b[1] - a[1]);
  const total = entries.reduce((s, [, c]) => s + c, 0);
  const top = entries.filter(([v, c]) => c / total > 0.3);
  console.log(`  血9值${bv}(${total}格): ${top.length ? top.map(([v, c]) => `原${v}×${(c / total * 100).toFixed(0)}%`).join(' + ') : '无主导(' + entries.slice(0, 2).map(([v, c]) => v + '×' + (c / total * 100).toFixed(0) + '%').join(' ') + ')'}`);
}

// 血色byte9 上87建筑(暴力平移)
const scen = JSON.parse(fs.readFileSync('tools/xsyg_map/Scenario1.json', 'utf8'));
const byType = {};
for (const c of Object.values(scen.citySet)) (byType[c.BuildingType] ??= []).push(c);
let best = null;
for (let dx = -40; dx <= 40; dx++) {
  for (let dy = -40; dy <= 40; dy++) {
    let score = 0, out = {};
    let valid = true;
    for (const [type, list] of Object.entries(byType)) {
      const tally = {};
      for (const c of list) {
        const q = c.x - 28 + dx, r = c.y - 28 + dy;
        if (q < 0 || q >= 200 || r < 0 || r >= 200) { valid = false; break; }
        const v = b9[q * 200 + r];
        tally[v] = (tally[v] ?? 0) + 1;
      }
      if (!valid) break;
      const bestE = Object.entries(tally).sort((a, b) => b[1] - a[1])[0];
      out[type] = bestE[0] + '×' + bestE[1] + '/' + list.length;
      score += bestE[1] / list.length;
    }
    if (!valid) continue;
    if (!best || score > best.score) best = { dx, dy, score, out };
  }
}
console.log('\n血色byte9 建筑87落值最佳平移:', best ? `dx=${best.dx} dy=${best.dy} score=${best.score.toFixed(3)} ${JSON.stringify(best.out)}` : '无');
