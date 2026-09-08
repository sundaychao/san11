// 叠加 42城/35港/10关 的 ASCII 地形图
const fs = require('fs');
const VAN = 'C:/san11/san11_原版/San11/Media/san11pkres.bin';
const VAN_S11 = 'C:/san11/san11_原版/San11/Media/scenario/Scen000.s11';
const W = 200, H = 200, N = 40000, P = 11, OFF = 0x1f520cb7;
const buf = fs.readFileSync(VAN);
const s11 = fs.readFileSync(VAN_S11);
const p0 = new Uint8Array(N);
for (let i = 0; i < N; i++) p0[i] = buf[OFF + 8 + i * P + 0];
const at = (x, y) => p0[x * H + y];
function readTable(o, n) { const a = []; for (let k = 0; k < n; k++) a.push({ x: s11.readUInt16LE(o + k * 18), y: s11.readUInt16LE(o + k * 18 + 2) }); return a; }
const cities = readTable(0x3f4f, 42), passes = readTable(0x4243, 10), ports = readTable(0x42f7, 35);
const mark = {};
cities.forEach((c, i) => { mark[c.x + ',' + c.y] = String.fromCharCode(65 + (i % 26)).toLowerCase(); });
passes.forEach((c) => { mark[c.x + ',' + c.y] = '#'; });
ports.forEach((c) => { mark[c.x + ',' + c.y] = 'o'; });
const HEX = '0123456789abcdef';
console.log('x→ 0    10   20   30   40   50   60   70   80   90  100  110  120  130  140  150  160  170  180  190');
for (let y = 0; y < H; y += 2) {
  let row = '';
  for (let x = 0; x < W; x += 2) {
    let m = null;
    outer: for (let dx = 0; dx < 2; dx++) for (let dy = 0; dy < 2; dy++) { const q = mark[(x + dx) + ',' + (y + dy)]; if (q) { m = q; break outer; } }
    if (m) { row += m; continue; }
    const c = {};
    for (let dx = 0; dx < 2; dx++) for (let dy = 0; dy < 2; dy++) { const v = at(x + dx, y + dy); c[v] = (c[v] || 0) + 1; }
    let best = 0, bn = -1;
    for (const [v, n] of Object.entries(c)) if (n > bn) { best = v; bn = n; }
    row += HEX[best];
  }
  console.log(String(y).padStart(3) + '  ' + row);
}
console.log('\ncities:'); cities.forEach((c, i) => console.log(` ${i}:${c.x},${c.y}`));
console.log('\npasses:'); passes.forEach((c) => console.log(` ${c.x},${c.y}`));
console.log('\nports:'); ports.forEach((c) => console.log(` ${c.x},${c.y}`));
