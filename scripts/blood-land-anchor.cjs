/**
 * 用地理锚点分离血色土地类别。
 * 关键：血色是自定义地图，p0 与原版仅 ~2% 相关，但真实地理(海岸/大河/山脉)两图共享。
 * 锚点(全部取原版"on-map"格，排除贴边的 off-map 大三角 v15 填充)：
 *   原版真山 = v15 且不与边框连通
 *   原版森林 = v5
 *   原版草地/平原 = v0
 *   原版荒地 = v9
 *   原版大海 = v8 ; 原版江河 = v6/v7
 * 对每个血色值，统计它落在这些锚点上的"富集度"(lift = 命中率/全局基线)。
 */
const fs = require('fs');

const MOD = 'C:/san11/xsyg/xsyg6/xsyg6/San11Pk/Media/san11pkres.bin';
const VAN = 'C:/san11/san11_原版/San11/Media/san11pkres.bin';
const N = 200 * 200, CELL = 11, HDR = 8, W = 200, H = 200;

function readPlane(file, off, p) {
  const fd = fs.openSync(file, 'r');
  const buf = Buffer.alloc(HDR + N * CELL);
  fs.readSync(fd, buf, 0, buf.length, off);
  fs.closeSync(fd);
  const t = new Uint8Array(N);
  for (let i = 0; i < N; i++) t[i] = buf[HDR + i * CELL + p];
  return t;
}
const blood = readPlane(MOD, 0x20a40cb7, 0);
const van = readPlane(VAN, 0x1f520cb7, 0);

// 原版 v15 中与边框连通的 = off-map 大三角填充，需排除
function borderConnected(val) {
  const seen = new Uint8Array(N); const q = [];
  for (let i = 0; i < N; i++) {
    const x = (i / H) | 0, y = i % H;
    if ((x === 0 || x === W - 1 || y === 0 || y === H - 1) && van[i] === val) { seen[i] = 1; q.push(i); }
  }
  while (q.length) {
    const c = q.pop(); const x = (c / H) | 0, y = c % H;
    for (const [dx, dy] of [[1,0],[-1,0],[0,1],[0,-1]]) {
      const nx = x + dx, ny = y + dy; if (nx<0||nx>=W||ny<0||ny>=H) continue;
      const ni = nx*H+ny; if (!seen[ni] && van[ni]===val){seen[ni]=1;q.push(ni);}
    }
  }
  return seen;
}
const van15border = borderConnected(15);

// 定义锚点集合
const anchors = {
  mtn:   i => van[i] === 15 && !van15border[i],   // 真山(不与边连通)
  forest:i => van[i] === 5,
  grass: i => van[i] === 0,
  waste: i => van[i] === 9,
  sea:   i => van[i] === 8,
  river: i => van[i] === 6 || van[i] === 7,
};
const anchorCount = {};
for (const k of Object.keys(anchors)) anchorCount[k] = 0;
for (let i = 0; i < N; i++) for (const k in anchors) if (anchors[k](i)) anchorCount[k]++;
console.log('锚点格数(原版):', JSON.stringify(anchorCount));

// 每个血色值在各锚点上的计数
const bvals = [...new Set(blood)].sort((a,b)=>a-b);
const inAnchor = {}; // b -> k -> count
for (const b of bvals){ inAnchor[b] = {}; for(const k in anchors) inAnchor[b][k]=0; }
const bTotal = {};
for (let i=0;i<N;i++){ const b=blood[i]; bTotal[b]=(bTotal[b]??0)+1; for(const k in anchors) if(anchors[k](i)) inAnchor[b][k]++; }

// 基线：锚点占全图比例
console.log('\n血色值  总数   | 富集度 lift (命中锚点/该值总数 ÷ 锚点/全图) >1 表示富集');
console.log('        真山  森林  草地  荒地  大海  江河');
for (const b of bvals){
  const tot = bTotal[b];
  const lift = k => { const base = anchorCount[k]/N; const hit = inAnchor[b][k]/tot; return base>0? hit/base : 0; };
  console.log(
    `  v${String(b).padStart(2)} ${String(tot).padStart(5)}  | `+
    [ 'mtn','forest','grass','waste','sea','river' ].map(k=>lift(k).toFixed(2).padStart(5)).join(' ')
  );
}
