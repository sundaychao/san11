/** 确认地图条目真实大小: size = next.offset - offset, 推断网格尺寸 */
const fs = require('fs');

function parseDir(file) {
  const fd = fs.openSync(file, 'r');
  const head = Buffer.alloc(16);
  fs.readSync(fd, head, 0, 16, 0);
  if (head.toString('ascii', 0, 4) !== 'LINK') throw new Error('not LINK');
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

function stat(buf, off, fsize) {
  const magic = buf.toString('ascii', 0, 8);
  const cells = (buf.length - 8) / 11;
  // 常见网格: 200x200=40000, 220x220=48400, 250x250=62500, 256x256=65536, 160x160=25600
  const known = { 40000: '200x200', 48400: '220x220', 62500: '250x250', 65536: '256x256', 25600: '160x160', 32400: '180x180', 57600: '240x240' };
  const dims = known[cells] ?? `(cells=${cells} 无法整除11? ${((buf.length - 8) % 11)})`;
  return `${magic} 大小=${buf.length} 字节 → cells=${cells} → ${dims}`;
}

const modFile = 'C:/san11/xsyg/xsyg6/xsyg6/San11Pk/Media/san11pkres.bin';
const vanFile = 'C:/san11/san11_原版/San11/Media/san11pkres.bin';
const fsize = fs.statSync(modFile).size;

const mod = parseDir(modFile);
const van = parseDir(vanFile);

function probe(entries, file, targetOff, label) {
  const idx = entries.findIndex((e) => e.offset === targetOff);
  if (idx === -1) { console.log(label, '未在LINK目录找到'); return; }
  // 目录偏移一般升序; 大小 = 下一条offset - 本条offset
  let next = entries[idx + 1]?.offset;
  if (next === undefined || next <= targetOff) next = fsize;
  const size = next - targetOff;
  const fd = fs.openSync(file, 'r');
  const buf = Buffer.alloc(Math.min(size, 440008 + 4));
  fs.readSync(fd, buf, 0, buf.length, targetOff);
  fs.closeSync(fd);
  console.log(`${label}: [${idx}] off=0x${targetOff.toString(16)} size=${size}`);
  console.log(`  ${stat(buf, targetOff, fsize)}`);
  // 打印前后3条目录项帮助确认边界
  for (let i = Math.max(0, idx - 2); i <= Math.min(entries.length - 1, idx + 2); i++) {
    console.log(`    [${i}] off=0x${entries[i].offset.toString(16)}`);
  }
}

probe(van, vanFile, 0x1f520cb7, '原版地图A');
probe(van, vanFile, 0x252e0119, '原版地图B');
probe(mod, modFile, 0x20a40cb7, '血色地图A');
probe(mod, modFile, 0x26800119, '血色内原版拷贝B');

// 附加: 在血色pkres中扫描所有 SHEX0008 magic, 列出偏移与相邻距离
console.log('\n== 血色pkres 全文件 SHEX0008 扫描(仅列出与已知目标相关/前20个) ==');
const fd2 = fs.openSync(modFile, 'r');
const CHUNK = 8 << 20;
const overlap = 8;
let base = 0;
const hits = [];
const pat = Buffer.from('SHEX0008', 'ascii');
while (base < fsize) {
  const buf = Buffer.alloc(CHUNK + overlap);
  const n = fs.readSync(fd2, buf, 0, buf.length, base);
  if (n <= 0) break;
  let idx = 0;
  while ((idx = buf.indexOf(pat, idx)) !== -1) {
    const abs = base + idx;
    if (!hits.includes(abs)) hits.push(abs);
    idx++;
  }
  base += CHUNK;
}
fs.closeSync(fd2);
console.log(`共找到 ${hits.length} 个 SHEX0008:`, hits.slice(0, 20).map((h) => '0x' + h.toString(16)).join(', '));
