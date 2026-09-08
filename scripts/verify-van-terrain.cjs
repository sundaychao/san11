/**
 * 验证 sango_infinity TerrainTypes 表（tType+1 索引）对原版 San11pkres.bin
 * SHEX0008 地形数据的适用性：
 *   0草地 1土 2砂地 3湿地 4毒泉 5森 6川 7河 8海 9荒地
 *   10主径 11栈道 12渡所 13浅滩 14岸 15崖 16都市 17港 18关所 19小径
 * 输出: 数值分布 + 复合验证图 + 关键值遮罩图（tools/xsyg_map/van2-*.png）
 */
const fs = require('fs');
const zlib = require('zlib');

const PKRES = 'C:/san11/san11_原版/San11/Media/san11pkres.bin';
const SCEN = 'C:/san11/san11_原版/San11/Media/scenario/Scen000.s11';
const MAP_OFFSET = 0x1f520cb7;
const W = 200, H = 200;
const CITY_REC = 0x3f4f, REC_STRIDE = 18;
const CITY_NAMES = ['襄平','北平','蓟','南皮','平原','晋阳','邺','北海','下邳','小沛','寿春','濮阳','陈留','许昌','汝南','洛阳','宛','长安','上庸','安定','天水','武威','建业','吴','会稽','庐江','柴桑','江夏','新野','襄阳','江陵','长沙','武陵','桂阳','零陵','永安','汉中','梓潼','江州','成都','建宁','云南'];

const NAMES = ['草地','土','砂地','湿地','毒泉','森','川','河','海','荒地','主径','栈道','渡所','浅滩','岸','崖','都市','港','关所','小径'];
const COLOR = [
  [106,168,79],   // 0 草地 绿
  [139,115,85],   // 1 土 棕褐
  [222,196,120],  // 2 砂地 沙黄
  [102,158,138],  // 3 湿地 沼青
  [160,60,180],   // 4 毒泉 紫
  [32,96,42],     // 5 森 深绿
  [120,180,220],  // 6 川 浅蓝(不可渡)
  [48,110,180],   // 7 河 蓝
  [20,55,120],    // 8 海 深蓝
  [168,160,110],  // 9 荒地 灰黄
  [230,200,110],  // 10 主径 亮黄
  [150,90,50],    // 11 栈道 棕
  [255,120,40],   // 12 渡所 橙
  [170,210,230],  // 13 浅滩 淡蓝
  [110,95,60],    // 14 岸 暗卡其
  [55,48,48],     // 15 崖 暗灰
  [255,220,60],   // 16 都市 亮金
  [240,160,60],   // 17 港 橙黄
  [230,60,60],    // 18 关所 红
  [210,180,150],  // 19 小径 浅褐
];

// ---- 读取地形 ----
const fd = fs.openSync(PKRES, 'r');
const buf = Buffer.alloc(8 + W * H * 11);
fs.readSync(fd, buf, 0, buf.length, MAP_OFFSET);
fs.closeSync(fd);
if (buf.toString('ascii', 0, 8) !== 'SHEX0008') throw new Error('SHEX0008 头不符');

const t = new Uint8Array(W * H);       // p0 tType
const area = new Uint8Array(W * H);    // p1 areaId
for (let i = 0; i < W * H; i++) {
  t[i] = buf[8 + i * 11];
  area[i] = buf[8 + i * 11 + 1];
}
const at = (x, y) => t[x * H + y];

// ---- 城市坐标 ----
const sb = fs.readFileSync(SCEN);
const cities = CITY_NAMES.map((name, i) => {
  const rec = CITY_REC + i * REC_STRIDE;
  return { name, x: sb.readUInt16LE(rec), y: sb.readUInt16LE(rec + 2) };
});

// ---- 分布 ----
const dist = {};
for (const v of t) dist[v] = (dist[v] ?? 0) + 1;
console.log('== p0(tType) 分布 ==');
for (const k of Object.keys(dist).map(Number).sort((a, b) => a - b)) {
  console.log(`  ${String(k).padStart(2)} ${NAMES[k] ?? '?'}: ${dist[k]}`);
}

