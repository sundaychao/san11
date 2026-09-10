import { useEffect, useState } from 'react';
import { ArrowLeft } from 'lucide-react';
import { getMap, listMaps, loadRuntimeMaps, BUILTIN_MAP_CHINA42_ID, type SessionMap } from '../game/mapRegistry';
import type { RoomMap } from '../game/network/session';
import { useGame } from '../game/store/GameProvider';

/** 房间地图标签：识别内置荆襄图与自定义图名 */
function mapLabel(map: RoomMap | undefined): string {
  if (!map || map === 'homeland') return '大地图';
  if (map === 'small') return '小地图';
  return getMap(map)?.name ?? map;
}

interface OnlineScreenProps {
  onBack(): void;
}

/**
 * 联网对战独立页：复用当前联机模块（房间创建/加入/续战），
 * 但地图从「当前所有可用地图」中选择，不再写死小地图/大地图。
 */
export function OnlineScreen({ onBack }: OnlineScreenProps) {
  const { auth, createOnlineRoom, joinOnlineRoom, loadOnlineRooms, online, resumeOnlineRoom, clearError } = useGame();
  const [maps, setMaps] = useState<SessionMap[]>(() => listMaps());
  const [roomId, setRoomId] = useState('');
  const [selectedMap, setSelectedMap] = useState<string>(() => (
    maps.some((map) => map.id === BUILTIN_MAP_CHINA42_ID) ? BUILTIN_MAP_CHINA42_ID : (maps[0]?.id ?? '')
  ));
  const [serverUrl, setServerUrl] = useState(online.serverUrl);
  const [hasRequestedRooms, setHasRequestedRooms] = useState(false);
  const onlineBusy = online.connecting || online.resumingRoom;

  // 热拔插：异步拉取 public/maps 下的运行时地图，完成后刷新列表
  useEffect(() => {
    let active = true;
    void loadRuntimeMaps().then(() => { if (active) { setMaps(listMaps()); } });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!auth.token || hasRequestedRooms || online.resumingRoom || online.roomId) return;
    setHasRequestedRooms(true);
    void loadOnlineRooms({ serverUrl }).catch(() => {
      // GameProvider exposes the server error through online.error.
    });
  }, [auth.token, hasRequestedRooms, loadOnlineRooms, online.resumingRoom, online.roomId, serverUrl]);

  const createRoom = async () => {
    try {
      // 带上选中地图的 payload：自定义/热插图服务端注册表没有，开局需要它才能生成场景
      const selected = getMap(selectedMap);
      await createOnlineRoom({
        serverUrl,
        map: selectedMap as RoomMap,
        mapPayload: selected?.payload,
      });
    } catch {
      // GameProvider exposes the server error through online.error.
    }
  };

  const refreshRooms = async () => {
    try {
      await loadOnlineRooms({ serverUrl });
    } catch {
      // GameProvider exposes the server error through online.error.
    }
  };

  return (
    <main className="online-screen" data-testid="online-screen">
      <header className="online-screen-header">
        <button type="button" className="secondary-button" onClick={onBack}>{'< 返回'}</button>
        <h1>联网对战</h1>
        <p>选择一张地图，与好友同图争夺天下。</p>
      </header>

      <div className="online-panels" aria-label="联网对战">
      <section className="online-entry tool-panel" aria-label="创建房间">
        <header>
          <h2>创建房间</h2>
          <p>{online.connecting ? '连接中' : online.roomId ? `房间 ${online.roomId}` : 'Socket.IO'}</p>
        </header>

        <div className="online-map-choice" aria-label="选择对战地图">
          <label className="online-map-label">对战地图</label>
          <div className="online-map-grid">
            {maps.map((map) => (
              <button
                key={map.id}
                type="button"
                role="radio"
                aria-checked={selectedMap === map.id}
                className={selectedMap === map.id ? 'is-selected' : undefined}
                onClick={() => setSelectedMap(map.id)}
              >
                <strong>{map.name}</strong>
                <small>{map.builtin ? '内置地图' : '自定义地图'} · {map.payload.width}×{map.payload.height}</small>
              </button>
            ))}
          </div>
        </div>

        <div className="online-fields">
          <label>
            <span>服务器</span>
            <input value={serverUrl} onChange={(event) => setServerUrl(event.target.value)} placeholder="http://localhost:8787" />
          </label>
        </div>

        <button className="online-create-primary" type="button" onClick={() => void createRoom()} disabled={selectedMap === ''}>
          创建新房间（{selectedMap ? mapLabel(selectedMap) : '未选地图'}）
        </button>
      </section>

      <section className="online-entry online-entry-join tool-panel" aria-label="加入房间">
        <header>
          <h2>等待房间</h2>
          <button type="button" onClick={() => void refreshRooms()} disabled={onlineBusy}>刷新房间</button>
        </header>
        <div className="online-room-list" aria-label="房间列表">
          {online.rooms.length > 0 ? online.rooms.map((room) => (
            <button key={room.id} type="button" onClick={() => void joinOnlineRoom({ roomId: room.id, serverUrl })} aria-label={`进入 ${room.id}`}>
              <strong>{room.id}</strong>
              <span>{room.hostName} · {mapLabel(room.map)}</span>
              <em>{room.playerCount}/{room.maxPlayers}</em>
            </button>
          )) : (
            <p>暂无等待中的房间</p>
          )}
        </div>

        <div className="online-fields online-manual-join">
          <label>
            <span>房间</span>
            <input value={roomId} onChange={(event) => setRoomId(event.target.value.toUpperCase())} placeholder="房间号" maxLength={8} />
          </label>
        </div>
        <div className="online-actions">
          <button type="button" onClick={() => void joinOnlineRoom({ roomId, serverUrl })} disabled={onlineBusy}>
            <ArrowLeft aria-hidden="true" />
            加入房间
          </button>
        </div>

        <button className="online-resume" type="button" onClick={() => void resumeOnlineRoom({ serverUrl })} disabled={onlineBusy}>继续上次对战</button>
      </section>
      </div>

      {online.error && <button className="start-error" type="button" onClick={clearError}>{online.error}</button>}
    </main>
  );
}