/**
 * 解析 sango DefaultMap.bin 的顶点数据（高度/水位/贴图层），
 * 对每个原版 tType 值统计：平均顶点高度、水位占比、主要贴图层。
 * sango 地图外观复刻原版 → 用外观反推各 tType 的真实地貌。
 * 格式: ver(i32)=10 + WorkContent(str) + mapW/mapH(i32) + mapGrid{size(i32)
 *   + 256*256 cell[terrainType u8, state i32, areaId u16]} + texName(str)
 *   + mapData{quadSize(i32) + 1025*1025 vertex[height u8, textureIndex u8, water u8]} ...
 */
const fs = require('fs');
const b = fs.readFileSync('D:/MyProjects/san11_wuxiansanguo/sango_infinity/Build/Content/Map/DefaultMap.bin');
let o = 0;
const ver = b.readInt32LE(o); o += 4;
const slen = b.readUInt8(o); o += 1 + slen;
o += 8; // mapW + mapH
o += 4; // gridSize(20)

// 读 256x256 网格
const GW = 256;
const cells = new Uint8Array(GW * GW);
for (let i = 0; i < GW * GW; i++) { cells[i] = b[o + i * 7]; }
o += GW * GW * 7;
// gridTexName string
const tl = b.readUInt8(o); o += 1 + tl;

// mapData: quadSize + vertices 1025x1025x3B
const quadSize = b.readInt32LE(o); o += 4;
console.log(`ver=${ver} quadSize=${quadSize} vertices start @${o}, remaining=${b.length - o}`);
const VX = 1025, VY = 1025;
const height = new Uint8Array(VX * VY);
const tex = new Uint8Array(VX * VY);
const water = new Uint8Array(VX * VY);
for (let x = 0; x < VX; x++) for (let y = 0; y < VY; y++) {
  const p = o + (x * VY + y) * 3;
  height[x * VY + y] = b[p];
  tex[x * VY + y] = b[p + 1];
  water[x * VY + y] = b[p + 2];
}

// 网格中心顶点: vx = 4*gx+2, vy = 4*gy + (gx%2)*2 + 2 (gridVertexCount=gridSize/quadSize=4)
const GVC = 4;
const NAMES = ['草地','土','砂地','湿地','毒泉','森','川','河','海','荒地','主径','栈道','渡所','浅滩','岸','崖','都市','港','关所','小径'];

// 只统计 311 导入区 [28..227]
const stat = {};
for (let gx = 28; gx < 228; gx++) {
  for (let gy = 28; gy < 228; gy++) {
    const ttype = cells[gx * GW + gy] - 1; // 还原为原版 tType
    if (ttype < 0 || ttype > 19) continue;
    const vx = GVC * gx + GVC / 2;
    const vy = GVC * gy + (gx % 2) * (GVC / 2) + GVC / 2;
    const vi = vx * VY + vy;
    const s = stat[ttype] ?? (stat[ttype] = { n: 0, hSum: 0, waterN: 0, tex: {} });
    s.n++;
    s.hSum += height[vi];
    if (water[vi] > 0) s.waterN++;
    s.tex[tex[vi]] = (s.tex[tex[vi]] ?? 0) + 1;
  }
}

console.log('\ntType | 名称     | 格数  | 平均高度 | 水位% | 主要贴图层(层:占比)');
for (const k of Object.keys(stat).map(Number).sort((a, c) => a - c)) {
  const s = stat[k];
  const texTop = Object.entries(s.tex).sort((a, c) => c[1] - a[1]).slice(0, 3)
    .map(([t, n]) => `L${t}:${(n / s.n * 100).toFixed(0)}%`).join(' ');
  console.log(`${String(k).padStart(5)} | ${NAMES[k].padEnd(6)} | ${String(s.n).padStart(5)} | ${String((s.hSum / s.n).toFixed(1)).padStart(7)} | ${String((s.waterN / s.n * 100).toFixed(0)).padStart(4)}% | ${texTop}`);
}

// 高度分布参考: 全图高度直方图(简)
const hHist = {};
for (let gx = 28; gx < 228; gx++) for (let gy = 28; gy < 228; gy++) {
  const vx = GVC * gx + 2, vy = GVC * gy + (gx % 2) * 2 + 2;
  const h = height[vx * VY + vy];
  const bucket = Math.floor(h / 16) * 16;
  hHist[bucket] = (hHist[bucket] ?? 0) + 1;
}
console.log('\n全图高度直方图(区间:数量):', Object.entries(hHist).sort((a, c) => Number(a[0]) - Number(c[0])).map(([h, n]) => `${h}:${n}`).join(' '));
