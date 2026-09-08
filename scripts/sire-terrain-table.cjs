/**
 * 精确提取 San11SIRE.exe 中的地形名称表（UTF-16LE）。
 * 已知 草地@0x893d17 附近。先 hexdump 原始字节，再按 2 字节步长解码 CJK 串。
 */
const fs = require('fs');

const EXE = 'C:/san11/xsyg/xsyg6/xsyg6/SIRE v2.10/San11SIRE.exe';
const exe = fs.readFileSync(EXE);
console.log('exe size:', exe.length, '= 0x' + exe.length.toString(16));

function isCJK(code) {
  return (code >= 0x3000 && code <= 0x30ff) || (code >= 0x4e00 && code <= 0x9fff) || (code >= 0xff00 && code <= 0xffef);
}

// 1) 原始 hexdump
function hexdump(start, end) {
  for (let off = start; off < end; off += 16) {
    const seg = exe.subarray(off, off + 16);
    const hex = [...seg].map((b) => b.toString(16).padStart(2, '0')).join(' ');
    let ascii = '';
    for (let i = 0; i + 1 < seg.length + 1; i += 2) {
      const code = exe.readUInt16LE(off + i);
      ascii += isCJK(code) ? String.fromCharCode(code) : '.';
    }
    console.log(`  0x${off.toString(16).padStart(6, '0')}: ${hex}   ${ascii}`);
  }
}

console.log('\n== HEXDUMP 0x893d00 - 0x893dc0 ==');
hexdump(0x893d00, 0x893dc0);

// 2) 以 0x893d17 为起点，逐 2 字节把 CJK 连成串，非CJK(00)为分隔
console.log('\n== 顺序解码 (起点 0x893d16) ==');
const start = 0x893d16;
const end = 0x893dc0;
let cur = '';
let curOff = 0;
const list = [];
for (let i = start; i + 1 < end; i += 2) {
  const code = exe.readUInt16LE(i);
  if (isCJK(code)) {
    if (!cur) curOff = i;
    cur += String.fromCharCode(code);
  } else {
    if (cur.length >= 1) list.push({ off: curOff, str: cur });
    cur = '';
  }
}
if (cur) list.push({ off: curOff, str: cur });
list.forEach((e, idx) => console.log(`  [${idx}] 0x${e.off.toString(16)}: "${e.str}"`));
