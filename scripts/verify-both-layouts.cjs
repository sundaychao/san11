/**
 * 终极布局验证: cell-major vs plane-major, 血色/原版 4 个条目全对比
 */
const fs = require('fs');

const N = 40000, HDR = 8, SIZE = HDR + N * 11;
const FILES = {
  mod: 'C:/san11/xsyg/xsyg6/xsyg6/San11Pk/Media/san11pkres.bin',
  vanilla: 'C:/san11/san11_原版/San11/Media/san11pkres.bin',
};
const OFFSETS = {
  '血色A(0x20a40cb7)': { file: FILES.mod, off: 0x20a40cb7 },
  '血色B(0x26800119)': { file: FILES.mod, off: 0x26800119 },
  '原版A(0x1f520cb7)': { file: FILES.vanilla, off: 0x1f520cb7 },
  '原版B(0x252e0119)': { file: FILES.vanilla, off: 0x252e0119 },
};

const scen = JSON.parse(fs.readFileSync('tools/xsyg_map/Scenario1.json', 'utf8'));
const cities = Object.values(scen.citySet)
  .map((c) => ({ q: c.x - 28, r: c.y - 28, bt: c.BuildingType }))
  .filter((c) => c.q >= 0 && c.q < 200 && c.r >= 0 && c.r < 200);
const colCities = cities.map((c) => ({ i: c.q * 200 + c.r, bt: c.bt }));
const rowCities = cities.map((c) => ({ i: c.r * 200 + c.q, bt: c.bt }));

function readEntry(name) {
  const { file, off } = OFFSETS[name];
  const buf = Buffer.alloc(SIZE);
  const fd = fs.openSync(file, 'r');
  fs.readSync(fd, buf, 0, SIZE, off);
  fs.closeSync(fd);
  return buf;
}

function distTop(a, topn = 6) {
  const d = {};
  for (const v of a) d[v] = (d[v] ?? 0) + 1;
  return Object.entries(d).sort((x, y) => y[1] - x[1]).slice(0, topn)
    .map(([v, c]) => `${v}×${c}`).join(' ') + ` (值种=${Object.keys(d).length})`;
}

function cityTally(a, list) {
  const t = {};
  for (const c of list) { const v = a[c.i]; t[v] = (t[v] ?? 0) + 1; }
  return Object.entries(t).sort((x, y) => y[1] - x[1]).slice(0, 3)
    .map(([v, c]) => `${v}×${c}`).join(' ');
}

const entries = {};
for (const name of Object.keys(OFFSETS)) {
  const buf = readEntry(name);
  entries[name] = buf;
  const sig = buf.toString('ascii', 0, 8);
  console.log(`\n===== ${name} 头部=${sig} =====`);
  console.log(`  plane-major 各段 (每段40000字节) top 分布:`);
  for (let s = 0; s < 11; s++) {
    const seg = buf.subarray(HDR + s * N, HDR + (s + 1) * N);
    console.log(`    段${s}: ${distTop(seg)}`);
  }
  console.log(`  plane-major 城市落值:`);
  for (let s = 0; s < 11; s++) {
    const seg = buf.subarray(HDR + s * N, HDR + (s + 1) * N);
    const cl = cityTally(seg, colCities);
    const rl = cityTally(seg, rowCities);
    if (cl !== '0×1 ' || rl !== '0×1 ') {}
    console.log(`    段${s}: 列序[${cl}]  行序[${rl}]`);
  }
}

console.log('\n===== 两两全条目差异 =====');
const names = Object.keys(OFFSETS);
for (let a = 0; a < names.length; a++) {
  for (let b = a + 1; b < names.length; b++) {
    const A = entries[names[a]], B = entries[names[b]];
    let d = 0;
    for (let i = 0; i < SIZE; i++) if (A[i] !== B[i]) d++;
    console.log(`  ${names[a]} vs ${names[b]}: ${d}/${SIZE} 差异`);
  }
}
