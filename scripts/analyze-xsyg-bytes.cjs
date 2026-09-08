/**
 * 分析血色pkres槽位1地图的全部11个字节平面
 * 找出哪个字节位置存的是真正的地形值
 */
const fs = require('fs');

const N = 200 * 200;
const CELL = 11;
const HEADER = 8;

function readCell(file, offset) {
  const fd = fs.openSync(file, 'r');
  const buf = Buffer.alloc(HEADER + N * CELL);
  fs.readSync(fd, buf, 0, buf.length, offset);
  fs.closeSync(fd);
  if (buf.toString('ascii', 0, 8) !== 'SHEX0008') throw new Error(`bad header @${offset.toString(16)}`);
  return buf;
}

const blood = readCell('C:/san11/xsyg/xsyg6/xsyg6/San11Pk/Media/san11pkres.bin', 0x20a40cb7);
const van = readCell('C:/san11/san11_原版/San11/Media/san11pkres.bin', 0x1f520cb7);

// 对每个字节位置 0..10: 值分布、值域、与原版同位置的差异
for (let p = 0; p < CELL; p++) {
  const bDist = {}, vDist = {};
  for (let i = 0; i < N; i++) {
    const b = blood[HEADER + i * CELL + p];
    const v = van[HEADER + i * CELL + p];
    bDist[b] = (bDist[b] ?? 0) + 1;
    vDist[v] = (vDist[v] ?? 0) + 1;
  }
  const bKeys = Object.keys(bDist).map(Number).sort((a, b) => a - b);
  const vKeys = Object.keys(vDist).map(Number).sort((a, b) => a - b);
  // 血色该平面是否与原版某平面逐格一致
  let matchVanSame = 0, matchVanByte0 = 0;
  for (let i = 0; i < N; i++) {
    if (blood[HEADER + i * CELL + p] === van[HEADER + i * CELL + p]) matchVanSame++;
    if (blood[HEADER + i * CELL + p] === van[HEADER + i * CELL]) matchVanByte0++;
  }
  console.log(`\n== 字节${p} ==`);
  console.log(`  血色值域: ${bKeys[0]}..${bKeys[bKeys.length - 1]} (${bKeys.length}种) 主导值:`,
    Object.entries(bDist).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([k, c]) => `${k}×${c}`).join(' '));
  console.log(`  原版值域: ${vKeys[0]}..${vKeys[vKeys.length - 1]} (${vKeys.length}种) 主导值:`,
    Object.entries(vDist).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([k, c]) => `${k}×${c}`).join(' '));
  console.log(`  与原版同位置一致率: ${(matchVanSame / N * 100).toFixed(1)}%  与原版byte0一致率: ${(matchVanByte0 / N * 100).toFixed(1)}%`);
}

// 检查血色地图每格 byte1(区域ID) 是否与原版一致 → 判断格子排列是否对齐
let areaSame = 0;
for (let i = 0; i < N; i++) {
  if (blood[HEADER + i * CELL + 1] === van[HEADER + i * CELL + 1]) areaSame++;
}
console.log(`\nbyte1(区域) 血色vs原版 一致率: ${(areaSame / N * 100).toFixed(1)}%`);

// 如果 byte1 一致率高 → 格子对齐、只有地形被改; 若低 → 整块数据重排/加密
for (let p = 0; p < CELL; p++) {
  let same = 0;
  for (let i = 0; i < N; i++) if (blood[HEADER + i * CELL + p] === van[HEADER + i * CELL + p]) same++;
  console.log(`  字节${p} 一致率: ${(same / N * 100).toFixed(1)}%`);
}
