import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { AudioEventProvider, useAudioEventAdapter, type AudioEvent } from './reactAudioEventAdapter';

function Harness() {
  const { emit } = useAudioEventAdapter();
  return <button type="button" onClick={() => emit({ type: 'menu-click-on' })}>播放</button>;
}

describe('React audio event adapter', () => {
  it('routes semantic React events to the configured audio adapter', async () => {
    const user = userEvent.setup();
    const emit = vi.fn<(event: AudioEvent) => void>();
    render(
      <AudioEventProvider adapter={{ emit }}>
        <Harness />
      </AudioEventProvider>,
    );

    await user.click(screen.getByRole('button', { name: '播放' }));

    expect(emit).toHaveBeenCalledWith({ type: 'menu-click-on' });
  });
});
