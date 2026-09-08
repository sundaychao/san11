/** 交叉对比：血色地图每个值在各格上对应的原版值分布 → 推断新值含义 */
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

// 血色值 → { 原版值: 数量 } 交叉表
const cross = {};
for (let i = 0; i < N; i++) {
  (cross[blood[i]] ??= {})[vanilla[i]] = (cross[blood[i]][vanilla[i]] ?? 0) + 1;
}

const VAN_NAMES = ['草地', '土地', '砂地', '湿地', '毒泉', '森林', '江河', '河道', '大海', '荒地',
  '道路', '栈道', '桥', '渡所', '岸', '山崖', '都市', '港', '关所', '间道'];

console.log('血色值 | 总数 | 主要对应原版值(占比) ');
for (const bv of Object.keys(cross).map(Number).sort((a, b) => a - b)) {
  const total = Object.values(cross[bv]).reduce((s, v) => s + v, 0);
  const top = Object.entries(cross[bv]).sort((a, b) => b[1] - a[1]).slice(0, 3)
    .map(([vv, n]) => `${vv}(${VAN_NAMES[vv] ?? '?'}):${(n / total * 100).toFixed(0)}%`).join(' ');
  console.log(`  ${String(bv).padStart(2)} | ${String(total).padStart(5)} | ${top}`);
}

// 四角与边缘采样
console.log('\n== 血色地图四角/边缘采样 ==');
const idx = (x, y) => x * 200 + y;
console.log('  四角:', [blood[idx(0, 0)], blood[idx(199, 0)], blood[idx(0, 199)], blood[idx(199, 199)]]);
const edges = [];
for (let y = 0; y < 200; y++) { edges.push(blood[idx(0, y)]); edges.push(blood[idx(199, y)]); }
for (let x = 0; x < 200; x++) { edges.push(blood[idx(x, 0)]); edges.push(blood[idx(x, 199)]); }
const ed = {};
for (const v of edges) ed[v] = (ed[v] ?? 0) + 1;
console.log('  边缘值分布:', Object.fromEntries(Object.entries(ed).sort((a, b) => b[1] - a[1])));

// 城市对齐测试：血色图上每个值，统计「城市中心(42城)落在该值」的数量（base=28）
const scen = JSON.parse(fs.readFileSync('tools/xsyg_map/Scenario1.json', 'utf8'));
const metros = Object.values(scen.citySet).filter((c) => c.BuildingType === 1);
console.log('\n== 城市中心(base=28)落在血色各值的数量 ==');
const cityVals = {};
for (const c of metros) {
  const q = c.x - 28, r = c.y - 28;
  if (q >= 0 && q < 200 && r >= 0 && r < 200) {
    const v = blood[idx(q, r)];
    cityVals[v] = (cityVals[v] ?? 0) + 1;
  }
}
console.log(' ', Object.fromEntries(Object.entries(cityVals).sort((a, b) => b[1] - a[1])));

// 全部 87 建筑
console.log('\n== 全部建筑(base=28)落在血色各值的数量 ==');
const bVals = {};
for (const c of Object.values(scen.citySet)) {
  const q = c.x - 28, r = c.y - 28;
  if (q >= 0 && q < 200 && r >= 0 && r < 200) {
    const v = blood[idx(q, r)];
    bVals[v] = (bVals[v] ?? 0) + 1;
  }
}
console.log(' ', Object.fromEntries(Object.entries(bVals).sort((a, b) => b[1] - a[1])));
