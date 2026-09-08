/**
 * 区域密钥假设测试: blood_byte0 = vanilla_byte0 XOR K[region]
 * region 取 blood 的 byte1 (区域ID, 95种)
 */
const fs = require('fs');

const N = 200 * 200;
const CELL = 11;
const HEADER = 8;

function readMap(file, offset) {
  const fd = fs.openSync(file, 'r');
  const buf = Buffer.alloc(HEADER + N * CELL);
  fs.readSync(fd, buf, 0, buf.length, offset);
  fs.closeSync(fd);
  const types = new Uint8Array(N);
  const b1 = new Uint8Array(N);
  for (let i = 0; i < N; i++) { types[i] = buf[HEADER + i * CELL]; b1[i] = buf[HEADER + i * CELL + 1]; }
  return { types, b1 };
}

const blood = readMap('C:/san11/xsyg/xsyg6/xsyg6/San11Pk/Media/san11pkres.bin', 0x20a40cb7);
const van = readMap('C:/san11/san11_原版/San11/Media/san11pkres.bin', 0x1f520cb7);

// 按区域统计 blood^vanilla 的分布
const regions = {};
for (let i = 0; i < N; i++) {
  const r = blood.b1[i];
  const x = blood.types[i] ^ van.types[i];
  (regions[r] ??= {})[x] = (regions[r][x] ?? 0) + 1;
}

let pureRegions = 0, totalRegions = 0, coveredCells = 0, pureCells = 0;
const regionKeys = {};
console.log('== 各区域 XOR 差值分布(只列前20个区域) ==');
const regionList = Object.entries(regions).map(([r, d]) => {
  const total = Object.values(d).reduce((a, b) => a + b, 0);
  const sorted = Object.entries(d).sort((a, b) => b[1] - a[1]);
  return { r: +r, total, top: sorted[0], sorted };
}).sort((a, b) => b.total - a.total);

for (const { r, total, top, sorted } of regionList) {
  totalRegions++;
  const purity = top[1] / total;
  if (purity > 0.9) { pureRegions++; coveredCells += total; pureCells += top[1]; regionKeys[r] = +top[0]; }
  if (regionList.indexOf(regionList.find(x => x.r === r)) < 20) {
    console.log(`  区域${r} (${total}格): XOR主导值 ${top[0]}×${top[1]} (${(purity * 100).toFixed(0)}%)  次值: ${sorted.slice(1, 3).map(([k, c]) => `${k}×${c}`).join(' ')}`);
  }
}
console.log(`\n纯度>90%的区域: ${pureRegions}/${totalRegions}, 覆盖格数 ${coveredCells}/${N}`);
console.log('区域密钥表:', regionKeys);

// 如果区域XOR成立,解密后与原版一致率
let match = 0, unexplained = 0;
for (let i = 0; i < N; i++) {
  const r = blood.b1[i];
  const k = regionKeys[r];
  if (k === undefined) { unexplained++; continue; }
  if ((blood.types[i] ^ k) === van.types[i]) match++;
}
console.log(`解密后与原版一致率(已知区域): ${match}/${N - unexplained} (${(match / (N - unexplained) * 100).toFixed(1)}%)  未覆盖: ${unexplained}`);
