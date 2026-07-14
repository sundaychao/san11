import { ErrorBoundary } from '../components/ErrorBoundary';
import { GameShell } from '../components/GameShell';
import { StartScreen } from '../components/StartScreen';
import { GameProvider, useGame } from '../game/store/GameProvider';

function AppContent() {
  const { state } = useGame();
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
