/**
 * Utility for playing the MovieVerify custom notification sound.
 * Hardwired to be permanently active by default without requiring manual approval.
 */

export const NOTIFICATION_SOUND_STORAGE_KEY = 'mv_notification_sound_enabled';

let isAudioPrimed = false;
let globalAudioInstance = null;

const getLocalStorage = () => {
  try {
    if (typeof window !== 'undefined' && window.localStorage) return window.localStorage;
    if (typeof localStorage !== 'undefined') return localStorage;
  } catch {}
  return null;
};

export const isNotificationSoundEnabled = () => {
  try {
    const storage = getLocalStorage();
    if (!storage) return true;
    return storage.getItem(NOTIFICATION_SOUND_STORAGE_KEY) !== 'false';
  } catch {
    return true;
  }
};

export const setNotificationSoundEnabled = (enabled) => {
  try {
    const storage = getLocalStorage();
    if (!storage) return;
    storage.setItem(NOTIFICATION_SOUND_STORAGE_KEY, String(Boolean(enabled)));
  } catch {}
};

/**
 * Prime and unlock audio context on user interaction to avoid browser autoplay restrictions.
 */
export const primeNotificationAudio = () => {
  if (isAudioPrimed || typeof window === 'undefined') return;
  try {
    const AudioConstructor =
      (typeof window !== 'undefined' && window.Audio) ||
      (typeof Audio !== 'undefined' ? Audio : null);

    if (!AudioConstructor) return;

    const audio = new AudioConstructor('/notification.mp3');
    audio.volume = 0.001;
    const p = audio.play();
    if (p !== undefined && typeof p?.then === 'function') {
      p.then(() => {
        audio.pause();
        audio.currentTime = 0;
        audio.volume = 0.9;
        globalAudioInstance = audio;
        isAudioPrimed = true;
      }).catch(() => {});
    }
  } catch {}
};

// Auto-register touch/click unlockers on client load
if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
  const unlockEvents = ['click', 'touchstart', 'keydown'];
  const unlocker = () => {
    primeNotificationAudio();
    unlockEvents.forEach((ev) => {
      try {
        window.removeEventListener(ev, unlocker);
      } catch {}
    });
  };
  unlockEvents.forEach((ev) => {
    try {
      window.addEventListener(ev, unlocker, { passive: true, once: true });
    } catch {}
  });
}

/**
 * Play custom notification audio directly.
 */
export const playNotificationSound = (force = true) => {
  try {
    const AudioConstructor =
      (typeof window !== 'undefined' && window.Audio) ||
      (typeof Audio !== 'undefined' ? Audio : null);

    if (!AudioConstructor) return null;
    if (!force && !isNotificationSoundEnabled()) return null;

    let audio = globalAudioInstance;
    if (!audio) {
      audio = new AudioConstructor('/notification.mp3');
    }
    audio.currentTime = 0;
    audio.volume = 0.9;

    const playPromise = audio.play();
    if (playPromise !== undefined && typeof playPromise?.catch === 'function') {
      playPromise.catch((err) => {
        // Fallback to AAC format if MP3 playback encountered an issue
        try {
          const aacAudio = new AudioConstructor('/notification.aac');
          aacAudio.volume = 0.9;
          if (typeof aacAudio.play === 'function') {
            aacAudio.play().catch(() => {});
          }
        } catch {}
        console.warn('[Audio] Notification sound playback deferred or muted:', err.message);
      });
    }
    return audio;
  } catch (err) {
    console.warn('[Audio] Failed to initialize notification sound:', err.message);
    return null;
  }
};
