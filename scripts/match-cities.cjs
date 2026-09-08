/**
 * 确认 Scenario1.json 城市顺序 与 SCEN000.S11 raw 记录顺序 是否一一对应，
 * 从而可以用 json 提供 名字、raw 提供 精确坐标。
 */
const fs = require('fs');
const BLD_S11 = 'C:/san11/xsyg/xsyg6/xsyg6/San11Pk/Media/scenario/SCEN000.S11';
const JSON1 = 'D:/MyProjects/san11/tools/xsyg_map/Scenario1.json';
function readBld(buf, off, count, t) {
  const out = [];
  for (let k = 0; k < count; k++) { const o = off + k * 18; out.push({ t, x: buf.readUInt16LE(o), y: buf.readUInt16LE(o + 2), o }); }
  return out;
}
const s11 = fs.readFileSync(BLD_S11);
const rawAll = [
  ...readBld(s11, 0x3f4f, 42, 'city'),
  ...readBld(s11, 0x4243, 10, 'pass'),
  ...readBld(s11, 0x42f7, 35, 'port'),
];
const scen = JSON.parse(fs.readFileSync(JSON1, 'utf8'));
const jsAll = Object.values(scen.citySet).map(c=>c); // keep order
const jsCity = jsAll.filter(c=>c.BuildingType===1);
const jsPass = jsAll.filter(c=>c.BuildingType===2);
const jsPort = jsAll.filter(c=>c.BuildingType===3);
const rawCity = rawAll.filter(r=>r.t==='city');
const rawPass = rawAll.filter(r=>r.t==='pass');
const rawPort = rawAll.filter(r=>r.t==='port');

function cmp(name, jsArr, rawArr) {
  console.log(`\n== ${name}: json ${jsArr.length} vs raw ${rawArr.length} (json-28 vs raw) ==`);
  let diffs = 0;
  for (let i=0;i<Math.min(jsArr.length,rawArr.length);i++){
    const jx=jsArr[i].x-28, jy=jsArr[i].y-28;
    const rx=rawArr[i].x, ry=rawArr[i].y;
    const match = jx===rx && jy===ry;
    if(!match) diffs++;
    if(!match || i<3) console.log(`  [${i}] ${jsArr[i].Name.padEnd(4)} json-28=(${jx},${jy}) raw=(${rx},${ry}) ${match?'OK':'<== DIFF'}`);
  }
  console.log(`  差异数: ${diffs}/${Math.min(jsArr.length,rawArr.length)}`);
}
cmp('都市', jsCity, rawCity);
cmp('关所', jsPass, rawPass);
cmp('港', jsPort, rawPort);
