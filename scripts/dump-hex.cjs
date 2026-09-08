/**
 * 原始hex + UTF-16解码对照
 */
const fs = require('fs');
const exe = fs.readFileSync('C:/san11/xsyg/xsyg6/xsyg6/SIRE v2.10/San11SIRE.exe');

const START = 0x893d10, END = 0x893dd0;
for (let off = START; off < END; off += 16) {
  const bytes = exe.subarray(off, off + 16);
  const hex = bytes.toString('hex').match(/../g).join(' ');
  // UTF-16LE 解码(按2字节对齐到偶数偏移)
  let txt = '';
  for (let i = (off % 2); i + 1 < bytes.length; i += 2) {
    const code = bytes.readUInt16LE(i);
    txt += (code >= 0x20 && code < 0xFFF0) ? String.fromCharCode(code) : '·';
  }
  console.log(`0x${off.toString(16)}: ${hex}  |${txt}|`);
}
