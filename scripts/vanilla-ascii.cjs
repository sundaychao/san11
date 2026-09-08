// 控制台 ASCII 降采样地图：每 5x5 区域取众数
const fs = require('fs');
const VAN = 'C:/san11/san11_原版/San11/Media/san11pkres.bin';
const W = 200, H = 200, N = 40000, P = 11, OFF = 0x1f520cb7;
const buf = fs.readFileSync(VAN);
const p0 = new Uint8Array(N);
for (let i = 0; i < N; i++) p0[i] = buf[OFF + 8 + i * P + 0];
const at = (x, y) => p0[x * H + y];
const HEX = '0123456789abcdef';
console.log('    ' + '0         1         2         3         4'.slice(0, 40));
for (let y = 0; y < H; y += 2) {
  let row = '';
  for (let x = 0; x < W; x += 2) {
    const c = {};
    for (let dx = 0; dx < 2; dx++) for (let dy = 0; dy < 2; dy++) { const v = at(x + dx, y + dy); c[v] = (c[v] || 0) + 1; }
    let best = 0, bn = -1;
    for (const [v, n] of Object.entries(c)) if (n > bn) { best = v; bn = n; }
    row += HEX[best];
  }
  console.log(String(y).padStart(3) + ' ' + row);
}
