import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { createGame } from '../game/scenario/jingxiang208';
import type { ForceId } from '../game/types';
import { ForceRelationDialog } from './ForceRelationDialog';

type Game = ReturnType<typeof createGame>;

function renderDialog(state: Game, selectedForceId: ForceId | '' = '') {
  const onPick = vi.fn();
  const onClose = vi.fn();
  render(
    <ForceRelationDialog
      state={state}
      selectedForceId={selectedForceId}
      onPick={onPick}
      onClose={onClose}
    />,
  );
  return { state, onPick, onClose };
}

/** 外交一览只列他方势力 */
function otherForceIds(state: Game): ForceId[] {
  return (Object.keys(state.forces) as ForceId[]).filter((id) => id !== state.playerForceId);
}

function rowOf(id: ForceId): HTMLElement {
  const row = document.querySelector<HTMLElement>(`[data-force-id="${id}"]`);
  if (!row) throw new Error(`未找到势力行：${id}`);
  return row;
}

function headers(): (string | null)[] {
  return Array.from(document.querySelectorAll('.force-select-table thead th')).map((th) => th.textContent);
}

/** 把势力的所有据点夺走，使其灭亡（外交不可选） */
function wipeOut(state: Game, id: ForceId) {
  for (const city of Object.values(state.cities)) if (city.ownerId === id) city.ownerId = null;
  for (const pass of Object.values(state.passes ?? {})) if (pass.ownerId === id) pass.ownerId = null;
}

describe('选择对象势力页', () => {
  it('列出除我方外的全部势力，表头为原版六列（姓名/交情/关系/停战期间/日数……对应友好度/履行）', () => {
    const state = createGame('liu', 3);
    renderDialog(state);

    expect(headers()).toEqual(['姓名', '交情', '关系', '停战期间', '友好度', '履行']);
    const ids = otherForceIds(state);
    expect(document.querySelectorAll('.force-select-row')).toHaveLength(ids.length);
    for (const id of ids) expect(rowOf(id)).toBeTruthy();
    // 我方势力不出现在一览中
    expect(document.querySelector(`[data-force-id="${state.playerForceId}"]`)).toBeNull();
  });

  it('按友好度显示交情档位与友好度数值（0~100，不带到正负号）', () => {
    const state = createGame('liu', 3);
    const [intimate, hostile] = otherForceIds(state);
    state.forces[state.playerForceId].diplomacy = { [intimate]: 85, [hostile]: 15 };
    renderDialog(state);

    expect(rowOf(intimate).textContent).toContain('亲密');
    expect(rowOf(intimate).textContent).toContain('85');
    expect(rowOf(hostile).textContent).toContain('险恶');
    expect(rowOf(hostile).textContent).toContain('15');
    // 无盟约时关系留白、履行为 ✕
    expect(rowOf(intimate).textContent).toContain('✕');
  });

  it('同盟显示「同盟」+履行 ✓，停战显示剩余旬数 +履行 ✓', () => {
    const state = createGame('liu', 3);
    const [ally, truce] = otherForceIds(state);
    const player = state.playerForceId;
    state.forces[player].allies = [ally];
    state.forces[ally].allies = [player];
    state.forces[player].truces = { [truce]: 12 };
    renderDialog(state);

    const allyRow = rowOf(ally);
    expect(allyRow.textContent).toContain('同盟');
    expect(allyRow.textContent).toContain('✓');

    const truceRow = rowOf(truce);
    expect(truceRow.textContent).toContain('停战');
    expect(truceRow.textContent).toContain('12旬');
    expect(truceRow.textContent).toContain('✓');
  });

  it('已有对象默认高亮，点击任意一行即回传该势力', () => {
    const state = createGame('liu', 3);
    const [first, second] = otherForceIds(state);
    const { onPick } = renderDialog(state, first);

    expect(rowOf(first).className).toContain('is-selected');

    fireEvent.click(rowOf(second));
    expect(onPick).toHaveBeenCalledWith(second);
  });

  it('返回按钮与 Esc 均可关闭页面（不改变选择）', () => {
    const state = createGame('liu', 3);
    const { onPick, onClose } = renderDialog(state);

    fireEvent.click(screen.getByRole('button', { name: '返回' }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onPick).not.toHaveBeenCalled();

    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it('切换分类标签只换表头，行仍可选定', () => {
    const state = createGame('liu', 3);
    const target = otherForceIds(state)[0];
    const { onPick } = renderDialog(state);

    fireEvent.click(screen.getByRole('tab', { name: '战力' }));
    expect(headers()).toEqual(['姓名', '守军', '部队', '野战兵', '合计兵力']);

    fireEvent.click(screen.getByRole('tab', { name: '外交' }));
    expect(headers()).toEqual(['姓名', '相性', '相性差', '交情', '关系', '友好度']);

    fireEvent.click(rowOf(target));
    expect(onPick).toHaveBeenCalledWith(target);
  });

  it('方向键移动光标，回车选定光标所在势力', () => {
    const state = createGame('liu', 3);
    const { onPick } = renderDialog(state);
    const dialog = screen.getByRole('dialog');

    fireEvent.keyDown(dialog, { key: 'ArrowDown' });
    const cursorRow = document.querySelector<HTMLElement>('.force-select-row.is-cursor');
    expect(cursorRow).not.toBeNull();

    fireEvent.keyDown(cursorRow!, { key: 'Enter' });
    expect(onPick).toHaveBeenCalledWith(cursorRow!.dataset.forceId);
  });

  it('已灭亡的势力列在最下方且不可选定', () => {
    const state = createGame('liu', 3);
    const [target] = otherForceIds(state);
    wipeOut(state, target);
    const { onPick } = renderDialog(state);

    const rows = Array.from(document.querySelectorAll<HTMLElement>('.force-select-row'));
    expect(rows[rows.length - 1]).toBe(rowOf(target));
    expect(rowOf(target).className).toContain('is-defunct');

    fireEvent.click(rowOf(target));
    expect(onPick).not.toHaveBeenCalled();
  });
});
