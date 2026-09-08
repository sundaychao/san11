/**
 * 锚点一致性交叉检验:
 *   map ∈ {血色[4791], 血色[4863], 原版}
 *   coords ∈ {血色SCEN000, 原版Scen000}
 *   plane p0..p10
 * 对每个组合: 42 都市锚点处该平面的 distinct 数与 top 值占比。
 * 目标: 找到 (map,coords,plane) 使得城市处高度凝聚 (原版 p0 是 v16×39/42)。
 */
const fs = require('fs');

const MOD = 'C:/san11/xsyg/xsyg6/xsyg6/San11Pk/Media/san11pkres.bin';
const VAN = 'C:/san11/san11_原版/San11/Media/san11pkres.bin';
const BLD_S11 = 'C:/san11/xsyg/xsyg6/xsyg6/San11Pk/Media/scenario/SCEN000.S11';
const VAN_S11 = 'C:/san11/san11_原版/San11/Media/scenario/Scen000.s11';
const N = 40000, HDR = 8, CELL = 11, W = 200, H = 200;

function readBld(buf, off, count) {
  const out = [];
  for (let k = 0; k < count; k++) {
    const o = off + k * 18;
    out.push({ x: buf.readUInt16LE(o), y: buf.readUInt16LE(o + 2) });
  }
  return out;
}
function readAt(file, off, len) {
  const fd = fs.openSync(file, 'r');
  const b = Buffer.alloc(len);
  fs.readSync(fd, b, 0, len, off);
  fs.closeSync(fd);
  return b;
}
function readPlanes(file, off) {
  const buf = readAt(file, off, HDR + N * CELL);
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

const bloodB = fs.readFileSync(BLD_S11);
const vanB = fs.readFileSync(VAN_S11);
const coordSets = {
  '血色坐标': { cities: readBld(bloodB, 0x3f4f, 42), passes: readBld(bloodB, 0x4243, 10), ports: readBld(bloodB, 0x42f7, 35) },
  '原版坐标': { cities: readBld(vanB, 0x3f4f, 42), passes: readBld(vanB, 0x4243, 10), ports: readBld(vanB, 0x42f7, 35) },
};
const maps = {
  '血色[4791]': readPlanes(MOD, 0x20a40cb7),
  '血色[4863]': readPlanes(MOD, 0x26800119),
  '原版': readPlanes(VAN, 0x1f520cb7),
};
const idxOf = (b) => b.x * H + b.y;

for (const [mn, planes] of Object.entries(maps)) {
  console.log(`\n########## map=${mn} ##########`);
  for (const [cn, cs] of Object.entries(coordSets)) {
    const line = [];
    for (let p = 0; p < 11; p++) {
      const hc = hist(cs.cities.map((b) => planes[p][idxOf(b)]));
      const hp = hist(cs.passes.map((b) => planes[p][idxOf(b)]));
      const hpo = hist(cs.ports.map((b) => planes[p][idxOf(b)]));
      const cTop = hc[0];
      const pTop = hp[0];
      const poTop = hpo[0];
      line.push(`p${p}:城${cTop[1]}/${cs.cities.length}(v${cTop[0]}) 关${pTop[1]}/${cs.passes.length}(v${pTop[0]}) 港${poTop[1]}/${cs.ports.length}(v${poTop[0]})`);
    }
    console.log(`  -- coords=${cn} --`);
    for (const l of line) console.log('    ' + l);
  }
}
