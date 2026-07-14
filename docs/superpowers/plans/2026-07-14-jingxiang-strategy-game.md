# Jingxiang Strategy Game Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a complete 24-month, single-player Jingxiang city-management strategy game that runs locally in the browser.

**Architecture:** React renders a responsive map-centered interface while a framework-independent TypeScript engine owns commands, AI, turns, scoring, and seeded randomness. Scenario data is immutable input, game state is updated through a reducer, and versioned browser storage persists autosave and manual save slots.

**Tech Stack:** React, TypeScript, Vite, Lucide React, Vitest, Testing Library, Playwright, CSS

## Global Constraints

- Use original artwork and code; do not copy commercial game assets, audio, UI files, or text.
- The scenario has exactly 8 cities, 4 selectable forces, 16 starting officers, 8 recruitable talents, 6 commands, and 24 months.
- Every force starts with 2 cities and 4 officers; highest and lowest initial force scores must differ by no more than 5% of the lowest score.
- The first release has no combat, diplomacy, multiplayer, accounts, cloud saves, or backend.
- Desktop map supports pan and zoom; 390×844 mobile uses a full-screen map and bottom command sheet.
- The rules engine must not import React or browser APIs.
- Random events and talent search use a persisted seed and cursor.
- Autosave key is `jingxiang-208-autosave-v1`; manual save key is `jingxiang-208-manual-v1`.
- Write tests before implementation and commit after every task.

## File Structure

```text
index.html                         Vite document shell
package.json                       scripts and dependencies
playwright.config.ts               browser test configuration
tsconfig.json                      TypeScript project configuration
vite.config.ts                     Vite and Vitest configuration
public/assets/jingxiang-map.png    approved original map asset
src/main.tsx                       application entry
src/styles/global.css              reset, tokens, responsive shell styles
src/app/App.tsx                    start/game/result screen routing
src/app/App.test.tsx               application smoke test
src/game/types.ts                  domain types and command union
src/game/scenario/jingxiang208.ts  immutable scenario fixture and createGame
src/game/scenario/jingxiang208.test.ts scenario integrity tests
src/game/random.ts                 seeded PRNG
src/game/random.test.ts            PRNG reproducibility tests
src/game/commands.ts               command validation and execution
src/game/commands.test.ts          command rule tests
src/game/score.ts                  force score and final ranking
src/game/score.test.ts             score and tie-break tests
src/game/turn.ts                   month settlement and event application
src/game/turn.test.ts              settlement tests
src/game/ai.ts                     AI priorities and legal command selection
src/game/ai.test.ts                AI behavior tests
src/game/persistence.ts            versioned local save adapter
src/game/persistence.test.ts       storage validation tests
src/game/store/GameProvider.tsx    reducer, selectors, autosave orchestration
src/game/store/GameProvider.test.tsx integration tests for state flow
src/components/StartScreen.tsx     force selection and continue controls
src/components/GameShell.tsx       responsive in-game composition
src/components/TopBar.tsx          date, force, action points, next month
src/components/StrategicMap.tsx    map viewport, city overlays, pan and zoom
src/components/StrategicMap.test.tsx map interaction tests
src/components/CityPanel.tsx       city stats and command buttons
src/components/CommandDialog.tsx   officer/target/value command forms
src/components/EventLog.tsx        latest game events
src/components/MiniMap.tsx         viewport and force overview
src/components/ResultOverlay.tsx   24-month ranking and restart
src/components/ErrorBoundary.tsx   recoverable UI failure screen
src/components/game-ui.test.tsx    command and responsive composition tests
e2e/game.spec.ts                   complete browser game flow
```

---

### Task 1: Tooling and Tested Application Shell

**Files:**
- Create: `package.json`, `tsconfig.json`, `vite.config.ts`, `index.html`
- Create: `src/main.tsx`, `src/styles/global.css`, `src/app/App.tsx`
- Test: `src/app/App.test.tsx`

**Interfaces:**
- Consumes: none
- Produces: `App(): JSX.Element`, Vite development/build scripts, Vitest DOM environment

- [ ] **Step 1: Initialize package metadata and install dependencies**

```powershell
npm.cmd init -y
npm.cmd install react react-dom lucide-react
npm.cmd install -D typescript vite @vitejs/plugin-react vitest jsdom @testing-library/react @testing-library/jest-dom @testing-library/user-event @types/react @types/react-dom @playwright/test
```

Expected: `package.json` and `package-lock.json` exist and npm reports no installation failure.

- [ ] **Step 2: Add scripts and TypeScript/Vite configuration**

Set package scripts to:

```json
{
  "scripts": {
    "dev": "vite",
    "build": "tsc --noEmit && vite build",
    "test": "vitest run",
    "test:watch": "vitest",
    "test:e2e": "playwright test"
  }
}
```

Create `vite.config.ts`:

```ts
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    setupFiles: './src/test/setup.ts',
    css: true,
  },
});
```

Create `tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "useDefineForClassFields": true,
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "allowJs": false,
    "skipLibCheck": true,
    "esModuleInterop": true,
    "allowSyntheticDefaultImports": true,
    "strict": true,
    "forceConsistentCasingInFileNames": true,
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noEmit": true,
    "jsx": "react-jsx"
  },
  "include": ["src", "vite.config.ts", "playwright.config.ts", "e2e"]
}
```

Create `src/test/setup.ts`:

```ts
import '@testing-library/jest-dom/vitest';
```

- [ ] **Step 3: Write the failing application smoke test**

```tsx
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { App } from './App';

describe('App', () => {
  it('opens on the force selection screen', () => {
    render(<App />);
    expect(screen.getByRole('heading', { name: '建安十三年：荆襄争夺' })).toBeVisible();
    expect(screen.getByRole('button', { name: '选择刘备' })).toBeEnabled();
  });
});
```

- [ ] **Step 4: Run the test and verify the missing shell failure**

Run: `npm.cmd test -- src/app/App.test.tsx`  
Expected: FAIL because `./App` does not exist.

