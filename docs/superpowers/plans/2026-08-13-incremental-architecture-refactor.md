# Incremental Architecture Refactor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reduce the maintenance risk of the current game client, rules engine, and online server without changing game behavior, save compatibility, or the public Socket.IO protocol.

**Architecture:** Introduce one pure `reduceGameIntent` entry point shared by local and online play, then split battle rules behind the existing `battle/actions.ts` compatibility surface. Replace `GameShell`'s mutually exclusive menu booleans with a tested reducer and extract the authentication, online-room, and command-dispatch responsibilities from `GameProvider` while retaining the existing `useGame()` API.

**Tech Stack:** TypeScript 7, React 19, Vite 8, Vitest 4, Testing Library, Socket.IO 4, Node SQLite.

## Global Constraints

- Preserve all current game values and rule outcomes.
- Preserve existing `GameIntent` fields and Socket.IO event names.
- Preserve the current save `schemaVersion` and existing local saves.
- Preserve the public `useGame()` method names and parameters.
- Do not delete `server/data/game.db`, `server/data/users.json`, or legacy room JSON files.
- Do not introduce Redux, Zustand, an ORM, a migration framework, or a monorepo.
- Production modules under `src/game` must not depend on React, DOM, audio, or Socket.IO.
- The worktree already contains user changes. Inspect every diff and do not revert or commit unrelated changes. Production commits require separate user approval because several target files are already dirty.

---

### Task 1: Protect Runtime Data and Add Explicit Room Pruning

**Files:**
- Modify: `.gitignore`
- Modify: `server/database.ts`
- Modify: `server/roomManager.ts`
- Modify: `server/roomManager.test.ts`
- Modify: `src/dev-start-script.test.ts`

**Interfaces:**
- Produces: `GameDatabase.deleteRoomsUpdatedBefore(cutoffIso: string, protectedRoomIds?: string[]): string[]`
- Produces: `RoomManager.pruneRoomsUpdatedBefore(cutoffIso: string): string[]`
- Guarantees: pruning is never called automatically at server startup.

- [ ] **Step 1: Write a failing runtime-data ignore test**

Add to `src/dev-start-script.test.ts`:

```ts
it('keeps generated server data out of git', () => {
  const ignore = readFileSync(path.resolve('.gitignore'), 'utf8');
  expect(ignore).toContain('server/data/*.db');
  expect(ignore).toContain('server/data/*.db-*');
  expect(ignore).toContain('server/data/users.json');
  expect(ignore).toContain('server/data/rooms/*.json');
});
```

- [ ] **Step 2: Run the ignore test and verify RED**

Run: `npm.cmd test -- src/dev-start-script.test.ts`

Expected: FAIL because `.gitignore` does not contain `server/data/*.db`.

- [ ] **Step 3: Add runtime-data patterns**

Append exactly:

```gitignore
server/data/*.db
server/data/*.db-*
server/data/users.json
server/data/rooms/*.json
```

- [ ] **Step 4: Run the ignore test and verify GREEN**

Run: `npm.cmd test -- src/dev-start-script.test.ts`

Expected: all tests in the file pass.

- [ ] **Step 5: Write a failing database pruning test**

Add this asynchronous test to `server/roomManager.test.ts`:

```ts
it('prunes only inactive persisted rooms selected by the caller', async () => {
  const db = await database();
  const manager = new RoomManager({ db });
  const oldRoom = manager.createRoom({ playerId: 'old-host', playerName: 'Old Host', seed: 1 });
  manager.joinRoom({ roomId: oldRoom.room.id, playerId: 'old-guest', playerName: 'Old Guest' });
  manager.selectForce({ roomId: oldRoom.room.id, playerId: 'old-host', forceId: 'liu' });
  manager.selectForce({ roomId: oldRoom.room.id, playerId: 'old-guest', forceId: 'cao' });
  manager.startRoom({ roomId: oldRoom.room.id, playerId: 'old-host' });
  manager.disconnectPlayer('old-host');
  manager.disconnectPlayer('old-guest');

  const activeRoom = manager.createRoom({ playerId: 'active-host', playerName: 'Active Host', seed: 2 });

  expect(manager.pruneRoomsUpdatedBefore('2999-01-01T00:00:00.000Z')).toEqual([oldRoom.room.id]);
  expect(db.loadRooms().map((room) => room.id)).toEqual([activeRoom.room.id]);
});
```

