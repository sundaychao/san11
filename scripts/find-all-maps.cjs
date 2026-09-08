/** 扫描血色pkres中所有SHEX0008块，逐个检查：场景87建筑(base28)落值聚类 + 值分布 */
const fs = require('fs');

const FILE = 'C:/san11/xsyg/xsyg6/xsyg6/San11Pk/Media/san11pkres.bin';
const size = fs.statSync(FILE).size;
console.log('pkres大小:', (size / 1024 / 1024).toFixed(0), 'MB');

const CHUNK = 1 << 24;
const fd = fs.openSync(FILE, 'r');
const buf = Buffer.alloc(CHUNK);
const pat = Buffer.from('SHEX0008');
const offsets = [];
let pos = 0;
while (true) {
  const n = fs.readSync(fd, buf, 0, CHUNK, pos);
  if (n === 0) break;
  let idx = 0;
  while ((idx = buf.subarray(0, n).indexOf(pat, idx)) !== -1) {
    offsets.push(pos + idx);
    idx++;
  }
  pos += n - 8;
  if (pos >= size) break;
}
console.log('SHEX0008 块数量:', offsets.length, offsets.map((o) => '0x' + o.toString(16)).join(', '));

// 场景建筑
const scen = JSON.parse(fs.readFileSync('tools/xsyg_map/Scenario1.json', 'utf8'));
const byType = {};
for (const c of Object.values(scen.citySet)) (byType[c.BuildingType] ??= []).push(c);

const N = 200 * 200;
for (const off of offsets) {
  const b = Buffer.alloc(8 + N * 11);
  fs.readSync(fd, b, 0, b.length, off);
  const t = new Uint8Array(N);
  const dist = {};
  for (let i = 0; i < N; i++) {
    const v = b[8 + i * 11];
    t[i] = v;
    dist[v] = (dist[v] ?? 0) + 1;
  }
  const top = Object.entries(dist).sort((a, b) => b[1] - a[1]).slice(0, 6);
  // 场景建筑落值(base 28)
  const result = {};
  for (const [type, list] of Object.entries(byType)) {
    const tally = {};
    for (const c of list) {
      const q = c.x - 28, r = c.y - 28;
      if (q < 0 || q >= 200 || r < 0 || r >= 200) continue;
      const v = t[q * 200 + r];
      tally[v] = (tally[v] ?? 0) + 1;
    }
    const best = Object.entries(tally).sort((a, b) => b[1] - a[1])[0];
    result[type] = best ? `值${best[0]} ${best[1]}/${list.length}` : '?';
  }
  console.log(`\n== 块 0x${off.toString(16)} ==`);
  console.log('  值分布top6:', top.map(([v, c]) => `${v}×${c}`).join(' '));
  console.log('  建筑落值(都市/关/港):', JSON.stringify(result));
}
fs.closeSync(fd);