- [ ] **Step 5: Implement the minimal shell**

```tsx
export function App() {
  return (
    <main className="start-screen">
      <p className="eyebrow">建安十三年 · 公元 208 年</p>
      <h1>建安十三年：荆襄争夺</h1>
      <button type="button">选择刘备</button>
    </main>
  );
}
```

Create `src/main.tsx` with `createRoot(document.getElementById('root')!).render(<App />)` and import `src/styles/global.css`. Create `index.html` with a single `#root` element.

- [ ] **Step 6: Verify test and build**

Run: `npm.cmd test -- src/app/App.test.tsx`  
Expected: PASS, 1 test.

Run: `npm.cmd run build`  
Expected: TypeScript and Vite complete successfully and create `dist/`.

- [ ] **Step 7: Commit**

```powershell
git add package.json package-lock.json tsconfig.json vite.config.ts index.html src
git commit -m "feat: scaffold Jingxiang game app"
```

---

### Task 2: Domain Model and Balanced Scenario Fixture

**Files:**
- Create: `src/game/types.ts`
- Create: `src/game/scenario/jingxiang208.ts`
- Test: `src/game/scenario/jingxiang208.test.ts`

**Interfaces:**
- Consumes: none
- Produces: `ForceId`, `CityId`, `Officer`, `City`, `GameState`, `GameCommand`, `createGame(playerForceId, seed)`

- [ ] **Step 1: Define the domain contracts**

```ts
export type ForceId = 'cao' | 'liu' | 'sun' | 'biao';
export type CityId = 'wan' | 'xiangyang' | 'jiangling' | 'wuling' | 'jiangxia' | 'changsha' | 'lingling' | 'guiyang';

export interface Stats { leadership: number; war: number; intelligence: number; politics: number; charisma: number }
export interface Officer { id: string; name: string; forceId: ForceId | null; cityId: CityId; stats: Stats; acted: boolean }
export interface City {
  id: CityId; name: string; ownerId: ForceId; governorId: string;
  gold: number; food: number; population: number; troops: number;
  commerce: number; agriculture: number; order: number; training: number;
  mapX: number; mapY: number;
}
export interface Force { id: ForceId; name: string; color: string }
export interface GameLog { id: string; month: number; forceId: ForceId | null; message: string }
export interface ForceRanking { forceId: ForceId; name: string; score: number; rank: number; tied: boolean }
export interface GameState {
  schemaVersion: 1; scenarioId: 'jingxiang-208'; seed: number; rngCursor: number;
  month: number; playerForceId: ForceId; phase: 'playing' | 'finished';
  actionPoints: Record<ForceId, number>; forces: Record<ForceId, Force>;
  cities: Record<CityId, City>; officers: Record<string, Officer>; logs: GameLog[];
}
export type GameCommand =
  | { type: 'develop'; cityId: CityId; officerId: string; focus: 'commerce' | 'agriculture' }
  | { type: 'recruit'; cityId: CityId; officerId: string }
  | { type: 'train'; cityId: CityId; officerId: string }
  | { type: 'patrol'; cityId: CityId; officerId: string }
  | { type: 'talent'; cityId: CityId; officerId: string }
  | { type: 'transfer'; cityId: CityId; officerId: string; targetCityId: CityId; gold: number; food: number; troops: number; officerIds: string[] };
```

- [ ] **Step 2: Write scenario integrity tests**

```ts
import { describe, expect, it } from 'vitest';
import { createGame } from './jingxiang208';

describe('jingxiang 208 scenario', () => {
  it('contains the approved amount of content', () => {
    const game = createGame('liu', 20804);
    expect(Object.keys(game.cities)).toHaveLength(8);
    expect(Object.values(game.officers)).toHaveLength(24);
    expect(Object.values(game.officers).filter((officer) => officer.forceId)).toHaveLength(16);
    expect(Object.values(game.officers).filter((officer) => !officer.forceId)).toHaveLength(8);
  });

  it.each(['cao', 'liu', 'sun', 'biao'] as const)('%s starts with two cities and four officers', (forceId) => {
    const game = createGame(forceId, 1);
    expect(Object.values(game.cities).filter((city) => city.ownerId === forceId)).toHaveLength(2);
    expect(Object.values(game.officers).filter((officer) => officer.forceId === forceId)).toHaveLength(4);
    expect(game.actionPoints[forceId]).toBe(80);
  });
});
```

- [ ] **Step 3: Run the tests and verify missing fixture failure**

Run: `npm.cmd test -- src/game/scenario/jingxiang208.test.ts`  
Expected: FAIL because `createGame` does not exist.

- [ ] **Step 4: Implement the exact scenario data**

Use these ownership and talent placements:

