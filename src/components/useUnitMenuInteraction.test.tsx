import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';
import { useUnitMenuInteraction } from './useUnitMenuInteraction';

function Harness() {
  const menu = useUnitMenuInteraction();
  return (
    <>
      <button onClick={() => menu.setUnitCommandMenu({ unitId: 'unit-1', position: { x: 10, y: 20 } })}>open</button>
      <button onClick={() => menu.setUnitStrategyMenu({ unitId: 'unit-1', position: { x: 118, y: 20 } })}>strategy</button>
      <button onClick={() => menu.setUnitStrategyMenu(null)}>close-strategy</button>
      <button onClick={() => menu.setUnitCommandMenu(null)}>close</button>
      <output data-testid="command">{menu.unitCommandMenu?.unitId ?? 'none'}</output>
      <output data-testid="strategy">{menu.unitStrategyMenu?.unitId ?? 'none'}</output>
    </>
  );
}

it('keeps first-level unit menu while navigating back from a submenu', () => {
  render(<Harness />);
  fireEvent.click(screen.getByText('open'));
  fireEvent.click(screen.getByText('strategy'));
  expect(screen.getByTestId('command')).toHaveTextContent('unit-1');
  expect(screen.getByTestId('strategy')).toHaveTextContent('unit-1');
  fireEvent.click(screen.getByText('close-strategy'));
  expect(screen.getByTestId('command')).toHaveTextContent('unit-1');
  expect(screen.getByTestId('strategy')).toHaveTextContent('none');
  fireEvent.click(screen.getByText('close'));
  expect(screen.getByTestId('command')).toHaveTextContent('none');
});
