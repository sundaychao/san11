/**
 * 血色地图终局分析:
 * 1) 目录 a/b 字段 (两个 SHEX 条目的身份)
 * 2) 血色 vs 原版 逐平面 diff (验证 p2-p10 是否真相同)
 * 3) 血色 p0 全直方图 + 团块统计
 * 4) 血色 p1 都市锚点 (验证领地)
 * 5) 海域交叉: 原版海区 -> 血色 p1/p0
 */
const fs = require('fs');

const MOD = 'C:/san11/xsyg/xsyg6/xsyg6/San11Pk/Media/san11pkres.bin';
const VAN = 'C:/san11/san11_原版/San11/Media/san11pkres.bin';
const BLD_S11 = 'C:/san11/xsyg/xsyg6/xsyg6/San11Pk/Media/scenario/SCEN000.S11';
const N = 40000, HDR = 8, CELL = 11, W = 200, H = 200;

function readBld(buf, off, count) {
  const out = [];
  for (let k = 0; k < count; k++) {
    const o = off + k * 18;
    out.push({ x: buf.readUInt16LE(o), y: buf.readUInt16LE(o + 2) });
  }
  return out;
}
const bldBuf = fs.readFileSync(BLD_S11);
const cities = readBld(bldBuf, 0x3f4f, 42);
const passes = readBld(bldBuf, 0x4243, 10);
const ports = readBld(bldBuf, 0x42f7, 35);
const idxOf = (b) => b.x * H + b.y;

function parseDir(file) {
  const fd = fs.openSync(file, 'r');
  const fsize = fs.fstatSync(fd).size;
  const head = Buffer.alloc(16);
  fs.readSync(fd, head, 0, 16, 0);
  const count = head.readUInt32LE(4);
  const dir = Buffer.alloc(count * 8);
  fs.readSync(fd, dir, 0, count * 8, 16);
  const entries = [];
  for (let i = 0; i < count; i++) {
    entries.push({
      idx: i,
      off: dir.readUInt32LE(i * 8),
      a: dir.readUInt16LE(i * 8 + 4),
      b: dir.readUInt16LE(i * 8 + 6),
      size: (i + 1 < count ? dir.readUInt32LE((i + 1) * 8) : fsize) - dir.readUInt32LE(i * 8),
    });
  }
  fs.closeSync(fd);
  return entries;
}
function magicAt(file, off) {
  const fd = fs.openSync(file, 'r');
  const b = Buffer.alloc(8);
  fs.readSync(fd, b, 0, 8, off);
  fs.closeSync(fd);
  return b.toString('ascii', 0, 8);
}

console.log('== 目录中 SHEX0008 条目的 a/b 字段 ==');
for (const [name, file] of [['原版', VAN], ['血色', MOD]]) {
  const es = parseDir(file);
  for (const e of es) {
    if (magicAt(file, e.off) === 'SHEX0008') {
      console.log(`  ${name}: [${e.idx}] off=0x${e.off.toString(16)} size=${e.size} a=${e.a} b=${e.b}`);
    }
  }
}

function readPlanesAt(fd, off) {
  const buf = Buffer.alloc(HDR + N * CELL);
  fs.readSync(fd, buf, 0, buf.length, off);
  if (buf.toString('ascii', 0, 8) !== 'SHEX0008') return null;
  const planes = [];
  for (let p = 0; p < 11; p++) {
    const a = new Uint8Array(N);
    for (let i = 0; i < N; i++) a[i] = buf[HDR + i * CELL + p];
    planes.push(a);
  }
  return planes;
}
function hist(arr) {
  const f = new Map();
  for (const v of arr) f.set(v, (f.get(v) ?? 0) + 1);
  return [...f.entries()].sort((a, b) => b[1] - a[1]);
}
const fmt = (h, n = 10) => h.slice(0, n).map(([v, c]) => `v${v}×${c}`).join(' ');

const modFd = fs.openSync(MOD, 'r');
const vanFd = fs.openSync(VAN, 'r');
const blood = readPlanesAt(modFd, 0x20a40cb7);
const van = readPlanesAt(vanFd, 0x1f520cb7);
fs.closeSync(modFd); fs.closeSync(vanFd);

console.log('\n== 逐平面 diff (血色@0x20a40cb7 vs 原版@0x1f520cb7) ==');
for (let p = 0; p < 11; p++) {
  let d = 0;
  for (let i = 0; i < N; i++) if (blood[p][i] !== van[p][i]) d++;
  console.log(`  p${p}: 不同=${d} / ${N}  (血色值数=${hist(blood[p]).length}, 原版值数=${hist(van[p]).length})`);
}

console.log('\n== 血色 p0 全直方图 ==');
const h0 = hist(blood[0]);
console.log('  ' + h0.map(([v, c]) => `v${v}:${c}`).join(' '));

console.log('\n== 血色 p0 团块统计 ==');
function blobStats(arr, target) {
  const seen = new Uint8Array(N);
  const sizes = [];
  for (let i = 0; i < N; i++) {
    if (arr[i] !== target || seen[i]) continue;
    const q = [i]; seen[i] = 1;
    let size = 0;
    while (q.length) {
      const c = q.pop(); size++;
      const x = Math.floor(c / H), y = c % H;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || nx >= W || ny < 0 || ny >= H) continue;
        const ni = nx * H + ny;
        if (!seen[ni] && arr[ni] === target) { seen[ni] = 1; q.push(ni); }
      }
    }
    sizes.push(size);
  }
  sizes.sort((a, b) => b - a);
  return sizes;
}
for (const [v] of h0) {
  const s = blobStats(blood[0], v);
  const tot = s.reduce((a, b) => a + b, 0);
  console.log(`  v${v}: 团数=${s.length} 最大=${s.slice(0, 4).join('/')} 总=${tot}`);
}

console.log('\n== 血色 p1: 都市/关/港锚点 ==');
const p1city = hist(cities.map((b) => blood[1][idxOf(b)]));
const p1pass = hist(passes.map((b) => blood[1][idxOf(b)]));
const p1port = hist(ports.map((b) => blood[1][idxOf(b)]));
console.log(`  都市锚 distinct=${p1city.length}: ${fmt(p1city, 8)}`);
console.log(`  关锚 distinct=${p1pass.length}: ${fmt(p1pass, 12)}`);
console.log(`  港锚 distinct=${p1port.length}: ${fmt(p1port, 12)}`);

console.log('\n== 原版海域 (原p0=v8 的格) 的 p1 分布 & 血色对应 ==');
const vanSeaCells = [];
for (let i = 0; i < N; i++) if (van[0][i] === 8) vanSeaCells.push(i);
const vanSeaP1 = hist(vanSeaCells.map((i) => van[1][i]));
console.log(`  原版海域原p1: ${fmt(vanSeaP1, 5)}`);
const bloodSeaP1 = hist(vanSeaCells.map((i) => blood[1][i]));
console.log(`  同格血p1:    ${fmt(bloodSeaP1, 5)}`);
const bloodSeaP0 = hist(vanSeaCells.map((i) => blood[0][i]));
console.log(`  同格血p0:    ${fmt(bloodSeaP0, 8)}`);

console.log('\n== 血色最东侧海区 (x>=165, 血p0=v11) 的 p0/p1 采样 ==');
const eastCells = [];
for (let i = 0; i < N; i++) {
  const x = Math.floor(i / H);
  if (x >= 165 && blood[0][i] === 11) eastCells.push(i);
}
console.log(`  x>=165 且 血p0=v11: ${eastCells.length} 格, 血p1: ${fmt(hist(eastCells.map((i) => blood[1][i])), 4)}`);
