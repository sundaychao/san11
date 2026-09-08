/**
 * 血色A 全平面城市标记搜索:
 * T1) 在原版城/关/港格位上, 各平面血色落值 vs 全图频率 (找异常值)
 * T2) 各平面每值的紧凑团块(2-12格)计数 -> 找 30~50 团块的"城市值"
 * T3) JSON bt=1 位置 3x3 邻域在各平面的落值
 */
const fs = require('fs');

const MOD = 'C:/san11/xsyg/xsyg6/xsyg6/San11Pk/Media/san11pkres.bin';
const VAN = 'C:/san11/san11_原版/San11/Media/san11pkres.bin';
const N = 40000, HDR = 8, CELL = 11, W = 200, H = 200, P = 11;

function readPlanes(file, off) {
  const fd = fs.openSync(file, 'r');
  const buf = Buffer.alloc(HDR + N * CELL);
  fs.readSync(fd, buf, 0, buf.length, off);
  fs.closeSync(fd);
  const planes = [];
  for (let p = 0; p < P; p++) {
    const a = new Uint8Array(N);
    for (let i = 0; i < N; i++) a[i] = buf[HDR + i * CELL + p];
    planes.push(a);
  }
  return planes;
}

const bp = readPlanes(MOD, 0x20a40cb7);
const vp = readPlanes(VAN, 0x1f520cb7);

function freqOf(arr) {
  const f = {};
  for (const v of arr) f[v] = (f[v] ?? 0) + 1;
  return f;
}

// 全局频率 (原版p0 定位城/关/港)
const vanP0 = vp[0];
const cityCells = [], passCells = [], portCells = [];
for (let i = 0; i < N; i++) {
  if (vanP0[i] === 16) cityCells.push(i);
  else if (vanP0[i] === 18) passCells.push(i);
  else if (vanP0[i] === 17) portCells.push(i);
}
console.log(`原版标记格数: 都市=${cityCells.length} 关=${passCells.length} 港=${portCells.length}`);

console.log('\n== T1) 标记格位上的血色各平面落值 top5 (对照全图占比) ==');
const globalFreq = bp.map(freqOf);
function probe(cells, label) {
  console.log(`  -- ${label} (${cells.length}格) --`);
  for (let p = 0; p < P; p++) {
    const local = {};
    for (const i of cells) local[bp[p][i]] = (local[bp[p][i]] ?? 0) + 1;
    const top = Object.entries(local).sort((a, b) => b[1] - a[1]).slice(0, 5);
    const enriched = top.map(([v, c]) => {
      const g = globalFreq[p][v] ?? 0;
      const lift = (c / cells.length) / (g / N);
      return `v${v}×${c}(×${lift.toFixed(1)})`;
    });
    console.log(`    p${p}: ${enriched.join(' ')}`);
  }
}
probe(cityCells, '都市格');
probe(passCells, '关格');
probe(portCells, '港格');

// 原版自身对照 (验证方法有效性: 原版平面在城格上应有富集)
console.log('\n== T1b) 原版各平面在都市格上的落值 (方法自检) ==');
const vg = vp.map(freqOf);
for (let p = 0; p < P; p++) {
  const local = {};
  for (const i of cityCells) local[vp[p][i]] = (local[vp[p][i]] ?? 0) + 1;
  const top = Object.entries(local).sort((a, b) => b[1] - a[1]).slice(0, 5);
  const enriched = top.map(([v, c]) => {
    const g = vg[p][v] ?? 0;
    const lift = (c / cityCells.length) / (g / N);
    return `v${v}×${c}(×${lift.toFixed(1)})`;
  });
  console.log(`    p${p}: ${enriched.join(' ')}`);
}

// T2) 各平面紧凑团块检测
function blobStats(arr, target) {
  const seen = new Uint8Array(N);
  let compact = 0, big = 0, maxSize = 0, total = 0;
  for (let i = 0; i < N; i++) {
    if (arr[i] !== target || seen[i]) continue;
    const q = [i]; seen[i] = 1;
    let size = 0;
    while (q.length) {
      const c = q.pop(); size++;
      const x = Math.floor(c / H), y = c % H;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || nx >= W || ny < 0 || ny >= H) continue;
        const ni = nx * H + ny;
        if (!seen[ni] && arr[ni] === target) { seen[ni] = 1; q.push(ni); }
      }
    }
    total++;
    if (size >= 2 && size <= 12) compact++;
    if (size > 12) big++;
    if (size > maxSize) maxSize = size;
  }
  return { total, compact, big, maxSize };
}

console.log('\n== T2) 血色各平面 "2-12格紧凑团块" 30~50 个的值 (城市候选) ==');
for (let p = 0; p < P; p++) {
  const f = globalFreq[p];
  const hits = [];
  for (const v of Object.keys(f).map(Number)) {
    const s = blobStats(bp[p], v);
    if (s.compact >= 30 && s.compact <= 55 && s.big <= 5) {
      hits.push(`v${v}: 团块${s.total} 紧凑${s.compact} 大块${s.big} 最大${s.maxSize}`);
    }
  }
  console.log(`  p${p}: ${hits.length ? hits.join(' | ') : '(无候选)'}`);
}

// T3) JSON bt=1 各平面 3x3 邻域
console.log('\n== T3) JSON 都市位置 3x3 邻域各平面落值 top4 ==');
const scen = JSON.parse(fs.readFileSync('tools/xsyg_map/Scenario1.json', 'utf8'));
const cities = Object.values(scen.citySet).filter(c => c.BuildingType === 1);
for (let p = 0; p < P; p++) {
  const t = {};
  for (const c of cities) {
    const gx = c.x - 28, gy = c.y - 28;
    if (gx < 0 || gx >= 200 || gy < 0 || gy >= 200) continue;
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
      const nx = gx + dx, ny = gy + dy;
      if (nx < 0 || nx >= 200 || ny < 0 || ny >= 200) continue;
      const v = bp[p][nx * 200 + ny];
      t[v] = (t[v] ?? 0) + 1;
    }
  }
  const top = Object.entries(t).sort((a, b) => b[1] - a[1]).slice(0, 4);
  console.log(`  p${p}: ${top.map(([v, c]) => `v${v}×${c}`).join(' ')}`);
}
