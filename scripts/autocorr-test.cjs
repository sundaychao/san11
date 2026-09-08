/**
 * 空间自相关测试: 真实地形相邻格相同率应很高(60%+), 加密数据接近随机
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
  return buf;
}

const blood = readMap('C:/san11/xsyg/xsyg6/xsyg6/San11Pk/Media/san11pkres.bin', 0x20a40cb7);
const van = readMap('C:/san11/san11_原版/San11/Media/san11pkres.bin', 0x1f520cb7);

function autocorr(buf, label) {
  for (const p of [0, 1, 4, 9]) {
    let same = 0, total = 0;
    for (let x = 0; x < 199; x++) for (let y = 0; y < 200; y++) {
      const i = HEADER + (x * 200 + y) * CELL + p;
      const j = HEADER + ((x + 1) * 200 + y) * CELL + p;
      if (buf[i] === buf[j]) same++;
      total++;
    }
    console.log(`  ${label} 字节${p}: 水平相邻相同率 ${(same / total * 100).toFixed(1)}%`);
  }
}

console.log('== 原版地图 ==');
autocorr(van, '原版');
console.log('== 血色地图 ==');
autocorr(blood, '血色');

// 值分布均匀性: 加密数据 byte0 高4位/低4位 应该更均匀
// 另一个角度: 血色byte0的相邻格XOR差分布 vs 原版
function xorNeighbor(buf, label) {
  const d = {};
  let total = 0;
  for (let x = 0; x < 199; x++) for (let y = 0; y < 200; y++) {
    const i = HEADER + (x * 200 + y) * CELL;
    const j = HEADER + ((x + 1) * 200 + y) * CELL;
    const k = buf[i] ^ buf[j];
    d[k] = (d[k] ?? 0) + 1;
    total++;
  }
  const top = Object.entries(d).sort((a, b) => b[1] - a[1]).slice(0, 6);
  console.log(`  ${label} byte0相邻XOR: 0×${(d[0] / total * 100).toFixed(1)}% top: ${top.map(([k, c]) => `${k}:${(c / total * 100).toFixed(1)}%`).join(' ')}`);
}
console.log('\n== byte0 相邻格XOR分布 ==');
xorNeighbor(van, '原版');
xorNeighbor(blood, '血色');
