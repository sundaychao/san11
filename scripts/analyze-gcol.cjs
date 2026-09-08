/**
 * 分析地图邻近条目：GCOL0001×4 与 K3ST0006 的内部结构，寻找高度场
 *   - GCOL: 3151883B，四份同尺寸（LOD？四象限？）
 *   - K3ST: 16793616B，疑似 3D 网格
 * 鉴定思路：找 200×200 相关的行结构 / u16 高度序列的平滑性（高度场相邻差小）
 */
const fs = require('node:fs');

const VAN = 'C:/san11/san11_原版/San11/Media/san11pkres.bin';

function parseDir(file) {
  const fd = fs.openSync(file, 'r');
  const head = Buffer.alloc(16);
  fs.readSync(fd, head, 0, 16, 0);
  const count = head.readUInt32LE(4);
  const dir = Buffer.alloc(count * 8);
  fs.readSync(fd, dir, 0, count * 8, 16);
  fs.closeSync(fd);
  const entries = [];
  for (let i = 0; i < count; i++) {
    entries.push({ index: i, offset: dir.readUInt32LE(i * 8) });
  }
  return entries;
}

const entries = parseDir(VAN);
const fd = fs.openSync(VAN, 'r');
function readAt(off, len) {
  const b = Buffer.alloc(len);
  fs.readSync(fd, b, 0, len, off);
  return b;
}

// 1) 两个 SHEX 是否一致
const a = readAt(entries[4791].offset, 440008);
const b = readAt(entries[4863].offset, 440008);
let same = a.equals(b);
console.log('SHEX[4791] vs [4863] 完全相同:', same);
if (!same) {
  let diff = 0;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) diff++;
  console.log('  差异字节数:', diff);
}

// 2) GCOL0001 头部 dump
const gcolOff = entries[4787].offset;
const g = readAt(gcolOff, 256);
console.log('\n=== GCOL0001 [4787] 前 256 字节 ===');
for (let row = 0; row < 16; row++) {
  const slice = g.subarray(row * 16, row * 16 + 16);
  const hex = [...slice].map((v) => v.toString(16).padStart(2, '0')).join(' ');
  const ascii = [...slice].map((v) => (v >= 0x20 && v < 0x7f ? String.fromCharCode(v) : '.')).join('');
  console.log(`${(row * 16).toString(16).padStart(6)}  ${hex}  ${ascii}`);
}

// 3) 四份 GCOL 是否相同
const sizes = [4787, 4788, 4789, 4790].map((i) => entries[i + 1].offset - entries[i].offset);
console.log('\n四份 GCOL 尺寸:', sizes.join(', '));
const g1 = readAt(entries[4788].offset, 64);
const g2 = readAt(entries[4789].offset, 64);
const g3 = readAt(entries[4790].offset, 64);
console.log('前 64 字节头一致 [4788]=[4787]:', g1.equals(g.subarray(0, 64)), ' [4789]:', g2.equals(g.subarray(0, 64)), ' [4790]:', g3.equals(g.subarray(0, 64)));

// 4) K3ST0006 头部 dump
const k3 = readAt(entries[4793].offset, 256);
console.log('\n=== K3ST0006 [4793] 前 256 字节 ===');
for (let row = 0; row < 16; row++) {
  const slice = k3.subarray(row * 16, row * 16 + 16);
  const hex = [...slice].map((v) => v.toString(16).padStart(2, '0')).join(' ');
  const ascii = [...slice].map((v) => (v >= 0x20 && v < 0x7f ? String.fromCharCode(v) : '.')).join('');
  console.log(`${(row * 16).toString(16).padStart(6)}  ${hex}  ${ascii}`);
}

// 5) SEFF0001 / DIST0002 / SENV0002 / OBJS0004 头部
for (const [idx, name] of [[4792, 'SEFF'], [4795, 'DIST'], [4799, 'SENV'], [4805, 'OBJS']]) {
  const e = readAt(entries[idx].offset, 48);
  console.log(`\n[${idx}] ${name}:`, [...e].map((v) => v.toString(16).padStart(2, '0')).join(' '));
}

fs.closeSync(fd);
