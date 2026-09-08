/** 渲染原版图+血色图(带42都市场标注) 确认地理方位 */
const fs = require('fs');
const zlib = require('zlib');
const N = 200 * 200;
function readMap(off) {
  const fd = fs.openSync('C:/san11/xsyg/xsyg6/xsyg6/San11Pk/Media/san11pkres.bin', 'r');
  const buf = Buffer.alloc(8 + N * 11);
  fs.readSync(fd, buf, 0, buf.length, off);
  fs.closeSync(fd);
  const t = new Uint8Array(N);
  for (let i = 0; i < N; i++) t[i] = buf[8 + i * 11];
  return t;
}
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
// 简单BMP式PPM不可行,继续PNG
function writePNG(path, pixels, w, h, scale) {
  const W = w * scale, H = h * scale;
  const raw = Buffer.alloc(H * (W * 3 + 1));
  for (let y = 0; y < H; y++) {
    raw[y * (W * 3 + 1)] = 0;
    for (let x = 0; x < W; x++) {
      const p = pixels[Math.floor(y / scale) * w + Math.floor(x / scale)];
      const o = y * (W * 3 + 1) + 1 + x * 3;
      raw[o] = p[0]; raw[o + 1] = p[1]; raw[o + 2] = p[2];
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4);
  ihdr[8] = 8; ihdr[9] = 2;
  fs.writeFileSync(path, Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0)),
  ]));
  console.log('写入', path, `${W}x${H}`);
}

const scen = JSON.parse(fs.readFileSync('tools/xsyg_map/Scenario1.json', 'utf8'));
const metros = Object.values(scen.citySet).filter((c) => c.BuildingType === 1);

// 原版语义配色
const VC = {
  0: [150, 190, 130], 1: [190, 170, 120], 2: [220, 200, 150], 3: [130, 160, 140], 4: [160, 130, 180],
  5: [60, 120, 60], 6: [50, 100, 190], 7: [70, 130, 210], 8: [40, 80, 180], 9: [200, 190, 150],
  10: [170, 150, 110], 11: [160, 140, 100], 12: [150, 130, 90], 13: [230, 160, 90], 14: [120, 160, 180],
  15: [60, 60, 60], 16: [255, 100, 100], 17: [255, 200, 80], 18: [255, 150, 60], 19: [140, 120, 80],
};
function renderVan(t, path) {
  const px = new Array(N);
  for (let i = 0; i < N; i++) {
    const x = Math.floor(i / 200), y = i % 200;
    const c = VC[t[i]] ?? [255, 0, 255];
    // 城市标记: 红色
    px[x * 200 + y] = c;
  }
  for (const c of metros) {
    const q = c.x - 28, r = c.y - 28;
    if (q >= 0 && q < 200 && r >= 0 && r < 200) {
      px[q * 200 + r] = [255, 255, 255];
    }
  }
  writePNG(path, px, 200, 200, 4);
}
renderVan(readMap(0x26800119), 'tools/xsyg_map/van-annotated.png');
renderVan(readMap(0x20a40cb7), 'tools/xsyg_map/blood-annotated.png');
console.log('白色=42都市场位置(场景坐标-28)');
