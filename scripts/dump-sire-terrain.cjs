/**
 * Dump SIRE exe 中的地形名称表区域 (UTF-16LE)
 */
const fs = require('fs');
const exe = fs.readFileSync('C:/san11/xsyg/xsyg6/xsyg6/SIRE v2.10/San11SIRE.exe');

function dumpRegion(start, end, label) {
  console.log(`== ${label} (0x${start.toString(16)} - 0x${end.toString(16)}) ==`);
  const region = exe.subarray(start, end);
  // 按 UTF-16LE 解码, 遇到不可打印字符断开
  let str = '', offset = start;
  const entries = [];
  for (let i = 0; i + 1 < region.length; i += 2) {
    const code = region.readUInt16LE(i);
    if (code >= 0x20 && code !== 0xffff && code < 0xfff0) {
      if (!str) offset = start + i;
      str += String.fromCharCode(code);
    } else {
      if (str.length >= 2 && /[\u4e00-\u9fff]/.test(str)) entries.push({ offset, str });
      str = '';
    }
  }
  if (str.length >= 2 && /[\u4e00-\u9fff]/.test(str)) entries.push({ offset, str });
  for (const e of entries) console.log(`  0x${e.offset.toString(16)}: ${e.str}`);
}

// 表1: 0x893d17 附近, dump更大范围
dumpRegion(0x893c00, 0x893f00, '地形表1');
dumpRegion(0x8a3e00, 0x8a4200, '地形表2');
