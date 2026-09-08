/**
 * 渲染血色/原版byte0为PNG (每个值一种颜色)
 */
const fs = require('fs');
const zlib = require('zlib');

const N = 200 * 200, CELL = 11, HEADER = 8;
function readMap(file, offset) {
  const fd = fs.openSync(file, 'r');
  const buf = Buffer.alloc(HEADER + N * CELL);
  fs.readSync(fd, buf, 0, buf.length, offset);
  fs.closeSync(fd);
  const t = new Uint8Array(N);
  for (let i = 0; i < N; i++) t[i] = buf[HEADER + i * CELL];
  return t;
}

// PNG 编码 (RGBA, 无filter)
function crc32(buf) {
  let c, table = [];
  for (let n = 0; n < 256; n++) {
    c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
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
  ihdr[8] = 8; ihdr[9] = 2; // 8bit RGB
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
  fs.writeFileSync(path, png);
  console.log('写入', path, `${W}x${H}`);
}

// 32色板 (值0-31)
const PALETTE = [
  [180, 220, 160], [200, 180, 130], [230, 210, 160], [120, 160, 130], [150, 120, 170],
  [60, 130, 60], [90, 150, 210], [60, 110, 200], [40, 80, 190], [190, 180, 140],
  [240, 200, 120], [170, 140, 100], [255, 120, 120], [250, 190, 130], [130, 170, 190],
  [90, 90, 90], [255, 80, 80], [255, 160, 60], [80, 200, 220], [230, 150, 200],
  [10, 60, 30], [20, 90, 40], [30, 120, 50], [40, 150, 60], [50, 180, 70],
  [200, 230, 250], [170, 210, 240], [140, 190, 230], [110, 170, 220], [80, 150, 210],
  [230, 230, 250], [200, 200, 240],
];

function render(map, path, label) {
  const px = new Array(N);
  for (let i = 0; i < N; i++) {
    const x = Math.floor(i / 200), y = i % 200;
    px[x * 200 + y] = PALETTE[map[i]];  // x横向, y纵向
  }
  writePNG(path, px, 200, 200, 4);
}

const blood = readMap('C:/san11/xsyg/xsyg6/xsyg6/San11Pk/Media/san11pkres.bin', 0x20a40cb7);
const van = readMap('C:/san11/san11_原版/San11/Media/san11pkres.bin', 0x1f520cb7);
render(blood, 'tools/xsyg_map/blood-byte0.png', '血色');
render(van, 'tools/xsyg_map/vanilla-byte0.png', '原版');
