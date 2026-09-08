// 从原版游戏文件中提取地形名称字符串 (UTF-16LE)，并尝试与 p0 值对齐
const fs = require('fs');
const files = [
  'C:/san11/san11_原版/San11/San11.exe',
  'C:/san11/san11_原版/San11/Media/san11pkres.bin',
];
const TERMS = ['平原', '草地', '森林', '丘陵', '山地', '山地 ', '湿地', '浅滩', '河', '海', '道路', '渡口', '荒地', '栈道', '崖', '关', '港', '土', '小径', '沼泽', '水', '林', '泽', '建'];
function isCJK(code) {
  return (code >= 0x3000 && code <= 0x30ff) || (code >= 0x4e00 && code <= 0x9fff) || (code >= 0xff00 && code <= 0xffef);
}
for (const f of files) {
  if (!fs.existsSync(f)) { console.log('missing', f); continue; }
  const buf = fs.readFileSync(f);
  console.log(`\n===== ${f} (${buf.length} bytes) =====`);
  // 扫描连续 CJK 串 (UTF-16LE, 允许串间 0x00 0x00 分隔)，收集 1~6 字的短串及其偏移
  const hits = [];
  for (let i = 0; i + 1 < buf.length; i += 2) {
    const code = buf.readUInt16LE(i);
    if (!isCJK(code)) continue;
    // 读一个串
    let j = i, str = '';
    while (j + 1 < buf.length) {
      const c = buf.readUInt16LE(j);
      if (!isCJK(c)) break;
      str += String.fromCharCode(c);
      j += 2;
      if (str.length > 8) break;
    }
    if (str.length >= 1 && str.length <= 6 && TERMS.some((t) => str === t.trim() || str.includes(t.trim()))) {
      hits.push({ off: i, str });
      i = j - 2;
    }
  }
  console.log(`short terrain-ish strings: ${hits.length}`);
  // 聚类：偏移相近(<=64B)的串打印成组
  let group = [];
  let lastOff = -1e9;
  const flush = () => { if (group.length >= 3) console.log(`  @0x${group[0].off.toString(16)}: ` + group.map((g) => `${g.str}(+0x${(g.off - group[0].off).toString(16)})`).join(' ')); group = []; };
  for (const h of hits) {
    if (h.off - lastOff > 64) flush();
    group.push(h); lastOff = h.off;
  }
  flush();
}
