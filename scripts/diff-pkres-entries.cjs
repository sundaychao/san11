/**
 * 全量条目对比: 原版 pkres vs 血色 pkres
 * 每个 LINK 条目: offset + size(下一offset推算) + 魔数
 * 找出: 血色新增条目 / 尺寸不同的同名序号条目
 */
const fs = require('fs');

const FILES = {
  原版: 'C:/san11/san11_原版/San11/Media/san11pkres.bin',
  血色: 'C:/san11/xsyg/xsyg6/xsyg6/San11Pk/Media/san11pkres.bin',
};

function parseEntries(file) {
  const fd = fs.openSync(file, 'r');
  const fsize = fs.fstatSync(fd).size;
  const head = Buffer.alloc(16);
  fs.readSync(fd, head, 0, 16, 0);
  if (head.toString('ascii', 0, 4) !== 'LINK') throw new Error('not LINK: ' + file);
  const count = head.readUInt32LE(4);
  const dir = Buffer.alloc(count * 8);
  fs.readSync(fd, dir, 0, count * 8, 16);
  const magicBuf = Buffer.alloc(8);
  const entries = [];
  for (let i = 0; i < count; i++) {
    const off = dir.readUInt32LE(i * 8);
    const a = dir.readUInt16LE(i * 8 + 4);
    const b = dir.readUInt16LE(i * 8 + 6);
    let next = i + 1 < count ? dir.readUInt32LE((i + 1) * 8) : fsize;
    // 目录内 offset 可能乱序? 用全局排序后的下一个
    const size = Math.max(0, next - off);
    fs.readSync(fd, magicBuf, 0, 8, off);
    entries.push({ idx: i, off, a, b, size, magic: magicBuf.toString('ascii', 0, 8).replace(/[^\x20-\x7e]/g, '.') });
  }
  fs.closeSync(fd);
  return { count, fsize, entries };
}

const res = {};
for (const [name, file] of Object.entries(FILES)) {
  res[name] = parseEntries(file);
  const r = res[name];
  console.log(`${name}: 条目=${r.count} 文件=${r.fsize} (${(r.fsize / 1048576).toFixed(1)}MB)`);
}

// 按魔数分类统计
console.log('\n== 魔数分布 ==');
for (const [name, r] of Object.entries(res)) {
  const byMagic = {};
  for (const e of r.entries) byMagic[e.magic] = (byMagic[e.magic] ?? 0) + 1;
  console.log(`  ${name}: ${Object.entries(byMagic).sort((x, y) => y[1] - x[1]).map(([m, c]) => `${m}×${c}`).join(' ')}`);
}

// 大条目 top15 对比
console.log('\n== 大条目 top15 ==');
for (const [name, r] of Object.entries(res)) {
  const sorted = [...r.entries].sort((x, y) => y.size - x.size).slice(0, 15);
  console.log(`  ${name}:`);
  for (const e of sorted) console.log(`    [${e.idx}] off=0x${e.off.toString(16)} size=${e.size} magic=${e.magic}`);
}

// SHEX 条目明细
console.log('\n== SHEX0008 条目 ==');
for (const [name, r] of Object.entries(res)) {
  const shex = r.entries.filter(e => e.magic.startsWith('SHEX'));
  console.log(`  ${name}: ${shex.map(e => `[${e.idx}] 0x${e.off.toString(16)} ${e.size}`).join(', ')}`);
}

// 序号对齐 diff: 同序号 size/魔数不同
const n = Math.min(res['原版'].count, res['血色'].count);
const diffs = [];
for (let i = 0; i < n; i++) {
  const a = res['原版'].entries[i], b = res['血色'].entries[i];
  if (a.size !== b.size || a.magic !== b.magic) diffs.push(`[${i}] 原版(${a.magic},${a.size}) vs 血色(${b.magic},${b.size})`);
}
console.log(`\n== 同序号差异条目数: ${diffs.length} / ${n} ==`);
for (const d of diffs.slice(0, 40)) console.log('  ' + d);

// 血色独有 (序号超出原版)
if (res['血色'].count > res['原版'].count) {
  console.log(`\n== 血色独有条目 [${res['原版'].count}..${res['血色'].count - 1}] ==`);
  for (const e of res['血色'].entries.slice(res['原版'].count)) {
    console.log(`  [${e.idx}] off=0x${e.off.toString(16)} size=${e.size} magic=${e.magic}`);
  }
}
