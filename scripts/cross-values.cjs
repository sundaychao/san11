/** 交叉值映射表: 血色槽位byte0 vs 原版槽位byte0, 判断是否同地理重排 */
const fs = require('fs');
const N = 200 * 200;
function read(off) {
  const fd = fs.openSync('C:/san11/xsyg/xsyg6/xsyg6/San11Pk/Media/san11pkres.bin', 'r');
  const buf = Buffer.alloc(8 + N * 11);
  fs.readSync(fd, buf, 0, buf.length, off);
  fs.closeSync(fd);
  const t = new Uint8Array(N);
  for (let i = 0; i < N; i++) t[i] = buf[8 + i * 11];
  return t;
}
const blood = read(0x20a40cb7);
const van = read(0x26800119);

// cross[blood值][van值] = 计数
const cross = {};
for (let i = 0; i < N; i++) {
  (cross[blood[i]] ??= {})[van[i]] = (cross[blood[i]][van[i]] ?? 0) + 1;
}
console.log('血色值 → 原版值映射 (仅显示占比>5%的):');
let pure = 0, pureCells = 0;
for (const bv of Object.keys(cross).map(Number).sort((a, b) => a - b)) {
  const entries = Object.entries(cross[bv]).sort((a, b) => b[1] - a[1]);
  const total = entries.reduce((s, [, c]) => s + c, 0);
  const top = entries.filter(([v, c]) => c / total > 0.05);
  if (top.length === 1) { pure++; pureCells += total; }
  console.log(`  血色${bv}(${total}格): ${top.map(([v, c]) => `原版${v}×${c}(${(c / total * 100).toFixed(0)}%)`).join(' + ')}`);
}
console.log(`\n纯净1:1映射的血色值: ${pure}/32, 覆盖 ${pureCells}/${N} 格 (${(pureCells / N * 100).toFixed(1)}%)`);

// 反向: 原版值在血色图上是否落在同一类区域(空间一致性: 原版水的位置血色值是否单一)
const VT = { 0: '草地', 1: '土', 2: '砂地', 3: '湿地', 4: '毒泉', 5: '森林', 6: '江河', 7: '河道', 8: '大海', 9: '荒地', 10: '道路', 11: '栈道', 12: '桥', 13: '渡所', 14: '岸', 15: '山崖', 16: '都市址', 17: '港址', 18: '关址', 19: '间道' };
console.log('\n原版各地形在血色图上的值分布(top3):');
for (let vv = 0; vv <= 19; vv++) {
  const tally = {};
  let cnt = 0;
  for (let i = 0; i < N; i++) if (van[i] === vv) { tally[blood[i]] = (tally[blood[i]] ?? 0) + 1; cnt++; }
  if (cnt === 0) continue;
  const top = Object.entries(tally).sort((a, b) => b[1] - a[1]).slice(0, 3);
  console.log(`  原版${vv}${VT[vv]}(${cnt}格): ${top.map(([b, c]) => `血${b}×${(c / cnt * 100).toFixed(0)}%`).join(' ')}`);
}
