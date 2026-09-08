/** 在 pkres 中搜索包含两个地图条目偏移的目录表（LINK表） */
const fs = require('fs');

function searchOffsets(file, targets) {
  const fd = fs.openSync(file, 'r');
  const size = fs.fstatSync(fd).size;
  const CHUNK = 1 << 24;
  const buf = Buffer.alloc(CHUNK);
  let pos = 0;
  const hits = [];
  while (true) {
    const n = fs.readSync(fd, buf, 0, CHUNK, pos);
    if (n === 0) break;
    for (const target of targets) {
      // 搜索 4 字节小端
      const pat = Buffer.alloc(4);
      pat.writeUInt32LE(target);
      let idx = 0;
      while ((idx = buf.subarray(0, n).indexOf(pat, idx)) !== -1) {
        hits.push({ target, filePos: pos + idx, endian: 'LE32' });
        idx++;
      }
    }
    pos += n - 8; // 回退8字节避免跨块
    if (pos >= size) break;
  }
  fs.closeSync(fd);
  return hits;
}

const mod = 'C:/san11/xsyg/xsyg6/xsyg6/San11Pk/Media/san11pkres.bin';
const hits = searchOffsets(mod, [0x20a40cb7, 0x26800119]);
console.log('MOD pkres 中包含地图偏移的位置:');
for (const h of hits) console.log(`  0x${h.target.toString(16)} @文件0x${h.filePos.toString(16)} (${h.filePos}) ${h.endian}`);

// 打印第一个命中位置前后的 hex 上下文，分析表结构
if (hits.length > 0) {
  const fd = fs.openSync(mod, 'r');
  const ctx = Buffer.alloc(128);
  const first = hits[0].filePos;
  fs.readSync(fd, ctx, 0, 128, Math.max(0, first - 64));
  fs.closeSync(fd);
  console.log('首个命中上下文(hex):');
  for (let i = 0; i < 128; i += 16) {
    console.log('  +' + (i - 64) + ':', ctx.subarray(i, i + 16).toString('hex').match(/../g).join(' '));
  }
}
