/** 生成血色地图的"地形值着色"SVG 预览（每个值一种颜色+图例） */
const fs = require('fs');

const MOD = 'C:/san11/xsyg/xsyg6/xsyg6/San11Pk/Media/san11pkres.bin';
const BLOOD_OFFSET = 0x20a40cb7;
const VANILLA_OFFSET = 0x26800119;
const HEADER = 8, CELLB = 11, W = 200, H = 200, N = W * H;

function readMap(offset) {
  const fd = fs.openSync(MOD, 'r');
  const buf = Buffer.alloc(HEADER + N * CELLB);
  fs.readSync(fd, buf, 0, buf.length, offset);
  fs.closeSync(fd);
  const t = new Uint8Array(N);
  for (let i = 0; i < N; i++) t[i] = buf[HEADER + i * CELLB];
  return t;
}

const blood = readMap(BLOOD_OFFSET);

// 32 个值 → 32 种可区分颜色
const PALETTE = [
  '#7CFC00', '#ADFF2F', '#F0E68C', '#556B2F', '#8B008B', '#006400', '#1E90FF', '#00BFFF',
  '#0000CD', '#D2B48C', '#FF8C00', '#8B4513', '#FF4500', '#20B2AA', '#87CEEB', '#2F4F4F',
  '#FF1493', '#DC143C', '#FFD700', '#4B0082', '#98FB98', '#32CD32', '#008B8B', '#FF00FF',
  '#FFFF00', '#00FF00', '#9ACD32', '#DAA520', '#808080', '#C0C0C0', '#A0522D', '#F5DEB3',
];

const CELL = 5;
const cells = [];
for (let x = 0; x < W; x++) for (let y = 0; y < H; y++) {
  const v = blood[x * H + y];
  cells.push(`<rect x="${x * CELL}" y="${y * CELL}" width="${CELL}" height="${CELL}" fill="${PALETTE[v]}"/>`);
}

// 城市标记
const scenario = JSON.parse(fs.readFileSync('tools/xsyg_map/Scenario1.json', 'utf8'));
const metros = Object.values(scenario.citySet).filter((c) => c.BuildingType === 1);
const marks = metros.map((c) => {
  const q = c.x - 28, r = c.y - 28;
  if (q < 0 || q >= W || r < 0 || r >= H) return '';
  return `<circle cx="${q * CELL + 2}" cy="${r * CELL + 2}" r="3" fill="none" stroke="#fff" stroke-width="1.5"/><text x="${q * CELL + 6}" y="${r * CELL + 4}" fill="#fff" font-size="8" stroke="#000" stroke-width="0.3" paint-order="stroke">${c.Name}</text>`;
});

// 图例
const legend = PALETTE.map((color, v) => {
  const col = v % 8, row = Math.floor(v / 8);
  return `<rect x="${W * CELL + 20 + col * 70}" y="${20 + row * 22}" width="14" height="14" fill="${color}" stroke="#333"/><text x="${W * CELL + 38 + col * 70}" y="${32 + row * 22}" fill="#fff" font-size="13">${v}</text>`;
}).join('');

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W * CELL + 620}" height="${H * CELL + 40}">
<rect width="${W * CELL + 620}" height="${H * CELL + 40}" fill="#111"/>
<text x="${W * CELL + 20}" y="${H * CELL + 20}" fill="#fff" font-size="14">XSYG map slot1 - value-colored (v0-v31)</text>
${cells.join('')}${marks.join('')}${legend}
</svg>`;
fs.writeFileSync('xsyg-values.svg', svg);
console.log('written xsyg-values.svg');

// 同时输出大号 ASCII（200列x200行, 每值一个字符）
const CH = '0123456789ABCDEFGHIJKLMNOPQRSTUV';
const lines = [];
for (let y = 0; y < H; y++) {
  let line = '';
  for (let x = 0; x < W; x++) line += CH[blood[x * H + y]];
  lines.push(line);
}
fs.writeFileSync('xsyg-ascii.txt', lines.join('\n'));
console.log('written xsyg-ascii.txt');
