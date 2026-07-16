# Cell-Aligned Ink Map Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Generate a realistic Chinese ink-wash map from the six exported control SVGs while keeping water, roads, mountains, forests, and cities strictly inside complete 24x24 staggered-grid cells.

**Architecture:** Parse the exported SVGs into a validated terrain model, generate reusable ink-wash texture assets, and compose them into an SVG using opaque terrain bases plus exact 24x24 texture rectangles. Rasterize the SVG with Playwright and verify the generated layer geometry against the original masks before accepting the PNG.

**Tech Stack:** Node.js ESM, JSDOM, SVG, Playwright Chromium, Node test runner, Codex image generation.

## Global Constraints

- Output dimensions are exactly `1680x960`.
- The authoritative grid is exactly 70x40 with 24-pixel cells.
- Even columns shift upward by exactly 12 pixels.
- Water and road terrain fill complete cells and never mix with plain terrain inside one cell.
- All terrain boundaries use hard mask clipping with no cross-cell blur, feathering, or gradient.
- The final map has no visible grid lines, labels, flags, units, or UI.
- Generated previews and texture assets remain under `exports/` and are not committed automatically.

---

### Task 1: Parse and Validate Exported Terrain Controls

**Files:**
- Create: `scripts/ink-map/input-model.mjs`
- Create: `scripts/ink-map/input-model.test.mjs`

**Interfaces:**
- Consumes: A directory containing `terrain-control.svg` and five `mask-*.svg` files.
- Produces: `loadTerrainModel(inputDir): Promise<TerrainModel>`.
- `TerrainModel` contains `width`, `height`, `gridWidth`, `gridHeight`, `cellSize`, `cells`, `masks`, and `cities`.

- [ ] **Step 1: Write the failing parser tests**

