const TROOP_MOVE_SOUND_URL = new URL('../../assets/sound/troops/followme.mp3', import.meta.url).href;
const TROOP_ATTACK_SOUND_URL = new URL('../../assets/sound/troops/kill.mp3', import.meta.url).href;
const SPEAR_THRUST_SOUND_URL = new URL('../../assets/sound/troops/tuchi.mp3', import.meta.url).href;
const FIRE_EVERYTHING_SOUND_URL = new URL('../../assets/sound/troops/fireEverythings.mp3', import.meta.url).href;
const START_PROJECT_SOUND_URL = new URL('../../assets/sound/troops/startProject.mp3', import.meta.url).href;
const MENU_WAITING_FOR_TARGET_SOUND_URL = new URL('../../assets/sound/menu/waitingForTarget.mp3', import.meta.url).href;
const MENU_LEFT_MOUSE_SOUND_URL = new URL('../../assets/sound/menu/leftMouse.mp3', import.meta.url).href;
const MENU_CLICK_ON_SOUND_URL = new URL('../../assets/sound/menu/clickOn.mp3', import.meta.url).href;
const MENU_RIGHT_MOUSE_SOUND_URL = new URL('../../assets/sound/menu/rightMouse.mp3', import.meta.url).href;

function playSound(url: string) {
  if (typeof Audio === 'undefined') return;

  const audio = new Audio(url);
  audio.volume = 0.8;
  const playResult = audio.play();
  if (playResult && typeof playResult.catch === 'function') {
    void playResult.catch(() => undefined);
  }
}

export function playTroopMoveSound() {
  playSound(TROOP_MOVE_SOUND_URL);
}

export function playTroopAttackSound() {
  playSound(TROOP_ATTACK_SOUND_URL);
}

export function playSpearThrustSound() {
  playSound(SPEAR_THRUST_SOUND_URL);
}

export function playFireEverythingSound() {
  playSound(FIRE_EVERYTHING_SOUND_URL);
}

export function playStartProjectSound() {
  playSound(START_PROJECT_SOUND_URL);
}

export function playWaitingForTargetSound() {
  playSound(MENU_WAITING_FOR_TARGET_SOUND_URL);
}

export function playLeftMouseSound() {
  playSound(MENU_LEFT_MOUSE_SOUND_URL);
}

export function playClickOnSound() {
  playSound(MENU_CLICK_ON_SOUND_URL);
}

export function playRightMouseSound() {
  playSound(MENU_RIGHT_MOUSE_SOUND_URL);
}
