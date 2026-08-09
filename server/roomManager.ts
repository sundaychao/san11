import type { Socket } from 'socket.io';
import type { ForceId } from '../src/game/types';
import type { GameIntentPayload, OnlineRoomListItem, OnlineRoomView, OnlineSnapshot } from '../src/game/network/protocol';
import {
  createOnlineRoom,
  joinOnlineRoom,
  playerState,
  reduceOnlineIntent,
  selectPlayerForce,
  setPlayerConnected,
  startOnlineRoom,
  type OnlineRoom,
} from '../src/game/network/session';
import { saveRoomSnapshot } from './storage';

type AuthenticatedGameIntentPayload = GameIntentPayload & { playerId: string };

const ROOM_CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

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

  createRoom(input: { playerId: string; playerName: string; seed?: number }) {
    const roomId = createRoomCode(new Set(this.rooms.keys()));
    const room = createOnlineRoom({
      roomId,
      hostPlayerId: input.playerId,
      hostName: input.playerName,
      seed: input.seed,
    });
    this.rooms.set(room.id, room);
    this.playerRooms.set(input.playerId, room.id);
    void saveRoomSnapshot(room);
    return snapshotFor(room, input.playerId);
  }

  joinRoom(input: { roomId: string; playerId: string; playerName: string }) {
    const current = this.rooms.get(input.roomId.toUpperCase());
    if (!current) throw new Error('房间不存在');
    const room = joinOnlineRoom(current, { playerId: input.playerId, playerName: input.playerName });
    this.rooms.set(room.id, room);
    this.playerRooms.set(input.playerId, room.id);
    void saveRoomSnapshot(room);
    return snapshotFor(room, input.playerId);
  }

  selectForce(input: { roomId: string; playerId: string; forceId: ForceId }) {
    const current = this.rooms.get(input.roomId.toUpperCase());
    if (!current) throw new Error('房间不存在');
    const room = selectPlayerForce(current, { playerId: input.playerId, forceId: input.forceId });
    this.rooms.set(room.id, room);
    void saveRoomSnapshot(room);
    return snapshotFor(room, input.playerId);
  }

  startRoom(input: { roomId: string; playerId: string }) {
    const current = this.rooms.get(input.roomId.toUpperCase());
    if (!current) throw new Error('房间不存在');
    const room = startOnlineRoom(current, { playerId: input.playerId });
    this.rooms.set(room.id, room);
    void saveRoomSnapshot(room);
    return snapshotFor(room, input.playerId);
  }

  listLobbyRooms(): OnlineRoomListItem[] {
    return [...this.rooms.values()]
      .filter((room) => room.phase === 'lobby')
      .map((room) => ({
        id: room.id,
        hostName: room.players[room.hostPlayerId]?.name ?? '房主',
        playerCount: Object.keys(room.players).length,
        maxPlayers: 4,
        selectedForceIds: [...new Set(Object.values(room.players).flatMap((player) => (
          player.forceId ? [player.forceId] : []
        )))],
      }));
  }

  roomForPlayer(playerId: string) {
    const roomId = this.playerRooms.get(playerId);
    return roomId ? this.rooms.get(roomId) ?? null : null;
  }

  disconnectPlayer(playerId: string) {
    const room = this.roomForPlayer(playerId);
    if (!room) return null;

    if (room.phase === 'lobby') {
      if (playerId === room.hostPlayerId || Object.keys(room.players).length <= 1) {
        for (const memberId of Object.keys(room.players)) this.playerRooms.delete(memberId);
        this.rooms.delete(room.id);
        return { room, removed: true };
      }

      const players = { ...room.players };
      delete players[playerId];
      const next = {
        ...room,
        revision: room.revision + 1,
        players,
        playerOrder: room.playerOrder.filter((candidateId) => candidateId !== playerId),
      };
      this.playerRooms.delete(playerId);
      this.rooms.set(next.id, next);
      void saveRoomSnapshot(next);
      return { room: next, removed: false };
    }

    const next = setPlayerConnected(room, playerId, false);
    this.rooms.set(next.id, next);
    void saveRoomSnapshot(next);
    return { room: next, removed: false };
  }

  markConnected(playerId: string, connected: boolean) {
    const room = this.roomForPlayer(playerId);
    if (!room) return null;
    const next = setPlayerConnected(room, playerId, connected);
    this.rooms.set(next.id, next);
    void saveRoomSnapshot(next);
    return next;
  }

  applyIntent(payload: AuthenticatedGameIntentPayload) {
    const room = this.rooms.get(payload.roomId);
    if (!room) throw new Error('房间不存在');
    const result = reduceOnlineIntent(room, payload.playerId, payload.baseRevision, payload.intent);
    if (result.ok) {
      this.rooms.set(result.room.id, result.room);
      void saveRoomSnapshot(result.room);
    }
    return result;
  }

  bindSocket(socket: Socket, snapshot: OnlineSnapshot) {
    socket.data.playerId = snapshot.playerId;
    socket.join(snapshot.room.id);
  }
}
