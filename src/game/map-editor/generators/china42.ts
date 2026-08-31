import { neighborsOf } from '../../battle/grid';
import type { GridCell, TerrainType } from '../../types';

export interface GeneratedMapCity {
  id: string;
  label: string;
  q: number;
  r: number;
}

export interface GeneratedMap {
  width: number;
  height: number;
  grid: GridCell[];
  cities: GeneratedMapCity[];
}

const WIDTH = 200;
const HEIGHT = 200;
const SEED = 20260824;

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Point = [number, number];

interface Polyline {
  points: Point[];
  width: number;
}

const CITIES: GeneratedMapCity[] = [
  { id: 'xiangping', label: '襄平', q: 150, r: 14 },
  { id: 'beiping', label: '北平', q: 144, r: 26 },
  { id: 'ji', label: '蓟', q: 128, r: 26 },
  { id: 'nanpi', label: '南皮', q: 132, r: 44 },
  { id: 'pingyuan', label: '平原', q: 122, r: 56 },
  { id: 'ye', label: '邺', q: 110, r: 58 },
  { id: 'jinyang', label: '晋阳', q: 88, r: 50 },
  { id: 'shangdang', label: '上党', q: 96, r: 68 },
  { id: 'puyang', label: '濮阳', q: 118, r: 64 },
  { id: 'chenliu', label: '陈留', q: 128, r: 88 },
  { id: 'qiao', label: '谯', q: 138, r: 90 },
  { id: 'luoyang', label: '洛阳', q: 110, r: 86 },
  { id: 'xiaopei', label: '小沛', q: 140, r: 78 },
  { id: 'beihai', label: '北海', q: 146, r: 54 },
  { id: 'runan', label: '汝南', q: 132, r: 100 },
  { id: 'xuchang', label: '许昌', q: 118, r: 94 },
  { id: 'changan', label: '长安', q: 94, r: 86 },
  { id: 'anding', label: '安定', q: 72, r: 74 },
  { id: 'tianshui', label: '天水', q: 60, r: 80 },
  { id: 'wuwei', label: '武威', q: 44, r: 68 },
  { id: 'hanzhong', label: '汉中', q: 76, r: 100 },
  { id: 'zitong', label: '梓潼', q: 62, r: 102 },
  { id: 'chengdu', label: '成都', q: 50, r: 110 },
  { id: 'jiangzhou', label: '江州', q: 66, r: 122 },
  { id: 'yongan', label: '永安', q: 82, r: 122 },
  { id: 'jianning', label: '建宁', q: 54, r: 140 },
  { id: 'yunnan', label: '云南', q: 42, r: 152 },
  { id: 'wan', label: '宛', q: 108, r: 98 },
  { id: 'xinye', label: '新野', q: 108, r: 106 },
  { id: 'xiangyang', label: '襄阳', q: 100, r: 112 },
  { id: 'jiangxia', label: '江夏', q: 105, r: 124 },
  { id: 'jiangling', label: '江陵', q: 92, r: 120 },
  { id: 'changsha', label: '长沙', q: 102, r: 138 },
  { id: 'wuling', label: '武陵', q: 86, r: 136 },
  { id: 'lingling', label: '零陵', q: 90, r: 152 },
  { id: 'guiyang', label: '桂阳', q: 106, r: 152 },
  { id: 'shouchun', label: '寿春', q: 132, r: 108 },
  { id: 'lujiang', label: '庐江', q: 126, r: 120 },
  { id: 'chaisang', label: '柴桑', q: 120, r: 132 },
  { id: 'jianye', label: '建业', q: 140, r: 132 },
  { id: 'wu', label: '吴', q: 154, r: 145 },
  { id: 'kuaiji', label: '会稽', q: 160, r: 154 },
  { id: 'xiapi', label: '下邳', q: 146, r: 96 },
];

