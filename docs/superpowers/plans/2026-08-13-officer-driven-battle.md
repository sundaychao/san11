# Officer-Driven Battle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make leader and deputy abilities, troop aptitude, tactic critical hits, and intelligence-based strategy success materially affect battle while preserving deterministic local/online outcomes and schema version 2 saves.

**Architecture:** Add one pure `officerAbilities.ts` module that owns all formation-derived values and probability formulas. Existing battle rules call that module, reports carry optional presentation metadata, and React components only render calculated values and availability reasons. Local and online play continue to share `reduceGameIntent`, so no protocol or intent changes are needed.

**Tech Stack:** TypeScript 7, React 19, Vitest 4, Testing Library, seeded RNG through `nextRandom`, existing Socket.IO session reducer.

## Global Constraints

- Keep `GameState.schemaVersion` at 2.
- Do not persist derived unit abilities.
- Do not change `GameIntent` or Socket.IO event shapes.
- Use the existing fallback aptitudes: spear B, halberd B, crossbow B, cavalry B, siege C, navy C.
- Leadership comes only from the leader; war, intelligence, and aptitude use the highest participating officer value with formation order as the tie-breaker.
- C/B/A/S permit tactic tiers 0/1/2/3.
- Tactic aptitude multipliers are B `1.00`, A `1.10`, S `1.20`.
- Tactic critical damage is `135%`; critical chance is `clamp(5, 30, round(5 + max(0, war - 60) * 0.35 + aptitudeBonus))`, with B/A/S bonuses `0/4/8`.
- Harmful unit strategy chance is `clamp(10, 95, 70 + sourceIntelligence - targetIntelligence)`.
- Fire chance is `clamp(55, 95, round(55 + (sourceIntelligence - 50) * 0.8))`.
- Extinguish, calm, and inspire always succeed.
- A failed strategy consumes energy, marks the unit acted, and applies no effect.
- Existing displacement, area targets, fire spread, facilities, movement, and ZOC behavior must remain unchanged.
- The worktree contains previous user and refactor changes. Do not revert them. Do not stage production files without explicit approval.

---

### Task 1: Pure Officer Composition And Probability Module

**Files:**
- Create: `src/game/battle/officerAbilities.ts`
- Create: `src/game/battle/officerAbilities.test.ts`
- Modify: `src/game/battle/actions.ts`

**Interfaces:**
- Produces: `DEFAULT_OFFICER_APTITUDES: OfficerAptitudes`
- Produces: `effectiveUnitAbilities(state: GameState, unit: ArmyUnit): EffectiveUnitAbilities`
- Produces: `maxTacticTier(grade: AptitudeGrade | null): 0 | 1 | 2 | 3`
- Produces: `tacticCriticalChance(war: number, grade: AptitudeGrade): number`
- Produces: `harmfulStrategySuccessChance(sourceIntelligence: number, targetIntelligence: number): number`
- Produces: `fireStrategySuccessChance(sourceIntelligence: number): number`

- [ ] **Step 1: Write failing ability tests**

Create `officerAbilities.test.ts` with cases that deploy Guan Yu as leader and Jian Yong/Zhuge Liang as deputies, then assert leader-only leadership, highest war/intelligence, highest relevant aptitude, source officer IDs, fallback values, tie behavior, tier mapping, and exact probability boundaries:

```ts
import { describe, expect, it } from 'vitest';
import { deployUnit } from './actions';
import { createGame } from '../scenario/jingxiang208';
import {
  effectiveUnitAbilities,
  fireStrategySuccessChance,
  harmfulStrategySuccessChance,
  maxTacticTier,
  tacticCriticalChance,
} from './officerAbilities';

describe('effectiveUnitAbilities', () => {
  it('uses leader leadership and formation maxima for other abilities', () => {
    const state = deployUnit(createGame('liu', 1), 'liu', {
      cityId: 'jiangling', officerIds: ['jian-yong', 'guan-yu', 'zhuge-liang'],
      troopType: 'spear', troops: 4000, food: 5000,
    });
    const unit = Object.values(state.units)[0];
    const result = effectiveUnitAbilities(state, unit);
    expect(result.leadership).toEqual({ value: state.officers['jian-yong'].stats.leadership, officerId: 'jian-yong' });
    expect(result.war.officerId).toBe('guan-yu');
    expect(result.intelligence.officerId).toBe('zhuge-liang');
    expect(result.aptitude).toEqual({ grade: 'S', officerId: 'guan-yu' });
  });

  it('maps aptitude and probability formulas exactly', () => {
    expect(['C', 'B', 'A', 'S'].map(maxTacticTier)).toEqual([0, 1, 2, 3]);
    expect(tacticCriticalChance(60, 'B')).toBe(5);
    expect(tacticCriticalChance(100, 'S')).toBe(27);
    expect(harmfulStrategySuccessChance(100, 40)).toBe(95);
    expect(harmfulStrategySuccessChance(40, 100)).toBe(10);
    expect(fireStrategySuccessChance(50)).toBe(55);
    expect(fireStrategySuccessChance(100)).toBe(95);
  });
});
```

