/**
 * 厘清两份 SHEX0008 的角色。
 * 原版与血色各有 2 个 SHEX0008 blob。对每个 blob:
 *   - p0 distinct 数、top 值
 *   - 城市锚点 p0 最凝聚值 (原版地形 blob 应 ~39/42 v16)
 *   - 港锚 p0 (地形 blob 应 v17)
 * 判定: 哪个 blob 是"渲染地形", 哪个是"其它数据"。
 */
const fs = require('fs');
const MOD = 'C:/san11/xsyg/xsyg6/xsyg6/San11Pk/Media/san11pkres.bin';
const VAN = 'C:/san11/san11_原版/San11/Media/san11pkres.bin';
const BLD_S11 = 'C:/san11/xsyg/xsyg6/xsyg6/San11Pk/Media/scenario/SCEN000.S11';
const VAN_S11 = 'C:/san11/san11_原版/San11/Media/scenario/Scen000.s11';
const N = 40000, HDR = 8, CELL = 11, W = 200, H = 200;
function readAt(file, off, len) { const fd = fs.openSync(file, 'r'); const b = Buffer.alloc(len); fs.readSync(fd, b, 0, len, off); fs.closeSync(fd); return b; }
function readBld(buf, off, count) { const o = []; for (let k = 0; k < count; k++) { const q = off + k * 18; o.push({ x: buf.readUInt16LE(q), y: buf.readUInt16LE(q + 2) }); } return o; }
function parseDir(file) {
  const fd = fs.openSync(file, 'r'); const fsize = fs.fstatSync(fd).size;
  const head = Buffer.alloc(16); fs.readSync(fd, head, 0, 16, 0); const count = head.readUInt32LE(4);
  const dir = Buffer.alloc(count * 8); fs.readSync(fd, dir, 0, count * 8, 16); const es = [];
  for (let i = 0; i < count; i++) { const off = dir.readUInt32LE(i * 8); es.push({ idx: i, off, a: dir.readUInt16LE(i * 8 + 4), b: dir.readUInt16LE(i * 8 + 6) }); }
  fs.closeSync(fd); return es;
}
function hist(arr) { const f = new Map(); for (const v of arr) f.set(v, (f.get(v) ?? 0) + 1); return [...f.entries()].sort((x, y) => y[1] - x[1]); }
function readPlanes(file, off) { const buf = readAt(file, off, HDR + N * CELL); const ps = []; for (let p = 0; p < 11; p++) { const a = new Uint8Array(N); for (let i = 0; i < N; i++) a[i] = buf[HDR + i * CELL + p]; ps.push(a); } return ps; }
const idxOf = (b) => b.x * H + b.y;

const bloodB = fs.readFileSync(BLD_S11), vanB = fs.readFileSync(VAN_S11);
const bc = readBld(bloodB, 0x3f4f, 42), bpo = readBld(bloodB, 0x42f7, 35);
const vc = readBld(vanB, 0x3f4f, 42), vpo = readBld(vanB, 0x42f7, 35);

for (const [name, file] of [['原版', VAN], ['血色', MOD]]) {
  console.log(`\n########## ${name} pkres 的 SHEX0008 blob ##########`);
  const es = parseDir(file);
  for (const e of es) {
    const m = readAt(file, e.off, 8).toString('ascii', 0, 8);
    if (m !== 'SHEX0008') continue;
    const pl = readPlanes(file, e.off);
    const h0 = hist(pl[0]);
    // 用两套坐标分别测城市锚点
    const cB = hist(bc.map((b) => pl[0][idxOf(b)]))[0];
    const cV = hist(vc.map((b) => pl[0][idxOf(b)]))[0];
    const pB = hist(bpo.map((b) => pl[0][idxOf(b)]))[0];
    const pV = hist(vpo.map((b) => pl[0][idxOf(b)]))[0];
    console.log(`  [${e.idx}] 0x${e.off.toString(16)} a=${e.a} b=${e.b}`);
    console.log(`     p0 distinct=${h0.length} top=${h0.slice(0, 4).map(([v, c]) => `v${v}×${c}`).join(' ')}`);
    console.log(`     城市锚(血色坐标): ${cB[1]}/42 @v${cB[0]}   城市锚(原版坐标): ${cV[1]}/42 @v${cV[0]}`);
    console.log(`     港锚(血色坐标):   ${pB[1]}/35 @v${pB[0]}   港锚(原版坐标):   ${pV[1]}/35 @v${pV[0]}`);
  }
}
