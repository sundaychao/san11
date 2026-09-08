/**
 * 精化解码血色 #4792 p0 地形值，排除 off-map 污染。
 * 步骤：
 *  1) 血色 off-map 背景值 = 四角 + 边框众数
 *  2) 原版 off-map = v15 且位于四角大三角（与边框连通）
 *  3) 混淆矩阵仅在 "双方都 on-map" 的格上统计 -> 干净的土地类别
 *  4) 每个血色值做连通块形状统计（细长=江/路，肥大=山/原）
 *  5) 渲染：血色背景值涂白，便于看清真实地理
 */
const fs = require('fs');
const zlib = require('zlib');

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
const blood = readPlane(MOD, 0x20a40cb7, 0); // #4792 重写
const van = readPlane(VAN, 0x1f520cb7, 0); // 原版 #4792

// ---- 1) 血色背景值：四角+边框众数 ----
const edgeCnt = new Map();
for (let i = 0; i < N; i++) {
  const x = (i / H) | 0, y = i % H;
  if (x === 0 || x === W - 1 || y === 0 || y === H - 1) {
    const b = blood[i];
    edgeCnt.set(b, (edgeCnt.get(b) ?? 0) + 1);
  }
}
const bloodBg = [...edgeCnt.entries()].sort((a, b) => b[1] - a[1])[0][0];
console.log(`血色背景(off-map)值 = v${bloodBg}  边框出现${[...edgeCnt.entries()].sort((a,b)=>b[1]-a[1]).slice(0,4).map(([v,c])=>`v${v}:${c}`).join(' ')}`);

// 与背景值连通的格也算 off-map（洪水填充）
const offmap = new Uint8Array(N);
{
  const q = [];
  for (let i = 0; i < N; i++) {
    const x = (i / H) | 0, y = i % H;
    if ((x === 0 || x === W - 1 || y === 0 || y === H - 1) && blood[i] === bloodBg) { offmap[i] = 1; q.push(i); }
  }
  while (q.length) {
    const c = q.pop(); const x = (c / H) | 0, y = c % H;
    for (const [dx, dy] of [[1,0],[-1,0],[0,1],[0,-1]]) {
      const nx = x + dx, ny = y + dy;
      if (nx<0||nx>=W||ny<0||ny>=H) continue;
      const ni = nx*H+ny;
      if (!offmap[ni] && blood[ni]===bloodBg){ offmap[ni]=1; q.push(ni); }
    }
  }
}
console.log(`血色 off-map 格数 = ${offmap.reduce((s,v)=>s+v,0)} / ${N}  (${Math.round(offmap.reduce((s,v)=>s+v,0)/N*100)}%)`);

// ---- 原版值语义 ----
const VAN_NAME = {0:'草地',1:'土地',2:'砂地',3:'湿地',4:'毒泉',5:'森林',6:'江河',7:'河道',8:'大海',9:'荒地',10:'道路',11:'栈道',12:'桥',13:'渡所',14:'岸',15:'山崖',16:'都市',17:'港',18:'关所',19:'间道'};
const VAN_CAT = {0:'plain',1:'plain',2:'sand',3:'wet',4:'plain',5:'forest',6:'river',7:'river',8:'sea',9:'plain',10:'road',11:'road',12:'road',13:'ferry',14:'coast',15:'mountain',16:'city',17:'port',18:'pass',19:'road'};

// ---- 3) 干净混淆矩阵：仅 blood on-map 的格 ----
const conf = new Map();
for (let i = 0; i < N; i++) {
  if (offmap[i]) continue;
  const b = blood[i];
  if (!conf.has(b)) conf.set(b, new Map());
  const m = conf.get(b);
  m.set(van[i], (m.get(van[i]) ?? 0) + 1);
}
console.log('\n== 血色值 -> 原版类别分布 (排除血色 off-map) ==');
const bvals = [...conf.keys()].sort((a,b)=>a-b);
const catOf = {};
for (const b of bvals) {
  const m = conf.get(b);
  const total = [...m.values()].reduce((s,v)=>s+v,0);
  const cat = {};
  for (const [vv,c] of m){ const k=VAN_CAT[vv]??'?'; cat[k]=(cat[k]??0)+c; }
  const byCat=Object.entries(cat).sort((a,b)=>b[1]-a[1]);
  catOf[b]={total, byCat};
}

