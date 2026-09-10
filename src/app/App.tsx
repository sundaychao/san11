import { useState } from 'react';
import { ErrorBoundary } from '../components/ErrorBoundary';
import { AuthScreen } from '../components/AuthScreen';
import { GameShell } from '../components/GameShell';
import { RoomLobbyScreen } from '../components/RoomLobbyScreen';
import { HomeScreen } from '../components/HomeScreen';
import { MapListScreen } from '../components/MapListScreen';
import { MapEditorScreen } from '../components/MapEditorScreen';
import { ForceSelectScreen } from '../components/ForceSelectScreen';
import { OnlineScreen } from '../components/OnlineScreen';
import { AudioEventProvider } from '../audio/reactAudioEventAdapter';
import { GameProvider, useGame } from '../game/store/GameProvider';

/** 首页多屏状态机：home → 地图列表 → 地图编辑 / 势力选择 / 联网对战 */
type AppScreen =
  | { name: 'home' }
  | { name: 'mapList'; mode: 'edit' | 'start' }
  | { name: 'mapEditor'; mapId: string }
  | { name: 'forceSelect'; mapId: string }
  | { name: 'online' };

function AppContent() {
  const { auth, online, state } = useGame();
  const [screen, setScreen] = useState<AppScreen>({ name: 'home' });

  // 状态优先：游戏中或已进入联机房间时，直接进入对应界面，掩盖主菜单导航状态
  if (!auth.username) return <AuthScreen />;
  if (state) return <GameShell />;
  if (online.roomId && online.phase === 'lobby') return <RoomLobbyScreen />;

  switch (screen.name) {
    case 'mapList':
      return (
        <MapListScreen
          mode={screen.mode}
          onSelect={(mapId) => {
            if (screen.mode === 'edit') setScreen({ name: 'mapEditor', mapId });
            else setScreen({ name: 'forceSelect', mapId });
          }}
          onCreateNew={screen.mode === 'edit' ? () => setScreen({ name: 'mapEditor', mapId: 'new' }) : undefined}
          onBack={() => setScreen({ name: 'home' })}
        />
      );
    case 'mapEditor':
      return (
        <MapEditorScreen
          mapId={screen.mapId}
          onSave={() => setScreen({ name: 'mapList', mode: 'edit' })}
          onBack={() => setScreen({ name: 'mapList', mode: 'edit' })}
        />
      );
    case 'forceSelect':
      return (
        <ForceSelectScreen
          mapId={screen.mapId}
          onBack={() => setScreen({ name: 'mapList', mode: 'start' })}
        />
      );
    case 'online':
      return <OnlineScreen onBack={() => setScreen({ name: 'home' })} />;
    case 'home':
    default:
      return (
        <HomeScreen
          onEditMap={() => setScreen({ name: 'mapList', mode: 'edit' })}
          onOnline={() => setScreen({ name: 'online' })}
          onStartNew={() => setScreen({ name: 'mapList', mode: 'start' })}
        />
      );
  }
}

export function App() {
  return (
    <ErrorBoundary>
      <AudioEventProvider>
        <GameProvider>
          <AppContent />
        </GameProvider>
      </AudioEventProvider>
    </ErrorBoundary>
  );
}