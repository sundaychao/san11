/** 通行假设矩阵：找出让 42 城全连通的原版通行规则 */
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

const sb = fs.readFileSync(SCEN);
const cities = CITY_NAMES.map((name, i) => ({ name, x: sb.readUInt16LE(CITY_REC + i * REC_STRIDE), y: sb.readUInt16LE(CITY_REC + i * REC_STRIDE + 2) }));

const DIRS = [[1,0],[-1,0],[0,1],[0,-1],[1,1],[1,-1],[-1,1],[-1,-1]];
function bfs(passSet) {
  const seen = new Uint8Array(W * H);
  const q = [cities[0].x * H + cities[0].y];
  seen[q[0]] = 1;
  while (q.length) {
    const k = q.pop();
    const x = (k / H) | 0, y = k % H;
    for (const [dx, dy] of DIRS) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || nx >= W || ny < 0 || ny >= H) continue;
      const nk = nx * H + ny;
      if (seen[nk] || !passSet.has(t[nk])) continue;
      seen[nk] = 1; q.push(nk);
    }
  }
  return cities.filter((c) => seen[c.x * H + c.y]);
}

const LAND = [0, 1, 2, 3, 4, 5, 9, 10, 11, 12, 13, 16, 17, 18, 19];
const mk = (...extra) => new Set([...LAND, ...extra]);
const tests = [
  ['H5 原版严格(崖/川/河/海/岸均不可走)', mk()],
  ['H6 +川可走', mk(6)],
  ['H7 +崖可走', mk(15)],
  ['H8 +川+崖', mk(6, 15)],
  ['H9 +河+海(全部水面可走)+崖', mk(6, 7, 8, 15)],
  ['H10 +川+河+海(全部水面)', mk(6, 7, 8)],
  ['H11 全部可走', mk(6, 7, 8, 14, 15)],
  ['H12 +川+岸', mk(6, 14)],
];
for (const [name, set] of tests) {
  const r = bfs(set);
  console.log(`${name}: ${r.length}/42${r.length < 42 ? ' 缺:' + cities.filter((c) => !r.includes(c)).map((c) => c.name).slice(0, 8).join(',') + (r.length < 34 ? '...' : '') : ' ✓'}`);
}
