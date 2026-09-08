const fs = require('fs');
const VAN = 'C:/san11/san11_原版/San11/Media/san11pkres.bin';
const pats = {
  '襄平': 'd3adc6bd',
  '洛阳': 'c2e4d1f4',
  '成都': 'b3c9b6bc',
  '会稽': 'bbe1bbfa',
  '蓟': 'bcdd',
};
const fd = fs.openSync(VAN, 'r');
const size = fs.fstatSync(fd).size;
const CHUNK = 64 * 1024 * 1024, OVER = 64;
const hits = {};
for (const k of Object.keys(pats)) hits[k] = [];
const bufs = {};
for (const [k, h] of Object.entries(pats)) bufs[k] = Buffer.from(h, 'hex');
let pos = 0;
let prevTail = Buffer.alloc(0);
while (pos < size) {
  const len = Math.min(CHUNK, size - pos);
  const buf = Buffer.alloc(len);
  fs.readSync(fd, buf, 0, len, pos);
  const win = prevTail.length ? Buffer.concat([prevTail, buf]) : buf;
  const base = pos - prevTail.length;
  for (const [k, pat] of Object.entries(bufs)) {
    let idx = 0;
    while ((idx = win.indexOf(pat, idx)) !== -1) {
      if (hits[k].length < 60) hits[k].push(base + idx);
      idx++;
    }
  }
  prevTail = buf.subarray(Math.max(0, len - OVER));
  pos += len;
}
fs.closeSync(fd);
for (const [k, hs] of Object.entries(hits)) {
  console.log(`${k} (${pats[k]}): ${hs.length} hits -> ${hs.slice(0, 40).map((h) => '0x' + h.toString(16)).join(' ')}`);
}
