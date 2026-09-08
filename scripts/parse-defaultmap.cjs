/** 解析 sango_infinity 的 DefaultMap.bin 头部与地形数据 */
const fs = require('fs');

const b = fs.readFileSync('C:/san11/sango_export/DefaultMap.bin');
console.log('大小:', b.length);

let o = 0;
const ver = b.readInt32LE(o); o += 4;
console.log('versionCode:', ver);

// .NET BinaryWriter.Write(string): 7bit长度前缀 + UTF-8
function readStr() {
  let len = 0, shift = 0;
  for (;;) {
    const byte = b[o++];
    len |= (byte & 0x7f) << shift;
    if (!(byte & 0x80)) break;
    shift += 7;
  }
  const s = b.toString('utf8', o, o + len);
  o += len;
  return s;
}

const contentDir = readStr();
console.log('ContentDir:', JSON.stringify(contentDir));

const mapWidth = b.readInt32LE(o); o += 4;
const mapHeight = b.readInt32LE(o); o += 4;
const gridSize = b.readInt32LE(o); o += 4;
const W = mapWidth / 4, H = mapHeight / 4;
console.log('mapWidth:', mapWidth, 'mapHeight:', mapHeight, 'gridSize:', gridSize, '→ 格子', W, 'x', H);
console.log('单元格数据起始偏移:', o);

// 按 Map.cs Load 的循环读: 每格 byte terrainTypeId + int32 terrainState + uint16 areaId (列主序 x,y)
const CELL = 7;
const N = W * H;
const terrain = new Uint8Array(N);
const state = new Int32Array(N);
const area = new Uint16Array(N);
let ok = true;
for (let x = 0; x < W && ok; x++) {
  for (let y = 0; y < H; y++) {
    const i = x * H + y;
    if (o + CELL > b.length) { ok = false; console.log('数据越界 @', x, y, '偏移', o); break; }
    terrain[i] = b[o];
    state[i] = b.readInt32LE(o + 1);
    area[i] = b.readUInt16LE(o + 5);
    o += CELL;
  }
}
console.log('读取完成:', ok, '结束偏移:', o, '剩余字节:', b.length - o);

// 地形值分布
const dist = {};
for (let i = 0; i < N; i++) dist[terrain[i]] = (dist[terrain[i]] ?? 0) + 1;
console.log('地形值分布:', Object.fromEntries(Object.entries(dist).sort((a, b) => a[0] - b[0])));

// 用 Scenario1.json 的城市坐标对齐测试（血色城市, base=28）
const scen = JSON.parse(fs.readFileSync('tools/xsyg_map/Scenario1.json', 'utf8'));
const metros = Object.values(scen.citySet).filter((c) => c.BuildingType === 1);
console.log('\n== 城市中心(base=28)落在各地形值的数量 ==');
const tally = {};
for (const c of metros) {
  const q = c.x - 28, r = c.y - 28;
  if (q >= 0 && q < W && r >= 0 && r < H) {
    const v = terrain[q * H + r];
    tally[v] = (tally[v] ?? 0) + 1;
  }
}
console.log(Object.fromEntries(Object.entries(tally).sort((a, b) => b[1] - a[1])));

// 剩余数据概览（可能是贴图/装饰）
console.log('\n剩余数据前64字节:', b.subarray(o, o + 64).toString('hex').match(/../g).join(' '));
