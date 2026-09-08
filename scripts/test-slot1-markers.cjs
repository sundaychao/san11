/** 测试槽位1地图：87个建筑位置在不同base下的落点值是否聚集（找城市脚印标记值） */
const fs = require('fs');
const MOD = 'C:/san11/xsyg/xsyg6/xsyg6/San11Pk/Media/san11pkres.bin';
const HEADER = 8, CELLB = 11, N = 40000;

const fd = fs.openSync(MOD, 'r');
const buf = Buffer.alloc(HEADER + N * CELLB);
fs.readSync(fd, buf, 0, buf.length, 0x20a40cb7);
fs.closeSync(fd);
const t = new Uint8Array(N);
for (let i = 0; i < N; i++) t[i] = buf[HEADER + i * CELLB];

const scen = JSON.parse(fs.readFileSync('tools/xsyg_map/Scenario1.json', 'utf8'));
const all = Object.values(scen.citySet);
const metros = all.filter((c) => c.BuildingType === 1);

console.log('base | 42都市落点值top3 | 87建筑落点值top3');
for (let base = 20; base <= 36; base++) {
  const tallyM = {}, tallyAll = {};
  for (const c of all) {
    const q = c.x - base, r = c.y - base;
    if (q < 0 || q >= 200 || r < 0 || r >= 200) continue;
    const v = t[q * 200 + r];
    tallyAll[v] = (tallyAll[v] ?? 0) + 1;
    if (c.BuildingType === 1) tallyM[v] = (tallyM[v] ?? 0) + 1;
  }
  const topM = Object.entries(tallyM).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([v, c2]) => v + ':' + c2).join(' ');
  const topA = Object.entries(tallyAll).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([v, c2]) => v + ':' + c2).join(' ');
  console.log('  ' + base + ' | ' + topM + ' | ' + topA);
}

// 另一个思路：统计每个值 v 的格子中，落在"42都市位置±2格"内的比例
// 如果 slot-1 用某个值标记城市，该值应高度集中于都市位置附近
console.log('\n各值格子在都市中心±2范围内的命中数（期望：城市标记值会大量命中）:');
for (let v = 0; v <= 31; v++) {
  const idxs = [];
  for (let i = 0; i < N; i++) if (t[i] === v) idxs.push(i);
  if (idxs.length === 0) continue;
  let near = 0;
  for (const i of idxs) {
    const x = Math.floor(i / 200), y = i % 200;
    for (const c of metros) {
      if (Math.abs(c.x - 28 - x) <= 2 && Math.abs(c.y - 28 - y) <= 2) { near++; break; }
    }
  }
  if (near > 3) console.log(`  值${v}: 共${idxs.length}格, ${near}格在都市附近 (${(near / idxs.length * 100).toFixed(0)}%)`);
}
