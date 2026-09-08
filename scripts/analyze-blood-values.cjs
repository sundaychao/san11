/**
 * 血色A p0 全值语义分析:
 * 1) 原版/血色 p0 全值连通块统计 -> 找"城市状"紧凑团块的值
 * 2) JSON 建筑位置 (x-28,y-28) 处 3x3 邻域落值检验
 * 3) 血色值 -> 原版值 混淆矩阵 (语义推断)
 */
const fs = require('fs');

const MOD = 'C:/san11/xsyg/xsyg6/xsyg6/San11Pk/Media/san11pkres.bin';
const VAN = 'C:/san11/san11_原版/San11/Media/san11pkres.bin';
const N = 40000, HDR = 8, CELL = 11, W = 200, H = 200;

function readP0(file, off) {
  const fd = fs.openSync(file, 'r');
  const buf = Buffer.alloc(HDR + N * CELL);
  fs.readSync(fd, buf, 0, buf.length, off);
  fs.closeSync(fd);
  const a = new Uint8Array(N);
  for (let i = 0; i < N; i++) a[i] = buf[HDR + i * CELL];
  return a;
}

const blood = readP0(MOD, 0x20a40cb7);
const vanilla = readP0(VAN, 0x1f520cb7);

function blobsOf(arr, target) {
  const seen = new Uint8Array(N);
  const out = [];
  for (let i = 0; i < N; i++) {
    if (arr[i] !== target || seen[i]) continue;
    const q = [i]; seen[i] = 1;
    const cells = [];
    while (q.length) {
      const c = q.pop(); cells.push(c);
      const x = Math.floor(c / H), y = c % H;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || nx >= W || ny < 0 || ny >= H) continue;
        const ni = nx * H + ny;
        if (!seen[ni] && arr[ni] === target) { seen[ni] = 1; q.push(ni); }
      }
    }
    let sx = 0, sy = 0;
    for (const c of cells) { sx += Math.floor(c / H); sy += c % H; }
    out.push({ size: cells.length, cx: sx / cells.length, cy: sy / cells.length });
  }
  out.sort((a, b) => b.size - a.size);
  return out;
}

function summarize(arr, label) {
  const dist = {};
  for (const v of arr) dist[v] = (dist[v] ?? 0) + 1;
  const vals = Object.keys(dist).map(Number).sort((a, b) => dist[b] - dist[a]);
  console.log(`\n== ${label} p0 值统计 (${vals.length} 种) ==`);
  console.log(vals.map(v => `v${v}:${dist[v]}`).join(' '));
  console.log('\n值 | 总格数 | 团块数 | >=4格 | >=10格 | 最大块 | 最大块中心');
  for (const v of vals) {
    const bs = blobsOf(arr, v);
    const ge4 = bs.filter(b => b.size >= 4).length;
    const ge10 = bs.filter(b => b.size >= 10).length;
    const top = bs[0];
    console.log(`v${v} | ${dist[v]} | ${bs.length} | ${ge4} | ${ge10} | ${top ? top.size : 0} | ${top ? `(${Math.round(top.cx)},${Math.round(top.cy)})` : '-'}`);
  }
  return vals;
}

const vanVals = summarize(vanilla, '原版A');
const bloodVals = summarize(blood, '血色A');

// JSON 建筑位置落值检验 (3x3 邻域)
console.log('\n== JSON 建筑位置 (x-28,y-28) 3x3 邻域落值 ==');
const scen = JSON.parse(fs.readFileSync('tools/xsyg_map/Scenario1.json', 'utf8'));
const builds = Object.values(scen.citySet).map(c => ({ x: c.x, y: c.y, bt: c.BuildingType }));
for (const [arr, name] of [[blood, '血色'], [vanilla, '原版']]) {
  const tally = {};
  for (const b of builds) {
    const gx = b.x - 28, gy = b.y - 28;
    if (gx < 0 || gx >= 200 || gy < 0 || gy >= 200) continue;
    const t = tally[b.bt] ??= {};
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
      const nx = gx + dx, ny = gy + dy;
      if (nx < 0 || nx >= 200 || ny < 0 || ny >= 200) continue;
      const v = arr[nx * 200 + ny];
      t[v] = (t[v] ?? 0) + 1;
    }
  }
  console.log(`  [${name}]`);
  for (const [bt, t] of Object.entries(tally)) {
    const top = Object.entries(t).sort((a, b) => b[1] - a[1]).slice(0, 8);
    console.log(`    bt=${bt}: ${top.map(([v, c]) => `v${v}×${c}`).join(' ')}`);
  }
}

// 混淆矩阵: 血色值 -> 原版值 分布 (只看格数>=300的血色值)
console.log('\n== 混淆矩阵: 血色值 -> 原版值 top3 ==');
const confusion = {};
for (let i = 0; i < N; i++) {
  const bv = blood[i], vv = vanilla[i];
  (confusion[bv] ??= {})[vv] = (confusion[bv][vv] ?? 0) + 1;
}
const bloodCount = {};
for (const v of blood) bloodCount[v] = (bloodCount[v] ?? 0) + 1;
for (const bv of Object.keys(confusion).map(Number).sort((a, b) => bloodCount[b] - bloodCount[a])) {
  if (bloodCount[bv] < 300) continue;
  const t = Object.entries(confusion[bv]).sort((a, b) => b[1] - a[1]).slice(0, 3);
  const total = bloodCount[bv];
  console.log(`  血色v${bv} (${total}格): ${t.map(([vv, c]) => `原版v${vv} ${(c / total * 100).toFixed(0)}%`).join(', ')}`);
}
