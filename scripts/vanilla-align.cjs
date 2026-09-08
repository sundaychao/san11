// 原版 blob 对齐暴力扫描: order(x-major/y-major) × baseX × baseY × flip
// 目标: 42城凝聚在同一p0值(最大命中), 35港凝聚在另一值
const fs = require('fs');
const VAN = 'C:/san11/san11_原版/San11/Media/san11pkres.bin';
const VAN_S11 = 'C:/san11/san11_原版/San11/Media/scenario/Scen000.s11';
const MOD = 'C:/san11/xsyg/xsyg6/xsyg6/Media/san11pkres.bin';
const W = 200, H = 200, N = 40000, P = 11;

function planeAt(bin, off) {
  const buf = fs.readFileSync(bin);
  const out = Buffer.alloc(N);
  for (let i = 0; i < N; i++) out[i] = buf[off + 8 + i * P];
  return out;
}
const s11 = fs.readFileSync(VAN_S11);
function readTable(off, count) {
  const arr = [];
  for (let i = 0; i < count; i++) {
    const o = off + i * 18;
    arr.push({ x: s11.readUInt16LE(o), y: s11.readUInt16LE(o + 2), name: s11.toString('utf16le', o + 4, o + 12).replace(/\u0000/g, '') });
  }
  return arr;
}
const cities = readTable(0x3f4f, 42);
const passes = readTable(0x4243, 10);
const ports = readTable(0x42f7, 35);
console.log('city coord ranges: x', Math.min(...cities.map(c => c.x)), '-', Math.max(...cities.map(c => c.x)), ' y', Math.min(...cities.map(c => c.y)), '-', Math.max(...cities.map(c => c.y)));
console.log('port coord ranges: x', Math.min(...ports.map(c => c.x)), '-', Math.max(...ports.map(c => c.x)), ' y', Math.min(...ports.map(c => c.y)), '-', Math.max(...ports.map(c => c.y)));

function scan(p0, label) {
  let best = null;
  for (const order of ['xm', 'ym']) {
    for (const fy of [false, true]) {
      for (let bx = 20; bx <= 40; bx++) {
        for (let by = 20; by <= 40; by++) {
          const cnt = new Map();
          let ok = 0;
          for (const c of cities) {
            let gx = c.x - bx, gy = c.y - by;
            if (gx < 0 || gx >= W || gy < 0 || gy >= H) continue;
            const i = order === 'xm' ? gx * H + gy : (fy ? (W - 1 - gy) * H + gx : gy * W + gx);
            const v = p0[i];
            cnt.set(v, (cnt.get(v) || 0) + 1); ok++;
          }
          const top = [...cnt.entries()].sort((a, b) => b[1] - a[1])[0];
          if (top && ok >= 30 && (!best || top[1] > best.hit)) best = { order, fy, bx, by, val: top[0], hit: top[1], ok };
        }
      }
    }
  }
  console.log(label, JSON.stringify(best));
  return best;
}

const blobVAN_A = planeAt(VAN, 0x1f520cb7);
const blobVAN_B = planeAt(VAN, 0x252e0119);
let blobMOD;
try { blobMOD = planeAt(MOD, 0x26800119); } catch (e) { console.log('MOD bin unreadable:', e.message); }
const bA = scan(blobVAN_A, 'VAN_A');
if (blobMOD) {
  const same = blobMOD.every((v, i) => v === blobVAN_A[i]);
  console.log('MOD@0x26800119 == VAN_A ?', same);
}
const bB = scan(blobVAN_B, 'VAN_B');

// 用最优组合输出城市/港/关下 p0 值
function report(p0, b) {
  const map1 = (c) => {
    let gx = c.x - b.bx, gy = c.y - b.by;
    if (gx < 0 || gx >= W || gy < 0 || gy >= H) return null;
    return b.order === 'xm' ? gx * H + gy : (b.fy ? (W - 1 - gy) * H + gx : gy * W + gx);
  };
  console.log('\n=== cities @', JSON.stringify(b), '===');
  for (const c of cities) {
    const i = map1(c);
    console.log(`${c.name.padEnd(6)} (${c.x},${c.y}) -> ${i === null ? 'OUT' : 'v' + p0[i]}`);
  }
  console.log('=== ports ===');
  const pc = new Map();
  for (const c of ports) { const i = map1(c); if (i !== null) pc.set(p0[i], (pc.get(p0[i]) || 0) + 1); }
  console.log([...pc.entries()].map(([v, n]) => `v${v}:${n}`).join(' '));
  console.log('=== passes ===');
  for (const c of passes) { const i = map1(c); console.log(`(${c.x},${c.y}) -> ${i === null ? 'OUT' : 'v' + p0[i]}`); }
}
if (bA) report(blobVAN_A, bA);
