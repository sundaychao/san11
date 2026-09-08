// 决定性验证：
// A) JSON 87 建筑坐标 → 变换暴力搜索 → 匹配原版 p0 标记 (42城市/10关/35港)
// B) 用原版标记位置反查 s11 剧本文件中的坐标表 (等差数列过滤)
const fs = require('fs');

const W = 200, H = 200, N = 40000, CELL = 11, HDR = 8;
const VAN_PKRES = 'C:/san11/san11_原版/San11/Media/san11pkres.bin';
const VAN_P0_OFF = 0x1f520cb7;
const JSON_FILE = 'D:/MyProjects/san11/tools/xsyg_map/Scenario1.json';
const S11_FILES = {
  '原版Scen000': 'C:/san11/san11_原版/San11/Media/scenario/Scen000.s11',
  '原版Scenario': 'C:/san11/san11_原版/San11/Media/scenario/Scenario.s11',
  '血色SCEN000': 'C:/san11/xsyg/xsyg6/xsyg6/San11Pk/Media/scenario/SCEN000.S11',
  '血色SCEN003': 'C:/san11/xsyg/xsyg6/xsyg6/San11Pk/Media/scenario/SCEN003.S11',
};

function readPlane(file, off, plane) {
  const fd = fs.openSync(file, 'r');
  const buf = Buffer.alloc(HDR + N * CELL);
  fs.readSync(fd, buf, 0, buf.length, off);
  fs.closeSync(fd);
  const a = new Uint8Array(N);
  for (let i = 0; i < N; i++) a[i] = buf[HDR + i * CELL + plane];
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
    const coords = cells.map(c => [Math.floor(c / H), c % H]);
    for (const [x, y] of coords) { sx += x; sy += y; }
    coords.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    out.push({ size: cells.length, cx: sx / cells.length, cy: sy / cells.length, cells: coords });
  }
  out.sort((a, b) => b.size - a.size);
  return out;
}

// ===== 提取原版标记 =====
const vanP0 = readPlane(VAN_PKRES, VAN_P0_OFF, 0);
const cityBlobs = blobsOf(vanP0, 16).filter(b => b.size >= 4);
const passBlobs = blobsOf(vanP0, 18).filter(b => b.size >= 2);
const portBlobs = blobsOf(vanP0, 17);
console.log(`原版标记: 城市${cityBlobs.length} 关${passBlobs.length} 港${portBlobs.length}`);

function anchorCandidates(blob) {
  const set = new Set();
  set.add(`${Math.round(blob.cx)},${Math.round(blob.cy)}`);
  set.add(`${Math.floor(blob.cx)},${Math.floor(blob.cy)}`);
  for (const [x, y] of blob.cells) set.add(`${x},${y}`);
  return [...set].map(s => s.split(',').map(Number));
}
const cityPosSet = new Map(); // "x,y" -> blobIdx
cityBlobs.forEach((b, i) => { for (const [x, y] of anchorCandidates(b)) cityPosSet.set(`${x},${y}`, i); });
const passPosSet = new Map();
passBlobs.forEach((b, i) => { for (const [x, y] of anchorCandidates(b)) passPosSet.set(`${x},${y}`, i); });
const portPosSet = new Map();
portBlobs.forEach((b, i) => { for (const [x, y] of anchorCandidates(b)) portPosSet.set(`${x},${y}`, i); });

// ===== A: JSON 变换暴力搜索 =====
const j = JSON.parse(fs.readFileSync(JSON_FILE, 'utf8'));
const buildings = Object.values(j.citySet).map(b => ({
  id: b.Id, type: b.BuildingType, name: b.Name, x: b.x, y: b.y,
}));
const byType = t => buildings.filter(b => b.type === t);
console.log(`JSON 建筑: 都市${byType(1).length} 关${byType(2).length} 港${byType(3).length}`);

function matchSetFor(type) {
  return type === 1 ? cityPosSet : type === 2 ? passPosSet : portPosSet;
}

