/** 扫描血色存档中的地图数据：找空间连续的字节平面（任意步长/偏移） */
const fs = require('fs');

const save = fs.readFileSync('C:/san11/xsyg/xsyg6/xsyg6/San11Pk/Koei/San11 Tc/SaveData/Save000.s11');
console.log('存档大小:', save.length);

// 粗扫: 对每个候选步长 s 和偏移 o，取前 300 个采样的相邻同值率
// 地形列主序: 连续 200 格是一列 (x固定, y=0..199)，相邻格同值率高
function testPlane(s, o, n) {
  let same = 0;
  for (let i = 1; i < n; i++) {
    if (save[o + i * s] === save[o + (i - 1) * s]) same++;
  }
  return same / (n - 1);
}

console.log('\n== 粗扫: 步长 7/11/12, 每字节偏移, 300格采样, 连续率>50% 记录 ==');
const found = [];
for (const s of [11, 7, 12, 10, 13, 14, 15]) {
  for (let o = 0; o + 300 * s < save.length; o++) {
    const r = testPlane(s, o, 200);
    if (r > 0.5) {
      // 验证扩展: 2000格
      const r2 = testPlane(s, o, 2000);
      if (r2 > 0.55) {
        found.push({ s, o, r: r2 });
        console.log(`  步长${s} 偏移${o} (0x${o.toString(16)}) 连续率${(r2 * 100).toFixed(1)}%`);
        o += 200 * s; // 跳过该区域避免重复
      }
    }
  }
}
console.log('候选数:', found.length);
