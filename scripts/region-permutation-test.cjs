/** 验证：血色byte0 是否为按区域(byte2)置换后的地形值 —— 区域内 blood0→van0 应为清晰映射 */
const fs = require('fs');

const MOD = 'C:/san11/xsyg/xsyg6/xsyg6/San11Pk/Media/san11pkres.bin';
const VANILLA = 'C:/san11/san11_原版/San11/Media/san11pkres.bin';
const HEADER = 8, CELL = 11, N = 200 * 200;

function readRaw(file, offset) {
  const fd = fs.openSync(file, 'r');
  const buf = Buffer.alloc(HEADER + N * CELL);
  fs.readSync(fd, buf, 0, buf.length, offset);
  fs.closeSync(fd);
  return buf;
}

const blood = readRaw(MOD, 0x20a40cb7);
const van = readRaw(VANILLA, 0x1f520cb7);

// byte2 是区域ID？先看 byte2 取值
const b2set = new Set(), b2van = new Set();
for (let i = 0; i < N; i++) { b2set.add(blood[HEADER + i * CELL + 2]); b2van.add(van[HEADER + i * CELL + 2]); }
console.log('blood byte2 取值:', [...b2set].sort((a, b) => a - b).join(','));
console.log('van byte2 取值:  ', [...b2van].sort((a, b) => a - b).join(','));

// 对每个 byte2 值（区域），构建 blood0 → van0 交叉表，检验是否接近函数映射
console.log('\n== 按区域分组的 blood0→van0 映射质量 ==');
const regions = {};
for (let i = 0; i < N; i++) {
  const r = van[HEADER + i * CELL + 2]; // 用原版byte2（与血色几乎相同）
  const b0 = blood[HEADER + i * CELL], v0 = van[HEADER + i * CELL];
  (regions[r] ??= {})[b0] ??= {};
  regions[r][b0][v0] = (regions[r][b0][v0] ?? 0) + 1;
}
let totalCells = 0, funcCells = 0;
for (const [r, map] of Object.entries(regions).sort((a, b) => a[0] - b[0])) {
  const b0keys = Object.keys(map);
  const cellCount = Object.values(map).reduce((s, m) => s + Object.values(m).reduce((x, y) => x + y, 0), 0);
  // 每个blood0值的多数van0占比
  let funcN = 0;
  const rows = [];
  for (const [b0, m] of Object.entries(map)) {
    const tot = Object.values(m).reduce((x, y) => x + y, 0);
    const top = Object.entries(m).sort((a, b) => b[1] - a[1])[0];
    funcN += Number(top[1]);
    rows.push(`${b0}→${top[0]}(${(top[1] / tot * 100).toFixed(0)}%)`);
  }
  totalCells += cellCount;
  funcCells += funcN;
  console.log(`  区域${String(r).padStart(2)} [${cellCount}格]: ${rows.slice(0, 12).join(' ')}${rows.length > 12 ? ' ...' : ''}`);
}
console.log(`\n区域内映射质量: ${(funcCells / totalCells * 100).toFixed(1)}% （若>90%则置换假设成立）`);
