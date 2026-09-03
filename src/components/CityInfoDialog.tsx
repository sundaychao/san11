import { useAudioEventAdapter } from '../audio/reactAudioEventAdapter';
import { useGame } from '../game/store/GameProvider';
import {
  cityPopulationOf,
  ruralPopulationOf,
  cityMonthlyGoldIncome,
  cityMonthlyOfficerSalary,
  cityNextQuarterFoodIncome,
  cityNextQuarterFoodExpense,
  cityTroopCap,
  CITY_GOLD_CAP,
  CITY_FOOD_CAP,
  citySizeOf,
} from '../game/innerAffairs';
import type { CityId } from '../game/types';
import { closePopupOnContextMenu } from './popupEvents';

interface CityInfoDialogProps {
  cityId: CityId;
  onClose(): void;
}

function formatNumber(value: number) {
  return Math.max(0, Math.round(value)).toLocaleString('en-US');
}

const CITY_SIZE_LABEL: Record<string, string> = { small: '小城', medium: '中城', large: '大城' };

export function CityInfoDialog({ cityId, onClose }: CityInfoDialogProps) {
  const { state } = useGame();
  const audio = useAudioEventAdapter();
  if (!state) return null;

  const city = state.cities[cityId];
  if (!city) return null;

  const force = city.ownerId ? state.forces[city.ownerId] : undefined;
  const governor = city.governorId ? state.officers[city.governorId] : undefined;

  // 收入/支出预估
  const goldIncome = cityMonthlyGoldIncome(city);
  const goldExpense = cityMonthlyOfficerSalary(state, city);
  const expectedGold = Math.min(CITY_GOLD_CAP, city.gold + goldIncome - goldExpense);

  const foodIncome = cityNextQuarterFoodIncome(city);
  const foodExpense = cityNextQuarterFoodExpense(state, city);
  const expectedFood = Math.max(0, Math.min(CITY_FOOD_CAP, city.food + foodIncome - foodExpense));

  const troopCap = cityTroopCap(city);
  const citySize = citySizeOf(city);

  return (
    <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()} onContextMenu={(event) => closePopupOnContextMenu(event, onClose, audio)}>
      <section className="city-info-dialog tool-panel" role="dialog" aria-modal="true" aria-labelledby="city-info-title">
        <header>
          <div>
            <p>{force ? `${force.name}军` : '无主'} · 太守 {governor?.name ?? '暂无'} · {CITY_SIZE_LABEL[citySize]}</p>
            <h2 id="city-info-title">{city.name}</h2>
          </div>
          <button type="button" className="secondary-button" onClick={onClose}>关闭</button>
        </header>
        <div className="city-info-dialog-body">
          {/* 资源 */}
          <section aria-label="资源">
            <h3>资源</h3>
            <dl className="city-info-dialog-grid city-info-dialog-grid-cols-3">
              <div><dt>资金</dt><dd>{formatNumber(city.gold)} / {formatNumber(CITY_GOLD_CAP)}</dd></div>
              <div><dt>兵粮</dt><dd>{formatNumber(city.food)} / {formatNumber(CITY_FOOD_CAP)}</dd></div>
              <div><dt>兵力</dt><dd>{formatNumber(city.troops)} / {formatNumber(troopCap)}</dd></div>
            </dl>
          </section>

          {/* 收入/支出 */}
          <section aria-label="收支预估">
            <h3>收支预估</h3>
            <dl className="city-info-dialog-grid city-info-dialog-grid-cols-2">
              <div><dt>资金支出</dt><dd className="negative">{formatNumber(goldExpense)}</dd></div>
              <div><dt>兵粮支出</dt><dd className="negative">{formatNumber(foodExpense)}</dd></div>
              <div><dt>资金收入</dt><dd className="positive">{formatNumber(goldIncome)}</dd></div>
              <div><dt>兵粮收入</dt><dd className="positive">{formatNumber(foodIncome)}</dd></div>
              <div><dt>预想资金</dt><dd>{formatNumber(expectedGold)}</dd></div>
              <div><dt>预想兵粮</dt><dd>{formatNumber(expectedFood)}</dd></div>
            </dl>
          </section>

          {/* 城池 */}
          <section aria-label="城池">
            <h3>城池</h3>
            <dl className="city-info-dialog-grid city-info-dialog-grid-cols-3">
              <div><dt>总人口</dt><dd>{formatNumber(city.population)}</dd></div>
              <div><dt>城市人口</dt><dd>{formatNumber(cityPopulationOf(city))}</dd></div>
              <div><dt>农村人口</dt><dd>{formatNumber(ruralPopulationOf(city))}</dd></div>
              <div><dt>治安</dt><dd>{city.order}/100</dd></div>
              <div><dt>士气</dt><dd>{city.training}</dd></div>
              <div><dt>耐久</dt><dd>{formatNumber(city.durability)}/{formatNumber(city.maxDurability)}</dd></div>
            </dl>
          </section>
        </div>
      </section>
    </div>
  );
}
