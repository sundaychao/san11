import { createContext, useContext, type PropsWithChildren } from 'react';
import {
  playClickOnSound,
  playFireEverythingSound,
  playLeftMouseSound,
  playRightMouseSound,
  playSpearThrustSound,
  playStartProjectSound,
  playTroopAttackSound,
  playTroopMoveSound,
  playWaitingForTargetSound,
} from './soundEffects';
import type { AudioEvent, AudioEventAdapter } from './audioEvents';

export type { AudioEvent, AudioEventAdapter } from './audioEvents';

function playAudioEvent(event: AudioEvent) {
  switch (event.type) {
    case 'unit-moved':
    case 'unit-waited':
      playTroopMoveSound();
      return;
    case 'unit-attacked':
      playTroopAttackSound();
      return;
    case 'spear-thrust-used':
      playSpearThrustSound();
      return;
    case 'fire-used':
      playFireEverythingSound();
      return;
    case 'project-started':
      playStartProjectSound();
      return;
    case 'menu-waiting-for-target':
      playWaitingForTargetSound();
      return;
    case 'menu-left-click':
      playLeftMouseSound();
      return;
    case 'menu-click-on':
      playClickOnSound();
      return;
    case 'menu-right-click':
      playRightMouseSound();
      return;
  }
}

const defaultAudioEventAdapter: AudioEventAdapter = { emit: playAudioEvent };
const AudioEventContext = createContext<AudioEventAdapter>(defaultAudioEventAdapter);

export function AudioEventProvider({ adapter = defaultAudioEventAdapter, children }: PropsWithChildren<{ adapter?: AudioEventAdapter }>) {
  return <AudioEventContext.Provider value={adapter}>{children}</AudioEventContext.Provider>;
}

export function useAudioEventAdapter() {
  return useContext(AudioEventContext);
}
