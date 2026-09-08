/**
 * 1) 原版地图上 china42 城市中心的落值（验证据点是否覆盖地形）
 * 2) 血色地图: 8种方位变换(平移/翻转/轴交换)暴力搜最佳对齐
 */
const fs = require('fs');

const N = 200 * 200, CELL = 11, HEADER = 8;
function readMap(file, offset) {
  const fd = fs.openSync(file, 'r');
  const buf = Buffer.alloc(HEADER + N * CELL);
  fs.readSync(fd, buf, 0, buf.length, offset);
  fs.closeSync(fd);
  const t = new Uint8Array(N);
  for (let i = 0; i < N; i++) t[i] = buf[HEADER + i * CELL];
  return t;
}

const van = readMap('C:/san11/san11_原版/San11/Media/san11pkres.bin', 0x1f520cb7);
const blood = readMap('C:/san11/xsyg/xsyg6/xsyg6/San11Pk/Media/san11pkres.bin', 0x20a40cb7);

// ---- 1) 原版: china42 城市落值 ----
const china = JSON.parse(fs.readFileSync('public/maps/china42.json', 'utf8'));
const vanTally = {};
for (const c of china.cities) {
  const v = van[c.q * 200 + c.r];
  (vanTally[v] ??= []).push(c.label);
}
console.log('== 原版地图 china42 城市中心落值 ==');
for (const [v, names] of Object.entries(vanTally).sort((a, b) => b[1].length - a[1].length)) {
  console.log(`  值${v}: ${names.length}城 ${names.slice(0, 8).join(',')}${names.length > 8 ? '...' : ''}`);
}

// ---- 2) 血色: 方位变换暴力搜索 ----
const scen = JSON.parse(fs.readFileSync('tools/xsyg_map/Scenario1.json', 'utf8'));
const cities = Object.values(scen.citySet);
const byType = {};
for (const c of cities) (byType[c.BuildingType] ??= []).push(c);

/** 纯度评分: 同类建筑中心地形值聚类程度 */
function purity(fun) {
  let score = 0, out = {};
  for (const [type, list] of Object.entries(byType)) {
    const tally = {};
    let inb = 0;
    for (const c of list) {
      const [q, r] = fun(c);
      if (q < 0 || q >= 200 || r < 0 || r >= 200) continue;
      inb++;
      const v = blood[q * 200 + r];
      tally[v] = (tally[v] ?? 0) + 1;
    }
    if (inb !== list.length) return null;
    const [val, cnt] = Object.entries(tally).sort((a, b) => b[1] - a[1])[0];
    out[type] = `值${val} ${cnt}/${inb}`;
    score += cnt / inb;
  }
  return { score, out };
}

const results = [];
const R = 80; // 偏移搜索半径
for (let bx = -R; bx <= R; bx++) {
  for (let by = -R; by <= R; by++) {
    // 8种方位: (swap, flipX, flipY) 翻转常数待定 → 先用 200-b 形式近似试
    const cands = [
      [(c) => [c.x + bx, c.y + by], '平移'],
      [(c) => [c.x + bx, 199 - c.y + by], 'y翻转'],
      [(c) => [199 - c.x + bx, c.y + by], 'x翻转'],
      [(c) => [199 - c.x + bx, 199 - c.y + by], 'xy翻转'],
      [(c) => [c.y + by, c.x + bx], '轴交换'],
      [(c) => [c.y + by, 199 - c.x + bx], '轴交换+x翻转'],
      [(c) => [199 - c.y + by, c.x + bx], '轴交换+y翻转'],
      [(c) => [199 - c.y + by, 199 - c.x + bx], '轴交换+xy翻转'],
    ];
    for (const [fun, label] of cands) {
      const p = purity(fun);
      if (p) results.push({ bx, by, label, ...p });
    }
  }
}
results.sort((a, b) => b.score - a.score);
console.log('\n== 血色地图 Top 10 方位/偏移 ==');
for (const r of results.slice(0, 10)) {
  console.log(`${r.label} bx=${r.bx} by=${r.by} score=${r.score.toFixed(3)}`, JSON.stringify(r.out));
}
