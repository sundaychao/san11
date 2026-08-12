# Officer-Driven Battle Design

**Date:** 2026-08-13

## Goal

Make officer selection materially affect combat in the style of Romance of the Three Kingdoms XI. Leadership, war, intelligence, troop aptitude, and deputy composition must influence battle outcomes while preserving deterministic local/online simulation and save compatibility.

## Scope

This phase adds:

- effective unit leadership, war, intelligence, and troop aptitude;
- aptitude-gated tactic tiers;
- aptitude-scaled tactic damage and tactic critical hits;
- intelligence-based harmful strategy success;
- UI feedback for effective abilities, locked tactics, critical hits, and failed strategies;
- deterministic tests for all new calculations.

Named officer skills remain data-only in this phase. Skill effects will be designed separately.

## Effective Unit Abilities

Create a pure battle ability module that derives values from the current `GameState` and `ArmyUnit`. Derived values are never persisted.

- **Leadership:** the leader's leadership.
- **War:** the highest war value among the leader and deputies.
- **Intelligence:** the highest intelligence value among the leader and deputies.
- **Troop aptitude:** the highest relevant aptitude among the leader and deputies.
- **Source officer:** each derived value also identifies the officer that supplied it for UI display. Ties use formation order, so the leader wins a tie before the first and second deputies.

For older saves or custom officers without aptitudes, use the existing fallback values: spear B, halberd B, crossbow B, cavalry B, siege C, and navy C. Sword units have no tactic aptitude.

## Tactic Access

Each troop type's current tactic order defines its tier:

- tier 1: first tactic;
- tier 2: second tactic;
- tier 3: third tactic.

Aptitude grants access as follows:

| Aptitude | Maximum tactic tier |
| --- | ---: |
| C | 0 |
| B | 1 |
| A | 2 |
| S | 3 |

The tactic menu continues to show all three tactics for supported troop types. A tactic is disabled when aptitude, energy, action status, or target availability prevents use. Disabled tactics expose a concise reason such as `需要枪兵适性 A`.

Server-side and local rule validation must reject a tactic whose tier exceeds the unit's effective aptitude. UI disabling is not the authority.

## Combat Formulas

### Normal damage

Retain the current troop-count, terrain, random, facility, and counterattack factors. Replace direct leader lookups with effective unit abilities and add a defender leadership modifier.

Use the current attack score with effective leadership and war, then multiply it by `clamp(0.80, 1.20, 1 + (attacker leadership - defender leadership) / 250)`. Existing minimum and maximum damage caps remain in force. Normal attacks do not critically hit in this phase.

### Tactic damage

Apply the existing tactic power, then an aptitude multiplier:

| Aptitude | Multiplier |
| --- | ---: |
| B | 1.00 |
| A | 1.10 |
| S | 1.20 |

C cannot use tactics.

### Tactic critical hits

Critical chance is an integer percentage calculated as `clamp(5, 30, round(5 + max(0, effective war - 60) * 0.35 + aptitude bonus))`, where the aptitude bonus is B `0`, A `4`, and S `8`. The formula lives in one exported pure calculator and is displayed by the UI.

A critical tactic deals 135% of its final pre-cap damage. It does not strengthen displacement, confusion duration, fire spread, or area size. For multi-target tactics, make one critical roll for the tactic and apply the same critical status to every affected target.

Critical rolls use the existing seeded RNG and advance `rngCursor` exactly once per tactic.

## Strategy Success

Effective intelligence is used for strategy calculations.

- **Fire:** `55% + (source intelligence - 50) * 0.8`, rounded to an integer percentage and bounded to 55%-95%.
- **False report, disturb, discord:** `70% + source intelligence - target intelligence`, bounded to 10%-95%.
- **Extinguish, calm, inspire:** always succeed.

A harmful strategy failure:

- consumes the full energy cost;
- marks the acting unit as acted;
- applies no fire, damage, movement, or abnormal status;
- emits a strategy failure report at the selected target.

Each probabilistic strategy uses one seeded RNG roll. The same state and intent therefore produce identical local and online results.

## Reports And UI

Extend report data only with optional fields so schema version 2 saves remain compatible.

- Battle damage reports may include `critical?: boolean` and `label?: string`.
- A strategy result report records its target coordinate, strategy name, and whether it succeeded.
- Critical tactic damage displays `暴击` above or alongside the damage value.
- Failed strategies display `计略失败` at the target and do not show an abnormal-state marker.

Unit hover and detail information show effective leadership, war, intelligence, and aptitude. Leadership is identified as leader-derived. When war, intelligence, or aptitude comes from a deputy, show that officer's name. The detail view also shows tactic critical chance and harmful strategy success chance for the currently inspected unit; target-dependent strategy chances are shown once a target is selected.

## Architecture

Add a pure officer-composition module under `src/game/battle` responsible for:

- resolving participating officers;
- fallback aptitude handling;
- effective ability calculation;
- aptitude rank and tactic tier access;
- tactic critical chance;
- strategy success chance.

Battle rule modules consume this API. React components only format its outputs and never duplicate formulas.

The existing shared `reduceGameIntent` remains the only local/online action entry point. No Socket.IO event or intent shape changes are required.

## Compatibility

- Keep `GameState.schemaVersion` at 2.
- Do not persist effective unit abilities.
- New report fields are optional.
- Existing units with only `leaderId` continue to work.
- Existing officers without aptitudes receive the defined fallback values.
- Current tactic positional effects, area selection, fire behavior, facility behavior, movement, and ZOC rules remain unchanged.

## Error Handling

Rule functions throw existing user-facing errors for missing units, invalid targets, insufficient energy, and wrong troop type. Add a specific aptitude error naming the required grade. Failed probability rolls are valid completed actions, not exceptions.

## Verification

Automated coverage must include:

- C/B/A/S access to zero/one/two/three tactic tiers;
- deputy war, intelligence, and aptitude contributions;
- leader-only leadership;
- fallback aptitude for legacy officers;
- monotonic attacker and defender leadership effects;
- B/A/S tactic damage multipliers;
- critical and non-critical tactic outcomes, including one roll for area tactics;
- harmful strategy success and failure, including energy and acted state;
- guaranteed friendly strategies;
- identical results from equal seeds and intents;
- unchanged existing tactic displacement, area damage, fire, facility, save, and online session tests.

Run the complete Vitest suite, production TypeScript/Vite build, and a browser smoke test of tactic lock states and combat reports before completion.
