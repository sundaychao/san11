/**
 * 精确解析 SIRE exe 地形表: null结尾UTF-16LE字符串序列
 */
const fs = require('fs');
const exe = fs.readFileSync('C:/san11/xsyg/xsyg6/xsyg6/SIRE v2.10/San11SIRE.exe');

function parseStrings(start, end) {
  const list = [];
  let i = start;
  let cur = '', curStart = 0;
  while (i + 1 < end) {
    const code = exe.readUInt16LE(i);
    if (code === 0) {
      if (cur) { list.push({ offset: curStart, str: cur }); cur = ''; }
      i += 2;
      continue;
    }
    if (!cur) curStart = i;
    cur += String.fromCharCode(code);
    i += 2;
  }
  return list;
}

// 表1起点: 草地@0x893d17. 往前找表的真正起点, 往后解析全部
// 先看 0x893d17 前后 64 字节的hex
console.log('== 0x893cf0 - 0x893d20 hex ==');
for (let off = 0x893cf0; off < 0x893d20; off += 16) {
  const hex = exe.subarray(off, off + 16).toString('hex').match(/../g).join(' ');
  console.log(`  0x${off.toString(16)}: ${hex}`);
}

// 解析 0x893d00 到 0x893de0 的字符串
const strings = parseStrings(0x893cf0, 0x893de0);
console.log('\n== 字符串序列 ==');
for (const s of strings) console.log(`  0x${s.offset.toString(16)}: "${s.str}" (len=${s.str.length})`);
