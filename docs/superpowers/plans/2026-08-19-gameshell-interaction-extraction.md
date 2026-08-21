# GameShell Interaction Extraction Implementation Plan

> **For agentic workers:** This plan is executed inline in the current workspace with test checkpoints.

**Goal:** Extract GameShell's unit menu interaction state into a focused hook while preserving existing menu behavior and battle rules.

**Architecture:** Keep `gameInteraction.ts` as the pure state transition module. Add `useUnitMenuInteraction.ts` as the React adapter that owns the reducer and exposes derived first-level/submenu state plus stable open/back/close callbacks. `GameShell.tsx` continues to own game actions, targeting state, and rendering, but consumes the hook instead of managing the unit menu reducer directly.

**Tech Stack:** React 19, TypeScript, Vitest, Testing Library.

## Global Constraints

- Do not change battle rules, target query results, network protocol, or sound behavior.
- Preserve existing public component behavior and test selectors.
- Keep the new hook UI-state-only; it must not import GameState or call game actions.
- Use the existing `reduceMapInteraction` reducer instead of duplicating transition logic.

---

### Task 1: Specify the unit menu hook contract

**Files:**
- Create: `src/components/useUnitMenuInteraction.test.tsx`
- Read: `src/components/gameInteraction.ts`

**Interfaces:**
- The hook will expose `unitCommandMenu`, `unitTacticMenu`, `unitStrategyMenu`, `unitFacilityMenu`.
- The hook will expose `setUnitCommandMenu`, `setUnitTacticMenu`, `setUnitStrategyMenu`, `setUnitFacilityMenu`.

- [ ] **Step 1: Write the failing test**

Create a small harness component that opens the unit menu, opens the strategy submenu, and verifies that closing the submenu returns to the first-level menu and closing the first-level menu returns to idle.

```tsx
import { act, fireEvent, render, screen } from '@testing-library/react';
import { useUnitMenuInteraction } from './useUnitMenuInteraction';

function Harness() {
  const menu = useUnitMenuInteraction();
  return (
    <>
      <button onClick={() => menu.setUnitCommandMenu({ unitId: 'unit-1', position: { x: 10, y: 20 } })}>open</button>
      <button onClick={() => menu.setUnitStrategyMenu({ unitId: 'unit-1', position: { x: 118, y: 20 } })}>strategy</button>
      <button onClick={() => menu.setUnitStrategyMenu(null)}>close-strategy</button>
      <button onClick={() => menu.setUnitCommandMenu(null)}>close</button>
      <output data-testid="command">{menu.unitCommandMenu?.unitId ?? 'none'}</output>
      <output data-testid="strategy">{menu.unitStrategyMenu?.unitId ?? 'none'}</output>
    </>
  );
}

it('keeps first-level unit menu while navigating back from a submenu', () => {
  render(<Harness />);
  fireEvent.click(screen.getByText('open'));
  fireEvent.click(screen.getByText('strategy'));
  expect(screen.getByTestId('command')).toHaveTextContent('unit-1');
  expect(screen.getByTestId('strategy')).toHaveTextContent('unit-1');
  fireEvent.click(screen.getByText('close-strategy'));
  expect(screen.getByTestId('command')).toHaveTextContent('unit-1');
  expect(screen.getByTestId('strategy')).toHaveTextContent('none');
  fireEvent.click(screen.getByText('close'));
  expect(screen.getByTestId('command')).toHaveTextContent('none');
});
```

- [ ] **Step 2: Run the focused test and verify the expected failure**

Run: `npm.cmd test -- src/components/useUnitMenuInteraction.test.tsx`

Expected: fail because `src/components/useUnitMenuInteraction.ts` does not exist yet.

### Task 2: Implement and wire the hook

**Files:**
- Create: `src/components/useUnitMenuInteraction.ts`
- Modify: `src/components/GameShell.tsx`

**Interfaces:**
- `useUnitMenuInteraction()` returns the four derived menu values and four setter callbacks used by GameShell.
- The hook delegates transitions to `reduceMapInteraction` and does not own targeting or game state.

- [ ] **Step 1: Implement the minimal hook**

Move the existing `useReducer` setup, derived menu selectors, and four setter callbacks from GameShell into the new hook. Preserve the existing submenu back behavior and destination/position payloads.

- [ ] **Step 2: Replace the duplicated reducer block in GameShell**

Remove the direct `useReducer` import and local unit interaction block. Import and call `useUnitMenuInteraction()`, retaining the same variable names so the existing event handlers and JSX remain behaviorally unchanged.

- [ ] **Step 3: Run the hook test**

Run: `npm.cmd test -- src/components/useUnitMenuInteraction.test.tsx`

Expected: pass.

### Task 3: Regression verification

**Files:**
- Read: `src/components/command-ui.test.tsx`
- Read: `src/components/game-ui.test.tsx`
- Read: `src/components/StrategicMap.test.tsx`

- [ ] **Step 1: Run the existing command and map interaction tests**

Run: `npm.cmd test -- src/components/useUnitMenuInteraction.test.tsx src/components/command-ui.test.tsx src/components/game-ui.test.tsx src/components/StrategicMap.test.tsx`

Expected: all selected tests pass with no changed selectors or interaction failures.

- [ ] **Step 2: Run the full test suite and production build**

Run: `npm.cmd test` and `npm.cmd run build`

Expected: exit code 0 for both commands.

- [ ] **Step 3: Check the diff for whitespace errors**

Run: `git diff --check`

Expected: exit code 0. Existing line-ending warnings are acceptable; no whitespace-error entries should be introduced.
