/**
 * 解码血色 #4792 p0 的 32 个地形值语义。
 * 方法：血色与原版同索引(#4792)、同朝向(identity)、同中国地理。
 * 对每个血色值 b，统计其覆盖格上的原版值分布 → 反推 b 的地形类别。
 * 原版值语义：0草地 1土地 2砂地 3湿地 4毒泉 5森林 6江河 7河道 8大海 9荒地
 *            10道路 11栈道 12桥 13渡所 14岸 15山崖 16都市 17港 18关所 19间道
 */
const fs = require('fs');
const zlib = require('zlib');

const MOD = 'C:/san11/xsyg/xsyg6/xsyg6/San11Pk/Media/san11pkres.bin';
const VAN = 'C:/san11/san11_原版/San11/Media/san11pkres.bin';
const N = 200 * 200, CELL = 11, HDR = 8;

function readP0(file, off) {
  const fd = fs.openSync(file, 'r');
  const buf = Buffer.alloc(HDR + N * CELL);
  fs.readSync(fd, buf, 0, buf.length, off);
  fs.closeSync(fd);
  const t = new Uint8Array(N);
  for (let i = 0; i < N; i++) t[i] = buf[HDR + i * CELL];
  return t;
}

const blood = readP0(MOD, 0x20a40cb7); // #4792 重写
const van = readP0(VAN, 0x1f520cb7); // 原版 #4792

const VAN_NAME = {
  0: '草地', 1: '土地', 2: '砂地', 3: '湿地', 4: '毒泉', 5: '森林', 6: '江河', 7: '河道',
  8: '大海', 9: '荒地', 10: '道路', 11: '栈道', 12: '桥', 13: '渡所', 14: '岸', 15: '山崖',
  16: '都市', 17: '港', 18: '关所', 19: '间道',
};
// 原版值 -> 粗类别
const VAN_CAT = {
  0: 'plain', 1: 'plain', 2: 'sand', 3: 'wet', 4: 'plain', 5: 'forest', 6: 'river', 7: 'river',
  8: 'sea', 9: 'plain', 10: 'road', 11: 'road', 12: 'road', 13: 'ferry', 14: 'coast', 15: 'mountain',
  16: 'city', 17: 'port', 18: 'pass', 19: 'road',
};

// 每个血色值 -> 原版值计数
const conf = new Map(); // b -> Map(vanVal -> count)
for (let i = 0; i < N; i++) {
  const b = blood[i];
  if (!conf.has(b)) conf.set(b, new Map());
  const m = conf.get(b);
  m.set(van[i], (m.get(van[i]) ?? 0) + 1);
}

console.log('== 血色 p0 值 -> 原版分布 (top) 及主导类别 ==');
console.log('b    总数   主导原版值(名)                     类别分布');
const bvals = [...conf.keys()].sort((a, b) => a - b);
const assign = {};
for (const b of bvals) {
  const m = conf.get(b);
  const total = [...m.values()].reduce((s, v) => s + v, 0);
  const byVan = [...m.entries()].sort((a, b) => b[1] - a[1]);
  // 类别聚合
  const cat = {};
  for (const [vv, c] of m) { const k = VAN_CAT[vv] ?? '?'; cat[k] = (cat[k] ?? 0) + c; }
  const byCat = Object.entries(cat).sort((a, b) => b[1] - a[1]);
  const topCat = byCat[0][0];
  assign[b] = topCat;
  const topVan = byVan.slice(0, 3).map(([vv, c]) => `${vv}${VAN_NAME[vv]}:${Math.round(c / total * 100)}%`).join(' ');
  const catStr = byCat.slice(0, 3).map(([k, c]) => `${k}:${Math.round(c / total * 100)}%`).join(' ');
  console.log(`${String(b).padStart(2)}  ${String(total).padStart(5)}  ${topVan.padEnd(38)} ${catStr}`);
}

// 反向：每个类别包含哪些血色值
console.log('\n== 反向：类别 -> 血色值(计数) ==');
const catToB = {};
for (const b of bvals) {
  const m = conf.get(b);
  const total = [...m.values()].reduce((s, v) => s + v, 0);
  const cat = {};
  for (const [vv, c] of m) { const k = VAN_CAT[vv] ?? '?'; cat[k] = (cat[k] ?? 0) + c; }
  const top = Object.entries(cat).sort((a, b) => b[1] - a[1])[0][0];
  (catToB[top] ??= []).push(`${b}(${total})`);
}
for (const [k, arr] of Object.entries(catToB).sort()) console.log(`  ${k.padEnd(9)}: ${arr.join(' ')}`);

// ---- 用类别着色渲染血色 p0，验证地理 ----
const CAT_COLOR = {
  sea: [30, 90, 190], river: [90, 150, 220], coast: [150, 190, 210],
  mountain: [70, 70, 70], forest: [40, 120, 50], road: [200, 170, 90],
  ferry: [220, 150, 70], sand: [220, 200, 140], wet: [120, 170, 150],
  plain: [150, 165, 120], city: [255, 60, 60], port: [60, 220, 220], pass: [255, 160, 0],
};
function crc32(buf) {
  let c, table = [];
  for (let n = 0; n < 256; n++) { c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; table[n] = c >>> 0; }
  let crc = 0xffffffff; for (const b of buf) crc = table[(crc ^ b) & 0xff] ^ (crc >>> 8); return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function writePNG(path, px, w, h, scale) {
  const W = w * scale, H = h * scale;
  const raw = Buffer.alloc(H * (W * 3 + 1));
  for (let y = 0; y < H; y++) { raw[y * (W * 3 + 1)] = 0; for (let x = 0; x < W; x++) { const [r, g, b] = px[Math.floor(y / scale) * w + Math.floor(x / scale)]; const o = y * (W * 3 + 1) + 1 + x * 3; raw[o] = r; raw[o + 1] = g; raw[o + 2] = b; } }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4); ihdr[8] = 8; ihdr[9] = 2;
  fs.writeFileSync(path, Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]));
  console.log('写入', path);
}
const px = new Array(N);
for (let i = 0; i < N; i++) { const x = Math.floor(i / 200), y = i % 200; px[x * 200 + y] = CAT_COLOR[assign[blood[i]]] ?? [255, 0, 255]; }
writePNG('tools/xsyg_map/blood-classified.png', px, 200, 200, 4);
