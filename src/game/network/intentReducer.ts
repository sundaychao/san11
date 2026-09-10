import {
  attackCity,
  attackFacility,
  attackPass,
  attackPlot,
  attackUnit,
  buildFacility,
  deployTransportUnit,
  deployUnit,
  deployUnitWithId,
  dismantleFacility,
  jointAttackUnit,
  moveUnit,
  repairFacility,
  useFirePlot,
  useUnitStrategy,
  useUnitTactic,
  waitUnit,
} from '../battle/actions';
import { setBuildDelegate, setMoveDelegate, setRepairDelegate } from '../battle/delegate';
import type { GridCoord } from '../battle/grid';
import { executeCommand } from '../commands';
import { dismissDebate, resolveDebateAbandon, resolveDebateRethink, resolveDebateRound } from '../debate';
import { executeDuel } from '../duel';
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
  switch (intent.type) {
    case 'issueCommand':
      return executeCommand(state, forceId, intent.command);
    case 'deployUnit':
      return deployUnit(state, forceId, intent.input);
    case 'deployUnitDelegate': {
      // 出征到指定部署格后立即沿最优路径行军到本旬最远处（与普通移动的超距委任一致），
      // 并记录移动/建设委任：部署时 moved=true 会挡住 delegateMoveStep，先放开让部队行军，
      // moveUnit 内部会重新置 moved=true 并清空剩余移动力，防止本旬二次行动。
      const deployed = deployUnitWithId(state, forceId, intent.input);
      deployed.state.units[deployed.unitId].moved = false;
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
      switch (intent.action.type) {
        case 'wait':
          return deployed.state;
        case 'attackUnit':
          return attackUnit(deployed.state, forceId, deployed.unitId, intent.action.targetId);
        case 'jointAttackUnit':
          return jointAttackUnit(deployed.state, forceId, deployed.unitId, intent.action.targetId);
        case 'attackFacility':
          return attackFacility(deployed.state, forceId, deployed.unitId, intent.action.facilityId);
        case 'attackPlot':
          return attackPlot(deployed.state, forceId, deployed.unitId, intent.action.cityId, intent.action.plotIndex);
        case 'attackCity':
          return attackCity(deployed.state, forceId, deployed.unitId, intent.action.cityId);
        case 'attackPass':
          return attackPass(deployed.state, forceId, deployed.unitId, intent.action.passId);
        case 'useUnitTactic':
          return useUnitTactic(deployed.state, forceId, deployed.unitId, intent.action.targetId, intent.action.tacticId);
        case 'useUnitStrategy':
          return useUnitStrategy(deployed.state, forceId, deployed.unitId, intent.action.strategyId, intent.action.selection);
        case 'buildFacility':
          return buildFacility(deployed.state, forceId, deployed.unitId, intent.action.facilityType, intent.action.target);
        case 'repairFacility':
          return repairFacility(deployed.state, forceId, deployed.unitId, intent.action.facilityId);
        default:
          return assertNever(intent.action);
      }
    }
    case 'deployTransportUnit':
      return deployTransportUnit(state, forceId, intent.input);
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
      return cancelUnitDelegate(useUnitTactic(moved, forceId, intent.attackerId, intent.targetId, intent.tacticId), intent.attackerId);
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
