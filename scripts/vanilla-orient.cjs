// 方位钉死 + 关键值掩膜渲染
const fs = require('fs');
const zlib = require('zlib');
const VAN = 'C:/san11/san11_原版/San11/Media/san11pkres.bin';
const VAN_S11 = 'C:/san11/san11_原版/San11/Media/scenario/Scen000.s11';
const W = 200, H = 200, N = 40000, P = 11, OFF = 0x1f520cb7;
const buf = fs.readFileSync(VAN);
function plane(p) {
  const a = new Uint8Array(N);
  for (let i = 0; i < N; i++) a[i] = buf[OFF + 8 + i * P + p];
  return a;
}
const p0 = plane(0);
const s11 = fs.readFileSync(VAN_S11);

// 1) GBK 城市名搜索
const names = { '洛陽': 'C2E5D1F4', '襄陽': 'D1F4D1F4', '薊': 'CDB5', '成都': 'B3C9B6BC', '建安': 'BDA8B0B2', '長安': 'B3A4B0B2', '建業': 'BDA8D2B5', '許昌': 'D0EDB2FD', '江陵': 'BDADC1E9', '長沙': 'B3A4C9B3' };
const found = {};
for (const [n, hex] of Object.entries(names)) {
  const pat = Buffer.from(hex, 'hex');
  let idx = -1; const hits = [];
  while ((idx = s11.indexOf(pat, idx + 1)) !== -1) hits.push(idx);
  found[n] = hits.slice(0, 6);
  console.log(`${n} GBK@ ${hits.slice(0, 6).map((h) => '0x' + h.toString(16)).join(',')}`);
}
// 若名字集中在一个名字表: 找连续区段
console.log('\ncity table @0x3f4f, name table guess: 检查 0x3d00-0x3f4e 区段');
for (const [n, hex] of Object.entries(names)) {
  const pat = Buffer.from(hex, 'hex');
  const inRange = found[n].filter((h) => h >= 0x3c00 && h < 0x4400);
  if (inRange.length) console.log(`  ${n} in building zone: ${inRange.map((h) => '0x' + h.toString(16)).join(',')}`);
}
// 名字表顺序 -> 城市记录顺序
function analyzeNameTable(startGuess) {
  // 尝试: 名字表每条固定长度, 从某处开始 42 条
}
// 手工: 打印 0x3e00..0x3f60 hexdump gbk
function gbkDump(a, b) {
  let out = '';
  for (let i = a; i < b; i += 2) {
    const c = s11[i], d = s11[i + 1];
    if (c >= 0x81 && d >= 0x40) {
      out += `[${i.toString(16)}:${Buffer.from([c, d]).toString('latin1')}]`;
    }
  }
  return out;
}
// 用 iconv-lite? 没有就手写 GBK 表太大。Node Buffer 支持 'gbk'? 不支持。
// 改用 utf16le 再试
for (const [n] of Object.entries(names)) {
  const pat = Buffer.from(n, 'utf16le');
  let idx = -1; const hits = [];
  while ((idx = s11.indexOf(pat, idx + 1)) !== -1) hits.push(idx);
  if (hits.length) console.log(`${n} UTF16@ ${hits.slice(0, 6).map((h) => '0x' + h.toString(16)).join(',')}`);
}
// 打印城市记录原始 18 字节 hex 前5条
console.log('\ncity records raw:');
for (let i = 0; i < 5; i++) {
  const o = 0x3f4f + i * 18;
  console.log(`  #${i} @0x${o.toString(16)}: ${buf.length ? '' : ''}${require('buffer').Buffer.from(s11.subarray(o, o + 18)).toString('hex')}`);
}

// 2) 掩膜渲染
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
const OUT = 'D:/MyProjects/san11/tools/xsyg_map';
function mask(val, path) {
  const scale = 3, w = W * scale, h = H * scale;
  const img = Buffer.alloc(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const gx = Math.floor(x / scale), gy = Math.floor(y / scale);
    const on = p0[gx * H + gy] === val;
    const o = (y * w + x) * 4;
    const g = on ? 255 : 20;
    img[o] = g; img[o + 1] = on ? 255 : 20; img[o + 2] = on ? 255 : 60; img[o + 3] = 255;
  }
  writePNG(path, img, w, h);
}
for (const v of [6, 7, 8, 14, 10, 0, 15, 5, 3, 2, 9, 11, 19]) mask(v, `${OUT}/van-m${v}.png`);
console.log('\nmasks written van-m{6,7,8,14,10,0,15,5,3,2,9,11,19}.png (col=x east?, row=y north?)');
