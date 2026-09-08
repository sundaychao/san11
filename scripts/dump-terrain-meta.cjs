/** Dump 血色地图后紧跟的 2280 字节条目（疑似 32 种地形类型元数据表） */
const fs = require('fs');

const MOD = 'C:/san11/xsyg/xsyg6/xsyg6/San11Pk/Media/san11pkres.bin';
const fd = fs.openSync(MOD, 'r');

const MAP = 0x20a40cb7;
const MAP_SIZE = 440008;
const META = MAP + MAP_SIZE; // 0x20aac37f
const META_SIZE = 2280;

const buf = Buffer.alloc(META_SIZE);
fs.readSync(fd, buf, 0, META_SIZE, META);
fs.closeSync(fd);

console.log(`条目 @0x${META.toString(16)} (${META_SIZE} 字节)`);
console.log('== 前 128 字节 hex ==');
for (let row = 0; row < 8; row++) {
  const line = [...buf.subarray(row * 16, row * 16 + 16)].map((b) => b.toString(16).padStart(2, '0')).join(' ');
  console.log(`  +${(row * 16).toString(16).padStart(4, '0')}: ${line}`);
}

// 按 71 字节/记录（跳过8字节头）切分，找记录中的规律
console.log('\n== 按 (2280-8)/32=71 字节/记录 解析 ==');
for (let t = 0; t < 32; t++) {
  const rec = buf.subarray(8 + t * 71, 8 + (t + 1) * 71);
  const nonzero = [...rec].filter((b) => b !== 0).length;
  console.log(`  type[${t}]: ${[...rec.subarray(0, 24)].map((b) => b.toString(16).padStart(2, '0')).join(' ')}${nonzero > 24 ? ' ...' : ''}`);
}

// 也尝试整段按 16 字节网格 dump 后半部分
console.log('\n== 256..512 字节 ==');
for (let row = 16; row < 32; row++) {
  const line = [...buf.subarray(row * 16, row * 16 + 16)].map((b) => b.toString(16).padStart(2, '0')).join(' ');
  console.log(`  +${(row * 16).toString(16).padStart(4, '0')}: ${line}`);
}
