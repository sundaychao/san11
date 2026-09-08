// base=0 锚点测试 + sango terrain 交叉表
const fs = require('fs');
const VAN = 'C:/san11/san11_原版/San11/Media/san11pkres.bin';
const VAN_S11 = 'C:/san11/san11_原版/San11/Media/scenario/Scen000.s11';
const W = 200, H = 200, N = 40000, P = 11;
const buf = fs.readFileSync(VAN);
function plane(off, p) {
  const a = new Uint8Array(N);
  for (let i = 0; i < N; i++) a[i] = buf[off + 8 + i * P + p];
  return a;
}
const OFF = 0x1f520cb7;
const p0 = plane(OFF, 0), p4 = plane(OFF, 4), p9 = plane(OFF, 9);
const s11 = fs.readFileSync(VAN_S11);
function readTable(off, count) {
  const arr = [];
  for (let i = 0; i < count; i++) {
    const o = off + i * 18;
    arr.push({ x: s11.readUInt16LE(o), y: s11.readUInt16LE(o + 2) });
  }
  return arr;
}
const cities = readTable(0x3f4f, 42);
const passes = readTable(0x4243, 10);
const ports = readTable(0x42f7, 35);
function hist(arr) {
  const f = new Map();
  for (const v of arr) f.set(v, (f.get(v) || 0) + 1);
  return [...f.entries()].sort((a, b) => b[1] - a[1]).map(([v, c]) => `v${v}:${c}`).join(' ');
}
for (const [name, order] of [['x*200+y', 'a'], ['y*200+x', 'b']]) {
  const idx = (c) => order === 'a' ? c.x * H + c.y : c.y * W + c.x;
  console.log(`\n== order ${name} base=0 ==`);
  console.log('cities p0:', hist(cities.map((c) => p0[idx(c)])));
  console.log('ports  p0:', hist(ports.map((c) => p0[idx(c)])));
  console.log('passes p0:', hist(passes.map((c) => p0[idx(c)])));
  console.log('cities p9:', hist(cities.map((c) => p9[idx(c)])));
  console.log('ports  p9:', hist(ports.map((c) => p9[idx(c)])));
}
// 港锚 v17 反查: v17 的 35 个格子的坐标 vs ports 表坐标
console.log('\n== v17 cells coords vs port coords ==');
const v17 = [];
for (let i = 0; i < N; i++) if (p0[i] === 17) v17.push(i);
const v16 = [];
for (let i = 0; i < N; i++) if (p0[i] === 16) v16.push(i);
console.log('v17 cells (x,y):', v17.map((i) => `${Math.floor(i / H)},${i % H}`).join(' '));
console.log('ports (x,y):', ports.map((c) => `${c.x},${c.y}`).join(' '));
console.log('v16 count:', v16.length);
// sango 交叉
const dm = fs.readFileSync('C:/san11/sango_export/DefaultMap.bin');
let pos = 4;
let slen = 0, shift = 0;
while (true) { const b = dm[pos++]; slen |= (b & 0x7f) << shift; if (!(b & 0x80)) break; shift += 7; }
pos += slen;
const mapW = dm.readInt32LE(pos); pos += 4;
const mapH = dm.readInt32LE(pos); pos += 4;
const gridSize = dm.readInt32LE(pos); pos += 4;
console.log(`\nsango map=${mapW}x${mapH} grid=${gridSize}`);
const M = N;
const terr = new Uint8Array(M);
for (let i = 0; i < M; i++) terr[i] = dm[pos + i * 7];
for (const [name, order] of [['x*200+y', 'a'], ['y*200+x', 'b']]) {
  let same = 0;
  for (let x = 0; x < W; x++) for (let y = 0; y < H; y++) {
    const si = order === 'a' ? x * H + y : y * W + x;
    if (terr[si] === p0[x * H + y]) same++;
  }
  console.log(`sango terrain(order ${name}) == van p0: ${same}/${N}`);
}
// 交叉表: van p0 -> sango terrain
const xt = new Map();
for (let x = 0; x < W; x++) for (let y = 0; y < H; y++) {
  const vi = x * H + y, si = y * W + x;
  const k = p0[vi];
  if (!xt.has(k)) xt.set(k, new Map());
  const m = xt.get(k);
  m.set(terr[si], (m.get(terr[si]) || 0) + 1);
}
console.log('\nvan p0 -> sango terrain (transposed idx) top:');
for (const [k, m] of [...xt.entries()].sort((a, b) => a[0] - b[0])) {
  const tot = [...m.values()].reduce((s, c) => s + c, 0);
  const top = [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([v, c]) => `s${v}:${(c / tot * 100).toFixed(0)}%`).join(' ');
  console.log(`  v${String(k).padStart(2)} -> ${top}`);
}
