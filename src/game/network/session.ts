import { runAiTurn } from '../ai';
import { createGame, FORCE_IDS } from '../scenario/jingxiang208';
import { createGameFromMap, forcesOfMap } from '../scenario/customMap';
import { createMobileDuelGame } from '../scenario/mobileDuel';
import { getMap } from '../mapRegistry';
import type { EditorMapPayload } from '../map-editor/editor';
import { settleForceTurnStart } from '../skills/rules/turn';
import { advanceTenDay } from '../turn';
import type { ForceId, GameState } from '../types';
import { reduceGameIntent } from './intentReducer';
import type { GameIntent } from './intents';

export const ONLINE_DUEL_MAX_PLAYERS = 2;

/** 对战地图：small=荆襄小地图（2人），homeland=单机大地图（最多4人，不足用电脑势力补位），其余字符串为地图注册表 mapId（自定义/内置其它图） */
export type RoomMap = 'small' | 'homeland' | string;

/** 地图允许的真人玩家上限：homeland=4，small=2，其余按该图有主城池的势力数（≤4，无则回退 2）；优先用建房带入的 payload 判定 */
export function roomMaxPlayers(map: RoomMap, mapPayload?: EditorMapPayload): number {
  if (map === 'homeland') return 4;
  if (map === 'small') return ONLINE_DUEL_MAX_PLAYERS;
  const payload = mapPayload ?? getMap(map)?.payload;
  const forceCount = payload ? forcesOfMap(payload).length : 0;
  return forceCount > 0 ? Math.min(forceCount, 4) : ONLINE_DUEL_MAX_PLAYERS;
}

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
  map: RoomMap;
  /** 建房时由客户端带入的地图 payload（自定义/热插图等服务端注册表没有的地图必备） */
  mapPayload?: EditorMapPayload;
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
  map?: RoomMap;
  mapPayload?: EditorMapPayload;
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
    map: input.map ?? 'small',
    mapPayload: input.mapPayload,
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
  if (isNewPlayer && Object.keys(room.players).length >= roomMaxPlayers(room.map, room.mapPayload)) {
    throw new Error(
      room.map === 'homeland'
        ? '大地图房间最多支持 4 名玩家'
        : room.map === 'small'
          ? '手机双人对战房间只支持 2 名玩家'
          : '该地图房间人数已达上限',
    );
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

  // 小地图需要2名真人玩家，其余（homeland/自定义）可由房主一人选势力开局，不足用电脑补位
  const minPlayers = room.map === 'small' ? 2 : 1;
  const players = Object.values(room.players);
  if (players.length > roomMaxPlayers(room.map, room.mapPayload)) throw new Error('该房间人数已达上限');
  if (players.length < minPlayers) {
    throw new Error(room.map === 'small' ? '至少需要 2 名玩家' : '至少需要 1 名玩家');
  }
  if (players.some((player) => !player.forceId)) throw new Error('所有玩家都需要选择势力');

  const hostForceId = room.players[room.hostPlayerId]?.forceId;
  const turnPlayerIds = room.playerOrder.filter((playerId) => Boolean(room.players[playerId]?.forceId));
  if (!hostForceId) throw new Error('房主需要选择势力');

  let state: GameState;
  if (room.map === 'homeland') {
    // 复用单机大地图剧本，仅把人类玩家并入，其余势力在局间由 AI 控制
    state = createGame(hostForceId, room.seed);
  } else if (room.map === 'small') {
    // 小地图保留原手机双人对战
    const guestForceId = turnPlayerIds
      .map((playerId) => room.players[playerId]?.forceId)
      .find((forceId): forceId is ForceId => Boolean(forceId && forceId !== hostForceId));
    if (!guestForceId) throw new Error('手机双人地图需要第二名玩家选择势力');
    state = createMobileDuelGame(hostForceId, guestForceId, room.seed);
  } else {
    // 其它地图按 mapId 生成场景，不足用的势力由 AI 控制。
    // 优先用建房时客户端带入的 payload（自定义/热插图），否则从注册表取（内置图）
    const payload = room.mapPayload ?? getMap(room.map)?.payload;
    if (!payload) throw new Error('找不到所选的剧本地图');
    state = createGameFromMap(payload, hostForceId, room.seed);
  }

  return {
    ...room,
    phase: 'playing',
    revision: room.revision + 1,
    turnPlayerIds,
    activePlayerId: turnPlayerIds[0] ?? null,
    completedTurnPlayerIds: [],
    state,
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

function stateForForceTurnStart(state: GameState, activeForceId: ForceId) {
  const next = structuredClone(state);
  next.battleDamageReports = [];
  next.facilityRepairReports = [];
  next.strategyResultReports = [];
  next.cityEffectReports = [];
  settleForceTurnStart(next, activeForceId);
  return next;
}

/** 全部玩家都点了「进行」：统一走 turn.advanceTenDay（与单机同一条链路）。
 *  人类玩家势力各自执行一次委任，未被占用的势力跑 AI 回合。 */
function advanceRoomTenDay(room: OnlineRoom): GameState {
  if (!room.state) throw new Error('游戏尚未开始');
  const occupied = new Set(occupiedForceIds(room));
  return advanceTenDay(room.state, {
    delegatedForceIds: [...occupied],
    runAiTurns: (state) => {
      let next = state;
      for (const forceId of FORCE_IDS) {
        if (occupied.has(forceId)) continue;
        next = stateForForceTurnStart(personalizeState(next, forceId), forceId);
        next = runAiTurn(next, forceId);
      }
      return next;
    },
    prepareSettle: (state) => canonicalState(state, hostForceId(room)),
  });
}

function settleActivePlayerTurnStart(room: OnlineRoom, activePlayerId: string | null): GameState | null {
  if (!room.state || !activePlayerId) return room.state;
  const activeForceId = room.players[activePlayerId]?.forceId;
  if (!activeForceId) return room.state;
  const next = stateForForceTurnStart(room.state, activeForceId);
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
          state: advanceRoomTenDay(room),
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

    const nextState = reduceGameIntent(stateForAction(room, forceId), forceId, intent);
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
