/**
 * 已知明文攻击：假设血色byte0 = 原版byte0 经位置相关变换
 * 测试 XOR / ADD / 位旋转 等简单密码规律
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
  const b9 = new Uint8Array(N);
  for (let i = 0; i < N; i++) { types[i] = buf[HEADER + i * CELL]; b9[i] = buf[HEADER + i * CELL + 9]; }
  return { types, b9, buf };
}

const blood = readMap('C:/san11/xsyg/xsyg6/xsyg6/San11Pk/Media/san11pkres.bin', 0x20a40cb7);
const van = readMap('C:/san11/san11_原版/San11/Media/san11pkres.bin', 0x1f520cb7);

// 索引: i = x*200 + y (x=0..199 东西, y=0..199)
// --- 测试1: d = blood ^ vanilla, 看是否只依赖 x 或只依赖 y ---
function testDep(name, d) {
  // 按x分组: 同一x(200格)的d值种类
  let xPure = true, yPure = true;
  for (let x = 0; x < 200 && (xPure || yPure); x++) {
    const set = new Set();
    for (let y = 0; y < 200; y++) set.add(d[x * 200 + y]);
    if (set.size > 4) xPure = false; // 容忍少量
  }
  for (let y = 0; y < 200 && (xPure || yPure); y++) {
    const set = new Set();
    for (let x = 0; x < 200; x++) set.add(d[x * 200 + y]);
    if (set.size > 4) yPure = false;
  }
  console.log(`${name}: 只依赖x=${xPure} 只依赖y=${yPure}`);
  // d 值分布
  const dist = {};
  for (const v of d) dist[v] = (dist[v] ?? 0) + 1;
  const top = Object.entries(dist).sort((a, b) => b[1] - a[1]).slice(0, 8);
  console.log(`  d分布top: ${top.map(([k, c]) => `${k}×${c}`).join(' ')} (共${Object.keys(dist).length}种)`);
}

const xorD = new Uint8Array(N), addD = new Uint8Array(N), subD = new Uint8Array(N);
for (let i = 0; i < N; i++) {
  xorD[i] = blood.types[i] ^ van.types[i];
  addD[i] = (blood.types[i] - van.types[i]) & 0xff;
  subD[i] = (van.types[i] - blood.types[i]) & 0xff;
}
testDep('XOR差', xorD);
testDep('ADD差(blood-van)', addD);

// --- 测试2: 看blood值与vanilla值的交叉表是否块状(说明按区域置换) ---
// --- 测试3: 检查byte9是否为密钥流: blood ^ byte9 vs vanilla ---
let m9 = 0;
for (let i = 0; i < N; i++) if ((blood.types[i] ^ blood.b9[i]) === van.types[i]) m9++;
console.log(`\nblood^byte9 == vanilla: ${(m9 / N * 100).toFixed(1)}%`);

// --- 测试4: 按vanilla地形值分组,看blood值的条件分布(熵) ---
console.log('\n== 按原版地形值分组的blood值条件分布(前6) ==');
const groups = {};
for (let i = 0; i < N; i++) (groups[van.types[i]] ??= []).push(blood.types[i]);
for (const [vt, arr] of Object.entries(groups).sort((a, b) => a[0] - b[0])) {
  const d = {};
  for (const v of arr) d[v] = (d[v] ?? 0) + 1;
  const top = Object.entries(d).sort((a, b) => b[1] - a[1]).slice(0, 5);
  console.log(`  原版${vt} (${arr.length}格): ${top.map(([k, c]) => `${k}:${(c / arr.length * 100).toFixed(0)}%`).join(' ')} [${Object.keys(d).length}种]`);
}

// --- 测试5: 位置规律——固定vanilla=15(山),看blood值是否随x或y呈带状 ---
console.log('\n== 原版=15(山崖) 格子的blood值在x方向的变化 ==');
for (let x = 0; x < 200; x += 25) {
  const d = {};
  for (let y = 0; y < 200; y++) {
    const i = x * 200 + y;
    if (van.types[i] === 15) d[blood.types[i]] = (d[blood.types[i]] ?? 0) + 1;
  }
  console.log(`  x=${x}: ${Object.entries(d).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([k, c]) => `${k}×${c}`).join(' ')}`);
}
console.log('\n== 原版=15(山崖) 格子的blood值在y方向的变化 ==');
for (let y = 0; y < 200; y += 25) {
  const d = {};
  for (let x = 0; x < 200; x++) {
    const i = x * 200 + y;
    if (van.types[i] === 15) d[blood.types[i]] = (d[blood.types[i]] ?? 0) + 1;
  }
  console.log(`  y=${y}: ${Object.entries(d).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([k, c]) => `${k}×${c}`).join(' ')}`);
}
