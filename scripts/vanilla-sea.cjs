// 东南海域取值 + 剩余值空间画像
const fs = require('fs');
const VAN = 'C:/san11/san11_原版/San11/Media/san11pkres.bin';
const W = 200, H = 200, N = 40000, P = 11, OFF = 0x1f520cb7;
const buf = fs.readFileSync(VAN);
const p0 = new Uint8Array(N);
for (let i = 0; i < N; i++) p0[i] = buf[OFF + 8 + i * P + 0];
const at = (x, y) => (x < 0 || x >= W || y < 0 || y >= H ? -1 : p0[x * H + y]);

console.log('东南海岸采样 (x=列/东, y=行/南):');
for (const [x, y, label] of [
  [198, 130, '浙江外海'], [198, 145, '福建外海'], [198, 160, '福建外海2'],
  [198, 175, '广东外海'], [190, 165, '福建近海'], [185, 175, '广东近岸'],
  [175, 185, '广东内陆'], [160, 185, '广西/越南北'], [100, 195, '南海北岸?'],
  [30, 190, '云南南'], [5, 100, '西部边'], [199, 5, '东北角'],
]) console.log(`  (${x},${y}) ${label} = v${at(x, y)}`);

console.log('\n最右5列 x=195..199 按 y 区段的值分布:');
for (let y0 = 0; y0 < 200; y0 += 25) {
  const c = {};
  for (let x = 195; x < 200; x++) for (let y = y0; y < y0 + 25; y++) { const v = at(x, y); c[v] = (c[v] || 0) + 1; }
  console.log(`  y ${y0}-${y0 + 24}: ${Object.entries(c).sort((a, b) => b[1] - a[1]).map(([v, n]) => `v${v}:${n}`).join(' ')}`);
}

console.log('\n各值包围盒与质心:');
for (let v = 0; v < 20; v++) {
  let n = 0, sx = 0, sy = 0, x0 = 999, x1 = -1, y0m = 999, y1m = -1;
  for (let x = 0; x < W; x++) for (let y = 0; y < H; y++) if (p0[x * H + y] === v) { n++; sx += x; sy += y; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0m) y0m = y; if (y > y1m) y1m = y; }
  if (n) console.log(`  v${String(v).padStart(2)} n=${String(n).padStart(5)} cx=${(sx / n).toFixed(0)} cy=${(sy / n).toFixed(0)} x[${x0},${x1}] y[${y0m},${y1m}]`);
}
