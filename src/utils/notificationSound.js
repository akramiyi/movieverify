/**
 * Utility for playing the MovieVerify custom notification sound.
 */

export const NOTIFICATION_SOUND_STORAGE_KEY = 'mv_notification_sound_enabled';

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

export const playNotificationSound = (force = false) => {
  try {
    const AudioConstructor =
      (typeof window !== 'undefined' && window.Audio) ||
      (typeof Audio !== 'undefined' ? Audio : null);

    if (!AudioConstructor) return null;
    if (!force && !isNotificationSoundEnabled()) return null;

    const audio = new AudioConstructor('/notification.mp3');
    audio.volume = 0.85;

    const playPromise = audio.play();
    if (playPromise !== undefined && typeof playPromise?.catch === 'function') {
      playPromise.catch((err) => {
        try {
          const aacAudio = new AudioConstructor('/notification.aac');
          aacAudio.volume = 0.85;
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
