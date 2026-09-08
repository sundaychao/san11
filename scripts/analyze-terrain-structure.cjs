/** 血色地图地形结构分析: 连通域 + 邻接转移 + 城市足迹 → 推断各值语义 */
const fs = require('fs');

const MOD = 'C:/san11/xsyg/xsyg6/xsyg6/San11Pk/Media/san11pkres.bin';
const BLOOD_OFFSET = 0x20a40cb7;
const HEADER = 8, CELL = 11, W = 200, H = 200, N = W * H;

const fd = fs.openSync(MOD, 'r');
const buf = Buffer.alloc(HEADER + N * CELL);
fs.readSync(fd, buf, 0, buf.length, BLOOD_OFFSET);
fs.closeSync(fd);
const t = new Uint8Array(N);
for (let i = 0; i < N; i++) t[i] = buf[HEADER + i * CELL];

// ---------- 连通域（8邻接） ----------
const seen = new Uint8Array(N);
function flood(start) {
  const stack = [start];
  const val = t[start];
  seen[start] = 1;
  const cells = [];
  while (stack.length) {
    const i = stack.pop();
    cells.push(i);
    const x = Math.floor(i / H), y = i % H;
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
      if (!dx && !dy) continue;
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || nx >= W || ny < 0 || ny >= H) continue;
      const ni = nx * H + ny;
      if (!seen[ni] && t[ni] === val) { seen[ni] = 1; stack.push(ni); }
    }
  }
  return cells;
}

const comps = {};
for (let i = 0; i < N; i++) {
  if (seen[i]) continue;
  const cells = flood(i);
  const v = t[i];
  (comps[v] ??= []).push(cells.length);
}
console.log('== 连通域分析（8邻接） ==');
console.log('值 | 总数 | 连通域数 | 最大域 | 域大小分布(前5)');
for (let v = 0; v <= 31; v++) {
  const list = (comps[v] ?? []).sort((a, b) => b - a);
  const total = list.reduce((s, x) => s + x, 0);
  console.log(` ${String(v).padStart(2)} | ${String(total).padStart(5)} | ${String(list.length).padStart(4)} | ${String(list[0] ?? 0).padStart(5)} | ${list.slice(0, 5).join(',')}`);
}

// ---------- 城市足迹地形 ----------
const scenario = JSON.parse(fs.readFileSync('tools/xsyg_map/Scenario1.json', 'utf8'));
const metros = Object.values(scenario.citySet).filter((c) => c.BuildingType === 1);
const ring = [];
for (let dx = -2; dx <= 2; dx++) for (let dy = -2; dy <= 2; dy++) if (Math.abs(dx) + Math.abs(dy) <= 2 && (dx || dy)) ring.push([dx, dy]);

console.log('\n== 城市中心±2环 地形值统计（城市应为陆地） ==');
const centerTally = {}, ringTally = {};
for (const c of metros) {
  const q = c.x - 28, r = c.y - 28;
  if (q < 0 || q >= W || r < 0 || r >= H) continue;
  const cv = t[q * H + r];
  centerTally[cv] = (centerTally[cv] ?? 0) + 1;
  for (const [dx, dy] of ring) {
    const nq = q + dx, nr = r + dy;
    if (nq < 0 || nq >= W || nr < 0 || nr >= H) continue;
    const v = t[nq * H + nr];
    ringTally[v] = (ringTally[v] ?? 0) + 1;
  }
}
console.log(' 中心:', Object.fromEntries(Object.entries(centerTally).sort((a, b) => b[1] - a[1])));
console.log(' 周围:', Object.fromEntries(Object.entries(ringTally).sort((a, b) => b[1] - a[1])));

// ---------- 邻接转移矩阵 ----------
console.log('\n== 邻接转移统计（每值最常相邻的值） ==');
const trans = {};
for (let x = 0; x < W; x++) for (let y = 0; y < H; y++) {
  const v = t[x * H + y];
  for (const [dx, dy] of [[1, 0], [0, 1], [1, 1], [1, -1]]) {
    const nx = x + dx, ny = y + dy;
    if (nx < 0 || nx >= W || ny < 0 || ny >= H) continue;
    const nv = t[nx * H + ny];
    if (nv === v) continue;
    const key = v < nv ? `${v}-${nv}` : `${nv}-${v}`;
    trans[key] = (trans[key] ?? 0) + 1;
  }
}
const byValue = {};
for (const [key, n] of Object.entries(trans)) {
  const [a, b] = key.split('-').map(Number);
  (byValue[a] ??= []).push([b, n]);
  (byValue[b] ??= []).push([a, n]);
}
for (let v = 0; v <= 31; v++) {
  const list = (byValue[v] ?? []).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([b, n]) => `${b}:${n}`);
  console.log(`  值${String(v).padStart(2)} 最常相邻: ${list.join(' ')}`);
}
