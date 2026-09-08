/**
 * 决定性：
 * A) [4791] vs 原版 逐平面差异计数（哪些平面被血色改动）
 * B) [4791] 每个平面：42城/10关/35港 坐标处的值分布（找"建筑盖章"平面+值）
 *    若某平面某值 城42/42 → 该平面=地物类型平面, 该值=都市
 */
const fs = require('fs');

const MOD = 'C:/san11/xsyg/xsyg6/xsyg6/San11Pk/Media/san11pkres.bin';
const VAN = 'C:/san11/san11_原版/San11/Media/san11pkres.bin';
const N = 40000, CELL = 11, HDR = 8;

function readPlanes(file, off) {
  const fd = fs.openSync(file, 'r');
  const buf = Buffer.alloc(HDR + N * CELL);
  fs.readSync(fd, buf, 0, buf.length, off);
  fs.closeSync(fd);
  const planes = [];
  for (let p = 0; p < 11; p++) {
    const a = new Uint8Array(N);
    for (let i = 0; i < N; i++) a[i] = buf[HDR + i * CELL + p];
    planes.push(a);
  }
  return planes;
}

const b4791 = readPlanes(MOD, 0x20a40cb7);
const b4863 = readPlanes(MOD, 0x26800119);
const van = readPlanes(VAN, 0x1f520cb7);

console.log('== A) 逐平面差异计数 (40000格) ==');
console.log('  plane  [4791]vs原版   [4863]vs原版');
for (let p = 0; p < 11; p++) {
  let d1 = 0, d2 = 0;
  for (let i = 0; i < N; i++) {
    if (b4791[p][i] !== van[p][i]) d1++;
    if (b4863[p][i] !== van[p][i]) d2++;
  }
  console.log(`   p${String(p).padEnd(2)}   ${String(d1).padStart(6)}        ${String(d2).padStart(6)}`);
}

// ---- B) 建筑坐标 ----
const scen = JSON.parse(fs.readFileSync('tools/xsyg_map/Scenario1.json', 'utf8'));
const all = Object.values(scen.citySet);
const idx = (x, y) => x * 200 + y;
const toCell = (b) => ({ q: b.x - 28, r: b.y - 28 });
const cities = all.filter((c) => c.BuildingType === 1).map(toCell).filter((c) => c.q >= 0 && c.q < 200 && c.r >= 0 && c.r < 200);
const passes = all.filter((c) => c.BuildingType === 2).map(toCell).filter((c) => c.q >= 0 && c.q < 200 && c.r >= 0 && c.r < 200);
const ports = all.filter((c) => c.BuildingType === 3).map(toCell).filter((c) => c.q >= 0 && c.q < 200 && c.r >= 0 && c.r < 200);
console.log(`\n建筑数: 城${cities.length} 关${passes.length} 港${ports.length}`);

function stampScan(planes, label, pts, name) {
  console.log(`\n== ${label}: ${name}落值 (每平面 top值:计数) ==`);
  for (let p = 0; p < 11; p++) {
    const t = {};
    for (const c of pts) { const v = planes[p][idx(c.q, c.r)]; t[v] = (t[v] ?? 0) + 1; }
    const sorted = Object.entries(t).sort((a, b) => b[1] - a[1]);
    const top = sorted[0];
    const flag = Number(top[1]) >= pts.length * 0.8 ? '  <== 一致!' : '';
    console.log(`   p${String(p).padEnd(2)}: ${sorted.slice(0, 4).map(([v, c]) => `${v}×${c}`).join(' ')}${flag}`);
  }
}
stampScan(b4791, '[4791]', cities, '城');
stampScan(b4791, '[4791]', passes, '关');
stampScan(b4791, '[4791]', ports, '港');
stampScan(van, '原版', cities, '城');
