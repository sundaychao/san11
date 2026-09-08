/**
 * 全平面侦查:
 * 1) 血色 pkres 中所有 SHEX* 条目 (idx/offset/size/magic)
 * 2) 血色[4863] 是否逐字节等于原版
 * 3) 血色@0x20a40cb7 的 11 个平面 -> 蒙太奇 PNG (每平面按值着色)
 */
const fs = require('fs');
const zlib = require('zlib');

const MOD = 'C:/san11/xsyg/xsyg6/xsyg6/San11Pk/Media/san11pkres.bin';
const VAN = 'C:/san11/san11_原版/San11/Media/san11pkres.bin';
const N = 40000, HDR = 8, CELL = 11, W = 200, H = 200;

function readAt(file, off, len) {
  const fd = fs.openSync(file, 'r');
  const b = Buffer.alloc(len);
  fs.readSync(fd, b, 0, len, off);
  fs.closeSync(fd);
  return b;
}
function parseDir(file) {
  const fd = fs.openSync(file, 'r');
  const fsize = fs.fstatSync(fd).size;
  const head = Buffer.alloc(16);
  fs.readSync(fd, head, 0, 16, 0);
  const count = head.readUInt32LE(4);
  const dir = Buffer.alloc(count * 8);
  fs.readSync(fd, dir, 0, count * 8, 16);
  const entries = [];
  for (let i = 0; i < count; i++) {
    const off = dir.readUInt32LE(i * 8);
    entries.push({ idx: i, off, a: dir.readUInt16LE(i * 8 + 4), b: dir.readUInt16LE(i * 8 + 6), size: (i + 1 < count ? dir.readUInt32LE((i + 1) * 8) : fsize) - off });
  }
  fs.closeSync(fd);
  return entries;
}

console.log('== 血色 pkres 中 SHEX* 条目 ==');
const me = parseDir(MOD);
const shex = [];
for (const e of me) {
  const m = readAt(MOD, e.off, 8).toString('ascii', 0, 8);
  if (m.startsWith('SHEX')) shex.push({ ...e, magic: m });
}
for (const e of shex) console.log(`  [${e.idx}] 0x${e.off.toString(16)} size=${e.size} ${e.magic} a=${e.a} b=${e.b}`);
console.log(`共 ${shex.length} 个 SHEX 条目`);

console.log('\n== 血色[4863] vs 原版 SHEX0008 逐字节 ==');
const vanE = parseDir(VAN).find((e) => readAt(VAN, e.off, 8).toString('ascii', 0, 8) === 'SHEX0008');
const b4863 = shex.find((e) => e.idx === 4863);
if (b4863 && vanE) {
  const A = readAt(MOD, b4863.off, 8 + N * CELL);
  const B = readAt(VAN, vanE.off, 8 + N * CELL);
  let d = 0;
  for (let i = 0; i < A.length; i++) if (A[i] !== B[i]) d++;
  console.log(`  diff 字节 = ${d} / ${A.length}${d === 0 ? '  -> 完全相同(陈旧原版拷贝)' : ''}`);
}

function readPlanes(file, off) {
  const buf = readAt(file, off, HDR + N * CELL);
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
function hsv2rgb(h, s, v) {
  const i = Math.floor(h * 6), f = h * 6 - i;
  const p = v * (1 - s), q = v * (1 - f * s), t = v * (1 - (1 - f) * s);
  switch (i % 6) {
    case 0: return [v, t, p]; case 1: return [q, v, p]; case 2: return [p, v, t];
    case 3: return [p, q, v]; case 4: return [t, p, v]; default: return [v, p, q];
  }
}
function writePNG(file, w, h, rgb) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 2;
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 3 + 1)] = 0;
    for (let x = 0; x < w * 3; x++) raw[y * (w * 3 + 1) + 1 + x] = rgb[y * w * 3 + x];
  }
  const T = [];
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; T[n] = c >>> 0; }
  const crc = (b) => { let c = 0xffffffff; for (const x of b) c = T[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (t, d) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(d.length);
    const td = Buffer.concat([Buffer.from(t), d]);
    const cb = Buffer.alloc(4); cb.writeUInt32BE(crc(td));
    return Buffer.concat([len, td, cb]);
  };
  fs.writeFileSync(file, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 6 })), chunk('IEND', Buffer.alloc(0))]));
}

const blood = readPlanes(MOD, 0x20a40cb7);
console.log('\n== 血色@0x20a40cb7 各平面值数 ==');
for (let p = 0; p < 11; p++) {
  const hh = hist(blood[p]);
  console.log(`  p${p}: distinct=${hh.length} top: ${hh.slice(0, 5).map(([v, c]) => `v${v}×${c}`).join(' ')}`);
}

const COLS = 4, ROWS = 3, GAP = 6;
const TW = COLS * W + (COLS + 1) * GAP, TH = ROWS * H + (ROWS + 1) * GAP;
const img = Buffer.alloc(TW * TH * 3, 30);
for (let p = 0; p < 11; p++) {
  const hh = hist(blood[p]);
  const color = new Map();
  hh.forEach(([v], k) => {
    if (v === 0) color.set(v, [10, 10, 10]);
    else { const [r, g, b] = hsv2rgb((k * 0.6180339887) % 1, 0.85, 0.95); color.set(v, [r * 255 | 0, g * 255 | 0, b * 255 | 0]); }
  });
  const cx = p % COLS, cy = Math.floor(p / COLS);
  const ox = GAP + cx * (W + GAP), oy = GAP + cy * (H + GAP);
  for (let i = 0; i < N; i++) {
    const x = Math.floor(i / H), y = i % H;
    const c = color.get(blood[p][i]);
    const q = ((oy + y) * TW + ox + x) * 3;
    img[q] = c[0]; img[q + 1] = c[1]; img[q + 2] = c[2];
  }
}
writePNG('out/blood_all_planes.png', TW, TH, img);
console.log(`\n写出 out/blood_all_planes.png (${TW}x${TH})  格序: 行优先 p0..p10, 左上角=p0, p0值=黑`);
