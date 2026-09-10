import { LogOut, Play } from 'lucide-react';
import { getMap } from '../game/mapRegistry';
import { forcesOfMap } from '../game/scenario/customMap';
import { FORCE_IDS, SCENARIO_FORCES } from '../game/scenario/jingxiang208';
import { useGame } from '../game/store/GameProvider';
import type { ForceId } from '../game/types';

function forceName(forceId: ForceId | null) {
  return forceId ? SCENARIO_FORCES[forceId].name : '未选择';
}

/** 房间可选地图对应的可选用势力：未指定或注册表缺失的地图回退内置 4 势力，注册表地图按其有主城池的势力列 */
function availableForcesForMap(map: string | undefined): ForceId[] {
  if (!map || map === 'small' || map === 'homeland') return [...FORCE_IDS];
  const sessionMap = getMap(map);
  return sessionMap ? forcesOfMap(sessionMap.payload) : [...FORCE_IDS];
}

export function RoomLobbyScreen() {
  const { disconnectOnline, online, selectOnlineForce, startOnlineGame } = useGame();
  const roomId = online.roomId ?? '----';
  const self = online.players.find((player) => player.id === online.playerId);
  const isHost = online.playerId === online.hostPlayerId;
  const occupiedForceIds = new Set(online.players.flatMap((player) => player.forceId ? [player.forceId] : []));
  const isHomeland = online.map === 'homeland';
  const availableForces = availableForcesForMap(online.map);
  const minPlayers = online.map === 'small' ? 2 : 1;
  const readyToStart = online.players.length >= minPlayers && online.players.every((player) => player.forceId);
  const mapLabel = online.map === 'small'
    ? '小地图（荆襄双人对战）'
    : online.map === 'homeland'
      ? '大地图（最多4人，不足电脑补位）'
      : getMap(online.map)?.name ?? online.map;

  const chooseForce = async (forceId: ForceId) => {
    try {
      await selectOnlineForce(forceId);
    } catch {
      // GameProvider exposes the server error through online.error.
    }
  };

  const start = async () => {
    try {
      await startOnlineGame();
    } catch {
      // GameProvider exposes the server error through online.error.
    }
  };

  return (
    <main className="room-lobby-screen">
      <section className="room-lobby-card tool-panel" aria-labelledby="room-lobby-title">
        <header>
          <div>
            <p>联网对战 · {mapLabel}</p>
            <h1 id="room-lobby-title">房间 {roomId}</h1>
          </div>
          <button type="button" onClick={disconnectOnline} aria-label="离开房间">
            <LogOut aria-hidden="true" />
          </button>
        </header>

        <section className="room-lobby-members" aria-label="玩家">
          <h2>玩家</h2>
          <ul>
            {online.players.map((player) => (
              <li key={player.id} className={player.id === online.playerId ? 'is-self' : undefined}>
                <span className={player.connected ? 'is-online' : 'is-offline'} />
                <strong>{player.name}</strong>
                <small>{player.id === online.hostPlayerId ? '房主' : '玩家'}</small>
                <em>{forceName(player.forceId)}</em>
              </li>
            ))}
          </ul>
        </section>

        <section className="room-lobby-forces" aria-label="选择势力">
          <h2>选择势力</h2>
          <div>
            {availableForces.map((forceId) => {
              const force = SCENARIO_FORCES[forceId];
              const selectedBySelf = self?.forceId === forceId;
              const occupied = occupiedForceIds.has(forceId);
              return (
                <button
                  key={forceId}
                  type="button"
                  disabled={occupied}
                  className={selectedBySelf ? 'is-selected' : undefined}
                  onClick={() => void chooseForce(forceId)}
                  aria-label={selectedBySelf ? `${force.name} 已选择` : force.name}
                >
                  <span className="force-swatch" style={{ backgroundColor: force.color }} aria-hidden="true" />
                  <strong>{force.name}</strong>
                  <small>{selectedBySelf ? '已选择' : occupied ? '已占用' : '可选择'}</small>
                </button>
              );
            })}
          </div>
        </section>

        <footer>
          <p>{readyToStart ? (isHomeland ? `已就绪，可以开始（${online.players.length} 人）` : '双方已选择势力') : '等待玩家进入并选择势力'}</p>
          {isHost ? (
            <button type="button" onClick={() => void start()} disabled={!readyToStart || online.connecting}>
              <Play aria-hidden="true" />
              开始游戏
            </button>
          ) : (
            <span>等待房主开始</span>
          )}
        </footer>
        {online.error && <p className="auth-error" role="alert">{online.error}</p>}
      </section>
    </main>
  );
}
