import { ErrorBoundary } from '../components/ErrorBoundary';
import { AuthScreen } from '../components/AuthScreen';
import { GameShell } from '../components/GameShell';
import { RoomLobbyScreen } from '../components/RoomLobbyScreen';
import { StartScreen } from '../components/StartScreen';
import { GameProvider, useGame } from '../game/store/GameProvider';

function AppContent() {
  const { auth, online, state } = useGame();
  if (!state && !auth.username) return <AuthScreen />;
  if (!state && online.roomId && online.phase === 'lobby') return <RoomLobbyScreen />;
  return state ? <GameShell /> : <StartScreen />;
}

export function App() {
  return (
    <ErrorBoundary>
      <GameProvider>
        <AppContent />
      </GameProvider>
    </ErrorBoundary>
  );
}