// ---- 4) 连通块形状统计（全图，含细长比） ----
function blobStats(target){
  const seen=new Uint8Array(N); const sizes=[]; let thin=0, fat=0;
  let maxElong=0;
  for(let i=0;i<N;i++){
    if(blood[i]!==target||seen[i])continue;
    const q=[i]; seen[i]=1; const cells=[];
    while(q.length){const c=q.pop();cells.push(c);const x=(c/H)|0,y=c%H;
      for(const[dx,dy]of[[1,0],[-1,0],[0,1],[0,-1]]){const nx=x+dx,ny=y+dy;
        if(nx<0||nx>=W||ny<0||ny>=H)continue;const ni=nx*H+ny;
        if(!seen[ni]&&blood[ni]===target){seen[ni]=1;q.push(ni);}}}
    sizes.push(cells.length);
    if(cells.length>=4){
      let minx=999,maxx=-1,miny=999,maxy=-1;
      for(const c of cells){const x=(c/H)|0,y=c%H;if(x<minx)minx=x;if(x>maxx)maxx=x;if(y<miny)miny=y;if(y>maxy)maxy=y;}
      const bbw=maxx-minx+1,bbh=maxy-miny+1;
      const fill=cells.length/(bbw*bbh); // 填充率低 => 细长/蜿蜒
      if(fill<0.25)thin++; else if(fill>0.5)fat++;
      const el=Math.max(bbw,bbh)/Math.max(1,Math.min(bbw,bbh));
      if(el>maxElong)maxElong=el;
    }
  }
  const total=sizes.reduce((s,v)=>s+v,0);
  const maxB=Math.max(...sizes,0);
  return {n:sizes.length,total,maxB,thin,fat,maxElong};
}

console.log('b  总数  主导原版类别        次类            blob数 最大 细长 肥大 延伸比  top3原版值');
for(const b of bvals){
  const {total,byCat}=catOf[b];
  const st=blobStats(b);
  const m=conf.get(b);
  const topVan=[...m.entries()].sort((a,b)=>b[1]-a[1]).slice(0,3).map(([vv,c])=>`${vv}${VAN_NAME[vv]}:${Math.round(c/total*100)}%`).join(' ');
  console.log(`${String(b).padStart(2)} ${String(total).padStart(5)}  ${byCat[0][0].padEnd(6)}(${String(byCat[0][1]).padStart(2)}%)  ${(byCat[1]?byCat[1][0]+'('+byCat[1][1]+'%)':'').padEnd(12)} ${String(st.n).padStart(5)} ${String(st.maxB).padStart(4)} ${String(st.thin).padStart(4)} ${String(st.fat).padStart(4)}  ${st.maxElong.toFixed(1).padStart(5)}   ${topVan}`);
}

// ---- 5) 渲染：off-map 涂白，其余按原版主导类别着色 ----
const CAT_COLOR={sea:[30,90,190],river:[90,150,220],coast:[150,190,210],mountain:[70,70,70],forest:[40,120,50],road:[200,170,90],ferry:[220,150,70],sand:[220,200,140],wet:[120,170,150],plain:[150,165,120],city:[255,60,60],port:[60,220,220],pass:[255,160,0]};
function crc32(buf){let c,table=[];for(let n=0;n<256;n++){c=n;for(let k=0;k<8;k++)c=c&1?0xedb88320^(c>>>1):c>>>1;table[n]=c>>>0;}let crc=0xffffffff;for(const b of buf)crc=table[(crc^b)&0xff]^(crc>>>8);return(crc^0xffffffff)>>>0;}
function chunk(type,data){const len=Buffer.alloc(4);len.writeUInt32BE(data.length);const td=Buffer.concat([Buffer.from(type),data]);const crc=Buffer.alloc(4);crc.writeUInt32BE(crc32(td));return Buffer.concat([len,td,crc]);}
function writePNG(path,px,w,h,scale){const W=w*scale,H=h*scale;const raw=Buffer.alloc(H*(W*3+1));for(let y=0;y<H;y++){raw[y*(W*3+1)]=0;for(let x=0;x<W;x++){const[r,g,b]=px[((y/scale)|0)*w+((x/scale)|0)];const o=y*(W*3+1)+1+x*3;raw[o]=r;raw[o+1]=g;raw[o+2]=b;}}const ihdr=Buffer.alloc(13);ihdr.writeUInt32BE(W,0);ihdr.writeUInt32BE(H,4);ihdr[8]=8;ihdr[9]=2;fs.writeFileSync(path,Buffer.concat([Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]),chunk('IHDR',ihdr),chunk('IDAT',zlib.deflateSync(raw)),chunk('IEND',Buffer.alloc(0))]));console.log('写入',path);}
const px=new Array(N);
for(let i=0;i<N;i++){const x=(i/H)|0,y=i%H;
  if(offmap[i]){px[x*200+y]=[245,245,245];}
  else{const a=catOf[blood[i]];px[x*200+y]=a?CAT_COLOR[a.byCat[0][0]]??[255,0,255]:[255,0,255];}
}
writePNG('tools/xsyg_map/blood-refine.png',px,200,200,4);