- [ ] **Step 6: Run the room-manager test and verify RED**

Run: `npm.cmd test -- server/roomManager.test.ts`

Expected: FAIL because `pruneRoomsUpdatedBefore` does not exist.

- [ ] **Step 7: Implement explicit pruning**

Add to `GameDatabase`:

```ts
deleteRoomsUpdatedBefore(cutoffIso: string, protectedRoomIds: string[] = []) {
  const candidates = this.db
    .prepare('SELECT id FROM rooms WHERE updated_at < ? ORDER BY id')
    .all(cutoffIso) as unknown as Array<{ id: string }>;
  const protectedIds = new Set(protectedRoomIds);
  const deletedIds = candidates.map(({ id }) => id).filter((id) => !protectedIds.has(id));
  const remove = this.db.prepare('DELETE FROM rooms WHERE id = ?');
  this.db.exec('BEGIN');
  try {
    for (const roomId of deletedIds) remove.run(roomId);
    this.db.exec('COMMIT');
  } catch (error) {
    this.db.exec('ROLLBACK');
    throw error;
  }
  return deletedIds;
}
```

Add to `RoomManager`:

```ts
pruneRoomsUpdatedBefore(cutoffIso: string) {
  const connectedRoomIds = [...this.rooms.values()]
    .filter((room) => Object.values(room.players).some((player) => player.connected))
    .map((room) => room.id);
  const deletedIds = this.db?.deleteRoomsUpdatedBefore(cutoffIso, connectedRoomIds) ?? [];
  for (const roomId of deletedIds) {
    const room = this.rooms.get(roomId);
    if (!room) continue;
    for (const playerId of Object.keys(room.players)) this.playerRooms.delete(playerId);
    this.rooms.delete(roomId);
  }
  return deletedIds;
}
```

- [ ] **Step 8: Verify Task 1**

Run: `npm.cmd test -- server/roomManager.test.ts src/dev-start-script.test.ts`

Expected: both test files pass. Confirm `git status --short` no longer lists newly generated ignored room/database files; already tracked `users.json` may still appear and must not be removed in this task.

---

### Task 2: Create the Shared Game Intent Reducer

**Files:**
- Create: `src/game/network/intentReducer.ts`
- Create: `src/game/network/intentReducer.test.ts`
- Modify: `src/game/network/session.ts`
- Modify: `src/game/network/session.test.ts`

**Interfaces:**
- Consumes: `GameIntent`, `GameState`, `ForceId`, and current battle/command functions.
- Produces: `reduceGameIntent(state, forceId, intent): GameState` for every intent except `endTenDay`.

- [ ] **Step 1: Write failing parity tests**

Create `intentReducer.test.ts` with one simple and one compound intent:

```ts
import { describe, expect, it } from 'vitest';
import { deployUnitWithId, moveUnit } from '../battle/actions';
import { createGame } from '../scenario/jingxiang208';
import { reduceGameIntent } from './intentReducer';

describe('reduceGameIntent', () => {
  it('applies a move intent through the shared rules entry point', () => {
    const state = createGame('liu', 1);
    const deployed = deployUnitWithId(state, 'liu', {
      cityId: 'jiangling', officerIds: ['guan-yu'], troopType: 'sword',
      destination: { q: 9, r: 14 }, troops: 4000, food: 6000,
    });
    const destination = { q: 9, r: 13 };
    expect(reduceGameIntent(deployed.state, 'liu', {
      type: 'moveUnit', unitId: deployed.unitId, destination,
    })).toEqual(moveUnit(deployed.state, 'liu', deployed.unitId, destination));
  });

  it('keeps deploy plus follow-up action atomic', () => {
    const state = createGame('liu', 1);
    const input = {
      cityId: 'jiangling' as const, officerIds: ['guan-yu'], troopType: 'sword' as const,
      destination: { q: 9, r: 14 }, troops: 4000, food: 6000,
    };
    const expected = deployUnitWithId(state, 'liu', input);
    expect(reduceGameIntent(state, 'liu', {
      type: 'deployUnitAction', input, action: { type: 'wait' },
    })).toEqual(expected.state);
  });
});
```

