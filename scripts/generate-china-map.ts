import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { generateChina42Map } from '../src/game/map-editor/generators/china42';

const map = generateChina42Map();

const outDir = resolve(process.cwd(), 'public/maps');
mkdirSync(outDir, { recursive: true });

// 地图编辑器导入用 JSON
const payload = {
  schemaVersion: 1,
  width: map.width,
  height: map.height,
  backgroundImage: '',
  grid: map.grid,
  cities: map.cities,
};
const jsonPath = resolve(outDir, 'china42.json');
writeFileSync(jsonPath, JSON.stringify(payload), 'utf8');

// 同步写入 src/game/scenario/ 供游戏静态导入
const srcJsonPath = resolve(process.cwd(), 'src/game/scenario/china42.json');
writeFileSync(srcJsonPath, JSON.stringify(payload), 'utf8');

// SVG 预览图
const CELL_SIZE = 4;
const COLORS: Record<string, string> = {
  plain: '#69775f',
  road: '#a58d57',
  forest: '#2f5f3a',
  hill: '#696851',
  mountain: '#303837',
  water: '#1e4c60',
  shore: '#5f9db4',
  ferry: '#a07440',
};
const cellsSvg = map.grid.map((cell) => {
  const x = cell.q * CELL_SIZE;
  const y = cell.r * CELL_SIZE + (cell.q % 2 === 0 ? -CELL_SIZE / 2 : 0);
  return `<rect x="${x}" y="${y}" width="${CELL_SIZE}" height="${CELL_SIZE}" fill="${COLORS[cell.terrain]}"/>`;
});
const citiesSvg = map.cities.flatMap((city) => {
  const x = city.q * CELL_SIZE;
  const y = city.r * CELL_SIZE + (city.q % 2 === 0 ? -CELL_SIZE / 2 : 0);
  return [
    `<rect x="${x - 3}" y="${y - 3}" width="12" height="12" fill="none" stroke="#f2d778" stroke-width="1.4"/>`,
    `<text x="${x + 8}" y="${y + 3}" fill="#fff4cd" font-size="9">${city.label}</text>`,
  ];
});
const svgWidth = map.width * CELL_SIZE;
const svgHeight = map.height * CELL_SIZE + CELL_SIZE / 2;
const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${svgWidth} ${svgHeight}" width="${svgWidth}" height="${svgHeight}"><rect width="${svgWidth}" height="${svgHeight}" fill="#1b241f"/>${cellsSvg.join('')}${citiesSvg.join('')}</svg>`;
const svgPath = resolve(outDir, 'china42.svg');
writeFileSync(svgPath, svg, 'utf8');

const counts = map.grid.reduce((tally, cell) => {
  tally[cell.terrain] = (tally[cell.terrain] ?? 0) + 1;
  return tally;
}, {} as Record<string, number>);

console.log(`已生成: ${jsonPath} (${dirname(jsonPath)})`);
console.log(`已生成: ${svgPath}`);
console.log('地形统计:', counts);
console.log('城市数:', map.cities.length);
