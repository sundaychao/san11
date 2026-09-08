// 原版地图全平面解码探针
// 数据源: VAN bin 原版A @0x1f520cb7 ; 建筑坐标: VAN Scen000.s11
const fs = require('fs');
const zlib = require('zlib');

const VAN = 'C:/san11/san11_原版/San11/Media/san11pkres.bin';
const VAN_S11 = 'C:/san11/san11_原版/San11/Media/scenario/Scen000.s11';
const MAP_OFFSET = 0x1f520cb7;
const W = 200, H = 200, N = W * H, PLANES = 11;
const BASE = 28;

const buf = fs.readFileSync(VAN);
const s11 = fs.readFileSync(VAN_S11);

function planeBytes(p) {
  const out = Buffer.alloc(N);
  for (let i = 0; i < N; i++) out[i] = buf[MAP_OFFSET + 8 + i * PLANES + p];
  return out;
}

// ---- 建筑表 ----
function readTable(off, count) {
  const arr = [];
  for (let i = 0; i < count; i++) {
    const o = off + i * 18;
    const x = s11.readUInt16LE(o);
    const y = s11.readUInt16LE(o + 2);
    arr.push({ x, y, gx: x - BASE, gy: y - BASE, o });
  }
  return arr;
}
const cities = readTable(0x3f4f, 42);
const passes = readTable(0x4243, 10);
const ports = readTable(0x42f7, 35);

const planes = [];
for (let p = 0; p < PLANES; p++) planes.push(planeBytes(p));

const idx = (x, y) => x * H + y;

// ---- 1. p0 直方图 ----
console.log('=== p0 histogram ===');
const hist0 = new Map();
for (const v of planes[0]) hist0.set(v, (hist0.get(v) || 0) + 1);
for (const [v, c] of [...hist0.entries()].sort((a, b) => a[0] - b[0]))
  console.log(`v${String(v).padStart(2)}: ${String(c).padStart(6)} (${(c / N * 100).toFixed(2)}%)`);

// ---- 2. 每值空间统计 ----
console.log('\n=== p0 per-value spatial stats ===');
console.log('val count avgX avgY east% border% minx maxx miny maxy');
for (const [v] of [...hist0.entries()].sort((a, b) => a[0] - b[0])) {
  let c = 0, sx = 0, sy = 0, east = 0, border = 0;
  let minx = 999, maxx = -1, miny = 999, maxy = -1;
  for (let x = 0; x < W; x++) for (let y = 0; y < H; y++) {
    if (planes[0][idx(x, y)] !== v) continue;
    c++; sx += x; sy += y;
    if (x > 170) east++;
    if (x < 5 || x > 194 || y < 5 || y > 194) border++;
    if (x < minx) minx = x; if (x > maxx) maxx = x;
    if (y < miny) miny = y; if (y > maxy) maxy = y;
  }
  console.log(`v${String(v).padStart(2)} ${String(c).padStart(6)} ${(sx / c).toFixed(1).padStart(6)} ${(sy / c).toFixed(1).padStart(6)} ${(east / c * 100).toFixed(1).padStart(6)} ${(border / c * 100).toFixed(1).padStart(7)} ${String(minx).padStart(4)} ${String(maxx).padStart(4)} ${String(miny).padStart(4)} ${String(maxy).padStart(4)}`);
}

// ---- 3. 建筑锚点下各平面取值分布 ----
function samplePlane(pl, list, label) {
  const cnt = new Map();
  for (const b of list) {
    if (b.gx < 0 || b.gx >= W || b.gy < 0 || b.gy >= H) { console.log(`${label} OUT OF RANGE ${b.gx},${b.gy}`); continue; }
    const key = pl[idx(b.gx, b.gy)];
    cnt.set(key, (cnt.get(key) || 0) + 1);
  }
  const s = [...cnt.entries()].sort((a, b) => b[1] - a[1]).map(([v, c]) => `v${v}:${c}`).join(' ');
  console.log(`${label.padEnd(16)} ${s}`);
}
console.log('\n=== building anchor values per plane ===');
console.log('plane            cities(42)      passes(10)      ports(35)');
for (let p = 0; p < PLANES; p++) {
  const a = [], b = [], c = [];
  const acc = (list, out) => {
    const cnt = new Map();
    for (const bb of list) {
      if (bb.gx < 0 || bb.gx >= W || bb.gy < 0 || bb.gy >= H) continue;
      const v = planes[p][idx(bb.gx, bb.gy)];
      cnt.set(v, (cnt.get(v) || 0) + 1);
    }
    out.push(...[...cnt.entries()].sort((x, y) => y[1] - x[1]).map(([v, n]) => `${v}:${n}`));
  };
  acc(cities, a); acc(passes, b); acc(ports, c);
  console.log(`p${String(p).padStart(2)}            ${a.join(',').padEnd(16)} ${b.join(',').padEnd(16)} ${c.join(',').padEnd(16)}`);
}

