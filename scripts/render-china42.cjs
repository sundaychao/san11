/**
 * 渲染生成的 china42.json 为 PNG，验证地理与朝向。
 * grid cell {q,r,terrain}; 输出像素 (px,py)=(q,r): 右=东, 下=南。
 * 叠加城市标签(黄圈)。
 */
const fs = require('fs');
const zlib = require('zlib');
const data = JSON.parse(fs.readFileSync('public/maps/china42.json', 'utf8'));
const W = data.width, H = data.height;
const COLOR = {
  plain: [150, 165, 120], road: [200, 170, 90], forest: [40, 120, 50],
  hill: [120, 110, 80], mountain: [70, 70, 70], water: [40, 95, 185],
  ferry: [220, 150, 70], construction: [150, 150, 150],
};
// grid: q=东西(列/screen x), r=南北(行/screen y)。海在高 q(东)。
const px = new Array(W * H);
const idx = new Map();
for (const c of data.grid) { idx.set(c.q + ',' + c.r, c.terrain); px[c.r * W + c.q] = COLOR[c.terrain] ?? [255, 0, 255]; }
// 城市红点
for (const c of data.cities) { px[c.r * W + c.q] = [240, 60, 60]; }

function crc32(buf){let c,table=[];for(let n=0;n<256;n++){c=n;for(let k=0;k<8;k++)c=c&1?0xedb88320^(c>>>1):c>>>1;table[n]=c>>>0;}let crc=0xffffffff;for(const b of buf)crc=table[(crc^b)&0xff]^(crc>>>8);return(crc^0xffffffff)>>>0;}
function chunk(type,d){const len=Buffer.alloc(4);len.writeUInt32BE(d.length);const td=Buffer.concat([Buffer.from(type),d]);const crc=Buffer.alloc(4);crc.writeUInt32BE(crc32(td));return Buffer.concat([len,td,crc]);}
const scale = 4, PW = W*scale, PH = H*scale;
const raw = Buffer.alloc(PH*(PW*3+1));
for (let y=0;y<PH;y++){ raw[y*(PW*3+1)]=0; for(let x=0;x<PW;x++){ const [r,g,b]=px[((y/scale)|0)*H+((x/scale)|0)]; const o=y*(PW*3+1)+1+x*3; raw[o]=r;raw[o+1]=g;raw[o+2]=b; } }
const ihdr=Buffer.alloc(13);ihdr.writeUInt32BE(PW,0);ihdr.writeUInt32BE(PH,4);ihdr[8]=8;ihdr[9]=2;
fs.writeFileSync('tools/xsyg_map/china42-render.png', Buffer.concat([Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]),chunk('IHDR',ihdr),chunk('IDAT',zlib.deflateSync(raw)),chunk('IEND',Buffer.alloc(0))]));
console.log('写入 tools/xsyg_map/china42-render.png', `${data.cities.length} cities`);
