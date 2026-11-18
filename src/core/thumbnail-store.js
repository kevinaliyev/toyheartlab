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
  const local = readLocalThumbs();
  local[key] = dataUrl;
  try {
    localStorage.setItem(THUMB_STORAGE_KEY, JSON.stringify(local));
  } catch {
    // Evict older lab:* study thumbs first if storage quota is tight, then retry
    for (const k of Object.keys(local)) {
      if (k !== key && k.startsWith('lab:')) {
        delete local[k];
      }
    }
    try {
      localStorage.setItem(THUMB_STORAGE_KEY, JSON.stringify(local));
    } catch {
      // Ignore if still over quota
    }
  }
}

export function getWarmupRule(study) {
  if (!study) return { delayMs: 1100, minElapsedSec: 0.85 };
  if (study.mode === 'pingpong') {
    return { delayMs: 1850, minElapsedSec: 1.4 };
  }
  return { delayMs: 1000, minElapsedSec: 0.8 };
}

export function captureCompositeThumbnail(canvases, maxWidth = 640) {
  const list = (Array.isArray(canvases) ? canvases : [canvases]).filter(
    (c) => c && c.width > 0 && c.height > 0
  );
  if (!list.length) return null;
  try {
    const base = list[0];
    const targetAspect = 16 / 9;
    const srcAspect = base.width / base.height;
    const tw = Math.min(maxWidth, Math.max(360, base.width));
    const th = Math.max(1, Math.round(tw / targetAspect));

    const tmp = document.createElement('canvas');
    tmp.width = tw;
    tmp.height = th;
    const ctx = tmp.getContext('2d');
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';

    if (Math.abs(srcAspect - targetAspect) > 0.18) {
      // Letterbox square/portrait canvases (e.g. Loop Studio) cleanly onto a 16:9 dark stage
      ctx.fillStyle = '#141418';
      ctx.fillRect(0, 0, tw, th);
      const fitScale = Math.min((tw * 0.92) / base.width, (th * 0.92) / base.height);
      const dw = Math.round(base.width * fitScale);
      const dh = Math.round(base.height * fitScale);
      const dx = Math.round((tw - dw) * 0.5);
      const dy = Math.round((th - dh) * 0.5);
      for (const c of list) {
        ctx.drawImage(c, dx, dy, dw, dh);
      }
    } else {
      for (const c of list) {
        ctx.drawImage(c, 0, 0, tw, th);
      }
    }

    const webp = tmp.toDataURL('image/webp', 0.84);
    return webp.startsWith('data:image/webp') ? webp : tmp.toDataURL('image/jpeg', 0.84);
  } catch {
    return null;
  }
}

export function createThumbnailSession({ engine, getCanvases }) {
  let timer = null;
  let activeRule = { delayMs: 1000, minElapsedSec: 0.8 };
  let activeKeys = [];
  let armedAtMs = 0;

  function clearTimer() {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
  }

  function getSessionElapsedSec() {
    return armedAtMs > 0 ? (performance.now() - armedAtMs) / 1000 : 0;
  }

  function captureNow({ force = false } = {}) {
    if (!activeKeys.length) return false;
    const sessionElapsed = getSessionElapsedSec();
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
    armedAtMs = performance.now();

    const scheduleCheck = (waitMs) => {
      timer = setTimeout(() => {
        timer = null;
        if (!activeKeys.length) return;
        const sessionElapsed = getSessionElapsedSec();
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

const THUMB_FS_DB = 'toyheart.fs.v1';
const THUMB_FS_STORE = 'handles';
const THUMB_FS_KEY = 'defaultThumbnailsFile';

function openFsDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(THUMB_FS_DB, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(THUMB_FS_STORE)) {
        req.result.createObjectStore(THUMB_FS_STORE);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function saveThumbFileHandle(handle) {
  const db = await openFsDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(THUMB_FS_STORE, 'readwrite');
    tx.objectStore(THUMB_FS_STORE).put(handle, THUMB_FS_KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function loadThumbFileHandle() {
  try {
    const db = await openFsDb();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(THUMB_FS_STORE, 'readonly');
      const req = tx.objectStore(THUMB_FS_STORE).get(THUMB_FS_KEY);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
  } catch {
    return null;
  }
}

export function buildRepoThumbnailsSource() {
  const merged = getAllThumbnails();
  return (
    `/**\n` +
    ` * Repo-committed baseline thumbnails (data URLs).\n` +
    ` * Local user captures in localStorage automatically override these entries.\n` +
    ` */\n` +
    `export const DEFAULT_THUMBNAILS = ${JSON.stringify(merged, null, 2)};\n`
  );
}

export async function pickRepoThumbnailsPath() {
  if (typeof window.showSaveFilePicker !== 'function') {
    return { ok: false, reason: 'unsupported' };
  }
  try {
    const handle = await window.showSaveFilePicker({
      suggestedName: 'default-thumbnails.js',
      types: [
        {
          description: 'JavaScript Module',
          accept: { 'application/javascript': ['.js'] },
        },
      ],
    });
    await saveThumbFileHandle(handle);
    // Write immediately so showSaveFilePicker never leaves default-thumbnails.js empty (0 bytes)
    const writable = await handle.createWritable();
    await writable.write(buildRepoThumbnailsSource());
    await writable.close();
    return { ok: true, name: handle.name };
  } catch (err) {
    return { ok: false, reason: err?.name === 'AbortError' ? 'cancelled' : 'error' };
  }
}

export async function getLinkedThumbnailsName() {
  const handle = await loadThumbFileHandle();
  return handle?.name || null;
}

export function downloadRepoThumbnailsModule() {
  const payload = buildRepoThumbnailsSource();
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

export async function exportRepoThumbnails() {
  const payload = buildRepoThumbnailsSource();
  const handle = await loadThumbFileHandle();
  if (handle) {
    try {
      let perm = await handle.queryPermission({ mode: 'readwrite' });
      if (perm !== 'granted') {
        perm = await handle.requestPermission({ mode: 'readwrite' });
      }
      if (perm === 'granted') {
        const writable = await handle.createWritable();
        await writable.write(payload);
        await writable.close();
        return { writtenToDisk: true, name: handle.name };
      }
    } catch {
      // Fall back to standard download if handle is stale or denied
    }
  }
  downloadRepoThumbnailsModule();
  return { writtenToDisk: false, name: 'default-thumbnails.js' };
}
