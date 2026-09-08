/**
 * 海岸线对比: 判定游戏加载 [4791] 还是 [4863]。
 * 数据驱动找 [4791] 的"水域值": 满足 (0城市) 且 (触边) 且 (大团块) 的 p0 值。
 * 渲染:
 *   左: [4791] 水域=蓝 陆=米色, 城市=白圈, 关=黑, 港=青
 *   右: [4863] 原版地形 海(v8)+河(v6,v7)+岸(v14)=蓝, 陆=米, 城市=白
 * 若[4791]水域构成合理中国海岸线 => [4791]是被加载的真图。
 */
const fs = require('fs');
const zlib = require('zlib');
const MOD = 'C:/san11/xsyg/xsyg6/xsyg6/San11Pk/Media/san11pkres.bin';
const VAN = 'C:/san11/san11_原版/San11/Media/san11pkres.bin';
const BLD_S11 = 'C:/san11/xsyg/xsyg6/xsyg6/San11Pk/Media/scenario/SCEN000.S11';
const N = 40000, HDR = 8, CELL = 11, W = 200, H = 200;
function readBld(buf, off, count) { const o = []; for (let k = 0; k < count; k++) { const q = off + k * 18; o.push({ x: buf.readUInt16LE(q), y: buf.readUInt16LE(q + 2) }); } return o; }
function readAt(file, off, len) { const fd = fs.openSync(file, 'r'); const b = Buffer.alloc(len); fs.readSync(fd, b, 0, len, off); fs.closeSync(fd); return b; }
function readPlane(file, off, p) { const buf = readAt(file, off, HDR + N * CELL); const a = new Uint8Array(N); for (let i = 0; i < N; i++) a[i] = buf[HDR + i * CELL + p]; return a; }
const bld = fs.readFileSync(BLD_S11);
const cities = readBld(bld, 0x3f4f, 42), passes = readBld(bld, 0x4243, 10), ports = readBld(bld, 0x42f7, 35);
const idxOf = (b) => b.x * H + b.y;
const citySet = new Set(cities.map(idxOf)), portSet = new Set(ports.map(idxOf)), passSet = new Set(passes.map(idxOf));

const b0 = readPlane(MOD, 0x20a40cb7, 0);
const v0 = readPlane(VAN, 0x1f520cb7, 0);

// 数据驱动: 每个值 -> 城市数, 触边数, 最大团块
function blobMax(arr, target) {
  const seen = new Uint8Array(N); let best = 0;
  for (let i = 0; i < N; i++) {
    if (arr[i] !== target || seen[i]) continue;
    const q = [i]; seen[i] = 1; let s = 0;
    while (q.length) { const c = q.pop(); s++; const x = Math.floor(c / H), y = c % H;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const nx = x + dx, ny = y + dy; if (nx < 0 || nx >= W || ny < 0 || ny >= H) continue; const ni = nx * H + ny; if (!seen[ni] && arr[ni] === target) { seen[ni] = 1; q.push(ni); } } }
    if (s > best) best = s;
  }
  return best;
}
const vals = [...new Set(b0)].sort((a, b) => a - b);
console.log('[4791] p0 值: 总数 城市数 触边数 最大团块');
const edgeCount = new Map(), cityCount = new Map(), tot = new Map();
for (const v of vals) { edgeCount.set(v, 0); cityCount.set(v, 0); tot.set(v, 0); }
for (let i = 0; i < N; i++) {
  const v = b0[i]; tot.set(v, tot.get(v) + 1);
  const x = Math.floor(i / H), y = i % H;
  if (x === 0 || x === W - 1 || y === 0 || y === H - 1) edgeCount.set(v, edgeCount.get(v) + 1);
  if (citySet.has(i)) cityCount.set(v, cityCount.get(v) + 1);
}
const waterCand = [];
for (const v of vals) {
  const bm = blobMax(b0, v);
  const line = `  v${String(v).padStart(2)}: ${String(tot.get(v)).padStart(5)} 城${cityCount.get(v)} 边${edgeCount.get(v)} 块${bm}`;
  console.log(line);
  if (cityCount.get(v) === 0 && edgeCount.get(v) > tot.get(v) * 0.03 && bm > 300) waterCand.push(v);
}
console.log(`\n[4791] 水域候选值 (0城市+多触边+大块): ${waterCand.join(',')}`);
const waterSet = new Set(waterCand);

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
function paint(ox, isBlood) {
  for (let i = 0; i < N; i++) {
    const x = Math.floor(i / H), y = i % H;
    let r, g, b;
    if (isBlood) {
      if (waterSet.has(b0[i])) { r = 70; g = 130; b = 220; }
      else { r = 225; g = 215; b = 175; }
    } else {
      const t = v0[i];
      if (t === 8 || t === 6 || t === 7 || t === 14) { r = 70; g = 130; b = 220; }
      else { r = 225; g = 215; b = 175; }
    }
    if (citySet.has(i)) { r = 255; g = 255; b = 255; }
    else if (portSet.has(i)) { r = 0; g = 220; b = 220; }
    else if (passSet.has(i)) { r = 0; g = 0; b = 0; }
    for (let dy = 0; dy < S; dy++) for (let dx = 0; dx < S; dx++) { const p = (((y * S + dy) * TW) + ox + x * S + dx) * 3; img[p] = r; img[p + 1] = g; img[p + 2] = b; }
  }
}
paint(0, true); paint(PW + GAP, false);
writePNG('out/coastline_compare.png', TW, TH, img);
console.log(`\n写出 out/coastline_compare.png (${TW}x${TH})  左=[4791]水域图  右=原版地形图`);
