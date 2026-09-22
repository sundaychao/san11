export {
  deploymentCells,
  movementCells,
  unitCanStepThisTenDay,
  unitIsIncapacitated,
  unitUntouchedThisTenDay,
} from './movementRules';
export { movementAllowanceForProfile, movementAllowanceForUnit } from './catalog';
export type { MovementProfile } from './catalog';

import type { ForceId, GameState } from '../types';
import { applyGroundFireDamageToUnit } from './fire';
import { gridKey, type GridCoord } from './grid';
import { isLegalUnitCell, ownCityAt, reachableCosts, unoccupiedCityAt } from './movementRules';
import { assertUnitTurn } from './shared';
import { mergeUnitIntoStronghold } from '../strongholds';
import { ownPassAt, unoccupiedPassAt } from '../passes';
import { TECHP_PER_CITY_CAPTURE, addTechP } from '../techs';

/** 普通移动。`options.allowIncapacitated` 仅供系统强制移动（伪报部队撤退）使用，玩家路径不要传。 */
export function moveUnit(
  state: GameState,
  forceId: ForceId,
  unitId: string,
  destination: GridCoord,
  options: { allowIncapacitated?: boolean } = {},
): GameState {
  const unit = assertUnitTurn(state, forceId, unitId, options);
  if (unit.moved) throw new Error('部队已经移动');
  // 目标格为本方城池格 → 回城；为无守军无主城格 → 进驻占领（isLegalUnitCell 会拒绝一切城池格，此处放行）
  const returnCity = ownCityAt(state, forceId, destination);
  const occupyCity = returnCity ? undefined : unoccupiedCityAt(state, destination);
  // 目标格为本方关隘锚点 → 回关；为无守军无主关隘 → 进驻占领
  const returnPass = returnCity || occupyCity ? undefined : ownPassAt(state, forceId, destination);
  const occupyPass = returnCity || occupyCity || returnPass ? undefined : unoccupiedPassAt(state, destination);
  // 关隘中心格是普通可通行格：已有其他部队驻守时不能进驻，按普通移动处理（占用检查照常拦截）
  const passOccupiedByUnit = (returnPass || occupyPass)
    ? Object.values(state.units).some((other) => other.id !== unitId && other.q === destination.q && other.r === destination.r)
    : false;
  const enterPass = (returnPass || occupyPass) && !passOccupiedByUnit ? (returnPass ?? occupyPass)! : undefined;
  if (!returnCity && !occupyCity && !enterPass && !isLegalUnitCell(state, destination, unitId, undefined, forceId)) throw new Error('目标格被占用或不可通行');
  const cost = reachableCosts(state, unit).get(gridKey(destination));
  if (cost === undefined) throw new Error('目标超过移动力');

  const next = structuredClone(state);
  const movingUnit = next.units[unitId];

  if (enterPass) {
    // 回关/进驻关隘：兵力/军粮/金钱并入关隘，武将驻关，部队消失（与回城结算同口径，见 mergeUnitIntoStronghold）
    const pass = next.passes?.[enterPass.id];
    if (!pass) throw new Error('关隘数据缺失');
    if (occupyPass) {
      // 进驻无主关隘：兵不血刃，关隘易主（资源保留、耐久不减），获得占领技巧P
      pass.ownerId = forceId;
      pass.governorId = null;
      addTechP(next, forceId, TECHP_PER_CITY_CAPTURE);
    }
    mergeUnitIntoStronghold(next, movingUnit, pass);
    delete next.units[unitId];
    next.logs ??= [];
    next.logs.push({
      id: `return-${next.month}-${next.tenDay}-${unitId}-${next.logs.length}`,
      month: next.month,
      forceId,
      message: occupyPass
        ? `${next.officers[movingUnit.leaderId]?.name ?? '部队'}进驻无主的${pass.name}，兵不血刃。`
        : `${next.officers[movingUnit.leaderId]?.name ?? '部队'}率军返回${pass.name}。`,
    });
  } else if (returnCity || occupyCity) {
    const city = next.cities[(returnCity ?? occupyCity)!.id];
    if (occupyCity) {
      // 进驻无主空城：兵不血刃，城池易主（资源保留、耐久不减），获得占领技巧P
      city.ownerId = forceId;
      city.governorId = null;
      addTechP(next, forceId, TECHP_PER_CITY_CAPTURE);
    }
    // 回城：兵力（按部队士气加权稀释城池士气）/军粮/金钱并入城池，武将回城，部队消失
    mergeUnitIntoStronghold(next, movingUnit, city);
    delete next.units[unitId];
    next.logs ??= [];
    next.logs.push({
      id: `return-${next.month}-${next.tenDay}-${unitId}-${next.logs.length}`,
      month: next.month,
      forceId,
      message: occupyCity
        ? `${next.officers[movingUnit.leaderId]?.name ?? '部队'}进驻无主的${city.name}，兵不血刃。`
        : `${next.officers[movingUnit.leaderId]?.name ?? '部队'}率军返回${city.name}。`,
    });
  } else {
    movingUnit.q = destination.q;
    movingUnit.r = destination.r;
    movingUnit.movementRemaining = 0;
    movingUnit.moved = true;
  }
  next.battleDamageReports = [];
  next.cityEffectReports = [];
  next.facilityRepairReports = [];
  next.strategyResultReports = [];
  applyGroundFireDamageToUnit(next, unitId, 'move-fire');
  return next;
}

export function waitUnit(state: GameState, forceId: ForceId, unitId: string): GameState {
  assertUnitTurn(state, forceId, unitId);
  const next = structuredClone(state);
  next.units[unitId].acted = true;
  next.facilityRepairReports = [];
  next.strategyResultReports = [];
  return next;
}
