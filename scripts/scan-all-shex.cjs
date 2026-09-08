/**
 * 多文件 SHEX 扫描: 在血色 MOD 的所有大文件中找 SHEX0008, 用城市落值签名鉴定真地图
 */
const fs = require('fs');
const path = require('path');

const ROOT = 'C:/san11/xsyg/xsyg6/xsyg6';
const TARGETS = [
  'San11Pk/Media/san11pkres.bin',
  'San11Pk/san11pk.exe',
  'San11Pk/San11.exe',
  'SIRE v2.10/San11SIRE.exe',
];

const N = 40000;
const scen = JSON.parse(fs.readFileSync('tools/xsyg_map/Scenario1.json', 'utf8'));
const metros = Object.values(scen.citySet)
  .filter((c) => c.BuildingType === 1)
  .map((c) => ({ q: c.x - 28, r: c.y - 28 }))
  .filter((c) => c.q >= 0 && c.q < 200 && c.r >= 0 && c.r < 200);

function evaluate(buf, off) {
  if (off + 8 + N * 11 > buf.length) return null;
  const t = new Uint8Array(N);
  for (let i = 0; i < N; i++) t[i] = buf[off + 8 + i * 11];
  const tally = {};
  for (const c of metros) { const v = t[c.q * 200 + c.r]; tally[v] = (tally[v] ?? 0) + 1; }
  const sorted = Object.entries(tally).sort((a, b) => b[1] - a[1]);
  const ring = {};
  for (let q = 0; q < 200; q++) for (const r of [0, 199]) { const v = t[q * 200 + r]; ring[v] = (ring[v] ?? 0) + 1; }
  for (let r = 1; r < 199; r++) for (const q of [0, 199]) { const v = t[q * 200 + r]; ring[v] = (ring[v] ?? 0) + 1; }
  const ringTop = Object.entries(ring).sort((a, b) => b[1] - a[1])[0];
  return { topV: sorted[0]?.[1] ?? 0, sorted: sorted.slice(0, 3), ringTop, t };
}

for (const rel of TARGETS) {
  const file = path.join(ROOT, rel);
  if (!fs.existsSync(file)) { console.log('缺失:', rel); continue; }
  const buf = fs.readFileSync(file);
  console.log(`\n##### ${rel} (${(buf.length / 1e6).toFixed(0)} MB)`);

  const hits = [];
  let idx = 0;
  while ((idx = buf.indexOf('SHEX', idx)) !== -1) { hits.push(idx); idx += 4; }
  const vers = {};
  for (const h of hits) { const v = buf.toString('latin1', h, h + 8); vers[v] = (vers[v] ?? 0) + 1; }
  console.log('SHEX出现:', hits.length, JSON.stringify(vers));

  let found = 0;
  for (const h of hits) {
    if (buf.toString('latin1', h, h + 8) !== 'SHEX0008') continue;
    const ev = evaluate(buf, h);
    if (!ev) continue;
    if (ev.topV >= 20 || ev.ringTop[1] >= 500) {
      found++;
      console.log(
        `  ★ 0x${h.toString(16)}: 都市落值[${ev.sorted.map(([v, n]) => `${v}×${n}`).join(' ')}]`
        + ` 边界主导[${ev.ringTop[0]}×${ev.ringTop[1]}/796]`,
      );
    }
  }
  if (found === 0) console.log('  (无像地图的 SHEX0008 候选)');
}
