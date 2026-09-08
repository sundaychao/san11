import {
  attackCity,
  attackFacility,
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
import { setBuildDelegate, setMoveDelegate } from '../battle/delegate';
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
      // 出征到指定部署格后立即记录移动/建设委任（本旬 moved=true 不会自动执行，下旬开始自动行军）
      const deployed = deployUnitWithId(state, forceId, intent.input);
      deployed.state.units[deployed.unitId].delegate = intent.facility
        ? { kind: 'build', target: intent.target, facility: intent.facility }
        : { kind: 'move', target: intent.target };
      return deployed.state;
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