If the deployed unit is already marked acted by current rules, set `expected` to the current direct-operation result used in `session.ts`; preserve current behavior rather than changing the rule.

- [ ] **Step 2: Run the new test and verify RED**

Run: `npm.cmd test -- src/game/network/intentReducer.test.ts`

Expected: FAIL because the reducer module does not exist.

- [ ] **Step 3: Move the intent switch into a pure module**

Create `intentReducer.ts` with this public shape:

```ts
export type ActionGameIntent = Exclude<GameIntent, { type: 'endTenDay' }>;

export function reduceGameIntent(
  state: GameState,
  forceId: ForceId,
  intent: ActionGameIntent,
): GameState {
  switch (intent.type) {
    case 'issueCommand':
      return executeCommand(state, forceId, intent.command);
    case 'deployUnit':
      return deployUnit(state, forceId, intent.input);
    case 'deployUnitAction': {
      const deployed = deployUnitWithId(state, forceId, intent.input);
      switch (intent.action.type) {
        case 'wait':
          return deployed.state;
        case 'attackUnit':
          return attackUnit(deployed.state, forceId, deployed.unitId, intent.action.targetId);
        case 'attackFacility':
          return attackFacility(deployed.state, forceId, deployed.unitId, intent.action.facilityId);
        case 'attackCity':
          return attackCity(deployed.state, forceId, deployed.unitId, intent.action.cityId);
        case 'useUnitTactic':
          return useUnitTactic(deployed.state, forceId, deployed.unitId, intent.action.targetId, intent.action.tacticId);
        case 'useUnitStrategy':
          return useUnitStrategy(deployed.state, forceId, deployed.unitId, intent.action.strategyId, intent.action.selection);
        case 'buildFacility':
          return buildFacility(deployed.state, forceId, deployed.unitId, intent.action.facilityType, intent.action.target);
        case 'repairFacility':
          return repairFacility(deployed.state, forceId, deployed.unitId, intent.action.facilityId);
      }
    }
    case 'deployTransportUnit':
      return deployTransportUnit(state, forceId, intent.input);
    case 'moveUnit':
      return moveUnit(state, forceId, intent.unitId, intent.destination);
    case 'waitUnit':
      return waitUnit(state, forceId, intent.unitId);
    case 'attackUnit': {
      const moved = moveIfRequested(state, forceId, intent.attackerId, intent.destination);
      return attackUnit(moved, forceId, intent.attackerId, intent.targetId);
    }
    case 'attackFacility': {
      const moved = moveIfRequested(state, forceId, intent.attackerId, intent.destination);
      return attackFacility(moved, forceId, intent.attackerId, intent.facilityId);
    }
    case 'useUnitTactic': {
      const moved = moveIfRequested(state, forceId, intent.attackerId, intent.destination);
      return useUnitTactic(moved, forceId, intent.attackerId, intent.targetId, intent.tacticId);
    }
    case 'useUnitStrategy': {
      const moved = moveIfRequested(state, forceId, intent.unitId, intent.destination);
      return useUnitStrategy(moved, forceId, intent.unitId, intent.strategyId, intent.selection);
    }
    case 'useFirePlot': {
      const moved = moveIfRequested(state, forceId, intent.unitId, intent.destination);
      return useFirePlot(moved, forceId, intent.unitId, intent.target);
    }
    case 'buildFacility': {
      const moved = moveIfRequested(state, forceId, intent.unitId, intent.destination);
      return buildFacility(moved, forceId, intent.unitId, intent.facilityType, intent.target);
    }
    case 'repairFacility': {
      const moved = moveIfRequested(state, forceId, intent.unitId, intent.destination);
      return repairFacility(moved, forceId, intent.unitId, intent.facilityId);
    }
    case 'dismantleFacility':
      return dismantleFacility(state, forceId, intent.facilityId);
    case 'attackCity': {
      const moved = moveIfRequested(state, forceId, intent.attackerId, intent.destination);
      return attackCity(moved, forceId, intent.attackerId, intent.cityId);
    }
  }
}
```

