import http from 'node:http';
import { Server } from 'socket.io';
import { FORCE_IDS } from '../src/game/scenario/jingxiang208';
import type {
  AuthAck,
  AuthPayload,
  AuthSessionPayload,
  CreateRoomPayload,
  GameIntentPayload,
  IntentAck,
  JoinRoomPayload,
  OnlineAck,
  OnlineSnapshot,
  RoomListAck,
  SelectForcePayload,
  StartRoomPayload,
} from '../src/game/network/protocol';
import type { ForceId } from '../src/game/types';
import { AuthManager } from './auth';
import { RoomManager, snapshotFor } from './roomManager';

const port = Number(process.env.PORT ?? 8787);
const corsOrigin = process.env.CORS_ORIGIN ?? 'http://localhost:5173';
const manager = new RoomManager();
const auth = new AuthManager();
const httpServer = http.createServer();
const LOBBY_ROOM = 'online-lobby';
const io = new Server(httpServer, {
  cors: { origin: corsOrigin },
  transports: ['websocket', 'polling'],
  pingInterval: 25_000,
  pingTimeout: 20_000,
});

function isForceId(value: unknown): value is ForceId {
  return FORCE_IDS.includes(value as ForceId);
}

function requireForceId(value: unknown) {
  if (!isForceId(value)) throw new Error('势力无效');
  return value;
}

function emitRoomUpdate(roomId: string) {
  const sockets = io.sockets.adapter.rooms.get(roomId);
  if (!sockets) return;
  for (const socketId of sockets) {
    const socket = io.sockets.sockets.get(socketId);
    const playerId = socket?.data.playerId as string | undefined;
    const room = playerId ? manager.roomForPlayer(playerId) : null;
    if (!socket || !playerId || !room) continue;
    socket.emit('room:update', snapshotFor(room, playerId));
  }
}

function emitLobbyRoomList() {
  io.to(LOBBY_ROOM).emit('room:list:update', { rooms: manager.listLobbyRooms() });
}

function ackError(reason: unknown): OnlineAck {
  return { ok: false, reason: reason instanceof Error ? reason.message : '联网请求失败' };
}

function authAckError(reason: unknown): AuthAck {
  return { ok: false, reason: reason instanceof Error ? reason.message : '账号请求失败' };
}

async function requireSession(token: string | undefined) {
  const session = await auth.authenticate(token);
  if (!session) throw new Error('请先登录');
  return session;
}

io.on('connection', (socket) => {
  socket.on('auth:register', async (payload: AuthPayload, ack: (response: AuthAck) => void) => {
    try {
      const session = await auth.register(payload);
      socket.data.authToken = session.token;
      ack({ ok: true, session });
    } catch (error) {
      ack(authAckError(error));
    }
  });

  socket.on('auth:login', async (payload: AuthPayload, ack: (response: AuthAck) => void) => {
    try {
      const session = await auth.login(payload);
      socket.data.authToken = session.token;
      ack({ ok: true, session });
    } catch (error) {
      ack(authAckError(error));
    }
  });

  socket.on('auth:session', async (payload: AuthSessionPayload, ack: (response: AuthAck) => void) => {
    try {
      const session = await requireSession(payload.token);
      socket.data.authToken = session.token;
      ack({ ok: true, session });
    } catch (error) {
      ack(authAckError(error));
    }
  });

  socket.on('auth:logout', (payload: AuthSessionPayload, ack: (response: { ok: true }) => void) => {
    auth.logout(payload.token);
    socket.data.authToken = undefined;
    ack({ ok: true });
  });

  socket.on('room:create', async (payload: CreateRoomPayload, ack: (response: OnlineAck) => void) => {
    try {
      const session = await requireSession(payload.token);
      const snapshot = manager.createRoom({
        playerId: session.userId,
        playerName: session.username,
        seed: payload.seed,
      });
      manager.bindSocket(socket, snapshot);
      ack({ ok: true, snapshot });
      emitRoomUpdate(snapshot.room.id);
      emitLobbyRoomList();
    } catch (error) {
      ack(ackError(error));
    }
  });

  socket.on('room:list', async (payload: AuthSessionPayload, ack: (response: RoomListAck) => void) => {
    try {
      await requireSession(payload.token);
      socket.join(LOBBY_ROOM);
      ack({ ok: true, rooms: manager.listLobbyRooms() });
    } catch (error) {
      ack({ ok: false, reason: error instanceof Error ? error.message : '房间列表获取失败' });
    }
  });

  socket.on('room:join', async (payload: JoinRoomPayload, ack: (response: OnlineAck) => void) => {
    try {
      const session = await requireSession(payload.token);
      const snapshot = manager.joinRoom({
        roomId: payload.roomId.trim().toUpperCase(),
        playerId: session.userId,
        playerName: session.username,
      });
      manager.bindSocket(socket, snapshot);
      ack({ ok: true, snapshot });
      emitRoomUpdate(snapshot.room.id);
      emitLobbyRoomList();
    } catch (error) {
      ack(ackError(error));
    }
  });

  socket.on('room:selectForce', async (payload: SelectForcePayload, ack: (response: OnlineAck) => void) => {
    try {
      const session = await requireSession(payload.token);
      const snapshot = manager.selectForce({
        roomId: payload.roomId.trim().toUpperCase(),
        playerId: session.userId,
        forceId: requireForceId(payload.forceId),
      });
      ack({ ok: true, snapshot });
      emitRoomUpdate(snapshot.room.id);
      emitLobbyRoomList();
    } catch (error) {
      ack(ackError(error));
    }
  });

  socket.on('room:startGame', async (payload: StartRoomPayload, ack: (response: OnlineAck) => void) => {
    try {
      const session = await requireSession(payload.token);
      const snapshot = manager.startRoom({
        roomId: payload.roomId.trim().toUpperCase(),
        playerId: session.userId,
      });
      ack({ ok: true, snapshot });
      emitRoomUpdate(snapshot.room.id);
      emitLobbyRoomList();
    } catch (error) {
      ack(ackError(error));
    }
  });

  socket.on('game:intent', (payload: GameIntentPayload, ack: (response: IntentAck) => void) => {
    void (async () => {
    try {
      const session = await requireSession(payload.token);
      const result = manager.applyIntent({ ...payload, playerId: session.userId });
      if (!result.ok) {
        const playerId = socket.data.playerId as string | undefined;
        const snapshot: OnlineSnapshot | undefined = playerId ? snapshotFor(result.room, playerId) : undefined;
        ack({ ok: false, reason: result.reason, snapshot });
        return;
      }
      ack({ ok: true });
      emitRoomUpdate(result.room.id);
    } catch (error) {
      ack({ ok: false, reason: error instanceof Error ? error.message : '联网操作失败' });
    }
    })();
  });

  socket.on('disconnect', () => {
    const playerId = socket.data.playerId as string | undefined;
    if (!playerId) return;
    const result = manager.disconnectPlayer(playerId);
    if (result) {
      if (!result.removed) emitRoomUpdate(result.room.id);
      emitLobbyRoomList();
    }
  });
});

httpServer.listen(port, () => {
  console.log(`Online battle server listening on http://localhost:${port}`);
});
