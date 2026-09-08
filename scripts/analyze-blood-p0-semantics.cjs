/**
 * 血色 p0 地形值语义分析
 * 1) 原版 p0 每值统计(数量/团块/包围盒) + 建筑锚点自检
 * 2) 血色 p0 每值统计 + 87 建筑锚点富集
 * 3) 原版值 -> 血色值 交叉表 (语义映射核心证据)
 * 4) 血色值与海/道路的关系 (邻接、覆盖)
 * 5) 血色各平面概览 + 关键值处其它平面落值
 */
const fs = require('fs');

const MOD = 'C:/san11/xsyg/xsyg6/xsyg6/San11Pk/Media/san11pkres.bin';
const VAN = 'C:/san11/san11_原版/San11/Media/san11pkres.bin';
const VAN_S11 = 'C:/san11/san11_原版/San11/Media/scenario/Scen000.s11';
const BLD_S11 = 'C:/san11/xsyg/xsyg6/xsyg6/San11Pk/Media/scenario/SCEN000.S11';
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

function readBld(buf, off, count) {
  const out = [];
  for (let k = 0; k < count; k++) {
    const o = off + k * 18;
    out.push({ x: buf.readUInt16LE(o), y: buf.readUInt16LE(o + 2) });
  }
  return out;
}

const vanBuf = fs.readFileSync(VAN_S11);
const bldBuf = fs.readFileSync(BLD_S11);
const vanCities = readBld(vanBuf, 0x3f4f, 42), vanPasses = readBld(vanBuf, 0x4243, 10), vanPorts = readBld(vanBuf, 0x42f7, 35);
const bldCities = readBld(bldBuf, 0x3f4f, 42), bldPasses = readBld(bldBuf, 0x4243, 10), bldPorts = readBld(bldBuf, 0x42f7, 35);
const idxOf = (b) => b.x * H + b.y;

const vp = readPlanes(VAN, 0x1f520cb7);
const bp = readPlanes(MOD, 0x20a40cb7);

function hist(arr) {
  const f = new Map();
  for (const v of arr) f.set(v, (f.get(v) ?? 0) + 1);
  return [...f.entries()].sort((a, b) => b[1] - a[1]);
}

// 4邻域 BFS 团块统计
function blobStats(arr, target) {
  const seen = new Uint8Array(N);
  let blobs = 0, maxSize = 0;
  let minx = 1e9, maxx = -1, miny = 1e9, maxy = -1;
  for (let i = 0; i < N; i++) {
    if (arr[i] !== target || seen[i]) continue;
    const q = [i]; seen[i] = 1;
    let size = 0;
    while (q.length) {
      const c = q.pop(); size++;
      const x = Math.floor(c / H), y = c % H;
      if (x < minx) minx = x; if (x > maxx) maxx = x;
      if (y < miny) miny = y; if (y > maxy) maxy = y;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || nx >= W || ny < 0 || ny >= H) continue;
        const ni = nx * H + ny;
        if (!seen[ni] && arr[ni] === target) { seen[ni] = 1; q.push(ni); }
      }
    }
    blobs++; if (size > maxSize) maxSize = size;
  }
  return { blobs, maxSize, bbox: [minx, maxx, miny, maxy] };
}

function p0Report(tag, arr, anchorGroups) {
  console.log(`\n== ${tag} p0 每值统计 (按数量降序) ==`);
  console.log('值: 数量 团块数 最大团 [bbox x1,x2,y1,y2]');
  for (const [v, c] of hist(arr)) {
    const s = blobStats(arr, v);
    console.log(`  v${v}: ${c} 团${s.blobs} 最大${s.maxSize} [${s.bbox}]`);
  }
  console.log(`-- ${tag} 锚点落值 --`);
  for (const [label, cells] of anchorGroups) {
    const local = {};
    for (const b of cells) {
      const i = idxOf(b);
      if (i < 0 || i >= N) continue;
      local[arr[i]] = (local[arr[i]] ?? 0) + 1;
    }
    const top = Object.entries(local).sort((a, b) => b[1] - a[1]);
    console.log(`  ${label}: ${top.map(([v, c]) => `v${v}×${c}`).join(' ')}`);
  }
}

