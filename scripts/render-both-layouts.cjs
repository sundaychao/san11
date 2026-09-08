/** 用行主序(y*200+x)与列主序(x*200+y)两种方式渲染血色图，看哪种像中国地图 */
const fs = require('fs');

const MOD = 'C:/san11/xsyg/xsyg6/xsyg6/San11Pk/Media/san11pkres.bin';
const VANILLA = 'C:/san11/san11_原版/San11/Media/san11pkres.bin';
const HEADER = 8, CELL = 11, N = 200 * 200;

function readMap(file, offset) {
  const fd = fs.openSync(file, 'r');
  const buf = Buffer.alloc(HEADER + N * CELL);
  fs.readSync(fd, buf, 0, buf.length, offset);
  fs.closeSync(fd);
  const t = new Uint8Array(N);
  for (let i = 0; i < N; i++) t[i] = buf[HEADER + i * CELL];
  return t;
}

const blood = readMap(MOD, 0x20a40cb7);
const van = readMap(VANILLA, 0x1f520cb7);

// 值→字符（按语义分组渲染：先按血色值频率粗略分：大山/水/平地）
// 直接每个值一个字符，肉眼对比形状
const CH = '0123456789ABCDEFGHIJKLMNOPQRSTUV';
function ascii(get, title) {
  console.log(`\n== ${title} ==`);
  for (let row = 0; row < 50; row++) {
    let line = '';
    for (let col = 0; col < 100; col++) {
      const x = col * 2, y = row * 4;
      line += CH[get(x, y)];
    }
    console.log(line);
  }
}

// 行主序: 网格(x=列,y=行) → t[y*200+x]
ascii((x, y) => blood[y * 200 + x], '血色图 行主序 (x=横向, y=纵向)');
// 列主序: 网格(x=列,y=行) → t[x*200+y]
ascii((x, y) => blood[x * 200 + y], '血色图 列主序');
// 原版参照（列主序，已验证城市对齐）
ascii((x, y) => van[x * 200 + y], '原版图 列主序（参照）');

// 决定性测试：行主序下城市中心对齐测试（任意值、多种base）
const scen = JSON.parse(fs.readFileSync('tools/xsyg_map/Scenario1.json', 'utf8'));
const metros = Object.values(scen.citySet).filter((c) => c.BuildingType === 1);
console.log('\n== 行主序 城市中心落在同一值的最大数量 ==');
for (let base = 24; base <= 32; base++) {
  const tally = {};
  for (const c of metros) {
    const q = c.x - base, r = c.y - base;
    if (q >= 0 && q < 200 && r >= 0 && r < 200) {
      const v = blood[r * 200 + q];
      tally[v] = (tally[v] ?? 0) + 1;
    }
  }
  const top = Object.entries(tally).sort((a, b) => b[1] - a[1])[0];
  console.log(`  base=${base}: 值${top?.[0]} 命中${top?.[1]}/42`, top && top[1] >= 30 ? ' ←★显著' : '');
}
