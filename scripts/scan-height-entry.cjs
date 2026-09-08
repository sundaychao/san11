/**
 * 在原版 san11pkres.bin 的 LINK 目录中定位地图 SHEX0008(条目4864)附近条目，
 * 探查哪一条是高度场：
 *   - 候选尺寸：40000(200×200 单字节)、40401(201×201 顶点)、160000(40000×4 浮点)
 *   - 鉴定标准：值域 0~255 呈地形相关分布（崖高、水低、城平）
 */
const fs = require('node:fs');

const VAN = 'C:/san11/san11_原版/San11/Media/san11pkres.bin';
const MAP_OFFSET = 0x1f520cb7;

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
    entries.push({ index: i, offset: dir.readUInt32LE(i * 8), a: dir.readUInt16LE(i * 8 + 4), b: dir.readUInt16LE(i * 8 + 6) });
  }
  return entries;
}

const entries = parseDir(VAN);
const buf = fs.readFileSync(VAN);
console.log(`条目总数: ${entries.length}, 文件大小: 0x${buf.length.toString(16)}`);

// 条目 4850~4880 概览（尺寸=下一条偏移-本条偏移）
console.log('\n=== 条目 4850~4880 ===');
for (let i = 4850; i < 4881 && i < entries.length; i++) {
  const e = entries[i];
  const next = entries[i + 1];
  const size = next ? next.offset - e.offset : buf.length - e.offset;
  const head8 = buf.toString('latin1', e.offset, e.offset + 8).replace(/[^\x20-\x7e]/g, '.');
  console.log(`[${i}] off=0x${e.offset.toString(16).padStart(8)} size=${String(size).padStart(8)} a=${e.a} b=${e.b} head="${head8}"`);
}

// 在整个文件中统计尺寸恰好 40000 / 40401 的条目，并检查头部
console.log('\n=== 尺寸 40000/40401/40800(200*200*2) 的条目 ===');
for (let i = 0; i < entries.length - 1; i++) {
  const size = entries[i + 1].offset - entries[i].offset;
  if (size !== 40000 && size !== 40401 && size !== 40800) continue;
  const off = entries[i].offset;
  const head8 = buf.toString('latin1', off, off + 8).replace(/[^\x20-\x7e]/g, '.');
  // 采样统计值域
  const sample = buf.subarray(off, off + 4000);
  let min = 255, max = 0, sum = 0;
  for (const v of sample) { if (v < min) min = v; if (v > max) max = v; sum += v; }
  console.log(`[${i}] off=0x${off.toString(16).padStart(8)} size=${size} head="${head8}" 采样值域[${min},${max}] 均值${(sum / 4000).toFixed(1)}`);
}
