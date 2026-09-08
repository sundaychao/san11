/**
 * 分析 WFTX / AIMG / KOVS 条目头, 找图像尺寸信息
 */
const fs = require('fs');

const PKRES = 'C:/san11/xsyg/xsyg6/xsyg6/San11Pk/Media/san11pkres.bin';
const fd = fs.openSync(PKRES, 'r');
const head = Buffer.alloc(16);
fs.readSync(fd, head, 0, 16, 0);
const count = head.readUInt32LE(4);
const dir = Buffer.alloc(count * 8);
fs.readSync(fd, dir, 0, count * 8, 16);
const entries = [];
for (let i = 0; i < count; i++) {
  entries.push({ index: i, offset: dir.readUInt32LE(i * 8), a: dir.readUInt16LE(i * 8 + 4), b: dir.readUInt16LE(i * 8 + 6) });
}
const sorted = [...entries].sort((x, y) => x.offset - y.offset);
for (let i = 0; i < sorted.length; i++) {
  const next = i + 1 < sorted.length ? sorted[i + 1].offset : 840973179;
  sorted[i].size = next - sorted[i].offset;
}
const sizeByIndex = new Map(sorted.map(e => [e.index, e.size]));

// AIMG 条目全dump头
console.log('== AIMG 条目 ==');
const buf = Buffer.alloc(256);
for (const e of entries) {
  fs.readSync(fd, buf, 0, 256, e.offset);
  const magic = buf.toString('ascii', 0, 4);
  if (magic !== 'AIMG') continue;
  console.log(`  [${e.index}] off=0x${e.offset.toString(16)} size=${sizeByIndex.get(e.index)}`);
  console.log('    hex:', buf.subarray(0, 64).toString('hex').match(/../g).join(' '));
}

// WFTX 头部样本 (前5个) + 尺寸字段猜测
console.log('\n== WFTX 头部样本 ==');
let shown = 0;
for (const e of entries) {
  if (shown >= 8) break;
  fs.readSync(fd, buf, 0, 128, e.offset);
  if (buf.toString('ascii', 0, 4) !== 'WFTX') continue;
  shown++;
  console.log(`  [${e.index}] off=0x${e.offset.toString(16)} size=${sizeByIndex.get(e.index)} a=${e.a} b=${e.b}`);
  console.log('    hex:', buf.subarray(0, 64).toString('hex').match(/../g).join(' '));
  // 常见尺寸字段位置: 4,8,12,16,20...
  const u32 = [];
  for (let o = 4; o < 48; o += 4) u32.push(buf.readUInt32LE(o));
  console.log('    u32:', u32.join(', '));
}

// KOVS 头部样本
console.log('\n== KOVS 头部样本 ==');
shown = 0;
for (const e of entries) {
  if (shown >= 5) break;
  fs.readSync(fd, buf, 0, 64, e.offset);
  if (buf.toString('ascii', 0, 4) !== 'KOVS') continue;
  shown++;
  const u32 = [];
  for (let o = 4; o < 40; o += 4) u32.push(buf.readUInt32LE(o));
  console.log(`  [${e.index}] size=${sizeByIndex.get(e.index)} u32: ${u32.join(', ')}`);
}
fs.closeSync(fd);