p0Report('原版', vp[0], [['都市42', vanCities], ['关10', vanPasses], ['港35', vanPorts]]);
p0Report('血色', bp[0], [['都市42', bldCities], ['关10', bldPasses], ['港35', bldPorts]]);

// 交叉表: 原版值 -> 血色值
console.log('\n== 交叉表: 原版p0值 -> 血色p0值 (行内占比top4) ==');
const vanVals = hist(vp[0]).map((e) => e[0]);
for (const vv of vanVals) {
  const cells = [];
  for (let i = 0; i < N; i++) if (vp[0][i] === vv) cells.push(i);
  const t = {};
  for (const i of cells) t[bp[0][i]] = (t[bp[0][i]] ?? 0) + 1;
  const top = Object.entries(t).sort((a, b) => b[1] - a[1]).slice(0, 4);
  console.log(`  原版v${vv}(${cells.length}): ${top.map(([v, c]) => `血v${v} ${(c * 100 / cells.length).toFixed(0)}%`).join(' | ')}`);
}

// 反向: 血色值的原版来源构成
console.log('\n== 反向交叉: 血色p0值 <- 原版p0值来源构成 (top3) ==');
for (const [bv, bc] of hist(bp[0])) {
  const t = {};
  for (let i = 0; i < N; i++) if (bp[0][i] === bv) t[vp[0][i]] = (t[vp[0][i]] ?? 0) + 1;
  const top = Object.entries(t).sort((a, b) => b[1] - a[1]).slice(0, 3);
  console.log(`  血v${bv}(${bc}): ${top.map(([v, c]) => `原v${v} ${(c * 100 / bc).toFixed(0)}%`).join(' | ')}`);
}

// 血色海值 = 最大团值; 各值与海的邻接率
const seaEntry = hist(bp[0]).map(([v]) => ({ v, s: blobStats(bp[0], v).maxSize })).sort((a, b) => b.s - a.s)[0];
const SEA = seaEntry.v;
console.log(`\n血色最大团值: v${SEA} (最大团 ${seaEntry.s})`);
const adjSea = new Uint8Array(N);
for (let x = 0; x < W; x++) for (let y = 0; y < H; y++) {
  const i = x * H + y;
  if (bp[0][i] === SEA) { adjSea[i] = 1; continue; }
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const nx = x + dx, ny = y + dy;
    if (nx < 0 || nx >= W || ny < 0 || ny >= H) continue;
    if (bp[0][nx * H + ny] === SEA) { adjSea[i] = 1; break; }
  }
}
console.log('== 血色各值与海(v' + SEA + ')邻接率 ==');
for (const [bv, bc] of hist(bp[0])) {
  let n = 0;
  for (let i = 0; i < N; i++) if (bp[0][i] === bv && adjSea[i]) n++;
  if (n > 0) console.log(`  血v${bv}: ${n}/${bc} (${(n * 100 / bc).toFixed(1)}%)`);
}

// 血色各平面概览
console.log('\n== 血色各平面概览 ==');
for (let p = 0; p < P; p++) {
  const h = hist(bp[p]);
  const top = h.slice(0, 4).map(([v, c]) => `v${v}×${c}`).join(' ');
  console.log(`  p${p}: ${h.length}个值 ${top}`);
}

// 关键值处其它平面落值 (海/都市锚点)
console.log('\n== 海值格上血色各平面落值 top3 ==');
for (let p = 1; p < P; p++) {
  const t = {};
  for (let i = 0; i < N; i++) if (bp[0][i] === SEA) t[bp[p][i]] = (t[bp[p][i]] ?? 0) + 1;
  const top = Object.entries(t).sort((a, b) => b[1] - a[1]).slice(0, 3);
  console.log(`  p${p}: ${top.map(([v, c]) => `v${v}×${c}`).join(' ')}`);
}
console.log('\n== 血色都市锚点(42)上各平面落值 top3 ==');
for (let p = 0; p < P; p++) {
  const t = {};
  for (const b of bldCities) t[bp[p][idxOf(b)]] = (t[bp[p][idxOf(b)]] ?? 0) + 1;
  const top = Object.entries(t).sort((a, b) => b[1] - a[1]).slice(0, 3);
  console.log(`  p${p}: ${top.map(([v, c]) => `v${v}×${c}`).join(' ')}`);
}
