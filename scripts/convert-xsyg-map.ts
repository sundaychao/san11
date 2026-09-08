/**
 * 三国志11 原版地图转换脚本
 *
 * 从原版 San11pkres.bin 中提取 SHEX0008 地形数据（200x200，每格 11 字节），
 * 结合 Scen000.s11 的建筑坐标记录与 Scenario.s11 中提取的 Big5 真名表
 * （42 都市 / 10 关所 / 35 港口），转换为本项目的地图 JSON 格式，
 * 写入 public/maps/china42.json、src/game/scenario/china42.json
 * 与 public/maps/china42.svg（游戏静态导入 china42.json）。
 *
 * 用法: tsx scripts/convert-xsyg-map.ts [原版san11pkres.bin路径]
 *
 * 坐标系: 原版场景坐标与地形网格一一对应，q = x, r = y（x=东, y=南，
 *   网格 idx = x*200+y，无偏移）。已验证：42 都市全部落在 p0=16(城址)、
 *   10 关所全部落在 p0=18(关所)、35 港口全部落在 p0=17(港口)，
 *   且 Scenario.s11 名称表顺序与 Scen000.s11 记录顺序逐条对应。
 *
 * 地形映射: 原版 p0 为 20 值调色板，语义经逐值遮罩图（tools/xsyg_map/
 *   van-m*.png）核验：v10=全国道路网、v11=蜀地栈道、v19=山崖，
 *   与游戏内地形 8 值一一对应。
 */