// ---- 地理核查 ----
const around = (cx, cy, rad) => {
  const c = {};
  for (let x = Math.max(0, cx - rad); x <= Math.min(W - 1, cx + rad); x++)
    for (let y = Math.max(0, cy - rad); y <= Math.min(H - 1, cy + rad); y++) {
      const v = at(x, y);
      c[v] = (c[v] ?? 0) + 1;
    }
  return Object.entries(c).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([v, n]) => `${NAMES[v]}:${n}`).join(' ');
};
console.log('\n== 地理核查（各城周边3格地形构成） ==');
for (const name of ['武威', '天水', '安定', '云南', '建宁', '柴桑', '庐江', '江陵', '建业', '会稽', '汉中', '梓潼', '成都', '长安', '洛阳', '襄平', '下邳']) {
  const c = cities.find((c) => c.name === name);
  console.log(`  ${name}(${c.x},${c.y}): ${around(c.x, c.y, 3)}`);
}

// 渡所(12)/浅滩(13) 是否邻接河(7)
let ferryAdjRiver = 0, ferryTotal = 0, shallowAdjRiver = 0, shallowTotal = 0;
const DIRS = [[1,0],[-1,0],[0,1],[0,-1],[1,1],[1,-1],[-1,1],[-1,-1]];
for (let x = 0; x < W; x++) for (let y = 0; y < H; y++) {
  const v = at(x, y);
  if (v === 12) { ferryTotal++; if (DIRS.some(([dx,dy]) => { const nx=x+dx, ny=y+dy; return nx>=0&&nx<W&&ny>=0&&ny<H&&at(nx,ny)===7; })) ferryAdjRiver++; }
  if (v === 13) { shallowTotal++; if (DIRS.some(([dx,dy]) => { const nx=x+dx, ny=y+dy; return nx>=0&&nx<W&&ny>=0&&ny<H&&(at(nx,ny)===7||at(nx,ny)===8); })) shallowAdjRiver++; }
}
console.log(`\n渡所(12) ${ferryTotal} 格中邻接河(7)的: ${ferryAdjRiver}`);
console.log(`浅滩(13) ${shallowTotal} 格中邻接河/海的: ${shallowAdjRiver}`);

// ---- PNG 写入 ----
function crc32(bb){let c,table=[];for(let n=0;n<256;n++){c=n;for(let k=0;k<8;k++)c=c&1?0xedb88320^(c>>>1):c>>>1;table[n]=c>>>0;}let crc=0xffffffff;for(const b of bb)crc=table[(crc^b)&0xff]^(crc>>>8);return(crc^0xffffffff)>>>0;}
function chunk(type,d){const len=Buffer.alloc(4);len.writeUInt32BE(d.length);const td=Buffer.concat([Buffer.from(type),d]);const crc=Buffer.alloc(4);crc.writeUInt32BE(crc32(td));return Buffer.concat([len,td,crc]);}
function writePng(path, pixels, w, h) {
  const scale = Math.max(1, Math.floor(1000 / w));
  const PW = w * scale, PH = h * scale;
  const raw = Buffer.alloc(PH * (PW * 3 + 1));
  for (let y = 0; y < PH; y++) { raw[y * (PW * 3 + 1)] = 0;
    for (let x = 0; x < PW; x++) { const [r, g, b] = pixels[((y / scale) | 0) * w + ((x / scale) | 0)];
      const o = y * (PW * 3 + 1) + 1 + x * 3; raw[o] = r; raw[o + 1] = g; raw[o + 2] = b; } }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(PW, 0); ihdr.writeUInt32BE(PH, 4); ihdr[8] = 8; ihdr[9] = 2;
  fs.writeFileSync(path, Buffer.concat([Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]));
  console.log('写入', path);
}

// 复合图（含城市红点标记）
const comp = new Array(W * H);
for (let x = 0; x < W; x++) for (let y = 0; y < H; y++) comp[y * W + x] = COLOR[at(x, y)] ?? [255, 0, 255];
for (const c of cities) comp[c.y * W + c.x] = [255, 0, 0];
writePng('tools/xsyg_map/van2-composite.png', comp, W, H);

// 关键值遮罩
for (const v of [2, 3, 4, 6, 11, 12, 13, 14, 15, 19]) {
  const m = new Array(W * H).fill([12, 12, 12]);
  for (let x = 0; x < W; x++) for (let y = 0; y < H; y++) if (at(x, y) === v) m[y * W + x] = [255, 255, 255];
  for (const c of cities) m[c.y * W + c.x] = [255, 80, 80];
  writePng(`tools/xsyg_map/van2-m${v}.png`, m, W, H);
}
