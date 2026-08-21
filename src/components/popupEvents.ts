import type { MouseEvent as ReactMouseEvent } from 'react';
import type { AudioEventAdapter } from '../audio/reactAudioEventAdapter';

export function closePopupOnContextMenu(event: ReactMouseEvent<HTMLElement>, onClose: () => void, audio: AudioEventAdapter) {
  event.preventDefault();
  event.stopPropagation();
  audio.emit({ type: 'menu-right-click' });
  onClose();
}
