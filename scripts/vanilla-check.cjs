const fs = require('fs');
const VAN = 'C:/san11/san11_原版/San11/Media/san11pkres.bin';
const W = 200, H = 200, N = 40000, P = 11, OFF = 0x1f520cb7;
const buf = fs.readFileSync(VAN);
const p0 = new Uint8Array(N);
for (let i = 0; i < N; i++) p0[i] = buf[OFF + 8 + i * P + 0];
const at = (x, y) => p0[x * H + y];
console.log('row y=100, x=190..199:', [...Array(10)].map((_, k) => at(190 + k, 100)).join(','));
console.log('row y=0,   x=90..100:', [...Array(11)].map((_, k) => at(90 + k, 0)).join(','));
console.log('v8 blob cells sample (first 10 with v8):');
let cnt = 0;
for (let i = 0; i < N && cnt < 10; i++) if (p0[i] === 8) { const x = Math.floor(i / H), y = i % H; console.log(`  i=${i} x=${x} y=${y}`); cnt++; }
console.log('column-major alternative x=y?  v8 at (x=50,y=170):', at(50, 170), ' (x=170,y=50):', at(170, 50));