// 变换: JSON(x,y) -> grid(gx,gy); 枚举 轴交换×翻转×偏移
const targetTypes = [1, 2, 3];
const results = [];
for (const swap of [0, 1]) {
  for (const fx of [0, 1]) {
    for (const fy of [0, 1]) {
      for (let dx = -120; dx <= 120; dx++) {
        for (let dy = -120; dy <= 120; dy++) {
          let score = 0, total = 0;
          for (const b of buildings) {
            const ms = matchSetFor(b.type);
            let x = swap ? b.y : b.x, y = swap ? b.x : b.y;
            if (fx) x = 199 - x;
            if (fy) y = 199 - y;
            x += dx; y += dy;
            total++;
            if (ms.has(`${x},${y}`)) score++;
          }
          if (score >= 70) results.push({ swap, fx, fy, dx, dy, score, total });
        }
      }
    }
  }
}
results.sort((a, b) => b.score - a.score);
console.log('\n=== A) JSON→原版标记 变换搜索 (score>=70) ===');
for (const r of results.slice(0, 8)) {
  console.log(`swap=${r.swap} flipX=${r.fx} flipY=${r.fy} dx=${r.dx} dy=${r.dy} → ${r.score}/${r.total}`);
}

// 用最佳变换列出未匹配建筑
if (results.length) {
  const best = results[0];
  console.log(`\n--- 最佳变换下未命中的建筑 (swap=${best.swap} flip=${best.fx},${best.fy} dx=${best.dx} dy=${best.dy}) ---`);
  for (const b of buildings) {
    const ms = matchSetFor(b.type);
    let x = best.swap ? b.y : b.x, y = best.swap ? b.x : b.y;
    if (best.fx) x = 199 - x;
    if (best.fy) y = 199 - y;
    x += best.dx; y += best.dy;
    if (!ms.has(`${x},${y}`)) {
      const grid = x >= 0 && x < 200 && y >= 0 && y < 200;
      console.log(`  [${b.type}] ${b.name} JSON(${b.x},${b.y}) → 网格(${x},${y})${grid ? ' 落空' : ' 出界'}`);
    }
  }
}

// ===== B: s11 坐标表搜索 =====
function collectHits(buf, dec) {
  const hits = [];
  const step = dec.enc === 'u8' ? 1 : 2;
  for (let o = 0; o + (step === 1 ? 2 : 4) <= buf.length; o++) {
    let x, y;
    if (dec.enc === 'u8') { x = buf[o]; y = buf[o + 1]; }
    else if (dec.enc === 'le') { x = buf.readUInt16LE(o); y = buf.readUInt16LE(o + 2); }
    else { x = buf.readUInt16BE(o); y = buf.readUInt16BE(o + 2); }
    if (dec.swap) { const t = x; x = y; y = t; }
    if (x >= 200 || y >= 200) continue;
    const set = dec.set;
    if (set.has(`${x},${y}`)) hits.push(o);
  }
  return hits;
}

function findProgressions(hits, need, minS, maxS, maxK) {
  const hitSet = new Set(hits);
  const out = [];
  for (let i = 0; i < hits.length; i++) {
    for (let j = i + 1; j < hits.length; j++) {
      const S = hits[j] - hits[i];
      if (S < minS) continue;
      if (S > maxS) break;
      if (hits[i] + (maxK - 1) * S > (hits[hits.length - 1] || 0) + 4096 && hits[i] + maxK * S > 1e9) continue;
      let c = 0;
      for (let k = 0; k < maxK; k++) if (hitSet.has(hits[i] + k * S)) c++;
      if (c >= need) out.push({ start: hits[i], S, count: c });
    }
  }
  return out;
}

console.log('\n=== B) s11 坐标表搜索 ===');
for (const [label, path] of Object.entries(S11_FILES)) {
  let buf;
  try { buf = fs.readFileSync(path); } catch (e) { console.log(label, '读取失败', e.message); continue; }
  for (const [type, typeName, set, need] of [[1, '城市', cityPosSet, 30], [2, '关', passPosSet, 8], [3, '港', portPosSet, 25]]) {
    for (const enc of ['le', 'be', 'u8']) {
      for (const swap of [0, 1]) {
        const hits = collectHits(buf, { enc, swap, set });
        if (hits.length < need / 2) continue;
        const maxK = type === 1 ? 42 : type === 2 ? 10 : 35;
        const minS = type === 3 ? 4 : 16;
        const progs = findProgressions(hits, need, minS, 4096, maxK);
        // 去重: 同S近起点合并
        const seen = new Set();
        for (const p of progs.sort((a, b) => b.count - a.count)) {
          const key = `${Math.round(p.S)}@${Math.round(p.start / p.S)}`;
          if (seen.has(key)) continue;
          seen.add(key);
          console.log(`${label} ${typeName} enc=${enc} swap=${swap}: 起始0x${p.start.toString(16)} 步长${p.S} 命中${p.count}/${maxK} (原始hits=${hits.length})`);
        }
      }
    }
  }
}
