/**
 * 全目录扫描：列出所有条目的头部魔数聚类，并检查哪些条目可能存高度：
 *   - 值域/梯度特征：相邻格值平滑变化（高度场自相关高）
 *   - 与已知地形的相关性：崖(15)格值高、海(8)格值低
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

// 1) 定位 0x1f520cb7 所在条目
let hostIdx = -1;
for (let i = 0; i < entries.length - 1; i++) {
  if (entries[i].offset <= MAP_OFFSET && MAP_OFFSET < entries[i + 1].offset) { hostIdx = i; break; }
}
console.log(`地图 0x${MAP_OFFSET.toString(16)} 所在条目: [${hostIdx}] off=0x${entries[hostIdx]?.offset.toString(16)}`);
for (let i = Math.max(0, hostIdx - 6); i <= hostIdx + 6 && i < entries.length; i++) {
  const e = entries[i];
  const next = entries[i + 1];
  const size = next ? next.offset - e.offset : buf.length - e.offset;
  const head8 = buf.toString('latin1', e.offset, e.offset + 8).replace(/[^\x20-\x7e]/g, '.');
  console.log(`[${i}] off=0x${e.offset.toString(16).padStart(8)} size=${String(size).padStart(8)} head="${head8}" ${e.offset === MAP_OFFSET ? '← SHEX地图' : ''}`);
}

// 2) 头部魔数聚类
console.log('\n=== 头部魔数聚类 ===');
const magics = {};
for (let i = 0; i < entries.length; i++) {
  const m = buf.toString('latin1', entries[i].offset, entries[i].offset + 4).replace(/[^\x20-\x7e]/g, '?');
  const m8 = buf.toString('latin1', entries[i].offset, entries[i].offset + 8).replace(/[^\x20-\x7e]/g, '?');
  const key = /^[A-Z0-9]{4}$/.test(m) ? m : '(binary)';
  magics[key] = magics[key] ?? { count: 0, sample: [] };
  magics[key].count++;
  if (magics[key].sample.length < 3 && /^[A-Z]{4}/.test(m8)) magics[key].sample.push(`[${i}]${m8}`);
}
for (const [m, v] of Object.entries(magics).sort((a, b) => b[1].count - a[1].count)) {
  console.log(`${m.padEnd(10)} ×${String(v.count).padStart(4)}  ${v.sample.join(' ')}`);
}
