/**
 * 逐格比对 sango_infinity DefaultMap.bin（256x256 网格，311数据在 [x+28][y+28]）
 * 与原版 San11pkres.bin SHEX0008（200x200，idx=x*200+y）的 tType，
 * 确定 sango terrainType 与原版 tType 的偏移关系。
 * DefaultMap.bin v10 格式: ver(i32) + WorkContent(str) + mapW(i32)+mapH(i32)
 *   + mapGrid: gridSize(i32) + 256*256 cells{terrainType u8, terrainState i32, areaId u16} + texName(str)
 */
const fs = require('fs');

// ---- sango DefaultMap.bin ----
const b = fs.readFileSync('D:/MyProjects/san11_wuxiansanguo/sango_infinity/Build/Content/Map/DefaultMap.bin');
let o = 0;
const ver = b.readInt32LE(o); o += 4;
const slen = b.readUInt8(o); o += 1 + slen; // WorkContent
const mw = b.readInt32LE(o); o += 4;
const mh = b.readInt32LE(o); o += 4;
const gridSize = b.readInt32LE(o); o += 4;
console.log(`ver=${ver} map=${mw}x${mh} gridSize=${gridSize}`);
const GW = 256, GH = 256;
const sango = new Uint8Array(GW * GH);
const sangoArea = new Uint8Array(GW * GH);
for (let x = 0; x < GW; x++) for (let y = 0; y < GH; y++) {
  const p = o + (x * GH + y) * 7;
  sango[x * GH + y] = b[p];
  sangoArea[x * GH + y] = b[p + 6];
}

// ---- 原版 pkres ----
const PKRES = 'C:/san11/san11_原版/San11/Media/san11pkres.bin';
const fd = fs.openSync(PKRES, 'r');
const buf = Buffer.alloc(8 + 200 * 200 * 11);
fs.readSync(fd, buf, 0, buf.length, 0x1f520cb7);
fs.closeSync(fd);
const t = new Uint8Array(200 * 200);
for (let i = 0; i < 200 * 200; i++) t[i] = buf[8 + i * 11];

// ---- 比对 [x+28][y+28] vs tType(x,y) ----
let matchPlus1 = 0, matchDirect = 0, mismatch = 0;
const pairCount = {};
for (let x = 0; x < 200; x++) for (let y = 0; y < 200; y++) {
  const sv = sango[(x + 28) * GH + (y + 28)];
  const tv = t[x * 200 + y];
  if (sv === tv + 1) matchPlus1++;
  if (sv === tv) matchDirect++;
  if (sv !== tv + 1) {
    mismatch++;
    const k = `t${tv}->s${sv}`;
    pairCount[k] = (pairCount[k] ?? 0) + 1;
  }
}
console.log(`\n200x200=40000 格比对:`);
console.log(`  sango == tType+1: ${matchPlus1}`);
console.log(`  sango == tType:   ${matchDirect}`);
console.log(`  不符 +1 规则: ${mismatch}`);
const entries = Object.entries(pairCount).sort((a, b) => b[1] - a[1]).slice(0, 20);
if (entries.length) {
  console.log('  不符分布(tType->sango: 数量):');
  for (const [k, n] of entries) console.log(`    ${k}: ${n}`);
}
