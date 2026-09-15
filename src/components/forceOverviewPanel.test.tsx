import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { GameProvider } from '../game/store/GameProvider';
import { createGame } from '../game/scenario/jingxiang208';
import { ForceOverviewPanel } from './ForceOverviewPanel';

/** 本势力概览·城池页签：本城没有可下令的武将时整行置灰（`has-acted`，与武将/部队页签同款） */
describe('ForceOverviewPanel 城池行置灰', () => {
  it('城中有未行动武将：行保持高亮（is-ready）', () => {
    const state = createGame('liu', 1);

    render(
      <GameProvider initialState={state}>
        <ForceOverviewPanel />
      </GameProvider>,
    );

    const row = screen.getByTestId('force-overview-city-jiangling');
    expect(row.classList.contains('is-ready')).toBe(true);
    expect(row.classList.contains('has-acted')).toBe(false);
  });

  it('城中武将全部已行动：该城置灰，其余仍有可行动武将的城不受影响', () => {
    const state = createGame('liu', 1);
    // 只让江陵的武将全部行动完（武陵的诸葛亮等人保持未行动）
    for (const officer of Object.values(state.officers)) {
      if (officer.forceId === 'liu' && officer.location.kind === 'city' && officer.location.cityId === 'jiangling') {
        officer.acted = true;
      }
    }

    render(
      <GameProvider initialState={state}>
        <ForceOverviewPanel />
      </GameProvider>,
    );

    const jiangling = screen.getByTestId('force-overview-city-jiangling');
    expect(jiangling.classList.contains('has-acted')).toBe(true);
    expect(jiangling.classList.contains('is-ready')).toBe(false);
    expect(jiangling.getAttribute('title')).toContain('本旬已无可行动的武将');

    // 武陵仍有未行动武将（诸葛亮/张飞等）→ 不跟着灰
    expect(screen.getByTestId('force-overview-city-wuling').classList.contains('is-ready')).toBe(true);
  });

  it('城中武将全部出征在外：本城也置灰', () => {
    const state = createGame('liu', 1);
    for (const officer of Object.values(state.officers)) {
      if (officer.forceId === 'liu' && officer.location.kind === 'city' && officer.location.cityId === 'jiangling') {
        // 随军出征：不在据点内，本旬下不了令
        officer.location = { kind: 'unit', unitId: 'u-away' };
      }
    }
    state.units['u-away'] = {
      id: 'u-away', kind: 'combat', forceId: 'liu', leaderId: 'guan-yu',
      officerIds: [], homeCityId: 'jiangling', troopType: 'spear',
      q: 10, r: 10, troops: 4000, food: 5000, energy: 100,
      movementRemaining: 20, moved: false, acted: false,
    };

    render(
      <GameProvider initialState={state}>
        <ForceOverviewPanel />
      </GameProvider>,
    );

    expect(screen.getByTestId('force-overview-city-jiangling').classList.contains('has-acted')).toBe(true);
  });
});
