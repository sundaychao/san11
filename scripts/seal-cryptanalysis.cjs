/**
 * 分析seal文件加密: 熵分析 + 已知明文XOR破解尝试
 */
const fs = require('fs');
const seal = fs.readFileSync('C:/san11/xsyg/xsyg6/xsyg6/SIRE v2.10/血色衣冠6.0(SIRE2.10)sp11.seal');
console.log('seal大小:', seal.length);
console.log('头64字节:', seal.subarray(0, 64).toString('hex').match(/../g).join(' '));
console.log('头64字节(ascii):', seal.subarray(0, 64).toString('latin1').replace(/[^\x20-\x7e]/g, '.'));

// 熵分析
function entropy(buf) {
  const freq = new Array(256).fill(0);
  for (const b of buf) freq[b]++;
  let e = 0;
  for (const f of freq) if (f) { const p = f / buf.length; e -= p * Math.log2(p); }
  return e;
}
console.log('\n整体熵:', entropy(seal).toFixed(3), 'bits/byte');
// 分段熵
for (let off = 0; off < seal.length; off += 300000) {
  const chunk = seal.subarray(off, Math.min(off + 300000, seal.length));
  console.log(`  偏移${off}: 熵 ${entropy(chunk).toFixed(3)}`);
}

// 字节值分布
const freq = new Array(256).fill(0);
for (const b of seal) freq[b]++;
const top = freq.map((f, i) => [i, f]).sort((a, b) => b[1] - a[1]).slice(0, 10);
console.log('字节值top10:', top.map(([i, f]) => `${i}(0x${i.toString(16)})×${f}`).join(' '));

// 尝试: XOR单字节密钥后搜索 UTF-16 "沼泽"/"雪山"/"草地"
const targets = ['沼泽', '雪山', '沙洲', '草地', '雷池', '浅滩'];
for (const t of targets) {
  const plain = Buffer.from(t, 'utf16le');
  for (let key = 1; key < 256; key++) {
    // seal[i] ^ key == plain[i] → key = seal[i] ^ plain[i] 必须一致
    // 找所有位置 where first 2 bytes XOR to same key
    const k0 = seal[0] ^ plain[0]; // 不对,要滑动
  }
}
// 更直接: 对每个目标串, 对每个起始位置计算候选key并验证
function xorSearch(plain) {
  const hits = [];
  for (let pos = 0; pos + plain.length <= seal.length; pos++) {
    const key = seal[pos] ^ plain[0];
    let ok = true;
    for (let i = 1; i < plain.length; i++) {
      if ((seal[pos + i] ^ key) !== plain[i]) { ok = false; break; }
    }
    if (ok) hits.push({ pos, key });
  }
  return hits;
}
for (const t of targets) {
  const hits = xorSearch(Buffer.from(t, 'utf16le'));
  if (hits.length) console.log(`单字节XOR命中 ${t}:`, hits.slice(0, 3).map(h => `pos=0x${h.pos.toString(16)} key=0x${h.key.toString(16)}`).join(' '));
  else console.log(`${t}: 无单字节XOR命中`);
}

// 滚动XOR (key[i] = key[i-1] ^ const)? 太复杂。先看是否其实没加密——搜索GBK编码
for (const t of ['沼泽', '草地']) {
  // GBK编码手工: 沼=0xD5D3 泽=0xD4F3; 草=0xB2DD 地=0xB5D8
  const gbkMap = { '沼': [0xd5, 0xd3], '泽': [0xd4, 0xf3], '草': [0xb2, 0xdd], '地': [0xb5, 0xd8], '雪': [0xd1, 0xa9], '山': [0xc9, 0xbd] };
  const bytes = [];
  for (const ch of t) bytes.push(...gbkMap[ch]);
  const idx = seal.indexOf(Buffer.from(bytes));
  console.log(`${t} GBK直搜: ${idx >= 0 ? '0x' + idx.toString(16) : '未找到'}`);
}
