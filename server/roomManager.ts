import type { Socket } from 'socket.io';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import type { ForceId } from '../src/game/types';
import type { GameIntentPayload, OnlineRoomListItem, OnlineRoomView, OnlineSnapshot } from '../src/game/network/protocol';
import {
  createOnlineRoom,
  joinOnlineRoom,
  ONLINE_DUEL_MAX_PLAYERS,
  playerState,
  reduceOnlineIntent,
  selectPlayerForce,
  setPlayerConnected,
  startOnlineRoom,
  type OnlineRoom,
} from '../src/game/network/session';
import type { GameDatabase } from './database';

type AuthenticatedGameIntentPayload = GameIntentPayload & { playerId: string };

const ROOM_CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const LOBBY_DISCONNECT_GRACE_MS = 60_000;

function createRoomCode(existing: Set<string>) {
  for (let attempt = 0; attempt < 1000; attempt += 1) {
    let code = '';
    for (let index = 0; index < 4; index += 1) {
      code += ROOM_CODE_CHARS[Math.floor(Math.random() * ROOM_CODE_CHARS.length)];
    }
    if (!existing.has(code)) return code;
  }
  throw new Error('无法创建房间号');
}

function loadLegacyRooms(roomDir: string | undefined): OnlineRoom[] {
  if (!roomDir || !existsSync(roomDir)) return [];
  return readdirSync(roomDir)
    .filter((filename) => filename.endsWith('.json'))
    .flatMap((filename) => {
      try {
        const room = JSON.parse(readFileSync(`${roomDir}/${filename}`, 'utf8')) as Partial<OnlineRoom>;
        return typeof room.id === 'string' && room.players && typeof room.players === 'object'
          ? [room as OnlineRoom]
          : [];
      } catch {
        return [];
      }
    });
}

function connectedPlayerCount(room: OnlineRoom) {
  return Object.values(room.players).filter((player) => player.connected).length;
}

export function roomView(room: OnlineRoom): OnlineRoomView {
  return {
    id: room.id,
    revision: room.revision,
    hostPlayerId: room.hostPlayerId,
    phase: room.phase,
    players: Object.values(room.players),
    turnPlayerIds: room.turnPlayerIds,
    activePlayerId: room.activePlayerId,
    completedTurnPlayerIds: room.completedTurnPlayerIds,
    tenDayReadyForceIds: room.tenDayReadyForceIds,
  };
}

export function snapshotFor(room: OnlineRoom, playerId: string): OnlineSnapshot {
  return {
    playerId,
    room: roomView(room),
    state: playerState(room, playerId),
  };
}

export class RoomManager {
  private readonly rooms = new Map<string, OnlineRoom>();

  private readonly playerRooms = new Map<string, string>();

  private readonly lobbyDisconnectTimes = new Map<string, number>();

  private readonly db: GameDatabase | null;

  constructor(options: { db?: GameDatabase; legacyRoomDir?: string } = {}) {
    this.db = options.db ?? null;
    const loadedRooms = new Map<string, OnlineRoom>();
    for (const room of this.db?.loadRooms() ?? []) {
      if (room.phase === 'lobby') {
        this.deleteRoom(room.id);
        continue;
      }
      loadedRooms.set(room.id, room);
    }
    for (const room of loadLegacyRooms(options.legacyRoomDir)) {
      if (room.phase === 'lobby') continue;
      if (!loadedRooms.has(room.id)) {
        loadedRooms.set(room.id, room);
        this.saveRoom(room);
      }
    }
    for (const room of loadedRooms.values()) {
      const offlineRoom = {
        ...room,
        players: Object.fromEntries(Object.entries(room.players).map(([playerId, player]) => [
          playerId,
          { ...player, connected: false },
        ])),
      };
      this.rooms.set(offlineRoom.id, offlineRoom);
      for (const playerId of Object.keys(offlineRoom.players)) this.playerRooms.set(playerId, offlineRoom.id);
    }
  }

  private saveRoom(room: OnlineRoom) {
    this.db?.saveRoom(room);
  }

  private deleteRoom(roomId: string) {
    this.db?.deleteRoom(roomId);
  }

