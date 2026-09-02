import type { ArmyUnit, GameState } from '../types';
import { gridKey } from './grid';
import { fireDamageMultiplierOf } from '../skills/rules/combat';
import { reduceUnitDamageByFortress, removeUnit } from './shared';

export const GROUND_FIRE_DAMAGE = 500;
export const GROUND_FIRE_FACILITY_DAMAGE = 150;

function isBurningGround(state: GameState, unit: ArmyUnit) {
  const unitKey = gridKey(unit);
  return (state.firePlots ?? []).some((plot) => gridKey(plot) === unitKey);
}

function applyDamage(next: GameState, unit: ArmyUnit, prefix: string) {
  // 藤甲：火焰伤害加倍
  const damage = reduceUnitDamageByFortress(next, unit, Math.round(GROUND_FIRE_DAMAGE * fireDamageMultiplierOf(next, unit)));
  unit.troops -= damage;
  next.battleDamageReports ??= [];
  next.battleDamageReports.push({
    id: `${prefix}-${next.month}-${next.tenDay}-${unit.id}-${next.battleDamageReports.length}`,
    unitId: unit.id,
    q: unit.q,
    r: unit.r,
    amount: damage,
    kind: 'attack',
  });
  if (unit.troops <= 0) removeUnit(next, unit);
}

export function applyGroundFireDamageToUnit(next: GameState, unitId: string, prefix = 'ground-fire') {
  const unit = next.units[unitId];
  if (!unit || !isBurningGround(next, unit)) return;
  applyDamage(next, unit, prefix);
}

export function applyGroundFireDamageToUnits(next: GameState, prefix = 'ground-fire') {
  for (const unit of [...Object.values(next.units)]) {
    const nextUnit = next.units[unit.id];
    if (!nextUnit || !isBurningGround(next, nextUnit)) continue;
    applyDamage(next, nextUnit, prefix);
  }
}

export function applyGroundFireDamageToFacilities(next: GameState) {
  const burningKeys = new Set((next.firePlots ?? []).map(gridKey));
  for (const facility of Object.values(next.facilities ?? {})) {
    if (!burningKeys.has(gridKey(facility))) continue;
    const nextFacility = next.facilities?.[facility.id];
    if (!nextFacility) continue;
    nextFacility.durability = Math.max(0, nextFacility.durability - GROUND_FIRE_FACILITY_DAMAGE);
    if (nextFacility.durability <= 0) delete next.facilities?.[facility.id];
  }
}