```ts
const cityOwners = {
  wan: 'cao', xiangyang: 'cao', jiangling: 'liu', wuling: 'liu',
  jiangxia: 'sun', changsha: 'sun', lingling: 'biao', guiyang: 'biao',
} as const;

const initialCities = [
  ['wan', '宛', 'cao', 'cao-cao', 9000, 30000, 120000, 16000, 60, 45, 82, 72, 0.37, 0.17],
  ['xiangyang', '襄阳', 'cao', 'cao-ren', 8200, 34000, 115000, 14500, 52, 55, 78, 68, 0.25, 0.42],
  ['jiangling', '江陵', 'liu', 'liu-bei', 7600, 38000, 95000, 13500, 48, 65, 80, 72, 0.47, 0.53],
  ['wuling', '武陵', 'liu', 'zhang-fei', 6800, 32000, 85000, 12000, 42, 58, 84, 66, 0.15, 0.68],
  ['jiangxia', '江夏', 'sun', 'sun-quan', 8500, 32000, 100000, 15000, 56, 52, 78, 74, 0.78, 0.17],
  ['changsha', '长沙', 'sun', 'lu-su', 7300, 36000, 98000, 13200, 50, 60, 82, 70, 0.78, 0.38],
  ['lingling', '零陵', 'biao', 'liu-biao', 8500, 35000, 82000, 11000, 48, 62, 90, 65, 0.57, 0.87],
  ['guiyang', '桂阳', 'biao', 'wen-pin', 7100, 36000, 80000, 11500, 47, 63, 88, 67, 0.84, 0.71],
] as const;

const startingOfficers = [
  ['cao-cao', '曹操', 'cao', 'wan', 96, 72, 91, 94, 96],
  ['cao-ren', '曹仁', 'cao', 'xiangyang', 89, 86, 71, 62, 75],
  ['xun-yu', '荀彧', 'cao', 'wan', 52, 14, 95, 98, 92],
  ['xu-huang', '徐晃', 'cao', 'xiangyang', 91, 90, 78, 63, 78],
  ['liu-bei', '刘备', 'liu', 'jiangling', 78, 75, 78, 80, 99],
  ['guan-yu', '关羽', 'liu', 'jiangling', 95, 97, 76, 62, 94],
  ['zhang-fei', '张飞', 'liu', 'wuling', 85, 98, 35, 22, 45],
  ['zhuge-liang', '诸葛亮', 'liu', 'wuling', 92, 38, 100, 98, 92],
  ['sun-quan', '孙权', 'sun', 'jiangxia', 78, 67, 83, 89, 94],
  ['zhou-yu', '周瑜', 'sun', 'jiangxia', 97, 71, 96, 86, 93],
  ['lu-su', '鲁肃', 'sun', 'changsha', 78, 56, 92, 94, 91],
  ['gan-ning', '甘宁', 'sun', 'changsha', 86, 94, 76, 55, 81],
  ['liu-biao', '刘表', 'biao', 'lingling', 67, 42, 69, 83, 84],
  ['kuai-yue', '蒯越', 'biao', 'lingling', 48, 31, 89, 91, 82],
  ['cai-mao', '蔡瑁', 'biao', 'guiyang', 75, 68, 72, 73, 58],
  ['wen-pin', '文聘', 'biao', 'guiyang', 87, 84, 74, 66, 79],
] as const;

const talents = [
  ['zhao-yun', '赵云', 'jiangling', 91, 96, 76, 65, 81],
  ['pang-tong', '庞统', 'xiangyang', 78, 36, 98, 92, 69],
  ['huang-zhong', '黄忠', 'changsha', 88, 94, 68, 60, 74],
  ['wei-yan', '魏延', 'wuling', 89, 92, 69, 54, 65],
  ['ma-liang', '马良', 'jiangling', 46, 28, 88, 91, 89],
  ['jiang-wan', '蒋琬', 'lingling', 52, 31, 87, 94, 84],
  ['yi-ji', '伊籍', 'xiangyang', 38, 24, 82, 86, 90],
  ['mi-zhu', '糜竺', 'guiyang', 32, 22, 78, 92, 88],
] as const;
```

Map each `initialCities` tuple in this order: id, name, owner, governor, gold, food, population, troops, commerce, agriculture, order, training, mapX, mapY. `createGame` must deep-create mutable records, set month to 1, set every force to 80 action points, and mark all officers unacted.

- [ ] **Step 5: Verify scenario tests**

Run: `npm.cmd test -- src/game/scenario/jingxiang208.test.ts`  
Expected: PASS, 5 tests.

- [ ] **Step 6: Commit**

```powershell
git add src/game/types.ts src/game/scenario
git commit -m "feat: add balanced Jingxiang scenario"
```

---

### Task 3: Seeded Randomness and Command Engine

**Files:**
- Create: `src/game/random.ts`, `src/game/commands.ts`
- Test: `src/game/random.test.ts`, `src/game/commands.test.ts`

**Interfaces:**
- Consumes: `GameState`, `GameCommand`, `ForceId`
- Produces: `nextRandom(seed, cursor): { value: number; cursor: number }`, `validateCommand(state, forceId, command): string[]`, `executeCommand(state, forceId, command): GameState`

- [ ] **Step 1: Write failing PRNG and command tests**

```ts
it('replays the same random stream', () => {
  expect(nextRandom(20804, 3)).toEqual(nextRandom(20804, 3));
  expect(nextRandom(20804, 3).value).toBeGreaterThanOrEqual(0);
  expect(nextRandom(20804, 3).value).toBeLessThan(1);
});

it('develops commerce and consumes the officer action', () => {
  const state = createGame('liu', 1);
  const next = executeCommand(state, 'liu', { type: 'develop', cityId: 'jiangling', officerId: 'liu-bei', focus: 'commerce' });
  expect(next.cities.jiangling.commerce).toBe(state.cities.jiangling.commerce + 8);
  expect(next.cities.jiangling.gold).toBe(state.cities.jiangling.gold - 500);
  expect(next.actionPoints.liu).toBe(60);
  expect(next.officers['liu-bei'].acted).toBe(true);
});

it('returns specific validation messages', () => {
  const state = createGame('liu', 1);
  state.cities.jiangling.gold = 100;
  expect(validateCommand(state, 'liu', { type: 'develop', cityId: 'jiangling', officerId: 'liu-bei', focus: 'commerce' }))
    .toContain('资金不足 500');
});
```

- [ ] **Step 2: Verify the tests fail**

Run: `npm.cmd test -- src/game/random.test.ts src/game/commands.test.ts`  
Expected: FAIL because random and command functions are missing.

- [ ] **Step 3: Implement deterministic randomness**

```ts
export function nextRandom(seed: number, cursor: number) {
  let value = (seed + cursor * 0x9e3779b9) >>> 0;
  value ^= value << 13;
  value ^= value >>> 17;
  value ^= value << 5;
  return { value: (value >>> 0) / 0x100000000, cursor: cursor + 1 };
}
```

- [ ] **Step 4: Implement command costs, validation, and immutable execution**

