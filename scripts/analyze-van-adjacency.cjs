/**
 * 邻接分析 + 正确通行模型下的 42 城连通性验证。
 * 通行模型(对齐原版/sango表): 可走 = 0草地 1土 2砂地 3湿地 4毒泉 5森 9荒地
 *   10主径 11栈道 12渡所 13浅滩 16都市 17港 18关所 19小径
 * 不可走 = 6川 7河 8海 14岸 15崖
 */
const fs = require('fs');

const PKRES = 'C:/san11/san11_原版/San11/Media/san11pkres.bin';
const SCEN = 'C:/san11/san11_原版/San11/Media/scenario/Scen000.s11';
const MAP_OFFSET = 0x1f520cb7, W = 200, H = 200;
const CITY_REC = 0x3f4f, REC_STRIDE = 18;
const CITY_NAMES = ['襄平','北平','蓟','南皮','平原','晋阳','邺','北海','下邳','小沛','寿春','濮阳','陈留','许昌','汝南','洛阳','宛','长安','上庸','安定','天水','武威','建业','吴','会稽','庐江','柴桑','江夏','新野','襄阳','江陵','长沙','武陵','桂阳','零陵','永安','汉中','梓潼','江州','成都','建宁','云南'];
const NAMES = ['草地','土','砂地','湿地','毒泉','森','川','河','海','荒地','主径','栈道','渡所','浅滩','岸','崖','都市','港','关所','小径'];

const fd = fs.openSync(PKRES, 'r');
const buf = Buffer.alloc(8 + W * H * 11);
fs.readSync(fd, buf, 0, buf.length, MAP_OFFSET);
fs.closeSync(fd);
const t = new Uint8Array(W * H);
for (let i = 0; i < W * H; i++) t[i] = buf[8 + i * 11];
const at = (x, y) => t[x * H + y];

const sb = fs.readFileSync(SCEN);
const cities = CITY_NAMES.map((name, i) => ({ name, x: sb.readUInt16LE(CITY_REC + i * REC_STRIDE), y: sb.readUInt16LE(CITY_REC + i * REC_STRIDE + 2) }));

// ---- 邻接分析 ----
const HEX = [[1,0],[-1,0],[0,1],[0,-1],[1,-1],[-1,1]]; // odd-r 偏移的六邻域近似，用全部8向更稳
const DIRS = [[1,0],[-1,0],[0,1],[0,-1],[1,1],[1,-1],[-1,1],[-1,-1]];
console.log('== 各关键值的邻接构成 ==');
for (const v of [4, 6, 12, 13, 14, 17]) {
  const nb = {};
  let n = 0;
  for (let x = 0; x < W; x++) for (let y = 0; y < H; y++) {
    if (at(x, y) !== v) continue;
    n++;
    for (const [dx, dy] of DIRS) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || nx >= W || ny < 0 || ny >= H) continue;
      const nv = at(nx, ny);
      nb[NAMES[nv]] = (nb[NAMES[nv]] ?? 0) + 1;
    }
  }
  const top = Object.entries(nb).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([k, c]) => `${k}:${(c / (n * 8) * 100).toFixed(0)}%`).join(' ');
  console.log(`  ${NAMES[v]}(${n}格) 邻接: ${top}`);
}

// ---- 陆地与河/海是否直接相邻(不经岸) ----
let landAdjWater = 0;
const LAND = new Set([0, 1, 2, 3, 4, 5, 9, 10, 11, 12, 13, 16, 18, 19]);
for (let x = 0; x < W; x++) for (let y = 0; y < H; y++) {
  if (!LAND.has(at(x, y))) continue;
  if (DIRS.some(([dx, dy]) => { const nx = x + dx, ny = y + dy; return nx >= 0 && nx < W && ny >= 0 && ny < H && (at(nx, ny) === 7 || at(nx, ny) === 8); })) landAdjWater++;
}
console.log(`\n直接邻接河/海的陆地格: ${landAdjWater} (若>0 则部队可下水)`);

// ---- 连通性(正确通行模型) ----
const PASSABLE = new Set([0, 1, 2, 3, 4, 5, 9, 10, 11, 12, 13, 16, 17, 18, 19]);
const key = (x, y) => x * H + y;
const start = cities[0];
const seen = new Uint8Array(W * H);
const queue = [key(start.x, start.y)];
seen[key(start.x, start.y)] = 1;
while (queue.length) {
  const k = queue.shift();
  const x = (k / H) | 0, y = k % H;
  for (const [dx, dy] of DIRS) {
    const nx = x + dx, ny = y + dy;
    if (nx < 0 || nx >= W || ny < 0 || ny >= H) continue;
    const nk = key(nx, ny);
    if (seen[nk] || !PASSABLE.has(t[nk])) continue;
    seen[nk] = 1;
    queue.push(nk);
  }
}
const reached = cities.filter((c) => seen[key(c.x, c.y)]);
const missing = cities.filter((c) => !seen[key(c.x, c.y)]).map((c) => c.name);
console.log(`\n通行模型下可达城市: ${reached.length}/42`);
if (missing.length) console.log('不可达:', missing.join(', '));

// 若不可达: 尝试放宽 14岸 为可走(测试岸是否是隔断原因)
if (missing.length) {
  const P2 = new Set([...PASSABLE, 14]);
  const seen2 = new Uint8Array(W * H);
  const q2 = [key(start.x, start.y)];
  seen2[key(start.x, start.y)] = 1;
  while (q2.length) {
    const k = q2.shift();
    const x = (k / H) | 0, y = k % H;
    for (const [dx, dy] of DIRS) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || nx >= W || ny < 0 || ny >= H) continue;
      const nk = key(nx, ny);
      if (seen2[nk] || !P2.has(t[nk])) continue;
      seen2[nk] = 1;
      q2.push(nk);
    }
  }
  const r2 = cities.filter((c) => seen2[key(c.x, c.y)]);
  console.log(`放宽岸(14)可走后: ${r2.length}/42`, r2.length < 42 ? cities.filter((c) => !seen2[key(c.x, c.y)]).map((c) => c.name).join(', ') : '');
}
