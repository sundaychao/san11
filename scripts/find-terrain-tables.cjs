/** 在SIRE exe中搜索所有地形名出现位置: 雪山/沼泽/雷池/沙洲/塬/草地/毒泉... */
const fs = require('fs');
const exe = fs.readFileSync('C:/san11/xsyg/xsyg6/xsyg6/SIRE v2.10/San11SIRE.exe');

const NAMES = ['草地', '土', '砂地', '湿地', '毒泉', '森林', '山', '河', '海', '荒地', '主径', '栈道', '渡所', '浅滩', '岸', '崖', '城市', '关', '港', '小径',
  '雪山', '沼泽', '雷池', '沙洲', '塬', '长城', '运河', '湖泊', '大漠', '戈壁', '盐碱', '冻土', '河滩', '岛屿', '半岛', '峡谷', '盆地'];

function findUTF16(name) {
  const pat = Buffer.from(name, 'utf16le');
  const hits = [];
  let idx = 0;
  while ((idx = exe.indexOf(pat, idx)) !== -1) {
    hits.push(idx);
    idx++;
  }
  return hits;
}

const all = [];
for (const name of NAMES) {
  const hits = findUTF16(name);
  for (const h of hits) all.push({ pos: h, name, len: name.length });
}
all.sort((a, b) => a.pos - b.pos);

// 聚类: 相距<2000字节算同簇
const clusters = [];
for (const h of all) {
  const last = clusters[clusters.length - 1];
  if (last && h.pos - last.end < 2000) {
    last.items.push(h);
    last.end = h.pos;
  } else {
    clusters.push({ start: h.pos, end: h.pos, items: [h] });
  }
}
for (const c of clusters) {
  const names = c.items.map((i) => i.name + '@0x' + i.pos.toString(16));
  console.log(`\n== 簇 0x${c.start.toString(16)}-0x${c.end.toString(16)} (${c.items.length}个) ==`);
  console.log('  ' + names.join(' '));
}
