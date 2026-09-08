/** 血色槽位(0x20a40cb7) 11个字节面 × 87建筑落值检查: 找含建筑足迹的字节面 */
const fs = require('fs');
const N = 200 * 200;
const fd = fs.openSync('C:/san11/xsyg/xsyg6/xsyg6/San11Pk/Media/san11pkres.bin', 'r');
const buf = Buffer.alloc(8 + N * 11);
fs.readSync(fd, buf, 0, buf.length, 0x20a40cb7);
fs.closeSync(fd);

const planes = [];
for (let p = 0; p < 11; p++) {
  const t = new Uint8Array(N);
  for (let i = 0; i < N; i++) t[i] = buf[8 + i * 11 + p];
  planes.push(t);
}

const scen = JSON.parse(fs.readFileSync('tools/xsyg_map/Scenario1.json', 'utf8'));
const byType = {};
for (const c of Object.values(scen.citySet)) (byType[c.BuildingType] ??= []).push(c);

// 每个字节面: 值分布概览 + 87建筑(base28)落值
for (let p = 0; p < 11; p++) {
  const t = planes[p];
  const dist = {};
  for (let i = 0; i < N; i++) dist[t[i]] = (dist[t[i]] ?? 0) + 1;
  const nvals = Object.keys(dist).length;
  const top = Object.entries(dist).sort((a, b) => b[1] - a[1]).slice(0, 4);
  const res = {};
  for (const [type, list] of Object.entries(byType)) {
    const tally = {};
    for (const c of list) {
      const q = c.x - 28, r = c.y - 28;
      if (q < 0 || q >= 200 || r < 0 || r >= 200) continue;
      const v = t[q * 200 + r];
      tally[v] = (tally[v] ?? 0) + 1;
    }
    const best = Object.entries(tally).sort((a, b) => b[1] - a[1])[0];
    res[type] = best ? `${best[0]}×${best[1]}/${list.length}` : '-';
  }
  console.log(`byte${p}: ${nvals}种值 top=${top.map(([v, c]) => v + '×' + c).join(' ')} | 建筑(都市/关/港): ${res['1']} ${res['2']} ${res['3']}`);
}