```ts
export const COMMAND_AP = { develop: 20, recruit: 20, train: 15, patrol: 15, talent: 20, transfer: 10 } as const;

export function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, Math.round(value)));
}

export function validateCommand(state: GameState, forceId: ForceId, command: GameCommand): string[] {
  const errors: string[] = [];
  const city = state.cities[command.cityId];
  const officer = state.officers[command.officerId];
  if (state.phase !== 'playing') errors.push('本局已经结束');
  if (city.ownerId !== forceId) errors.push('只能管理己方城市');
  if (officer.forceId !== forceId || officer.cityId !== command.cityId) errors.push('武将不在目标城市');
  if (officer.acted) errors.push(`${officer.name}本月已行动`);
  if (state.actionPoints[forceId] < COMMAND_AP[command.type]) errors.push(`行动力不足 ${COMMAND_AP[command.type]}`);
  const goldCost = command.type === 'develop' ? 500 : command.type === 'recruit' ? 800 : command.type === 'patrol' ? 300 : command.type === 'talent' ? 500 : 0;
  if (city.gold < goldCost) errors.push(`资金不足 ${goldCost}`);
  if (command.type === 'recruit' && city.food < 500) errors.push('粮草不足 500');
  if (command.type === 'train' && city.food < 300) errors.push('粮草不足 300');
  return errors;
}
```

`executeCommand` must throw `Error(errors.join('；'))` on invalid input, use `structuredClone(state)`, apply the exact formulas in the spec, append one Chinese log entry, mark the executing officer acted, and deduct command action points. Talent search consumes one PRNG value and updates `rngCursor`; transfer rejects negative amounts and source-city shortages.

Use a complete switch with these state changes:

```ts
switch (command.type) {
  case 'develop': {
    city.gold -= 500;
    city[command.focus] = clamp(city[command.focus] + 4 + Math.floor(officer.stats.politics / 20), 0, 100);
    break;
  }
  case 'recruit': {
    city.gold -= 800; city.food -= 500; city.population -= 500;
    city.troops += 300 + officer.stats.charisma * 10;
    city.order = clamp(city.order - 2, 0, 100);
    break;
  }
  case 'train':
    city.food -= 300;
    city.training = clamp(city.training + 5 + Math.floor(officer.stats.leadership / 20), 0, 100);
    break;
  case 'patrol':
    city.gold -= 300;
    city.order = clamp(city.order + 4 + Math.floor(officer.stats.charisma / 20), 0, 100);
    break;
  case 'talent':
    city.gold -= 500;
    resolveTalentSearch(next, city, officer);
    break;
  case 'transfer':
    applyTransfer(next, command);
    break;
}
next.actionPoints[forceId] -= COMMAND_AP[command.type];
next.officers[command.officerId].acted = true;
```

`resolveTalentSearch` selects only `forceId === null` officers in the city, compares one `nextRandom` result with `min(85, 35 + floor(intelligence / 2))`, and recruits the first candidate on success. `applyTransfer` subtracts and adds the requested resources and updates each selected officer's `cityId` after all bounds and ownership checks pass.

- [ ] **Step 5: Add branch tests for all six commands**

Add tests for property cap 100, recruit population/order changes, training, patrol, talent success/failure with fixed seeds, transfer ownership/resource checks, negative transfer rejection, and no mutation of the input state.

```ts
it.each([
  ['commerce', 99], ['agriculture', 100],
] as const)('caps developed %s at 100', (focus, initial) => {
  const state = createGame('liu', 1);
  state.cities.jiangling[focus] = initial;
  const next = executeCommand(state, 'liu', { type: 'develop', cityId: 'jiangling', officerId: 'liu-bei', focus });
  expect(next.cities.jiangling[focus]).toBe(100);
  expect(state.cities.jiangling[focus]).toBe(initial);
});
```

Run: `npm.cmd test -- src/game/random.test.ts src/game/commands.test.ts`  
Expected: PASS with at least 14 tests.

- [ ] **Step 6: Commit**

```powershell
git add src/game/random.ts src/game/random.test.ts src/game/commands.ts src/game/commands.test.ts
git commit -m "feat: implement Jingxiang command engine"
```

---

### Task 4: Scoring, Monthly Settlement, and AI

**Files:**
- Create: `src/game/score.ts`, `src/game/turn.ts`, `src/game/ai.ts`
- Test: `src/game/score.test.ts`, `src/game/turn.test.ts`, `src/game/ai.test.ts`

**Interfaces:**
- Consumes: `GameState`, command engine, seeded PRNG
- Produces: `scoreForce(state, forceId): number`, `rankForces(state): ForceRanking[]`, `settleMonth(state): GameState`, `chooseAiCommand(state, forceId): GameCommand | null`, `runAiTurn(state, forceId): GameState`

- [ ] **Step 1: Write failing score, settlement, and AI tests**

```ts
it('keeps initial scores within five percent', () => {
  const state = createGame('liu', 1);
  const scores = (['cao', 'liu', 'sun', 'biao'] as const).map((id) => scoreForce(state, id));
  expect(Math.max(...scores) - Math.min(...scores)).toBeLessThanOrEqual(Math.min(...scores) * 0.05);
});

it('settles revenue and restores monthly actions', () => {
  const state = createGame('liu', 1);
  state.actionPoints.liu = 0;
  state.officers['liu-bei'].acted = true;
  const next = settleMonth(state);
  expect(next.month).toBe(2);
  expect(next.actionPoints.liu).toBe(80);
  expect(next.officers['liu-bei'].acted).toBe(false);
  expect(next.cities.jiangling.gold).toBeGreaterThan(state.cities.jiangling.gold);
});

it('prioritizes patrol when order is below 60', () => {
  const state = createGame('liu', 1);
  state.cities.jiangling.order = 40;
  expect(chooseAiCommand(state, 'liu')?.type).toBe('patrol');
});
```

- [ ] **Step 2: Verify tests fail**

Run: `npm.cmd test -- src/game/score.test.ts src/game/turn.test.ts src/game/ai.test.ts`  
Expected: FAIL because exported functions are missing.

- [ ] **Step 3: Implement score and ranking**

