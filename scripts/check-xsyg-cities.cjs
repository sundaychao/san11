/**
 * 1) 检查血色城市坐标在血色地图(槽位1)上的落点地形
 * 2) 在 pkres 中搜索 GBK 地形名称表（草地/土地/砂地...），找扩展地形名
 */
const fs = require('fs');

const MOD = 'C:/san11/xsyg/xsyg6/xsyg6/San11Pk/Media/san11pkres.bin';
const VANILLA = 'C:/san11/san11_原版/San11/Media/san11pkres.bin';
const BLOOD_OFFSET = 0x20a40cb7;
const HEADER = 8, CELL = 11, N = 200 * 200;

// ---------- 读取血色地图 ----------
const fd = fs.openSync(MOD, 'r');
const buf = Buffer.alloc(HEADER + N * CELL);
fs.readSync(fd, buf, 0, buf.length, BLOOD_OFFSET);
const blood = new Uint8Array(N);
for (let i = 0; i < N; i++) blood[i] = buf[HEADER + i * CELL];

// ---------- 城市落点 ----------
const scenario = JSON.parse(fs.readFileSync('tools/xsyg_map/Scenario1.json', 'utf8'));
const cities = Object.values(scenario.citySet).filter((c) => c.BuildingType === 1);
console.log(`== 42 都市在血色地图上的落点地形（q=x-28, r=y-28） ==`);
let passable = 0;
const onValue = {};
for (const c of cities) {
  const q = c.x - 28, r = c.y - 28;
  const v = (q >= 0 && q < 200 && r >= 0 && r < 200) ? blood[q * 200 + r] : -1;
  onValue[v] = (onValue[v] ?? 0) + 1;
  const isWater = [6, 7, 8, 14].includes(v);
  if (!isWater) passable++;
  console.log(`  ${c.Name} (${q},${r}) tType=${v}${isWater ? '  ← 水域!' : ''}`);
}
console.log('落点地形值统计:', onValue, `可通行: ${passable}/42`);

// ---------- GBK 字符串搜索 ----------
function gbkHex(s) {
  return Buffer.from(s, 'gbk');
}
const VANILLA_TERRAIN_NAMES = ['草地', '土地', '砂地', '湿地', '毒泉', '森林', '江河', '河道', '大海', '荒地', '道路', '栈道', '小桥', '渡所', '岸', '山崖', '都市', '港', '关卡', '间道'];

function findOffsets(file, pattern, limit = 5) {
  const f = fs.openSync(file, 'r');
  const pat = Buffer.isBuffer(pattern) ? pattern : Buffer.from(pattern);
  const CHUNK = 1 << 24;
  const b = Buffer.alloc(CHUNK);
  let pos = 0, carry = Buffer.alloc(0);
  const hits = [];
  while (hits.length < limit) {
    const n = fs.readSync(f, b, 0, CHUNK, pos);
    if (n === 0) break;
    let data = carry.length ? Buffer.concat([carry, b.subarray(0, n)]) : b.subarray(0, n);
    let idx = 0;
    while ((idx = data.indexOf(pat, idx)) !== -1 && hits.length < limit) {
      hits.push(pos - carry.length + idx);
      idx += 1;
    }
    carry = Buffer.from(data.subarray(Math.max(0, data.length - pat.length)));
    pos += n;
  }
  fs.closeSync(f);
  return hits;
}

console.log('\n== 在原版 pkres 搜索「草地」(GBK) ==');
for (const off of findOffsets(VANILLA, gbkHex('草地'), 8)) {
  const f = fs.openSync(VANILLA, 'r');
  const ctx = Buffer.alloc(160);
  fs.readSync(f, ctx, 0, 160, Math.max(0, off - 80));
  fs.closeSync(f);
  console.log(`  offset=0x${off.toString(16)} ctx="${ctx.toString('gbk').replace(/[^\u4e00-\u9fff a-zA-Z0-9]/g, '?')}"`);
}
