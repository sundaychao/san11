import {
  attackCity,
  attackFacility,
  attackPass,
  attackPlot,
  attackUnit,
  buildFacility,
  deployTransportUnit,
  deployTransportUnitWithId,
  deployUnit,
  deployUnitWithId,
  dismantleFacility,
  jointAttackUnit,
  moveUnit,
  repairFacility,
  supplyUnit,
  useFirePlot,
  useSiegeTacticOnStructure,
  useUnitStrategy,
  useUnitTactic,
  waitUnit,
} from '../battle/actions';
import { isSiegeTactic } from '../battle/catalog';
import { setBuildDelegate, setMoveDelegate, setRepairDelegate } from '../battle/delegate';
import type { GridCoord } from '../battle/grid';
import type { DeployFollowupAction } from './intents';
import { executeCommand } from '../commands';
import { dismissDebate, resolveDebateAbandon, resolveDebateRethink, resolveDebateRound } from '../debate';
import { executeDuel } from '../duel';
import { clampStrongholdResources } from '../strongholdCapacity';
import type { ForceId, GameState } from '../types';
import type { GameIntent } from './intents';

export type ActionGameIntent = Exclude<GameIntent, { type: 'endTenDay' }>;

function assertNever(value: never): never {
  throw new Error(`未知游戏操作：${JSON.stringify(value)}`);
}

/** 手动行动指令会中断部队委任（待命 wait 除外），清除该部队 delegate */
function cancelUnitDelegate(state: GameState, unitId: string): GameState {
  if (!state.units[unitId]?.delegate) return state;
  const next = structuredClone(state);
  delete next.units[unitId].delegate;
  return next;
}

function moveIfRequested(
  state: GameState,
  forceId: ForceId,
  unitId: string,
  destination?: GridCoord,
) {
  return destination ? moveUnit(state, forceId, unitId, destination) : state;
}

/** 舌战会话是否属于当前行动势力（AI 或其他玩家的舌战不可操作） */
function debateOwnedByForce(state: GameState, forceId: ForceId): boolean {
  const session = state.debateSession;
  return !!session && state.officers[session.recruiterId]?.forceId === forceId;
}

export function reduceGameIntent(
  state: GameState,
  forceId: ForceId,
  intent: ActionGameIntent,
): GameState {
  // 所有指令（玩家点击 / AI / 联网）都从这里出去，统一在出口把据点资源截断到容纳上限，
  // 避免逐条指令去记「这条会不会把金钱/粮食/兵装顶爆」。
  return clampStrongholdResources(reduceIntent(state, forceId, intent));
}

/** 部署后的跟随动作：出征（deployUnitAction）与输送（deployTransportUnit + action）共用同一份口径 */
function applyDeployFollowup(
  state: GameState,
  forceId: ForceId,
  unitId: string,
  action: DeployFollowupAction,
): GameState {
  switch (action.type) {
    case 'wait':
      return state;
    case 'attackUnit':
      return attackUnit(state, forceId, unitId, action.targetId);
    case 'jointAttackUnit':
      return jointAttackUnit(state, forceId, unitId, action.targetId);
    case 'attackFacility':
      return attackFacility(state, forceId, unitId, action.facilityId);
    case 'attackPlot':
      return attackPlot(state, forceId, unitId, action.cityId, action.plotIndex);
    case 'attackCity':
      return attackCity(state, forceId, unitId, action.cityId);
    case 'attackPass':
      return attackPass(state, forceId, unitId, action.passId);
    case 'useUnitTactic':
      return resolveTactic(state, forceId, unitId, action.targetId, action.tacticId);
    case 'useUnitStrategy':
      return useUnitStrategy(state, forceId, unitId, action.strategyId, action.selection);
    case 'buildFacility':
      return buildFacility(state, forceId, unitId, action.facilityType, action.target);
    case 'repairFacility':
      // 出征菜单中的“修补”允许目标在出生格以外：落位后交由修补委任推进，
      // 相邻时会立即修补，远处则先向设施的可通行邻格行军。
      return setRepairDelegate(state, forceId, unitId, action.facilityId);
    case 'supplyUnit':
      // 出城即补给：输送队落位后直接对相邻部队结算补给（补给内部自己清 delegate、置 acted）
      return supplyUnit(state, forceId, unitId, action.targetId, action);
    default:
      return assertNever(action);
  }
}

