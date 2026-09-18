import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { createGame } from '../game/scenario/jingxiang208';
import { UnitInfoPanel } from './UnitInfoPanel';

function stateWithUnit(techNodes: string[] = []) {
  const state = createGame('liu', 1);
  state.forces.liu.techNodes = techNodes;
  state.units.u1 = {
    id: 'u1', kind: 'combat', forceId: 'liu', leaderId: 'guan-yu', officerIds: ['guan-yu'],
    homeCityId: 'jiangling', troopType: 'sword', q: 10, r: 10, troops: 4000, food: 4000,
    energy: 88, stamina: 70, movementRemaining: 20, moved: false, acted: false,
  };
  state.officers['guan-yu'].location = { kind: 'unit', unitId: 'u1' };
  return state;
}

/** 部队面板的「士气」分母与据点同口径（techs.moraleCapOf），「战力」仍是独立的 0~100 */
describe('UnitInfoPanel 士气的分母跟随科技，战力保持 100', () => {
  it('未研究时 士气 x/100、战力 x/100', () => {
    const state = stateWithUnit();

    render(<UnitInfoPanel unit={state.units.u1} state={state} position={{ x: 10, y: 10 }} />);

    const panel = screen.getByTestId('unit-info-panel');
    expect(panel).toHaveTextContent('士气88/100');
    expect(panel).toHaveTextContent('战力70/100');
  });

  it('研究「职业化」后 士气 x/120，战力仍为 x/100', () => {
    const state = stateWithUnit(['zhiyehua']);

    render(<UnitInfoPanel unit={state.units.u1} state={state} position={{ x: 10, y: 10 }} />);

    const panel = screen.getByTestId('unit-info-panel');
    expect(panel).toHaveTextContent('士气88/120');
    expect(panel).toHaveTextContent('战力70/100');
  });
});

/** 粮道状态：通畅时本城分担一半兵粮，受阻时全额自耗且每旬士气 -3；运输队不适用 */
describe('UnitInfoPanel 粮道状态', () => {
  it('本城存粮充足且部队在范围内时显示「通畅」', () => {
    const state = stateWithUnit();
    state.units.u1.q = state.cities.jiangling.gridQ;
    state.units.u1.r = state.cities.jiangling.gridR;

    render(<UnitInfoPanel unit={state.units.u1} state={state} position={{ x: 10, y: 10 }} />);

    expect(screen.getByTestId('unit-grain-route')).toHaveTextContent('通畅');
  });

  it('本城存粮低于门槛时显示「受阻」', () => {
    const state = stateWithUnit();
    state.cities.jiangling.food = 1000;

    render(<UnitInfoPanel unit={state.units.u1} state={state} position={{ x: 10, y: 10 }} />);

    expect(screen.getByTestId('unit-grain-route')).toHaveTextContent('受阻');
  });

  it('运输队不适用粮道，显示占位符', () => {
    const state = stateWithUnit();
    state.units.u1.kind = 'transport';

    render(<UnitInfoPanel unit={state.units.u1} state={state} position={{ x: 10, y: 10 }} />);

    expect(screen.getByTestId('unit-grain-route')).toHaveTextContent('—');
  });
});
