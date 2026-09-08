/**
 * 血色 #4792 p0：每个地形值的空间分布。
 * major=(i/200)=东西(q)，海应集中在高 major(东)。
 * 统计：计数、major均值、东1/3(major>=134)占比、边缘贴边占比。
 * 判据：真海→东占比极高；河→细长但可内陆；误判水→东占比低/内陆散点。
 */
const fs = require('fs');
const MOD = 'C:/san11/xsyg/xsyg6/xsyg6/San11Pk/Media/san11pkres.bin';
const N = 200 * 200, CELL = 11, HDR = 8, H = 200;
const fd = fs.openSync(MOD, 'r');
const buf = Buffer.alloc(HDR + N * CELL);
fs.readSync(fd, buf, 0, buf.length, 0x20a40cb7);
fs.closeSync(fd);
const p0 = new Uint8Array(N);
for (let i = 0; i < N; i++) p0[i] = buf[HDR + i * CELL];

const stats = {};
for (let i = 0; i < N; i++) {
  const v = p0[i], major = (i / H) | 0, minor = i % H;
  const s = stats[v] || (stats[v] = { n: 0, smaj: 0, east: 0, border: 0 });
  s.n++; s.smaj += major;
  if (major >= 134) s.east++;
  if (major < 2 || major > 197 || minor < 2 || minor > 197) s.border++;
}
const WATER = new Set([0, 7, 11, 12, 15, 17]);
const rows = Object.keys(stats).map(Number).sort((a, b) => stats[b].n - stats[a].n);
console.log('值  计数  major均值  东1/3%  贴边%  类别');
for (const v of rows) {
  const s = stats[v];
  const tag = WATER.has(v) ? '水?' : '';
  console.log(
    `v${String(v).padStart(2)}  ${String(s.n).padStart(5)}  ${(s.smaj / s.n).toFixed(1).padStart(6)}   ${(100 * s.east / s.n).toFixed(0).padStart(4)}%  ${(100 * s.border / s.n).toFixed(1).padStart(4)}%  ${tag}`
  );
}