// ---- 4. 城市名 -> p0 值 (需要城市名表; 用 offset+4..? 先跳过) ----

// ---- 5. p0 线性特征检测（道路候选：小占比+连续线状） ----
console.log('\n=== linearity score per p0 value (neighbor same-value ratio for rare values) ===');
for (const [v, c] of [...hist0.entries()].sort((a, b) => a[0] - b[0])) {
  if (c > 3000) continue;
  let same = 0, tot = 0;
  for (let x = 1; x < W - 1; x++) for (let y = 1; y < H - 1; y++) {
    if (planes[0][idx(x, y)] !== v) continue;
    for (const [dx, dy] of [[1, 0], [0, 1]]) {
      tot++;
      if (planes[0][idx(x + dx, y + dy)] === v) same++;
    }
  }
  console.log(`v${String(v).padStart(2)} count=${String(c).padStart(5)} sameNeighbor=${(same / Math.max(1, tot) * 100).toFixed(1)}%`);
}

// ---- 6. 邻接矩阵: 每值与海(最大water候选)的接触率 ----
// 找最大的“东部边境”值作为海
console.log('\n=== p0 adjacency: fraction of cells having N/E/S/W neighbor of other values (top 4 values) ===');
const topVals = [...hist0.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4).map(e => e[0]);
for (const v of topVals) {
  const adj = new Map();
  for (let x = 0; x < W; x++) for (let y = 0; y < H; y++) {
    if (planes[0][idx(x, y)] !== v) continue;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || nx >= W || ny < 0 || ny >= H) continue;
      const w = planes[0][idx(nx, ny)];
      if (w === v) continue;
      adj.set(w, (adj.get(w) || 0) + 1);
    }
  }
  const s = [...adj.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([w, c]) => `v${w}:${c}`).join(' ');
  console.log(`v${String(v).padStart(2)} neighbors: ${s}`);
}

// ---- 7. 正确朝向 PNG 渲染 (screen col=x, row=y) ----
const PAL = {
  0: [124, 168, 92], 1: [160, 144, 112], 2: [96, 128, 80], 3: [64, 96, 64],
  4: [110, 90, 70], 5: [40, 100, 50], 6: [120, 80, 60], 7: [90, 70, 55],
  8: [70, 130, 60], 9: [50, 110, 55], 10: [30, 90, 50], 11: [20, 70, 45],
  12: [60, 60, 60], 13: [80, 80, 80], 14: [100, 100, 100], 15: [120, 120, 120],
  16: [140, 140, 140], 17: [160, 160, 160], 18: [180, 180, 180], 19: [200, 200, 200],
  20: [220, 220, 220], 21: [240, 240, 240], 22: [30, 30, 30], 23: [50, 50, 50],
  24: [70, 70, 70], 25: [90, 90, 90], 26: [110, 110, 110], 27: [130, 130, 130],
  28: [150, 150, 150], 29: [170, 170, 170], 30: [190, 190, 190], 31: [210, 210, 210],
};
function writePNG(path, rgba, w, h) {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0;
    rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4);
  }
  const chunks = [];
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  function chunk(type, data) {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td) >>> 0);
    chunks.push(len, td, crc);
  }
  let crcTable = null;
  function crc32(b) {
    if (!crcTable) {
      crcTable = [];
      for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
        crcTable[n] = c >>> 0;
      }
    }
    let c = 0xffffffff;
    for (const x of b) c = crcTable[(c ^ x) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  chunks.push(sig);
  chunk('IHDR', ihdr);
  chunk('IDAT', zlib.deflateSync(raw, { level: 6 }));
  chunk('IEND', Buffer.alloc(0));
  fs.writeFileSync(path, Buffer.concat(chunks));
}

function renderPlane(p, path) {
  const scale = 3;
  const w = W * scale, h = H * scale;
  const img = Buffer.alloc(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const gx = Math.floor(x / scale), gy = Math.floor(y / scale);
    const v = planes[p][idx(gx, gy)];
    const c = PAL[v] || [255, 0, 255];
    const o = (y * w + x) * 4;
    img[o] = c[0]; img[o + 1] = c[1]; img[o + 2] = c[2]; img[o + 3] = 255;
  }
  writePNG(path, img, w, h);
}

const OUT = 'D:/MyProjects/san11/tools/xsyg_map';
renderPlane(0, OUT + '/van-p0.png');
for (let p = 1; p < PLANES; p++) {
  const h = new Map();
  for (const v of planes[p]) h.set(v, (h.get(v) || 0) + 1);
  console.log(`\np${p} histogram: ${[...h.entries()].sort((a,b)=>a[0]-b[0]).map(([v,c])=>`${v}:${c}`).join(' ')}`);
}
renderPlane(1, OUT + '/van-p1.png');
renderPlane(2, OUT + '/van-p2.png');
console.log('\nrendered van-p0.png van-p1.png van-p2.png (orientation: col=x east, row=y south)');