const ROAD_EDGES: Array<[string, string]> = [
  ['xiangping', 'beiping'],
  ['beiping', 'ji'],
  ['ji', 'nanpi'],
  ['nanpi', 'pingyuan'],
  ['pingyuan', 'ye'],
  ['ye', 'jinyang'],
  ['ye', 'puyang'],
  ['jinyang', 'shangdang'],
  ['shangdang', 'luoyang'],
  ['shangdang', 'ye'],
  ['puyang', 'chenliu'],
  ['chenliu', 'luoyang'],
  ['chenliu', 'xuchang'],
  ['chenliu', 'xiaopei'],
  ['qiao', 'xiaopei'],
  ['qiao', 'runan'],
  ['beihai', 'pingyuan'],
  ['beihai', 'xiapi'],
  ['luoyang', 'changan'],
  ['changan', 'anding'],
  ['anding', 'tianshui'],
  ['tianshui', 'wuwei'],
  ['tianshui', 'hanzhong'],
  ['changan', 'hanzhong'],
  ['hanzhong', 'zitong'],
  ['zitong', 'chengdu'],
  ['chengdu', 'jiangzhou'],
  ['jiangzhou', 'yongan'],
  ['yongan', 'jiangling'],
  ['chengdu', 'jianning'],
  ['jianning', 'yunnan'],
  ['luoyang', 'wan'],
  ['luoyang', 'xuchang'],
  ['wan', 'xinye'],
  ['xinye', 'xiangyang'],
  ['xiangyang', 'jiangxia'],
  ['jiangxia', 'changsha'],
  ['xiangyang', 'jiangling'],
  ['jiangling', 'wuling'],
  ['jiangling', 'changsha'],
  ['wuling', 'lingling'],
  ['lingling', 'guiyang'],
  ['changsha', 'guiyang'],
  ['runan', 'shouchun'],
  ['shouchun', 'lujiang'],
  ['shouchun', 'xiapi'],
  ['lujiang', 'chaisang'],
  ['chaisang', 'jianye'],
  ['jianye', 'wu'],
  ['wu', 'kuaiji'],
  ['xiaopei', 'xiapi'],
  ['xuchang', 'runan'],
];

const COASTLINE: Array<[number, number]> = [
  [0, 176], [10, 174], [14, 170], [18, 158], [24, 154], [30, 158], [36, 166],
  [42, 176], [46, 186], [52, 190], [56, 186], [62, 178], [70, 177], [90, 178],
  [110, 177], [126, 173], [136, 169], [146, 167], [160, 163], [180, 161], [199, 160],
];

const RIVERS: Polyline[] = [
  { width: 2, points: [[16, 78], [20, 74], [26, 70], [30, 66], [34, 64], [44, 58], [50, 48], [58, 40], [74, 38], [88, 42], [96, 52], [98, 64], [100, 72], [104, 78], [116, 84], [130, 86], [146, 82], [158, 72], [166, 62]] },
  { width: 2, points: [[14, 112], [22, 118], [34, 120], [46, 122], [58, 126], [70, 131], [78, 133], [88, 129], [96, 127], [104, 130], [114, 133], [124, 137], [134, 139], [144, 141], [152, 143], [162, 141]] },
  { width: 1, points: [[78, 102], [88, 106], [98, 112], [103, 119], [105, 128]] },
  { width: 1, points: [[106, 102], [118, 104], [132, 104], [146, 101], [158, 99], [172, 97]] },
  { width: 1, points: [[99, 132], [101, 142], [102, 152], [103, 160]] },
  { width: 1, points: [[124, 138], [125, 148], [127, 158], [128, 166]] },
  { width: 2, points: [[52, 170], [70, 174], [92, 177], [114, 181], [136, 183], [156, 184], [166, 185]] },
  { width: 1, points: [[146, 0], [147, 4], [149, 12], [151, 20], [153, 26]] },
];

const LAKES: Array<{ q: number; r: number; rad: number }> = [
  { q: 97, r: 135, rad: 2 },
  { q: 126, r: 136, rad: 2 },
  { q: 152, r: 147, rad: 2 },
];

