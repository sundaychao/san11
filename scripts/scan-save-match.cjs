/**
 * 存档逐格匹配扫描: 运行时地形块应与 pkres 血色图/原版图 高度一致
 * 采样100点快速筛 → 全量验证
 */
const fs = require('fs');
const N = 200 * 200;
function readMap(off) {
  const fd = fs.openSync('C:/san11/xsyg/xsyg6/xsyg6/San11Pk/Media/san11pkres.bin', 'r');
  const buf = Buffer.alloc(8 + N * 11);
  fs.readSync(fd, buf, 0, buf.length, off);
  fs.closeSync(fd);
  const t = new Uint8Array(N);
  for (let i = 0; i < N; i++) t[i] = buf[8 + i * 11];
  return t;
}
const blood = readMap(0x20a40cb7);
const van = readMap(0x26800119);
const save = fs.readFileSync('C:/san11/xsyg/xsyg6/xsyg6/San11Pk/Koei/San11 Tc/SaveData/Save000.s11');

// 采样点
const sample = [];
for (let k = 0; k < 100; k++) sample.push(Math.floor((k * 7919 + 13) % N)); // 分散采样

function scan(map, label) {
  const cands = [];
  for (let o = 0; o + N <= save.length; o++) {
    let m = 0;
    for (const p of sample) if (save[o + p] === map[p]) m++;
    if (m >= 90) cands.push(o);
  }
  console.log(`\n${label} 采样≥90/100 命中: ${cands.length}个`);
  for (const o of cands.slice(0, 10)) {
    let full = 0;
    for (let i = 0; i < N; i++) if (save[o + i] === map[i]) full++;
    // 值分布
    const dist = {};
    for (let i = 0; i < N; i++) dist[save[o + i]] = (dist[save[o + i]] ?? 0) + 1;
    const top = Object.entries(dist).sort((a, b) => b[1] - a[1]).slice(0, 8);
    console.log(`  偏移${o}(0x${o.toString(16)}) 全量匹配率 ${(full / N * 100).toFixed(1)}% 值top: ${top.map(([v, c]) => v + '×' + c).join(' ')}`);
  }
  return cands;
}
scan(blood, '血色图');
scan(van, '原版图');

// 额外: 扫描存档中值分布受限的40000字节窗口 (≥8种值, 全部≤63, 无超50%主导值)
console.log('\n== 通用扫描: 值域受限的窗口 ==');
let found = 0;
for (let o = 0; o + N <= save.length && found < 15; o++) {
  const dist = new Uint8Array(256);
  let over63 = 0;
  for (let i = 0; i < N; i += 4) { // 抽1/4采样加速
    const v = save[o + i];
    dist[v]++;
    if (v > 63) { over63++; if (over63 > 50) break; }
  }
  if (over63 > 50) continue;
  let nvals = 0, maxc = 0;
  for (let v = 0; v < 64; v++) { if (dist[v] > 20) nvals++; maxc = Math.max(maxc, dist[v]); }
  if (nvals >= 8 && maxc < N / 4 / 2) {
    console.log(`  偏移${o}(0x${o.toString(16)}) 1/4采样值种数=${nvals}`);
    found++;
  }
}
