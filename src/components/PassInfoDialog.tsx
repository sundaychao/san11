import { useAudioEventAdapter } from '../audio/reactAudioEventAdapter';
import { useGame } from '../game/store/GameProvider';
import { armamentsOf, ARMAMENT_LABELS, ARMAMENT_TYPES, PASS_ARMAMENT_CAPS } from '../game/armaments';
import { passMonthlyGoldIncome, passQuarterlyFoodIncome, PASS_FOOD_CAP, PASS_GOLD_CAP, PASS_TROOP_CAP } from '../game/passes';
import type { PassId } from '../game/types';
import { closePopupOnContextMenu } from './popupEvents';

interface PassInfoDialogProps {
  passId: PassId;
  onClose(): void;
}

function formatNumber(value: number) {
  return Math.max(0, Math.round(value)).toLocaleString('en-US');
}

export function PassInfoDialog({ passId, onClose }: PassInfoDialogProps) {
  const { state } = useGame();
  const audio = useAudioEventAdapter();
  if (!state) return null;

  const pass = state.passes?.[passId];
  if (!pass) return null;

  const force = pass.ownerId ? state.forces[pass.ownerId] : undefined;
  const governor = pass.governorId ? state.officers[pass.governorId] : undefined;
  const armaments = armamentsOf(pass.armaments);

  const goldIncome = passMonthlyGoldIncome(pass);
  const foodIncome = passQuarterlyFoodIncome(pass);
  const expectedGold = Math.min(PASS_GOLD_CAP, pass.gold + goldIncome);
  const expectedFood = Math.min(PASS_FOOD_CAP, pass.food + foodIncome);

  return (
    <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()} onContextMenu={(event) => closePopupOnContextMenu(event, onClose, audio)}>
      <section className="city-info-dialog tool-panel" role="dialog" aria-modal="true" aria-labelledby="pass-info-title">
        <header>
          <div>
            <p>{force ? `${force.name}军` : '无主'} · 太守 {governor?.name ?? '暂无'}</p>
            <div className="city-info-title-row">
              <h2 id="pass-info-title">{pass.name}</h2>
            </div>
          </div>
          <button type="button" className="secondary-button" onClick={onClose}>关闭</button>
        </header>
        <div className="city-info-dialog-body">
          <section aria-label="资源">
            <h3>资源</h3>
            <dl className="city-info-dialog-grid city-info-dialog-grid-cols-3">
              <div><dt>资金</dt><dd>{formatNumber(pass.gold)} / {formatNumber(PASS_GOLD_CAP)}</dd></div>
              <div><dt>兵粮</dt><dd>{formatNumber(pass.food)} / {formatNumber(PASS_FOOD_CAP)}</dd></div>
              <div><dt>兵力</dt><dd>{formatNumber(pass.troops)} / {formatNumber(PASS_TROOP_CAP)}</dd></div>
            </dl>
          </section>

          <section aria-label="收支预估">
            <h3>收支预估</h3>
            <dl className="city-info-dialog-grid city-info-dialog-grid-cols-2">
              <div><dt>资金收入</dt><dd className="positive">{formatNumber(goldIncome)}</dd></div>
              <div><dt>兵粮收入</dt><dd className="positive">{formatNumber(foodIncome)}</dd></div>
              <div><dt>预想资金</dt><dd>{formatNumber(expectedGold)}</dd></div>
              <div><dt>预想兵粮</dt><dd>{formatNumber(expectedFood)}</dd></div>
            </dl>
          </section>

          <section aria-label="关隘">
            <h3>关隘</h3>
            <dl className="city-info-dialog-grid city-info-dialog-grid-cols-2">
              <div><dt>人口</dt><dd>{formatNumber(pass.population)}</dd></div>
              <div><dt>耐久</dt><dd>{formatNumber(pass.durability)} / {formatNumber(pass.maxDurability)}</dd></div>
              <div><dt>士气</dt><dd>{pass.training}/100</dd></div>
              <div><dt>虎将</dt><dd>{governor?.name ?? '暂无'}</dd></div>
            </dl>
          </section>

          <section aria-label="兵装">
            <h3>兵装</h3>
            <dl className="city-info-dialog-grid city-info-dialog-grid-cols-3">
              {ARMAMENT_TYPES.map((type) => (
                <div key={type}>
                  <dt>{ARMAMENT_LABELS[type]}</dt>
                  <dd>{formatNumber(armaments[type])} / {formatNumber(PASS_ARMAMENT_CAPS[type])}</dd>
                </div>
              ))}
            </dl>
          </section>
        </div>
      </section>
    </div>
  );
}
