/** 决定性测试：正确的偏移基准下城市中心应落在 tType=16(都市) 格上 */
const fs = require('fs');

const MOD = 'C:/san11/xsyg/xsyg6/xsyg6/San11Pk/Media/san11pkres.bin';
const VANILLA = 'C:/san11/san11_原版/San11/Media/san11pkres.bin';
const BLOOD_OFFSET = 0x20a40cb7;
const VANILLA_OFFSET = 0x1f520cb7;
const HEADER = 8, CELL = 11, N = 200 * 200;

function readMap(file, offset) {
  const fd = fs.openSync(file, 'r');
  const buf = Buffer.alloc(HEADER + N * CELL);
  fs.readSync(fd, buf, 0, buf.length, offset);
  fs.closeSync(fd);
  const t = new Uint8Array(N);
  for (let i = 0; i < N; i++) t[i] = buf[HEADER + i * CELL];
  return t;
}
const blood = readMap(MOD, BLOOD_OFFSET);
const vanilla = readMap(VANILLA, VANILLA_OFFSET);

const scenario = JSON.parse(fs.readFileSync('tools/xsyg_map/Scenario1.json', 'utf8'));
const metros = Object.values(scenario.citySet).filter((c) => c.BuildingType === 1);
const allBuildings = Object.values(scenario.citySet);

console.log('== 血色地图: 城市中心落在 tType=16(都市) 的数量 ==');
for (let base = 20; base <= 36; base++) {
  let onCity = 0;
  for (const c of metros) {
    const q = c.x - base, r = c.y - base;
    if (q >= 0 && q < 200 && r >= 0 && r < 200 && blood[q * 200 + r] === 16) onCity++;
  }
  console.log(`  base=${base}: ${onCity}/42`);
}

console.log('\n== 血色地图: 全部建筑(都市+关所+港) 落点 ==');
for (let base = 26; base <= 30; base++) {
  const tally = {};
  for (const c of allBuildings) {
    const q = c.x - base, r = c.y - base;
    const v = (q >= 0 && q < 200 && r >= 0 && r < 200) ? blood[q * 200 + r] : -1;
    tally[v] = (tally[v] ?? 0) + 1;
  }
  console.log(`  base=${base}:`, Object.fromEntries(Object.entries(tally).sort((a, b) => b[1] - a[1]).slice(0, 8)));
}

console.log('\n== 原版地图: tType 16/17/18 分布（对照） ==');
const counts = { 16: 0, 17: 0, 18: 0 };
for (const v of vanilla) if (counts[v] !== undefined) counts[v]++;
console.log(' ', counts, '（原版42城×7格=294 应等于 16 的数量）');

console.log('\n== 血色地图: tType 16/17/18 分布 ==');
const counts2 = { 16: 0, 17: 0, 18: 0 };
for (const v of blood) if (counts2[v] !== undefined) counts2[v]++;
console.log(' ', counts2, '（血色42城×7格=294）');