- [ ] **Step 2: Run the new test and verify RED**

Run: `npm.cmd test -- src/game/battle/officerAbilities.test.ts`

Expected: FAIL because `officerAbilities.ts` does not exist.

- [ ] **Step 3: Implement the pure module**

Create these public types and functions without importing React, DOM, audio, network, or `legacyCore.ts`:

```ts
export interface SourcedAbility<T> { value: T; officerId: string }
export interface SourcedAptitude { grade: AptitudeGrade | null; officerId: string | null }
export interface EffectiveUnitAbilities {
  leadership: SourcedAbility<number>;
  war: SourcedAbility<number>;
  intelligence: SourcedAbility<number>;
  aptitude: SourcedAptitude;
}

export const DEFAULT_OFFICER_APTITUDES: OfficerAptitudes = {
  spear: 'B', halberd: 'B', crossbow: 'B', cavalry: 'B', siege: 'C', navy: 'C',
};

const APTITUDE_RANK: Record<AptitudeGrade, number> = { C: 0, B: 1, A: 2, S: 3 };
const clamp = (value: number, minimum: number, maximum: number) =>
  Math.min(maximum, Math.max(minimum, value));

function formationOfficers(state: GameState, unit: ArmyUnit) {
  return (unit.officerIds ?? [unit.leaderId])
    .map((id) => state.officers[id])
    .filter((officer): officer is Officer => Boolean(officer));
}

function firstMaximum(officers: Officer[], value: (officer: Officer) => number) {
  return officers.slice(1).reduce(
    (best, officer) => value(officer) > value(best) ? officer : best,
    officers[0],
  );
}

export function effectiveUnitAbilities(state: GameState, unit: ArmyUnit): EffectiveUnitAbilities {
  const officers = formationOfficers(state, unit);
  const leader = state.officers[unit.leaderId] ?? officers[0];
  if (!leader) throw new Error('部队主将不存在');
  const warOfficer = firstMaximum(officers, (officer) => officer.stats.war);
  const intelligenceOfficer = firstMaximum(officers, (officer) => officer.stats.intelligence);
  const aptitudeKey = unit.kind === 'transport' || unit.troopType === 'sword'
    ? null
    : unit.troopType ?? null;
  const aptitudeOfficer = aptitudeKey
    ? firstMaximum(officers, (officer) => APTITUDE_RANK[(officer.aptitudes ?? DEFAULT_OFFICER_APTITUDES)[aptitudeKey]])
    : null;
  return {
    leadership: { value: leader.stats.leadership, officerId: leader.id },
    war: { value: warOfficer.stats.war, officerId: warOfficer.id },
    intelligence: { value: intelligenceOfficer.stats.intelligence, officerId: intelligenceOfficer.id },
    aptitude: aptitudeOfficer && aptitudeKey
      ? { grade: (aptitudeOfficer.aptitudes ?? DEFAULT_OFFICER_APTITUDES)[aptitudeKey], officerId: aptitudeOfficer.id }
      : { grade: null, officerId: null },
  };
}

export function maxTacticTier(grade: AptitudeGrade | null): 0 | 1 | 2 | 3 {
  return grade === 'S' ? 3 : grade === 'A' ? 2 : grade === 'B' ? 1 : 0;
}

export function tacticCriticalChance(war: number, grade: AptitudeGrade) {
  const bonus = grade === 'S' ? 8 : grade === 'A' ? 4 : 0;
  return clamp(Math.round(5 + Math.max(0, war - 60) * 0.35 + bonus), 5, 30);
}

export function harmfulStrategySuccessChance(source: number, target: number) {
  return clamp(70 + source - target, 10, 95);
}

export function fireStrategySuccessChance(source: number) {
  return clamp(Math.round(55 + (source - 50) * 0.8), 55, 95);
}
```

