/**
 * 探测 san11pk.exe / San11.exe 中的 SHEX0008
 * 1) 多基准(0..80)城市对齐测试  2) 原始连续40000字节布局测试  3) 与原版图对比
 */
const fs = require('fs');

const ROOT = 'C:/san11/xsyg/xsyg6/xsyg6';
const VAN = 'C:/san11/san11_原版/San11/Media/san11pkres.bin';
const N = 40000;

const scen = JSON.parse(fs.readFileSync('tools/xsyg_map/Scenario1.json', 'utf8'));
const metros = Object.values(scen.citySet)
  .filter((c) => c.BuildingType === 1)
  .map((c) => ({ q: c.x - 28, r: c.y - 28 }))
  .filter((c) => c.q >= 0 && c.q < 200 && c.r >= 0 && c.r < 200);

function hexdump(buf, off, len) {
  const lines = [];
  for (let i = 0; i < len; i += 16) {
    const seg = buf.subarray(off + i, off + i + 16);
    const hex = [...seg].map((b) => b.toString(16).padStart(2, '0')).join(' ');
    lines.push(`  0x${(off + i).toString(16)}: ${hex}`);
  }
  return lines.join('\n');
}

// 城市落值测试: 地形数组 t (index=q*200+r), 基准偏移 (bx,by)
function cityTally(t, bx, by) {
  const tally = {};
  let inMap = 0;
  for (const c of metros) {
    const q = c.q + bx, r = c.r + by;
    if (q < 0 || q >= 200 || r < 0 || r >= 200) continue;
    inMap++;
    const v = t[q * 200 + r];
    tally[v] = (tally[v] ?? 0) + 1;
  }
  const sorted = Object.entries(tally).sort((a, b) => b[1] - a[1]);
  return { top: sorted[0], second: sorted[1], inMap, distinct: sorted.length };
}

const vanBuf = fs.readFileSync(VAN);
const van = new Uint8Array(N);
for (let i = 0; i < N; i++) van[i] = vanBuf[0x1f520cb7 + 8 + i * 11];

for (const [rel, extra] of [
  ['San11Pk/san11pk.exe', 200],
  ['San11Pk/San11.exe', 200],
]) {
  const buf = fs.readFileSync(`${ROOT}/${rel}`);
  let idx = 0;
  while ((idx = buf.indexOf('SHEX0008', idx)) !== -1) {
    console.log(`\n##### ${rel} SHEX0008 @0x${idx.toString(16)} (文件尾部距离 ${(buf.length - idx).toString(16)})`);
    console.log(hexdump(buf, idx, 48));

    // A) 标准 11字节/格, 多基准
    const t = new Uint8Array(N);
    for (let i = 0; i < N; i++) t[i] = buf[idx + 8 + i * 11];
    let best = null;
    for (let bx = -60; bx <= 60; bx++) {
      for (let by = -60; by <= 60; by++) {
        const r = cityTally(t, bx, by);
        if (!best || Number(r.top[1]) > Number(best.top[1])) best = { bx, by, ...r };
      }
    }
    console.log(`  11字节布局 最佳城市对齐: base=(${best.bx},${best.by}) top=${best.top?.join('×')} 次多=${best.second?.join('×')} 覆盖=${best.inMap}/42`);
    // 与原版相同率
    let same = 0;
    for (let i = 0; i < N; i++) if (t[i] === van[i]) same++;
    console.log(`  与原版byte0相同率: ${(same / N * 100).toFixed(1)}%`);

    // B) 原始连续 40000 字节 (紧跟头后), 多基准
    const tr = new Uint8Array(N);
    for (let i = 0; i < N; i++) tr[i] = buf[idx + 8 + i];
    let bestr = null;
    for (let bx = -60; bx <= 60; bx++) {
      for (let by = -60; by <= 60; by++) {
        const r = cityTally(tr, bx, by);
        if (!bestr || Number(r.top[1]) > Number(bestr.top[1])) bestr = { bx, by, ...r };
      }
    }
    console.log(`  连续布局 最佳城市对齐: base=(${bestr.bx},${bestr.by}) top=${bestr.top?.join('×')} 次多=${bestr.second?.join('×')}`);
    idx += 8;
  }
}

// C) 血色pkres 4863副本 vs 原版 逐格对比
const modBuf = fs.readFileSync(`${ROOT}/San11Pk/Media/san11pkres.bin`);
const copy = new Uint8Array(N);
for (let i = 0; i < N; i++) copy[i] = modBuf[0x26800119 + 8 + i * 11];
let diff = 0;
const diffList = [];
for (let i = 0; i < N; i++) {
  if (copy[i] !== van[i]) { diff++; if (diffList.length < 20) diffList.push(i); }
}
console.log(`\n血色4863副本 vs 原版: 差异格数 ${diff}/${N}`);
for (const i of diffList) {
  const q = Math.floor(i / 200), r = i % 200;
  console.log(`  (${q},${r}): 原版=${van[i]} 副本=${copy[i]}`);
}
