// dump s11 建筑坐标表 (城市@0x3f4f×42 关@0x4243×10 港@0x42f7×35, 步长18)
// 对比: 原版 vs 血色 vs JSON(-28,-28)
const fs = require('fs');

const FILES = {
  原版: 'C:/san11/san11_原版/San11/Media/scenario/Scen000.s11',
  血色: 'C:/san11/xsyg/xsyg6/xsyg6/San11Pk/Media/scenario/SCEN000.S11',
};
const TABLES = [
  { key: 'city', name: '都市', off: 0x3f4f, count: 42 },
  { key: 'pass', name: '关', off: 0x4243, count: 10 },
  { key: 'port', name: '港', off: 0x42f7, count: 35 },
];

function readAll(p) {
  const fd = fs.openSync(p, 'r');
  const size = fs.fstatSync(fd).size;
  const buf = Buffer.alloc(size);
  fs.readSync(fd, buf, 0, size, 0);
  fs.closeSync(fd);
  return buf;
}

function readTable(buf, off, count) {
  const out = [];
  for (let k = 0; k < count; k++) {
    const o = off + k * 18;
    out.push({
      x: buf.readUInt16LE(o),
      y: buf.readUInt16LE(o + 2),
      hex: buf.slice(o, o + 18).toString('hex'),
    });
  }
  return out;
}

const data = {};
for (const [label, path] of Object.entries(FILES)) {
  const buf = readAll(path);
  data[label] = {};
  for (const t of TABLES) data[label][t.key] = readTable(buf, t.off, t.count);
}

// JSON
const j = JSON.parse(fs.readFileSync('D:/MyProjects/san11/tools/xsyg_map/Scenario1.json', 'utf8'));
const jBuildings = Object.values(j.citySet).sort((a, b) => a.Id - b.Id);
const jByType = t => jBuildings.filter(b => b.BuildingType === t);

// 逐类型对比
for (const t of TABLES) {
  console.log(`\n===== ${t.name} (${t.count}) =====`);
  const jList = jByType(t.key === 'city' ? 1 : t.key === 'pass' ? 2 : 3);
  console.log(`JSON 数量: ${jList.length}`);
  console.log('idx | 原版(x,y) | 血色(x,y) | 移动 | JSON名 → JSON-28 | 血色==JSON?');
  for (let k = 0; k < t.count; k++) {
    const v = data.原版[t.key][k];
    const b = data.血色[t.key][k];
    const moved = v.x !== b.x || v.y !== b.y ? '★移动' : '';
    const jb = jList[k];
    let jInfo = '(无)', jMatch = '';
    if (jb) {
      const jx = jb.x - 28, jy = jb.y - 28;
      jInfo = `${jb.Name} →(${jx},${jy})`;
      jMatch = (b.x === jx && b.y === jy) ? '✓' : `✗(差${b.x - jx},${b.y - jy})`;
    }
    console.log(`${String(k).padStart(2)} | (${v.x},${v.y}) | (${b.x},${b.y}) | ${moved.padEnd(3)} | ${jInfo} | ${jMatch}`);
  }
}

// JSON 内部重复坐标检查
console.log('\n===== JSON 重复坐标检查 =====');
const posMap = new Map();
for (const b of jBuildings) {
  const key = `${b.x},${b.y}`;
  if (!posMap.has(key)) posMap.set(key, []);
  posMap.get(key).push(b.Name);
}
for (const [pos, names] of posMap) {
  if (names.length > 1) console.log(`(${pos}): ${names.join(', ')}`);
}

// 血色 s11 表内重复坐标检查
console.log('\n===== 血色s11 表内重复坐标检查 =====');
for (const t of TABLES) {
  const seen = new Map();
  data.血色[t.key].forEach((p, k) => {
    const key = `${p.x},${p.y}`;
    if (!seen.has(key)) seen.set(key, []);
    seen.get(key).push(k);
  });
  for (const [pos, idxs] of seen) {
    if (idxs.length > 1) console.log(`${t.name} (${pos}): idx ${idxs.join(',')}`);
  }
}

// 结构字段观察: 打印前3个都市结构的 hex
console.log('\n===== 前3个都市结构 hex (18字节) =====');
for (const label of ['原版', '血色']) {
  console.log(label + ':');
  for (let k = 0; k < 3; k++) console.log(`  [${k}] ${data[label].city[k].hex}`);
}
