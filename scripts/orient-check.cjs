/**
 * 定朝向：血色 #4792 海(v11/v12/v17)与关键城市落在 q/x 还是 r/y 的哪一侧。
 * pkres cell i = x*200 + y。 记 q=x, r=y。
 */
const fs = require('fs');
const MOD = 'C:/san11/xsyg/xsyg6/xsyg6/San11Pk/Media/san11pkres.bin';
const N = 200*200, CELL = 11, HDR = 8, H = 200;
const fd = fs.openSync(MOD, 'r');
const buf = Buffer.alloc(HDR + N*CELL);
fs.readSync(fd, buf, 0, buf.length, 0x20a40cb7);
fs.closeSync(fd);
const p0 = new Uint8Array(N);
for (let i=0;i<N;i++) p0[i]=buf[HDR+i*CELL];
const SEA = new Set([11,12,17]);

// 海按 x(=q) 分箱 与 按 y(=r) 分箱
const byX = new Array(200).fill(0), byY = new Array(200).fill(0);
let seaN=0, sx=0, sy=0;
for (let i=0;i<N;i++){ if(SEA.has(p0[i])){ const x=(i/H)|0, y=i%H; byX[x]++; byY[y]++; seaN++; sx+=x; sy+=y; } }
console.log(`海格 ${seaN}, 平均 x=${(sx/seaN).toFixed(1)} y=${(sy/seaN).toFixed(1)} (0..199)`);
const dec = (a)=>{const r=[];for(let k=0;k<10;k++){let s=0;for(let j=k*20;j<k*20+20;j++)s+=a[j];r.push(s);}return r;};
console.log('海 按x分箱(每20):', dec(byX).join(' '));
console.log('海 按y分箱(每20):', dec(byY).join(' '));

// 关键城市 grid 坐标 (来自 S11 raw: idx=x*200+y)
const BLD='C:/san11/xsyg/xsyg6/xsyg6/San11Pk/Media/scenario/SCEN000.S11';
const s11=fs.readFileSync(BLD);
function readBld(off,c){const o=[];for(let k=0;k<c;k++){const p=off+k*18;o.push({x:s11.readUInt16LE(p),y:s11.readUInt16LE(p+2)});}return o;}
const scen=JSON.parse(fs.readFileSync('D:/MyProjects/san11/tools/xsyg_map/Scenario1.json','utf8'));
const names=Object.values(scen.citySet).filter(c=>c.BuildingType===1).map(c=>c.Name);
const raw=readBld(0x3f4f,42);
const show={'薊':'北京(北)','襄平':'辽宁(东北)','成都':'四川(西南)','金陵':'南京(东南)','南海':'岭南(南)','武威':'甘肃(西北)','会稽':'浙江(东南)','云中':'内蒙(北)'};
console.log('\n城市 grid(x,y) 及 p0值:');
for(let i=0;i<42;i++){ if(show[names[i]]){ const g=raw[i]; const v=p0[g.x*H+g.y]; console.log(`  ${names[i]}(${show[names[i]]}) x=${g.x} y=${g.y} p0=v${v} ${SEA.has(v)?'<<海!':''}`); } }
