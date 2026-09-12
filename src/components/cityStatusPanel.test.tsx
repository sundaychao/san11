import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { createGame } from '../game/scenario/jingxiang208';
import { CityStatusPanel } from './CityStatusPanel';

/** 城池状态框的「士气」分母必须跟着科技走，不能写死 100 */
describe('CityStatusPanel 士气上限跟随「职业化」科技', () => {
  it('未研究时显示 x/100', () => {
    const state = createGame('liu', 1);
    const city = state.cities.jiangling;

    render(<CityStatusPanel city={city} state={state} />);

    expect(screen.getByTestId('city-status-panel')).toHaveTextContent(`士气${city.training}/100`);
  });

  it('研究「职业化」后显示 x/120', () => {
    const state = createGame('liu', 1);
    state.forces.liu.techNodes = ['zhiyehua'];
    const city = state.cities.jiangling;

    render(<CityStatusPanel city={city} state={state} />);

    expect(screen.getByTestId('city-status-panel')).toHaveTextContent(`士气${city.training}/120`);
  });
});
