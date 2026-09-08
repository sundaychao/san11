/** 空间连续性测试：真实地形的相邻格大量同值；加密数据则接近随机(1/32) */
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

// 索引约定: idx = x*200+y（列主序），邻居取东西向(x±1)与南北向(y±1)
const idx = (x, y) => x * 200 + y;
function coherence(t, label) {
  let same = 0, total = 0;
  for (let x = 0; x < 200; x++) for (let y = 0; y < 200; y++) {
    for (const [dx, dy] of [[1, 0], [0, 1]]) {
      const nx = x + dx, ny = y + dy;
      if (nx < 200 && ny < 200) {
        total++;
        if (t[idx(x, y)] === t[idx(nx, ny)]) same++;
      }
    }
  }
  console.log(`${label}: 相邻同值率 ${(same / total * 100).toFixed(1)}% (${same}/${total})`);
}
coherence(van, '原版 byte0');
coherence(blood, '血色 byte0');

// 逐行对比：血色某一行是否等于原版另一行（检测行错位）
console.log('\n== 行错位检测：血色列x vs 原版列x的匹配率（前若干列） ==');
for (let x of [0, 1, 2, 10, 50, 100, 150, 199]) {
  let m = 0;
  for (let y = 0; y < 200; y++) if (blood[idx(x, y)] === van[idx(x, y)]) m++;
  console.log(`  列x=${x}: ${m}/200`);
}

// 也许整个数据相对头部偏移了？尝试数据起点 ±k 字节再比较 byte0
console.log('\n== 数据起点偏移扫描（byte0 匹配率>5%即显著） ==');
const fdm = fs.openSync(MOD, 'r');
const big = Buffer.alloc(HEADER + N * CELL + 64);
fs.readSync(fdm, big, 0, big.length, 0x20a40cb7 - 32); // 从前32字节开始读
fs.closeSync(fdm);
const fdv = fs.openSync(VANILLA, 'r');
const bigv = Buffer.alloc(HEADER + N * CELL);
fs.readSync(fdv, bigv, 0, bigv.length, 0x1f520cb7);
fs.closeSync(fdv);
for (let shift = -32; shift <= 32; shift++) {
  let m = 0;
  for (let i = 0; i < N; i++) {
    const bi = HEADER + 32 + shift + i * CELL; // big 从 -32 开始
    if (big[bi] === bigv[HEADER + i * CELL]) m++;
  }
  const pct = m / N * 100;
  if (pct > 3) console.log(`  shift=${shift}: ${pct.toFixed(1)}%`);
}
console.log('(无输出=无显著对齐)');
