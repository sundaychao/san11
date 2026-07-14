import { CityPanel } from './CityPanel';
import { EventLog } from './EventLog';
import { StrategicMap } from './StrategicMap';
import { TopBar } from './TopBar';

export function GameShell() {
  return (
    <main className="game-shell">
      <TopBar />
      <StrategicMap />
      <CityPanel />
      <EventLog />
    </main>
  );
}
