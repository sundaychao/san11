import { Eye, RotateCcw, Trophy } from 'lucide-react';
import { rankForces } from '../game/score';
import { useGame } from '../game/store/GameProvider';

interface ResultOverlayProps {
  onViewMap(): void;
}

export function ResultOverlay({ onViewMap }: ResultOverlayProps) {
  const { state, resetGame } = useGame();
  if (!state) return null;
  const rankings = rankForces(state);
  const player = rankings.find((row) => row.forceId === state.playerForceId);

  return (
    <div className="result-backdrop">
      <section className="result-overlay tool-panel" role="dialog" aria-modal="true" aria-labelledby="result-title">
        <header><Trophy aria-hidden="true" /><div><p>二十四个月经营期结束</p><h1 id="result-title">荆襄国力结算</h1></div></header>
        <p className="player-result">{state.forces[state.playerForceId].name}军最终位列第 <strong>{player?.rank}</strong> 名</p>
        <table>
          <thead><tr><th>名次</th><th>势力</th><th>国力</th></tr></thead>
          <tbody>{rankings.map((row) => (
            <tr key={row.forceId} className={row.forceId === state.playerForceId ? 'is-player' : ''}>
              <td>{row.rank}</td><td><i style={{ backgroundColor: state.forces[row.forceId].color }} />{row.name}</td><td>{row.score.toLocaleString('en-US')}</td>
            </tr>
          ))}</tbody>
        </table>
        <footer>
          <button type="button" className="secondary-button" onClick={onViewMap}><Eye />查看最终地图</button>
          <button type="button" className="primary-button" onClick={resetGame}><RotateCcw />重新开局</button>
        </footer>
      </section>
    </div>
  );
}