```js
import assert from 'node:assert/strict';
import test from 'node:test';
import { loadTerrainModel } from './input-model.mjs';

test('loads the 70x40 staggered terrain model', async () => {
  const model = await loadTerrainModel('D:/s/map');
  assert.equal(model.width, 1680);
  assert.equal(model.height, 960);
  assert.equal(model.gridWidth, 70);
  assert.equal(model.gridHeight, 40);
  assert.equal(model.cellSize, 24);
  assert.equal(model.cells.size, 2800);
  assert.equal(model.masks.water.size, 178);
  assert.equal(model.masks.road.size, 159);
  assert.equal(model.masks.mountain.size, 203);
  assert.equal(model.masks.forest.size, 400);
  assert.equal(model.masks.city.size, 56);
  assert.equal(model.cities.size, 8);
});

test('uses the staggered square cell formula', async () => {
  const model = await loadTerrainModel('D:/s/map');
  assert.deepEqual(model.cells.get('0,0').bounds, { x: 0, y: -12, width: 24, height: 24 });
  assert.deepEqual(model.cells.get('1,0').bounds, { x: 24, y: 0, width: 24, height: 24 });
});
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `node --test scripts/ink-map/input-model.test.mjs`

Expected: FAIL because `input-model.mjs` does not exist.

- [ ] **Step 3: Implement the validated parser**

Use `JSDOM` with `contentType: 'image/svg+xml'`. Read numeric metadata from the root SVG and reject any value other than 1680x960, 70x40, and cell size 24. Build cell keys as `${q},${r}` and parse each mask's white rectangles into `Set<string>` values. Parse each `data-control-city` value into a city identifier and group its seven cell keys.

```js
export async function loadTerrainModel(inputDir) {
  const control = await parseSvg(resolve(inputDir, 'terrain-control.svg'));
  const root = control.documentElement;
  const model = {
    width: Number(root.getAttribute('width')),
    height: Number(root.getAttribute('height')),
    gridWidth: Number(root.getAttribute('data-grid-width')),
    gridHeight: Number(root.getAttribute('data-grid-height')),
    cellSize: Number(root.getAttribute('data-cell-size')),
    cells: new Map(),
    masks: {},
    cities: new Map(),
  };
  assertMetadata(model);
  for (const rect of root.querySelectorAll('rect[data-q][data-r][data-terrain]')) {
    const q = Number(rect.getAttribute('data-q'));
    const r = Number(rect.getAttribute('data-r'));
    model.cells.set(`${q},${r}`, {
      q,
      r,
      terrain: rect.getAttribute('data-terrain'),
      bounds: { x: q * 24, y: r * 24 - (q % 2 === 0 ? 12 : 0), width: 24, height: 24 },
    });
  }
  for (const layer of ['water', 'mountain', 'forest', 'road', 'city']) {
    model.masks[layer] = await parseMask(resolve(inputDir, `mask-${layer}.svg`), layer, model);
  }
  groupCities(root, model);
  return model;
}
```

- [ ] **Step 4: Run parser tests**

Run: `node --test scripts/ink-map/input-model.test.mjs`

Expected: 2 tests pass.

- [ ] **Step 5: Commit parser and tests**

```powershell
git add scripts/ink-map/input-model.mjs scripts/ink-map/input-model.test.mjs
git commit -m "feat: parse ink map terrain controls"
```

### Task 2: Generate Reusable Ink-Wash Material Assets

**Files:**
- Create: `exports/ink-map-textures/plain.png`
- Create: `exports/ink-map-textures/water.png`
- Create: `exports/ink-map-textures/mountain.png`
- Create: `exports/ink-map-textures/forest.png`
- Create: `exports/ink-map-textures/road.png`
- Create: `exports/ink-map-textures/city.png`

**Interfaces:**
- Consumes: The approved visual design and terrain roles.
- Produces: Six square, label-free texture assets used by the SVG compositor.

- [ ] **Step 1: Generate the plain texture**

Use the image generation tool with this prompt:

```text
Seamless realistic ancient Chinese ink-wash terrain texture, pale rice-paper earth and muted moss-green plain, subtle watercolor blooms and dry-brush grain, evenly lit top-down view, no horizon, no objects, no grid, no borders, no text, no roads, no water, no mountains, no buildings.
```

- [ ] **Step 2: Generate the water texture**

```text
Seamless top-down ancient Chinese ink-wash water texture filling the entire image, muted blue-gray river and lake surface, delicate horizontal current strokes, subtle watercolor pigment variation, no banks, no land, no islands, no boats, no grid, no border, no text.
```

- [ ] **Step 3: Generate the mountain texture**

```text
Seamless top-down Chinese ink-wash mountain terrain texture filling the entire image, dense dark gray rocky ridges and mist-softened peaks viewed as a tactical map, restrained realistic brushwork, no plain ground gaps, no water, no roads, no buildings, no grid, no text.
```

- [ ] **Step 4: Generate the forest texture**

```text
Seamless top-down Chinese ink-wash forest terrain texture filling the entire image, dense dark green tree canopy with varied clustered crowns and watercolor granulation, no open plain gaps, no roads, no water, no buildings, no grid, no text.
```

- [ ] **Step 5: Generate the road terrain texture**

```text
Seamless top-down ancient Chinese earth-road terrain texture filling the entire image, muted ochre packed soil with wagon ruts, footprints and dry-brush dust, the whole image is road ground, no surrounding grass or plain, no water, no buildings, no grid, no border, no text.
```

- [ ] **Step 6: Generate the city stamp**

```text
Top-down realistic ancient Chinese fortified city stamp in ink-wash style, compact ochre stone walls, dark tiled gates and clustered wooden roofs, centered composition, isolated on transparent background, no landscape, no flags, no people, no labels, no text, no grid, suitable for clipping into a seven-cell tactical-map footprint.
```

- [ ] **Step 7: Inspect all six assets**

Confirm each terrain texture fills the complete image, contains no forbidden terrain, and has no labels, borders, or grid lines. Regenerate only the failing texture.

### Task 3: Compose the Cell-Aligned SVG

**Files:**
- Create: `scripts/ink-map/render-svg.mjs`
- Create: `scripts/ink-map/render-svg.test.mjs`
- Create: `scripts/ink-map/cli.mjs`
- Create: `exports/ink-wash-map-cell-aligned.svg`

**Interfaces:**
- Consumes: `TerrainModel` and texture paths from Task 2.
- Produces: `renderInkMapSvg(model, texturePaths): string`.

- [ ] **Step 1: Write failing geometry tests**

```js
import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { loadTerrainModel } from './input-model.mjs';
import { renderInkMapSvg } from './render-svg.mjs';

const fixtureTextures = {
  plain: 'plain.png',
  water: 'water.png',
  mountain: 'mountain.png',
  forest: 'forest.png',
  road: 'road.png',
  city: 'city.png',
};

test('renders exactly one opaque terrain base for every cell', async () => {
  const model = await loadTerrainModel('D:/s/map');
  const svg = renderInkMapSvg(model, fixtureTextures);
  const doc = new JSDOM(svg, { contentType: 'image/svg+xml' }).window.document;
  assert.equal(doc.querySelectorAll('[data-cell-base]').length, 2800);
  assert.equal(doc.querySelectorAll('[data-grid-line]').length, 0);
});

