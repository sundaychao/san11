/**
 * 锚点法对齐: 血色地图byte0 + Scenario1.json 建筑坐标
 * 暴力搜索平移偏移 (bx, by)，使同类建筑(都市/关/港)中心尽量落在同一地形值上
 */
const fs = require('fs');

const N = 200 * 200, CELL = 11, HEADER = 8;
const MOD = 'C:/san11/xsyg/xsyg6/xsyg6/San11Pk/Media/san11pkres.bin';
const MAP_OFF = 0x20a40cb7;

const fd = fs.openSync(MOD, 'r');
const buf = Buffer.alloc(HEADER + N * CELL);
fs.readSync(fd, buf, 0, buf.length, MAP_OFF);
fs.closeSync(fd);
if (buf.toString('ascii', 0, 8) !== 'SHEX0008') throw new Error('头不对');
const t = new Uint8Array(N);
for (let i = 0; i < N; i++) t[i] = buf[HEADER + i * CELL];

const scen = JSON.parse(fs.readFileSync('tools/xsyg_map/Scenario1.json', 'utf8'));
const cities = Object.values(scen.citySet);
const byType = {};
for (const c of cities) (byType[c.BuildingType] ??= []).push(c);
console.log('BuildingType 数量:', Object.fromEntries(Object.entries(byType).map(([k, v]) => [k, v.length])));

// 坐标范围
let minX = 1e9, maxX = -1e9, minY = 1e9, maxY = -1e9;
for (const c of cities) {
  if (c.x < minX) minX = c.x; if (c.x > maxX) maxX = c.x;
  if (c.y < minY) minY = c.y; if (c.y > maxY) maxY = c.y;
}
console.log(`场景坐标范围: x=[${minX},${maxX}] y=[${minY},${maxY}]`);

/** 评估某个变换 fun(c)->[q,r] 的聚类纯度 */
function evaluate(fun, label) {
  let score = 0;
  const detail = {};
  for (const [type, list] of Object.entries(byType)) {
    const tally = {};
    let inb = 0;
    for (const c of list) {
      const [q, r] = fun(c);
      if (q < 0 || q >= 200 || r < 0 || r >= 200) continue;
      inb++;
      const v = t[q * 200 + r];
      tally[v] = (tally[v] ?? 0) + 1;
    }
    if (inb !== list.length) { detail[type] = { 越界: list.length - inb }; continue; }
    const [val, cnt] = Object.entries(tally).sort((a, b) => b[1] - a[1])[0];
    detail[type] = { val: +val, 主导: cnt, 共: inb, 纯度: (cnt / inb * 100).toFixed(0) + '%' };
    score += cnt / inb;
  }
  return { score, detail, label };
}

const results = [];
// 变换1: q=x-bx, r=y-by
for (let bx = 10; bx <= 60; bx++) {
  for (let by = 10; by <= 60; by++) {
    results.push(evaluate((c) => [c.x - bx, c.y - by], `平移(${bx},${by})`));
  }
}
// 变换2: q=y-by, r=x-bx (轴交换)
for (let bx = 10; bx <= 60; bx++) {
  for (let by = 10; by <= 60; by++) {
    results.push(evaluate((c) => [c.y - by, c.x - bx], `轴交换(${bx},${by})`));
  }
}

results.sort((a, b) => b.score - a.score);
console.log('\n== Top 10 偏移 ==');
for (const r of results.slice(0, 10)) {
  console.log(`${r.label} score=${r.score.toFixed(3)}`, JSON.stringify(r.detail));
}
