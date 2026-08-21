export type AudioEvent =
  | { type: 'unit-moved' }
  | { type: 'unit-waited' }
  | { type: 'unit-attacked' }
  | { type: 'spear-thrust-used' }
  | { type: 'fire-used' }
  | { type: 'project-started' }
  | { type: 'menu-waiting-for-target' }
  | { type: 'menu-left-click' }
  | { type: 'menu-click-on' }
  | { type: 'menu-right-click' };

export interface AudioEventAdapter {
  emit(event: AudioEvent): void;
}
