/**
 * 扫描血色pkres全部LINK条目: 识别格式(DDS/BMP/其他), 找小地图纹理
 */
const fs = require('fs');

const PKRES = 'C:/san11/xsyg/xsyg6/xsyg6/San11Pk/Media/san11pkres.bin';
const fd = fs.openSync(PKRES, 'r');

// 读LINK头
const head = Buffer.alloc(16);
fs.readSync(fd, head, 0, 16, 0);
if (head.toString('ascii', 0, 4) !== 'LINK') throw new Error('not LINK');
const count = head.readUInt32LE(4);
console.log('条目数:', count);

const dir = Buffer.alloc(count * 8);
fs.readSync(fd, dir, 0, count * 8, 16);

const entries = [];
for (let i = 0; i < count; i++) {
  entries.push({ index: i, offset: dir.readUInt32LE(i * 8), a: dir.readUInt16LE(i * 8 + 4), b: dir.readUInt16LE(i * 8 + 6) });
}
// 排序得到每个条目的大小
const sorted = [...entries].sort((x, y) => x.offset - y.offset);
for (let i = 0; i < sorted.length; i++) {
  const next = i + 1 < sorted.length ? sorted[i + 1].offset : 840973179;
  sorted[i].size = next - sorted[i].offset;
}
const sizeByIndex = new Map(sorted.map(e => [e.index, e.size]));

// 读每个条目头16字节识别格式
const fmtCount = {};
const interesting = [];
const headBuf = Buffer.alloc(16);
for (const e of entries) {
  fs.readSync(fd, headBuf, 0, 16, e.offset);
  const magic = headBuf.toString('ascii', 0, 4).replace(/[^\x20-\x7e]/g, '?');
  fmtCount[magic] = (fmtCount[magic] ?? 0) + 1;
  const size = sizeByIndex.get(e.index);
  // DDS纹理 / 其他图像候选
  if (magic.startsWith('DDS')) interesting.push({ ...e, size, magic });
}
console.log('头部魔数分布:', Object.fromEntries(Object.entries(fmtCount).sort((a, b) => b[1] - a[1]).slice(0, 20)));
console.log('\nDDS条目数:', interesting.length);
for (const d of interesting.slice(0, 10)) console.log(`  [${d.index}] off=0x${d.offset.toString(16)} size=${d.size} a=${d.a} b=${d.b}`);

// 找尺寸接近 200x200 / 400x400 的DDS (小地图)
const ddsHdr = Buffer.alloc(128);
console.log('\n== 全部DDS的尺寸 ==');
const ddsSizes = {};
for (const d of interesting) {
  fs.readSync(fd, ddsHdr, 0, 128, d.offset);
  // DDS头: magic(4) size(4) flags(4) height(4) width(4)
  const h = ddsHdr.readUInt32LE(12), w = ddsHdr.readUInt32LE(16);
  const key = `${w}x${h}`;
  ddsSizes[key] = (ddsSizes[key] ?? 0) + 1;
}
console.log('DDS尺寸分布:', Object.fromEntries(Object.entries(ddsSizes).sort((a, b) => b[1] - a[1]).slice(0, 30)));
fs.closeSync(fd);
