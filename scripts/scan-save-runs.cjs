/**
 * 扫描血色存档中的长低值游程
 * 地形平面 = 40000字节连续且值<=31(或<=20)的区域
 */
const fs = require('fs');

const save = fs.readFileSync('C:/san11/xsyg/xsyg6/xsyg6/San11Pk/Koei/San11 Tc/SaveData/Save000.s11');
console.log('存档大小:', save.length);

function scanRuns(maxVal, minLen) {
  const runs = [];
  let start = -1;
  for (let i = 0; i < save.length; i++) {
    if (save[i] <= maxVal) {
      if (start < 0) start = i;
    } else {
      if (start >= 0 && i - start >= minLen) runs.push({ start, len: i - start });
      start = -1;
    }
  }
  if (start >= 0 && save.length - start >= minLen) runs.push({ start, len: save.length - start });
  return runs;
}

for (const [maxVal, label] of [[15, '值0-15(4bit地形?)'], [19, '值0-19(原版地形)'], [31, '值0-31(扩展地形)'], [95, '值0-95(区域ID)']]) {
  const runs = scanRuns(maxVal, 5000);
  console.log(`\n== ${label}: >=5000字节的游程 ==`);
  for (const r of runs) {
    // 游程内值分布
    const d = {};
    for (let i = r.start; i < r.start + Math.min(r.len, 60000); i++) d[save[i]] = (d[save[i]] ?? 0) + 1;
    const top = Object.entries(d).sort((a, b) => b[1] - a[1]).slice(0, 5);
    console.log(`  起点=${r.start} (0x${r.start.toString(16)}) 长度=${r.len}  top值: ${top.map(([k, c]) => `${k}×${c}`).join(' ')}`);
  }
}
