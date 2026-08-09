const TROOP_MOVE_SOUND_URL = new URL('../../assets/sound/troops/followme.mp3', import.meta.url).href;
const TROOP_ATTACK_SOUND_URL = new URL('../../assets/sound/troops/kill.mp3', import.meta.url).href;
const SPEAR_THRUST_SOUND_URL = new URL('../../assets/sound/troops/tuchi.mp3', import.meta.url).href;

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
