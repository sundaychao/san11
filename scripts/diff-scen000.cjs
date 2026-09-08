// 字节级 diff：血色 SCEN000.S11 vs 原版 Scen000.s11
// 目标：定位剧本文件中的城市坐标区域，验证血色 87 建筑坐标来源
const fs = require('fs');
const path = require('path');

const BLOOD = 'C:/san11/xsyg/xsyg6/xsyg6/San11Pk/Media/scenario/SCEN000.S11';
const VANI = 'C:/san11/san11_原版/San11/Media/scenario/Scen000.s11';
const VANI_SCENARIO = 'C:/san11/san11_原版/San11/Media/scenario/Scenario.s11';
const BLOOD_SCENARIO = 'C:/san11/xsyg/xsyg6/xsyg6/San11Pk/Media/scenario/Scenario.s11';
const JSON_FILE = 'D:/MyProjects/san11/tools/xsyg_map/Scenario1.json';

function readAll(p) {
  const fd = fs.openSync(p, 'r');
  const size = fs.fstatSync(fd).size;
  const buf = Buffer.alloc(size);
  fs.readSync(fd, buf, 0, size, 0);
  fs.closeSync(fd);
  return buf;
}

function diffRegions(a, b, gap = 8) {
  const n = Math.min(a.length, b.length);
  const regions = [];
  let start = -1, lastDiff = -1;
  for (let i = 0; i < n; i++) {
    if (a[i] !== b[i]) {
      if (start < 0) start = i;
      lastDiff = i;
    } else if (start >= 0 && i - lastDiff > gap) {
      regions.push({ off: start, end: lastDiff + 1, len: lastDiff + 1 - start });
      start = -1;
    }
  }
  if (start >= 0) regions.push({ off: start, end: lastDiff + 1, len: lastDiff + 1 - start });
  return regions;
}

function hexDump(buf, off, len, maxBytes = 64) {
  const n = Math.min(len, maxBytes);
  const parts = [];
  for (let i = 0; i < n; i++) parts.push(buf[off + i].toString(16).padStart(2, '0'));
  return parts.join(' ');
}

function utf16At(buf, off, len) {
  let s = '';
  for (let i = 0; i < len; i++) {
    const c = buf.readUInt16LE(off + i * 2);
    s += c >= 0x20 && c < 0x9fff ? String.fromCharCode(c) : '.';
  }
  return s;
}

// 搜索 UTF-16LE 名字
function findNames(buf, names) {
  const hits = {};
  for (const name of names) {
    const pat = Buffer.alloc(name.length * 2);
    for (let i = 0; i < name.length; i++) pat.writeUInt16LE(name.charCodeAt(i), i * 2);
    const positions = [];
    let pos = 0;
    while (true) {
      const idx = buf.indexOf(pat, pos);
      if (idx < 0) break;
      positions.push(idx);
      pos = idx + 2;
      if (positions.length > 20) break;
    }
    hits[name] = positions;
  }
  return hits;
}

// 扫描坐标数组：连续 (x,y) LE16 对，x,y 均 0..199
function scanCoordRuns(buf, minRun = 8) {
  const runs = [];
  let runStart = -1, runLen = 0;
  for (let off = 0; off + 4 <= buf.length; off += 2) {
    const x = buf.readInt16LE(off);
    const y = buf.readInt16LE(off + 2);
    const ok = x >= 0 && x < 200 && y >= 0 && y < 200;
    if (ok) {
      if (runStart < 0) runStart = off;
      runLen++;
    } else {
      if (runLen >= minRun) runs.push({ off: runStart, pairs: runLen });
      runStart = -1; runLen = 0;
    }
  }
  if (runLen >= minRun) runs.push({ off: runStart, pairs: runLen });
  return runs;
}

// 检查指定偏移附近的 LE16 对是否符合 JSON 坐标
function checkPairsAt(buf, off, targets, tolerance = 0) {
  let best = 0;
  for (const [x, y] of targets) {
    for (let d = 0; d <= tolerance * 4; d += 4) {
      for (const s of [off - d, off + d]) {
        if (s < 0 || s + 4 > buf.length) continue;
        const px = buf.readInt16LE(s);
        const py = buf.readInt16LE(s + 2);
        if (px === x && py === y) { best++; break; }
      }
      if (best > 0 && d > 0) break;
    }
  }
  return best;
}

const blood = readAll(BLOOD);
const vani = readAll(VANI);
console.log('血色 SCEN000.S11:', blood.length, '字节');
console.log('原版 Scen000.s11:', vani.length, '字节');
console.log('血色前16字节:', hexDump(blood, 0, 16));
console.log('原版前16字节:', hexDump(vani, 0, 16));

// 1. 全文件 diff 区域
const regions = diffRegions(blood, vani);
console.log('\n=== diff 区域数:', regions.length, '===');
let totalDiff = 0;
for (const r of regions) totalDiff += r.len;
console.log('差异总字节:', totalDiff, `(占 min(size) 的 ${(totalDiff / Math.min(blood.length, vani.length) * 100).toFixed(1)}%)`);

