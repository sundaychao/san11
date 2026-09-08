/** 分析血色图每个值的连通块结构：找 42×7 格的城市状结构 */
const fs = require('fs');

const MOD = 'C:/san11/xsyg/xsyg6/xsyg6/San11Pk/Media/san11pkres.bin';
const HEADER = 8, CELL = 11, N = 200 * 200;

function readMap(file, offset) {
  const fd = fs.openSync(file, 'r');
  const buf = Buffer.alloc(HEADER + N * CELL);
  fs.readSync(fd, buf, 0, buf.length, offset);
  fs.closeSync(fd);
  const t = new Uint8Array(N);
  for (let i = 0; i < N; i++) t[i] = buf[HEADER + i * CELL];
  return t;
}

const blood = readMap(MOD, 0x20a40cb7);
const get = (x, y) => blood[x * 200 + y];

// 6邻接（网格: 东西向 x±1 同 y；六边形相邻按 odd-q：x±1 时 y 偏移）
// 简化：先做4邻接 + 六边形修正邻居，用宽邻接（含对角）做参考
function neighbors(x, y) {
  // odd-q 垂直布局: 偶数列(x%2==0)邻居 (x,y±1),(x±1,y),(x±1,y-1... )
  // 这里直接用网格6邻: (x±1,y),(x,y±1),(x+1,y±(x%2===0?1:-1))... 为稳妥用8邻
  const out = [];
  for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
    if (dx === 0 && dy === 0) continue;
    const nx = x + dx, ny = y + dy;
    if (nx >= 0 && nx < 200 && ny >= 0 && ny < 200) out.push([nx, ny]);
  }
  return out;
}

// 对每个值做连通块（BFS，8邻接）
const visited = new Uint8Array(N);
const valueClusters = {}; // v -> [sizes]
for (let x = 0; x < 200; x++) for (let y = 0; y < 200; y++) {
  const i = x * 200 + y;
  if (visited[i]) continue;
  const v = blood[i];
  // BFS
  const stack = [[x, y]];
  visited[i] = 1;
  let size = 0;
  const cells = [];
  while (stack.length) {
    const [cx, cy] = stack.pop();
    size++;
    cells.push([cx, cy]);
    for (const [nx, ny] of neighbors(cx, cy)) {
      const ni = nx * 200 + ny;
      if (!visited[ni] && blood[ni] === v) {
        visited[ni] = 1;
        stack.push([nx, ny]);
      }
    }
  }
  (valueClusters[v] ??= []).push({ size, x, y });
}

console.log('值 | 格数 | 簇数 | 簇大小分布(前10)');
for (const v of Object.keys(valueClusters).map(Number).sort((a, b) => a - b)) {
  const clusters = valueClusters[v].sort((a, b) => b.size - a.size);
  const total = clusters.reduce((s, c) => s + c.size, 0);
  const sizeDist = {};
  for (const c of clusters) sizeDist[c.size] = (sizeDist[c.size] ?? 0) + 1;
  const distStr = Object.entries(sizeDist).sort((a, b) => b[1] - a[1]).slice(0, 6)
    .map(([sz, n]) => `${sz}格×${n}簇`).join(' ');
  console.log(`  ${String(v).padStart(2)} | ${String(total).padStart(5)} | ${String(clusters.length).padStart(4)} | ${distStr}`);
}

// 重点看值14: 簇的质心（若为城市，应有~42个大小≈7的簇）
console.log('\n== 值14 的簇详情（大小>=3） ==');
for (const c of (valueClusters[14] ?? []).filter((c) => c.size >= 3).sort((a, b) => b.size - a.size).slice(0, 50)) {
  console.log(`  簇@(${c.x},${c.y}) 大小${c.size}`);
}
