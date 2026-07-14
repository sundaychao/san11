import { useGame } from '../game/store/GameProvider';

export function EventLog() {
  const { state } = useGame();
  if (!state) return null;
  const logs = state.logs.slice(-6).reverse();

  return (
    <section className="event-log tool-panel" aria-label="军情与政务">
      <h2>军情与政务</h2>
      <ol>
        {logs.map((log) => (
          <li key={log.id}>
            <i style={{ backgroundColor: log.forceId ? state.forces[log.forceId].color : '#c5ad6f' }} aria-hidden="true" />
            <span>{log.message}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}
