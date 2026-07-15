# Battle System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the first playable turn-based battle slice: staggered grid movement, one-cell army units, seven-cell cities, deploy, move, attack, siege, and ten-day turn advancement.

**Architecture:** Keep deterministic rules in `src/game` with no React dependency. Add focused modules for grid math, battle actions, and battle scenario data, then connect them through the existing provider and map UI. React renders only committed game state.

**Tech Stack:** React 19, TypeScript, Vite, Vitest, Testing Library.

## Global Constraints

- Use the confirmed staggered square grid: even columns shift upward by half a cell.
- Each cell has six movement neighbors; the seventh action option is wait.
- Each army unit occupies exactly one grid cell; units cannot stack.
- Each city occupies exactly seven cells: center plus six adjacent cells.
- Default visual grid target is about `42–44px` on desktop.
- First battle version has one basic unit type only.
- Rules modules must not depend on React, Canvas, DOM, or browser storage.
- Follow TDD: write failing tests before production code.

---

### Task 1: Grid And City Footprint

**Files:**
- Create: `src/game/battle/grid.ts`
- Test: `src/game/battle/grid.test.ts`

**Interfaces:**
- Produces: `neighborsOf(q: number, r: number): GridCoord[]`
- Produces: `gridKey(coord: GridCoord): string`
- Produces: `sevenCellCityFootprint(center: GridCoord): GridCoord[]`
- Produces: `isSameCoord(a: GridCoord, b: GridCoord): boolean`

- [ ] **Step 1: Write failing tests** for even/odd six-direction neighbors and seven-cell city footprint.
- [ ] **Step 2: Run** `npm test -- src/game/battle/grid.test.ts` and verify missing module failure.
- [ ] **Step 3: Implement minimal grid helpers** in `grid.ts`.
- [ ] **Step 4: Re-run** `npm test -- src/game/battle/grid.test.ts` and verify pass.
- [ ] **Step 5: Commit** `test+feat: add staggered grid helpers`.

### Task 2: Battle Types And Scenario Grid

**Files:**
- Modify: `src/game/types.ts`
- Modify: `src/game/scenario/jingxiang208.ts`
- Create: `src/game/battle/scenario.ts`
- Test: `src/game/battle/scenario.test.ts`

**Interfaces:**
- Produces: `TerrainType`, `GridCell`, `ArmyUnit`, `TenDay`, `OfficerLocation`
- Produces: `createBattleGrid(): GridCell[]`
- Produces: city `gridQ`, `gridR`, `durability`, `maxDurability`
- Produces: game state `schemaVersion: 2`, `tenDay`, `turnForceId`, `grid`, `units`

- [ ] **Step 1: Write failing tests** proving new games are schema v2, have three ten-day state, city seven-cell centers, and an empty unit map.
- [ ] **Step 2: Run** `npm test -- src/game/battle/scenario.test.ts` and verify type/runtime failures.
- [ ] **Step 3: Extend types and scenario creation** with battle fields.
- [ ] **Step 4: Re-run scenario and existing scenario tests**.
- [ ] **Step 5: Commit** `feat: initialize battle scenario state`.

### Task 3: Deploy And Movement Rules

**Files:**
- Create: `src/game/battle/actions.ts`
- Test: `src/game/battle/actions.test.ts`

**Interfaces:**
- Produces: `deployUnit(state, forceId, input): GameState`
- Produces: `moveUnit(state, forceId, unitId, destination): GameState`
- Produces: `waitUnit(state, forceId, unitId): GameState`
- Produces: validation errors through thrown `Error`

- [ ] **Step 1: Write failing tests** for deploy resource costs, one-cell unit spawn outside seven-cell city, blocked stacking, and movement cost.
- [ ] **Step 2: Run** `npm test -- src/game/battle/actions.test.ts` and verify missing module failure.
- [ ] **Step 3: Implement deploy, movement range cost, occupation checks, and wait.**
- [ ] **Step 4: Re-run battle action tests.**
- [ ] **Step 5: Commit** `feat: add deploy and movement rules`.

### Task 4: Attack, Siege, Supply, And Ten-Day Turns

**Files:**
- Modify: `src/game/battle/actions.ts`
- Modify: `src/game/turn.ts`
- Test: `src/game/battle/actions.test.ts`
- Test: `src/game/turn.test.ts`

**Interfaces:**
- Produces: `attackUnit(state, forceId, attackerId, targetId): GameState`
- Produces: `attackCity(state, forceId, attackerId, cityId): GameState`
- Produces: `settleTenDay(state): GameState`

- [ ] **Step 1: Write failing tests** for adjacent attack, counterattack, siege damage, capture, food consumption, and ten-day advancement.
- [ ] **Step 2: Run focused tests** and verify expected failures.
- [ ] **Step 3: Implement attack, counterattack, siege, capture, supply, and ten-day advancement.**
- [ ] **Step 4: Re-run focused tests plus `npm test -- src/game/turn.test.ts`.**
- [ ] **Step 5: Commit** `feat: resolve battle combat and ten-day turns`.

### Task 5: UI Integration For Playable Slice

**Files:**
- Modify: `src/game/store/GameProvider.tsx`
- Modify: `src/components/StrategicMap.tsx`
- Modify: `src/components/CityPanel.tsx`
- Create: `src/components/BattlePanel.tsx`
- Test: `src/components/game-ui.test.tsx`

**Interfaces:**
- Exposes provider methods: `deployUnit`, `moveUnit`, `attackUnit`, `attackCity`, `waitUnit`, `endTenDay`
- Renders visible grid, seven-cell city footprint, one-cell units, selected unit panel, and deploy command entry.

- [ ] **Step 1: Write failing UI tests** for deploy button visibility, unit rendering after deploy, and ending a ten-day turn.
- [ ] **Step 2: Run UI tests** and verify expected failures.
- [ ] **Step 3: Connect provider battle methods and render basic SVG grid/unit overlay.**
- [ ] **Step 4: Re-run UI tests and `npm run build`.**
- [ ] **Step 5: Commit** `feat: connect playable battle slice`.