/** 战法结算：兵器战法打建筑（城池/关隘/设施）走建筑通道，其余仍是部队战法 */
function resolveTactic(
  state: GameState,
  forceId: ForceId,
  unitId: string,
  targetId: string,
  tacticId: Parameters<typeof useUnitTactic>[4],
) {
  if (isSiegeTactic(tacticId) && !state.units[targetId]) {
    return useSiegeTacticOnStructure(state, forceId, unitId, targetId, tacticId);
  }
  return useUnitTactic(state, forceId, unitId, targetId, tacticId);
}

function reduceIntent(
  state: GameState,
  forceId: ForceId,
  intent: ActionGameIntent,
): GameState {
  switch (intent.type) {
    case 'issueCommand':
      return executeCommand(state, forceId, intent.command);
    case 'deployUnit':
      return deployUnit(state, forceId, intent.input);
    case 'deployUnitDelegate': {
      // 出征到指定部署格后立即沿最优路径行军到本旬最远处（与普通移动的超距委任一致），
      // 并记录移动/建设委任。出征落位残留的 moved=true 由委任链路内部放开（delegate.withMovableUnit），
      // 这里不再手动置 false —— 出征部队与已存在部队走同一套委任逻辑。
      const deployed = deployUnitWithId(state, forceId, intent.input);
      const next = intent.facility
        ? setBuildDelegate(deployed.state, forceId, deployed.unitId, intent.target, intent.facility)
        : setMoveDelegate(deployed.state, forceId, deployed.unitId, intent.target);
      if (!next.units[deployed.unitId]) return next; // 行军中进驻/回城：部队消失，委任自然结束
      // 建设/修补委任由 setBuildDelegate 内部维护；移动委任未到达目标时已由 setMoveDelegate 记录
      if (intent.facility) {
        next.units[deployed.unitId].delegate = { kind: 'build', target: intent.target, facility: intent.facility };
      } else {
        const unit = next.units[deployed.unitId];
        // 兜底：本旬行军受阻（如被围）时 delegateMoveStep 不会记录委任，补设以免委任丢失
        if (!unit.delegate && (unit.q !== intent.target.q || unit.r !== intent.target.r)) {
          unit.delegate = { kind: 'move', target: intent.target };
        }
      }
      return next;
    }
    case 'deployUnitAction': {
      const deployed = deployUnitWithId(state, forceId, intent.input);
      return applyDeployFollowup(deployed.state, forceId, deployed.unitId, intent.action);
    }
    case 'deployTransportUnit': {
      if (!intent.action) return deployTransportUnit(state, forceId, intent.input);
      // 输送队落位后从命令菜单发起的攻击等跟随动作：先真正出城，再对同一支部队结算动作
      const deployed = deployTransportUnitWithId(state, forceId, intent.input);
      return applyDeployFollowup(deployed.state, forceId, deployed.unitId, intent.action);
    }
    case 'moveUnit':
      return cancelUnitDelegate(moveUnit(state, forceId, intent.unitId, intent.destination), intent.unitId);
    case 'setMoveDelegate':
      return setMoveDelegate(state, forceId, intent.unitId, intent.target);
    case 'setBuildDelegate':
      return setBuildDelegate(state, forceId, intent.unitId, intent.target, intent.facility);
    case 'setRepairDelegate':
      return setRepairDelegate(state, forceId, intent.unitId, intent.facilityId);
    case 'waitUnit':
      return waitUnit(state, forceId, intent.unitId);
    case 'attackUnit': {
      const moved = moveIfRequested(state, forceId, intent.attackerId, intent.destination);
      return cancelUnitDelegate(attackUnit(moved, forceId, intent.attackerId, intent.targetId), intent.attackerId);
    }
    case 'jointAttackUnit': {
      const moved = moveIfRequested(state, forceId, intent.attackerId, intent.destination);
      return cancelUnitDelegate(jointAttackUnit(moved, forceId, intent.attackerId, intent.targetId), intent.attackerId);
    }
    case 'attackFacility': {
      const moved = moveIfRequested(state, forceId, intent.attackerId, intent.destination);
      return cancelUnitDelegate(attackFacility(moved, forceId, intent.attackerId, intent.facilityId), intent.attackerId);
    }
    case 'attackPlot': {
      const moved = moveIfRequested(state, forceId, intent.attackerId, intent.destination);
      return cancelUnitDelegate(attackPlot(moved, forceId, intent.attackerId, intent.cityId, intent.plotIndex), intent.attackerId);
    }
    case 'useUnitTactic': {
      const moved = moveIfRequested(state, forceId, intent.attackerId, intent.destination);
      return cancelUnitDelegate(resolveTactic(moved, forceId, intent.attackerId, intent.targetId, intent.tacticId), intent.attackerId);
    }
    case 'useUnitStrategy': {
      const moved = moveIfRequested(state, forceId, intent.unitId, intent.destination);
      return cancelUnitDelegate(useUnitStrategy(moved, forceId, intent.unitId, intent.strategyId, intent.selection), intent.unitId);
    }
    case 'useFirePlot': {
      const moved = moveIfRequested(state, forceId, intent.unitId, intent.destination);
      return cancelUnitDelegate(useFirePlot(moved, forceId, intent.unitId, intent.target), intent.unitId);
    }
    case 'buildFacility': {
      const moved = moveIfRequested(state, forceId, intent.unitId, intent.destination);
      return buildFacility(moved, forceId, intent.unitId, intent.facilityType, intent.target);
    }
    case 'repairFacility': {
      const moved = moveIfRequested(state, forceId, intent.unitId, intent.destination);
      return repairFacility(moved, forceId, intent.unitId, intent.facilityId);
    }
    case 'supplyUnit': {
      // 补给内部自己清 delegate（与修补同口径），这里只负责先走完菜单落点
      const moved = moveIfRequested(state, forceId, intent.unitId, intent.destination);
      return supplyUnit(moved, forceId, intent.unitId, intent.targetId, {
        troops: intent.troops,
        gold: intent.gold,
        food: intent.food,
        armaments: intent.armaments,
      });
    }
    case 'dismantleFacility':
      return dismantleFacility(state, forceId, intent.facilityId);
    case 'attackCity': {
      const moved = moveIfRequested(state, forceId, intent.attackerId, intent.destination);
      return cancelUnitDelegate(attackCity(moved, forceId, intent.attackerId, intent.cityId), intent.attackerId);
    }
    case 'attackPass': {
      const moved = moveIfRequested(state, forceId, intent.attackerId, intent.destination);
      return cancelUnitDelegate(attackPass(moved, forceId, intent.attackerId, intent.passId), intent.attackerId);
    }
    case 'duelUnit': {
      const moved = moveIfRequested(state, forceId, intent.unitId, intent.destination);
      return cancelUnitDelegate(executeDuel(moved, forceId, intent.unitId, intent.targetUnitId, intent.stance), intent.unitId);
    }
    case 'debateRound':
      return debateOwnedByForce(state, forceId) ? resolveDebateRound(state, intent.cardUid) : state;
    case 'debateRethink':
      return debateOwnedByForce(state, forceId) ? resolveDebateRethink(state) : state;
    case 'debateAbandon':
      return debateOwnedByForce(state, forceId) ? resolveDebateAbandon(state) : state;
    case 'debateDismiss':
      return debateOwnedByForce(state, forceId) ? dismissDebate(state) : state;
    default:
      return assertNever(intent);
  }
}