test('water and road overlays match their complete-cell masks', async () => {
  const model = await loadTerrainModel('D:/s/map');
  const svg = renderInkMapSvg(model, fixtureTextures);
  const doc = new JSDOM(svg, { contentType: 'image/svg+xml' }).window.document;
  assert.equal(doc.querySelectorAll('[data-layer="water"] rect').length, 178);
  assert.equal(doc.querySelectorAll('[data-layer="road"] rect').length, 159);
  for (const rect of doc.querySelectorAll('[data-layer="water"] rect, [data-layer="road"] rect')) {
    assert.equal(rect.getAttribute('width'), '24');
    assert.equal(rect.getAttribute('height'), '24');
  }
});
```

- [ ] **Step 2: Run the renderer test and confirm it fails**

Run: `node --test scripts/ink-map/render-svg.test.mjs`

Expected: FAIL because `render-svg.mjs` does not exist.

- [ ] **Step 3: Implement hard-clipped terrain layers**

Render one opaque base rectangle per grid cell. For water, road, mountain, forest, and plain textures, render one additional texture rectangle for every exact 24x24 target cell. SVG rectangle bounds provide the hard clipping; do not use blur, displacement, oversized paths, or rectangle strokes.

```js
const TERRAIN_STYLE = {
  plain: { color: '#9aa58a', texture: 'plain' },
  deepWater: { color: '#527f88', texture: 'water' },
  water: { color: '#527f88', texture: 'water' },
  mountain: { color: '#4b4b47', texture: 'mountain' },
  forest: { color: '#35553c', texture: 'forest' },
  road: { color: '#aa8751', texture: 'road' },
};

function cellKeysForLayer(layer, model) {
  if (layer === 'plain') {
    const occupied = new Set([
      ...model.masks.water,
      ...model.masks.mountain,
      ...model.masks.forest,
      ...model.masks.road,
    ]);
    return [...model.cells.keys()].filter((key) => !occupied.has(key));
  }
  return [...model.masks[layer]];
}

function renderTexturePatterns(texturePaths) {
  return ['plain', 'mountain', 'forest', 'water', 'road'].map((layer) =>
    `<pattern id="texture-${layer}" width="512" height="512" patternUnits="userSpaceOnUse">` +
    `<image href="${texturePaths[layer]}" width="512" height="512" preserveAspectRatio="xMidYMid slice"/>` +
    `</pattern>`
  ).join('');
}

function renderTextureLayer(layer, model) {
  const rects = cellKeysForLayer(layer, model).map((key) => {
    const { bounds } = model.cells.get(key);
    return `<rect data-texture-cell="${key}" x="${bounds.x}" y="${bounds.y}" width="24" height="24" fill="url(#texture-${layer})"/>`;
  }).join('');
  return `<g data-layer="${layer}" opacity="0.78">${rects}</g>`;
}

function renderCityClips(model) {
  return [...model.cities.entries()].map(([id, keys]) => {
    const rects = keys.map((key) => {
      const { bounds } = model.cells.get(key);
      return `<rect x="${bounds.x}" y="${bounds.y}" width="24" height="24"/>`;
    }).join('');
    return `<clipPath id="city-${id}">${rects}</clipPath>`;
  }).join('');
}

function renderCities(model, cityTexture) {
  const cityBases = [...model.masks.city].map((key) => {
    const { bounds } = model.cells.get(key);
    return `<rect data-city-cell="${key}" x="${bounds.x}" y="${bounds.y}" width="24" height="24" fill="#8c7049"/>`;
  }).join('');
  const stamps = [...model.cities.entries()].map(([id, keys]) => {
    const cells = keys.map((key) => model.cells.get(key).bounds);
    const minX = Math.min(...cells.map(({ x }) => x));
    const minY = Math.min(...cells.map(({ y }) => y));
    const maxX = Math.max(...cells.map(({ x, width }) => x + width));
    const maxY = Math.max(...cells.map(({ y, height }) => y + height));
    return `<image href="${cityTexture}" x="${minX}" y="${minY}" width="${maxX - minX}" height="${maxY - minY}" preserveAspectRatio="xMidYMid meet" clip-path="url(#city-${id})"/>`;
  }).join('');
  return `<g data-layer="city">${cityBases}${stamps}</g>`;
}

function renderPaperWash() {
  return `<rect data-paper-wash="true" width="1680" height="960" fill="#6f6047" opacity="0.06" style="mix-blend-mode:multiply"/>`;
}

