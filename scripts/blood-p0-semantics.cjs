/**
 * 血色 p0 语义决定性检验:
 * 1) 血色/原版 p0 在建筑锚点 (都市/关/港) 的取值
 * 2) 血色 p1 全直方图 (对比原版 p1 的 95 值)
 * 3) 原版p0 -> 血色p0 共现矩阵 (每个原版值的 top5)
 * 4) 前12高频值黑白掩模拼图 (红=都市锚 青=港锚 蓝=关锚)
 */
const fs = require('fs');
const zlib = require('zlib');

const MOD = 'C:/san11/xsyg/xsyg6/xsyg6/San11Pk/Media/san11pkres.bin';
const VAN = 'C:/san11/san11_原版/San11/Media/san11pkres.bin';
const BLD_S11 = 'C:/san11/xsyg/xsyg6/xsyg6/San11Pk/Media/scenario/SCEN000.S11';
const N = 40000, HDR = 8, CELL = 11, W = 200, H = 200;

function readBld(buf, off, count) {
  const out = [];
  for (let k = 0; k < count; k++) {
    const o = off + k * 18;
    out.push({ x: buf.readUInt16LE(o), y: buf.readUInt16LE(o + 2) });
  }
  return out;
}
const bldBuf = fs.readFileSync(BLD_S11);
const cities = readBld(bldBuf, 0x3f4f, 42);
const passes = readBld(bldBuf, 0x4243, 10);
const ports = readBld(bldBuf, 0x42f7, 35);
const idxOf = (b) => b.x * H + b.y;

function readPlanesAt(file, off) {
  const fd = fs.openSync(file, 'r');
  const buf = Buffer.alloc(HDR + N * CELL);
  fs.readSync(fd, buf, 0, buf.length, off);
  fs.closeSync(fd);
  if (buf.toString('ascii', 0, 8) !== 'SHEX0008') return null;
  const planes = [];
  for (let p = 0; p < 11; p++) {
    const a = new Uint8Array(N);
    for (let i = 0; i < N; i++) a[i] = buf[HDR + i * CELL + p];
    planes.push(a);
  }
  return planes;
}
function hist(arr) {
  const f = new Map();
  for (const v of arr) f.set(v, (f.get(v) ?? 0) + 1);
  return [...f.entries()].sort((a, b) => b[1] - a[1]);
}
const fmt = (h, n = 8) => h.slice(0, n).map(([v, c]) => `v${v}×${c}`).join(' ');

const blood = readPlanesAt(MOD, 0x20a40cb7);
const van = readPlanesAt(VAN, 0x1f520cb7);

console.log('== p0 @ 建筑锚点 ==');
console.log(`  原版 都市锚 p0: ${fmt(hist(cities.map((b) => van[0][idxOf(b)])), 4)}`);
console.log(`  血色 都市锚 p0: ${fmt(hist(cities.map((b) => blood[0][idxOf(b)])), 4)}`);
console.log(`  原版 关锚   p0: ${fmt(hist(passes.map((b) => van[0][idxOf(b)])), 4)}`);
console.log(`  血色 关锚   p0: ${fmt(hist(passes.map((b) => blood[0][idxOf(b)])), 4)}`);
console.log(`  原版 港锚   p0: ${fmt(hist(ports.map((b) => van[0][idxOf(b)])), 4)}`);
console.log(`  血色 港锚   p0: ${fmt(hist(ports.map((b) => blood[0][idxOf(b)])), 4)}`);

console.log('\n== p1 值域规模 ==');
console.log(`  原版 p1 distinct=${hist(van[1]).length}, 血色 p1 distinct=${hist(blood[1]).length}`);
console.log(`  血色 p1 top: ${fmt(hist(blood[1]), 6)}`);

console.log('\n== 原版p0 -> 血色p0 共现 (每原版值 top5) ==');
const vanVals = [...new Set(van[0])].sort((a, b) => a - b);
for (const vv of vanVals) {
  const m = new Map();
  let tot = 0;
  for (let i = 0; i < N; i++) {
    if (van[0][i] !== vv) continue;
    tot++;
    const bv = blood[0][i];
    m.set(bv, (m.get(bv) ?? 0) + 1);
  }
  const top = [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
  console.log(`  原v${vv}(×${tot}) -> ${top.map(([v, c]) => `v${v}:${(c / tot * 100).toFixed(0)}%`).join(' ')}`);
}

// ---- 掩模拼图 ----
function writePNG(file, w, h, rgb) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 2;
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 3 + 1)] = 0;
    for (let x = 0; x < w * 3; x++) raw[y * (w * 3 + 1) + 1 + x] = rgb[y * w * 3 + x];
  }
  const CRC_T = [];
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    CRC_T[n] = c >>> 0;
  }
  const crc = (b) => {
    let c = 0xffffffff;
    for (const x of b) c = CRC_T[(c ^ x) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (t, d) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(d.length);
    const td = Buffer.concat([Buffer.from(t), d]);
    const crcB = Buffer.alloc(4); crcB.writeUInt32BE(crc(td));
    return Buffer.concat([len, td, crcB]);
  };
  fs.writeFileSync(file, Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 6 })), chunk('IEND', Buffer.alloc(0)),
  ]));
}

const h0 = hist(blood[0]);
const top12 = h0.slice(0, 12).map(([v]) => v);
const citySet = new Set(cities.map(idxOf));
const portSet = new Set(ports.map(idxOf));
const passSet = new Set(passes.map(idxOf));

const CW = 200, GAP = 4, COLS = 4, ROWS = 3;
const TW = COLS * CW + (COLS + 1) * GAP, TH = ROWS * CW + (ROWS + 1) * GAP;
const img = Buffer.alloc(TW * TH * 3, 128);
top12.forEach((v, k) => {
  const cx = k % COLS, cy = Math.floor(k / COLS);
  const ox = GAP + cx * (CW + GAP), oy = GAP + cy * (CW + GAP);
  for (let i = 0; i < N; i++) {
    const x = Math.floor(i / H), y = i % H;
    let r, g, b;
    if (citySet.has(i)) { r = 255; g = 0; b = 0; }
    else if (portSet.has(i)) { r = 0; g = 255; b = 255; }
    else if (passSet.has(i)) { r = 0; g = 0; b = 255; }
    else if (blood[0][i] === v) { r = 0; g = 0; b = 0; }
    else { r = 235; g = 235; b = 235; }
    const p = ((oy + y) * TW + ox + x) * 3;
    img[p] = r; img[p + 1] = g; img[p + 2] = b;
  }
});
writePNG('out/blood_p0_masks.png', TW, TH, img);
console.log(`\n写出 out/blood_p0_masks.png (${TW}x${TH})`);
console.log('拼图顺序:');
top12.forEach((v, k) => console.log(`  格${k}: v${v} (${h0[k][1]}格)`));
