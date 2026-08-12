import { runAiTurn } from '../ai';
import {
  attackFacility,
  attackCity,
  attackUnit,
  buildFacility,
  deployTransportUnit,
  deployUnit,
  deployUnitWithId,
  dismantleFacility,
  moveUnit,
  repairFacility,
  settleBattleFacilities,
  useFirePlot,
  useUnitStrategy,
  useUnitTactic,
  waitUnit,
} from '../battle/actions';
import { executeCommand } from '../commands';
import { FORCE_IDS } from '../scenario/jingxiang208';
import { createMobileDuelGame } from '../scenario/mobileDuel';
import { settleTenDay } from '../turn';
import type { ForceId, GameState } from '../types';
import type { GameIntent } from './intents';

export const ONLINE_DUEL_MAX_PLAYERS = 2;

export interface OnlinePlayer {
  id: string;
  name: string;
  forceId: ForceId | null;
  connected: boolean;
}

export type OnlineRoomPhase = 'lobby' | 'playing';

export interface OnlineRoom {
  id: string;
  hostPlayerId: string;
  phase: OnlineRoomPhase;
  revision: number;
  seed: number;
  state: GameState | null;
  players: Record<string, OnlinePlayer>;
  playerOrder: string[];
  turnPlayerIds: string[];
  activePlayerId: string | null;
  completedTurnPlayerIds: string[];
  tenDayReadyForceIds: ForceId[];
}

export interface CreateOnlineRoomInput {
  roomId: string;
  hostPlayerId: string;
  hostName?: string;
  seed?: number;
}

export interface JoinOnlineRoomInput {
  playerId: string;
  playerName?: string;
}

export interface SelectPlayerForceInput {
  playerId: string;
  forceId: ForceId;
}

export interface StartOnlineRoomInput {
  playerId: string;
}

export type OnlineIntentResult =
  | { ok: true; room: OnlineRoom }
  | { ok: false; reason: string; room: OnlineRoom };

function playerName(name: string | undefined, playerId: string) {
  return name?.trim() || `玩家 ${playerId.slice(0, 4)}`;
}

export function createOnlineRoom(input: CreateOnlineRoomInput): OnlineRoom {
  return {
    id: input.roomId,
    hostPlayerId: input.hostPlayerId,
    phase: 'lobby',
    revision: 1,
    seed: input.seed ?? Date.now(),
    state: null,
    players: {
      [input.hostPlayerId]: {
        id: input.hostPlayerId,
        name: playerName(input.hostName, input.hostPlayerId),
        forceId: null,
        connected: true,
      },
    },
    playerOrder: [input.hostPlayerId],
    turnPlayerIds: [],
    activePlayerId: null,
    completedTurnPlayerIds: [],
    tenDayReadyForceIds: [],
  };
}

export function joinOnlineRoom(room: OnlineRoom, input: JoinOnlineRoomInput): OnlineRoom {
  const isNewPlayer = !room.players[input.playerId];
  if (isNewPlayer && Object.keys(room.players).length >= ONLINE_DUEL_MAX_PLAYERS) {
    throw new Error('手机双人对战房间只支持 2 名玩家');
  }
  if (room.phase !== 'lobby') throw new Error('游戏已经开始');
  return {
    ...room,
    revision: room.revision + 1,
    playerOrder: room.playerOrder.includes(input.playerId) ? room.playerOrder : [...room.playerOrder, input.playerId],
    players: {
      ...room.players,
      [input.playerId]: {
        id: input.playerId,
        name: playerName(input.playerName, input.playerId),
        forceId: room.players[input.playerId]?.forceId ?? null,
        connected: true,
      },
    },
  };
}

export function selectPlayerForce(room: OnlineRoom, input: SelectPlayerForceInput): OnlineRoom {
  if (room.phase !== 'lobby') throw new Error('游戏已经开始');
  const player = room.players[input.playerId];
  if (!player) throw new Error('玩家不在房间中');
  if (Object.values(room.players).some((candidate) => (
    candidate.id !== input.playerId && candidate.forceId === input.forceId
  ))) {
    throw new Error('该势力已被占用');
  }
  return {
    ...room,
    revision: room.revision + 1,
    players: {
      ...room.players,
      [input.playerId]: {
        ...player,
        forceId: input.forceId,
      },
    },
  };
}

