/** 从血色存档中提取地图块并全面分析 */
const fs = require('fs');

const save = fs.readFileSync('C:/san11/xsyg/xsyg6/xsyg6/San11Pk/Koei/San11 Tc/SaveData/Save000.s11');
const VAN = 'C:/san11/san11_原版/San11/Media/san11pkres.bin';
const MOD = 'C:/san11/xsyg/xsyg6/xsyg6/San11Pk/Media/san11pkres.bin';

// 精确定位: byte0平面在 468159 (mod 11 = ?), 块起点应是 468159 - k*11
const anchor = 468159;
console.log('anchor mod 11 =', anchor % 11);

// 地图块 440000 字节。尝试起点 = anchor - k*11 (k=0..40)，检查哪个起点的
// byte0 平面前 200 格 (第一列) 与「山崖边界」特征吻合（第一列大部分应为同一边界值）
for (let k = 0; k <= 44; k++) {
  const o = anchor - k * 11;
  const col0 = [];
  for (let y = 0; y < 200; y++) col0.push(save[o + y * 11]);
  const dist = {};
  for (const v of col0) dist[v] = (dist[v] ?? 0) + 1;
  const top = Object.entries(dist).sort((a, b) => b[1] - a[1])[0];
  if (top && top[1] > 150) {
    console.log(`起点候选 ${o} (0x${o.toString(16)}): 第一列主导值=${top[0]}×${top[1]}`);
  }
}

// 假设块起点是最早的强候选，先用 anchor-? 确定：直接找 440000 字节窗口内 byte0 值域
// 更直接: 扫描 anchor 附近往前找值域受限(<=31)的平面起点
let start = anchor;
for (let o = anchor; o > anchor - 500; o -= 1) {
  // 检查从 o 开始的 2000 格 byte0 是否都 <=31 且有连贯性
  let ok = true;
  for (let i = 0; i < 200; i++) {
    const v = save[o + i * 11];
    if (v > 31) { ok = false; break; }
  }
  if (ok) { start = o; } else { break; }
}
console.log('往前扩展到:', start, '(0x' + start.toString(16) + ')');

// 读出整块
const N = 200 * 200;
const terrain = new Uint8Array(N);
const areaId = new Uint8Array(N);
for (let i = 0; i < N; i++) {
  terrain[i] = save[start + i * 11];
  areaId[i] = save[start + i * 11 + 1];
}

const dist = {};
for (const v of terrain) dist[v] = (dist[v] ?? 0) + 1;
console.log('\n地形值分布:', Object.fromEntries(Object.entries(dist).sort((a, b) => a[0] - b[0])));

// 城市对齐: Scenario1.json 的城市 (base=28) 落在哪个值
const scen = JSON.parse(fs.readFileSync('tools/xsyg_map/Scenario1.json', 'utf8'));
const metros = Object.values(scen.citySet).filter((c) => c.BuildingType === 1);
const tally = {};
for (const c of metros) {
  const q = c.x - 28, r = c.y - 28;
  if (q >= 0 && q < 200 && r >= 0 && r < 200) {
    const v = terrain[q * 200 + r];
    tally[v] = (tally[v] ?? 0) + 1;
  }
}
console.log('城市中心落值分布:', Object.fromEntries(Object.entries(tally).sort((a, b) => b[1] - a[1])));

// 与原版地图对比
function readMap(file, offset) {
  const fd = fs.openSync(file, 'r');
  const buf = Buffer.alloc(8 + N * 11);
  fs.readSync(fd, buf, 0, buf.length, offset);
  fs.closeSync(fd);
  const t = new Uint8Array(N);
  for (let i = 0; i < N; i++) t[i] = buf[8 + i * 11];
  return t;
}
const van = readMap(VAN, 0x1f520cb7);
let same = 0;
for (let i = 0; i < N; i++) if (terrain[i] === van[i]) same++;
console.log(`\n与原版地图 byte0 相同率: ${(same / N * 100).toFixed(1)}%`);

// 与血色pkres对比
const blood = readMap(MOD, 0x20a40cb7);
let sameB = 0;
for (let i = 0; i < N; i++) if (terrain[i] === blood[i]) sameB++;
console.log(`与血色pkres(混淆) byte0 相同率: ${(sameB / N * 100).toFixed(1)}%`);

// 保存块位置信息
console.log('\n块起点:', start, '结束:', start + 440000, '存档大小:', save.length);
