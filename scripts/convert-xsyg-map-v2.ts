/**
 * 三国志11威力加强版 原版地图转换脚本 v2（细分地形精确版）
 *
 * 从原版 San11pkres.bin 的 SHEX0008 条目（200x200，每格 11 字节，p0=地形类型）
 * 逐值提取原版 20 种细分地形（语义经 sango_infinity Build/Content/Data/Common/
 * TerrainTypes.json 权威表核验：sango terrainType = 原版tType+1，39971/40000 格
 * 数值吻合，且各地形高度/水位/贴图统计一致），生成 china42x 系列地图文件：
 *   public/maps/china42x.json、src/game/scenario/china42x.json、
 *   public/maps/china42x.svg、public/maps/china42x.png（预览）
 *
 * 与 v1（convert-xsyg-map.ts → china42.json）的区别：
 *   - 20 值一一映射不再合并（v1 把 渡所/浅滩 归为山地、崖 归为平地等错误修正）；
 *   - 不再篡改城市周边地形（v1 会清出平地），完整保留原版数据；
 *   - 连通性验证采用原版通行模型：川/岸/崖不可走，河/海可下水泅渡。
 *
 * 用法: tsx scripts/convert-xsyg-map-v2.ts [原版san11pkres.bin路径]
 */
import { closeSync, mkdirSync, openSync, readFileSync, readSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { deflateSync } from 'node:zlib';
import { BLOCKED_TERRAINS, isWaterTerrain } from '../src/game/battle/catalog';
import { neighborsOf } from '../src/game/battle/grid';
import type { GridCell, TerrainType } from '../src/game/types';

const PKRES = process.argv[2] ?? 'C:/san11/san11_原版/San11/Media/san11pkres.bin';
const SCEN = 'C:/san11/san11_原版/San11/Media/scenario/Scen000.s11';

/** 原版 SHEX0008 地图条目（#4864，全文件唯一，即游戏实际加载的地形表） */
const MAP_OFFSET = 0x1f520cb7;
const MAP_SIZE = 440008; // 8 字节头 + 40000 格 × 11 字节
const WIDTH = 200;
const HEIGHT = 200;

/** Scen000.s11 建筑坐标记录（18 字节/条，u16LE x @+0, y @+2） */
const CITY_RECORD_OFFSET = 0x3f4f;
const PASS_RECORD_OFFSET = 0x4243;
const PORT_RECORD_OFFSET = 0x42f7;
const RECORD_STRIDE = 18;

/**
 * 原版 p0 → 游戏 TerrainType（20 值一一对应，语义经 sango TerrainTypes.json 核验）：
 *   0 草地 grass      1 土 plain       2 砂地 sand      3 湿地 wetland
 *   4 毒泉 poison     5 森 forest      6 川 stream(水面不可走) 7 河 river(可下水)
 *   8 海 sea(可下水)  9 荒地 wasteland 10 主径 road     11 栈道 plank
 *   12 渡所 ferry     13 浅滩 shallow  14 岸 shore(不可走)   15 崖 mountain(不可走)
 *   16 都市 construction  17 港 ferry(渡口据点)  18 关所 pass(关隘据点)  19 小径 path
 */
const RAW_TO_TERRAIN: Record<number, TerrainType> = {
  0: 'grass',
  1: 'plain',
  2: 'sand',
  3: 'wetland',
  4: 'poison',
  5: 'forest',
  6: 'stream',
  7: 'river',
  8: 'sea',
  9: 'wasteland',
  10: 'road',
  11: 'plank',
  12: 'ferry',
  13: 'shallow',
  14: 'shore',
  15: 'mountain',
  16: 'construction',
  17: 'ferry',
  18: 'pass',
  19: 'path',
};

/** 预期锚点地形值（校验名称表与坐标记录顺序对应） */
const EXPECTED_RAW: Record<'city' | 'pass' | 'port', number> = {
  city: 16,
  pass: 18,
  port: 17,
};

/** 原版 42 都市真名表（顺序与 Scen000.s11 都市记录逐条对应） */
const CITIES: Array<[traditional: string, label: string, id: string]> = [
  ['襄平', '襄平', 'xiangping'],
  ['北平', '北平', 'beiping'],
  ['薊', '蓟', 'ji'],
  ['南皮', '南皮', 'nanpi'],
  ['平原', '平原', 'pingyuan'],
  ['晉陽', '晋阳', 'jinyang'],
  ['鄴', '邺', 'ye'],
  ['北海', '北海', 'beihai'],
  ['下邳', '下邳', 'xiapi'],
  ['小沛', '小沛', 'xiaopei'],
  ['壽春', '寿春', 'shouchun'],
  ['濮陽', '濮阳', 'puyang'],
  ['陳留', '陈留', 'chenliu'],
  ['許昌', '许昌', 'xuchang'],
  ['汝南', '汝南', 'runan'],
  ['洛陽', '洛阳', 'luoyang'],
  ['宛', '宛', 'wan'],
  ['長安', '长安', 'changan'],
  ['上庸', '上庸', 'shangyong'],
  ['安定', '安定', 'anding'],
  ['天水', '天水', 'tianshui'],
  ['武威', '武威', 'wuwei'],
  ['建業', '建业', 'jianye'],
  ['吳', '吴', 'wu'],
  ['會稽', '会稽', 'kuaiji'],
  ['廬江', '庐江', 'lujiang'],
  ['柴桑', '柴桑', 'chaisang'],
  ['江夏', '江夏', 'jiangxia'],
  ['新野', '新野', 'xinye'],
  ['襄陽', '襄阳', 'xiangyang'],
  ['江陵', '江陵', 'jiangling'],
  ['長沙', '长沙', 'changsha'],
  ['武陵', '武陵', 'wuling'],
  ['桂陽', '桂阳', 'guiyang'],
  ['零陵', '零陵', 'lingling'],
  ['永安', '永安', 'yongan'],
  ['漢中', '汉中', 'hanzhong'],
  ['梓潼', '梓潼', 'zitong'],
  ['江州', '江州', 'jiangzhou'],
  ['成都', '成都', 'chengdu'],
  ['建寧', '建宁', 'jianning'],
  ['雲南', '云南', 'yunnan'],
];

/** 10 关所（id=拼音） */
const PASSES: Array<[traditional: string, label: string, id: string]> = [
  ['壺關', '壶关', 'huguan'],
  ['虎牢關', '虎牢关', 'hulaoguan'],
  ['潼關', '潼关', 'tongguan'],
  ['函谷關', '函谷关', 'hanguguan'],
  ['武關', '武关', 'wuguan'],
  ['陽平關', '阳平关', 'yangpingguan'],
  ['劍閣', '剑阁', 'jiange'],
  ['葭萌關', '葭萌关', 'jiamengguan'],
  ['涪水關', '涪水关', 'fushuiguan'],
  ['江油關', '江油关', 'jiangyouguan'],
];

/** 35 港口（id=拼音，去「港」后缀） */
const PORTS: Array<[traditional: string, label: string, id: string]> = [
  ['安平港', '安平港', 'anping'],
  ['高唐港', '高唐港', 'gaotang'],
  ['西河港', '西河港', 'xihe'],
  ['白馬港', '白马港', 'baima'],
  ['昌陽港', '昌阳港', 'changyang'],
  ['臨濟港', '临济港', 'linji'],
  ['海陵港', '海陵港', 'hailing'],
  ['江都港', '江都港', 'jiangdu'],
  ['濡須港', '濡须港', 'ruxu'],
  ['頓丘港', '顿丘港', 'dunqiu'],
  ['官渡港', '官渡港', 'guandu'],
  ['孟津港', '孟津港', 'mengjin'],
  ['解縣港', '解县港', 'xiexian'],
  ['新豐港', '新丰港', 'xinfeng'],
  ['夏陽港', '夏阳港', 'xiayang'],
  ['房陵港', '房陵港', 'fangling'],
  ['蕪湖港', '芜湖港', 'wuhu'],
  ['虎林港', '虎林港', 'hulin'],
  ['曲阿港', '曲阿港', 'que'],
  ['尋章港', '寻章港', 'xunzhang'],
  ['皖口港', '皖口港', 'wankou'],
  ['九江港', '九江港', 'jiujiang'],
  ['陸口港', '陆口港', 'lukou'],
  ['鄱陽港', '鄱阳港', 'poyang'],
  ['廬陵港', '庐陵港', 'luling'],
  ['夏口港', '夏口港', 'xiakou'],
  ['湖陽港', '湖阳港', 'huyang'],
  ['中廬港', '中庐港', 'zhonglu'],
  ['烏林港', '乌林港', 'wulin'],
  ['漢津港', '汉津港', 'hanjin'],
  ['江津港', '江津港', 'jiangjin'],
  ['羅縣港', '罗县港', 'luoxian'],
  ['洞庭港', '洞庭港', 'dongting'],
  ['公安港', '公安港', 'gongan'],
  ['巫縣港', '巫县港', 'wuxian'],
];

interface Building {
  label: string;
  q: number;
  r: number;
}

interface CitySeed {
  id: string;
  label: string;
  q: number;
  r: number;
  /** 原版建设用地坐标（interior 平面，按距城心由近到远排序） */
  interior: Array<[number, number]>;
}

/** 关所/港口锚点（原版据点，单格） */
interface StrongholdSeed {
  id: string;
  label: string;
  q: number;
  r: number;
}

function inBounds(q: number, r: number) {
  return q >= 0 && q < WIDTH && r >= 0 && r < HEIGHT;
}

// ---------------------------------------------------------------- 读取地形

/** 每格 11 字节的各平面偏移（explore-interior.cjs 已核验：+1=区域ID，+5=内政(建设用地)标记） */
const PLANE_OFFSETS = { tType: 0, areaId: 1, interior: 5 } as const;

function readMapPlanes(): { terrains: Uint8Array; areaId: Uint8Array; interior: Uint8Array; rawDist: Record<number, number> } {
  const fd = openSync(PKRES, 'r');
  const buf = Buffer.alloc(MAP_SIZE);
  readSync(fd, buf, 0, MAP_SIZE, MAP_OFFSET);
  closeSync(fd);

  const head = buf.toString('ascii', 0, 8);
  if (head !== 'SHEX0008') throw new Error(`地图条目头不是 SHEX0008: "${head}"`);

  const terrains = new Uint8Array(WIDTH * HEIGHT);
  const areaId = new Uint8Array(WIDTH * HEIGHT);
  const interior = new Uint8Array(WIDTH * HEIGHT);
  const rawDist: Record<number, number> = {};
  for (let i = 0; i < WIDTH * HEIGHT; i += 1) {
    terrains[i] = buf[8 + i * 11 + PLANE_OFFSETS.tType];
    areaId[i] = buf[8 + i * 11 + PLANE_OFFSETS.areaId];
    interior[i] = buf[8 + i * 11 + PLANE_OFFSETS.interior];
    rawDist[terrains[i]] = (rawDist[terrains[i]] ?? 0) + 1;
  }
  return { terrains, areaId, interior, rawDist };
}

/** 偏移(odd-q)坐标的六角格距离 */
function hexDistance(q1: number, r1: number, q2: number, r2: number): number {
  const aq = q1 - q2;
  const ar = (r1 - Math.floor(q1 / 2)) - (r2 - Math.floor(q2 / 2));
  return (Math.abs(aq) + Math.abs(ar) + Math.abs(aq + ar)) / 2;
}

/**
 * 提取每城建设用地坐标（原版 interior 平面，areaId 归属对应城市区域）：
 * 返回按距城心由近到远排序的 [q, r] 列表（每城 4~22 格，全部为「土」地形）。
 */
function extractInteriorCells(
  city: { q: number; r: number },
  areaId: Uint8Array,
  interior: Uint8Array,
): Array<[number, number]> {
  const myArea = areaId[city.q * HEIGHT + city.r];
  const cells: Array<[number, number]> = [];
  for (let q = 0; q < WIDTH; q += 1) {
    for (let r = 0; r < HEIGHT; r += 1) {
      if (interior[q * HEIGHT + r] === 0) continue;
      if (areaId[q * HEIGHT + r] !== myArea) continue;
      cells.push([q, r]);
    }
  }
  cells.sort((a, b) => (
    hexDistance(a[0], a[1], city.q, city.r) - hexDistance(b[0], b[1], city.q, city.r) ||
    a[0] - b[0] || a[1] - b[1]
  ));
  return cells;
}

// ---------------------------------------------------------------- 读取建筑坐标

function readBuildings(offset: number, count: number, labels: string[], type: 'city' | 'pass' | 'port'): Building[] {
  const buf = readFileSync(SCEN);
  const out: Building[] = [];
  for (let i = 0; i < count; i += 1) {
    const rec = offset + i * RECORD_STRIDE;
    const q = buf.readUInt16LE(rec);
    const r = buf.readUInt16LE(rec + 2);
    if (!inBounds(q, r)) throw new Error(`${type} #${i} (${q},${r}) 超出 200x200 网格`);
    out.push({ label: labels[i], q, r });
  }
  return out;
}

/** 校验建筑坐标全部落在预期锚点地形格上（名称表与记录顺序对应的铁证） */
function verifyAnchors(
  terrains: Uint8Array,
  groups: Array<{ type: 'city' | 'pass' | 'port'; buildings: Building[] }>,
): void {
  let bad = 0;
  for (const { type, buildings } of groups) {
    for (const b of buildings) {
      const v = terrains[b.q * HEIGHT + b.r];
      if (v !== EXPECTED_RAW[type]) {
        bad += 1;
        console.log(`  锚点异常: ${type} ${b.label} (${b.q},${b.r}) p0=${v} 预期 ${EXPECTED_RAW[type]}`);
      }
    }
  }
  const total = groups.reduce((n, g) => n + g.buildings.length, 0);
  console.log(`建筑锚点校验: ${total - bad}/${total} 命中预期地形值`);
  if (bad > 0) throw new Error(`${bad} 个建筑锚点不符，名称表与坐标记录可能错位`);
}

// ---------------------------------------------------------------- 生成 grid

function buildGrid(raw: Uint8Array): GridCell[] {
  const grid: GridCell[] = [];
  for (let x = 0; x < WIDTH; x += 1) {
    for (let y = 0; y < HEIGHT; y += 1) {
      const v = raw[x * HEIGHT + y];
      const terrain = RAW_TO_TERRAIN[v];
      if (!terrain) throw new Error(`未映射的原始地形值: ${v} @(${x},${y})`);
      grid.push({ q: x, r: y, terrain });
    }
  }
  return grid;
}

/** 城市中心格必须可通行（非川/岸/崖、非水面），原版坐标应精确落在都市格上（零修正） */
function placeCities(cities: CitySeed[], grid: GridCell[]): { placed: CitySeed[]; adjustments: string[] } {
  const cellAt = (q: number, r: number) => grid[q * HEIGHT + r];
  const usable = (q: number, r: number) => {
    if (!inBounds(q, r)) return false;
    const t = cellAt(q, r).terrain;
    return !BLOCKED_TERRAINS.has(t) && !isWaterTerrain(t);
  };

  const adjustments: string[] = [];
  const placed: CitySeed[] = [];

  for (const city of cities) {
    let { q, r } = city;
    if (!usable(q, r)) {
      let found = false;
      outer: for (let dist = 1; dist <= 6; dist += 1) {
        for (let dq = -dist; dq <= dist; dq += 1) {
          for (let dr = -dist; dr <= dist; dr += 1) {
            if (Math.max(Math.abs(dq), Math.abs(dr)) !== dist) continue;
            if (usable(city.q + dq, city.r + dr)) {
              adjustments.push(`${city.label} (${city.q},${city.r}) → (${city.q + dq},${city.r + dr})`);
              q = city.q + dq;
              r = city.r + dr;
              found = true;
              break outer;
            }
          }
        }
      }
      if (!found) throw new Error(`无法为城市 ${city.label} 找到可用位置`);
    }
    placed.push({ ...city, q, r });
  }
  return { placed: cities.map((c) => ({ ...c, q: placed.find((p) => p.label === c.label)!.q, r: placed.find((p) => p.label === c.label)!.r })), adjustments };
}

// ---------------------------------------------------------------- 连通性验证

/** 原版通行模型：川/岸/崖不可走；河/海可下水泅渡；渡所/浅滩直接通行 */
function verifyConnectivity(cities: CitySeed[], grid: GridCell[]): { reached: string[]; passableCount: number } {
  const cellMap = new Map(grid.map((cell) => [`${cell.q},${cell.r}`, cell]));
  const cityKeyByPos = new Map(cities.map((c) => [`${c.q},${c.r}`, c.label]));
  const passable = (cell: GridCell) => !BLOCKED_TERRAINS.has(cell.terrain);

  const seen = new Set<string>();
  const queue = [cities[0]];
  const reached: string[] = [];
  let passableCount = 0;
  while (queue.length > 0) {
    const cur = queue.shift()!;
    const k = `${cur.q},${cur.r}`;
    if (seen.has(k)) continue;
    seen.add(k);
    passableCount += 1;
    const label = cityKeyByPos.get(k);
    if (label) reached.push(label);
    for (const n of neighborsOf(cur.q, cur.r)) {
      const nk = `${n.q},${n.r}`;
      if (seen.has(nk)) continue;
      const cell = cellMap.get(nk);
      if (!cell || !passable(cell)) continue;
      queue.push({ ...n } as CitySeed);
    }
  }
  return { reached, passableCount };
}

// ---------------------------------------------------------------- SVG / PNG 渲染

const PALETTE: Record<TerrainType, [number, number, number]> = {
  grass: [106, 168, 79],
  plain: [139, 115, 85],
  sand: [222, 196, 120],
  wetland: [102, 158, 138],
  poison: [160, 60, 180],
  forest: [32, 96, 42],
  stream: [120, 180, 220],
  river: [48, 110, 180],
  sea: [20, 55, 120],
  wasteland: [168, 160, 110],
  road: [230, 200, 110],
  plank: [150, 90, 50],
  ferry: [255, 120, 40],
  shallow: [170, 210, 230],
  shore: [110, 95, 60],
  mountain: [55, 48, 48],
  pass: [150, 110, 55],
  construction: [255, 220, 60],
  path: [210, 180, 150],
  hill: [120, 110, 80],
  water: [40, 95, 185],
};

const rgb = ([r, g, b]: [number, number, number]) => `#${[r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')}`;

function renderSvg(grid: GridCell[], cities: CitySeed[]): string {
  const CELL = 4;
  const cellsSvg = grid.map((cell) => {
    const x = cell.q * CELL;
    const y = cell.r * CELL + (cell.q % 2 === 0 ? -CELL / 2 : 0);
    return `<rect x="${x}" y="${y}" width="${CELL}" height="${CELL}" fill="${rgb(PALETTE[cell.terrain])}"/>`;
  });
  const citiesSvg = cities.flatMap((city) => {
    const x = city.q * CELL;
    const y = city.r * CELL + (city.q % 2 === 0 ? -CELL / 2 : 0);
    return [
      `<rect x="${x - 3}" y="${y - 3}" width="12" height="12" fill="none" stroke="#ff4b4b" stroke-width="1.6"/>`,
      `<text x="${x + 8}" y="${y + 3}" fill="#ffffff" font-size="9" stroke="#000" stroke-width="0.6" paint-order="stroke">${city.label}</text>`,
    ];
  });
  const w = WIDTH * CELL;
  const h = HEIGHT * CELL + CELL / 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}"><rect width="${w}" height="${h}" fill="#0d1117"/>${cellsSvg.join('')}${citiesSvg.join('')}</svg>`;
}

