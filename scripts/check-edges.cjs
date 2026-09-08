/** 检查两张地图在两种索引方向下的四条边缘地形分布（判断朝向） */
const fs = require('fs');
const FILES = {
  mod: 'C:/san11/xsyg/xsyg6/xsyg6/San11Pk/Media/san11pkres.bin',
  vanilla: 'C:/san11/san11_原版/San11/Media/san11pkres.bin',
};
const HEADER = 8, CELLB = 11, N = 40000;

function readMap(file, off) {
  const fd = fs.openSync(file, 'r');
  const buf = Buffer.alloc(HEADER + N * CELLB);
  fs.readSync(fd, buf, 0, buf.length, off);
  fs.closeSync(fd);
  const t = new Uint8Array(N);
  for (let i = 0; i < N; i++) t[i] = buf[HEADER + i * CELLB];
  return t;
}

const vA = readMap(FILES.vanilla, 0x1f520cb7);
const mA = readMap(FILES.mod, 0x20a40cb7);

function dist(arr) {
  const d = {};
  for (const v of arr) d[v] = (d[v] ?? 0) + 1;
  return Object.entries(d).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([v, c]) => v + ':' + c).join(' ');
}

for (const [t, name] of [[vA, '原版A'], [mA, '血色槽1']]) {
  console.log('=== ' + name + ' ===');
  // 列主序: cell(x,y) = t[x*200+y]
  {
    const east = [], west = [], north = [], south = [];
    for (let y = 0; y < 200; y++) { east.push(t[199 * 200 + y]); west.push(t[0 * 200 + y]); }
    for (let x = 0; x < 200; x++) { north.push(t[x * 200 + 0]); south.push(t[x * 200 + 199]); }
    console.log(' 列主序: 东边:', dist(east));
    console.log(' 列主序: 西边:', dist(west));
    console.log(' 列主序: 北边:', dist(north));
    console.log(' 列主序: 南边:', dist(south));
  }
  // 行主序: cell(col,row) = t[row*200+col]
  {
    const east = [], west = [], north = [], south = [];
    for (let row = 0; row < 200; row++) { east.push(t[row * 200 + 199]); west.push(t[row * 200 + 0]); }
    for (let col = 0; col < 200; col++) { north.push(t[0 * 200 + col]); south.push(t[199 * 200 + col]); }
    console.log(' 行主序: 东边:', dist(east));
    console.log(' 行主序: 西边:', dist(west));
    console.log(' 行主序: 北边:', dist(north));
    console.log(' 行主序: 南边:', dist(south));
  }
}
