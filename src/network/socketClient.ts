import { io, type Socket } from 'socket.io-client';
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
  ResumeRoomPayload,
  RoomListAck,
  RoomListUpdate,
  SelectForcePayload,
  StartRoomPayload,
} from '../game/network/protocol';

export const DEFAULT_ONLINE_SERVER_URL = import.meta.env.VITE_ONLINE_SERVER_URL ?? 'http://localhost:8787';

export type OnlineSocket = Socket<{
  'room:list:update': (update: RoomListUpdate) => void;
  'room:update': (snapshot: OnlineSnapshot) => void;
}, {
  'room:create': (payload: CreateRoomPayload, ack: (response: OnlineAck) => void) => void;
  'room:list': (payload: AuthSessionPayload, ack: (response: RoomListAck) => void) => void;
  'room:join': (payload: JoinRoomPayload, ack: (response: OnlineAck) => void) => void;
  'room:resume': (payload: ResumeRoomPayload, ack: (response: OnlineAck) => void) => void;
  'room:selectForce': (payload: SelectForcePayload, ack: (response: OnlineAck) => void) => void;
  'room:startGame': (payload: StartRoomPayload, ack: (response: OnlineAck) => void) => void;
  'game:intent': (payload: GameIntentPayload, ack: (response: IntentAck) => void) => void;
  'auth:register': (payload: AuthPayload, ack: (response: AuthAck) => void) => void;
  'auth:login': (payload: AuthPayload, ack: (response: AuthAck) => void) => void;
  'auth:session': (payload: AuthSessionPayload, ack: (response: AuthAck) => void) => void;
  'auth:logout': (payload: AuthSessionPayload, ack: (response: { ok: true }) => void) => void;
}>;

export function createOnlineSocket(serverUrl = DEFAULT_ONLINE_SERVER_URL): OnlineSocket {
  return io(serverUrl, {
    autoConnect: false,
    transports: ['websocket', 'polling'],
  });
}
