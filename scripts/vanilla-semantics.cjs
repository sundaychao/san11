// 原版 p0 语义判定 v2: 邻接图 + 地理探针 + 假设调色板渲染
const fs = require('fs');
const VAN = 'C:/san11/san11_原版/San11/Media/san11pkres.bin';
const VAN_S11 = 'C:/san11/san11_原版/San11/Media/scenario/Scen000.s11';
const W = 200, H = 200, N = 40000, P = 11;
const buf = fs.readFileSync(VAN);
const OFF = 0x1f520cb7;
function plane(p) {
  const a = new Uint8Array(N);
  for (let i = 0; i < N; i++) a[i] = buf[OFF + 8 + i * P + p];
  return a;
}
const planes = Array.from({ length: P }, (_, p) => plane(p));
const p0 = planes[0];
const idx = (x, y) => x * H + y;
const at = (x, y) => (x < 0 || x >= W || y < 0 || y >= H ? -1 : p0[idx(x, y)]);

const s11 = fs.readFileSync(VAN_S11);
function readTable(off, count) {
  const arr = [];
  for (let i = 0; i < count; i++) {
    const o = off + i * 18;
    arr.push({ x: s11.readUInt16LE(o), y: s11.readUInt16LE(o + 2), id: s11.readUInt16LE(o + 12) });
  }
  return arr;
}
const cities = readTable(0x3f4f, 42);
const passes = readTable(0x4243, 10);
const ports = readTable(0x42f7, 35);

// ---- 全值邻接图 ----
console.log('=== p0 full adjacency graph (edge counts) ===');
const adj = new Map();
for (let x = 0; x < W; x++) for (let y = 0; y < H; y++) {
  const v = at(x, y);
  for (const [dx, dy] of [[1, 0], [0, 1]]) {
    const w = at(x + dx, y + dy);
    if (w < 0 || w === v) continue;
    const k = v < w ? `${v}-${w}` : `${w}-${v}`;
    adj.set(k, (adj.get(k) || 0) + 1);
  }
}
const nbr = new Map();
for (const [k, c] of adj) {
  const [a, b] = k.split('-').map(Number);
  if (!nbr.has(a)) nbr.set(a, new Map());
  if (!nbr.has(b)) nbr.set(b, new Map());
  nbr.get(a).set(b, (nbr.get(a).get(b) || 0) + c);
  nbr.get(b).set(a, (nbr.get(b).get(a) || 0) + c);
}
for (const v of [...nbr.keys()].sort((a, b) => a - b)) {
  const s = [...nbr.get(v).entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([w, c]) => `${w}:${c}`).join(' ');
  const cnt = p0.reduce((s2, x) => s2 + (x === v ? 1 : 0), 0);
  console.log(`v${String(v).padStart(2)} (n=${String(cnt).padStart(5)}) -> ${s}`);
}

// ---- 地理探针: 指定城市周边 12x12 值构成 ----
function region(label, cx, cy, r = 6) {
  const m = new Map();
  for (let x = cx - r; x <= cx + r; x++) for (let y = cy - r; y <= cy + r; y++) {
    const v = at(x, y);
    if (v >= 0) m.set(v, (m.get(v) || 0) + 1);
  }
  console.log(`${label} (${cx},${cy}): ${[...m.entries()].sort((a, b) => b[1] - a[1]).map(([v, c]) => `v${v}:${c}`).join(' ')}`);
}
console.log('\n=== city regions (by coord; cities sorted by x as proxy) ===');
const byX = [...cities].sort((a, b) => a.x - b.x);
// 输出全部42城坐标供识别
console.log('all cities (x,y,id):', cities.map((c) => `${c.x},${c.y}#${c.id}`).join(' '));
region('极西' + byX[0].x + ',' + byX[0].y, byX[0].x, byX[0].y);
region('东南角', 160, 150);
region('东北', 150, 30);
region('中原', 110, 75);
region('长江中游', 115, 120);
region('江南', 150, 140);
region('黄河下游', 140, 55);
region('巴蜀', 55, 115);
region('西凉', 30, 60);
region('海南?', 120, 185);
region('东北外', 180, 20);

