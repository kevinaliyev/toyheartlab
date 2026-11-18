import { DEFAULT_THUMBNAILS } from '../thumbnails/default-thumbnails.js';

const THUMB_STORAGE_KEY = 'toyheart.thumbs.v1';

function readLocalThumbs() {
  try {
    return JSON.parse(localStorage.getItem(THUMB_STORAGE_KEY) || '{}');
  } catch {
    return {};
  }
}

export function getThumbnail(key) {
  if (!key) return null;
  const local = readLocalThumbs();
  return local[key] || DEFAULT_THUMBNAILS[key] || null;
}

export function getAllThumbnails() {
  return {
    ...DEFAULT_THUMBNAILS,
    ...readLocalThumbs(),
  };
}

export function saveThumbnail(key, dataUrl) {
  if (!key || !dataUrl) return;
  try {
    const local = readLocalThumbs();
    local[key] = dataUrl;
    localStorage.setItem(THUMB_STORAGE_KEY, JSON.stringify(local));
  } catch {
    // Ignore storage quota errors
  }
}

export function getWarmupRule(study) {
  if (!study) return { delayMs: 1100, minElapsedSec: 0.85 };
  if (study.mode === 'pingpong') {
    return { delayMs: 1850, minElapsedSec: 1.4 };
  }
  return { delayMs: 1000, minElapsedSec: 0.8 };
}

export function captureCompositeThumbnail(canvases, maxWidth = 360) {
  const list = (Array.isArray(canvases) ? canvases : [canvases]).filter(
    (c) => c && c.width > 0 && c.height > 0
  );
  if (!list.length) return null;
  try {
    const base = list[0];
    const scale = Math.min(1, maxWidth / base.width);
    const tw = Math.max(1, Math.round(base.width * scale));
    const th = Math.max(1, Math.round(base.height * scale));
    const tmp = document.createElement('canvas');
    tmp.width = tw;
    tmp.height = th;
    const ctx = tmp.getContext('2d');
    for (const c of list) {
      ctx.drawImage(c, 0, 0, tw, th);
    }
    return tmp.toDataURL('image/jpeg', 0.72);
  } catch {
    return null;
  }
}

export function createThumbnailSession({ engine, getCanvases }) {
  let timer = null;
  let activeRule = { delayMs: 1000, minElapsedSec: 0.8 };
  let activeKeys = [];
  let activeElapsedOffset = 0;

  function clearTimer() {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
  }

  function captureNow({ force = false } = {}) {
    if (!activeKeys.length) return false;
    const sessionElapsed = Math.max(0, (engine?.elapsed || 0) - activeElapsedOffset);
    if (!force && sessionElapsed < activeRule.minElapsedSec) {
      return false;
    }
    try {
      engine?.renderFrame?.();
      const dataUrl = captureCompositeThumbnail(getCanvases());
      if (!dataUrl) return false;
      for (const k of activeKeys) {
        saveThumbnail(k, dataUrl);
      }
      return true;
    } catch {
      return false;
    }
  }

  function arm({ keys, study, delayMs, minElapsedSec }) {
    clearTimer();
    activeKeys = Array.isArray(keys) ? keys.filter(Boolean) : [keys].filter(Boolean);
    const rule = getWarmupRule(study);
    activeRule = {
      delayMs: delayMs ?? rule.delayMs,
      minElapsedSec: minElapsedSec ?? rule.minElapsedSec,
    };
    activeElapsedOffset = engine?.elapsed || 0;

    const scheduleCheck = (waitMs) => {
      timer = setTimeout(() => {
        timer = null;
        if (!activeKeys.length) return;
        const sessionElapsed = Math.max(0, (engine?.elapsed || 0) - activeElapsedOffset);
        if (engine?.paused || sessionElapsed >= activeRule.minElapsedSec) {
          captureNow({ force: sessionElapsed >= activeRule.minElapsedSec || !getThumbnail(activeKeys[0]) });
        } else {
          scheduleCheck(450);
        }
      }, waitMs);
    };

    scheduleCheck(activeRule.delayMs);
  }

  function destroy() {
    captureNow({ force: false });
    clearTimer();
    activeKeys = [];
  }

  return {
    arm,
    captureNow,
    clearTimer,
    destroy,
  };
}

export function downloadRepoThumbnailsModule() {
  const merged = getAllThumbnails();
  const payload =
    `/**\n` +
    ` * Repo-committed baseline thumbnails (data URLs).\n` +
    ` * Local user captures in localStorage automatically override these entries.\n` +
    ` */\n` +
    `export const DEFAULT_THUMBNAILS = ${JSON.stringify(merged, null, 2)};\n`;
  const blob = new Blob([payload], { type: 'application/javascript' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'default-thumbnails.js';
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
