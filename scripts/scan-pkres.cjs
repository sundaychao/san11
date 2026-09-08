/**
 * 扫描 san11pkres.bin 中所有 SHEX 地图条目
 * 用法: node scripts/scan-pkres.cjs <pkres路径>
 */
const fs = require('fs');

const file = process.argv[2];
if (!file) {
  console.error('用法: node scripts/scan-pkres.cjs <pkres路径>');
  process.exit(1);
}

const fd = fs.openSync(file, 'r');
const size = fs.fstatSync(fd).size;
const CHUNK = 1 << 24; // 16MB
const buf = Buffer.alloc(CHUNK);
let pos = 0;
let carry = Buffer.alloc(0);
const hits = [];

while (true) {
  const n = fs.readSync(fd, buf, 0, CHUNK, pos);
  if (n === 0) break;
  let data = buf.subarray(0, n);
  if (carry.length) data = Buffer.concat([carry, data]);
  let idx = 0;
  while ((idx = data.indexOf('SHEX', idx)) !== -1) {
    hits.push(pos - carry.length + idx);
    idx += 1;
  }
  carry = Buffer.subarray ? Buffer.from(data.subarray(Math.max(0, data.length - 3))) : data.slice(Math.max(0, data.length - 3));
  pos += n;
}

console.log(`文件: ${file}`);
console.log(`大小: ${size.toLocaleString()} 字节`);
console.log(`SHEX 命中数: ${hits.length}`);
for (const h of hits) {
  const head = Buffer.alloc(32);
  fs.readSync(fd, head, 0, 32, h);
  console.log(`  offset=0x${h.toString(16)} (${h}) 头部="${head.toString('ascii', 0, 8)}" 后续hex=${head.subarray(8, 24).toString('hex')}`);
}
fs.closeSync(fd);