Use a private helper for move-then-act intents:

```ts
function moveIfRequested(state: GameState, forceId: ForceId, unitId: string, destination?: GridCoord) {
  return destination ? moveUnit(state, forceId, unitId, destination) : state;
}
```

The switch must include all 15 non-turn intent types and an exhaustive `never` assertion.

- [ ] **Step 4: Replace the online-only switch**

Delete private `applyGameIntent` from `session.ts`. In `reduceOnlineIntent`, replace it with:

```ts
const actionState = stateForAction(room, forceId);
const nextState = reduceGameIntent(actionState, forceId, intent);
```

Keep `endTenDay` handling in `session.ts` because it changes room turn ownership as well as game state.

- [ ] **Step 5: Verify Task 2**

Run: `npm.cmd test -- src/game/network/intentReducer.test.ts src/game/network/session.test.ts`

Expected: both test files pass and online revision behavior remains unchanged.

---

### Task 3: Route Local and Online Commands Through One Dispatcher

**Files:**
- Create: `src/game/store/gameCommandDispatcher.ts`
- Create: `src/game/store/gameCommandDispatcher.test.ts`
- Modify: `src/game/store/GameProvider.tsx`
- Modify: `src/game/store/GameProvider.test.tsx`

**Interfaces:**
- Produces: `applyLocalIntent(state: GameState, intent: ActionGameIntent): GameState`
- Consumes: `reduceGameIntent` from Task 2.

- [ ] **Step 1: Write a failing local dispatcher test**

```ts
import { expect, it } from 'vitest';
import { deployUnitWithId, moveUnit } from '../battle/actions';
import { createGame } from '../scenario/jingxiang208';
import { applyLocalIntent } from './gameCommandDispatcher';

it('uses the player force when applying a local intent', () => {
  const deployed = deployUnitWithId(createGame('liu', 1), 'liu', {
    cityId: 'jiangling', officerIds: ['guan-yu'], troopType: 'sword',
    destination: { q: 9, r: 14 }, troops: 4000, food: 6000,
  });
  const destination = { q: 9, r: 13 };
  expect(applyLocalIntent(deployed.state, {
    type: 'moveUnit', unitId: deployed.unitId, destination,
  })).toEqual(moveUnit(deployed.state, 'liu', deployed.unitId, destination));
});
```

- [ ] **Step 2: Run the dispatcher test and verify RED**

Run: `npm.cmd test -- src/game/store/gameCommandDispatcher.test.ts`

Expected: FAIL because `applyLocalIntent` does not exist.

- [ ] **Step 3: Implement the local adapter**

```ts
export function applyLocalIntent(state: GameState, intent: ActionGameIntent) {
  return reduceGameIntent(state, state.playerForceId, intent);
}
```

- [ ] **Step 4: Add one Provider wiring test that fails before refactoring**

Mock `gameCommandDispatcher.ts` with a hoisted `vi.fn()` that delegates to the real `reduceGameIntent`, render the existing `MoveProbe`, click it, and assert the spy received the current state plus `{ type: 'moveUnit', unitId, destination }`. Keep the existing state-result tests so the wiring assertion cannot replace behavioral coverage.

- [ ] **Step 5: Introduce one internal command path in GameProvider**

Add:

