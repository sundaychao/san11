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
