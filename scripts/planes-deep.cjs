/**
 * 平面鉴定: 对血色/原版 SHEX0008 条目的 11 个字节平面做统计+城市落值+渲染
 * 判据: 地形平面上 都市/关/港 应分别稳定落在固定值, 且有高空间自相关
 */
const fs = require('fs');
const zlib = require('zlib');

const FILES = {
  blood: ['C:/san11/xsyg/xsyg6/xsyg6/San11Pk/Media/san11pkres.bin', 0x20a40cb7],
  van: ['C:/san11/san11_原版/San11/Media/san11pkres.bin', 0x1f520cb7],
};
const N = 40000, HDR = 8, CELL = 11;

const scen = JSON.parse(fs.readFileSync('tools/xsyg_map/Scenario1.json', 'utf8'));
const byType = { 1: [], 2: [], 3: [] };
for (const c of Object.values(scen.citySet)) {
  const q = c.x - 28, r = c.y - 28;
  if (q >= 0 && q < 200 && r >= 0 && r < 200) byType[c.BuildingType]?.push({ q, r, name: c.Name });
}
console.log('都市/关/港 数量:', byType[1].length, byType[2].length, byType[3].length);

function readPlanes(file, off) {
  const fd = fs.openSync(file, 'r');
  const buf = Buffer.alloc(HDR + N * CELL);
  fs.readSync(fd, buf, 0, buf.length, off);
  fs.closeSync(fd);
  const planes = [];
  for (let p = 0; p < CELL; p++) {
    const a = new Uint8Array(N);
    for (let i = 0; i < N; i++) a[i] = buf[HDR + i * CELL + p];
    planes.push(a);
  }
  return { head: buf.toString('latin1', 0, 8), planes };
}

function stats(a) {
  const dist = {};
  for (const v of a) dist[v] = (dist[v] ?? 0) + 1;
  let h = 0, hc = 0;
  for (let q = 0; q < 200; q++) for (let r = 0; r < 199; r++) { const i = q * 200 + r; hc++; if (a[i] === a[i + 1]) h++; }
  let v = 0, vc = 0;
  for (let q = 0; q < 199; q++) for (let r = 0; r < 200; r++) { const i = q * 200 + r; vc++; if (a[i] === a[i + 200]) v++; }
  return { vals: Object.keys(dist).length, h: h / hc, v: v / vc, dist };
}

function cityTally(a) {
  const t = {};
  for (const k of ['1', '2', '3']) {
    t[k] = {};
    for (const c of byType[k]) { const val = a[c.q * 200 + c.r]; t[k][val] = (t[k][val] ?? 0) + 1; }
  }
  return t;
}

const fmt = (t) => Object.entries(t).sort((x, y) => y[1] - x[1]).slice(0, 3).map(([v, c]) => `${v}×${c}`).join(' ') || '-';

for (const [label, [file, off]] of Object.entries(FILES)) {
  const { head, planes } = readPlanes(file, off);
  console.log(`\n===== ${label} @0x${off.toString(16)} head="${head}"`);
  for (let p = 0; p < CELL; p++) {
    const s = stats(planes[p]);
    const ct = cityTally(planes[p]);
    const top = Object.entries(s.dist).sort((x, y) => y[1] - x[1]).slice(0, 4).map(([v, c]) => `${v}×${c}`).join(' ');
    console.log(
      `plane${p}: 值种=${String(s.vals).padStart(3)} h同=${(s.h * 100).toFixed(0)}% v同=${(s.v * 100).toFixed(0)}%`
      + ` top[${top}] 都市[${fmt(ct[1])}] 关[${fmt(ct[2])}] 港[${fmt(ct[3])}]`,
    );
  }
}

// ---- 渲染 ----
const PALETTE = [
  [180, 220, 160], [200, 180, 130], [230, 210, 160], [120, 160, 130], [150, 120, 170],
  [60, 130, 60], [90, 150, 210], [60, 110, 200], [40, 80, 190], [190, 180, 140],
  [240, 200, 120], [170, 140, 100], [255, 120, 120], [250, 190, 130], [130, 170, 190],
  [90, 90, 90], [255, 80, 80], [255, 160, 60], [80, 200, 220], [230, 150, 200],
  [10, 60, 30], [20, 90, 40], [30, 120, 50], [40, 150, 60], [50, 180, 70],
  [200, 230, 250], [170, 210, 240], [140, 190, 230], [110, 170, 220], [80, 150, 210],
  [230, 230, 250], [200, 200, 240], [255, 0, 255], [0, 255, 255], [128, 0, 128],
  [255, 255, 0], [0, 0, 0], [255, 255, 255],
];
function crc32(buf) {
  let c, table = [];
  for (let n = 0; n < 256; n++) { c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; table[n] = c >>> 0; }
  let crc = 0xffffffff;
  for (const b of buf) crc = table[(crc ^ b) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function writePNG(path, pixels, w, h, scale) {
  const W = w * scale, H = h * scale;
  const raw = Buffer.alloc(H * (W * 3 + 1));
  for (let y = 0; y < H; y++) {
    raw[y * (W * 3 + 1)] = 0;
    for (let x = 0; x < W; x++) {
      const [r, g, b] = pixels[Math.floor(y / scale) * w + Math.floor(x / scale)];
      const o = y * (W * 3 + 1) + 1 + x * 3;
      raw[o] = r; raw[o + 1] = g; raw[o + 2] = b;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4);
  ihdr[8] = 8; ihdr[9] = 2;
  fs.writeFileSync(path, Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0)),
  ]));
}
function render(a, path) {
  const px = new Array(N);
  for (let i = 0; i < N; i++) px[i] = PALETTE[a[i]] ?? [255, 0, 255];
  writePNG(path, px, 200, 200, 3);
}

const blood = readPlanes(FILES.blood[0], FILES.blood[1]);
for (let p = 0; p < CELL; p++) render(blood.planes[p], `tools/xsyg_map/blood-p${p}.png`);
console.log('\n已渲染 blood-p0..p10.png');