```ts
const dispatchIntent = useCallback((intent: ActionGameIntent, afterSuccess?: () => void) => {
  if (onlineRef.current.mode === 'online') {
    sendOnlineIntent(intent, afterSuccess);
    return;
  }
  applyBattleAction((current) => applyLocalIntent(current, intent), afterSuccess);
}, [applyBattleAction, sendOnlineIntent]);
```

Rewrite `issueCommand`, deploy, move, wait, attacks, tactics, strategies, fire, build, repair, dismantle, and city attack wrappers to construct intents and call `dispatchIntent`. Keep `endTenDay`, local map editing, saves, and room operations outside this path.

- [ ] **Step 6: Verify Task 3**

Run: `npm.cmd test -- src/game/store/gameCommandDispatcher.test.ts src/game/store/GameProvider.test.tsx src/game/network/session.test.ts`

Expected: all tests pass; local and online sound callbacks still run only after successful operations.

---

### Task 4: Split Battle Rules Behind the Compatibility Module

**Files:**
- Create: `src/game/battle/definitions.ts`
- Create: `src/game/battle/shared.ts`
- Create: `src/game/battle/movement.ts`
- Create: `src/game/battle/facilities.ts`
- Create: `src/game/battle/combat.ts`
- Create: `src/game/battle/tactics.ts`
- Create: `src/game/battle/strategies.ts`
- Create: `src/game/battle/deployment.ts`
- Create: `src/game/battle/module-boundaries.test.ts`
- Modify: `src/game/battle/actions.ts`

**Interfaces:**
- Preserves every export currently imported from `battle/actions.ts`.
- Produces focused modules with no circular imports and no frontend dependencies.

- [ ] **Step 1: Write a failing module-boundary test**

```ts
import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const modules = ['definitions', 'shared', 'movement', 'facilities', 'combat', 'tactics', 'strategies', 'deployment'];

describe('battle module boundaries', () => {
  it('keeps actions as a compatibility export surface', () => {
    const source = readFileSync('src/game/battle/actions.ts', 'utf8');
    expect(source.split(/\r?\n/).length).toBeLessThan(120);
    expect(source).not.toMatch(/function\s+(movementCost|damageRoll|applyTacticDamage|igniteGroundFire)/);
  });

  it.each(modules)('%s has no frontend dependency', (name) => {
    const filename = `src/game/battle/${name}.ts`;
    expect(existsSync(filename)).toBe(true);
    if (!existsSync(filename)) return;
    const source = readFileSync(filename, 'utf8');
    expect(source).not.toMatch(/from ['"]react|window\.|document\.|soundEffects|socket\.io/);
  });
});
```

- [ ] **Step 2: Run the boundary test and verify RED**

Run: `npm.cmd test -- src/game/battle/module-boundaries.test.ts`

Expected: FAIL because the focused modules do not exist and `actions.ts` exceeds 120 lines.

- [ ] **Step 3: Extract definitions and shared helpers**

Move these public declarations without changing their names or values into `definitions.ts`: `DEPLOY_AP_COST`, `BASE_MOVEMENT`, `MovementProfile`, `DeployInput`, `TransportInput`, `TacticId`, `UnitTactic`, `StrategyId`, `UnitStrategy`, `UnitFacility`, `StrategySelection`, `FACILITY_BUILD_COSTS`, `movementAllowanceForProfile`, `movementAllowanceForUnit`, `unitTactics`, `unitStrategies`, and `unitFacilities`. Keep the private tactic, strategy, facility, and movement-profile lookup tables in the same file as the public selectors that read them.

Move coordinate lookup, occupancy lookup, turn assertions, city-center lookup, unit lookup/removal, damage-report creation, and move-if-legal primitives into `shared.ts`. Export only helpers consumed by two or more domain modules.

- [ ] **Step 4: Extract movement and deployment**

Move terrain costs, ZOC, path costs, legal-cell checks, `movementAllowanceForProfile`, `movementAllowanceForUnit`, `deploymentCells`, `movementCells`, and `moveUnit` into `movement.ts`.

