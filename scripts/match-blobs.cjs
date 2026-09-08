/**
 * 提取血色地图值16的7格团块中心, 与场景建筑坐标匹配找变换
 */
const fs = require('fs');

const N = 200 * 200, CELL = 11, HEADER = 8;
function readMap(file, offset) {
  const fd = fs.openSync(file, 'r');
  const buf = Buffer.alloc(HEADER + N * CELL);
  fs.readSync(fd, buf, 0, buf.length, offset);
  fs.closeSync(fd);
  const t = new Uint8Array(N);
  for (let i = 0; i < N; i++) t[i] = buf[HEADER + i * CELL];
  return t;
}
const blood = readMap('C:/san11/xsyg/xsyg6/xsyg6/San11Pk/Media/san11pkres.bin', 0x20a40cb7);

// 连通块
const seen = new Uint8Array(N);
const blobs = [];
for (let i = 0; i < N; i++) {
  if (blood[i] !== 16 || seen[i]) continue;
  const stack = [i]; seen[i] = 1;
  let sumX = 0, sumY = 0, cnt = 0, minX = 999, maxX = 0, minY = 999, maxY = 0;
  while (stack.length) {
    const j = stack.pop();
    const x = Math.floor(j / 200), y = j % 200;
    sumX += x; sumY += y; cnt++;
    minX = Math.min(minX, x); maxX = Math.max(maxX, x);
    minY = Math.min(minY, y); maxY = Math.max(maxY, y);
    for (const [nx, ny] of [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]]) {
      if (nx < 0 || nx >= 200 || ny < 0 || ny >= 200) continue;
      const k = nx * 200 + ny;
      if (blood[k] === 16 && !seen[k]) { seen[k] = 1; stack.push(k); }
    }
  }
  blobs.push({ cx: sumX / cnt, cy: sumY / cnt, cnt, minX, maxX, minY, maxY });
}
console.log(`16团块数: ${blobs.length}`);
console.log('尺寸分布:', blobs.reduce((d, b) => (d[b.cnt] = (d[b.cnt] ?? 0) + 1, d), {}));

// 场景建筑
const scen = JSON.parse(fs.readFileSync('tools/xsyg_map/Scenario1.json', 'utf8'));
const builds = Object.values(scen.citySet);

// 尝试: 团块中心 vs 建筑坐标, 找 (dx, dy) 使最多配对
// 团块中心(cx,cy) 是格坐标, 建筑(x,y)是场景坐标
// 对每个团块-建筑对计算差值, 统计众数
const diffs = {};
for (const b of blobs) {
  for (const c of builds) {
    const dx = Math.round(b.cx - c.x), dy = Math.round(b.cy - c.y);
    const key = `${dx},${dy}`;
    diffs[key] = (diffs[key] ?? 0) + 1;
  }
}
const top = Object.entries(diffs).sort((a, b) => b[1] - a[1]).slice(0, 8);
console.log('团块中心-建筑 差值众数 top8:', top);

// 也测转置: (cx,cy) vs (y,x)
const diffsT = {};
for (const b of blobs) {
  for (const c of builds) {
    const dx = Math.round(b.cx - c.y), dy = Math.round(b.cy - c.x);
    const key = `${dx},${dy}`;
    diffsT[key] = (diffsT[key] ?? 0) + 1;
  }
}
console.log('转置差值众数 top8:', Object.entries(diffsT).sort((a, b) => b[1] - a[1]).slice(0, 8));