Import `ArmyUnit`, `GameState`, `Officer`, `OfficerAptitudes`, and `AptitudeGrade` from `../types`. The implementation above preserves formation order and returns no aptitude for transport or sword units.

- [ ] **Step 4: Export the module and verify GREEN**

Add `export * from './officerAbilities';` to `actions.ts` and run:

`npm.cmd test -- src/game/battle/officerAbilities.test.ts src/game/battle/module-boundaries.test.ts`

Expected: both files pass.

---

### Task 2: Aptitude-Gated Tactics And Officer-Based Damage

**Files:**
- Modify: `src/game/types.ts`
- Modify: `src/game/battle/legacyCore.ts`
- Modify: `src/game/battle/actions.test.ts`
- Modify: `src/game/persistence.ts`
- Modify: `src/game/persistence.test.ts`

**Interfaces:**
- Consumes: Task 1 ability calculators.
- Produces: `tacticTier(tacticId: TacticId): 1 | 2 | 3`
- Produces: `requiredAptitudeForTactic(tacticId: TacticId): AptitudeGrade`
- Produces: `unitCanUseTactic(state: GameState, unitId: string, tacticId: TacticId): boolean`
- Extends: `BattleDamageReport` with optional `critical?: boolean` and `label?: string`.

- [ ] **Step 1: Write failing access and deputy tests**

Add table-driven tests to `actions.test.ts` that override a formation's spear aptitude and assert `unitTactics` still lists all three definitions while `unitCanUseTactic` permits exactly 0/1/2/3. Add a rule-level test that `useUnitTactic` throws `需要枪兵适性 A` for an A-tier requirement when the effective grade is B. Add a deputy test proving an S deputy unlocks tier 3.

```ts
expect(unitTactics(state, unit.id)).toHaveLength(3);
expect(unitCanUseTactic(state, unit.id, 'spear-thrust')).toBe(true);
expect(unitCanUseTactic(state, unit.id, 'spear-spiral')).toBe(false);
expect(() => useUnitTactic(state, 'liu', unit.id, target.id, 'spear-spiral'))
  .toThrow('需要枪兵适性 A');
```

- [ ] **Step 2: Write failing damage and critical tests**

Add deterministic tests that:

- raising only defender leadership lowers normal damage for the same seed;
- a deputy's higher war raises damage while leader leadership remains unchanged;
- B/A/S tactic damage follows 1.00/1.10/1.20 before rounding;
- a seed whose first critical roll is below the calculated chance emits `critical: true` and applies 135%;
- a seed above the chance emits no critical flag;
- whirlwind uses one critical roll and marks every generated damage report consistently.

Use a small test helper that searches integer seeds through `nextRandom(seed, cursor)` instead of hard-coding an unexplained seed.

- [ ] **Step 3: Run focused tests and verify RED**

Run: `npm.cmd test -- src/game/battle/actions.test.ts`

Expected: new access, defense, aptitude multiplier, and critical assertions fail.

- [ ] **Step 4: Implement tactic metadata and rule validation**

Derive tier from `TACTICS_BY_TROOP` index and use this grade map:

```ts
const TACTIC_REQUIRED_APTITUDE: Record<1 | 2 | 3, AptitudeGrade> = {
  1: 'B', 2: 'A', 3: 'S',
};
```

`unitCanUseTactic` validates unit existence, combat kind, troop type, and effective aptitude tier. `useUnitTactic` checks aptitude before energy and target validation so the UI and thrown reason agree.

- [ ] **Step 5: Implement officer-based normal and tactic damage**

Change `damageRoll` to accept an optional defender:

