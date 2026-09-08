/**
 * 在 San11SIRE.exe 中搜索 GBK 编码的地形名称字符串
 */
const fs = require('fs');

const exe = fs.readFileSync('C:/san11/xsyg/xsyg6/xsyg6/SIRE v2.10/San11SIRE.exe');
console.log('exe大小:', exe.length);

const names = ['草地', '土地', '砂地', '湿地', '毒泉', '森林', '江河', '河道', '大海', '荒地',
  '道路', '栈道', '桥', '渡所', '岸', '山崖', '都市', '港', '关所', '间道',
  '沼泽', '雪山', '沙洲', '雷池', '湖泊', '小径', '塬', '荒漠', '草原', '山', '水'];

for (const name of names) {
  const pat = Buffer.from(name, 'utf16le');  // Unicode
  const patGbk = Buffer.from(name); // UTF-8 (Node默认) - 不对,需要GBK
  // Node无GBK编码,用常见字的GBK码手工不可行——先搜UTF-16LE
  const hitsU16 = [];
  let idx = 0;
  while ((idx = exe.indexOf(pat, idx)) !== -1) { hitsU16.push(idx); idx++; if (hitsU16.length > 5) break; }
  if (hitsU16.length) console.log(`${name} (UTF-16LE): ${hitsU16.map(h => '0x' + h.toString(16)).join(', ')}`);
}

// SIRE可能是MBCS(GBK)程序, 需要GBK搜索。构建GBK编码: 常用汉字GBK双字节
// 用 iconv-lite? 项目node_modules可能有
try {
  const iconv = require('iconv-lite');
  console.log('\n== iconv-lite GBK搜索 ==');
  for (const name of names) {
    const pat = iconv.encode(name, 'gbk');
    const hits = [];
    let idx = 0;
    while ((idx = exe.indexOf(pat, idx)) !== -1) { hits.push(idx); idx++; if (hits.length > 3) break; }
    if (hits.length) console.log(`${name} (GBK): ${hits.map(h => '0x' + h.toString(16)).join(', ')}`);
  }
} catch (e) {
  console.log('\niconv-lite 不可用:', e.message);
}