Move `deployUnit`, `deployUnitWithId`, `deployUnitPreviewWithId`, and `deployTransportUnit` into `deployment.ts`. Deployment may import movement and shared helpers; movement must not import deployment.

- [ ] **Step 5: Extract facilities and combat**

Move facility completion, spacing, targets, build/repair/dismantle, repair reports, fortress effects, and turn-start settlement into `facilities.ts`.

Move attack ranges, damage calculation, `attackableUnits`, `attackableCities`, `attackableFacilities`, `jointAttackableUnits`, `attackUnit`, `attackFacility`, and `attackCity` into `combat.ts`. Low-level damage/report helpers stay in `shared.ts` so facility settlement does not create a cycle with combat.

- [ ] **Step 6: Extract tactics and strategies**

Move tactic target calculation, affected-unit selection, forced movement, and `useUnitTactic` into `tactics.ts`.

Move strategy target calculation, fire plot helpers, fire propagation, status effects, `useUnitStrategy`, and `useFirePlot` into `strategies.ts`.

- [ ] **Step 7: Convert actions.ts to compatibility exports**

The file should contain only direct exports, for example:

```ts
export * from './definitions';
export * from './movement';
export * from './facilities';
export * from './combat';
export * from './tactics';
export * from './strategies';
export * from './deployment';
```

Do not create an `index.ts` barrel; existing imports continue to use `actions.ts` and domain code imports direct modules.

- [ ] **Step 8: Verify Task 4**

Run: `npm.cmd test -- src/game/battle/module-boundaries.test.ts src/game/battle/actions.test.ts src/game/battle/status-actions.test.ts src/game/battle/grid.test.ts`

Expected: all battle tests pass and `actions.ts` is under 120 lines.

---

### Task 5: Replace Mutually Exclusive GameShell State With a Reducer

**Files:**
- Create: `src/components/gameInteraction.ts`
- Create: `src/components/gameInteraction.test.ts`
- Modify: `src/components/GameShell.tsx`
- Modify: `src/components/command-ui.test.tsx`

**Interfaces:**
- Produces: `MapInteraction`, `MapInteractionAction`, `INITIAL_MAP_INTERACTION`, and `reduceMapInteraction`.
- Preserves independent hover, dialog, report, and editor state.

- [ ] **Step 1: Write failing reducer transition tests**

```ts
import { describe, expect, it } from 'vitest';
import { INITIAL_MAP_INTERACTION, reduceMapInteraction } from './gameInteraction';

describe('reduceMapInteraction', () => {
  it('backs from a unit submenu to its parent unit menu', () => {
    const menu = reduceMapInteraction(INITIAL_MAP_INTERACTION, {
      type: 'open-unit-menu', unitId: 'unit-1', position: { x: 10, y: 20 },
    });
    const submenu = reduceMapInteraction(menu, { type: 'open-unit-submenu', kind: 'strategy' });
    expect(reduceMapInteraction(submenu, { type: 'back' })).toEqual(menu);
  });

  it('backs from targeting to the submenu that opened it', () => {
    const menu = reduceMapInteraction(INITIAL_MAP_INTERACTION, {
      type: 'open-unit-menu', unitId: 'unit-1', position: { x: 10, y: 20 },
    });
    const submenu = reduceMapInteraction(menu, { type: 'open-unit-submenu', kind: 'facility' });
    const targeting = reduceMapInteraction(submenu, {
      type: 'start-targeting', kind: 'facility', payload: { facilityType: 'arrowTower' },
    });
    expect(reduceMapInteraction(targeting, { type: 'back' })).toEqual(submenu);
  });

  it('closes a first-level menu to idle', () => {
    const menu = reduceMapInteraction(INITIAL_MAP_INTERACTION, {
      type: 'open-map-menu', position: { x: 10, y: 20 },
    });
    expect(reduceMapInteraction(menu, { type: 'back' })).toEqual(INITIAL_MAP_INTERACTION);
  });
});
```

- [ ] **Step 2: Run the reducer test and verify RED**

