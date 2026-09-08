/**
 * 找出血色 pkres 中真正的地形图条目
 * 候选: 全文件扫描 SHEX0008 魔数 + 两个已知偏移
 * 鉴定签名 (按平面):
 *   - 都市锚点一致: 42都市落同一值  => 都市地面/地形类平面
 *   - 都市锚点全异: 42都市落42个值  => 领地ID平面 (原版p1特征)
 *   - 港/关锚点一致性
 */
const fs = require('fs');

const MOD = 'C:/san11/xsyg/xsyg6/xsyg6/San11Pk/Media/san11pkres.bin';
const VAN = 'C:/san11/san11_原版/San11/Media/san11pkres.bin';
const BLD_S11 = 'C:/san11/xsyg/xsyg6/xsyg6/San11Pk/Media/scenario/SCEN000.S11';
const VAN_S11 = 'C:/san11/san11_原版/San11/Media/scenario/Scen000.s11';
const N = 40000, HDR = 8, CELL = 11, W = 200, H = 200, P = 11;

function readBld(buf, off, count) {
  const out = [];
  for (let k = 0; k < count; k++) {
    const o = off + k * 18;
    out.push({ x: buf.readUInt16LE(o), y: buf.readUInt16LE(o + 2) });
  }
  return out;
}
const bldBuf = fs.readFileSync(BLD_S11);
const vanBuf = fs.readFileSync(VAN_S11);
const bldCities = readBld(bldBuf, 0x3f4f, 42);
const vanCities = readBld(vanBuf, 0x3f4f, 42);
const bldPorts = readBld(bldBuf, 0x42f7, 35);
const bldPasses = readBld(bldBuf, 0x4243, 10);
const idxOf = (b) => b.x * H + b.y;

function readPlanesAt(fd, off) {
  const buf = Buffer.alloc(HDR + N * CELL);
  fs.readSync(fd, buf, 0, buf.length, off);
  if (buf.toString('ascii', 0, 8) !== 'SHEX0008') return null;
  const planes = [];
  for (let p = 0; p < P; p++) {
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

// 对一个地图的各平面做锚点签名鉴定
function diagnose(tag, planes, cities) {
  console.log(`\n===== ${tag} =====`);
  for (let p = 0; p < P; p++) {
    const arr = planes[p];
    const atCity = cities.map((b) => arr[idxOf(b)]);
    const hh = hist(atCity);
    const distinct = hh.length;
    const top = hh[0];
    const mark = top[1] === 42 ? ' <== 都市一致(地面/地形类)' : distinct === 42 ? ' <== 都市全异(领地类)' : '';
    if (p === 0 || mark || distinct <= 87) {
      const totalVals = hist(arr).length;
      const tops = hh.slice(0, 3).map(([v, c]) => `v${v}×${c}`).join(' ');
      console.log(`  p${p}: 全图${totalVals}值 | 都市锚 distinct=${distinct} top ${tops}${mark}`);
    }
  }
  // p0 港/关锚点
  const p0 = planes[0];
  const hp = hist(p0);
  const portAt = hist(bldPorts.map((b) => p0[idxOf(b)]));
  const passAt = hist(bldPasses.map((b) => p0[idxOf(b)]));
  console.log(`  p0港锚: ${portAt.slice(0, 3).map(([v, c]) => `v${v}×${c}`).join(' ')} | p0关锚: ${passAt.slice(0, 3).map(([v, c]) => `v${v}×${c}`).join(' ')}`);
  // 团块签名: 找 "42团/35个单格团/10团" 的值
  function blobStats(target) {
    const seen = new Uint8Array(N);
    const sizes = [];
    for (let i = 0; i < N; i++) {
      if (p0[i] !== target || seen[i]) continue;
      const q = [i]; seen[i] = 1;
      let size = 0;
      while (q.length) {
        const c = q.pop(); size++;
        const x = Math.floor(c / H), y = c % H;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || nx >= W || ny < 0 || ny >= H) continue;
          const ni = nx * H + ny;
          if (!seen[ni] && p0[ni] === target) { seen[ni] = 1; q.push(ni); }
        }
      }
      sizes.push(size);
    }
    return sizes;
  }
  const sigs = [];
  for (const [v] of hp) {
    const sizes = blobStats(v);
    const singles = sizes.filter((s) => s === 1).length;
    const small = sizes.filter((s) => s >= 2 && s <= 9).length;
    if (singles >= 30 || small >= 38 || (sizes.length >= 10 && sizes.length <= 45 && sizes.every((s) => s <= 9))) {
      sigs.push(`v${v}(团${sizes.length},单格${singles},小团${small})`);
    }
  }
  console.log(`  p0城/港/关式签名: ${sigs.length ? sigs.join(' ') : '(无)'}`);
}

// 1) 全文件扫描 SHEX0008
function scanMagics(file) {
  const fd = fs.openSync(file, 'r');
  const fsize = fs.fstatSync(fd).size;
  const CH = 8 * 1024 * 1024, OV = 7;
  const hits = [];
  const buf = Buffer.alloc(CH);
  let base = 0;
  while (base < fsize) {
    const n = fs.readSync(fd, buf, 0, CH, base);
    if (n <= 0) break;
    for (let i = 0; i + 8 <= n; i++) {
      if (buf[i] === 0x53 && buf.toString('ascii', i, i + 8) === 'SHEX0008') hits.push(base + i);
    }
    base += CH - OV;
  }
  fs.closeSync(fd);
  return hits;
}

console.log('扫描血色 pkres SHEX0008 ...');
const modHits = scanMagics(MOD);
console.log(`血色 SHEX0008 命中: ${modHits.map((o) => '0x' + o.toString(16)).join(', ') || '(无)'}`);
const vanHits = scanMagics(VAN);
console.log(`原版 SHEX0008 命中: ${vanHits.map((o) => '0x' + o.toString(16)).join(', ') || '(无)'}`);

const modFd = fs.openSync(MOD, 'r');
const vanFd = fs.openSync(VAN, 'r');

for (const off of vanHits) {
  const pl = readPlanesAt(vanFd, off);
  if (pl) diagnose(`原版 @0x${off.toString(16)}`, pl, vanCities);
}
for (const off of modHits) {
  const pl = readPlanesAt(modFd, off);
  if (pl) diagnose(`血色 @0x${off.toString(16)}`, pl, bldCities);
}
// 已知两个候选 (即使魔数没扫到也试读)
for (const off of [0x26800119, 0x20a40cb7]) {
  if (modHits.includes(off)) continue;
  const pl = readPlanesAt(modFd, off);
  if (pl) diagnose(`血色(已知候选) @0x${off.toString(16)}`, pl, bldCities);
  else console.log(`血色 @0x${off.toString(16)}: 无 SHEX0008 头`);
}
fs.closeSync(modFd);
fs.closeSync(vanFd);
