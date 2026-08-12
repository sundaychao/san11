import type { MouseEvent as ReactMouseEvent } from 'react';
import { playRightMouseSound } from '../audio/soundEffects';

export function closePopupOnContextMenu(event: ReactMouseEvent<HTMLElement>, onClose: () => void) {
  event.preventDefault();
  event.stopPropagation();
  playRightMouseSound();
  onClose();
}
