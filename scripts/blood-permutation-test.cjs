/**
 * [4791] 排列假设检验:
 * 原版布局: cell i = x*H + y (x=列0..199, y=行0..199)
 * 对 8 种二面变换 T，把建筑坐标(x,y)映射到 i=T(x,y)，
 * 统计 42 城市在 p0 上共享最多数值的个数。若某变换给出高凝聚 => 该变换是[4791]真实布局。
 */
const fs = require('fs');
const MOD = 'C:/san11/xsyg/xsyg6/xsyg6/San11Pk/Media/san11pkres.bin';
const BLD_S11 = 'C:/san11/xsyg/xsyg6/xsyg6/San11Pk/Media/scenario/SCEN000.S11';
const N = 40000, HDR = 8, CELL = 11, W = 200, H = 200;

function readBld(buf, off, count) {
  const out = [];
  for (let k = 0; k < count; k++) { const o = off + k * 18; out.push({ x: buf.readUInt16LE(o), y: buf.readUInt16LE(o + 2) }); }
  return out;
}
function readPlane(file, off, p) {
  const fd = fs.openSync(file, 'r');
  const buf = Buffer.alloc(HDR + N * CELL);
  fs.readSync(fd, buf, 0, buf.length, off);
  fs.closeSync(fd);
  const a = new Uint8Array(N);
  for (let i = 0; i < N; i++) a[i] = buf[HDR + i * CELL + p];
  return a;
}
function hist(arr) {
  const f = new Map();
  for (const v of arr) f.set(v, (f.get(v) ?? 0) + 1);
  return [...f.entries()].sort((a, b) => b[1] - a[1]);
}
const bld = fs.readFileSync(BLD_S11);
const cities = readBld(bld, 0x3f4f, 42);
const passes = readBld(bld, 0x4243, 10);
const ports = readBld(bld, 0x42f7, 35);

const transforms = {
  'A x*H+y': (x, y) => x * H + y,
  'B y*W+x': (x, y) => y * W + x,
  'C (W-1-x)*H+y': (x, y) => (W - 1 - x) * H + y,
  'D x*H+(H-1-y)': (x, y) => x * H + (H - 1 - y),
  'E (W-1-x)*H+(H-1-y)': (x, y) => (W - 1 - x) * H + (H - 1 - y),
  'F (H-1-y)*W+x': (x, y) => (H - 1 - y) * W + x,
  'G y*W+(W-1-x)': (x, y) => y * W + (W - 1 - x),
  'H (H-1-y)*W+(W-1-x)': (x, y) => (H - 1 - y) * W + (W - 1 - x),
};
const p0 = readPlane(MOD, 0x20a40cb7, 0);
const p1 = readPlane(MOD, 0x20a40cb7, 1);
console.log('map=血色[4791]  城市/关/港 各变换下 p0 最凝聚值占比 (满值=42/10/35)');
for (const [name, T] of Object.entries(transforms)) {
  const hc = hist(cities.map((b) => p0[T(b.x, b.y)]));
  const hp = hist(passes.map((b) => p0[T(b.x, b.y)]));
  const ho = hist(ports.map((b) => p0[T(b.x, b.y)]));
  console.log(`  ${name.padEnd(24)} 城${hc[0][1]}/42(v${hc[0][0]}) 关${hp[0][1]}/10(v${hp[0][0]}) 港${ho[0][1]}/35(v${ho[0][0]})`);
}
console.log('\n对照: 原版[4863] 变换A 城=39/42(v16) 关=10/10(v18) 港=35/35(v17)');