```ts
export function scoreForce(state: GameState, forceId: ForceId) {
  const cityScore = Object.values(state.cities).filter((city) => city.ownerId === forceId).reduce((sum, city) =>
    sum + city.commerce * 2 + city.agriculture * 2 + city.order * 1.5 + city.training + city.troops / 100 + city.gold / 500 + city.food / 1000, 0);
  const officerScore = Object.values(state.officers).filter((officer) => officer.forceId === forceId).reduce((sum, officer) =>
    sum + 25 + Object.values(officer.stats).reduce((total, stat) => total + stat, 0) / 25, 0);
  return Math.round(cityScore + officerScore);
}
```

`rankForces` sorts descending by score, then total order, total gold, officer count, and finally keeps equal ranks for complete ties.

- [ ] **Step 4: Implement monthly settlement**

`settleMonth` must clone state, add exact gold/food/population formulas for every city, apply at most one seeded event per city, and reset all action points and officer actions. When the current month is below 24, increment it by one; when the current month is 24, keep month 24 and set `phase: 'finished'`. Event definitions are fixed records for 丰收、旱灾、商旅、流民、疫病、人才传闻 with bounded numeric effects and Chinese logs.

```ts
const EVENTS = [
  { name: '丰收', apply: (city: City) => { city.food += 3000; } },
  { name: '旱灾', apply: (city: City) => { city.food = Math.max(0, city.food - 3000); city.order = clamp(city.order - 2, 0, 100); } },
  { name: '商旅', apply: (city: City) => { city.gold += 1200; } },
  { name: '流民', apply: (city: City) => { city.population += 2000; city.order = clamp(city.order - 1, 0, 100); } },
  { name: '疫病', apply: (city: City) => { city.population = Math.max(0, city.population - 1500); city.troops = Math.max(0, city.troops - 500); city.order = clamp(city.order - 3, 0, 100); } },
  { name: '人才传闻', apply: (_city: City) => undefined },
] as const;

export function settleMonth(state: GameState) {
  const next = structuredClone(state);
  for (const city of Object.values(next.cities)) {
    city.gold += Math.round(city.commerce * 20 + city.population / 100);
    city.food += Math.round(city.agriculture * 60 + city.population / 40);
    city.population += Math.floor(city.population * 0.005 * city.order / 100);
    const roll = nextRandom(next.seed, next.rngCursor); next.rngCursor = roll.cursor;
    if (roll.value < 0.18) {
      const choice = nextRandom(next.seed, next.rngCursor); next.rngCursor = choice.cursor;
      const event = EVENTS[Math.floor(choice.value * EVENTS.length)];
      event.apply(city);
      next.logs.push({ id: `event-${next.month}-${city.id}-${next.rngCursor}`, month: next.month, forceId: city.ownerId, message: `${city.name}发生${event.name}` });
    }
  }
  for (const forceId of Object.keys(next.actionPoints) as ForceId[]) next.actionPoints[forceId] = 80;
  for (const officer of Object.values(next.officers)) officer.acted = false;
  if (next.month === 24) next.phase = 'finished'; else next.month += 1;
  return next;
}
```

- [ ] **Step 5: Implement AI priority loop**

```ts
export function runAiTurn(initial: GameState, forceId: ForceId) {
  let state = initial;
  let guard = 0;
  while (state.actionPoints[forceId] >= 10 && guard < 12) {
    const command = chooseAiCommand(state, forceId);
    if (!command) break;
    state = executeCommand(state, forceId, command);
    guard += 1;
  }
  return state;
}
```

`chooseAiCommand` follows the approved order threshold, food reserve, low-gold, training, recruitment, talent, and weighted-development rules. It must select only unacted officers in owned cities and return `null` if no legal command exists.

- [ ] **Step 6: Verify engine tests**

Run: `npm.cmd test -- src/game/score.test.ts src/game/turn.test.ts src/game/ai.test.ts`  
Expected: PASS with at least 12 tests, including month-24 finish and tie-break order.

- [ ] **Step 7: Commit**

```powershell
git add src/game/score* src/game/turn* src/game/ai* src/game/scenario/jingxiang208.ts
git commit -m "feat: add monthly turns scoring and AI"
```

---

### Task 5: Versioned Saves and Game Store

**Files:**
- Create: `src/game/persistence.ts`
- Create: `src/game/store/GameProvider.tsx`
- Test: `src/game/persistence.test.ts`, `src/game/store/GameProvider.test.tsx`

**Interfaces:**
- Consumes: scenario factory, command engine, AI, turn settlement
- Produces: `SaveAdapter`, `loadSave`, `writeSave`, `GameProvider`, `useGame`, UI actions `startGame`, `issueCommand`, `endMonth`, `manualSave`, `resetGame`; `GameProvider` accepts optional `initialState?: GameState` for isolated tests

- [ ] **Step 1: Write failing persistence tests with in-memory storage**

```ts
const memory = new Map<string, string>();
const storage = { getItem: (key: string) => memory.get(key) ?? null, setItem: (key: string, value: string) => memory.set(key, value), removeItem: (key: string) => memory.delete(key) };

it('round-trips a valid v1 save', () => {
  const state = createGame('liu', 9);
  writeSave(storage, 'auto', state);
  expect(loadSave(storage, 'auto')).toEqual({ ok: true, state });
});

it('rejects corrupt data without deleting it', () => {
  storage.setItem(AUTO_SAVE_KEY, '{broken');
  expect(loadSave(storage, 'auto')).toEqual({ ok: false, reason: '存档无法读取' });
  expect(storage.getItem(AUTO_SAVE_KEY)).toBe('{broken');
});
```

- [ ] **Step 2: Implement save validation**

