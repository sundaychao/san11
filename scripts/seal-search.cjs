/**
 * 1. 在seal文件中搜索地形名称字符串
 * 2. 验证原版地图 12/13/17/18 的语义(邻接分析)
 */
const fs = require('fs');

// --- seal 文件搜索 ---
const seal = fs.readFileSync('C:/san11/xsyg/xsyg6/xsyg6/SIRE v2.10/血色衣冠6.0(SIRE2.10)sp11.seal');
console.log('seal大小:', seal.length, '头16字节:', seal.subarray(0, 16).toString('hex'));

const names = ['沼泽', '雪山', '沙洲', '雷池', '塬', '湖泊', '湖', '浅滩', '渡所', '草地', '湿地', '毒泉', '栈道', '小径', '主径', '荒地', '森', '关', '港', '城市', '崖', '岸', '海', '河', '川', '砂地', '土'];

function searchAll(buf, label) {
  console.log(`\n== ${label} 搜索 UTF-16LE ==`);
  for (const name of names) {
    const pat = Buffer.from(name, 'utf16le');
    const hits = [];
    let idx = 0;
    while ((idx = buf.indexOf(pat, idx)) !== -1) { hits.push(idx); idx++; if (hits.length >= 3) break; }
    if (hits.length) console.log(`  ${name}: ${hits.length}${hits.length >= 3 ? '+' : ''}处 ${hits.map(h => '0x' + h.toString(16)).join(',')}`);
  }
  console.log(`== ${label} 搜索 UTF-8 ==`);
  for (const name of names) {
    const pat = Buffer.from(name, 'utf8');
    const hits = [];
    let idx = 0;
    while ((idx = buf.indexOf(pat, idx)) !== -1) { hits.push(idx); idx++; if (hits.length >= 3) break; }
    if (hits.length) console.log(`  ${name}: ${hits.length}${hits.length >= 3 ? '+' : ''}处 ${hits.map(h => '0x' + h.toString(16)).join(',')}`);
  }
}
searchAll(seal, 'seal');

// --- 原版地图邻接语义验证 ---
const N = 200 * 200, CELL = 11, HEADER = 8;
const fd = fs.openSync('C:/san11/san11_原版/San11/Media/san11pkres.bin', 'r');
const buf = Buffer.alloc(HEADER + N * CELL);
fs.readSync(fd, buf, 0, buf.length, 0x1f520cb7);
fs.closeSync(fd);
const t = (i) => buf[HEADER + i * CELL];

console.log('\n== 原版地图: 值12/13/17/18 格子的邻接地形 ==');
for (const v of [12, 13, 17, 18, 19, 10, 11]) {
  const nb = {};
  let count = 0;
  for (let x = 0; x < 200; x++) for (let y = 0; y < 200; y++) {
    const i = x * 200 + y;
    if (t(i) !== v) continue;
    count++;
    for (const [nx, ny] of [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]]) {
      if (nx < 0 || nx >= 200 || ny < 0 || ny >= 200) continue;
      const nv = t(nx * 200 + ny);
      nb[nv] = (nb[nv] ?? 0) + 1;
    }
  }
  const top = Object.entries(nb).sort((a, b) => b[1] - a[1]).slice(0, 6);
  console.log(`  值${v} (${count}格): 邻接 ${top.map(([k, c]) => `${k}×${c}`).join(' ')}`);
}
