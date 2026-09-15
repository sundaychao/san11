import type { ArmyUnit, GameState } from '../types';
import { gridKey, sevenCellCityFootprint, type GridCoord } from './grid';
import { fireDamageMultiplierOf } from '../skills/rules/combat';
import { reduceUnitDamageByFortress, removeUnit } from './shared';
import { PLOT_LABELS, PLOT_MAX_DURABILITY, interruptArmamentProductionAtPlot } from '../innerAffairs';

export const GROUND_FIRE_DAMAGE = 500;
export const GROUND_FIRE_FACILITY_DAMAGE = 150;
/** 城池每回合因每个着火格损失的耐久（参考原版：火焰陷阱对城池每次耐久之火数百点；累计 7 格中着火格数） */
export const GROUND_FIRE_CITY_DURABILITY = 150;

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

/** 着火格上的城内开发设施（市场/农场等）每回合掉耐久，耐久归零即破坏地格（与部队攻击开发设施一致，参考火焰对野外设施 150/格） */
export function applyGroundFireDamageToPlots(next: GameState) {
  const burningKeys = new Set((next.firePlots ?? []).map(gridKey));
  for (const city of Object.values(next.cities)) {
    const plots = city.plots ?? [];
    for (let plotIndex = 0; plotIndex < plots.length; plotIndex += 1) {
      const plot = plots[plotIndex];
      if (plot.q == null || plot.r == null) continue;
      if (plot.type === 'empty') continue;
      if (!burningKeys.has(gridKey({ q: plot.q, r: plot.r }))) continue;
      plot.durability = Math.max(0, (plot.durability ?? PLOT_MAX_DURABILITY) - GROUND_FIRE_FACILITY_DAMAGE);
      if (plot.durability > 0) continue;
      // 耐久归零：设施拆除，地格清空（该地格上在产的兵器/舰船生产一并中断）
      const label = PLOT_LABELS[plot.type];
      plot.type = 'empty';
      plot.level = 0;
      plot.value = 0;
      plot.constructing = undefined;
      const interrupted = interruptArmamentProductionAtPlot(next, city, plotIndex);
      if (interrupted) {
        next.logs.push({
          id: `plot-burnt-${city.id}-${next.month}-${next.logs.length}`,
          month: next.month,
          forceId: city.ownerId,
          message: `${city.name}的${label}被烧毁，${interrupted}`,
        });
      }
    }
  }
}

/** 点火瞬间对目标格上的城内开发设施、所属城池本体、关隘本体造成一次即时耐久伤害（与点火对部队/野外设施的即时伤害一致，量值参考每旬烧灼）：开发设施掉 150，城池若目标格在其 7 格内则掉 150，关隘若目标格即其锚点则掉 150。无主空城/无主关隘同样会烧 */
export function applyImmediateFireDamageToCityAndPlot(next: GameState, target: GridCoord) {
  for (const city of Object.values(next.cities)) {
    const plots = city.plots ?? [];
    for (let plotIndex = 0; plotIndex < plots.length; plotIndex += 1) {
      const plot = plots[plotIndex];
      if (plot.q !== target.q || plot.r !== target.r) continue;
      if (plot.type === 'empty') continue;
      plot.durability = Math.max(0, (plot.durability ?? PLOT_MAX_DURABILITY) - GROUND_FIRE_FACILITY_DAMAGE);
      if (plot.durability > 0) continue;
      const label = PLOT_LABELS[plot.type];
      plot.type = 'empty';
      plot.level = 0;
      plot.value = 0;
      plot.constructing = undefined;
      // 设施被烧毁：该地格上在产的兵器/舰船生产一并中断（已投入资金不退还）
      const interrupted = interruptArmamentProductionAtPlot(next, city, plotIndex);
      if (interrupted) {
        next.logs.push({
          id: `plot-burnt-${city.id}-${next.month}-${next.logs.length}`,
          month: next.month,
          forceId: city.ownerId,
          message: `${city.name}的${label}被烧毁，${interrupted}`,
        });
      }
    }
    const inFootprint = sevenCellCityFootprint({ q: city.gridQ, r: city.gridR })
      .some((coord) => coord.q === target.q && coord.r === target.r);
    if (inFootprint) city.durability = Math.max(0, city.durability - GROUND_FIRE_CITY_DURABILITY);
  }
  // 关隘为单格据点：锚点格被点火即掉耐久（无主关隘同样会烧）
  for (const pass of Object.values(next.passes ?? {})) {
    if (pass.q !== target.q || pass.r !== target.r) continue;
    pass.durability = Math.max(0, pass.durability - GROUND_FIRE_CITY_DURABILITY);
  }
}

/** 城池每回合受火焰耐久损伤：7 格（中心+周围一圈）中有几个着火格，耐久就掉 base×N。无主空城同样会烧 */
export function applyGroundFireDamageToCities(next: GameState) {
  const burningKeys = new Set((next.firePlots ?? []).map(gridKey));
  for (const city of Object.values(next.cities)) {
    const burningCells = sevenCellCityFootprint({ q: city.gridQ, r: city.gridR })
      .filter((coord) => burningKeys.has(gridKey(coord))).length;
    if (burningCells === 0) continue;
    city.durability = Math.max(0, city.durability - GROUND_FIRE_CITY_DURABILITY * burningCells);
  }
}

/** 关隘每回合受火焰耐久损伤：锚点格着火即掉 base（关隘为单格据点，没有 7 格 footprint）。无主关隘同样会烧 */
export function applyGroundFireDamageToPasses(next: GameState) {
  const burningKeys = new Set((next.firePlots ?? []).map(gridKey));
  for (const pass of Object.values(next.passes ?? {})) {
    if (!burningKeys.has(gridKey({ q: pass.q, r: pass.r }))) continue;
    pass.durability = Math.max(0, pass.durability - GROUND_FIRE_CITY_DURABILITY);
  }
}
