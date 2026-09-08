import { describe, it, expect } from 'vitest';
import { createGame } from '../scenario/jingxiang208';
import type { ArmyUnit } from '../types';
import { neighborsOf } from './grid';
import { cellAt, movementCells } from './movementRules';
import { computeDelegatePath, setMoveDelegate, executeDelegations } from './delegate';
import { movementAllowanceForUnit } from './legacyCore';

function makeUnit(forceId: string, homeCityId: string, q: number, r: number, overrides: Partial<ArmyUnit> = {}): ArmyUnit {
  return {
    id: 'delegate-unit',
    kind: 'combat',
    forceId,
    leaderId: 'liu-bei',
    homeCityId,
    troopType: 'sword',
    q,
    r,
    troops: 3000,
    food: 6000,
    gold: 0,
    energy: 100,
    movementRemaining: 20,
    moved: false,
    acted: false,
    ...overrides,
  } as ArmyUnit;
}

function freshTurn(state: ReturnType<typeof createGame>) {
  const unit = state.units['delegate-unit'];
  unit.moved = false;
  unit.acted = false;
  unit.movementRemaining = movementAllowanceForUnit(unit);
  return state;
}

function hexDist(a: { q: number; r: number }, b: { q: number; r: number }) {
  const dq = a.q - b.q;
  const dr = a.r - b.r;
  return (Math.abs(dq) + Math.abs(dr) + Math.abs(dq - dr)) / 2;
}

describe('repro', () => {
  it('scan for anomalous delegate paths', () => {
    const state = createGame('liu', 1);
    const spawn = neighborsOf(state.cities.jiangling.gridQ, state.cities.jiangling.gridR as number)
      .find((n) => cellAt(state, n))!;
    state.units['delegate-unit'] = makeUnit('liu', 'jiangling', spawn.q, spawn.r);
    const unit = state.units['delegate-unit'];

    // Enumerate every grid cell, use computeDelegatePath from unit to cell, and record the first step direction vs straight-line direction.
    let anomalies: { target: string; len: number; first: string; distBefore: number; distAfter: number }[] = [];
    let count = 0;
    for (const cell of state.grid) {
      if (cell.q === spawn.q && cell.r === spawn.r) continue;
      const path = computeDelegatePath(state, 'delegate-unit', { q: cell.q, r: cell.r });
      if (!path || path.length < 3) continue;
      count += 1;
      const firstStep = path[1];
      const dBefore = hexDist(spawn, cell);
      const dAfter = hexDist(firstStep, cell);
      if (dAfter > dBefore + 0.5) {
        anomalies.push({ target: `${cell.q},${cell.r}`, len: path.length, first: `${firstStep.q},${firstStep.r}`, distBefore: dBefore, distAfter: dAfter });
      }
    }
    console.log('paths computed:', count);
    console.log('anomalies (first step increases distance):', anomalies.length);
    for (const a of anomalies.slice(0, 20)) console.log(JSON.stringify(a));
    expect(true).toBe(true);
  }, 60000);
});