export function renderInkMapSvg(model, texturePaths) {
  const bases = [...model.cells.values()].map((cell) => {
    const style = TERRAIN_STYLE[cell.terrain] ?? TERRAIN_STYLE.plain;
    return `<rect data-cell-base="${cell.q},${cell.r}" x="${cell.bounds.x}" y="${cell.bounds.y}" width="24" height="24" fill="${style.color}"/>`;
  }).join('');
  const layers = ['plain', 'mountain', 'forest', 'water', 'road']
    .map((layer) => renderTextureLayer(layer, model))
    .join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1680" height="960" viewBox="0 0 1680 960"><defs>${renderTexturePatterns(texturePaths)}${renderCityClips(model)}</defs><rect width="1680" height="960" fill="#d8d1b5"/>${bases}${layers}${renderCities(model, texturePaths.city)}${renderPaperWash()}</svg>`;
}
```

The paper-wash layer may use `mix-blend-mode:multiply` and low opacity, but it must be a color/grain overlay only. Do not use displacement, blur, or filters that move pixels across terrain boundaries.

- [ ] **Step 4: Run renderer tests**

Run: `node --test scripts/ink-map/render-svg.test.mjs`

Expected: All renderer tests pass.

- [ ] **Step 5: Generate the SVG**

Run:

```powershell
node scripts/ink-map/cli.mjs --input D:\s\map --textures exports\ink-map-textures --svg exports\ink-wash-map-cell-aligned.svg
```

Expected: `exports/ink-wash-map-cell-aligned.svg` is created at 1680x960.

- [ ] **Step 6: Commit renderer source and tests**

```powershell
git add scripts/ink-map/render-svg.mjs scripts/ink-map/render-svg.test.mjs scripts/ink-map/cli.mjs
git commit -m "feat: compose cell-aligned ink map"
```

### Task 4: Rasterize and Verify the Final Map

**Files:**
- Create: `scripts/ink-map/verify.mjs`
- Create: `exports/ink-wash-map-cell-aligned.png`
- Modify: `package.json`

**Interfaces:**
- Consumes: The generated SVG and original terrain model.
- Produces: A 1680x960 PNG and a passing geometry verification report.

- [ ] **Step 1: Add CLI scripts**

```json
{
  "scripts": {
    "map:ink": "node scripts/ink-map/cli.mjs --input D:/s/map --textures exports/ink-map-textures --svg exports/ink-wash-map-cell-aligned.svg --png exports/ink-wash-map-cell-aligned.png",
    "map:ink:verify": "node scripts/ink-map/verify.mjs D:/s/map exports/ink-wash-map-cell-aligned.svg"
  }
}
```

- [ ] **Step 2: Implement Playwright rasterization**

In `cli.mjs`, launch Chromium, set the viewport to 1680x960, load the generated SVG, and capture the root SVG:

```js
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1680, height: 960 }, deviceScaleFactor: 1 });
await page.setContent(svg);
await page.locator('svg').screenshot({ path: outputPng, omitBackground: false });
await browser.close();
```

- [ ] **Step 3: Implement strict geometry verification**

`verify.mjs` must parse the output SVG and compare every rendered terrain rectangle to the original mask sets. It must fail when a water or road rectangle is missing, added, shifted, or has dimensions other than 24x24. It must also fail when the output contains line elements, grid metadata, text elements, or a blur/displacement filter.

```js
assert.equal(output.querySelectorAll('line, text, [data-grid-line]').length, 0);
assert.equal(output.querySelectorAll('feGaussianBlur, feDisplacementMap').length, 0);
compareLayer('water', model.masks.water, output);
compareLayer('road', model.masks.road, output);
compareLayer('mountain', model.masks.mountain, output);
compareLayer('forest', model.masks.forest, output);
compareLayer('city', model.masks.city, output);
```

- [ ] **Step 4: Generate and verify**

Run:

```powershell
npm.cmd run map:ink
npm.cmd run map:ink:verify
```

Expected: PNG created and verification prints `PASS: all terrain layers match complete-cell masks`.

- [ ] **Step 5: Inspect the PNG**

Open `exports/ink-wash-map-cell-aligned.png` and check:

- No visible grid lines.
- Every water cell is completely water.
- Every road cell is completely road terrain.
- No water, road, mountain, forest, or city art crosses its mask boundary.
- The map reads as a realistic, restrained ancient Chinese ink-wash battlefield.

- [ ] **Step 6: Run project verification**

Run:

```powershell
node --test scripts/ink-map/*.test.mjs
npm.cmd test
npm.cmd run build
```

Expected: All map tests, project tests, and build pass.

- [ ] **Step 7: Commit source changes only**

```powershell
git add package.json scripts/ink-map
git commit -m "feat: generate verified ink map preview"
```

Do not stage `exports/ink-map-textures/`, `exports/ink-wash-map-cell-aligned.svg`, or `exports/ink-wash-map-cell-aligned.png`.