// 按大小排序输出前 40 个
const sorted = [...regions].sort((a, b) => b.len - a.len);
console.log('\n--- 最大的 40 个差异区域 ---');
for (const r of sorted.slice(0, 40)) {
  console.log(`off=0x${r.off.toString(16).padStart(6, '0')} (dec ${r.off}) len=${r.len}`);
  console.log(`  血色: ${hexDump(blood, r.off, r.len, 32)}`);
  console.log(`  原版: ${hexDump(vani, r.off, r.len, 32)}`);
}

// 2. 城市名搜索（取几个代表性名字）
const cityNames = ['长安', '洛阳', '成都', '建业', '临淄', '平原', '襄平', '晋阳', '蓟', '南皮'];
console.log('\n=== 城市名 UTF-16LE 搜索 ===');
const bNames = findNames(blood, cityNames);
const vNames = findNames(vani, cityNames);
for (const name of cityNames) {
  const b = bNames[name], v = vNames[name];
  console.log(`${name}: 血色 ${b.length}处${b.length ? ' @' + b.map(x => '0x' + x.toString(16)).join(',') : ''} | 原版 ${v.length}处${v.length ? ' @' + v.map(x => '0x' + x.toString(16)).join(',') : ''}`);
}

// 3. 坐标对数组扫描
console.log('\n=== 连续坐标对扫描 (>=8 对, x,y in [0,200)) ===');
const bRuns = scanCoordRuns(blood, 8);
const vRuns = scanCoordRuns(vani, 8);
console.log('血色 runs:', bRuns.length, '个');
for (const r of bRuns.slice(0, 30)) {
  const x0 = blood.readInt16LE(r.off), y0 = blood.readInt16LE(r.off + 2);
  console.log(`  off=0x${r.off.toString(16)} (dec ${r.off}) ${r.pairs}对 起始(${x0},${y0})`);
}
console.log('原版 runs:', vRuns.length, '个');
for (const r of vRuns.slice(0, 30)) {
  const x0 = vani.readInt16LE(r.off), y0 = vani.readInt16LE(r.off + 2);
  console.log(`  off=0x${r.off.toString(16)} (dec ${r.off}) ${r.pairs}对 起始(${x0},${y0})`);
}

// 4. Scenario.s11 (剧本共通) 对比
try {
  const bs = readAll(BLOOD_SCENARIO);
  const vs = readAll(VANI_SCENARIO);
  console.log('\n=== Scenario.s11 ===');
  console.log('血色:', bs.length, '字节 | 原版:', vs.length, '字节');
  const r2 = diffRegions(bs, vs);
  console.log('diff 区域数:', r2.length);
  const s2 = [...r2].sort((a, b) => b.len - a.len);
  for (const r of s2.slice(0, 15)) {
    console.log(`off=0x${r.off.toString(16).padStart(6, '0')} len=${r.len}`);
    console.log(`  血色: ${hexDump(bs, r.off, r.len, 32)}`);
    console.log(`  原版: ${hexDump(vs, r.off, r.len, 32)}`);
  }
  const bsRuns = scanCoordRuns(bs, 8);
  console.log('血色 Scenario.s11 坐标 runs:', bsRuns.length);
  for (const r of bsRuns.slice(0, 20)) {
    const x0 = bs.readInt16LE(r.off), y0 = bs.readInt16LE(r.off + 2);
    console.log(`  off=0x${r.off.toString(16)} ${r.pairs}对 起始(${x0},${y0})`);
  }
} catch (e) {
  console.log('Scenario.s11 对比失败:', e.message);
}

// 5. 如果 JSON 存在，检查 JSON 坐标是否以 LE16 形式出现在文件中
try {
  const j = JSON.parse(fs.readFileSync(JSON_FILE, 'utf8'));
  const buildings = j.buildings || j.Buildings || [];
  console.log('\n=== JSON 建筑坐标检查 ===');
  console.log('JSON 建筑:', buildings.length, '个');
  if (buildings.length) {
    console.log('样例:', JSON.stringify(buildings[0]));
    const pairs = buildings.map(b => [b.x | 0, b.y | 0]);
    // 在两个文件中查找所有 (x,y) 对出现次数
    for (const [label, buf] of [['血色SCEN000', blood], ['原版Scen000', vani]]) {
      let hits = 0;
      for (const [x, y] of pairs) {
        const pat = Buffer.alloc(4);
        pat.writeInt16LE(x, 0); pat.writeInt16LE(y, 2);
        if (buf.indexOf(pat) >= 0) hits++;
      }
      console.log(`${label}: ${hits}/${pairs.length} 个坐标以LE16(x,y)出现`);
      // 反序 (y,x)
      let hits2 = 0;
      for (const [x, y] of pairs) {
        const pat = Buffer.alloc(4);
        pat.writeInt16LE(y, 0); pat.writeInt16LE(x, 2);
        if (buf.indexOf(pat) >= 0) hits2++;
      }
      console.log(`${label}: ${hits2}/${pairs.length} 个坐标以LE16(y,x)出现`);
    }
  }
} catch (e) {
  console.log('JSON 检查失败:', e.message);
}
