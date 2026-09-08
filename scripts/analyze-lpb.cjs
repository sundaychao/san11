/**
 * 验证 SHEX0008 的 p2 (sango 称 lpB) 是否为高度：
 *   - 若是高度：崖/山应显著高，海/河应低或恒定，平地应平滑变化
 *   - 统计 p2 按地形类型的分布（min/max/均值/不同值数）
 *   - 同时统计空间平滑性：相邻格 p2 差值分布
 * 顺带对全部 11 个平面做值域-地形相关矩阵，找出任何像高度的平面
 */
const fs = require('node:fs');

const VAN = 'C:/san11/san11_原版/San11/Media/san11pkres.bin';
const MAP_OFFSET = 0x1f520cb7;
const W = 200, H = 200, N = 40000;

const fd = fs.openSync(VAN, 'r');
const buf = Buffer.alloc(8 + N * 11);
fs.readSync(fd, buf, 0, buf.length, MAP_OFFSET);
fs.closeSync(fd);
if (buf.toString('ascii', 0, 8) !== 'SHEX0008') throw new Error('bad head');

const PLANES = ['tType', 'areaId', 'p2', 'trap', 'dir', 'interior', 'defence', 'thief', 'flood', 'fire', 'ruins'];
const plane = (name) => {
  const off = PLANES.indexOf(name);
  const out = new Uint8Array(N);
  for (let i = 0; i < N; i++) out[i] = buf[8 + i * 11 + off];
  return out;
};

const T = plane('tType');
const TERRAIN_NAMES = { 0: '草地', 1: '土', 2: '砂', 3: '湿地', 4: '毒泉', 5: '森', 6: '川', 7: '河', 8: '海', 9: '荒地', 10: '主径', 11: '栈道', 12: '渡所', 13: '浅滩', 14: '岸', 15: '崖', 16: '都市', 17: '港', 18: '关所', 19: '小径' };

function hexNeighbors(q, r) {
  return q % 2 === 0
    ? [[q, r - 1], [q, r + 1], [q - 1, r - 1], [q - 1, r], [q + 1, r - 1], [q + 1, r]]
    : [[q, r - 1], [q, r + 1], [q - 1, r], [q - 1, r + 1], [q + 1, r], [q + 1, r + 1]];
}

for (const name of ['p2', 'trap', 'dir']) {
  const P = plane(name);
  console.log(`\n=== 平面 ${name} 按地形分布 ===`);
  const byT = {};
  for (let i = 0; i < N; i++) {
    const t = T[i];
    byT[t] = byT[t] ?? [];
    byT[t].push(P[i]);
  }
  for (const [t, vals] of Object.entries(byT).sort((a, b) => Number(a[0]) - Number(b[0]))) {
    const min = Math.min(...vals), max = Math.max(...vals);
    const uniq = new Set(vals);
    const mean = vals.reduce((s, v) => s + v, 0) / vals.length;
    const top = [...uniq].sort((a, b) => vals.filter((v) => v === a).length - vals.filter((v) => v === b).length).slice(-4).reverse()
      .map((v) => `${v}×${vals.filter((x) => x === v).length}`);
    console.log(`${TERRAIN_NAMES[t] ?? t}(${vals.length.toString().padStart(5)}格): 值域[${min},${max}] 均值${mean.toFixed(1)} 不同值${uniq.size} 主要:${top.join(' ')}`);
  }
  // 空间平滑性：相邻格差值
  let diffs = 0, pairs = 0;
  for (let q = 0; q < W; q++) for (let r = 0; r < H; r++) {
    for (const [nq, nr] of hexNeighbors(q, r)) {
      if (nq < 0 || nq >= W || nr < 0 || nr >= H) continue;
      const d = Math.abs(P[q * H + r] - P[nq * H + nr]);
      diffs += d; pairs++;
    }
  }
  console.log(`相邻格平均差值: ${(diffs / pairs).toFixed(2)} (高度场应 <5, 类别场通常 >10)`);
}

// p2 与崖/海的空间对照：抽几条扫描线
const P2 = plane('p2');
console.log('\n=== p2 扫描线采样 (r=100 行, q=80~100) ===');
for (let q = 80; q <= 100; q++) {
  const i = q * H + 100;
  console.log(`(${q},100) 地形=${TERRAIN_NAMES[T[i]]} p2=${P2[i]}`);
}
