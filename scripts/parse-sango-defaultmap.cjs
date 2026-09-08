/**
 * 解析 sango 工程 DefaultMap.bin (Map.cs Load() 格式)
 * 头部: Int32 versionCode, LEB128串 ContentDir, Int32 mapWidth, Int32 mapHeight, Int32 grid_size
 * 单元: byte terrainTypeId + Int32 terrainState + UInt16 areaId = 7字节, x*Height+y 顺序
 * 目标: 判定它来自血色图还是原版图, 以及 terrainTypeId 是否被重映射
 */
const fs = require('fs');

const MOD = 'C:/san11/xsyg/xsyg6/xsyg6/San11Pk/Media/san11pkres.bin';
const VAN = 'C:/san11/san11_原版/San11/Media/san11pkres.bin';
const BLD_S11 = 'C:/san11/xsyg/xsyg6/xsyg6/San11Pk/Media/scenario/SCEN000.S11';
const N = 40000, HDR = 8, CELL = 11, H = 200, W = 200;

function readBld(buf, off, count) {
  const out = [];
  for (let k = 0; k < count; k++) {
    const o = off + k * 18;
    out.push({ x: buf.readUInt16LE(o), y: buf.readUInt16LE(o + 2) });
  }
  return out;
}
const bldBuf = fs.readFileSync(BLD_S11);
const cities = readBld(bldBuf, 0x3f4f, 42);
const passes = readBld(bldBuf, 0x4243, 10);
const ports = readBld(bldBuf, 0x42f7, 35);
const idxOf = (b) => b.x * H + b.y;

function readPlanesAt(fd, off) {
  const buf = Buffer.alloc(HDR + N * CELL);
  fs.readSync(fd, buf, 0, buf.length, off);
  if (buf.toString('ascii', 0, 8) !== 'SHEX0008') return null;
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
const fmt = (h, n = 6) => h.slice(0, n).map(([v, c]) => `v${v}×${c}`).join(' ');

// ---- 解析 DefaultMap.bin ----
const buf = fs.readFileSync('C:/san11/sango_export/DefaultMap.bin');
let pos = 0;
const versionCode = buf.readInt32LE(pos); pos += 4;
// LEB128 字符串长度
let slen = 0, shift = 0;
while (true) {
  const b = buf[pos++];
  slen |= (b & 0x7f) << shift;
  if (!(b & 0x80)) break;
  shift += 7;
}
const contentDir = buf.toString('utf8', pos, pos + slen); pos += slen;
const mapW = buf.readInt32LE(pos); pos += 4;
const mapHh = buf.readInt32LE(pos); pos += 4;
const gridSize = buf.readInt32LE(pos); pos += 4;
const W2 = mapW / 4, H2 = mapHh / 4;
console.log(`DefaultMap.bin: version=${versionCode} dir="${contentDir}" map=${mapW}x${mapHh} grid=${gridSize} => ${W2}x${H2}=${W2 * H2}格`);
console.log(`剩余字节=${buf.length - pos}, 期望(7B/格)=${W2 * H2 * 7}`);

const M = W2 * H2;
const terrain = new Uint8Array(M), state = new Int32Array(M), area = new Uint16Array(M);
for (let i = 0; i < M; i++) {
  terrain[i] = buf[pos + i * 7];
  state[i] = buf.readInt32LE(pos + i * 7 + 1);
  area[i] = buf.readUInt16LE(pos + i * 7 + 5);
}
console.log(`\nsango terrain 值数=${hist(terrain).length}: ${fmt(hist(terrain), 40)}`);
console.log(`sango area    值数=${hist(area).length}: ${fmt(hist(area), 12)}`);
console.log(`sango state   值数=${hist(state).length}: ${fmt(hist(state), 8)}`);

if (M !== N) { console.log('格数与 200x200 不符, 终止对比'); process.exit(0); }

// ---- 与 pkres 两图对比 ----
const modFd = fs.openSync(MOD, 'r');
const vanFd = fs.openSync(VAN, 'r');
const blood = readPlanesAt(modFd, 0x20a40cb7);
const van = readPlanesAt(vanFd, 0x1f520cb7);
fs.closeSync(modFd); fs.closeSync(vanFd);

function diffCount(a, b) { let d = 0; for (let i = 0; i < N; i++) if (a[i] !== b[i]) d++; return d; }
console.log(`\nterrain vs 血p0 不同格数: ${diffCount(terrain, blood[0])} / ${N}`);
console.log(`terrain vs 原p0 不同格数: ${diffCount(terrain, van[0])} / ${N}`);
console.log(`area    vs 血p1 不同格数: ${diffCount(area, blood[1])} / ${N}`);
console.log(`area    vs 原p1 不同格数: ${diffCount(area, van[1])} / ${N}`);
console.log(`state   vs 血p2..p10 逐一: ${blood.slice(2).map((pl) => diffCount(state, pl)).join(',')}`);

// ---- 都市/关/港锚点 ----
const atCity = cities.map((b) => terrain[idxOf(b)]);
const atPass = passes.map((b) => terrain[idxOf(b)]);
const atPort = ports.map((b) => terrain[idxOf(b)]);
console.log(`\nsango terrain 都市锚: ${fmt(hist(atCity), 8)}  (distinct=${hist(atCity).length})`);
console.log(`sango terrain 关锚:   ${fmt(hist(atPass), 8)}`);
console.log(`sango terrain 港锚:   ${fmt(hist(atPort), 8)}`);
const atCityA = cities.map((b) => area[idxOf(b)]);
console.log(`sango area 都市锚 distinct=${hist(atCityA).length}: ${fmt(hist(atCityA), 8)}`);

// ---- 若 terrain != 血p0, 建立重映射表 ----
if (diffCount(terrain, blood[0]) > 0) {
  const remap = new Map();
  for (let i = 0; i < N; i++) {
    const k = blood[0][i], v = terrain[i];
    if (!remap.has(k)) remap.set(k, new Map());
    remap.get(k).set(v, (remap.get(k).get(v) ?? 0) + 1);
  }
  console.log('\n血p0值 -> sango terrain 值 (top3):');
  for (const [k, t] of [...remap.entries()].sort((a, b) => a[0] - b[0])) {
    const top = [...t.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3);
    const total = [...t.values()].reduce((s, c) => s + c, 0);
    console.log(`  血v${k}: ${top.map(([v, c]) => `sango${v} ${(c * 100 / total).toFixed(0)}%`).join(' | ')}`);
  }
}
