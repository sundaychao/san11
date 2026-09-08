/** 直接解析 SCEN000.S11 的原始城市坐标，与导出的 Scenario1.json 对比 */
const fs = require('fs');

const s11 = fs.readFileSync('C:/san11/xsyg/xsyg6/xsyg6/San11Pk/Media/scenario/SCEN000.S11');
console.log('S11 大小:', s11.length);

// 导出的场景数据
const scen = JSON.parse(fs.readFileSync('tools/xsyg_map/Scenario1.json', 'utf8'));
const all = Object.values(scen.citySet);
console.log('导出建筑数:', all.length);

// 城市名以 GBK 编码搜索
const gbk = (s) => Buffer.from(s, 'latin1'); // 占位，下面用 iconv 不行就用逐字查表
// Node 无内置 GBK，改用简单的常用字 GBK 码表（本项目城市用字有限）
// 直接从 s11fname.dat 或用已知城市名逐个找太麻烦 —— 换个思路：
// 在 s11 中搜索导出坐标值对 (x,y) 作为 LE16/LE32，看是否有规律排列
console.log('\n== 在 S11 中搜索导出坐标对 (LE32) ==');
const found = {};
for (const c of all.slice(0, 12)) {
  for (const w of [2, 4]) {
    const pat = Buffer.alloc(w * 2);
    if (w === 2) { pat.writeUInt16LE(c.x, 0); pat.writeUInt16LE(c.y, 2); }
    else { pat.writeUInt32LE(c.x, 0); pat.writeUInt32LE(c.y, 4); }
    const hits = [];
    let idx = 0;
    while ((idx = s11.indexOf(pat, idx)) !== -1) { hits.push(idx); idx++; }
    if (hits.length > 0 && hits.length < 10) {
      console.log(`  ${c.Name} (${c.x},${c.y}) w=${w}: 偏移 ${hits.map((h) => '0x' + h.toString(16)).join(', ')}`);
      found[c.Name] = hits;
    }
  }
}

// 检查 s11 中是否有 UTF-16LE 编码的城市名
console.log('\n== UTF-16LE 城市名搜索 ==');
for (const name of ['襄平', '洛阳', '成都', '金陵']) {
  const pat = Buffer.from(name, 'utf16le');
  const idx = s11.indexOf(pat);
  console.log(`  ${name}: ${idx >= 0 ? '找到@0x' + idx.toString(16) : '未找到'}`);
}

// 前 256 字节概览
console.log('\nS11 前128字节:', s11.subarray(0, 128).toString('hex').match(/../g).join(' '));
