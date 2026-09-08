/** 对比血色/原版地图每格 11 字节中哪些字节一致、哪些被改 */
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

// 每字节位置的一致率
console.log('== 每字节位置(0-10) 血色vs原版 一致率 ==');
for (let b = 0; b < CELL; b++) {
  let same = 0;
  for (let i = 0; i < N; i++) if (blood[HEADER + i * CELL + b] === van[HEADER + i * CELL + b]) same++;
  console.log(`  byte${b}: ${(same / N * 100).toFixed(2)}%`);
}

// 若 byte0 被加密：血色byte0 XOR 原版byte0 的分布（找单字节异或钥）
console.log('\n== byte0 XOR(血色,原版) 值分布（前20） ==');
const xors = {};
for (let i = 0; i < N; i++) {
  const x = blood[HEADER + i * CELL] ^ van[HEADER + i * CELL];
  xors[x] = (xors[x] ?? 0) + 1;
}
console.log(' ', Object.fromEntries(Object.entries(xors).sort((a, b) => b[1] - a[1]).slice(0, 20)));

// byte0+byte1 组合的血色值分布（也许地形是双字节？）
console.log('\n== 血色 byte0 | byte1 组合采样（前10格） ==');
for (let i = 0; i < 10; i++) {
  const o = HEADER + i * CELL;
  console.log(`  cell${i}: blood=[${[...blood.subarray(o, o + 11)].join(',')}] van=[${[...van.subarray(o, o + 11)].join(',')}]`);
}

// 也检查血色地图内部 byte1 的取值分布（原版 byte1 是区域ID）
console.log('\n== 血色 byte1 分布（前若干） ==');
const b1 = {};
for (let i = 0; i < N; i++) {
  const v = blood[HEADER + i * CELL + 1];
  b1[v] = (b1[v] ?? 0) + 1;
}
const b1v = {};
for (let i = 0; i < N; i++) {
  const v = van[HEADER + i * CELL + 1];
  b1v[v] = (b1v[v] ?? 0) + 1;
}
console.log('  blood byte1:', Object.fromEntries(Object.entries(b1).sort((a, b) => b[1] - a[1]).slice(0, 10)));
console.log('  van byte1:  ', Object.fromEntries(Object.entries(b1v).sort((a, b) => b[1] - a[1]).slice(0, 10)));