  private removePlayerFromRoom(room: OnlineRoom, playerId: string) {
    if (playerId === room.hostPlayerId || Object.keys(room.players).length <= 1) {
      for (const memberId of Object.keys(room.players)) this.playerRooms.delete(memberId);
      this.rooms.delete(room.id);
      this.deleteRoom(room.id);
      return { room, removed: true };
    }

    const leavingForceId = room.players[playerId]?.forceId ?? null;
    const players = { ...room.players };
    delete players[playerId];
    const turnPlayerIds = room.turnPlayerIds.filter((candidateId) => candidateId !== playerId);
    let completedTurnPlayerIds = room.completedTurnPlayerIds.filter((candidateId) => candidateId !== playerId);
    let activePlayerId = room.activePlayerId;
    if (!activePlayerId || activePlayerId === playerId || !turnPlayerIds.includes(activePlayerId)) {
      activePlayerId = turnPlayerIds.find((candidateId) => !completedTurnPlayerIds.includes(candidateId)) ?? turnPlayerIds[0] ?? null;
      if (activePlayerId && completedTurnPlayerIds.includes(activePlayerId)) completedTurnPlayerIds = [];
    }

    const next = {
      ...room,
      revision: room.revision + 1,
      players,
      playerOrder: room.playerOrder.filter((candidateId) => candidateId !== playerId),
      turnPlayerIds,
      activePlayerId,
      completedTurnPlayerIds,
      tenDayReadyForceIds: leavingForceId
        ? room.tenDayReadyForceIds.filter((forceId) => forceId !== leavingForceId)
        : room.tenDayReadyForceIds,
    };
    this.playerRooms.delete(playerId);
    this.rooms.set(next.id, next);
    this.saveRoom(next);
    return { room: next, removed: false };
  }

  private leaveAnyCurrentRoom(playerId: string) {
    const currentRoomId = this.playerRooms.get(playerId);
    if (!currentRoomId) return;
    const currentRoom = this.rooms.get(currentRoomId);
    if (currentRoom?.players[playerId]) this.removePlayerFromRoom(currentRoom, playerId);
  }

  createRoom(input: { playerId: string; playerName: string; seed?: number }) {
    this.pruneExpiredLobbyDisconnects();
    this.leaveAnyCurrentRoom(input.playerId);
    const roomId = createRoomCode(new Set(this.rooms.keys()));
    const room = createOnlineRoom({
      roomId,
      hostPlayerId: input.playerId,
      hostName: input.playerName,
      seed: input.seed,
    });
    this.rooms.set(room.id, room);
    this.playerRooms.set(input.playerId, room.id);
    this.saveRoom(room);
    return snapshotFor(room, input.playerId);
  }

  joinRoom(input: { roomId: string; playerId: string; playerName: string }) {
    this.pruneExpiredLobbyDisconnects();
    const current = this.rooms.get(input.roomId.toUpperCase());
    if (!current) throw new Error('房间不存在');
    this.leaveAnyCurrentRoom(input.playerId);
    const room = joinOnlineRoom(current, { playerId: input.playerId, playerName: input.playerName });
    this.rooms.set(room.id, room);
    this.playerRooms.set(input.playerId, room.id);
    this.lobbyDisconnectTimes.delete(`${room.id}:${input.playerId}`);
    this.saveRoom(room);
    return snapshotFor(room, input.playerId);
  }

  selectForce(input: { roomId: string; playerId: string; forceId: ForceId }) {
    const current = this.rooms.get(input.roomId.toUpperCase());
    if (!current) throw new Error('房间不存在');
    const room = selectPlayerForce(current, { playerId: input.playerId, forceId: input.forceId });
    this.rooms.set(room.id, room);
    this.saveRoom(room);
    return snapshotFor(room, input.playerId);
  }

  startRoom(input: { roomId: string; playerId: string }) {
    const current = this.rooms.get(input.roomId.toUpperCase());
    if (!current) throw new Error('房间不存在');
    const room = startOnlineRoom(current, { playerId: input.playerId });
    this.rooms.set(room.id, room);
    this.saveRoom(room);
    return snapshotFor(room, input.playerId);
  }

  listLobbyRooms(): OnlineRoomListItem[] {
    this.pruneExpiredLobbyDisconnects();
    return [...this.rooms.values()]
      .filter((room) => room.phase === 'lobby' && connectedPlayerCount(room) > 0)
      .map((room) => ({
        id: room.id,
        hostName: room.players[room.hostPlayerId]?.name ?? '房主',
        playerCount: Object.keys(room.players).length,
        maxPlayers: ONLINE_DUEL_MAX_PLAYERS,
        selectedForceIds: [...new Set(Object.values(room.players).flatMap((player) => (
          player.forceId ? [player.forceId] : []
        )))],
      }));
  }

