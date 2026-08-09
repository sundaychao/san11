import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { OnlineRoom } from '../src/game/network/session';

const ROOM_DATA_DIR = path.resolve(process.cwd(), 'server/data/rooms');

function safeRoomId(roomId: string) {
  return roomId.replace(/[^A-Z0-9-]/gi, '').slice(0, 16) || 'room';
}

export async function saveRoomSnapshot(room: OnlineRoom) {
  await mkdir(ROOM_DATA_DIR, { recursive: true });
  const filename = path.join(ROOM_DATA_DIR, `${safeRoomId(room.id)}.json`);
  await writeFile(filename, JSON.stringify(room, null, 2), 'utf8');
}
