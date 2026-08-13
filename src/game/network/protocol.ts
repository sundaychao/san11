import type { ForceId, GameState } from '../types';
import type { GameIntent } from './intents';
import type { OnlinePlayer, OnlineRoomPhase } from './session';

export interface OnlineRoomView {
  id: string;
  revision: number;
  hostPlayerId: string;
  phase: OnlineRoomPhase;
  players: OnlinePlayer[];
  turnPlayerIds: string[];
  activePlayerId: string | null;
  completedTurnPlayerIds: string[];
  tenDayReadyForceIds: ForceId[];
}

export interface OnlineRoomListItem {
  id: string;
  hostName: string;
  playerCount: number;
  maxPlayers: number;
  selectedForceIds: ForceId[];
}

export interface OnlineSnapshot {
  playerId: string;
  room: OnlineRoomView;
  state: GameState | null;
}

export interface AuthSessionView {
  userId: string;
  username: string;
  token: string;
}

export interface AuthPayload {
  username: string;
  password: string;
}

export interface AuthSessionPayload {
  token: string;
}

export interface CreateRoomPayload {
  token: string;
  seed?: number;
}

export interface JoinRoomPayload {
  token: string;
  roomId: string;
}

export interface ResumeRoomPayload {
  token: string;
  roomId?: string;
}

export interface SelectForcePayload {
  token: string;
  roomId: string;
  forceId: ForceId;
}

export interface StartRoomPayload {
  token: string;
  roomId: string;
}

export interface LeaveRoomPayload {
  token: string;
  roomId: string;
}

export interface GameIntentPayload {
  roomId: string;
  token: string;
  requestId: string;
  baseRevision: number;
  intent: GameIntent;
}

export type OnlineAck =
  | { ok: true; snapshot: OnlineSnapshot }
  | { ok: false; reason: string };

export type RoomListAck =
  | { ok: true; rooms: OnlineRoomListItem[] }
  | { ok: false; reason: string };

export type LeaveRoomAck =
  | { ok: true }
  | { ok: false; reason: string };

export interface RoomListUpdate {
  rooms: OnlineRoomListItem[];
}

export type AuthAck =
  | { ok: true; session: AuthSessionView }
  | { ok: false; reason: string };

export type IntentAck =
  | { ok: true; snapshot?: OnlineSnapshot }
  | { ok: false; reason: string; snapshot?: OnlineSnapshot };