```ts
export const AUTO_SAVE_KEY = 'jingxiang-208-autosave-v1';
export const MANUAL_SAVE_KEY = 'jingxiang-208-manual-v1';
export type SaveSlot = 'auto' | 'manual';
export interface SaveAdapter { getItem(key: string): string | null; setItem(key: string, value: string): void; removeItem(key: string): void }
export type LoadResult = { ok: true; state: GameState } | { ok: false; reason: '没有存档' | '存档无法读取' | '存档版本不兼容' };

export function isGameState(value: unknown): value is GameState {
  if (!value || typeof value !== 'object') return false;
  const state = value as Partial<GameState>;
  return state.schemaVersion === 1 && state.scenarioId === 'jingxiang-208' &&
    typeof state.month === 'number' && state.month >= 1 && state.month <= 24 &&
    !!state.cities && !!state.officers && !!state.actionPoints;
}
```

`writeSave` serializes only valid states. `loadSave` catches JSON errors, validates every city percentage/resource and officer stat, returns a Chinese reason on failure, and never removes invalid raw data.

- [ ] **Step 3: Write failing provider flow test**

Render `GameProvider` with a test consumer. Start Liu Bei, issue patrol in Jiangling, end the month, and assert month 2, three AI turns logged, and autosave written.

```tsx
function Probe() {
  const game = useGame();
  return <><output>{game.state?.month ?? 0}</output><button onClick={() => game.startGame('liu', 1)}>start</button><button onClick={() => game.endMonth()}>end</button></>;
}

it('runs AI, settles, and autosaves', async () => {
  const user = userEvent.setup();
  render(<GameProvider><Probe /></GameProvider>);
  await user.click(screen.getByRole('button', { name: 'start' }));
  await user.click(screen.getByRole('button', { name: 'end' }));
  expect(screen.getByText('2')).toBeVisible();
  expect(window.localStorage.getItem(AUTO_SAVE_KEY)).not.toBeNull();
});
```

Run: `npm.cmd test -- src/game/persistence.test.ts src/game/store/GameProvider.test.tsx`  
Expected: FAIL because provider and save adapter are missing.

- [ ] **Step 4: Implement reducer and provider actions**

```ts
type GameAction =
  | { type: 'start'; forceId: ForceId; seed: number }
  | { type: 'load'; state: GameState }
  | { type: 'replace'; state: GameState }
  | { type: 'reset' };

function reducer(state: GameState | null, action: GameAction): GameState | null {
  if (action.type === 'start') return createGame(action.forceId, action.seed);
  if (action.type === 'load' || action.type === 'replace') return action.state;
  return null;
}
```

`issueCommand` executes for `playerForceId` and writes autosave. `endMonth` runs each non-player force through `runAiTurn`, then `settleMonth`, then autosaves. Expose selected city separately as UI state so it is not persisted.

- [ ] **Step 5: Verify store tests**

Run: `npm.cmd test -- src/game/persistence.test.ts src/game/store/GameProvider.test.tsx`  
Expected: PASS with at least 8 tests.

- [ ] **Step 6: Commit**

```powershell
git add src/game/persistence* src/game/store
git commit -m "feat: add local saves and game store"
```

---

### Task 6: Force Selection and Responsive Game Composition

**Files:**
- Modify: `src/app/App.tsx`, `src/styles/global.css`
- Create: `src/components/StartScreen.tsx`, `src/components/GameShell.tsx`, `src/components/TopBar.tsx`, `src/components/EventLog.tsx`, `src/components/ErrorBoundary.tsx`
- Test: `src/components/game-ui.test.tsx`

**Interfaces:**
- Consumes: `GameProvider`, `useGame`, save status
- Produces: start/continue/restart UI and stable desktop/mobile game frame

- [ ] **Step 1: Write failing start and shell tests**

```tsx
it('starts any approved force', async () => {
  const user = userEvent.setup();
  render(<App />);
  await user.click(screen.getByRole('button', { name: '选择孙权' }));
  expect(screen.getByText('孙权')).toBeVisible();
  expect(screen.getByRole('button', { name: '进行到下月' })).toBeEnabled();
});

it('offers continue only when a valid autosave exists', () => {
  writeSave(window.localStorage, 'auto', createGame('cao', 1));
  render(<App />);
  expect(screen.getByRole('button', { name: '继续游戏' })).toBeEnabled();
});
```

- [ ] **Step 2: Run and verify failure**

Run: `npm.cmd test -- src/components/game-ui.test.tsx`  
Expected: FAIL because start and game components are missing.

- [ ] **Step 3: Implement screen routing and semantic controls**

```tsx
export function App() {
  return (
    <ErrorBoundary>
      <GameProvider>
        <AppContent />
      </GameProvider>
    </ErrorBoundary>
  );
}

function AppContent() {
  const { state } = useGame();
  if (!state) return <StartScreen />;
  if (state.phase === 'finished') return <ResultOverlay />;
  return <GameShell />;
}
```

StartScreen renders four force buttons with faction color swatches, leader name, initial cities, and a continue button only for a valid autosave. ErrorBoundary shows “界面发生错误” with “返回开始界面” instead of a blank page.

- [ ] **Step 4: Add stable responsive shell CSS**

Use a full-viewport `.game-shell` grid with a fixed top bar, map area, right panel, bottom-left log, and bottom-right minimap. At `max-width: 700px`, keep the map full viewport and move city controls to a `max-height: 58dvh` bottom sheet. Buttons and labels must use fixed minimum dimensions and allow Chinese wrapping without viewport-scaled font sizes.

```css
.game-shell { min-height: 100dvh; display: grid; grid-template: 64px 1fr / 1fr 320px; overflow: hidden; }
.top-bar { grid-column: 1 / -1; min-height: 64px; }
.map-region { position: relative; min-width: 0; min-height: 0; overflow: hidden; }
.city-panel { width: 320px; overflow: auto; }
button { min-height: 40px; white-space: normal; }
@media (max-width: 700px) {
  .game-shell { display: block; position: relative; }
  .map-region { height: calc(100dvh - 56px); }
  .city-panel { position: fixed; inset: auto 0 0; width: 100%; max-height: 58dvh; overflow: auto; }
}
```

- [ ] **Step 5: Verify UI tests and build**

Run: `npm.cmd test -- src/components/game-ui.test.tsx`  
Expected: PASS for all start/continue/error tests.

