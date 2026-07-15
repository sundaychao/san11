# Map Editor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a playable map editing mode over the existing staggered battle map.

**Architecture:** Keep editor behavior in pure functions under `src/game/map-editor`, then connect those functions through a small React panel and optional editing props on `StrategicMap`. The active campaign state remains read-only while editing.

**Tech Stack:** React 19, TypeScript, Vitest, Testing Library, existing SVG grid rendering.

## Global Constraints

- Use the existing staggered grid coordinate system and city footprint logic.
- Do not mutate current `GameState` while editing.
- New functions must be covered by failing tests before implementation.
- Keep the first version focused on terrain painting, city placement, undo/redo, clear, and JSON/SVG export.

---

### Task 1: Editor Core

**Files:**
- Create: `src/game/map-editor/editor.ts`
- Test: `src/game/map-editor/editor.test.ts`

**Interfaces:**
- Consumes: `GridCell`, `TerrainType`, `GRID_WIDTH`, `GRID_HEIGHT`, `sevenCellCityFootprint`
- Produces: `createEditorState`, `paintTerrain`, `placeCity`, `undoEditor`, `redoEditor`, `clearEditor`, `exportEditorJson`, `exportEditorSvg`

- [ ] **Step 1: Write failing tests**

Run `npm.cmd test -- src/game/map-editor/editor.test.ts` and confirm the module does not exist yet.

- [ ] **Step 2: Implement editor core**

Create immutable editor helpers that snapshot history before each edit and produce JSON/SVG export strings.

- [ ] **Step 3: Verify core**

Run `npm.cmd test -- src/game/map-editor/editor.test.ts` and confirm all editor core tests pass.

- [ ] **Step 4: Commit**

Commit with `feat: add map editor core`.

### Task 2: Editor UI

**Files:**
- Create: `src/components/MapEditorPanel.tsx`
- Modify: `src/components/GameShell.tsx`
- Modify: `src/components/StrategicMap.tsx`
- Modify: `src/styles/global.css`
- Test: `src/components/game-ui.test.tsx`

**Interfaces:**
- Consumes: editor core helpers from Task 1 and existing `StrategicMap`
- Produces: a visible editor mode with brush controls, cell editing, city placement, and export output

- [ ] **Step 1: Write failing UI tests**

Add tests for opening the editor, painting a mountain cell, placing a city, and exporting JSON.

- [ ] **Step 2: Implement panel and map editing hooks**

Wire editor state into `GameShell`, add an optional editor mode to `StrategicMap`, and style the panel and editable grid.

- [ ] **Step 3: Verify UI**

Run `npm.cmd test -- src/components/game-ui.test.tsx`.

- [ ] **Step 4: Full verification**

Run `npm.cmd test` and `npm.cmd run build`.

- [ ] **Step 5: Commit**

Commit with `feat: add map editor interface`.