import { closeSync, mkdirSync, openSync, readFileSync, readSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { neighborsOf } from '../src/game/battle/grid';
import type { GridCell, TerrainType } from '../src/game/types';

const PKRES = process.argv[2] ?? 'C:/san11/san11_原版/San11/Media/san11pkres.bin';
const SCEN = 'C:/san11/san11_原版/San11/Media/scenario/Scen000.s11';

/** 原版 SHEX0008 地图条目（#4864，全文件唯一，即游戏实际加载的地形表） */
const MAP_OFFSET = 0x1f520cb7;
const MAP_SIZE = 440008; // 8 字节头 + 40000 格 × 11 字节
const WIDTH = 200;
const HEIGHT = 200;

/** Scen000.s11 建筑坐标记录（18 字节/条，u16LE x @+0, y @+2, 类型标记 @+4） */
const CITY_RECORD_OFFSET = 0x3f4f;
const PASS_RECORD_OFFSET = 0x4243;
const PORT_RECORD_OFFSET = 0x42f7;
const RECORD_STRIDE = 18;

/**
 * 原版 p0 地形 → 游戏 TerrainType（20 值，全部经遮罩图/锚点核验）：
 *   0  平原(基础)      1  平原变体      2  丘陵        3  丘陵变体
 *   4  森林(西南丛林)  5  森林          6  山地        7  水域(江河)
 *   8  水域(海洋)      9  平原(荒地)   10  道路(全国路网, 遮罩核验)
 *  11  道路(蜀地栈道, 遮罩核验)       12 山地变体   13 山地变体
 *  14 水域(浅滩/泽)   15 平原(主陆地) 16 建造用地(城址)
 *  17 渡口(港口)      18 建造用地(关所)
 *  19 山地(山崖, 遮罩核验)
 */
const RAW_TO_TERRAIN: Record<number, TerrainType> = {
  0: 'plain',
  1: 'plain',
  2: 'hill',
  3: 'hill',
  4: 'forest',
  5: 'forest',
  6: 'mountain',
  7: 'water',
  8: 'water',
  9: 'plain',
  10: 'road',
  11: 'road',
  12: 'mountain',
  13: 'mountain',
  14: 'water',
  15: 'plain',
  16: 'construction',
  17: 'ferry',
  18: 'construction',
  19: 'mountain',
};

/** 预期锚点地形值（校验名称表与坐标记录顺序对应） */
const EXPECTED_RAW: Record<'city' | 'pass' | 'port', number> = {
  city: 16,
  pass: 18,
  port: 17,
};

/**
 * 原版 42 都市真名表（Big5 名 / 简体显示名 / 拼音 slug），
 * 顺序与 Scen000.s11 都市记录逐条对应。
 * 名称提取自 Scenario.s11 @0x5a（步长 25，含单字名 蓟/邺/宛/吴）。
 */
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

/** 10 关所（Scenario.s11 @0x474 步长 26；第 10 条字节损坏，名为史实 江油关） */
const PASSES = ['壶关', '虎牢关', '潼关', '函谷关', '武关', '阳平关', '剑阁', '葭萌关', '涪水关', '江油关'];

/** 35 港口（Scenario.s11 @0x578 步长 26；官渡港/寻章港首字为 CP950 扩展字节） */
const PORTS = [
  '安平港', '高唐港', '西河港', '白马港', '昌阳港', '临济港', '海陵港', '江都港', '濡须港',
  '顿丘港', '官渡港', '孟津港', '解县港', '新丰港', '夏阳港', '房陵港', '芜湖港', '虎林港',
  '曲阿港', '寻章港', '皖口港', '九江港', '陆口港', '鄱阳港', '庐陵港', '夏口港', '湖阳港',
  '中庐港', '乌林港', '汉津港', '江津港', '罗县港', '洞庭港', '公安港', '巫县港',
];

interface Building {
  label: string;
  q: number;
  r: number;
}

function inBounds(q: number, r: number) {
  return q >= 0 && q < WIDTH && r >= 0 && r < HEIGHT;
}

// ---------------------------------------------------------------- 读取地形

function readTerrain(): { terrains: Uint8Array; rawDist: Record<number, number> } {
  const fd = openSync(PKRES, 'r');
  const buf = Buffer.alloc(MAP_SIZE);
  readSync(fd, buf, 0, MAP_SIZE, MAP_OFFSET);
  closeSync(fd);

  const head = buf.toString('ascii', 0, 8);
  if (head !== 'SHEX0008') throw new Error(`地图条目头不是 SHEX0008: "${head}"`);

  const terrains = new Uint8Array(WIDTH * HEIGHT);
  const rawDist: Record<number, number> = {};
  for (let i = 0; i < WIDTH * HEIGHT; i += 1) {
    const raw = buf[8 + i * 11]; // tType
    terrains[i] = raw;
    rawDist[raw] = (rawDist[raw] ?? 0) + 1;
  }
  return { terrains, rawDist };
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

// ---------------------------------------------------------------- 城市处理

interface CitySeed {
  id: string;
  label: string;
  q: number;
  r: number;
}

/** 城市间的最小切比雪夫距离（保证 7 格城址 footprint 不重叠） */
const MIN_CITY_SPACING = 3;

/**
 * 城市中心格必须可通行（非山非水），且与其他城市保持最小间距。
 * 原版坐标已经过锚点校验，正常情况下应精确落在城址格上（零修正）。
 */
function placeCities(
  cities: CitySeed[],
  grid: GridCell[],
): { placed: CitySeed[]; adjustments: string[] } {
  const cellAt = (q: number, r: number) => grid[q * HEIGHT + r];
  const usable = (q: number, r: number) => {
    if (!inBounds(q, r)) return false;
    const t = cellAt(q, r).terrain;
    return t !== 'mountain' && t !== 'water';
  };
  const farEnough = (q: number, r: number, placed: CitySeed[]) =>
    placed.every((c) => Math.max(Math.abs(c.q - q), Math.abs(c.r - r)) >= MIN_CITY_SPACING);

  const adjustments: string[] = [];
  const placed: CitySeed[] = [];

  for (const city of cities) {
    let { q, r } = city;
    let found = false;
    outer: for (let dist = 0; dist <= 12; dist += 1) {
      for (let dq = -dist; dq <= dist; dq += 1) {
        for (let dr = -dist; dr <= dist; dr += 1) {
          if (Math.max(Math.abs(dq), Math.abs(dr)) !== dist) continue;
          const cq = q + dq;
          const cr = r + dr;
          if (!usable(cq, cr) || !farEnough(cq, cr, placed)) continue;
          if (cq !== city.q || cr !== city.r) {
            adjustments.push(`${city.label} (${city.q},${city.r}) → (${cq},${cr})`);
          }
          q = cq;
          r = cr;
          found = true;
          break outer;
        }
      }
    }
    if (!found) throw new Error(`无法为城市 ${city.label} 找到可用位置`);
    placed.push({ ...city, q, r });
  }
  return { placed, adjustments };
}

// ---------------------------------------------------------------- 连通性验证

/** 所有城市经陆路（非 water）互相可达；原版山地/丘陵/道路均可通行 */
function verifyConnectivity(cities: CitySeed[], grid: GridCell[]): string[] {
  const passable = (cell: GridCell) => cell.terrain !== 'water';
  const cellMap = new Map(grid.map((cell) => [`${cell.q},${cell.r}`, cell]));
  const cityKeyByPos = new Map(cities.map((c) => [`${c.q},${c.r}`, c.label]));

  const seen = new Set<string>();
  const queue = [cities[0]];
  const reached: string[] = [];
  while (queue.length > 0) {
    const cur = queue.shift()!;
    const k = `${cur.q},${cur.r}`;
    if (seen.has(k)) continue;
    seen.add(k);
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
  return reached;
}

// ---------------------------------------------------------------- SVG 预览

const COLORS: Record<string, string> = {
  plain: '#69775f',
  road: '#a58d57',
  forest: '#2f5f3a',
  hill: '#696851',
  mountain: '#303837',
  water: '#1e4c60',
  ferry: '#a07440',
  construction: '#8a8f6a',
};

function renderSvg(grid: GridCell[], cities: CitySeed[]): string {
  const CELL = 4;
  const cellsSvg = grid.map((cell) => {
    const x = cell.q * CELL;
    const y = cell.r * CELL + (cell.q % 2 === 0 ? -CELL / 2 : 0);
    return `<rect x="${x}" y="${y}" width="${CELL}" height="${CELL}" fill="${COLORS[cell.terrain] ?? '#f0f'}"/>`;
  });
  const citiesSvg = cities.flatMap((city) => {
    const x = city.q * CELL;
    const y = city.r * CELL + (city.q % 2 === 0 ? -CELL / 2 : 0);
    return [
      `<rect x="${x - 3}" y="${y - 3}" width="12" height="12" fill="none" stroke="#f2d778" stroke-width="1.4"/>`,
      `<text x="${x + 8}" y="${y + 3}" fill="#fff4cd" font-size="9">${city.label}</text>`,
    ];
  });
  const w = WIDTH * CELL;
  const h = HEIGHT * CELL + CELL / 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}"><rect width="${w}" height="${h}" fill="#1b241f"/>${cellsSvg.join('')}${citiesSvg.join('')}</svg>`;
}

// ---------------------------------------------------------------- 主流程

function main() {
  console.log(`读取地形: ${PKRES}`);
  const { terrains, rawDist } = readTerrain();
  console.log('原始地形分布:', rawDist);

  console.log(`读取建筑坐标: ${SCEN}`);
  const cityBuildings = readBuildings(CITY_RECORD_OFFSET, CITIES.length, CITIES.map((c) => c[1]), 'city');
  const passBuildings = readBuildings(PASS_RECORD_OFFSET, PASSES.length, PASSES, 'pass');
  const portBuildings = readBuildings(PORT_RECORD_OFFSET, PORTS.length, PORTS, 'port');
  verifyAnchors(terrains, [
    { type: 'city', buildings: cityBuildings },
    { type: 'pass', buildings: passBuildings },
    { type: 'port', buildings: portBuildings },
  ]);
  console.log(`关所 ${passBuildings.length} 处、港口 ${portBuildings.length} 处将以地形标记(建造用地/渡口)呈现于地图`);

  const grid = buildGrid(terrains);

  const seeds: CitySeed[] = cityBuildings.map((b, i) => ({ id: CITIES[i][2], label: b.label, q: b.q, r: b.r }));
  const { placed: cities, adjustments } = placeCities(seeds, grid);
  if (adjustments.length > 0) {
    console.log('城市位置修正:');
    for (const line of adjustments) console.log(`  ${line}`);
  } else {
    console.log('城市位置: 42/42 精确落位，无需修正');
  }

  // 城市周边 2 圈内若有山/水导致围死，清出平地；
  // 保留道路/渡口/建造用地等地形标记（缺失标示正是旧版地图的问题所在）
  for (const city of cities) {
    for (const coord of [city, ...neighborsOf(city.q, city.r)]) {
      for (const neighbor of [coord, ...neighborsOf(coord.q, coord.r)]) {
        if (!inBounds(neighbor.q, neighbor.r)) continue;
        const cell = grid[neighbor.q * HEIGHT + neighbor.r];
        if (cell.terrain === 'mountain' || cell.terrain === 'water') {
          cell.terrain = 'plain';
        }
      }
    }
  }

  const reached = verifyConnectivity(cities, grid);
  console.log(`\n陆路连通城市: ${reached.length}/42`);
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
  };

  const outDir = resolve(process.cwd(), 'public/maps');
  mkdirSync(outDir, { recursive: true });
  const jsonPath = resolve(outDir, 'china42.json');
  writeFileSync(jsonPath, JSON.stringify(payload), 'utf8');
  const srcJsonPath = resolve(process.cwd(), 'src/game/scenario/china42.json');
  writeFileSync(srcJsonPath, JSON.stringify(payload), 'utf8');
  const svgPath = resolve(outDir, 'china42.svg');
  writeFileSync(svgPath, renderSvg(grid, cities), 'utf8');

  const counts = grid.reduce((tally, cell) => {
    tally[cell.terrain] = (tally[cell.terrain] ?? 0) + 1;
    return tally;
  }, {} as Record<string, number>);
  console.log('\n地形统计:', counts);
  console.log(`已生成: ${jsonPath}`);
  console.log(`已生成: ${srcJsonPath}`);
  console.log(`已生成: ${svgPath}`);
}

main();
