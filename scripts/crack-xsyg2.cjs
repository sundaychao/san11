/**
 * 三路破解 v2: 1) 平面组合  2) 密钥流周期  3) 存档全量扫描(带多样性过滤)
 */
const fs = require('fs');

const MOD = 'C:/san11/xsyg/xsyg6/xsyg6/San11Pk/Media/san11pkres.bin';
const SAVE = 'C:/san11/xsyg/xsyg6/xsyg6/San11Pk/Koei/San11 Tc/SaveData/Save000.s11';
const N = 40000, HDR = 8;

const scen = JSON.parse(fs.readFileSync('tools/xsyg_map/Scenario1.json', 'utf8'));
const all = Object.values(scen.citySet)
  .map((c) => ({ q: c.x - 28, r: c.y - 28, bt: c.BuildingType }))
  .filter((c) => c.q >= 0 && c.q < 200 && c.r >= 0 && c.r < 200);
const colCities = all.map((c) => ({ i: c.q * 200 + c.r, bt: c.bt }));
const rowCities = all.map((c) => ({ i: c.r * 200 + c.q, bt: c.bt }));

const modBuf = fs.readFileSync(MOD, { start: 0x20a40cb7, end: 0x20a40cb7 + HDR + N * 11 - 1 });
const planes = [];
for (let p = 0; p < 11; p++) {
  const a = new Uint8Array(N);
  for (let i = 0; i < N; i++) a[i] = modBuf[HDR + i * 11 + p];
  planes.push(a);
}

function tallyAt(t, cities) {
  const tally = {};
  for (const c of cities) { const v = t[c.i]; tally[v] = (tally[v] ?? 0) + 1; }
  return Object.entries(tally).sort((a, b) => b[1] - a[1]);
}

console.log('== 1) 平面组合测试 (base=28) ==');
let anyHit = false;
for (let x = 1; x <= 10; x++) {
  for (const name of ['xor', 'add', 'sub']) {
    const t = new Uint8Array(N);
    for (let i = 0; i < N; i++) {
      const a = planes[0][i], b = planes[x][i];
      t[i] = name === 'xor' ? a ^ b : name === 'add' ? (a + b) & 0xff : (a - b) & 0xff;
    }
    const tl = tallyAt(t, colCities);
    if (Number(tl[0][1]) >= 15) {
      anyHit = true;
      console.log(`  p0 ${name} p${x}: top[${tl.slice(0, 3).map(([v, c]) => `${v}×${c}`).join(' ')}]`);
    }
  }
}
if (!anyHit) console.log('  无 top>=15 的组合');

console.log('\n== 2) 密钥流周期测试 ==');
const cityIdx = colCities.filter((c) => c.bt === 1).map((c) => c.i);
const bestP = [];
for (let P = 2; P <= 8192; P++) {
  const groups = new Map();
  for (const i of cityIdx) {
    const cls = i % P;
    if (!groups.has(cls)) groups.set(cls, []);
    groups.get(cls).push(planes[0][i]);
  }
  let pairs = 0, agree = 0;
  for (const arr of groups.values()) {
    for (let a = 0; a < arr.length; a++) for (let b = a + 1; b < arr.length; b++) {
      pairs++; if (arr[a] === arr[b]) agree++;
    }
  }
  if (pairs >= 30 && agree / pairs > 0.6) bestP.push({ P, rate: agree / pairs, pairs });
}
bestP.sort((a, b) => b.rate - a.rate);
if (bestP.length === 0) console.log('  无显著周期');
for (const b of bestP.slice(0, 8)) console.log(`  P=${b.P} 一致率=${(b.rate * 100).toFixed(0)}% (对数=${b.pairs})`);

console.log('\n== 3) 存档全量扫描 (多样性过滤) ==');
const save = fs.readFileSync(SAVE);
function verify(t, cities) {
  const tl = tallyAt(t, cities);
  const distinct = new Set(t).size;
  let maxFreq = 0;
  for (const [, c] of Object.entries(
    [...t].reduce((m, v) => { m[v] = (m[v] ?? 0) + 1; return m; }, {}),
  )) if (c > maxFreq) maxFreq = c;
  const ring = {};
  for (let q = 0; q < 200; q++) for (const r of [0, 199]) { const v = t[q * 200 + r]; ring[v] = (ring[v] ?? 0) + 1; }
  for (let r = 1; r < 199; r++) for (const q of [0, 199]) { const v = t[q * 200 + r]; ring[v] = (ring[v] ?? 0) + 1; }
  const ringTop = Object.entries(ring).sort((a, b) => b[1] - a[1])[0];
  return { tl: tl.slice(0, 3), ringTop, distinct, maxFreq };
}

for (const stride of [11, 1]) {
  const limit = stride === 11 ? save.length - N * 11 : save.length - N - 1;
  for (const [label, cities] of [['列', colCities], ['行', rowCities]]) {
    const sample = cities.filter((c) => c.bt === 1).slice(0, 8).map((c) => c.i);
    let hits = 0, checked = 0;
    let lastHitOff = -99;
    for (let o = 0; o <= limit; o += 1) {
      const t0 = {};
      let m = 0, mv = -1;
      for (const si of sample) {
        const v = save[o + si * stride];
        t0[v] = (t0[v] ?? 0) + 1;
        if (t0[v] > m) { m = t0[v]; mv = v; }
      }
      if (m < 6 || mv === 0) continue;
      checked++;
      const t = new Uint8Array(N);
      for (let i = 0; i < N; i++) t[i] = save[o + i * stride];
      const { tl, ringTop, distinct, maxFreq } = verify(t, cities);
      if (Number(tl[0][1]) >= 34 && ringTop[1] >= 550 && distinct >= 10 && maxFreq <= 0.6 * N) {
        hits++;
        if (o - lastHitOff > 1000) {
          console.log(`  ★ stride=${stride} ${label}序 off=0x${o.toString(16)} 都市[${tl.map(([v, c]) => `${v}×${c}`).join(' ')}] 边界[${ringTop.join('×')}] 值种=${distinct}`);
        }
        lastHitOff = o;
      }
    }
    console.log(`  stride=${stride} ${label}序: 预筛通过=${checked} 强命中=${hits}`);
  }
}
