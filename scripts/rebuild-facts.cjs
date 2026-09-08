/**
 * 重建事实:
 * A) 对照实验 readFileSync({start,end}) vs readSync
 * B) 正确读取下 4 条目 cell-major 11 平面分布
 * C) 原版段0/byte0 上的城市基座扫描 (base 0..60, 列/行序)
 */
const fs = require('fs');

const MOD = 'C:/san11/xsyg/xsyg6/xsyg6/San11Pk/Media/san11pkres.bin';
const VAN = 'C:/san11/san11_原版/San11/Media/san11pkres.bin';
const N = 40000, HDR = 8, SIZE = HDR + N * 11;

console.log('node', process.version);

console.log('\n== A) 对照实验: 同一偏移 0x20a40cb7 ==');
const a1 = fs.readFileSync(MOD, { start: 0x20a40cb7, end: 0x20a40cb7 + 15 });
console.log('  readFileSync({start,end}) 头16字节:', [...a1].map((v) => v.toString(16).padStart(2, '0')).join(' '));
const fd = fs.openSync(MOD, 'r');
const a2 = Buffer.alloc(16);
fs.readSync(fd, a2, 0, 16, 0x20a40cb7);
console.log('  readSync(pos)          头16字节:', [...a2].map((v) => v.toString(16).padStart(2, '0')).join(' '));
const a3 = Buffer.alloc(16);
fs.readSync(fd, a3, 0, 16, 0);
console.log('  readSync(pos=0)文件开头 头16字节:', [...a3].map((v) => v.toString(16).padStart(2, '0')).join(' '));
fs.closeSync(fd);

function readEntry(file, off) {
  const f = fs.openSync(file, 'r');
  const buf = Buffer.alloc(SIZE);
  fs.readSync(f, buf, 0, SIZE, off);
  fs.closeSync(f);
  return buf;
}

console.log('\n== B) cell-major 11 平面分布 (readSync 正确读取) ==');
const entries = {
  '血色A': readEntry(MOD, 0x20a40cb7),
  '血色B': readEntry(MOD, 0x26800119),
  '原版A': readEntry(VAN, 0x1f520cb7),
  '原版B': readEntry(VAN, 0x252e0119),
};
for (const [name, buf] of Object.entries(entries)) {
  console.log(`  ${name} 头部=${buf.toString('ascii', 0, 8)}`);
  for (let p = 0; p < 11; p++) {
    const dist = {};
    for (let i = 0; i < N; i++) { const v = buf[HDR + i * 11 + p]; dist[v] = (dist[v] ?? 0) + 1; }
    const top = Object.entries(dist).sort((x, y) => y[1] - x[1]).slice(0, 5);
    console.log(`    p${p}: ${top.map(([v, c]) => `${v}×${c}`).join(' ')} (值种=${Object.keys(dist).length})`);
  }
}

console.log('\n== C) 原版A 城市基座扫描 ==');
const scen = JSON.parse(fs.readFileSync('tools/xsyg_map/Scenario1.json', 'utf8'));
const allCities = Object.values(scen.citySet).map((c) => ({ x: c.x, y: c.y, bt: c.BuildingType }));

// plane-major 段0 与 cell-major byte0 两个候选底图
const vanA = entries['原版A'];
const bases = {
  '段0(plane-major)': vanA.subarray(HDR, HDR + N),
  'byte0(cell-major)': (() => { const a = new Uint8Array(N); for (let i = 0; i < N; i++) a[i] = vanA[HDR + i * 11]; return a; })(),
};

for (const [bname, base] of Object.entries(bases)) {
  console.log(`  底图=${bname}`);
  const results = [];
  for (const flip of [false, true]) {
    for (const order of ['col', 'row']) {
      for (let bx = 0; bx <= 60; bx++) {
        for (let by = 0; by <= 60; by++) {
          const tally = {};
          let inMap = 0;
          for (const c of allCities) {
            let x = c.x - bx, y = c.y - by;
            if (x < 0 || x >= 200 || y < 0 || y >= 200) continue;
            inMap++;
            const i = order === 'col' ? x * 200 + y : y * 200 + x;
            const v = base[i];
            tally[v] = (tally[v] ?? 0) + 1;
          }
          const sorted = Object.entries(tally).sort((a, b) => b[1] - a[1]);
          const score = Number(sorted[0][1]) + (sorted[1] ? Number(sorted[1][1]) : 0);
          results.push({ flip, order, bx, by, top: sorted[0], second: sorted[1], inMap, score });
        }
      }
    }
  }
  results.sort((a, b) => b.score - a.score);
  for (const r of results.slice(0, 12)) {
    console.log(`    flip=${r.flip ? 1 : 0} ${r.order} base=(${r.bx},${r.by}) top[${r.top.join('×')}] 次[${r.second ? r.second.join('×') : '-'}] 城内=${r.inMap}`);
  }
}