```ts
export function damageRoll(
  state: GameState,
  attacker: ArmyUnit,
  defenderTerrain: TerrainType,
  counter = false,
  defender?: ArmyUnit,
) {
  const attack = effectiveUnitAbilities(state, attacker);
  const defenseLeadership = defender
    ? effectiveUnitAbilities(state, defender).leadership.value
    : attack.leadership.value;
  const leadershipModifier = Math.min(1.2, Math.max(
    0.8,
    1 + (attack.leadership.value - defenseLeadership) / 250,
  ));
  const roll = nextRandom(state.seed, state.rngCursor);
  state.rngCursor = roll.cursor;
  const attackScore = attacker.troops * (
    0.08 + attack.leadership.value / 2000 + attack.war.value / 3000
  );
  const rawDamage = 240 + attackScore;
  const randomModifier = 0.92 + roll.value * 0.16;
  const damage = Math.round(
    rawDamage *
    leadershipModifier *
    TERRAIN_DEFENSE[defenderTerrain] *
    randomModifier *
    facilityDamageMultiplier(state, attacker) *
    (counter ? 0.6 : 1),
  );
  return Math.min(2200, Math.max(120, damage));
}
```

Pass the actual defending unit from unit attacks, counters, tactics, and discord. Facility and city attacks omit it and therefore receive a neutral leadership modifier.

At tactic start, make one critical roll, advance `rngCursor` once, and pass the boolean through all affected-unit damage calls. Apply aptitude and critical multipliers after `damageRoll` and before fortress reduction. Set `critical: true` and `label: '暴击'` on every affected damage report when it triggers.

- [ ] **Step 6: Extend persistence validation**

Allow only optional valid fields:

```ts
(report.critical === undefined || typeof report.critical === 'boolean') &&
(report.label === undefined || typeof report.label === 'string')
```

Add a persistence round-trip test containing a critical damage report and retain the existing old-save test.

- [ ] **Step 7: Verify Task 2**

Run:

`npm.cmd test -- src/game/battle/actions.test.ts src/game/persistence.test.ts src/game/network/intentReducer.test.ts src/game/network/session.test.ts`

Expected: all pass, including existing positional and area tactic tests.

---

### Task 3: Deterministic Strategy Success And Failure Reports

**Files:**
- Modify: `src/game/types.ts`
- Modify: `src/game/battle/legacyCore.ts`
- Modify: `src/game/battle/actions.test.ts`
- Modify: `src/game/battle/movement.ts`
- Modify: `src/game/battle/combat.ts`
- Modify: `src/game/turn.ts`
- Modify: `src/game/commands.ts`
- Modify: `src/game/network/session.ts`
- Modify: `src/game/persistence.ts`
- Modify: `src/game/persistence.test.ts`

**Interfaces:**
- Consumes: Task 1 intelligence and chance calculators.
- Produces: `StrategyResultReport` and optional `GameState.strategyResultReports`.

- [ ] **Step 1: Add failing strategy outcome tests**

Test fire, false report, disturb, and discord with one seed below and one above the calculated threshold. On failure assert unchanged target/fire state plus spent energy, `acted: true`, one cursor increment, and this report shape:

```ts
expect(next.strategyResultReports).toEqual([expect.objectContaining({
  strategyId: 'disturb', label: '计略失败', succeeded: false,
  q: target.q, r: target.r,
})]);
```

Also assert extinguish, calm, and inspire do not consume RNG and always succeed.

- [ ] **Step 2: Run focused tests and verify RED**

Run: `npm.cmd test -- src/game/battle/actions.test.ts`

Expected: probabilistic strategies currently always apply, so failure assertions fail.

- [ ] **Step 3: Add the optional report type**

```ts
export interface StrategyResultReport {
  id: string;
  strategyId: 'fire' | 'extinguish' | 'false-report' | 'disturb' | 'calm' | 'inspire' | 'discord';
  q: number;
  r: number;
  label: string;
  succeeded: boolean;
}
```

Add `strategyResultReports?: StrategyResultReport[]` to `GameState`. Scenario constructors may initialize it to `[]`, but the property remains optional for old saves.

- [ ] **Step 4: Implement one-roll strategy resolution**

Before cloning effect-specific state, calculate the chance and roll only for `fire`, `false-report`, `disturb`, and `discord`:

```ts
const roll = nextRandom(state.seed, state.rngCursor);
const next = structuredClone(state);
next.rngCursor = roll.cursor;
const succeeded = roll.value < chance / 100;
spendStrategyCost(next, unitId, strategy);
next.strategyResultReports = [strategyReport(next, strategy, selection, succeeded)];
if (!succeeded) return next;
```

