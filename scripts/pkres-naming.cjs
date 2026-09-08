/**
 * 资源命名真值:
 * 1) 找 pkres 中所有 ASCII "SHEX" 出现位置(名称字符串 vs 数据格式标签)
 * 2) dump LINK 头 + 目录前若干条, 看是否有名称表
 * 3) 找目录之后紧跟的区域里的字符串
 */
const fs = require('fs');
const MOD = 'C:/san11/xsyg/xsyg6/xsyg6/San11Pk/Media/san11pkres.bin';
const VAN = 'C:/san11/san11_原版/San11/Media/san11pkres.bin';
const fd = fs.openSync(MOD, 'r');
const size = fs.fstatSync(fd).size;
console.log(`血色 pkres size = ${size} (0x${size.toString(16)})`);
const head = Buffer.alloc(64); fs.readSync(fd, head, 0, 64, 0);
console.log('头 64 字节 hex:');
for (let i = 0; i < 64; i += 16) console.log('  ' + head.slice(i, i + 16).toString('hex').replace(/(.{2})/g, '$1 '));
console.log('  magic =', head.toString('ascii', 0, 4), ' count(u32@4) =', head.readUInt32LE(4), ' @8 =', head.readUInt32LE(8), ' @12 =', head.readUInt32LE(12));
fs.closeSync(fd);

function findAll(file, needle) {
  const buf = fs.readFileSync(file);
  const n = Buffer.from(needle); const hits = [];
  let i = 0; while ((i = buf.indexOf(n, i)) !== -1) { hits.push(i); i += 1; }
  return { hits, buf };
}
for (const [name, file] of [['原版', VAN], ['血色', MOD]]) {
  const { hits, buf } = findAll(file, 'SHEX');
  console.log(`\n${name}: "SHEX" 出现 ${hits.length} 次`);
  // 分类: 命中处前后是否是可打印名称(如 SHEX0008\0) 还是数据头
  const samples = hits.slice(0, 60);
  for (const h of samples) {
    const ctx = buf.slice(Math.max(0, h - 4), h + 12).toString('latin1').replace(/[^\x20-\x7e]/g, '.');
    // 只打印像"名称"的(前面有分隔或组成 SHEXnnnn 形式)
  }
  // 统计不同上下文
  const kinds = new Map();
  for (const h of hits) {
    const tag = buf.slice(h, h + 8).toString('latin1').replace(/[^\x20-\x7e]/g, '?');
    kinds.set(tag, (kinds.get(tag) ?? 0) + 1);
  }
  console.log('  tag 变体:', [...kinds.entries()].map(([k, c]) => `${k}×${c}`).join('  '));
  console.log('  前 10 命中偏移:', hits.slice(0, 10).map((h) => '0x' + h.toString(16)).join(' '));
  console.log('  后 10 命中偏移:', hits.slice(-10).map((h) => '0x' + h.toString(16)).join(' '));
}
