/**
 * 渲染 p0 平面为 PNG 供视觉分类
 * 输出:
 *   out/blood_p0.png   血色 p0, 32 值分类色
 *   out/vanilla_p0.png 原版 p0, 语义色 (已知地形)
 *   out/legend.png     血色 32 值图例
 * 标记: 都市=纯白, 关所=纯黑, 港=纯青 (各自 s11 坐标)
 */
const fs = require('fs');
const zlib = require('zlib');

const MOD = 'C:/san11/xsyg/xsyg6/xsyg6/San11Pk/Media/san11pkres.bin';
const VAN = 'C:/san11/san11_原版/San11/Media/san11pkres.bin';
const BLD_S11 = 'C:/san11/xsyg/xsyg6/xsyg6/San11Pk/Media/scenario/SCEN000.S11';
const VAN_S11 = 'C:/san11/san11_原版/San11/Media/scenario/Scen000.s11';
const N = 40000, HDR = 8, CELL = 11, W = 200, H = 200, S = 4;

function readBld(buf, off, count) {
  const out = [];
  for (let k = 0; k < count; k++) {
    const o = off + k * 18;
    out.push({ x: buf.readUInt16LE(o), y: buf.readUInt16LE(o + 2) });
  }
  return out;
}
const bldBuf = fs.readFileSync(BLD_S11);
const vanBuf = fs.readFileSync(VAN_S11);
const bloodCities = readBld(bldBuf, 0x3f4f, 42);
const bloodPasses = readBld(bldBuf, 0x4243, 10);
const bloodPorts = readBld(bldBuf, 0x42f7, 35);
const vanCities = readBld(vanBuf, 0x3f4f, 42);
const vanPasses = readBld(vanBuf, 0x4243, 10);
const vanPorts = readBld(vanBuf, 0x42f7, 35);
const idxOf = (b) => b.x * H + b.y;

function readP0(fd, off) {
  const buf = Buffer.alloc(HDR + N * CELL);
  fs.readSync(fd, buf, 0, buf.length, off);
  if (buf.toString('ascii', 0, 8) !== 'SHEX0008') throw new Error('no SHEX0008 @' + off.toString(16));
  const a = new Uint8Array(N);
  for (let i = 0; i < N; i++) a[i] = buf[HDR + i * CELL];
  return a;
}
const modFd = fs.openSync(MOD, 'r');
const vanFd = fs.openSync(VAN, 'r');
const bloodP0 = readP0(modFd, 0x20a40cb7);
const vanP0 = readP0(vanFd, 0x1f520cb7);
fs.closeSync(modFd); fs.closeSync(vanFd);

// ---- PNG 编码 ----
const CRC_T = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();
function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_T[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}
function chunk(type, data) {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'ascii');
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
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
  const png = Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 6 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
  fs.writeFileSync(file, png);
  console.log(`写出 ${file} (${w}x${h})`);
}

// ---- 分类色板 (32色, 黄金角) ----
function hsv2rgb(h, s, v) {
  const i = Math.floor(h * 6), f = h * 6 - i;
  const p = v * (1 - s), q = v * (1 - f * s), t = v * (1 - (1 - f) * s);
  const r = [v, q, p, p, t, v][i % 6], g = [t, v, v, q, p, p][i % 6], b = [p, p, t, v, v, q][i % 6];
  return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)];
}
const CAT = [];
for (let i = 0; i < 32; i++) {
  CAT.push(hsv2rgb((i * 0.381966) % 1, 0.72, i % 2 ? 0.95 : 0.62));
}
console.log('\n血色 p0 图例:');
CAT.forEach((c, i) => console.log(`  v${String(i).padStart(2)}: rgb(${c.join(',')}) #${c.map((x) => x.toString(16).padStart(2, '0')).join('')}`));

// 原版语义色
const SEM = [
  [150, 205, 125], [205, 195, 135], [235, 215, 155], [125, 165, 150], [155, 85, 165],
  [45, 115, 55], [65, 125, 205], [95, 165, 225], [35, 65, 165], [185, 155, 95],
  [125, 105, 75], [105, 85, 65], [165, 125, 65], [105, 185, 195], [215, 205, 165],
  [95, 90, 85], [225, 55, 55], [245, 155, 65], [65, 65, 80], [145, 125, 185],
];

// ---- 渲染 ----
function render(arr, palette, buildings, file) {
  const w = W * S, h = H * S;
  const rgb = Buffer.alloc(w * h * 3);
  for (let x = 0; x < W; x++) {
    for (let y = 0; y < H; y++) {
      const c = palette[arr[x * H + y]];
      for (let dx = 0; dx < S; dx++) for (let dy = 0; dy < S; dy++) {
        const o = ((x * S + dx) * h + (y * S + dy)) * 3;
        rgb[o] = c[0]; rgb[o + 1] = c[1]; rgb[o + 2] = c[2];
      }
    }
  }
  const mark = (b, c) => {
    if (b.x < 0 || b.x >= W || b.y < 0 || b.y >= H) return;
    for (let dx = 0; dx < S; dx++) for (let dy = 0; dy < S; dy++) {
      const o = ((b.x * S + dx) * h + (b.y * S + dy)) * 3;
      rgb[o] = c[0]; rgb[o + 1] = c[1]; rgb[o + 2] = c[2];
    }
  };
  buildings.cities.forEach((b) => mark(b, [255, 255, 255]));
  buildings.passes.forEach((b) => mark(b, [0, 0, 0]));
  buildings.ports.forEach((b) => mark(b, [0, 255, 255]));
  writePNG(file, w, h, rgb);
}

fs.mkdirSync('out', { recursive: true });
render(bloodP0, CAT, { cities: bloodCities, passes: bloodPasses, ports: bloodPorts }, 'out/blood_p0.png');
render(vanP0, SEM, { cities: vanCities, passes: vanPasses, ports: vanPorts }, 'out/vanilla_p0.png');

// 图例: 2列x16行
{
  const cell = 40, w = cell * 2, h = cell * 16;
  const rgb = Buffer.alloc(w * h * 3, 255);
  for (let i = 0; i < 32; i++) {
    const col = Math.floor(i / 16), row = i % 16;
    for (let dx = 4; dx < cell - 4; dx++) for (let dy = 4; dy < cell - 4; dy++) {
      const o = ((col * cell + dx) * h + (row * cell + dy)) * 3;
      rgb[o] = CAT[i][0]; rgb[o + 1] = CAT[i][1]; rgb[o + 2] = CAT[i][2];
    }
  }
  writePNG('out/legend.png', w, h, rgb);
}