Resolve the target coordinate before applying an effect. Every strategy emits exactly one result report: successful reports use the strategy name as `label`, failed reports use `计略失败`. Guaranteed strategies skip RNG. The map UI renders failure reports only.

- [ ] **Step 5: Clear transient strategy reports consistently**

Where `battleDamageReports` and `facilityRepairReports` are cleared in movement, combat, facility actions, commands, turn progression, and online turn advancement, also set `strategyResultReports = []`. Do not clear them between strategy resolution and Provider state publication.

- [ ] **Step 6: Validate report persistence**

Add `validStrategyResultReport`, permit the optional array in `isGameState`, and test both an old save with no property and a round-trip containing a failed report.

- [ ] **Step 7: Verify Task 3**

Run:

`npm.cmd test -- src/game/battle/actions.test.ts src/game/turn.test.ts src/game/commands.test.ts src/game/persistence.test.ts src/game/network/session.test.ts`

Expected: all pass and equal seeds produce equal reports and target state.

---

### Task 4: Tactic Availability UI And Effective Unit Details

**Files:**
- Modify: `src/components/GameShell.tsx`
- Modify: `src/components/UnitInfoPanel.tsx`
- Modify: `src/components/UnitDetailDialog.tsx`
- Modify: `src/components/command-ui.test.tsx`
- Modify: `src/components/game-ui.test.tsx`
- Modify: `src/styles.css`

**Interfaces:**
- Consumes: `effectiveUnitAbilities`, `tacticCriticalChance`, `fireStrategySuccessChance`, `harmfulStrategySuccessChance`, `requiredAptitudeForTactic`, and `unitCanUseTactic`.
- Produces: disabled tactic buttons with deterministic title text and visible effective ability fields.

- [ ] **Step 1: Write failing tactic menu tests**

Open the tactic submenu for a B-aptitude spear unit and assert all three buttons exist, only tier 1 is enabled, and locked titles name their requirements:

```ts
expect(screen.getByRole('button', { name: '突刺' })).toBeEnabled();
expect(screen.getByRole('button', { name: '螺旋突刺' })).toBeDisabled();
expect(screen.getByRole('button', { name: '螺旋突刺' })).toHaveAttribute('title', '需要枪兵适性 A');
expect(screen.getByRole('button', { name: '二段突刺' })).toHaveAttribute('title', '需要枪兵适性 S');
```

Add separate assertions for insufficient energy and no valid target. The primary `战法` command is disabled only when no tactic is currently usable.

- [ ] **Step 2: Write failing unit information tests**

Create a three-officer unit whose leader, maximum-war deputy, maximum-intelligence deputy, and maximum-aptitude deputy are distinguishable. Assert hover and detail UI show effective values, provider names, aptitude, critical percentage, and fire success percentage. Enter harmful unit-strategy targeting, hover an enemy, and assert the hover panel shows the target-dependent percentage calculated from both formations' effective intelligence.

- [ ] **Step 3: Run UI tests and verify RED**

Run: `npm.cmd test -- src/components/command-ui.test.tsx src/components/game-ui.test.tsx`

Expected: locked tactics are absent and effective ability fields do not exist.

- [ ] **Step 4: Render all troop tactics with availability reasons**

Stop filtering `tacticMenuTactics` by targets. For each tactic derive this ordered reason:

1. required aptitude not met;
2. unit already acted or incapacitated;
3. insufficient energy;
4. no valid target.

Use native `disabled` and `title={reason}`. Keep click handling unchanged for enabled tactics. Compute `unitMenuTacticTargets` from enabled tactics only so locked tactics never produce map arrows.

- [ ] **Step 5: Render effective ability information**

In hover information, add compact values for `统`, `武`, `智`, and current aptitude. In detailed information render four rows with source names, plus `战法暴击率` and `火计成功率`. For transport/sword units show aptitude and critical rate as `—`.

Add an optional `strategyChance?: { name: string; percent: number }` prop to `UnitInfoPanel`. While `targetingUnitStrategy` is active and an eligible target is hovered, `GameShell` computes the percentage from source and target effective intelligence and passes it to the panel, which renders `${name}成功率 ${percent}%`. Do not calculate strategy formulas inside React components.

