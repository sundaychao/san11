/** 在血色A p0 上扫描 16/17/18 连通块 → 真实城市/关/港位置 */
const fs = require('fs');

const FILE = 'C:/san11/xsyg/xsyg6/xsyg6/San11Pk/Media/san11pkres.bin';
const OFF = 0x20a40cb7;
const HDR = 8, CELL = 11, W = 200, H = 200, N = W * H;

function readP0(file, off) {
  const fd = fs.openSync(file, 'r');
  const buf = Buffer.alloc(HDR + N * CELL);
  fs.readSync(fd, buf, 0, buf.length, off);
  fs.closeSync(fd);
  const a = new Uint8Array(N);
  for (let i = 0; i < N; i++) a[i] = buf[HDR + i * CELL];
  return a;
}

let p0 = readP0(FILE, OFF);

// 网格坐标: col序 index = x*200 + y? 先按 col 序解释 (x=列,y=行): idx = x*H + y
// 但为避免预设立场, 同时输出两种解释的质心
function blobsOf(arr, target) {
  const seen = new Uint8Array(N);
  const out = [];
  for (let i = 0; i < N; i++) {
    if (p0[i] !== target || seen[i]) continue;
    // BFS
    const queue = [i];
    seen[i] = 1;
    const cells = [];
    while (queue.length) {
      const c = queue.pop();
      cells.push(c);
      const cx = Math.floor(c / H), cy = c % H; // col序解释
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = cx + dx, ny = cy + dy;
        if (nx < 0 || nx >= W || ny < 0 || ny >= H) continue;
        const ni = nx * H + ny;
        if (!seen[ni] && arr[ni] === target) { seen[ni] = 1; queue.push(ni); }
      }
    }
    // 质心(col序)
    let sx = 0, sy = 0;
    for (const c of cells) { sx += Math.floor(c / H); sy += c % H; }
    out.push({
      size: cells.length,
      colX: +(sx / cells.length).toFixed(1),
      colY: +(sy / cells.length).toFixed(1),
    });
  }
  out.sort((a, b) => b.size - a.size);
  return out;
}

function report(arr, label) {
  for (const [v, name] of [[16, '都市'], [18, '关所'], [17, '港口']]) {
    const bs = blobsOf(arr, v);
    console.log(`\n== ${label} 值${v}(${name}): ${bs.length} 个连通块 ==`);
    console.log('大小分布:', bs.map((b) => b.size).join(','));
    for (const b of bs) console.log(`  size=${b.size} @ col=(${b.colX},${b.colY})`);
  }
}

report(p0, '血色A');

// 血色A p0 值16/17/18 总数
const cnt = {};
for (const v of p0) cnt[v] = (cnt[v] ?? 0) + 1;
console.log('\n血色A p0 值16/17/18 总数:', { 16: cnt[16] ?? 0, 17: cnt[17] ?? 0, 18: cnt[18] ?? 0 });

// 对照: 原版A p0
const vanilla = readP0('C:/san11/san11_原版/San11/Media/san11pkres.bin', 0x1f520cb7);
report(vanilla, '原版A');