Run: `npm.cmd test -- src/components/gameInteraction.test.ts`

Expected: FAIL because the reducer module does not exist.

- [ ] **Step 3: Implement the reducer**

Use a discriminated union with `idle`, `city-menu`, `unit-menu`, `unit-submenu`, `targeting`, `map-menu`, and `facility-menu`. Store `parent` only on submenu and targeting states so `back` is deterministic:

```ts
case 'back':
  if (state.type === 'targeting' || state.type === 'unit-submenu') return state.parent;
  return INITIAL_MAP_INTERACTION;
case 'close':
  return INITIAL_MAP_INTERACTION;
```

Invalid transitions return the current state.

- [ ] **Step 4: Add interaction regression tests before wiring GameShell**

Extend `command-ui.test.tsx` to cover these existing user flows:

- Right-click unit, open a secondary menu, first right-click closes only secondary menu, second right-click closes primary menu.
- Left-click another friendly unit closes the previous unit menu.
- Right-click empty ground performs the same one-level back operation as right-clicking the menu.
- Cancelling first deployment movement closes the movement range and deployment flow.

Run the focused tests before changing `GameShell`; retain any test that already passes as characterization coverage and ensure at least the new one-level reducer test from Step 1 provided the RED gate.

- [ ] **Step 5: Wire GameShell to the reducer**

Replace only mutually exclusive state variables: `cityMenu`, `unitCommandMenu`, `unitTacticMenu`, `unitStrategyMenu`, `unitFacilityMenu`, `unitIntelMenu`, `targetingAttack`, `targetingTactic`, `targetingFirePlot`, `targetingUnitStrategy`, `targetingFacility`, `targetingRepair`, `facilityContextMenu`, and `mapContextMenu`.

Keep deployment dialog inputs, detail dialogs, hover state, reports, global intelligence, and editor state independent. Derive legacy-shaped local constants from `interaction` during the migration so JSX changes remain mechanical.

- [ ] **Step 6: Replace repeated clearing sequences**

Use `interactionDispatch({ type: 'close' })` for full cancellation and `interactionDispatch({ type: 'back' })` for right-click. Remove obsolete setters and refs only after all references are migrated.

- [ ] **Step 7: Verify Task 5**

Run: `npm.cmd test -- src/components/gameInteraction.test.ts src/components/command-ui.test.tsx src/components/game-ui.test.tsx src/components/StrategicMap.test.tsx`

Expected: all UI behavior tests pass with no React act warnings.

---

### Task 6: Extract GameProvider Internal Responsibilities

**Files:**
- Create: `src/game/store/authStorage.ts`
- Create: `src/game/store/authStorage.test.ts`
- Create: `src/game/store/useOnlineRoom.ts`
- Create: `src/game/store/useGameCommands.ts`
- Modify: `src/game/store/GameProvider.tsx`
- Modify: `src/game/store/GameProvider.test.tsx`

**Interfaces:**
- Produces: versioned auth and last-room storage helpers using an exported `StoredAuthSession` value type.
- Produces: `useOnlineRoom` for Socket.IO lifecycle and room snapshots.
- Produces: `useGameCommands` for local/online command dispatch, persistence, and success sounds.
- Preserves: `GameContextValue` and `useGame()` public behavior.

- [ ] **Step 1: Write failing storage helper tests**

Test these exact functions in `authStorage.test.ts`:

```ts
readStoredAuthSession(storage): StoredAuthSession | null
writeStoredAuthSession(storage, session): void
clearStoredAuthSession(storage): void
readStoredLastRoom(storage): { serverUrl: string; roomId: string } | null
writeStoredLastRoom(storage, input): void
clearStoredLastRoom(storage): void
```

Cover valid values, malformed JSON, missing fields, and clear behavior.

- [ ] **Step 2: Run storage tests and verify RED**

Run: `npm.cmd test -- src/game/store/authStorage.test.ts`

Expected: FAIL because `authStorage.ts` does not exist.

- [ ] **Step 3: Implement and adopt storage helpers**

