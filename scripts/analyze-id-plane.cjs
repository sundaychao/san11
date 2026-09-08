/**
 * 建筑 ID 平面 (p1) 解码:
 * 1) 原版 p1 验证: 值 k 应形成 1 个 ~7格 团块 (城 0..41 / 关 42..51 / 港 52..86)
 * 2) 血色 p1 逐值团块 -> 提取 87 建筑位置
 * 3) 血色 ID k <-> JSON 建筑k 配对, 输出位置对照
 */
const fs = require('fs');

const MOD = 'C:/san11/xsyg/xsyg6/xsyg6/San11Pk/Media/san11pkres.bin';
const VAN = 'C:/san11/san11_原版/San11/Media/san11pkres.bin';
const N = 40000, HDR = 8, CELL = 11, W = 200, H = 200;

function readPlane(file, off, p) {
  const fd = fs.openSync(file, 'r');
  const buf = Buffer.alloc(HDR + N * CELL);
  fs.readSync(fd, buf, 0, buf.length, off);
  fs.closeSync(fd);
  const a = new Uint8Array(N);
  for (let i = 0; i < N; i++) a[i] = buf[HDR + i * CELL + p];
  return a;
}

function blobsOf(arr, target) {
  const seen = new Uint8Array(N);
  const out = [];
  for (let i = 0; i < N; i++) {
    if (arr[i] !== target || seen[i]) continue;
    const q = [i]; seen[i] = 1;
    const cells = [];
    while (q.length) {
      const c = q.pop(); cells.push(c);
      const x = Math.floor(c / H), y = c % H;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || nx >= W || ny < 0 || ny >= H) continue;
        const ni = nx * H + ny;
        if (!seen[ni] && arr[ni] === target) { seen[ni] = 1; q.push(ni); }
      }
    }
    let sx = 0, sy = 0;
    for (const c of cells) { sx += Math.floor(c / H); sy += c % H; }
    out.push({
      size: cells.length,
      cx: sx / cells.length, cy: sy / cells.length,
      minX: Math.min(...cells.map(c => Math.floor(c / H))),
      maxX: Math.max(...cells.map(c => Math.floor(c / H))),
      minY: Math.min(...cells.map(c => c % H)),
      maxY: Math.max(...cells.map(c => c % H)),
    });
  }
  out.sort((a, b) => b.size - a.size);
  return out;
}

function idReport(arr, label) {
  const dist = {};
  for (const v of arr) dist[v] = (dist[v] ?? 0) + 1;
  const vals = Object.keys(dist).map(Number).sort((a, b) => a - b);
  console.log(`\n== ${label} p1: ${vals.length} 种值, 范围 [${vals[0]}..${vals[vals.length - 1]}] ==`);
  const ids = [];
  const weird = [];
  for (const v of vals) {
    const bs = blobsOf(arr, v);
    if (bs.length === 1 && bs[0].size >= 1 && bs[0].size <= 12) {
      ids.push({ id: v, cells: dist[v], nblob: 1, ...bs[0] });
    } else {
      weird.push(`v${v}: ${dist[v]}格/${bs.length}块/最大${bs[0] ? bs[0].size : 0}`);
    }
  }
  console.log(`ID样值(单团块2-12格): ${ids.length} 个`);
  if (weird.length) console.log('非ID样值:', weird.join(' | '));
  return { ids, dist, vals };
}

const vanP1 = readPlane(VAN, 0x1f520cb7, 1);
const bloodP1 = readPlane(MOD, 0x20a40cb7, 1);
const vanR = idReport(vanP1, '原版A');
const bloodR = idReport(bloodP1, '血色A');

console.log('\n原版ID表 (id: 中心x,y 格数):');
console.log(vanR.ids.map(d => `${d.id}:(${Math.round(d.cx)},${Math.round(d.cy)})×${d.size}`).join(' '));
console.log('\n血色ID表 (id: 中心x,y 格数):');
console.log(bloodR.ids.map(d => `${d.id}:(${Math.round(d.cx)},${Math.round(d.cy)})×${d.size}`).join(' '));

// 与 JSON 配对
const scen = JSON.parse(fs.readFileSync('tools/xsyg_map/Scenario1.json', 'utf8'));
const builds = Object.entries(scen.citySet).map(([k, c]) => ({ k, x: c.x, y: c.y, bt: c.BuildingType, name: c.Name ?? c.name ?? k }));
console.log('\n== 血色ID k <-> JSON 建筑k 对照 (bt: 1都市 2关 3港) ==');
console.log('id | bt | JSON名 | JSON(x,y)->格 | 血色格(x,y) | 距离');
let sum = 0, n = 0;
for (const d of bloodR.ids) {
  const b = builds[d.id];
  if (!b) { console.log(`${d.id} | (JSON无此ID)`); continue; }
  const gx = b.x - 28, gy = b.y - 28;
  const dist = Math.hypot(d.cx - gx, d.cy - gy);
  sum += dist; n++;
  console.log(`${d.id} | bt${b.bt} | ${b.name} | (${gx},${gy}) | (${d.cx.toFixed(1)},${d.cy.toFixed(1)}) | ${dist.toFixed(1)} ${dist > 8 ? ' <<远' : ''}`);
}
if (n) console.log(`平均距离: ${(sum / n).toFixed(2)}`);