Run: `npm.cmd run build`  
Expected: PASS.

- [ ] **Step 6: Commit**

```powershell
git add src/app src/components src/styles
git commit -m "feat: add responsive game shell"
```

---

### Task 7: Detailed Strategic Map and City Information

**Files:**
- Create: `public/assets/jingxiang-map.png`
- Create: `src/components/StrategicMap.tsx`, `src/components/CityPanel.tsx`, `src/components/MiniMap.tsx`
- Test: `src/components/StrategicMap.test.tsx`
- Modify: `src/components/GameShell.tsx`, `src/styles/global.css`

**Interfaces:**
- Consumes: city coordinates, force colors, selected-city store action, approved generated concept asset
- Produces: pan/zoom transform, city hit targets, synchronized minimap viewport, selected-city statistics

- [ ] **Step 1: Copy the approved original map asset into the application**

```powershell
New-Item -ItemType Directory -Force public/assets
Copy-Item -LiteralPath '.superpowers/brainstorm/729-1784039631/content/map-concept-v2.png' -Destination 'public/assets/jingxiang-map.png'
```

Expected: `public/assets/jingxiang-map.png` exists and is larger than 1 MB.

- [ ] **Step 2: Write failing map interaction tests**

```tsx
function renderGame(forceId: ForceId) {
  return render(
    <GameProvider initialState={createGame(forceId, 1)}>
      <GameShell />
    </GameProvider>,
  );
}

it('selects a city from its map marker', async () => {
  const user = userEvent.setup();
  renderGame('liu');
  await user.click(screen.getByRole('button', { name: /江陵.*刘备/ }));
  expect(screen.getByRole('heading', { name: '江陵' })).toBeVisible();
});

it('zooms within the supported range', () => {
  renderGame('liu');
  const viewport = screen.getByTestId('map-viewport');
  fireEvent.wheel(viewport, { deltaY: -120 });
  expect(screen.getByTestId('map-content')).toHaveStyle({ transform: expect.stringContaining('scale(1.15)') });
});
```

- [ ] **Step 3: Implement pointer-safe map transforms**

```tsx
const [view, setView] = useState({ x: 0, y: 0, scale: 1 });
const zoom = (delta: number) => setView((current) => ({
  ...current,
  scale: Math.min(2.4, Math.max(0.85, Number((current.scale + delta).toFixed(2)))),
}));
```

Use pointer capture for drag, ignore drag starts from buttons, and apply one transform to the image plus all city markers so they never drift apart. Each city marker is a real button with force-color swatch, name, owner, and troops in its accessible label.

- [ ] **Step 4: Implement city panel and minimap**

CityPanel displays governor, order, gold, food, population, troops, commerce, agriculture, training, available officers, and six command buttons. MiniMap renders the eight city positions and a viewport rectangle derived from the same `view` state. On mobile, CityPanel uses the bottom sheet and preserves the visible selected marker above it.

```tsx
<aside className="city-panel" aria-label={`${city.name}经营面板`}>
  <h2>{city.name}</h2>
  <dl>{Object.entries(cityStats).map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
  <div className="command-grid">
    {(['develop', 'recruit', 'train', 'patrol', 'talent', 'transfer'] as const).map((type) =>
      <button key={type} type="button" onClick={() => openCommand(type)}>{COMMAND_LABELS[type]}</button>)}
  </div>
</aside>
```

- [ ] **Step 5: Verify map tests and inspect the asset**

Run: `npm.cmd test -- src/components/StrategicMap.test.tsx`  
Expected: PASS for selection, drag, zoom bounds, and map/city transform alignment.

Run: `npm.cmd run build`  
Expected: PASS and the map asset appears in `dist/assets` or is served from `dist/assets/jingxiang-map.png`.

- [ ] **Step 6: Commit**

```powershell
git add public/assets src/components src/styles/global.css
git commit -m "feat: add detailed interactive Jingxiang map"
```

---

### Task 8: Command Dialogs, Logs, and Final Ranking

**Files:**
- Create: `src/components/CommandDialog.tsx`, `src/components/ResultOverlay.tsx`
- Modify: `src/components/CityPanel.tsx`, `src/components/EventLog.tsx`, `src/components/TopBar.tsx`, `src/components/game-ui.test.tsx`

**Interfaces:**
- Consumes: `issueCommand`, `endMonth`, `rankForces`, `validateCommand`
- Produces: complete player command flow and end-of-game presentation

- [ ] **Step 1: Write failing command-flow tests**

```tsx
function renderGame(forceId: ForceId) {
  return render(
    <GameProvider initialState={createGame(forceId, 1)}>
      <GameShell />
    </GameProvider>,
  );
}

function renderFinishedGame() {
  const state = createGame('liu', 1);
  state.month = 24;
  state.phase = 'finished';
  return render(
    <GameProvider initialState={state}>
      <ResultOverlay />
    </GameProvider>,
  );
}

it('executes patrol through the dialog and explains disabled officers', async () => {
  const user = userEvent.setup();
  renderGame('liu');
  await user.click(screen.getByRole('button', { name: /江陵.*刘备/ }));
  await user.click(screen.getByRole('button', { name: '巡察' }));
  await user.selectOptions(screen.getByLabelText('执行武将'), 'liu-bei');
  await user.click(screen.getByRole('button', { name: '执行巡察' }));
  expect(screen.getByText(/刘备.*巡察/)).toBeVisible();
  expect(screen.getByRole('option', { name: /刘备.*本月已行动/ })).toBeDisabled();
});

it('shows final rankings after month 24', async () => {
  renderFinishedGame();
  expect(screen.getByRole('heading', { name: '荆襄国力结算' })).toBeVisible();
  expect(screen.getAllByRole('row')).toHaveLength(5);
});
```

- [ ] **Step 2: Verify tests fail**

Run: `npm.cmd test -- src/components/game-ui.test.tsx`  
Expected: FAIL because command and result components are missing.

- [ ] **Step 3: Implement command-specific forms**