export function startOnlineRoom(room: OnlineRoom, input: StartOnlineRoomInput): OnlineRoom {
  if (input.playerId !== room.hostPlayerId) throw new Error('只有房主可以开始游戏');
  if (room.phase !== 'lobby') throw new Error('游戏已经开始');

  const players = Object.values(room.players);
  if (players.length > ONLINE_DUEL_MAX_PLAYERS) throw new Error('手机双人对战房间只支持 2 名玩家');
  if (players.length < 2) throw new Error('至少需要 2 名玩家');
  if (players.some((player) => !player.forceId)) throw new Error('所有玩家都需要选择势力');

  const hostForceId = room.players[room.hostPlayerId]?.forceId;
  const turnPlayerIds = room.playerOrder.filter((playerId) => Boolean(room.players[playerId]?.forceId));
  const guestForceId = turnPlayerIds
    .map((playerId) => room.players[playerId]?.forceId)
    .find((forceId): forceId is ForceId => Boolean(forceId && forceId !== hostForceId));
  if (!guestForceId) throw new Error('手机双人地图需要第二名玩家选择势力');
  if (!hostForceId) throw new Error('房主需要选择势力');

  return {
    ...room,
    phase: 'playing',
    revision: room.revision + 1,
    turnPlayerIds,
    activePlayerId: turnPlayerIds[0] ?? null,
    completedTurnPlayerIds: [],
    state: createMobileDuelGame(hostForceId, guestForceId, room.seed),
  };
}

export function setPlayerConnected(room: OnlineRoom, playerId: string, connected: boolean): OnlineRoom {
  const player = room.players[playerId];
  if (!player) return room;
  return {
    ...room,
    revision: room.revision + 1,
    players: {
      ...room.players,
      [playerId]: { ...player, connected },
    },
  };
}

export function occupiedForceIds(room: OnlineRoom): ForceId[] {
  return [...new Set(Object.values(room.players).flatMap((player) => player.forceId ? [player.forceId] : []))];
}

export function playerState(room: OnlineRoom, playerId: string): GameState | null {
  const player = room.players[playerId];
  if (!player || !player.forceId || !room.state) return null;
  const activeForceId = room.activePlayerId ? room.players[room.activePlayerId]?.forceId ?? player.forceId : player.forceId;
  return personalizeState(room.state, player.forceId, activeForceId);
}

export function personalizeState(state: GameState, forceId: ForceId, turnForceId = forceId): GameState {
  return {
    ...structuredClone(state),
    playerForceId: forceId,
    turnForceId,
  };
}

function canonicalState(state: GameState, hostForceId: ForceId): GameState {
  return {
    ...structuredClone(state),
    playerForceId: hostForceId,
    turnForceId: hostForceId,
  };
}

function forceForPlayer(room: OnlineRoom, playerId: string): ForceId {
  const player = room.players[playerId];
  if (!player) throw new Error('玩家不在房间中');
  if (!player.forceId) throw new Error('玩家尚未选择势力');
  return player.forceId;
}

function hostForceId(room: OnlineRoom) {
  const forceId = room.players[room.hostPlayerId]?.forceId ?? room.state?.playerForceId;
  if (!forceId) throw new Error('房主尚未选择势力');
  return forceId;
}

function stateForAction(room: OnlineRoom, forceId: ForceId) {
  if (!room.state) throw new Error('游戏尚未开始');
  return personalizeState(room.state, forceId, forceId);
}

function applyGameIntent(room: OnlineRoom, forceId: ForceId, intent: Exclude<GameIntent, { type: 'endTenDay' }>): GameState {
  const state = stateForAction(room, forceId);
  switch (intent.type) {
    case 'issueCommand':
      return executeCommand(state, forceId, intent.command);
    case 'deployUnit':
      return deployUnit(state, forceId, intent.input);
    case 'deployUnitAction': {
      const deployed = deployUnitWithId(state, forceId, intent.input);
      switch (intent.action.type) {
        case 'wait':
          return deployed.state;
        case 'attackUnit':
          return attackUnit(deployed.state, forceId, deployed.unitId, intent.action.targetId);
        case 'attackFacility':
          return attackFacility(deployed.state, forceId, deployed.unitId, intent.action.facilityId);
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
      }
    }
    case 'deployTransportUnit':
      return deployTransportUnit(state, forceId, intent.input);
    case 'moveUnit':
      return moveUnit(state, forceId, intent.unitId, intent.destination);
    case 'waitUnit':
      return waitUnit(state, forceId, intent.unitId);
    case 'attackUnit': {
      const moved = intent.destination ? moveUnit(state, forceId, intent.attackerId, intent.destination) : state;
      return attackUnit(moved, forceId, intent.attackerId, intent.targetId);
    }
    case 'attackFacility': {
      const moved = intent.destination ? moveUnit(state, forceId, intent.attackerId, intent.destination) : state;
      return attackFacility(moved, forceId, intent.attackerId, intent.facilityId);
    }
    case 'useUnitTactic': {
      const moved = intent.destination ? moveUnit(state, forceId, intent.attackerId, intent.destination) : state;
      return useUnitTactic(moved, forceId, intent.attackerId, intent.targetId, intent.tacticId);
    }
    case 'useUnitStrategy': {
      const moved = intent.destination ? moveUnit(state, forceId, intent.unitId, intent.destination) : state;
      return useUnitStrategy(moved, forceId, intent.unitId, intent.strategyId, intent.selection);
    }
    case 'useFirePlot': {
      const moved = intent.destination ? moveUnit(state, forceId, intent.unitId, intent.destination) : state;
      return useFirePlot(moved, forceId, intent.unitId, intent.target);
    }
    case 'buildFacility': {
      const moved = intent.destination ? moveUnit(state, forceId, intent.unitId, intent.destination) : state;
      return buildFacility(moved, forceId, intent.unitId, intent.facilityType, intent.target);
    }
    case 'repairFacility': {
      const moved = intent.destination ? moveUnit(state, forceId, intent.unitId, intent.destination) : state;
      return repairFacility(moved, forceId, intent.unitId, intent.facilityId);
    }
    case 'dismantleFacility':
      return dismantleFacility(state, forceId, intent.facilityId);
    case 'attackCity': {
      const moved = intent.destination ? moveUnit(state, forceId, intent.attackerId, intent.destination) : state;
      return attackCity(moved, forceId, intent.attackerId, intent.cityId);
    }
  }
}

