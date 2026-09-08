/**
 * 存档签名扫描: 找运行时地形块
 * 签名: 42都市/10关/35港 (scenario坐标-28, x*200+y) 各自落在同一字节值上
 * 扫描存档每个偏移 o, 读 save[o+i] 为第i格地形
 */
const fs = require('fs');
const save = fs.readFileSync('C:/san11/xsyg/xsyg6/xsyg6/San11Pk/Koei/San11 Tc/SaveData/Save000.s11');
console.log('存档大小:', save.length);

const scen = JSON.parse(fs.readFileSync('tools/xsyg_map/Scenario1.json', 'utf8'));
const byType = {};
for (const c of Object.values(scen.citySet)) (byType[c.BuildingType] ??= []).push(c);
// 建筑位置索引 (x*200+y, base 28)
const posByType = {};
for (const [type, list] of Object.entries(byType)) {
  posByType[type] = list.map((c) => (c.x - 28) * 200 + (c.y - 28)).filter((p) => p >= 0 && p < 40000);
}

const hits = [];
for (let o = 0; o + 40000 <= save.length; o++) {
  // 快筛: 42都市中前6个的值必须全部相同
  const ps = posByType['1'];
  const v0 = save[o + ps[0]];
  let ok = true;
  for (let k = 1; k < 6; k++) {
    if (save[o + ps[k]] !== v0) { ok = false; break; }
  }
  if (!ok) continue;
  // 全量验证: 42都市 ≤2种值, 10关全同, 35港全同
  const dSet = new Set(posByType['1'].map((p) => save[o + p]));
  if (dSet.size > 2) continue;
  const gSet = new Set(posByType['2'].map((p) => save[o + p]));
  if (gSet.size > 1) continue;
  const kSet = new Set(posByType['3'].map((p) => save[o + p]));
  if (kSet.size > 1) continue;
  hits.push({ o, d: [...dSet], g: [...gSet], k: [...kSet] });
}
console.log('命中数:', hits.length);
for (const h of hits.slice(0, 20)) {
  console.log(`偏移 ${h.o} (0x${h.o.toString(16)}): 都市值=${h.d} 关值=${h.g} 港值=${h.k}`);
  // 打印值分布
  const dist = {};
  for (let i = 0; i < 40000; i++) {
    const v = save[h.o + i];
    if (v <= 63) dist[v] = (dist[v] ?? 0) + 1;
  }
  const top = Object.entries(dist).sort((a, b) => b[1] - a[1]).slice(0, 12);
  console.log('  值分布(≤63):', top.map(([v, c]) => v + '×' + c).join(' '));
}
