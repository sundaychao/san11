/**
 * [4791] p0 32值结构化分类 + 粗分类渲染验证。
 * 特征: 城市/港/关数、触边、最大团块、邻接海(v11)比例、团块细长度。
 * 分类: SEA(v11) / WATER(邻海高或细长水状) / MOUNTAIN(大块0城) / LAND(其余)。
 * 输出: 值->类别表 + out/blood_classified.png (与原版并排对比海岸线)。
 */
const fs = require('fs');
const zlib = require('zlib');
const MOD = 'C:/san11/xsyg/xsyg6/xsyg6/San11Pk/Media/san11pkres.bin';
const VAN = 'C:/san11/san11_原版/San11/Media/san11pkres.bin';
const BLD_S11 = 'C:/san11/xsyg/xsyg6/xsyg6/San11Pk/Media/scenario/SCEN000.S11';
const N = 40000, HDR = 8, CELL = 11, W = 200, H = 200;
function readAt(file, off, len) { const fd = fs.openSync(file, 'r'); const b = Buffer.alloc(len); fs.readSync(fd, b, 0, len, off); fs.closeSync(fd); return b; }
function readBld(buf, off, count) { const o = []; for (let k = 0; k < count; k++) { const q = off + k * 18; o.push({ x: buf.readUInt16LE(q), y: buf.readUInt16LE(q + 2) }); } return o; }
function readPlane(file, off, p) { const buf = readAt(file, off, HDR + N * CELL); const a = new Uint8Array(N); for (let i = 0; i < N; i++) a[i] = buf[HDR + i * CELL + p]; return a; }
const bld = fs.readFileSync(BLD_S11);
const cities = readBld(bld, 0x3f4f, 42), passes = readBld(bld, 0x4243, 10), ports = readBld(bld, 0x42f7, 35);
const idxOf = (b) => b.x * H + b.y;
const citySet = new Set(cities.map(idxOf)), portSet = new Set(ports.map(idxOf)), passSet = new Set(passes.map(idxOf));
const b0 = readPlane(MOD, 0x20a40cb7, 0);
const v0 = readPlane(VAN, 0x1f520cb7, 0);
const SEA = 11;

