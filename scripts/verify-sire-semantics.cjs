/**
 * 用SIRE表语义验证血色byte0:
 * - 邻接分析: 12(渡所)邻河, 17(关)邻崖, 18(港)邻水, 8(海)东部大块
 * - 地理锚点: 成都以西=雪山, 金陵附近长江=沙洲, 庐江南=雷池
 */
const fs = require('fs');

const N = 200 * 200, CELL = 11, HEADER = 8;
function readMap(file, offset) {
  const fd = fs.openSync(file, 'r');
  const buf = Buffer.alloc(HEADER + N * CELL);
  fs.readSync(fd, buf, 0, buf.length, offset);
  fs.closeSync(fd);
  const t = new Uint8Array(N);
  for (let i = 0; i < N; i++) t[i] = buf[HEADER + i * CELL];
  return t;
}
const blood = readMap('C:/san11/xsyg/xsyg6/xsyg6/San11Pk/Media/san11pkres.bin', 0x20a40cb7);
const van = readMap('C:/san11/san11_原版/San11/Media/san11pkres.bin', 0x1f520cb7);

const idx = (x, y) => x * 200 + y;

console.log('== 血色地图各值邻接 (top5) ==');
for (const v of [6, 7, 8, 12, 13, 14, 17, 18, 15, 16, 19]) {
  const nb = {};
  let count = 0;
  for (let x = 0; x < 200; x++) for (let y = 0; y < 200; y++) {
    if (blood[idx(x, y)] !== v) continue;
    count++;
    for (const [nx, ny] of [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]]) {
      if (nx < 0 || nx >= 200 || ny < 0 || ny >= 200) continue;
      const nv = blood[idx(nx, ny)];
      nb[nv] = (nb[nv] ?? 0) + 1;
    }
  }
  const top = Object.entries(nb).sort((a, b) => b[1] - a[1]).slice(0, 5);
  console.log(`  值${v} (${count}格): ${top.map(([k, c]) => `${k}×${c}`).join(' ')}`);
}

// 东部海域: x>180 区域的值分布 (vanilla该区域几乎全是海=8)
console.log('\n== 东部远海区域 (x>185) 值分布 ==');
for (const [map, label] of [[blood, '血色'], [van, '原版']]) {
  const d = {};
  for (let x = 185; x < 200; x++) for (let y = 0; y < 200; y++) d[map[idx(x, y)]] = (d[map[idx(x, y)]] ?? 0) + 1;
  console.log(`  ${label}:`, Object.fromEntries(Object.entries(d).sort((a, b) => b[1] - a[1]).slice(0, 6)));
}

// 场景城市 → 格坐标 (base 28), 取成都/金陵/庐江/长安 周边
const scen = JSON.parse(fs.readFileSync('tools/xsyg_map/Scenario1.json', 'utf8'));
const cities = Object.values(scen.citySet).filter(c => c.BuildingType === 1);
const find = (name) => cities.find(c => c.Name === name || c.Name.includes(name));

function regionDump(map, label, cx, cy, rad, name) {
  console.log(`\n== ${name} (${cx},${cy}) 周边${rad}格 ${label} 值分布 ==`);
  const d = {};
  for (let x = cx - rad; x <= cx + rad; x++) for (let y = cy - rad; y <= cy + rad; y++) {
    if (x < 0 || x >= 200 || y < 0 || y >= 200) continue;
    d[map[idx(x, y)]] = (d[map[idx(x, y)]] ?? 0) + 1;
  }
  console.log(' ', Object.fromEntries(Object.entries(d).sort((a, b) => b[1] - a[1])));
}

for (const [name, label] of [['成都', '成都(西边应有雪山)'], ['金陵', '金陵(长江沙洲)'], ['庐江', '庐江(南边雷池)'], ['长安', '长安']]) {
  const c = find(name);
  if (c) {
    const q = c.x - 28, r = c.y - 28;
    regionDump(blood, '血色', q, r, 6, label);
    regionDump(van, '原版', q, r, 6, '');
  }
}