const MOUNTAIN_RANGES: Polyline[] = [
  { width: 3, points: [[30, 26], [48, 22], [66, 20], [84, 20]] },
  { width: 3, points: [[110, 16], [126, 17], [142, 19]] },
  { width: 3, points: [[92, 34], [95, 46], [99, 58], [101, 68], [102, 76]] },
  { width: 3, points: [[78, 38], [81, 48], [83, 58], [85, 66]] },
  { width: 4, points: [[40, 94], [54, 91], [68, 91], [82, 92], [92, 94], [98, 96]] },
  { width: 4, points: [[50, 106], [60, 107], [70, 108], [80, 109], [88, 111]] },
  { width: 3, points: [[79, 115], [81, 124], [83, 132]] },
  { width: 4, points: [[24, 96], [30, 108], [33, 122], [34, 138], [32, 150]] },
  { width: 3, points: [[104, 112], [112, 113], [120, 114], [127, 116]] },
  { width: 4, points: [[66, 162], [84, 164], [102, 165], [120, 163], [138, 161], [148, 159]] },
  { width: 3, points: [[138, 144], [144, 152], [148, 162], [150, 170]] },
  { width: 3, points: [[34, 52], [42, 47], [52, 43]] },
  { width: 3, points: [[66, 70], [69, 78], [71, 86], [73, 92]] },
];

interface RegionPatch {
  q0: number;
  q1: number;
  r0: number;
  r1: number;
  fills: Array<{ terrain: TerrainType; p: number }>;
}

const REGION_PATCHES: RegionPatch[] = [
  { q0: 64, q1: 98, r0: 36, r1: 72, fills: [{ terrain: 'hill', p: 0.35 }] },
  { q0: 138, q1: 162, r0: 42, r1: 62, fills: [{ terrain: 'hill', p: 0.4 }] },
  { q0: 106, q1: 150, r0: 136, r1: 164, fills: [{ terrain: 'forest', p: 0.32 }, { terrain: 'hill', p: 0.22 }] },
  { q0: 30, q1: 68, r0: 126, r1: 168, fills: [{ terrain: 'hill', p: 0.45 }, { terrain: 'forest', p: 0.25 }] },
  { q0: 56, q1: 152, r0: 166, r1: 198, fills: [{ terrain: 'forest', p: 0.3 }, { terrain: 'hill', p: 0.2 }] },
  { q0: 26, q1: 64, r0: 58, r1: 92, fills: [{ terrain: 'hill', p: 0.25 }] },
  { q0: 138, q1: 162, r0: 4, r1: 24, fills: [{ terrain: 'hill', p: 0.3 }, { terrain: 'forest', p: 0.15 }] },
  { q0: 100, q1: 150, r0: 40, r1: 110, fills: [{ terrain: 'forest', p: 0.05 }] },
  { q0: 44, q1: 78, r0: 100, r1: 124, fills: [{ terrain: 'forest', p: 0.08 }] },
];

function key(q: number, r: number) {
  return `${q},${r}`;
}

function inBounds(q: number, r: number) {
  return q >= 0 && q < WIDTH && r >= 0 && r < HEIGHT;
}

function coastXAt(y: number) {
  const points = COASTLINE;
  if (y <= points[0][0]) return points[0][1];
  for (let index = 1; index < points.length; index += 1) {
    const [y1, x1] = points[index];
    const [y0, x0] = points[index - 1];
    if (y <= y1) return x0 + ((x1 - x0) * (y - y0)) / (y1 - y0);
  }
  return points[points.length - 1][1];
}

