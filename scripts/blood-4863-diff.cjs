/**
 * [4863] vs 原版 41字节差异定位:
 * 报告每个差异字节的 (cell x, y, plane, 原值->血色值)。
 * 并列出 3 座迁移城市 (血色坐标 vs 原版坐标 不一致者) 的新旧格。
 * 判断差异是否集中在城市重定位处。
 */
const fs = require('fs');
const MOD = 'C:/san11/xsyg/xsyg6/xsyg6/San11Pk/Media/san11pkres.bin';
const VAN = 'C:/san11/san11_原版/San11/Media/san11pkres.bin';
const BLD_S11 = 'C:/san11/xsyg/xsyg6/xsyg6/San11Pk/Media/scenario/SCEN000.S11';
const VAN_S11 = 'C:/san11/san11_原版/San11/Media/scenario/Scen000.s11';
const N = 40000, HDR = 8, CELL = 11, W = 200, H = 200;

function readAt(file, off, len) {
  const fd = fs.openSync(file, 'r');
  const b = Buffer.alloc(len);
  fs.readSync(fd, b, 0, len, off);
  fs.closeSync(fd);
  return b;
}
function readBld(buf, off, count) {
  const out = [];
  for (let k = 0; k < count; k++) { const o = off + k * 18; out.push({ x: buf.readUInt16LE(o), y: buf.readUInt16LE(o + 2) }); }
  return out;
}
const A = readAt(MOD, 0x26800119, HDR + N * CELL); // [4863]
const B = readAt(VAN, 0x1f520cb7, HDR + N * CELL); // vanilla
const diffs = [];
for (let i = 0; i < A.length; i++) if (A[i] !== B[i]) diffs.push(i);
console.log(`差异字节数 = ${diffs.length}`);
for (const d of diffs) {
  if (d < HDR) { console.log(`  header 字节 ${d}: 原${B[d]} -> 血${A[d]}`); continue; }
  const rel = d - HDR;
  const cell = Math.floor(rel / CELL), plane = rel % CELL;
  const x = Math.floor(cell / H), y = cell % H;
  console.log(`  cell(${x},${y}) p${plane}: 原${B[d]} -> 血${A[d]}`);
}

const bloodB = fs.readFileSync(BLD_S11), vanB = fs.readFileSync(VAN_S11);
const bc = readBld(bloodB, 0x3f4f, 42), vc = readBld(vanB, 0x3f4f, 42);
console.log('\n迁移城市 (血色坐标 != 原版坐标):');
for (let k = 0; k < 42; k++) {
  if (bc[k].x !== vc[k].x || bc[k].y !== vc[k].y) console.log(`  城市#${k}: 原(${vc[k].x},${vc[k].y}) -> 血(${bc[k].x},${bc[k].y})`);
}
const bp = readBld(bloodB, 0x4243, 10), vp = readBld(vanB, 0x4243, 10);
console.log('迁移关所:');
for (let k = 0; k < 10; k++) if (bp[k].x !== vp[k].x || bp[k].y !== vp[k].y) console.log(`  关#${k}: 原(${vp[k].x},${vp[k].y}) -> 血(${bp[k].x},${bp[k].y})`);
const bpo = readBld(bloodB, 0x42f7, 35), vpo = readBld(vanB, 0x42f7, 35);
console.log('迁移港口:');
for (let k = 0; k < 35; k++) if (bpo[k].x !== vpo[k].x || bpo[k].y !== vpo[k].y) console.log(`  港#${k}: 原(${vpo[k].x},${vpo[k].y}) -> 血(${bpo[k].x},${bpo[k].y})`);