// ---- v16 城市地块分析: 每城 blob 大小、周围环带值 ----
console.log('\n=== city blob: ring values around each city (r=3..4) ===');
const ring = new Map();
for (const c of cities) {
  for (let dx = -4; dx <= 4; dx++) for (let dy = -4; dy <= 4; dy++) {
    const d = Math.max(Math.abs(dx), Math.abs(dy));
    if (d < 2 || d > 3) continue;
    const v = at(c.x + dx, c.y + dy);
    if (v >= 0 && v !== 16) ring.set(v, (ring.get(v) || 0) + 1);
  }
}
console.log('ring values:', [...ring.entries()].sort((a, b) => b[1] - a[1]).map(([v, c]) => `v${v}:${c}`).join(' '));

// ---- 关 v18 周边 ----
console.log('\n=== pass surroundings ===');
const pring = new Map();
for (const c of passes) {
  for (let dx = -3; dx <= 3; dx++) for (let dy = -3; dy <= 3; dy++) {
    const v = at(c.x + dx, c.y + dy);
    if (v >= 0 && v !== 18) pring.set(v, (pring.get(v) || 0) + 1);
  }
}
console.log('pass ring:', [...pring.entries()].sort((a, b) => b[1] - a[1]).map(([v, c]) => `v${v}:${c}`).join(' '));
for (const c of passes) console.log(`  pass(${c.x},${c.y}) ring3: ${[...new Set([...Array(49)].map((_, k) => at(c.x + (k % 7) - 3, c.y + Math.floor(k / 7) - 3)).filter(v => v >= 0 && v !== 18))].join(',')}`);

// ---- 港 v17 周边 ----
console.log('\n=== port surroundings (sea side value?) ===');
for (const c of ports.slice(0, 12)) {
  const ringVals = [];
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) ringVals.push(at(c.x + dx, c.y + dy));
  console.log(`  port(${c.x},${c.y}) N/E/S/W-adj p0: ${ringVals.join(',')}`);
}

// ---- 假设调色板渲染 ----
const zlib = require('zlib');
function writePNG(path, rgba, w, h) {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (w * 4 + 1)] = 0; rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4); }
  let crcTable = null;
  function crc32(b) {
    if (!crcTable) { crcTable = []; for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crcTable[n] = c >>> 0; } }
    let c = 0xffffffff; for (const x of b) c = crcTable[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0;
  }
  const chunks = [Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])];
  function chunk(type, data) {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
    chunks.push(len, td, crc);
  }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
  chunk('IHDR', ihdr); chunk('IDAT', zlib.deflateSync(raw, { level: 6 })); chunk('IEND', Buffer.alloc(0));
  fs.writeFileSync(path, Buffer.concat(chunks));
}
// 假设: 15=平原 0=草地 6=海 7=河 8=湖? 5=森林 1=土 2=湿地 3=? 4=森林2 9=荒地 10=道路? 14=道路? 11=山 12=山 13=山 16=城 17=港 18=关 19=山
const PAL2 = {
  0: [154, 205, 50], 1: [210, 180, 140], 2: [140, 180, 140], 3: [180, 200, 120],
  4: [34, 120, 60], 5: [0, 100, 0], 6: [30, 100, 200], 7: [80, 160, 230],
  8: [100, 180, 240], 9: [200, 160, 90], 10: [255, 200, 0], 11: [150, 110, 70],
  12: [120, 85, 55], 13: [95, 65, 45], 14: [255, 140, 0], 15: [240, 235, 205],
  16: [220, 30, 30], 17: [255, 0, 255], 18: [160, 0, 0], 19: [80, 80, 80],
};
const scale = 3, w = W * scale, h = H * scale;
const img = Buffer.alloc(w * h * 4);
for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
  const v = at(Math.floor(x / scale), Math.floor(y / scale));
  const c = PAL2[v] || [255, 0, 255];
  const o = (y * w + x) * 4;
  img[o] = c[0]; img[o + 1] = c[1]; img[o + 2] = c[2]; img[o + 3] = 255;
}
writePNG('D:/MyProjects/san11/tools/xsyg_map/van-p0-hypo.png', img, w, h);
console.log('\nrendered van-p0-hypo.png');
