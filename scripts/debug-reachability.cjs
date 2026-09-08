/** 渲染 H5 严格通行模型的可达区域 + 川/渡所分布叠加图，定位走廊断点 */
const fs = require('fs');
const zlib = require('zlib');
const PKRES = 'C:/san11/san11_原版/San11/Media/san11pkres.bin';
const MAP_OFFSET = 0x1f520cb7, W = 200, H = 200;
const fd = fs.openSync(PKRES, 'r');
const buf = Buffer.alloc(8 + W * H * 11);
fs.readSync(fd, buf, 0, buf.length, MAP_OFFSET);
fs.closeSync(fd);
const t = new Uint8Array(W * H);
for (let i = 0; i < W * H; i++) t[i] = buf[8 + i * 11];
const at = (x, y) => t[x * H + y];

const SCEN = 'C:/san11/san11_原版/San11/Media/scenario/Scen000.s11';
const CITY_NAMES = ['襄平','北平','蓟','南皮','平原','晋阳','邺','北海','下邳','小沛','寿春','濮阳','陈留','许昌','汝南','洛阳','宛','长安','上庸','安定','天水','武威','建业','吴','会稽','庐江','柴桑','江夏','新野','襄阳','江陵','长沙','武陵','桂阳','零陵','永安','汉中','梓潼','江州','成都','建宁','云南'];
const sb = fs.readFileSync(SCEN);
const cities = CITY_NAMES.map((name, i) => ({ name, x: sb.readUInt16LE(0x3f4f + i * 18), y: sb.readUInt16LE(0x3f4f + i * 18 + 2) }));

const PASSABLE = new Set([0, 1, 2, 3, 4, 5, 9, 10, 11, 12, 13, 16, 17, 18, 19]);
const DIRS = [[1,0],[-1,0],[0,1],[0,-1],[1,1],[1,-1],[-1,1],[-1,-1]];
const seen = new Uint8Array(W * H);
const q = [cities[0].x * H + cities[0].y];
seen[q[0]] = 1;
while (q.length) {
  const k = q.pop();
  const x = (k / H) | 0, y = k % H;
  for (const [dx, dy] of DIRS) {
    const nx = x + dx, ny = y + dy;
    if (nx < 0 || nx >= W || ny < 0 || ny >= H) continue;
    const nk = nx * H + ny;
    if (seen[nk] || !PASSABLE.has(t[nk])) continue;
    seen[nk] = 1; q.push(nk);
  }
}

// 颜色: 可达=绿, 不可达可走=红, 川=蓝, 河=深蓝, 海=黑蓝, 崖=灰, 岸=棕, 渡所=黄, 其他水障碍外深色
const px = new Array(W * H);
for (let x = 0; x < W; x++) for (let y = 0; y < H; y++) {
  const v = at(x, y), k = x * H + y;
  if (seen[k]) px[y * W + x] = [60, 200, 60];
  else if (PASSABLE.has(v)) px[y * W + x] = [255, 60, 60];
  else if (v === 6) px[y * W + x] = [80, 150, 255];
  else if (v === 7) px[y * W + x] = [30, 60, 220];
  else if (v === 8) px[y * W + x] = [10, 20, 80];
  else if (v === 15) px[y * W + x] = [90, 90, 90];
  else if (v === 14) px[y * W + x] = [140, 110, 70];
  else if (v === 12) px[y * W + x] = [255, 230, 60];
  else px[y * W + x] = [40, 40, 40];
}
for (const c of cities) px[c.y * W + c.x] = [255, 255, 255];

function crc32(bb){let c,table=[];for(let n=0;n<256;n++){c=n;for(let k=0;k<8;k++)c=c&1?0xedb88320^(c>>>1):c>>>1;table[n]=c>>>0;}let crc=0xffffffff;for(const b of bb)crc=table[(crc^b)&0xff]^(crc>>>8);return(crc^0xffffffff)>>>0;}
function chunk(type,d){const len=Buffer.alloc(4);len.writeUInt32BE(d.length);const td=Buffer.concat([Buffer.from(type),d]);const crc=Buffer.alloc(4);crc.writeUInt32BE(crc32(td));return Buffer.concat([len,td,crc]);}
const scale = 5, PW = W * scale, PH = H * scale;
const raw = Buffer.alloc(PH * (PW * 3 + 1));
for (let y = 0; y < PH; y++) { raw[y * (PW * 3 + 1)] = 0;
  for (let x = 0; x < PW; x++) { const [r, g, b] = px[((y / scale) | 0) * W + ((x / scale) | 0)];
    const o = y * (PW * 3 + 1) + 1 + x * 3; raw[o] = r; raw[o + 1] = g; raw[o + 2] = b; } }
const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(PW, 0); ihdr.writeUInt32BE(PH, 4); ihdr[8] = 8; ihdr[9] = 2;
fs.writeFileSync('tools/xsyg_map/van2-reach-debug.png', Buffer.concat([Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]));
console.log('写入 tools/xsyg_map/van2-reach-debug.png');

// 定量: 找断点——被隔离的可走区域与可达区域的最近距离及中间障碍
const unreachable = [];
for (let x = 0; x < W; x++) for (let y = 0; y < H; y++)
  if (PASSABLE.has(at(x, y)) && !seen[x * H + y]) unreachable.push({ x, y });
console.log(`不可达可走格: ${unreachable.length}`);

// 襄平集群边界与最近未达城市(北海)之间的地形样本
const beihai = cities.find((c) => c.name === '北海');
console.log(`北海(${beihai.x},${beihai.y}) 周边5格地形:`, (() => {
  const c = {};
  for (let dx = -5; dx <= 5; dx++) for (let dy = -5; dy <= 5; dy++) {
    const x = beihai.x + dx, y = beihai.y + dy;
    if (x < 0 || x >= W || y < 0 || y >= H) continue;
    const n = ['草地','土','砂地','湿地','毒泉','森','川','河','海','荒地','主径','栈道','渡所','浅滩','岸','崖','都市','港','关所','小径'][at(x, y)];
    c[n] = (c[n] ?? 0) + 1;
  }
  return Object.entries(c).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}:${v}`).join(' ');
})());
