/**
 * 重建事实 v2:
 * B) 4 条目 cell-major 11 平面分布 + 血色A vs 原版A 各平面差异
 * C) 城市基座扫描 (原版A p0/段0): order×flipY×base, 按 bt 分组评分
 * D) Scenario1 城市原始字段抽查
 */
const fs = require('fs');

const MOD = 'C:/san11/xsyg/xsyg6/xsyg6/San11Pk/Media/san11pkres.bin';
const VAN = 'C:/san11/san11_原版/San11/Media/san11pkres.bin';
const N = 40000, HDR = 8, SIZE = HDR + N * 11;

function readEntry(file, off) {
  const f = fs.openSync(file, 'r');
  const buf = Buffer.alloc(SIZE);
  fs.readSync(f, buf, 0, SIZE, off);
  fs.closeSync(f);
  return buf;
}

console.log('== D) Scenario1 城市字段抽查 ==');
const scen = JSON.parse(fs.readFileSync('tools/xsyg_map/Scenario1.json', 'utf8'));
const raw = Object.values(scen.citySet).slice(0, 3);
console.log(JSON.stringify(raw, null, 1).slice(0, 600));

const allCities = Object.values(scen.citySet).map((c) => ({ x: c.x, y: c.y, bt: c.BuildingType }));
const btCount = {};
for (const c of allCities) btCount[c.bt] = (btCount[c.bt] ?? 0) + 1;
console.log('  城市数:', allCities.length, ' bt分布:', btCount);

console.log('\n== B) cell-major 11 平面分布 ==');
const entries = {
  血色A: readEntry(MOD, 0x20a40cb7),
  血色B: readEntry(MOD, 0x26800119),
  原版A: readEntry(VAN, 0x1f520cb7),
  原版B: readEntry(VAN, 0x252e0119),
};
const planesOf = {};
for (const [name, buf] of Object.entries(entries)) {
  planesOf[name] = [];
  for (let p = 0; p < 11; p++) {
    const a = new Uint8Array(N);
    for (let i = 0; i < N; i++) a[i] = buf[HDR + i * 11 + p];
    planesOf[name].push(a);
  }
  console.log(`  ${name} 头部=${buf.toString('ascii', 0, 8)}`);
  for (let p = 0; p < 11; p++) {
    const dist = {};
    for (const v of planesOf[name][p]) dist[v] = (dist[v] ?? 0) + 1;
    const top = Object.entries(dist).sort((x, y) => y[1] - x[1]).slice(0, 5);
    console.log(`    p${p}: ${top.map(([v, c]) => `${v}×${c}`).join(' ')} (值种=${Object.keys(dist).length})`);
  }
}

console.log('\n== B2) 血色A vs 原版A 各平面差异格数 ==');
for (let p = 0; p < 11; p++) {
  let d = 0;
  for (let i = 0; i < N; i++) if (planesOf['血色A'][p][i] !== planesOf['原版A'][p][i]) d++;
  console.log(`  p${p}: ${d}/${N} (${(d / N * 100).toFixed(1)}%)`);
}

console.log('\n== C) 城市基座扫描 ==');
const VAN_P0 = planesOf['原版A'][0];
const VAN_SEG0 = entries['原版A'].subarray(HDR, HDR + N);
const bases = { 'cell-p0': VAN_P0, 'plane-段0': VAN_SEG0 };

for (const [bname, base] of Object.entries(bases)) {
  const results = [];
  for (const order of ['col', 'row']) {
    for (const flipY of [false, true]) {
      for (let bx = 0; bx <= 80; bx++) {
        for (let by = 0; by <= 80; by++) {
          const byBt = {};
          let inMap = 0;
          for (const c of allCities) {
            let x = c.x - bx, y = c.y - by;
            if (flipY) y = 199 - y;
            if (x < 0 || x >= 200 || y < 0 || y >= 200) continue;
            inMap++;
            const i = order === 'col' ? x * 200 + y : y * 200 + x;
            (byBt[c.bt] ??= {})[base[i]] = (byBt[c.bt][base[i]] ?? 0) + 1;
          }
          let score = 0;
          const detail = [];
          for (const [bt, t] of Object.entries(byBt)) {
            const top = Object.entries(t).sort((a, b) => b[1] - a[1])[0];
            score += top[1];
            detail.push(`bt${bt}:${top.join('×')}`);
          }
          results.push({ order, flipY, bx, by, score, detail: detail.join(' '), inMap });
        }
      }
    }
  }
  results.sort((a, b) => b.score - a.score);
  console.log(`  底图=${bname} top10 (满分=${allCities.length}):`);
  for (const r of results.slice(0, 10)) {
    console.log(`    ${r.order} flipY=${r.flipY ? 1 : 0} base=(${r.bx},${r.by}) 分=${r.score} 城内=${r.inMap} [${r.detail}]`);
  }
}
