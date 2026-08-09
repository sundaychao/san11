import type { MouseEvent as ReactMouseEvent } from 'react';

export function closePopupOnContextMenu(event: ReactMouseEvent<HTMLElement>, onClose: () => void) {
  event.preventDefault();
  event.stopPropagation();
  onClose();
}
