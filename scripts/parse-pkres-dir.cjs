/** 解析 pkres LINK 目录：找出地图条目的索引，对比原版与 MOD */
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
    entries.push({
      index: i,
      offset: dir.readUInt32LE(i * 8),
      a: dir.readUInt16LE(i * 8 + 4),
      b: dir.readUInt16LE(i * 8 + 6),
    });
  }
  return { count, entries };
}

const modFile = 'C:/san11/xsyg/xsyg6/xsyg6/San11Pk/Media/san11pkres.bin';
const vanFile = 'C:/san11/san11_原版/San11/Media/san11pkres.bin';

const mod = parseDir(modFile);
const van = parseDir(vanFile);
console.log('MOD 条目数:', mod.count, ' 原版 条目数:', van.count);

const targets = {
  'MOD新地图(0x20a40cb7)': { file: mod, offset: 0x20a40cb7 },
  'MOD原版拷贝(0x26800119)': { file: mod, offset: 0x26800119 },
  '原版地图A(0x1f520cb7)': { file: van, offset: 0x1f520cb7 },
  '原版地图B(0x252e0119)': { file: van, offset: 0x252e0119 },
};
for (const [name, { file, offset }] of Object.entries(targets)) {
  const hits = file.entries.filter((e) => e.offset === offset);
  console.log(name, '→ 条目索引:', hits.map((h) => h.index + ` (a=${h.a},b=${h.b})`).join(', ') || '未找到');
}

// 打印地图条目附近的条目对比
console.log('\n原版 4860-4875:');
for (let i = 4860; i < van.count; i++) console.log(`  [${i}] off=0x${van.entries[i].offset.toString(16)} a=${van.entries[i].a} b=${van.entries[i].b}`);
console.log('MOD 4860-4875:');
for (let i = 4860; i < mod.count; i++) console.log(`  [${i}] off=0x${mod.entries[i].offset.toString(16)} a=${mod.entries[i].a} b=${mod.entries[i].b}`);
