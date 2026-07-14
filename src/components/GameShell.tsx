import { EventLog } from './EventLog';
import { TopBar } from './TopBar';

export function GameShell() {
  return (
    <main className="game-shell">
      <TopBar />
      <section className="map-region" aria-label="战略地图区域" />
      <aside className="city-panel tool-panel" aria-label="城市经营面板">
        <h2>城市政务</h2>
        <p>选择地图上的城市</p>
      </aside>
      <EventLog />
    </main>
  );
}
