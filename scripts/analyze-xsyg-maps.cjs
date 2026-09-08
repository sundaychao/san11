/**
 * 分析血色衣冠 pkres 的两个 SHEX0008 地图条目
 * - MOD 槽位1 @0x20a40cb7: 血色地图（扩展地形值）
 * - MOD 槽位2 @0x26800119: 原版地图（之前误用的）
 * - 原版 pkres 槽位1 @0x1f520cb7: 原版参照
 */
const fs = require('fs');

const FILES = {
  mod: 'C:/san11/xsyg/xsyg6/xsyg6/San11Pk/Media/san11pkres.bin',
  vanilla: 'C:/san11/san11_原版/San11/Media/san11pkres.bin',
};
const OFFSETS = {
  modBlood: 0x20a40cb7,
  modVanillaCopy: 0x26800119,
  vanillaSlot1: 0x1f520cb7,
};
const HEADER = 8;
const CELL = 11;
const N = 200 * 200;

function readMap(file, offset) {
  const fd = fs.openSync(file, 'r');
  const buf = Buffer.alloc(HEADER + N * CELL);
  fs.readSync(fd, buf, 0, buf.length, offset);
  fs.closeSync(fd);
  if (buf.toString('ascii', 0, 8) !== 'SHEX0008') throw new Error(`bad header @${offset}`);
  const types = new Uint8Array(N);
  for (let i = 0; i < N; i++) types[i] = buf[HEADER + i * CELL];
  return types;
}

const blood = readMap(FILES.mod, OFFSETS.modBlood);
const modVanillaCopy = readMap(FILES.mod, OFFSETS.modVanillaCopy);
const vanilla = readMap(FILES.vanilla, OFFSETS.vanillaSlot1);

function dist(types) {
  const d = {};
  for (const v of types) d[v] = (d[v] ?? 0) + 1;
  return Object.fromEntries(Object.entries(d).sort((a, b) => a[0] - b[0]));
}

console.log('== MOD槽位2(原版拷贝) vs 原版pkres槽位1 一致性 ==');
let same = 0;
for (let i = 0; i < N; i++) if (modVanillaCopy[i] === vanilla[i]) same++;
console.log(`  ${same}/${N} (${(same / N * 100).toFixed(1)}%)`);

console.log('\n== 血色地图(槽位1) 地形值分布 ==');
console.log(' ', dist(blood));

console.log('\n== 原版地图 地形值分布 ==');
console.log(' ', dist(vanilla));

console.log('\n== 血色 vs 原版 差异 ==');
let diff = 0;
const diffByValue = {};
for (let i = 0; i < N; i++) {
  if (blood[i] !== vanilla[i]) {
    diff++;
    const key = `${vanilla[i]}→${blood[i]}`;
    diffByValue[key] = (diffByValue[key] ?? 0) + 1;
  }
}
console.log(`  差异格数: ${diff}/${N} (${(diff / N * 100).toFixed(1)}%)`);
console.log('  原版值→血色值 变化统计:', Object.fromEntries(Object.entries(diffByValue).sort((a, b) => b[1] - a[1])));

// 边界模式验证 200 宽度: 第一行(前200格)与第一列应全为边界地形
console.log('\n== 血色地图边界模式（验证 200x200 索引） ==');
const row0 = [...blood.slice(0, 200)];
const rowLast = [...blood.slice(199 * 200, 200 * 200)];
console.log('  第0行 distinct:', [...new Set(row0)]);
console.log('  第199行 distinct:', [...new Set(rowLast)].slice(0, 10));
const col0 = [], colLast = [];
for (let y = 0; y < 200; y++) { col0.push(blood[y * 200]); colLast.push(blood[y * 200 + 199]); }
console.log('  第0列 distinct:', [...new Set(col0)].slice(0, 10));
console.log('  第199列 distinct:', [...new Set(colLast)].slice(0, 10));

// ASCII 缩略图对比（100x50，2列采样/4行采样）
function ascii(types, title) {
  console.log(`\n== ${title} ==`);
  const legend = (v) => {
    if (v === 28) return 'M'; // 扩展边界?
    if (v === 15) return 'M';
    if ([6, 7, 8, 14].includes(v)) return '~';
    if (v === 13) return '=';
    if ([10, 11, 12, 19].includes(v)) return '#';
    if (v === 5) return 'f';
    if (v >= 20) return String.fromCharCode(97 + (v - 20)); // a.. 扩展类型
    return '.';
  };
  for (let row = 0; row < 50; row++) {
    let line = '';
    for (let col = 0; col < 100; col++) {
      // 采样: 行向 x=col*2, 纵向 y=row*4
      const x = col * 2, y = row * 4;
      line += legend(types[x * 200 + y]);
    }
    console.log(line);
  }
}
ascii(vanilla, '原版地图 (v=原版值, ~=水, #=路, f=森, M=山/边界)');
ascii(blood, '血色地图 (a..=扩展值20+, 其余同原版图例)');
