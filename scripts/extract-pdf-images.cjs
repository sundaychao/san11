/**
 * 从游戏手册PDF提取内嵌JPEG图片
 */
const fs = require('fs');
const pdf = fs.readFileSync('C:/san11/xsyg/xsyg6/xsyg6/血色衣冠6.0sp11游戏手册.pdf');
console.log('PDF大小:', pdf.length);

// 搜索 JPEG (FFD8FF ... FFD9)
const imgs = [];
let pos = 0;
while ((pos = pdf.indexOf(Buffer.from([0xff, 0xd8, 0xff]), pos)) !== -1) {
  const end = pdf.indexOf(Buffer.from([0xff, 0xd9]), pos + 3);
  if (end === -1) break;
  const size = end - pos + 2;
  if (size > 20000) imgs.push({ pos, size });
  pos = end + 2;
}
console.log('JPEG流数量(>20KB):', imgs.length);
// 按大小排序取最大的几张
imgs.sort((a, b) => b.size - a.size);
for (const [i, img] of imgs.slice(0, 15).entries()) {
  const data = pdf.subarray(img.pos, img.pos + img.size);
  fs.writeFileSync(`tools/xsyg_map/pdf-img-${i}.jpg`, data);
  console.log(`img-${i}: 0x${img.pos.toString(16)} ${img.size}字节 ${(img.size / 1024).toFixed(0)}KB`);
}

// 也搜索 PNG 流 (IHDR)
let ppos = 0;
const pngs = [];
while ((ppos = pdf.indexOf(Buffer.from('IHDR'), ppos)) !== -1) {
  const start = ppos - 8; // PNG签名+长度
  if (start >= 0 && pdf[start] === 0x89 && pdf[start + 1] === 0x50) {
    const end = pdf.indexOf(Buffer.from('IEND'), ppos);
    if (end !== -1) {
      const size = end - start + 8;
      if (size > 20000) pngs.push({ pos: start, size });
    }
  }
  ppos += 4;
}
console.log('PNG流数量(>20KB):', pngs.length);
pngs.sort((a, b) => b.size - a.size);
for (const [i, img] of pngs.slice(0, 10).entries()) {
  const data = pdf.subarray(img.pos, img.pos + img.size);
  fs.writeFileSync(`tools/xsyg_map/pdf-png-${i}.png`, data);
  console.log(`png-${i}: 0x${img.pos.toString(16)} ${img.size}字节`);
}
