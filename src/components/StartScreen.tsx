import { useEffect, useState } from 'react';
import { Play, ScrollText } from 'lucide-react';
import { FORCE_IDS, SCENARIO_FORCES } from '../game/scenario/jingxiang208';
import { useGame } from '../game/store/GameProvider';

export function StartScreen() {
  const { auth, createOnlineRoom, hasAutosave, hasManualSave, invalidSaves, joinOnlineRoom, loadGame, loadOnlineRooms, logoutAccount, online, startGame, clearSave, error, clearError } = useGame();
  const [roomId, setRoomId] = useState('');
  const [serverUrl, setServerUrl] = useState(online.serverUrl);
  const [hasRequestedRooms, setHasRequestedRooms] = useState(false);

  useEffect(() => {
    if (!auth.token || hasRequestedRooms) return;
    setHasRequestedRooms(true);
    void loadOnlineRooms({ serverUrl }).catch(() => {
      // GameProvider exposes the server error through online.error.
    });
  }, [auth.token, hasRequestedRooms, loadOnlineRooms, serverUrl]);

  const createRoom = async () => {
    try {
      await createOnlineRoom({ serverUrl });
    } catch {
      // GameProvider exposes the server error through online.error.
    }
  };

  const joinRoom = async () => {
    try {
      await joinOnlineRoom({ roomId, serverUrl });
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

  const joinListedRoom = async (listedRoomId: string) => {
    try {
      await joinOnlineRoom({ roomId: listedRoomId, serverUrl });
    } catch {
      // GameProvider exposes the server error through online.error.
    }
  };

  return (
    <main className="start-screen">
      <section className="start-title" aria-labelledby="game-title">
        <p>公元 208 年</p>
        <h1 id="game-title">建安十三年：荆襄争夺</h1>
        {auth.username && (
          <div className="start-account tool-panel">
            <span>当前账号：{auth.username}</span>
            <button type="button" onClick={logoutAccount}>退出登录</button>
          </div>
        )}
      </section>

      <section className="force-selection" aria-label="选择势力">
        {FORCE_IDS.map((forceId) => {
          const force = SCENARIO_FORCES[forceId];
          return (
            <button
              className="force-choice"
              key={forceId}
              type="button"
              onClick={() => startGame(forceId)}
              aria-label={`选择${force.name}`}
            >
              <span className="force-swatch" style={{ backgroundColor: force.color }} aria-hidden="true" />
              <span className="force-copy">
                <strong>{force.name}</strong>
                <small>{force.description}</small>
              </span>
              <Play aria-hidden="true" />
            </button>
          );
        })}
      </section>

      <section className="online-entry tool-panel" aria-label="联网对战">
        <header>
          <h2>联网对战</h2>
          <p>{online.connecting ? '连接中' : online.roomId ? `房间 ${online.roomId}` : 'Socket.IO'}</p>
        </header>
        <div className="online-fields">
          <label>
            <span>服务器</span>
            <input value={serverUrl} onChange={(event) => setServerUrl(event.target.value)} placeholder="http://localhost:8787" />
          </label>
        </div>
        <button className="online-create-primary" type="button" onClick={() => void createRoom()} disabled={online.connecting}>创建新房间</button>
        <div className="online-room-toolbar">
          <span>等待房间</span>
          <button type="button" onClick={() => void refreshRooms()} disabled={online.connecting}>刷新房间</button>
        </div>
        <div className="online-room-list" aria-label="房间列表">
          {online.rooms.length > 0 ? online.rooms.map((room) => (
            <button key={room.id} type="button" onClick={() => void joinListedRoom(room.id)} aria-label={`进入 ${room.id}`}>
              <strong>{room.id}</strong>
              <span>{room.hostName}</span>
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
          <button type="button" onClick={() => void joinRoom()} disabled={online.connecting}>加入房间</button>
        </div>
        {online.error && <button className="start-error" type="button" onClick={clearError}>{online.error}</button>}
      </section>

      {(hasAutosave || hasManualSave) && (
        <div className="save-actions">
          {hasAutosave && <button type="button" onClick={() => loadGame('auto')}><Play aria-hidden="true" />继续游戏</button>}
          {hasManualSave && <button type="button" onClick={() => loadGame('manual')}><ScrollText aria-hidden="true" />读取手动存档</button>}
        </div>
      )}
      {invalidSaves.length > 0 && (
        <div className="invalid-save" role="alert">
          {invalidSaves.map(({ slot, reason }) => (
            <div key={slot}>
              <span>{slot === 'auto' ? '自动存档' : '手动存档'}：{reason}</span>
              <button type="button" onClick={() => clearSave(slot)}>清除损坏的{slot === 'auto' ? '自动' : '手动'}存档</button>
            </div>
          ))}
        </div>
      )}
      {error && <button className="start-error" type="button" onClick={clearError}>{error}</button>}
    </main>
  );
}