// 团块分析: 返回 {max, n, elong(最大块bbox长宽比)}
function blobs(target) {
  const seen = new Uint8Array(N); const list = [];
  for (let i = 0; i < N; i++) {
    if (b0[i] !== target || seen[i]) continue;
    const q = [i]; seen[i] = 1; let s = 0, minx = 999, maxx = -1, miny = 999, maxy = -1;
    while (q.length) { const c = q.pop(); s++; const x = Math.floor(c / H), y = c % H;
      if (x < minx) minx = x; if (x > maxx) maxx = x; if (y < miny) miny = y; if (y > maxy) maxy = y;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const nx = x + dx, ny = y + dy; if (nx < 0 || nx >= W || ny < 0 || ny >= H) continue; const ni = nx * H + ny; if (!seen[ni] && b0[ni] === target) { seen[ni] = 1; q.push(ni); } } }
    list.push({ s, bbox: (maxx - minx + 1) * (maxy - miny + 1) });
  }
  list.sort((a, b) => b.s - a.s);
  const max = list[0] ? list[0].s : 0;
  const fill = list[0] ? list[0].s / list[0].bbox : 0; // 低fill=细长(河)
  return { n: list.length, max, fill };
}
// 邻海比例
function seaAdj(target) {
  let tot = 0, adj = 0;
  for (let i = 0; i < N; i++) {
    if (b0[i] !== target) continue; tot++;
    const x = Math.floor(i / H), y = i % H; let hit = false;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) { const nx = x + dx, ny = y + dy; if (nx < 0 || nx >= W || ny < 0 || ny >= H) continue; if (b0[nx * H + ny] === SEA) { hit = true; break; } }
    if (hit) adj++;
  }
  return tot ? adj / tot : 0;
}
const vals = [...new Set(b0)].sort((a, b) => a - b);
const feat = new Map();
for (const v of vals) {
  let nc = 0, np = 0, npo = 0, edge = 0, tot = 0;
  for (let i = 0; i < N; i++) { if (b0[i] !== v) continue; tot++; if (citySet.has(i)) nc++; if (passSet.has(i)) np++; if (portSet.has(i)) npo++; const x = Math.floor(i / H), y = i % H; if (x === 0 || x === W - 1 || y === 0 || y === H - 1) edge++; }
  const bl = blobs(v);
  feat.set(v, { tot, nc, np, npo, edge, n: bl.n, max: bl.max, fill: bl.fill, seaAdj: seaAdj(v) });
}
function classify(v) {
  const f = feat.get(v);
  if (v === SEA) return 'SEA';
  if (f.seaAdj > 0.5 && f.max > 200) return 'WATER';
  if (f.nc === 0 && f.npo === 0 && f.max > 400 && f.fill > 0.25) return 'MOUNTAIN';
  if (f.seaAdj > 0.35) return 'WATER';
  return 'LAND';
}
const cat = new Map();
console.log('v  tot  城 关 港 边  块数 最大块 fill  邻海%  -> 类别');
for (const v of vals) {
  const f = feat.get(v); const c = classify(v); cat.set(v, c);
  console.log(`v${String(v).padStart(2)} ${String(f.tot).padStart(5)} ${String(f.nc).padStart(2)} ${String(f.np).padStart(2)} ${String(f.npo).padStart(2)} ${String(f.edge).padStart(3)}  ${String(f.n).padStart(3)} ${String(f.max).padStart(4)} ${f.fill.toFixed(2)} ${(f.seaAdj * 100).toFixed(0).padStart(3)}  -> ${c}`);
}
const COL = { SEA: [30, 80, 200], WATER: [120, 180, 240], MOUNTAIN: [110, 90, 70], LAND: [210, 200, 150] };
function writePNG(file, w, h, rgb) {
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (w * 3 + 1)] = 0; for (let x = 0; x < w * 3; x++) raw[y * (w * 3 + 1) + 1 + x] = rgb[y * w * 3 + x]; }
  const T = []; for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; T[n] = c >>> 0; }
  const crc = (b) => { let c = 0xffffffff; for (const x of b) c = T[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (t, d) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const cb = Buffer.alloc(4); cb.writeUInt32BE(crc(td)); return Buffer.concat([l, td, cb]); };
  fs.writeFileSync(file, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 6 })), chunk('IEND', Buffer.alloc(0))]));
}
const S = 4, PW = W * S, GAP = 8, TW = PW * 2 + GAP, TH = H * S;
const img = Buffer.alloc(TW * TH * 3, 200);
function vcat(t) { if (t === 8 || t === 6 || t === 7) return 'SEA'; if (t === 14) return 'WATER'; if (t === 15) return 'MOUNTAIN'; return 'LAND'; }
for (let side = 0; side < 2; side++) {
  const ox = side * (PW + GAP); const isB = side === 0;
  for (let i = 0; i < N; i++) {
    const x = Math.floor(i / H), y = i % H;
    const c = isB ? cat.get(b0[i]) : vcat(v0[i]);
    let [r, g, b] = COL[c];
    if (citySet.has(i)) { r = 255; g = 255; b = 255; } else if (portSet.has(i)) { r = 0; g = 200; b = 220; } else if (passSet.has(i)) { r = 0; g = 0; b = 0; }
    for (let dy = 0; dy < S; dy++) for (let dx = 0; dx < S; dx++) { const p = (((y * S + dy) * TW) + ox + x * S + dx) * 3; img[p] = r; img[p + 1] = g; img[p + 2] = b; }
  }
}
writePNG('out/blood_classified.png', TW, TH, img);
console.log('\n写出 out/blood_classified.png  左=[4791]粗分类  右=原版参考  深蓝=海 浅蓝=水 棕=山 米=陆');
