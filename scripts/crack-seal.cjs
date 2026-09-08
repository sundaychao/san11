/** 破解 SIRE .seal XOR 加密：利用零填充区频率分析求密钥 */
const fs = require('fs');

const f = 'C:/san11/xsyg/xsyg6/xsyg6/SIRE v2.10/血色衣冠6.0(SIRE2.10)sp11.seal';
const b = fs.readFileSync(f);
console.log('文件大小:', b.length);

// 头部 "#SIRE2.0 Encrypt++# \n" 长度确认
const head = b.subarray(0, 24).toString('latin1');
console.log('头部:', JSON.stringify(head));
const HDR = b.indexOf(0x0a) + 1; // 第一个换行后
console.log('数据起始:', HDR, '=', '0x' + HDR.toString(16));

const data = b.subarray(HDR);
console.log('数据长度:', data.length);

// 尝试密钥长度 1..32：每个位置 i%k 统计最常见字节
for (let k = 1; k <= 32; k++) {
  const freq = Array.from({ length: k }, () => ({}));
  for (let i = 0; i < data.length; i++) {
    const v = data[i];
    freq[i % k][v] = (freq[i % k][v] ?? 0) + 1;
  }
  // 最常见字节占比之和（若密钥正确，0填充主导 → 每列最常见字节=密钥字节，占比高）
  let score = 0;
  const key = [];
  for (let j = 0; j < k; j++) {
    const top = Object.entries(freq[j]).sort((a, b) => b[1] - a[1])[0];
    score += top[1] / data.length;
    key.push(Number(top[0]));
  }
  if (score / k > 0.12) {
    console.log(`k=${String(k).padStart(2)} 平均占比=${(score / k * 100).toFixed(1)}% key=[${key.map((x) => x.toString(16).padStart(2, '0')).join(' ')}]`);
  }
}

// 密钥长度候选下的解密预览
function preview(k, keyBytes) {
  const out = Buffer.alloc(160);
  for (let i = 0; i < 160 && i < data.length; i++) out[i] = data[i] ^ keyBytes[i % k];
  console.log(`  k=${k} 解密预览:`, JSON.stringify(out.subarray(0, 120).toString('latin1')));
}
// 先看 k=1 (0xce)
preview(1, [0xce]);
