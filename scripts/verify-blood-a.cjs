/**
 * 血色A (0x20a40cb7) 最终验证:
 * 1) 城市落值 (base=28,28 col序, 按 bt 分组)
 * 2) 血色值→原版值 交叉表 (同格对比, 推断扩展地形语义)
 * 3) 血色 p0 边界环 + 值分布全景
 */
const fs = require('fs');

const MOD = 'C:/san11/xsyg/xsyg6/xsyg6/San11Pk/Media/san11pkres.bin';
const VAN = 'C:/san11/san11_原版/San11/Media/san11pkres.bin';
const N = 40000, HDR = 8, SIZE = HDR + N * 11;

function readP0(file, off) {
  const f = fs.openSync(file, 'r');
  const buf = Buffer.alloc(SIZE);
  fs.readSync(f, buf, 0, SIZE, off);
  fs.closeSync(f);
  console.log(`头部=${buf.toString('ascii', 0, 8)} @0x${off.toString(16)}`);
  const a = new Uint8Array(N);
  for (let i = 0; i < N; i++) a[i] = buf[HDR + i * 11];
  return a;
}

const blood = readP0(MOD, 0x20a40cb7);
const vanilla = readP0(VAN, 0x1f520cb7);

const scen = JSON.parse(fs.readFileSync('tools/xsyg_map/Scenario1.json', 'utf8'));
const cities = Object.values(scen.citySet)
  .map((c) => ({ name: c.Name, x: c.x - 28, y: c.y - 28, bt: c.BuildingType }))
  .filter((c) => c.x >= 0 && c.x < 200 && c.y >= 0 && c.y < 200);

console.log('\n== 1) 血色A p0 城市落值 (base=28,28 列序) ==');
const byBt = {};
for (const c of cities) {
  const v = blood[c.x * 200 + c.y];
  (byBt[c.bt] ??= {})[v] = (byBt[c.bt][v] ?? 0) + 1;
}
const BT_NAME = { 1: '都市', 2: '关所', 3: '港口' };
for (const [bt, t] of Object.entries(byBt)) {
  const sorted = Object.entries(t).sort((a, b) => b[1] - a[1]);
  console.log(`  ${BT_NAME[bt]}(${sorted.reduce((s, [, c]) => s + c, 0)}个): ${sorted.map(([v, c]) => `${v}×${c}`).join(' ')}`);
}
const offCities = cities.filter((c) => {
  const v = blood[c.x * 200 + c.y];
  return !(c.bt === 1 && v === 16) && !(c.bt === 2 && v === 18) && !(c.bt === 3 && v === 17);
});
if (offCities.length) {
  console.log('  落值异常城市:');
  for (const c of offCities) console.log(`    ${c.name} bt=${c.bt} 值=${blood[c.x * 200 + c.y]} @(${c.x},${c.y})`);
}

console.log('\n== 2) 血色值 → 原版值 交叉表 (占比>8% 或 总数>300) ==');
const cross = {};
for (let i = 0; i < N; i++) (cross[blood[i]] ??= {})[vanilla[i]] = (cross[blood[i]][vanilla[i]] ?? 0) + 1;
const VAN_NAME = { 0: '草地', 1: '土', 2: '砂', 3: '湿', 4: '毒泉', 5: '森林', 6: '江河', 7: '河道', 8: '大海', 9: '荒地', 10: '道路', 11: '栈道', 12: '桥', 13: '渡所', 14: '岸', 15: '山崖', 16: '都市', 17: '港', 18: '关', 19: '间道' };
const bloodDist = {};
for (const v of blood) bloodDist[v] = (bloodDist[v] ?? 0) + 1;
for (const bv of Object.keys(cross).map(Number).sort((a, b) => a - b)) {
  const total = bloodDist[bv];
  const inner = Object.entries(cross[bv]).sort((a, b) => b[1] - a[1]);
  const top = inner.filter(([vv, c]) => c / total > 0.08 || c > 300).slice(0, 5);
  console.log(`  血${bv}(${total}格): ${top.map(([vv, c]) => `${VAN_NAME[vv] ?? vv}×${c}(${(c / total * 100).toFixed(0)}%)`).join(' ')}`);
}

console.log('\n== 3) 原版值 → 血色值 (top3) ==');
const rev = {};
for (let i = 0; i < N; i++) (rev[vanilla[i]] ??= {})[blood[i]] = (rev[vanilla[i]][blood[i]] ?? 0) + 1;
for (const vv of Object.keys(rev).map(Number).sort((a, b) => a - b)) {
  const total = Object.values(rev[vv]).reduce((s, c) => s + c, 0);
  const top = Object.entries(rev[vv]).sort((a, b) => b[1] - a[1]).slice(0, 3);
  console.log(`  原${VAN_NAME[vv] ?? vv}(${total}格): ${top.map(([bv, c]) => `血${bv}×${c}(${(c / total * 100).toFixed(0)}%)`).join(' ')}`);
}

console.log('\n== 4) 血色 p0 边界环 ==');
const ring = {};
for (let x = 0; x < 200; x++) for (const y of [0, 199]) { const v = blood[x * 200 + y]; ring[v] = (ring[v] ?? 0) + 1; }
for (let y = 1; y < 199; y++) for (const x of [0, 199]) { const v = blood[x * 200 + y]; ring[v] = (ring[v] ?? 0) + 1; }
console.log(' ', Object.entries(ring).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([v, c]) => `${v}×${c}`).join(' '));
