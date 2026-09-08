/**
 * 暴力测试简单密码变换: 位排列/位旋转/线性位置密钥
 * blood[i] = perm(van[i]) ^ mask, 或位置密钥 XOR
 */
const fs = require('fs');

const N = 200 * 200;
const CELL = 11;
const HEADER = 8;

function readMap(file, offset) {
  const fd = fs.openSync(file, 'r');
  const buf = Buffer.alloc(HEADER + N * CELL);
  fs.readSync(fd, buf, 0, buf.length, offset);
  fs.closeSync(fd);
  const types = new Uint8Array(N);
  for (let i = 0; i < N; i++) types[i] = buf[HEADER + i * CELL];
  return types;
}

const blood = readMap('C:/san11/xsyg/xsyg6/xsyg6/San11Pk/Media/san11pkres.bin', 0x20a40cb7);
const van = readMap('C:/san11/san11_原版/San11/Media/san11pkres.bin', 0x1f520cb7);

// 采样索引
const sample = [];
for (let i = 0; i < N; i += 97) sample.push(i);

// --- 1. 5bit位排列 × XOR掩码 ---
function perms5() {
  const res = [];
  const bits = [0, 1, 2, 3, 4];
  const permute = (arr) => {
    if (arr.length <= 1) return [arr];
    const out = [];
    for (let i = 0; i < arr.length; i++) {
      const rest = [...arr.slice(0, i), ...arr.slice(i + 1)];
      for (const p of permute(rest)) out.push([arr[i], ...p]);
    }
    return out;
  };
  for (const p of permute(bits)) {
    // p[k] = 输出bit k 取自输入的哪一位
    const table = new Uint8Array(32);
    for (let v = 0; v < 32; v++) {
      let o = 0;
      for (let k = 0; k < 5; k++) o |= ((v >> p[k]) & 1) << k;
      table[v] = o;
    }
    res.push(table);
  }
  return res;
}

const tables = perms5();
console.log('== 测试 位排列×XOR掩码 ==');
let found = 0;
for (const table of tables) {
  for (let mask = 0; mask < 32; mask++) {
    let ok = true;
    for (const i of sample) {
      if ((table[van[i]] ^ mask) !== blood[i]) { ok = false; break; }
    }
    if (ok) {
      found++;
      let full = 0;
      for (let i = 0; i < N; i++) if ((table[van[i]] ^ mask) === blood[i]) full++;
      console.log(`  命中! 排列+掩码${mask}: 全图一致率 ${(full / N * 100).toFixed(1)}%`);
    }
  }
}
if (!found) console.log('  无命中');

// --- 2. 线性位置密钥: blood = van ^ ((a*x + b*y + c) & 31) ---
console.log('== 测试线性位置密钥 (a*x+b*y+c)&31 ==');
let found2 = 0;
for (let a = 0; a < 32; a++) for (let b = 0; b < 32; b++) for (let c = 0; c < 32; c++) {
  let ok = true;
  for (const i of sample) {
    const x = Math.floor(i / 200), y = i % 200;
    if ((van[i] ^ ((a * x + b * y + c) & 31)) !== blood[i]) { ok = false; break; }
  }
  if (ok) {
    found2++;
    let full = 0;
    for (let i = 0; i < N; i++) {
      const x = Math.floor(i / 200), y = i % 200;
      if ((van[i] ^ ((a * x + b * y + c) & 31)) === blood[i]) full++;
    }
    console.log(`  命中! a=${a} b=${b} c=${c}: 全图一致率 ${(full / N * 100).toFixed(1)}%`);
  }
}
if (!found2) console.log('  无命中');

// --- 3. 线性位置密钥 (mod 256, 非限制31) ---
console.log('== 测试 (a*x+b*y+c)&255 ==');
let found3 = 0;
for (let a = 0; a < 256; a += 1) for (let b = 0; b < 256; b += 1) {
  // c 由第一个样本推出
  const i0 = sample[0];
  const x0 = Math.floor(i0 / 200), y0 = i0 % 200;
  const c = (blood[i0] ^ van[i0]) - a * x0 - b * y0;
  let ok = true;
  for (let k = 1; k < sample.length; k++) {
    const i = sample[k], x = Math.floor(i / 200), y = i % 200;
    if ((van[i] ^ ((a * x + b * y + c) & 255)) !== blood[i]) { ok = false; break; }
  }
  if (ok) {
    found3++;
    let full = 0;
    for (let i = 0; i < N; i++) {
      const x = Math.floor(i / 200), y = i % 200;
      if ((van[i] ^ ((a * x + b * y + c) & 255)) === blood[i]) full++;
    }
    console.log(`  命中! a=${a} b=${b} c=${c}: 全图一致率 ${(full / N * 100).toFixed(1)}%`);
  }
}
if (!found3) console.log('  无命中');

// --- 4. XOR 与同格其他字节 ---
console.log('== 测试 blood = van ^ blood其他字节 / van其他字节 ==');
const bbuf = Buffer.alloc(HEADER + N * CELL), vbuf = Buffer.alloc(HEADER + N * CELL);
{
  const fd1 = fs.openSync('C:/san11/xsyg/xsyg6/xsyg6/San11Pk/Media/san11pkres.bin', 'r');
  fs.readSync(fd1, bbuf, 0, bbuf.length, 0x20a40cb7);
  fs.closeSync(fd1);
  const fd2 = fs.openSync('C:/san11/san11_原版/San11/Media/san11pkres.bin', 'r');
  fs.readSync(fd2, vbuf, 0, vbuf.length, 0x1f520cb7);
  fs.closeSync(fd2);
}
for (let p = 1; p < CELL; p++) {
  let m1 = 0, m2 = 0;
  for (let i = 0; i < N; i++) {
    if ((van[i] ^ bbuf[HEADER + i * CELL + p]) === blood[i]) m1++;
    if ((van[i] ^ vbuf[HEADER + i * CELL + p]) === blood[i]) m2++;
  }
  if (m1 / N > 0.1 || m2 / N > 0.1) console.log(`  字节${p}: ^blood自身=${(m1 / N * 100).toFixed(1)}% ^van=${(m2 / N * 100).toFixed(1)}%`);
}
console.log('  (未列出=均<10%)');