CommandDialog always renders current costs, predicted effect, an officer selector, validation messages, cancel, and one explicit submit button. Develop adds commerce/agriculture segmented buttons. Transfer adds target city, numeric resource inputs with `min=0`, and officer checkboxes. All other commands use officer selection only. Submit catches engine errors and keeps the dialog open with the engine message.

```tsx
<dialog open aria-labelledby="command-title">
  <h2 id="command-title">{COMMAND_LABELS[type]}</h2>
  <p>{costSummary}</p>
  <label>执行武将<select value={officerId} onChange={(event) => setOfficerId(event.target.value)}>{officerOptions}</select></label>
  {type === 'develop' && <fieldset><legend>开发方向</legend><label><input type="radio" value="commerce" checked={focus === 'commerce'} onChange={() => setFocus('commerce')} />商业</label><label><input type="radio" value="agriculture" checked={focus === 'agriculture'} onChange={() => setFocus('agriculture')} />农业</label></fieldset>}
  <div role="alert">{errors.join('；')}</div>
  <button type="button" onClick={onCancel}>取消</button>
  <button type="button" disabled={errors.length > 0} onClick={submit}>执行{COMMAND_LABELS[type]}</button>
</dialog>
```

- [ ] **Step 4: Implement logs, month confirmation, and result screen**

EventLog keeps the newest 50 logs, shows newest first, and uses faction-color markers. “进行到下月” opens a confirmation if legal player actions remain. ResultOverlay renders force, score, rank, tie label, “重新开局”, and “查看最终地图”; it does not permit further commands.

```tsx
<section className="result-overlay" aria-labelledby="result-title">
  <h1 id="result-title">荆襄国力结算</h1>
  <table><thead><tr><th>排名</th><th>势力</th><th>国力</th></tr></thead><tbody>{rankings.map((row) => <tr key={row.forceId}><td>{row.rank}</td><td>{row.name}</td><td>{row.score}</td></tr>)}</tbody></table>
  <button type="button" onClick={resetGame}>重新开局</button>
  <button type="button" onClick={() => setShowFinalMap(true)}>查看最终地图</button>
</section>
```

- [ ] **Step 5: Verify all component and engine tests**

Run: `npm.cmd test`  
Expected: PASS for the complete Vitest suite with no unhandled console errors.

- [ ] **Step 6: Commit**

```powershell
git add src/components src/game
git commit -m "feat: complete Jingxiang management loop"
```

---

### Task 9: End-to-End Verification and Visual Hardening

**Files:**
- Create: `playwright.config.ts`, `e2e/game.spec.ts`
- Modify: UI/CSS files only when a failing browser assertion identifies a concrete issue

**Interfaces:**
- Consumes: complete application
- Produces: automated desktop/mobile proof of the full game loop

- [ ] **Step 1: Configure Playwright and install Chromium**

```ts
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  webServer: { command: 'npm.cmd run dev -- --host 127.0.0.1 --port 4173', port: 4173, reuseExistingServer: true },
  use: { baseURL: 'http://127.0.0.1:4173', screenshot: 'only-on-failure', trace: 'retain-on-failure' },
  projects: [
    { name: 'desktop-1440', use: { viewport: { width: 1440, height: 900 } } },
    { name: 'desktop-1920', use: { viewport: { width: 1920, height: 1080 } } },
    { name: 'mobile-390', use: { ...devices['iPhone 13'], viewport: { width: 390, height: 844 } } },
  ],
});
```

Run: `npx.cmd playwright install chromium`  
Expected: Chromium installs successfully.

- [ ] **Step 2: Write the complete browser flow**

```ts
import { expect, test } from '@playwright/test';

test('plays, saves, reloads, and reaches ranking', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: '选择刘备' }).click();
  await page.getByRole('button', { name: /江陵.*刘备/ }).click();
  await page.getByRole('button', { name: '巡察' }).click();
  await page.getByLabel('执行武将').selectOption('liu-bei');
  await page.getByRole('button', { name: '执行巡察' }).click();
  await expect(page.getByText(/刘备.*巡察/)).toBeVisible();
  await page.reload();
  await page.getByRole('button', { name: '继续游戏' }).click();
  await expect(page.getByText(/刘备.*巡察/)).toBeVisible();
  for (let month = 1; month <= 24; month += 1) {
    await page.getByRole('button', { name: '进行到下月' }).click();
    const confirm = page.getByRole('button', { name: '确认进行' });
    if (await confirm.isVisible()) await confirm.click();
  }
  await expect(page.getByRole('heading', { name: '荆襄国力结算' })).toBeVisible();
});
```

- [ ] **Step 3: Add visual and geometry assertions**

For each project assert the map image has non-zero natural dimensions, every city button bounding box is inside the map viewport, no horizontal page scrollbar exists, the selected city panel does not overlap the top bar, and all six command buttons are reachable. Capture `artifacts/jingxiang-desktop.png` and `artifacts/jingxiang-mobile.png` for final inspection.

```ts
const naturalWidth = await page.getByTestId('map-image').evaluate((image: HTMLImageElement) => image.naturalWidth);
expect(naturalWidth).toBeGreaterThan(0);
const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
const clientWidth = await page.evaluate(() => document.documentElement.clientWidth);
expect(scrollWidth).toBe(clientWidth);
for (const marker of await page.getByTestId('city-marker').all()) {
  const box = await marker.boundingBox();
  expect(box && box.width > 0 && box.height > 0).toBeTruthy();
}
```

- [ ] **Step 4: Run all verification**

Run: `npm.cmd test`  
Expected: all unit and integration tests PASS.

Run: `npm.cmd run build`  
Expected: production build PASS.

Run: `npm.cmd run test:e2e`  
Expected: all three viewport projects PASS with no blank map, overlap, or clipped text assertions.

- [ ] **Step 5: Commit final verification**

```powershell
git add playwright.config.ts e2e src public package.json package-lock.json
git commit -m "test: verify Jingxiang game end to end"
```
