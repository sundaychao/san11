/**
 * 协调坐标系：pkres 200x200 网格索引 = 原始 SCEN000.S11 坐标 还是 Scenario1.json 坐标-28 ?
 * 判据：都市应落在血色 p0 陆地(非海 v11/v12/v17)，港应临海。
 */
const fs = require('fs');
const MOD = 'C:/san11/xsyg/xsyg6/xsyg6/San11Pk/Media/san11pkres.bin';
const BLD_S11 = 'C:/san11/xsyg/xsyg6/xsyg6/San11Pk/Media/scenario/SCEN000.S11';
const JSON1 = 'D:/MyProjects/san11/tools/xsyg_map/Scenario1.json';
const N = 200 * 200, CELL = 11, HDR = 8, H = 200;

function readP0(file, off) {
  const fd = fs.openSync(file, 'r');
  const buf = Buffer.alloc(HDR + N * CELL);
  fs.readSync(fd, buf, 0, buf.length, off);
  fs.closeSync(fd);
  const t = new Uint8Array(N);
  for (let i = 0; i < N; i++) t[i] = buf[HDR + i * CELL];
  return t;
}
const blood = readP0(MOD, 0x20a40cb7);
const SEA = new Set([11, 12, 17]);

function readBld(buf, off, count) {
  const out = [];
  for (let k = 0; k < count; k++) { const o = off + k * 18; out.push({ x: buf.readUInt16LE(o), y: buf.readUInt16LE(o + 2) }); }
  return out;
}
const s11 = fs.readFileSync(BLD_S11);
const rawCities = readBld(s11, 0x3f4f, 42);
const rawPorts = readBld(s11, 0x42f7, 35);
const rawPasses = readBld(s11, 0x4243, 10);

const scen = JSON.parse(fs.readFileSync(JSON1, 'utf8'));
const js = Object.values(scen.citySet);
const jsCities = js.filter((c) => c.BuildingType === 1);
const jsPorts = js.filter((c) => c.BuildingType === 3);
const jsPasses = js.filter((c) => c.BuildingType === 2);
console.log(`Scenario1.json: 都市${jsCities.length} 港${jsPorts.length} 关${jsPasses.length}`);

// 打印前5个 S11 raw vs json，检查偏移关系
console.log('\nS11 raw city[0..4] :', rawCities.slice(0,5).map(c=>`(${c.x},${c.y})`).join(' '));
console.log('json    city[0..4] :', jsCities.slice(0,5).map(c=>`(${c.x},${c.y})`).join(' '));

function seaRatioAt(coords, gx, gy) {
  // 邻域(半径2)海占比
  let sea=0, tot=0;
  for(const {x,y} of coords){ const cx=gx(x), cy=gy(y);
    for(let dx=-2;dx<=2;dx++)for(let dy=-2;dy<=2;dy++){const nx=cx+dx,ny=cy+dy;if(nx<0||nx>=200||ny<0||ny>=200)continue;tot++;if(SEA.has(blood[nx*H+ny]))sea++;}
  }
  return sea/tot;
}
function cityOnSea(coords, gx, gy){ let on=0; for(const {x,y} of coords){const i=gx(x)*H+gy(y); if(i<0||i>=N) {on++;continue;} if(SEA.has(blood[i])) on++;} return on;}
function oob(coords, gx, gy){ let o=0; for(const {x,y} of coords){const cx=gx(x),cy=gy(y); if(cx<0||cx>=200||cy<0||cy>=200)o++;} return o;}

const models = [
  ['S11 raw (idx=x*200+y)', (x)=>x, (y)=>y, rawCities, rawPorts],
  ['S11 raw-28', (x)=>x-28, (y)=>y-28, rawCities, rawPorts],
  ['json raw (idx=x*200+y)', (x)=>x, (y)=>y, jsCities, jsPorts],
  ['json -28', (x)=>x-28, (y)=>y-28, jsCities, jsPorts],
];
console.log('\n模型                          越界  都市落海数/42  港邻海域占比');
for (const [name, gx, gy, cities, ports] of models) {
  const o = oob(cities, gx, gy);
  const onSea = cityOnSea(cities, gx, gy);
  // 港邻海：对每个港，取半径3内海占比，再平均
  let portSea = 0;
  for (const {x,y} of ports){ const cx=gx(x), cy=gy(y); let sea=0,tot=0;
    for(let dx=-3;dx<=3;dx++)for(let dy=-3;dy<=3;dy++){const nx=cx+dx,ny=cy+dy;if(nx<0||nx>=200||ny<0||ny>=200)continue;tot++;if(SEA.has(blood[nx*H+ny]))sea++;}
    if(tot>0) portSea+=sea/tot;
  }
  portSea/=ports.length;
  console.log(`${name.padEnd(28)} ${String(o).padStart(3)}   ${String(onSea).padStart(3)}/42        ${(portSea*100).toFixed(1)}%`);
}
