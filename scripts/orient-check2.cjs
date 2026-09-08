/**
 * 定坐标系与地形：血色 #4792 p0，pkres 索引 i。
 * 假设A: i = X*200 + Y   (X=(i/200), Y=i%200)
 * 假设B: i = Y*200 + X   (转置)
 * 城市真实经/纬：成都/武威/兰州=内陆(必须陆地)；沿海在东侧。
 * 用两种索引 + 两种地形假设，统计“内陆都市落海/落陆”。
 */
const fs = require('fs');
const MOD = 'C:/san11/xsyg/xsyg6/xsyg6/San11Pk/Media/san11pkres.bin';
const N = 200 * 200, CELL = 11, HDR = 8, H = 200;
const fd = fs.openSync(MOD, 'r');
const buf = Buffer.alloc(HDR + N * CELL);
fs.readSync(fd, buf, 0, buf.length, 0x20a40cb7);
fs.closeSync(fd);
const p0 = new Uint8Array(N);
for (let i = 0; i < N; i++) p0[i] = buf[HDR + i * CELL];

// 血色海候选(依据富集度)：v11,v12,v17 海 lift 高；v0/v7/v15 水
const SEA_STRONG = new Set([11, 12, 17]);
const SEA_ALL = new Set([0, 7, 11, 12, 15, 17]);

// 读建筑坐标(SCEN000.S11 raw)
const BLD = 'C:/san11/xsyg/xsyg6/xsyg6/San11Pk/Media/scenario/SCEN000.S11';
const s11 = fs.readFileSync(BLD);
function readBld(off, c) {
  const o = [];
  for (let k = 0; k < c; k++) { const p = off + k * 18; o.push({ x: s11.readUInt16LE(p), y: s11.readUInt16LE(p + 2) }); }
  return o;
}
const scen = JSON.parse(fs.readFileSync('D:/MyProjects/san11/tools/xsyg_map/Scenario1.json', 'utf8'));
const names = Object.values(scen.citySet).filter(c => c.BuildingType === 1).map(c => c.Name);
const raw = readBld(0x3f4f, 42);
const byName = {}; names.forEach((n, i) => byName[n] = raw[i]);

// 确定内陆城市（地理上绝无可能临海）
const INLAND = ['成都', '梓潼', '漢中', '永安', '雲中', '武威', '隴西', '安定', '晉陽', '長安', '洛陽', '襄陽'];

function valA(b) { return p0[b.x * H + b.y]; }
function valB(b) { return p0[b.y * H + b.x]; }

console.log('假设A (i=X*200+Y) 与 假设B (i=Y*200+X)：内陆都市地形值');
let seaA = 0, seaB = 0;
for (const n of INLAND) {
  const b = byName[n]; if (!b) { console.log(`  ?${n} 未找到`); continue; }
  const va = valA(b), vb = valB(b);
  const aSea = SEA_ALL.has(va), bSea = SEA_ALL.has(vb);
  if (aSea) seaA++; if (bSea) seaB++;
  console.log(`  ${n} raw(${b.x},${b.y})  A=v${String(va).padStart(2)}${aSea ? ' <<海' : '  陆'}   B=v${String(vb).padStart(2)}${bSea ? ' <<海' : '  陆'}`);
}
console.log(`\n内陆落海计数  假设A=${seaA}/${INLAND.length}  假设B=${seaB}/${INLAND.length}`);

// 海格重心在哪个坐标轴（用 p0 索引 i 反推两种视图）
function centroid(setOf) {
  let n = 0, s1 = 0, s2 = 0;
  for (let i = 0; i < N; i++) if (setOf.has(p0[i])) { n++; s1 += (i / H) | 0; s2 += i % H; }
  return { n, major: s1 / n, minor: s2 / n };
}
const cStrong = centroid(SEA_STRONG);
console.log(`\n海(strong v11/12/17) ${cStrong.n} 格: 索引major(=(i/200))均值=${cStrong.major.toFixed(1)} 索引minor(=i%200)均值=${cStrong.minor.toFixed(1)}`);
console.log('  若视 A: 该轴=X=东西 → 海在大X=东；若视 B: 该轴=Y → 需结合城市判断');

// 每 20 一箱，海(strong) 按 major(i/200) 与 minor(i%200) 分布
const byMajor = new Array(200).fill(0), byMinor = new Array(200).fill(0);
for (let i = 0; i < N; i++) if (SEA_STRONG.has(p0[i])) { byMajor[(i / H) | 0]++; byMinor[i % H]++; }
const dec = a => { const r = []; for (let k = 0; k < 10; k++) { let s = 0; for (let j = k * 20; j < k * 20 + 20; j++) s += a[j]; r.push(s); } return r; };
console.log('海 strong 按 major(i/200) 分箱:', dec(byMajor).join(' '));
console.log('海 strong 按 minor(i%200) 分箱:', dec(byMinor).join(' '));