function crc32(buf: Buffer) {
  let c: number;
  const table: number[] = [];
  for (let n = 0; n < 256; n += 1) {
    c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  let crc = 0xffffffff;
  for (const b of buf) crc = table[(crc ^ b) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Buffer) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const typeData = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typeData));
  return Buffer.concat([len, typeData, crc]);
}

function renderPng(grid: GridCell[], cities: CitySeed[], scale: number): Buffer {
  const px: [number, number, number][] = new Array(WIDTH * HEIGHT);
  for (const cell of grid) px[cell.r * WIDTH + cell.q] = PALETTE[cell.terrain];
  for (const city of cities) px[city.r * WIDTH + city.q] = [255, 40, 40];

  const pw = WIDTH * scale;
  const ph = HEIGHT * scale;
  const raw = Buffer.alloc(ph * (pw * 3 + 1));
  for (let y = 0; y < ph; y += 1) {
    raw[y * (pw * 3 + 1)] = 0;
    for (let x = 0; x < pw; x += 1) {
      const [r, g, b] = px[((y / scale) | 0) * HEIGHT + ((x / scale) | 0)];
      const o = y * (pw * 3 + 1) + 1 + x * 3;
      raw[o] = r;
      raw[o + 1] = g;
      raw[o + 2] = b;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(pw, 0);
  ihdr.writeUInt32BE(ph, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // truecolor
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(raw)),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

// ---------------------------------------------------------------- 主流程

function main() {
  console.log(`读取地形: ${PKRES}`);
  const { terrains, areaId, interior, rawDist } = readMapPlanes();
  console.log('原始地形分布:', rawDist);

  console.log(`读取建筑坐标: ${SCEN}`);
  const cityBuildings = readBuildings(CITY_RECORD_OFFSET, CITIES.length, CITIES.map((c) => c[1]), 'city');
  const passBuildings = readBuildings(PASS_RECORD_OFFSET, PASSES.length, PASSES.map((p) => p[1]), 'pass');
  const portBuildings = readBuildings(PORT_RECORD_OFFSET, PORTS.length, PORTS.map((p) => p[1]), 'port');
  verifyAnchors(terrains, [
    { type: 'city', buildings: cityBuildings },
    { type: 'pass', buildings: passBuildings },
    { type: 'port', buildings: portBuildings },
  ]);
  const passSeeds: StrongholdSeed[] = passBuildings.map((b, i) => ({ id: PASSES[i][2], label: b.label, q: b.q, r: b.r }));
  const portSeeds: StrongholdSeed[] = portBuildings.map((b, i) => ({ id: PORTS[i][2], label: b.label, q: b.q, r: b.r }));
  console.log(`关所 ${passSeeds.length} 处、港口 ${portSeeds.length} 处已写入 passes/ports 锚点表`);

  const grid = buildGrid(terrains);

  const seeds: CitySeed[] = cityBuildings.map((b, i) => ({
    id: CITIES[i][2],
    label: b.label,
    q: b.q,
    r: b.r,
    interior: extractInteriorCells(b, areaId, interior),
  }));
  const missingInterior = seeds.filter((c) => c.interior.length === 0).map((c) => c.label);
  if (missingInterior.length > 0) throw new Error(`以下城市没有提取到建设用地: ${missingInterior.join(', ')}`);
  const interiorTotal = seeds.reduce((sum, c) => sum + c.interior.length, 0);
  console.log(`建设用地(interior): 42 城共 ${interiorTotal} 格（${Math.min(...seeds.map((c) => c.interior.length))}~${Math.max(...seeds.map((c) => c.interior.length))} 格/城）`);
  const { placed: cities, adjustments } = placeCities(seeds, grid);
  if (adjustments.length > 0) {
    console.log('城市位置修正:');
    for (const line of adjustments) console.log(`  ${line}`);
  } else {
    console.log('城市位置: 42/42 精确落位，无需修正');
  }

  const { reached, passableCount } = verifyConnectivity(cities, grid);
  console.log(`\n通行模型(川/岸/崖不可走, 河/海可下水)下连通城市: ${reached.length}/42 (可走格 ${passableCount})`);
  if (reached.length !== cities.length) {
    const missing = cities.filter((c) => !reached.includes(c.label)).map((c) => c.label);
    console.log('未连通的城市:', missing.join(', '));
  }

  const payload = {
    schemaVersion: 1,
    width: WIDTH,
    height: HEIGHT,
    backgroundImage: '',
    grid,
    cities,
    passes: passSeeds,
    ports: portSeeds,
  };

  const outDir = resolve(process.cwd(), 'public/maps');
  mkdirSync(outDir, { recursive: true });
  const jsonPath = resolve(outDir, 'china42x.json');
  writeFileSync(jsonPath, JSON.stringify(payload), 'utf8');
  const srcJsonPath = resolve(process.cwd(), 'src/game/scenario/china42x.json');
  writeFileSync(srcJsonPath, JSON.stringify(payload), 'utf8');
  const svgPath = resolve(outDir, 'china42x.svg');
  writeFileSync(svgPath, renderSvg(grid, cities), 'utf8');
  const pngPath = resolve(outDir, 'china42x.png');
  writeFileSync(pngPath, renderPng(grid, cities, 4), 'utf8');

  const counts = grid.reduce((tally, cell) => {
    tally[cell.terrain] = (tally[cell.terrain] ?? 0) + 1;
    return tally;
  }, {} as Record<string, number>);
  console.log('\n地形统计:', counts);
  console.log(`已生成: ${jsonPath}`);
  console.log(`已生成: ${srcJsonPath}`);
  console.log(`已生成: ${svgPath}`);
  console.log(`已生成: ${pngPath}`);
}

main();
