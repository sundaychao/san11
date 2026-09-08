/** 测试血色城市坐标在不同偏移基准下的落点质量 */
const fs = require('fs');

const MOD = 'C:/san11/xsyg/xsyg6/xsyg6/San11Pk/Media/san11pkres.bin';
const BLOOD_OFFSET = 0x20a40cb7;
const HEADER = 8, CELL = 11, N = 200 * 200;

const fd = fs.openSync(MOD, 'r');
const buf = Buffer.alloc(HEADER + N * CELL);
fs.readSync(fd, buf, 0, buf.length, BLOOD_OFFSET);
fs.closeSync(fd);
const blood = new Uint8Array(N);
for (let i = 0; i < N; i++) blood[i] = buf[HEADER + i * CELL];

const scenario = JSON.parse(fs.readFileSync('tools/xsyg_map/Scenario1.json', 'utf8'));
const cities = Object.values(scenario.citySet).filter((c) => c.BuildingType === 1);

// 水系(6,7,8,14)与山崖(15)视为不可作城心；16-18 是都市/港/关所——港在原版多临水，也统计单独看
for (let base = 22; base <= 34; base++) {
  let bad = 0;
  const badNames = [];
  for (const c of cities) {
    const q = c.x - base, r = c.y - base;
    if (q < 0 || q >= 200 || r < 0 || r >= 200) { bad++; badNames.push(`${c.Name}:出界`); continue; }
    const v = blood[q * 200 + r];
    if ([6, 7, 8, 14, 15].includes(v)) { bad++; badNames.push(`${c.Name}:${v}`); }
  }
  console.log(`base=${base}: 落水/山/出界 ${bad}/42 ${bad <= 8 ? badNames.join(' ') : ''}`);
}