Do not duplicate formulas in components; call the Task 1 module.

- [ ] **Step 6: Verify Task 4**

Run:

`npm.cmd test -- src/components/command-ui.test.tsx src/components/game-ui.test.tsx src/components/StrategicMap.test.tsx`

Expected: all pass with no React act warnings.

---

### Task 5: Critical And Strategy Failure Map Feedback

**Files:**
- Modify: `src/components/StrategicMap.tsx`
- Modify: `src/components/GameShell.tsx`
- Modify: `src/components/StrategicMap.test.tsx`
- Modify: `src/components/command-ui.test.tsx`
- Modify: `src/styles.css`

**Interfaces:**
- Consumes: `BattleDamageReport.critical`, `BattleDamageReport.label`, and `GameState.strategyResultReports`.
- Produces: timed critical labels and failed-strategy labels on the battlefield.

- [ ] **Step 1: Write failing overlay tests**

Add a StrategicMap test with one critical report and one failed strategy report. Assert `battle-critical-label` contains `暴击`, `strategy-result-label` contains `计略失败`, both use their report coordinates, and normal damage still renders `-amount`.

- [ ] **Step 2: Run the map test and verify RED**

Run: `npm.cmd test -- src/components/StrategicMap.test.tsx`

Expected: the new labels are absent.

- [ ] **Step 3: Add transient report rendering**

Pass `strategyResultReports` into `StrategicMap`. Mirror the existing two-second `visibleDamageReports` lifecycle in `GameShell` for strategy reports. Render only failed strategy labels; successful outcomes already have visible fire/status/damage effects.

For critical damage render two stable SVG text nodes: `暴击` above `-amount`. Reuse fixed offsets so labels do not change map geometry.

- [ ] **Step 4: Style the feedback**

Use high-contrast gold/red for `暴击` and restrained pale gray for `计略失败`, with the same non-interactive SVG behavior and animation duration as damage numbers. Do not add cards or modal notifications.

- [ ] **Step 5: Verify Task 5**

Run:

`npm.cmd test -- src/components/StrategicMap.test.tsx src/components/command-ui.test.tsx src/components/game-ui.test.tsx`

Expected: labels render and disappear without changing existing damage, fire, or facility overlays.

---

### Task 6: Full Determinism And Regression Verification

**Files:**
- Modify only the task-owned file responsible for a discovered failure.

**Interfaces:**
- Consumes all Tasks 1-5 outputs.
- Produces a behavior-compatible production build.

- [ ] **Step 1: Add local/online parity coverage**

In `intentReducer.test.ts`, construct a state immediately before a probabilistic tactic and strategy, apply the same intent through `reduceGameIntent` twice from structured clones, and assert complete state equality including `rngCursor`, damage reports, strategy reports, and target status.

- [ ] **Step 2: Run all battle and networking tests**

Run:

`npm.cmd test -- src/game/battle src/game/network src/game/store/gameCommandDispatcher.test.ts src/game/store/GameProvider.test.tsx`

Expected: all focused suites pass.

- [ ] **Step 3: Run the complete suite**

Run: `npm.cmd test`

Expected: all existing and new tests pass.

- [ ] **Step 4: Build production assets**

Run: `npm.cmd run build`

Expected: TypeScript and Vite complete with no errors.

- [ ] **Step 5: Inspect boundaries and diff**

Run:

```powershell
git diff --check
git status --short
rg -n "Math\.random|from ['\"]react|socket\.io|window\.|document\." src/game/battle/officerAbilities.ts
```

Expected: no whitespace errors, no nondeterministic RNG, no frontend/network dependency in the pure module, no deleted runtime data, and no unrelated file reverted.

- [ ] **Step 6: Browser smoke test**

Start backend and frontend on unused ports. Verify a B spear formation shows all three tactics with tiers 2-3 disabled, an S deputy unlocks tier 3, the detail panel shows source officers, a critical displays `暴击`, and a failed harmful strategy displays `计略失败`. Inspect browser console logs and require no errors.

- [ ] **Step 7: Present changes before any production commit**

Summarize changed files, test totals, build result, and remaining balance risks. Because the worktree already contains uncommitted production/refactor changes, request explicit approval before staging or committing production files.