Move the three storage keys and all JSON parsing/writing from `GameProvider.tsx` to `authStorage.ts`. Define `StoredAuthSession` as `{ token: string; userId: string; username: string }`. Accept a `Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>` argument so tests use in-memory storage without `window`; `authStorage.ts` must not import `GameProvider.tsx`.

- [ ] **Step 4: Write a failing online lifecycle wiring test**

In `GameProvider.test.tsx`, retain the existing fake socket and add an assertion that mounting with a stored room exposes `resumingRoom=yes` until the resume snapshot arrives, then switches to `no`. This is the contract `useOnlineRoom` must preserve.

- [ ] **Step 5: Extract useOnlineRoom**

Move `online`, `auth`, socket refs, login/register/logout, room list/create/join/resume/select/start/disconnect, snapshot application, auth expiry, and socket effects into `useOnlineRoom.ts`.

Return a named object containing the current `online` and `auth` state plus the same public operations. Pass `replaceGameState`, `clearGameState`, and `selectInitialCity` callbacks from `GameProvider`; the hook must not import the game context.

- [ ] **Step 6: Extract useGameCommands**

Move `dispatchIntent`, battle wrapper methods, success sound mapping, local autosave, and local turn progression into `useGameCommands.ts`. Pass current state, online mode, `sendOnlineIntent`, `replaceState`, `persist`, and `setError` explicitly.

- [ ] **Step 7: Reduce GameProvider to composition**

`GameProvider` should retain state reducer ownership, selected city, save availability, start/load/reset/map-editor operations, and construction of `GameContextValue`. Keep `useMemo` dependencies primitive or stable hook results; do not memoize simple booleans.

- [ ] **Step 8: Verify Task 6**

Run: `npm.cmd test -- src/game/store/authStorage.test.ts src/game/store/gameCommandDispatcher.test.ts src/game/store/GameProvider.test.tsx src/components/StartScreen.test.tsx src/components/RoomLobbyScreen.test.tsx`

Expected: all authentication, reconnect, room list, local command, online command, and turn tests pass.

---

### Task 7: Full Verification and Structural Audit

**Files:**
- Inspect: every file changed by Tasks 1-6.
- Modify: only the specific Task 1-6 file whose extracted import, type, or behavior caused a verification failure.

**Interfaces:**
- Consumes every previous task's output.
- Produces a behavior-compatible build with explicit architecture metrics.

- [ ] **Step 1: Run the complete unit suite**

Run: `npm.cmd test`

Expected: all 27 or more test files pass; the existing baseline is 314 tests.

- [ ] **Step 2: Run the production build**

Run: `npm.cmd run build`

Expected: TypeScript emits no errors and Vite completes successfully.

- [ ] **Step 3: Audit module sizes and forbidden dependencies**

Run:

```powershell
Get-ChildItem src,server -Recurse -File -Include *.ts,*.tsx | ForEach-Object { [PSCustomObject]@{ Lines=(Get-Content -LiteralPath $_.FullName).Count; Path=$_.FullName } } | Sort-Object Lines -Descending | Select-Object -First 20
```

Expected: `battle/actions.ts` is under 120 lines; `GameShell.tsx` and `GameProvider.tsx` are materially smaller than the current 1462 and 1082 lines. Any remaining file above 1000 lines must have one documented responsibility rather than being split solely to satisfy a metric.

- [ ] **Step 4: Inspect the final diff**

Run: `git diff --check` and `git status --short`.

Expected: no whitespace errors, no deleted runtime data, and no unrelated user files reverted. Do not stage or commit mixed production changes without explicit user approval.

- [ ] **Step 5: Perform browser smoke verification**

Start the existing backend and frontend with `start-dev.bat`. Verify desktop and mobile duel flows: reopen an existing game, right-click unit menus with one-level back, first deployment movement cancel, move/attack/tactic/strategy/build/repair, room resume, and alternating online player turns.

Expected: no blank map, no console exception, no stale target overlays, and local/online rule outcomes match.
