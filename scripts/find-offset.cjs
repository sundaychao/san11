/**
 * 暴力搜索血色场景坐标→血色地图格的偏移
 * 判据: 87个建筑的中心格落在值16(建筑地形)上
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
const blood = readMap('C:/san11/xsyg/xsyg6/xsyg6/San11Pk/Media/san11pkres.bin', 0x20a40cb7);

const scen = JSON.parse(fs.readFileSync('tools/xsyg_map/Scenario1.json', 'utf8'));
const builds = Object.values(scen.citySet);
console.log('建筑数:', builds.length, '都市:', builds.filter(b => b.BuildingType === 1).length,
  '关所:', builds.filter(b => b.BuildingType === 2).length, '港:', builds.filter(b => b.BuildingType === 3).length);

// 暴力: base 从 20 到 40
let best = [];
for (let base = 15; base <= 45; base++) {
  let hit16 = 0, hitAll = 0;
  for (const b of builds) {
    const q = b.x - base, r = b.y - base;
    if (q < 0 || q >= 200 || r < 0 || r >= 200) continue;
    const v = blood[q * 200 + r];
    if (v === 16) { hit16++; hitAll++; }
  }
  best.push({ base, hit16 });
}
best.sort((a, b) => b.hit16 - a.hit16);
console.log('同base偏移 top:', best.slice(0, 5));

// 也许 x/y 偏移不同, 或中心格是 3x3 内含16
// 测3x3邻域含16的命中率 (base 28)
for (const base of [26, 27, 28, 29, 30]) {
  let near = 0;
  for (const b of builds) {
    const q = b.x - base, r = b.y - base;
    let found = false;
    for (let dx = -2; dx <= 2 && !found; dx++) for (let dy = -2; dy <= 2 && !found; dy++) {
      const x = q + dx, y = r + dy;
      if (x < 0 || x >= 200 || y < 0 || y >= 200) continue;
      if (blood[x * 200 + y] === 16) found = true;
    }
    if (found) near++;
  }
  console.log(`base=${base}: 5x5邻域含16的建筑 ${near}/${builds.length}`);
}

// 分开 x/y 偏移暴力 (范围15-45): 用hit16最大化
let bestXY = { hit: -1 };
for (let bx = 15; bx <= 45; bx++) for (let by = 15; by <= 45; by++) {
  let hit = 0;
  for (const b of builds) {
    const q = b.x - bx, r = b.y - by;
    if (q < 0 || q >= 200 || r < 0 || r >= 200) continue;
    if (blood[q * 200 + r] === 16) hit++;
  }
  if (hit > bestXY.hit) bestXY = { hit, bx, by };
}
console.log('分离xy偏移最佳:', bestXY);

// 用最佳偏移看 BuildingType 分布
if (bestXY.hit > 0) {
  const { bx, by } = bestXY;
  for (const bt of [1, 2, 3]) {
    const tally = {};
    for (const b of builds.filter(x => x.BuildingType === bt)) {
      const q = b.x - bx, r = b.y - by;
      if (q < 0 || q >= 200 || r < 0 || r >= 200) continue;
      const v = blood[q * 200 + r];
      tally[v] = (tally[v] ?? 0) + 1;
    }
    console.log(`BuildingType${bt} 中心值分布:`, Object.fromEntries(Object.entries(tally).sort((a, b) => b[1] - a[1])));
  }
}
