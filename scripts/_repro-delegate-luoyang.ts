/* eslint-disable */
// 一次性复现脚本：宛骑兵委任洛阳，找出 setMoveDelegate 的实际落点 vs 理论最优点
import { createGame } from '../src/game/scenario/jingxiang208';
import { deployUnitWithId, chooseDelegateSpawnCell } from '../src/game/battle/deployment';
import { getDeploymentTargets } from '../src/game/battle/queries';
import { setMoveDelegate, optimalPathCells } from '../src/game/battle/delegate';
import { reachableCosts, cellAt, movementCells } from '../src/game/battle/movementRules';
import { gridKey, neighborsOf } from '../src/game/battle/grid';
import { movementAllowanceForUnit } from '../src/game/battle/catalog';

const state = createGame('cao', 1);
const wan = state.cities.wan;       // q=77, r=92
const luoyang = state.cities.luoyang; // q=79, r=76, empty
const target = { q: 79, r: 76 };

// 出征范围
const query = { cityId: 'wan' as const, troopType: 'cavalry' as const, officerIds: ['cao-cao'] };
const deployKeys = new Set(getDeploymentTargets(state, query).map(gridKey));
const spawn = chooseDelegateSpawnCell(getDeploymentTargets(state, query), target);
if (!spawn) { console.log('no spawn'); process.exit(0); }
console.log('宛', wan.gridQ, wan.gridR, '→ 洛阳', target.q, target.r, '选 spawn =', spawn);

// 部署骑兵（宛兵装可能不足，先补足）
state.cities.wan.armaments = { ...(state.cities.wan.armaments ?? {}), cavalry: 5000 } as any;
const sim = deployUnitWithId(state, 'cao', {
  cityId: 'wan', officerIds: ['cao-cao'], troopType: 'cavalry',
  troops: 1500, food: 6000, destination: spawn,
});
const unit = sim.state.units[sim.unitId];
unit.moved = false; unit.acted = false;
unit.movementRemaining = movementAllowanceForUnit(unit);
console.log('movementRemaining =', unit.movementRemaining, 'troopType =', unit.troopType);

// 1) 先独立调用 optimalPathCells（应能反映 setMoveDelegate 内部计算）
const pathIndependent = optimalPathCells(sim.state, { q: unit.q, r: unit.r }, target);
console.log('optimalPathCells(sim.state) 长度 =', pathIndependent?.length, ' 尾 =', pathIndependent?.[pathIndependent.length - 1]);

// 2) setMoveDelegate 实际落点
const delegated = setMoveDelegate(sim.state, 'cao', sim.unitId, target);
const u2 = delegated.units[sim.unitId];
console.log('委任落点 =', u2 ? `${u2.q},${u2.r}` : '已占领');
console.log('sim.state 单位位置(不应变) =', unit.q, unit.r);
console.log('delegated 状态 turnForceId/playerForceId =', delegated.turnForceId, '/', delegated.playerForceId);

// 2) 理论可达格中"离洛阳最近"的（贪心近距）
const reachable = reachableCosts(sim.state, unit);
let bestCell: { q: number; r: number } | undefined;
let bestDist = Number.POSITIVE_INFINITY;
for (const [key, cost] of reachable) {
  if (!Number.isFinite(cost)) continue;
  const [q, r] = key.split(',').map(Number);
  const d = Math.abs(q - target.q) + Math.abs(r - target.r);
  // 只考虑非城池格（停在外围），且不与 u2 重合时做对比
  if (d < bestDist) { bestDist = d; bestCell = { q, r }; }
}
console.log('理论最近可达格 =', bestCell, '距离 =', bestDist);
if (u2) console.log('委任落点距洛阳 =', Math.abs(u2.q - target.q) + Math.abs(u2.r - target.r));

// 3) 沿最优路径走，路径上每格距离
const path = optimalPathCells(sim.state, { q: unit.q, r: unit.r }, target);
console.log('最优路径长度 =', path?.length, '路径尾 =', path?.[path.length - 1]);
if (path) {
  for (let i = Math.max(0, path.length - 6); i < path.length; i++) {
    const c = path[i];
    const k = gridKey(c);
    const reachableCost = reachable.get(k);
    const d = Math.abs(c.q - target.q) + Math.abs(c.r - target.r);
    console.log(`  path[${i}] = ${c.q},${c.r} reachable=${reachableCost} 距洛阳=${d}`);
  }
}
