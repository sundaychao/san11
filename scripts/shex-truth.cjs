/**
 * 决定性取证：
 * 1) LINK 目录里两个 SHEX0008 (a=46792,b=6) 的先后顺序与偏移
 * 2) [4791]@0x20a40cb7 与 [4863]@0x26800119 的原始头部+前3格字节对比
 * 3) 血色独有的 "SHEXKM\N" @0x526e59f 区域 hexdump
 */
const fs = require('fs');

const MOD = 'C:/san11/xsyg/xsyg6/xsyg6/San11Pk/Media/san11pkres.bin';
const VAN = 'C:/san11/san11_原版/San11/Media/san11pkres.bin';

function readAt(file, off, len) {
  const fd = fs.openSync(file, 'r');
  const buf = Buffer.alloc(len);
  fs.readSync(fd, buf, 0, len, off);
  fs.closeSync(fd);
  return buf;
}
function hex(b, n = b.length) {
  return [...b.subarray(0, n)].map((x) => x.toString(16).padStart(2, '0')).join(' ');
}

// ---- 1) LINK 目录：找所有 (a=46792,b=6) 条目 ----
for (const [label, file] of [['血色', MOD], ['原版', VAN]]) {
  const head = readAt(file, 0, 8);
  const magic = head.subarray(0, 4).toString('latin1');
  const count = head.readUInt32LE(4);
  console.log(`\n== ${label} LINK magic=${JSON.stringify(magic)} count=${count} ==`);
  // 目录从 offset 8 开始? 先探测：读前 16 字节
  const probe = readAt(file, 0, 32);
  console.log('  头32字节:', hex(probe));
  // 目录条目 8 字节：off u32, a u16, b u16。尝试 dirBase=8
  const dirBase = 8;
  const dirSize = count * 8;
  const dir = readAt(file, dirBase, dirSize);
  const hits = [];
  for (let i = 0; i < count; i++) {
    const off = dir.readUInt32LE(i * 8);
    const a = dir.readUInt16LE(i * 8 + 4);
    const b = dir.readUInt16LE(i * 8 + 6);
    if (a === 46792 && b === 6) hits.push({ idx: i, off });
  }
  console.log(`  SHEX0008(a=46792,b=6) 条目: ${hits.map((h) => `#${h.idx}@0x${h.off.toString(16)}`).join(' ')}`);
}

// ---- 2) 原始头部 + 前3格 ----
const OFFS = { '血色[4791]': ['MOD', 0x20a40cb7], '血色[4863]': ['MOD', 0x26800119], '原版[4791]': ['VAN', 0x1f520cb7], '原版[4863]': ['VAN', 0x252e0119] };
console.log('\n== 头部8字节 + 前3格(每格11字节) ==');
for (const [name, [src, off]] of Object.entries(OFFS)) {
  const file = src === 'MOD' ? MOD : VAN;
  const b = readAt(file, off, 8 + 33);
  console.log(`  ${name} @0x${off.toString(16)}:`);
  console.log(`    HDR: ${hex(b, 8)}`);
  console.log(`    c0 : ${hex(b.subarray(8, 19))}`);
  console.log(`    c1 : ${hex(b.subarray(19, 30))}`);
  console.log(`    c2 : ${hex(b.subarray(30, 41))}`);
}

// ---- 3) SHEXKM\N 区域 ----
const KM = 0x526e59f;
console.log(`\n== 血色 "SHEXKM\\N" @0x${KM.toString(16)} 前后 hexdump ==`);
const region = readAt(MOD, KM - 16, 16 + 96);
for (let i = 0; i < region.length; i += 16) {
  const o = KM - 16 + i;
  console.log(`  0x${o.toString(16).padStart(8, '0')}: ${hex(region.subarray(i, i + 16))}`);
}
// 该 tag 附近是否像地图：读 8 头 + 检查 stride
const km = readAt(MOD, KM, 8 + 11 * 200);
console.log('  作为cell-major 11字节读前200格 p0值:', [...Array(20)].map((_, i) => km[8 + i * 11]).join(','));
console.log('  作为连续字节读前20:', hex(km.subarray(8, 28)));