function advanceTenDay(room: OnlineRoom): GameState {
  if (!room.state) throw new Error('游戏尚未开始');
  let state = room.state;
  const occupied = new Set(occupiedForceIds(room));
  for (const forceId of FORCE_IDS) {
    if (!occupied.has(forceId)) state = runAiTurn(personalizeState(state, forceId), forceId);
  }
  return settleTenDay(canonicalState(state, hostForceId(room)));
}

function settleActivePlayerTurnStart(room: OnlineRoom, activePlayerId: string | null): GameState | null {
  if (!room.state || !activePlayerId) return room.state;
  const activeForceId = room.players[activePlayerId]?.forceId;
  if (!activeForceId) return room.state;
  const next = structuredClone(room.state);
  next.battleDamageReports = [];
  next.facilityRepairReports = [];
  settleBattleFacilities(next, activeForceId);
  return canonicalState(next, hostForceId(room));
}

function nextActivePlayerId(room: OnlineRoom, completedTurnPlayerIds: string[]) {
  return room.turnPlayerIds.find((playerId) => !completedTurnPlayerIds.includes(playerId)) ?? null;
}

export function reduceOnlineIntent(room: OnlineRoom, playerId: string, baseRevision: number, intent: GameIntent): OnlineIntentResult {
  if (baseRevision !== room.revision) return { ok: false, reason: '状态已更新，请重试', room };
  if (room.phase !== 'playing' || !room.state) return { ok: false, reason: '游戏尚未开始', room };

  try {
    const forceId = forceForPlayer(room, playerId);
    if (room.activePlayerId !== playerId) return { ok: false, reason: '等待其他玩家操作中', room };
    if (intent.type === 'endTenDay') {
      const completedTurnPlayerIds = [...new Set([...room.completedTurnPlayerIds, playerId])];
      const activePlayerId = nextActivePlayerId(room, completedTurnPlayerIds);
      const allReady = !activePlayerId;
      const nextRoom = allReady
        ? {
          ...room,
          revision: room.revision + 1,
          state: advanceTenDay(room),
          activePlayerId: room.turnPlayerIds[0] ?? null,
          completedTurnPlayerIds: [],
          tenDayReadyForceIds: [],
        }
        : {
          ...room,
          revision: room.revision + 1,
          state: settleActivePlayerTurnStart(room, activePlayerId),
          activePlayerId,
          completedTurnPlayerIds,
          tenDayReadyForceIds: occupiedForceIds(room).filter((occupiedForceId) => {
            const owner = Object.values(room.players).find((candidate) => candidate.forceId === occupiedForceId);
            return owner ? completedTurnPlayerIds.includes(owner.id) : false;
          }),
        };
      return { ok: true, room: nextRoom };
    }

    const nextState = applyGameIntent(room, forceId, intent);
    return {
      ok: true,
      room: {
        ...room,
        revision: room.revision + 1,
        state: canonicalState(nextState, hostForceId(room)),
        tenDayReadyForceIds: room.tenDayReadyForceIds.filter((readyForceId) => readyForceId !== forceId),
      },
    };
  } catch (error) {
    return {
      ok: false,
      reason: error instanceof Error ? error.message : '联网操作失败',
      room,
    };
  }
}
