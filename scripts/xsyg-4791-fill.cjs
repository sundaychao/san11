/**
 * 验证 0x20a40cb7 (entry 4791) 是否为 0x7F 填充模板；
 * 同时对比血色与原版城市坐标是否一致
 */
const fs = require('fs');

const MOD = 'C:/san11/xsyg/xsyg6/xsyg6/San11Pk/Media/san11pkres.bin';
const N = 40000, HDR = 8;
const OFF_4791 = 0x20a40cb7;
const OFF_4863 = 0x26800119;

const b4791 = fs.readFileSync(MOD, { start: OFF_4791, end: OFF_4791 + HDR + N * 11 - 1 });
const b4863 = fs.readFileSync(MOD, { start: OFF_4863, end: OFF_4863 + HDR + N * 11 - 1 });

console.log('== 4791 (0x20a40cb7) 头部 ==');
console.log('  HDR:', [...b4791.slice(0, 8)].map((v) => v.toString(16).padStart(2, '0')).join(' '));
console.log('== 4863 (0x26800119) 头部 ==');
console.log('  HDR:', [...b4863.slice(0, 8)].map((v) => v.toString(16).padStart(2, '0')).join(' '));

console.log('\n== 4791 每平面值分布 (top5) ==');
for (let p = 0; p < 11; p++) {
  const dist = {};
  for (let i = 0; i < N; i++) {
    const v = b4791[HDR + i * 11 + p];
    dist[v] = (dist[v] ?? 0) + 1;
  }
  const top = Object.entries(dist).sort((a, b) => b[1] - a[1]).slice(0, 5);
  console.log(`  p${p}: ${top.map(([v, c]) => `0x${Number(v).toString(16)}×${c}`).join(' ')} (值种=${Object.keys(dist).length})`);
}

let diff = 0;
for (let i = 0; i < N * 11; i++) if (b4791[HDR + i] !== b4863[HDR + i]) diff++;
console.log(`\n== 4791 vs 4863 全条目差异字节: ${diff}/${N * 11} ==`);

const d4791 = {};
for (let i = 0; i < N * 11; i++) { const v = b4791[HDR + i]; d4791[v] = (d4791[v] ?? 0) + 1; }
console.log('  4791 全字节分布 top5:', Object.entries(d4791).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([v, c]) => `0x${Number(v).toString(16)}×${c}`).join(' '));

console.log('\n== 血色 Scenario1 城市 vs 原版城市坐标 ==');
const scen = JSON.parse(fs.readFileSync('tools/xsyg_map/Scenario1.json', 'utf8'));
const blood = Object.values(scen.citySet).map((c) => ({ id: c.Id ?? c.id, name: c.Name ?? c.name, x: c.x, y: c.y, bt: c.BuildingType }));
console.log(`  血色城市总数: ${blood.length}`);
const origPath = 'tools/xsyg_map/vanilla-cities.json';
if (fs.existsSync(origPath)) {
  const orig = JSON.parse(fs.readFileSync(origPath, 'utf8'));
  const list = Array.isArray(orig) ? orig : Object.values(orig);
  console.log(`  原版城市总数: ${list.length}`);
  let same = 0, diff2 = 0;
  for (const b of blood) {
    const o = list.find((x) => (x.id ?? x.Id) === (b.id ?? b.Id));
    if (o && o.x === b.x && o.y === b.y) same++;
    else diff2++;
  }
  console.log(`  坐标相同=${same} 不同/缺失=${diff2}`);
  const diffList = blood.filter((b) => {
    const o = list.find((x) => (x.id ?? x.Id) === (b.id ?? b.Id));
    return !o || o.x !== b.x || o.y !== b.y;
  });
  if (diffList.length) {
    console.log('  差异城市:');
    for (const b of diffList.slice(0, 20)) {
      const o = list.find((x) => (x.id ?? x.Id) === (b.id ?? b.Id));
      console.log(`    id=${b.id ?? b.Id} ${b.name}: 血色(${b.x},${b.y}) 原版${o ? `(${o.x},${o.y})` : '(缺失)'}`);
    }
  }
} else {
  console.log(`  [跳过] 未找到 ${origPath}`);
  console.log('  血色前10城:', blood.slice(0, 10).map((b) => `id=${b.id ?? b.Id}(${b.x},${b.y})`).join(' '));
}
