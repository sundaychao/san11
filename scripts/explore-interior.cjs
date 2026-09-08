/**
 * 探查原版 San11pkres.bin SHEX0008 每格 11 字节的 areaId(+1) 与 interior(+5) 平面：
 *   - 验证 42 城都市格(p0=16)是否为 中心+6邻 的 7 格 footprint
 *   - 统计每城 interior>0 的建设用地格数量与坐标
 *   - 验证 areaId 是否等于城市序号（42 城/关/港的区域归属）
 */
const PKRES = 'C:/san11/san11_原版/San11/Media/san11pkres.bin';
const SCEN = 'C:/san11/san11_原版/San11/Media/scenario/Scen000.s11';
const MAP_OFFSET = 0x1f520cb7;
const WIDTH = 200, HEIGHT = 200;

const fs = require('node:fs');
const buf = fs.readFileSync(PKRES).subarray(MAP_OFFSET, MAP_OFFSET + 8 + 40000 * 11);
if (buf.toString('ascii', 0, 8) !== 'SHEX0008') throw new Error('bad head');

// 每格 11 字节平面
const planes = { tType: 0, areaId: 1, lpB: 2, trap: 3, dir: 4, interior: 5, defence: 6, thief: 7, flood: 8, fire: 9, ruins: 10 };
function plane(name) {
  const off = planes[name];
  const out = new Uint8Array(40000);
  for (let i = 0; i < 40000; i++) out[i] = buf[8 + i * 11 + off];
  return out;
}
const tType = plane('tType');
const areaId = plane('areaId');
const interior = plane('interior');
const defence = plane('defence');
const thief = plane('thief');
const ruins = plane('ruins');

function neighbors(q, r) {
  return q % 2 === 0
    ? [[q, r - 1], [q, r + 1], [q - 1, r - 1], [q - 1, r], [q + 1, r - 1], [q + 1, r]]
    : [[q, r - 1], [q, r + 1], [q - 1, r], [q - 1, r + 1], [q + 1, r], [q + 1, r + 1]];
}

// 42 城坐标（Scen000.s11 都市记录）
const scen = fs.readFileSync(SCEN);
const cities = [];
for (let i = 0; i < 42; i++) {
  const rec = 0x3f4f + i * 18;
  cities.push({ i, q: scen.readUInt16LE(rec), r: scen.readUInt16LE(rec + 2) });
}

// 1) 都市格(p0=16) 按区域聚类，验证每城 7 格且为中心+6邻
console.log('=== 都市格(p0=16) 聚类验证 ===');
const cityCells = [];
for (const c of cities) {
  // BFS 找与中心连通的 p0=16 格
  const cells = new Set([`${c.q},${c.r}`]);
  const queue = [[c.q, c.r]];
  while (queue.length) {
    const [q, r] = queue.shift();
    for (const [nq, nr] of neighbors(q, r)) {
      const k = `${nq},${nr}`;
      if (cells.has(k)) continue;
      if (nq < 0 || nq >= WIDTH || nr < 0 || nr >= HEIGHT) continue;
      if (tType[nq * HEIGHT + nr] !== 16) continue;
      cells.add(k);
      queue.push([nq, nr]);
    }
  }
  // 验证形状：中心+6邻 恰好 7 格？
  const expected = new Set([[c.q, c.r], ...neighbors(c.q, c.r)].map(([q, r]) => `${q},${r}`));
  const shapeOk = cells.size === 7 && [...cells].every((k) => expected.has(k));
  const ids = [...cells].map((k) => { const [q, r] = k.split(',').map(Number); return areaId[q * HEIGHT + r]; });
  const idSet = [...new Set(ids)];
  cityCells.push({ ...c, cells, ids: idSet });
  console.log(`city#${c.i} (${String(c.q).padStart(3)},${String(c.r).padStart(3)}) cells=${cells.size} shape=${shapeOk ? 'OK(中心+6邻)' : 'X ' + [...cells].join('/')} areaId=${idSet.join(',')}`);
}

// 2) interior 平面统计
console.log('\n=== interior 平面 ===');
let interiorCount = 0;
const interiorByArea = {};
for (let q = 0; q < WIDTH; q++) for (let r = 0; r < HEIGHT; r++) {
  if (interior[q * HEIGHT + r] > 0) {
    interiorCount++;
    const a = areaId[q * HEIGHT + r];
    interiorByArea[a] = (interiorByArea[a] ?? 0) + 1;
  }
}
console.log('interior>0 格总数:', interiorCount);
console.log('按 areaId 分布:', JSON.stringify(interiorByArea));

// 3) 每城 interior 格（按区域距离最近城市归属）
console.log('\n=== 每城建设用地 ===');
function hexDistance(q1, r1, q2, r2) {
  const aq = q1 - q2;
  const ar = (r1 - Math.floor(q1 / 2)) - (r2 - Math.floor(q2 / 2));
  return (Math.abs(aq) + Math.abs(ar) + Math.abs(aq + ar)) / 2;
}
for (const c of cityCells) {
  const myArea = c.ids[0];
  let cells = [];
  for (let q = 0; q < WIDTH; q++) for (let r = 0; r < HEIGHT; r++) {
    if (interior[q * HEIGHT + r] === 0) continue;
    if (areaId[q * HEIGHT + r] !== myArea) continue;
    cells.push([q, r]);
  }
  // 备选：距离归属（区域id不匹配时）
  const byDist = [];
  if (cells.length === 0) {
    for (let q = 0; q < WIDTH; q++) for (let r = 0; r < HEIGHT; r++) {
      if (interior[q * HEIGHT + r] === 0) continue;
      const d = hexDistance(q, r, c.q, c.r);
      const nearer = cities.some((o) => o.i !== c.i && hexDistance(q, r, o.q, o.r) < d);
      if (!nearer) byDist.push([q, r]);
    }
  }
  const list = cells.length ? cells : byDist;
  console.log(`city#${c.i} area=${myArea} interior格=${list.length}${cells.length === 0 ? '(按距离归属)' : ''}`);
}

// 4) defence / thief / ruins 平面概况
const sum = (p) => { let n = 0; for (const v of p) if (v > 0) n++; return n; };
console.log('\n=== 其它平面 ===');
console.log('defence>0:', sum(defence), ' thief>0:', sum(thief), ' ruins>0:', sum(ruins));
