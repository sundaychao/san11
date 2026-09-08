/**
 * 验证血色byte0是否为真实地形(非加密):
 * 1. 城市中心落值(应为可通过陆地/都市)
 * 2. 边界值(地图四周应为山崖类)
 * 3. 大面积连通区域(海/平原/山系)
 */
const fs = require('fs');

const N = 200 * 200;
const CELL = 11;
const HEADER = 8;

function readMap(file, offset) {
  const fd = fs.openSync(file, 'r');
  const buf = Buffer.alloc(HEADER + N * CELL);
  fs.readSync(fd, buf, 0, buf.length, offset);
  fs.closeSync(fd);
  const types = new Uint8Array(N);
  for (let i = 0; i < N; i++) types[i] = buf[HEADER + i * CELL];
  return types;
}

const blood = readMap('C:/san11/xsyg/xsyg6/xsyg6/San11Pk/Media/san11pkres.bin', 0x20a40cb7);
const van = readMap('C:/san11/san11_原版/San11/Media/san11pkres.bin', 0x1f520cb7);

// 1. 城市中心与周边落值
const scen = JSON.parse(fs.readFileSync('tools/xsyg_map/Scenario1.json', 'utf8'));
const cities = Object.values(scen.citySet);
console.log(`== 城市中心血色byte0落值 (${cities.length}城) ==`);
const tally = {};
for (const c of cities) {
  const q = c.x - 28, r = c.y - 28;
  if (q >= 0 && q < 200 && r >= 0 && r < 200) {
    const v = blood[q * 200 + r];
    (tally[v] ??= []).push(c.Name);
  }
}
for (const [v, names] of Object.entries(tally).sort((a, b) => b[1].length - a[1].length)) {
  console.log(`  值${v}: ${names.length}城 ${names.slice(0, 8).join(',')}${names.length > 8 ? '...' : ''}`);
}

// 2. 城市周边3x3的值分布
console.log('\n== 城市周边3x3血色值分布 ==');
const around = {};
for (const c of cities) {
  const q = c.x - 28, r = c.y - 28;
  for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
    const x = q + dx, y = r + dy;
    if (x >= 0 && x < 200 && y >= 0 && y < 200) {
      const v = blood[x * 200 + y];
      around[v] = (around[v] ?? 0) + 1;
    }
  }
}
console.log(' ', Object.fromEntries(Object.entries(around).sort((a, b) => b[1] - a[1]).slice(0, 12)));

// 3. 边界环(最外2圈)的值分布
console.log('\n== 血色地图边界环值分布 ==');
const border = {};
for (let x = 0; x < 200; x++) for (let y = 0; y < 200; y++) {
  if (x < 2 || x >= 198 || y < 2 || y >= 198) {
    const v = blood[x * 200 + y];
    border[v] = (border[v] ?? 0) + 1;
  }
}
console.log(' ', Object.fromEntries(Object.entries(border).sort((a, b) => b[1] - a[1])));
console.log('  原版对照:', Object.fromEntries(Object.entries((() => {
  const d = {};
  for (let x = 0; x < 200; x++) for (let y = 0; y < 200; y++) {
    if (x < 2 || x >= 198 || y < 2 || y >= 198) d[van[x * 200 + y]] = (d[van[x * 200 + y]] ?? 0) + 1;
  }
  return d;
})()).sort((a, b) => b[1] - a[1])));

// 4. 连通域分析: 每个值形成的最大连通块
console.log('\n== 各值的连通性(最大连通块/总面积) ==');
function connAnalysis(types, label) {
  console.log(`  -- ${label} --`);
  const seen = new Uint8Array(N);
  const dist = {};
  for (const v of types) dist[v] = (dist[v] ?? 0) + 1;
  const results = [];
  for (const vStr of Object.keys(dist)) {
    const v = +vStr;
    let maxSize = 0, blocks = 0;
    for (let i = 0; i < N; i++) {
      if (types[i] !== v || seen[i]) continue;
      blocks++;
      let size = 0;
      const stack = [i];
      seen[i] = 1;
      while (stack.length) {
        const j = stack.pop();
        size++;
        const x = Math.floor(j / 200), y = j % 200;
        for (const [nx, ny] of [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]]) {
          if (nx < 0 || nx >= 200 || ny < 0 || ny >= 200) continue;
          const k = nx * 200 + ny;
          if (types[k] === v && !seen[k]) { seen[k] = 1; stack.push(k); }
        }
      }
      maxSize = Math.max(maxSize, size);
    }
    results.push({ v, total: dist[vStr], blocks, maxSize });
  }
  results.sort((a, b) => b.total - a.total);
  for (const r of results.slice(0, 15)) {
    console.log(`    值${r.v}: 总${r.total}格, ${r.blocks}块, 最大块${r.maxSize} (${(r.maxSize / r.total * 100).toFixed(0)}%)`);
  }
}
connAnalysis(blood, '血色地图');
connAnalysis(van, '原版地图(对照: 15=山,8=海,6=江)');