export function generateChina42Map(): GeneratedMap {
  const random = mulberry32(SEED);
  const terrains = new Map<string, TerrainType>();
  const get = (q: number, r: number): TerrainType => terrains.get(key(q, r)) ?? 'plain';
  const set = (q: number, r: number, terrain: TerrainType) => {
    if (inBounds(q, r)) terrains.set(key(q, r), terrain);
  };

  // 东部海岸线与海洋
  for (let r = 0; r < HEIGHT; r += 1) {
    const coast = coastXAt(r);
    for (let q = Math.ceil(coast); q < WIDTH; q += 1) set(q, r, 'water');
  }

  const stampDisc = (center: Point, radius: number, terrain: TerrainType, skip?: (current: TerrainType) => boolean) => {
    const [cq, cr] = center;
    const span = Math.ceil(radius) + 1;
    for (let dq = -span; dq <= span; dq += 1) {
      for (let dr = -span; dr <= span; dr += 1) {
        if (dq * dq + dr * dr > radius * radius + 0.5) continue;
        const q = cq + dq;
        const r = cr + dr;
        if (!inBounds(q, r)) continue;
        if (skip && skip(get(q, r))) continue;
        set(q, r, terrain);
      }
    }
  };

  const carvePolyline = (line: Polyline, terrain: TerrainType, skip?: (current: TerrainType) => boolean) => {
    const radius = line.width / 2;
    for (let index = 0; index < line.points.length - 1; index += 1) {
      const [aq, ar] = line.points[index];
      const [bq, br] = line.points[index + 1];
      const steps = Math.max(1, Math.ceil(Math.hypot(bq - aq, br - ar) * 4));
      for (let step = 0; step <= steps; step += 1) {
        const t = step / steps;
        stampDisc([aq + (bq - aq) * t, ar + (br - ar) * t], radius, terrain, skip);
      }
    }
  };

  for (const river of RIVERS) carvePolyline(river, 'water');
  for (const lake of LAKES) stampDisc([lake.q, lake.r], lake.rad, 'water');

  for (const range of MOUNTAIN_RANGES) carvePolyline(range, 'mountain');
  // 青藏高原东缘
  for (let r = 86; r < HEIGHT; r += 1) {
    for (let q = 0; q <= 18; q += 1) set(q, r, 'mountain');
  }

  // 山地丘陵过渡带
  for (const range of MOUNTAIN_RANGES) {
    const halo: Polyline = { points: range.points, width: range.width + 3 };
    const radius = halo.width / 2;
    for (let index = 0; index < halo.points.length - 1; index += 1) {
      const [aq, ar] = halo.points[index];
      const [bq, br] = halo.points[index + 1];
      const steps = Math.max(1, Math.ceil(Math.hypot(bq - aq, br - ar) * 4));
      for (let step = 0; step <= steps; step += 1) {
        const t = step / steps;
        const cq = aq + (bq - aq) * t;
        const cr = ar + (br - ar) * t;
        const span = Math.ceil(radius) + 1;
        for (let dq = -span; dq <= span; dq += 1) {
          for (let dr = -span; dr <= span; dr += 1) {
            const distSq = dq * dq + dr * dr;
            if (distSq > radius * radius + 0.5 || distSq < (range.width / 2) ** 2) continue;
            const q = Math.round(cq) + dq;
            const r = Math.round(cr) + dr;
            if (inBounds(q, r) && get(q, r) === 'plain') set(q, r, 'hill');
          }
        }
      }
    }
  }

  // 区域地貌填充
  for (const patch of REGION_PATCHES) {
    for (let q = patch.q0; q <= patch.q1; q += 1) {
      for (let r = patch.r0; r <= patch.r1; r += 1) {
        if (get(q, r) !== 'plain') continue;
        for (const fill of patch.fills) {
          if (random() < fill.p) {
            set(q, r, fill.terrain);
            break;
          }
        }
      }
    }
  }
  for (let q = 0; q < WIDTH; q += 1) {
    for (let r = 0; r < HEIGHT; r += 1) {
      if (get(q, r) !== 'plain') continue;
      const density = r > 100 ? 0.05 : 0.02;
      if (random() < density) set(q, r, 'forest');
    }
  }

  // 城市周边清出可部署空地（保留水面，河道不被城市吞噬）
  for (const city of CITIES) {
    for (const coord of [city, ...neighborsOf(city.q, city.r)]) {
      for (const neighbor of [coord, ...neighborsOf(coord.q, coord.r)]) {
        if (!inBounds(neighbor.q, neighbor.r)) continue;
        const current = get(neighbor.q, neighbor.r);
        if (current === 'mountain' || current === 'ferry') {
          set(neighbor.q, neighbor.r, 'plain');
        }
      }
    }
  }

  // 道路网：Dijkstra 寻路，穿山开路、跨水设渡口
  const roadCost = (terrain: TerrainType) => {
    switch (terrain) {
      case 'plain':
      case 'road':
        return 1;
      case 'ferry':
        return 2;
      case 'hill':
        return 5;
      case 'forest':
        return 6;
      case 'water':
        return 12;
      case 'mountain':
        return 90;
      default:
        return 1;
    }
  };

  const findRoadPath = (from: Point, to: Point): Point[] | null => {
    const dist = new Map<string, number>([[key(from[0], from[1]), 0]]);
    const prev = new Map<string, string>();
    const visited = new Set<string>();
    const heap: Array<{ k: string; q: number; r: number; d: number }> = [{ k: key(from[0], from[1]), q: from[0], r: from[1], d: 0 }];
    const popMin = () => {
      let bestIndex = 0;
      for (let index = 1; index < heap.length; index += 1) {
        if (heap[index].d < heap[bestIndex].d) bestIndex = index;
      }
      return heap.splice(bestIndex, 1)[0];
    };
    while (heap.length > 0) {
      const current = popMin();
      const currentKey = current.k;
      if (visited.has(currentKey)) continue;
      visited.add(currentKey);
      if (current.q === to[0] && current.r === to[1]) break;
      for (const neighbor of neighborsOf(current.q, current.r)) {
        if (!inBounds(neighbor.q, neighbor.r)) continue;
        const neighborKey = key(neighbor.q, neighbor.r);
        if (visited.has(neighborKey)) continue;
        const nextDist = current.d + roadCost(get(neighbor.q, neighbor.r));
        if (nextDist < (dist.get(neighborKey) ?? Number.POSITIVE_INFINITY)) {
          dist.set(neighborKey, nextDist);
          prev.set(neighborKey, currentKey);
          heap.push({ k: neighborKey, q: neighbor.q, r: neighbor.r, d: nextDist });
        }
      }
    }
    const targetKey = key(to[0], to[1]);
    if (!visited.has(targetKey)) return null;
    const path: Point[] = [];
    let cursor: string | undefined = targetKey;
    while (cursor) {
      const [q, r] = cursor.split(',').map(Number);
      path.push([q, r]);
      cursor = prev.get(cursor);
    }
    return path.reverse();
  };

  const cityById = new Map(CITIES.map((city) => [city.id, city]));
  for (const [fromId, toId] of ROAD_EDGES) {
    const from = cityById.get(fromId);
    const to = cityById.get(toId);
    if (!from || !to) throw new Error(`未知城市: ${fromId}-${toId}`);
    const path = findRoadPath([from.q, from.r], [to.q, to.r]);
    if (!path) throw new Error(`无法修建道路: ${from.label}-${to.label}`);
    for (const [q, r] of path) {
      const current = get(q, r);
      if (current === 'water') set(q, r, 'ferry');
      else set(q, r, 'road');
    }
  }

  // 岸边已并入水域：临水陆地直接作为可航行水域的一部分，不再单独生成 shore

  // 历史名渡口：官渡、白马、孟津、蒲坂、夏口、荆州、京口、柴桑、淮上、湘江、辽西
  const FERRY_CROSSINGS: Point[] = [
    [98, 66], [110, 81], [122, 85], [138, 85],
    [103, 121], [96, 127], [146, 141], [119, 135],
    [132, 104], [101, 144], [151, 20],
  ];
  for (const crossing of FERRY_CROSSINGS) stampDisc(crossing, 1.2, 'ferry', (current) => current !== 'water');

  const grid: GridCell[] = [];
  for (let q = 0; q < WIDTH; q += 1) {
    for (let r = 0; r < HEIGHT; r += 1) {
      grid.push({ q, r, terrain: get(q, r) });
    }
  }

  return { width: WIDTH, height: HEIGHT, grid, cities: CITIES.map((city) => ({ ...city })) };
}