  roomForPlayer(playerId: string) {
    const roomId = this.playerRooms.get(playerId);
    return roomId ? this.rooms.get(roomId) ?? null : null;
  }

  resumeRoom(input: { playerId: string; roomId?: string }) {
    this.pruneExpiredLobbyDisconnects();
    const room = input.roomId
      ? this.rooms.get(input.roomId.toUpperCase()) ?? null
      : this.roomForPlayer(input.playerId);
    if (!room) throw new Error('房间不存在');
    if (!room.players[input.playerId]) throw new Error('玩家不在房间中');
    const next = setPlayerConnected(room, input.playerId, true);
    this.rooms.set(next.id, next);
    this.playerRooms.set(input.playerId, next.id);
    this.lobbyDisconnectTimes.delete(`${next.id}:${input.playerId}`);
    this.saveRoom(next);
    return snapshotFor(next, input.playerId);
  }

  disconnectPlayer(playerId: string) {
    const room = this.roomForPlayer(playerId);
    if (!room) return null;

    if (room.phase === 'lobby') {
      const next = setPlayerConnected(room, playerId, false);
      this.lobbyDisconnectTimes.set(`${room.id}:${playerId}`, Date.now());
      this.rooms.set(next.id, next);
      this.saveRoom(next);
      return { room: next, removed: false };
    }

    const next = setPlayerConnected(room, playerId, false);
    this.rooms.set(next.id, next);
    this.saveRoom(next);
    return { room: next, removed: false };
  }

  pruneExpiredLobbyDisconnects() {
    const now = Date.now();
    const expiredByRoom = new Map<string, string[]>();
    for (const [key, disconnectedAt] of this.lobbyDisconnectTimes) {
      if (now - disconnectedAt < LOBBY_DISCONNECT_GRACE_MS) continue;
      const separatorIndex = key.lastIndexOf(':');
      const roomId = key.slice(0, separatorIndex);
      const playerId = key.slice(separatorIndex + 1);
      const expired = expiredByRoom.get(roomId) ?? [];
      expired.push(playerId);
      expiredByRoom.set(roomId, expired);
    }

    for (const [roomId, playerIds] of expiredByRoom) {
      const room = this.rooms.get(roomId);
      if (!room) continue;
      for (const playerId of playerIds) {
        this.lobbyDisconnectTimes.delete(`${roomId}:${playerId}`);
        if (room.players[playerId]) this.removePlayerFromRoom(room, playerId);
      }
    }

    return [...expiredByRoom.keys()];
  }

  leavePlayer(playerId: string, roomId?: string) {
    const targetRoomId = roomId?.toUpperCase() ?? this.playerRooms.get(playerId);
    if (!targetRoomId) return null;
    const room = this.rooms.get(targetRoomId);
    if (!room || !room.players[playerId]) {
      this.playerRooms.delete(playerId);
      return null;
    }
    return this.removePlayerFromRoom(room, playerId);
  }

  markConnected(playerId: string, connected: boolean) {
    const room = this.roomForPlayer(playerId);
    if (!room) return null;
    const next = setPlayerConnected(room, playerId, connected);
    this.rooms.set(next.id, next);
    this.saveRoom(next);
    return next;
  }

  pruneRoomsUpdatedBefore(cutoffIso: string) {
    const connectedRoomIds = [...this.rooms.values()]
      .filter((room) => Object.values(room.players).some((player) => player.connected))
      .map((room) => room.id);
    const deletedIds = this.db?.deleteRoomsUpdatedBefore(cutoffIso, connectedRoomIds) ?? [];

    for (const roomId of deletedIds) {
      const room = this.rooms.get(roomId);
      if (!room) continue;
      for (const playerId of Object.keys(room.players)) this.playerRooms.delete(playerId);
      this.rooms.delete(roomId);
    }

    return deletedIds;
  }

  applyIntent(payload: AuthenticatedGameIntentPayload) {
    const room = this.rooms.get(payload.roomId);
    if (!room) throw new Error('房间不存在');
    const result = reduceOnlineIntent(room, payload.playerId, payload.baseRevision, payload.intent);
    if (result.ok) {
      this.rooms.set(result.room.id, result.room);
      this.saveRoom(result.room);
    }
    return result;
  }

  bindSocket(socket: Socket, snapshot: OnlineSnapshot) {
    socket.data.playerId = snapshot.playerId;
    socket.join(snapshot.room.id);
  }
}
