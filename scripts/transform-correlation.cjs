/** 测试血色图与原版在8种几何变换+平移下的匹配率；以及块状重排假设 */
const fs = require('fs');

const MOD = 'C:/san11/xsyg/xsyg6/xsyg6/San11Pk/Media/san11pkres.bin';
const VANILLA = 'C:/san11/san11_原版/San11/Media/san11pkres.bin';
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

const blood = readMap(MOD, 0x20a40cb7);
const van = readMap(VANILLA, 0x1f520cb7);

// 血色与原版都按 (x,y) → t[x*200+y]（列主序）解读
const get = (t, x, y) => t[x * 200 + y];

// 8种二面体变换：把血色图的(x,y)映射到原版坐标(x',y')
const TRANSFORMS = {
  identity: (x, y) => [x, y],
  transpose: (x, y) => [y, x],
  hflip: (x, y) => [199 - x, y],
  vflip: (x, y) => [x, 199 - y],
  rot180: (x, y) => [199 - x, 199 - y],
  rot90: (x, y) => [y, 199 - x],
  rot270: (x, y) => [199 - y, x],
  antiTranspose: (x, y) => [199 - y, 199 - x],
};

console.log('== 8种几何变换下的 byte0 匹配率 ==');
for (const [name, tf] of Object.entries(TRANSFORMS)) {
  let m = 0;
  for (let x = 0; x < 200; x++) for (let y = 0; y < 200; y++) {
    const [vx, vy] = tf(x, y);
    if (get(blood, x, y) === get(van, vx, vy)) m++;
  }
  const pct = m / N * 100;
  console.log(`  ${name.padEnd(14)}: ${pct.toFixed(2)}%`);
}

// 平移扫描（±10）在 identity 下
console.log('\n== 平移扫描（identity, |dx|,|dy|<=6, >5%显示） ==');
for (let dx = -6; dx <= 6; dx++) for (let dy = -6; dy <= 6; dy++) {
  let m = 0, tot = 0;
  for (let x = Math.max(0, -dx); x < Math.min(200, 200 - dx); x++)
    for (let y = Math.max(0, -dy); y < Math.min(200, 200 - dy); y++) {
      tot++;
      if (get(blood, x, y) === get(van, x + dx, y + dy)) m++;
    }
  const pct = m / tot * 100;
  if (pct > 5) console.log(`  dx=${dx} dy=${dy}: ${pct.toFixed(1)}%`);
}
console.log('(无输出=无显著平移对齐)');

// 块重排假设：血色图按 BxB 块存储，块内行优先。尝试 B=2,4,8,16
console.log('\n== 块重排假设（blood块内解码 vs 原版 identity 匹配率） ==');
for (const B of [2, 4, 8, 16, 32]) {
  let m = 0;
  for (let bx = 0; bx < 200; bx++) for (let by = 0; by < 200; by++) {
    // blood 线性索引 i 的块结构解释
    const i = bx * 200 + by;
    const blockCol = Math.floor(bx / B), blockRow = Math.floor(by / B);
    const inX = bx % B, inY = by % B;
    // 重排: 线性 = blockRow*(200/B)*B*B + blockCol*B*B + inY*B + inX (块行优先,块内行优先)
    const ni = (blockRow * (200 / B) + blockCol) * B * B + inY * B + inX;
    if (ni >= 0 && ni < N && blood[ni] === van[i]) m++;
  }
  console.log(`  B=${B}: ${(m / N * 100).toFixed(2)}%`);
}
