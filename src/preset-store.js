const STORAGE_KEY = 'toyheartlab.presets.v1';

export function slugifyName(name) {
  return (
    String(name || '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '') || 'untitled'
  );
}

/**
 * Resolve a preset name so neither its key nor its disk slug collides
 * with any existing preset.
 */
export function resolveUniquePresetName(rawName, existingPresets) {
  const base = rawName.trim() || 'untitled';
  const existingKeys = Object.keys(existingPresets);
  const usedSlugs = new Set(existingKeys.map((k) => slugifyName(k)));

  if (!(base in existingPresets) && !usedSlugs.has(slugifyName(base))) {
    return base;
  }

  let n = 2;
  while (true) {
    const candidate = `${base}-${n}`;
    if (!(candidate in existingPresets) && !usedSlugs.has(slugifyName(candidate))) {
      return candidate;
    }
    n += 1;
  }
}

/**
 * Load all saved presets from localStorage.
 * @returns {Record<string, object>}
 */
export function loadSavedPresets() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

/**
 * Sync presets from the local Node backend (presets/*.preset.json) into localStorage.
 * Returns { diskAvailable: boolean, presets: Record<string, object> }.
 */
export async function syncPresetsFromDisk() {
  const local = loadSavedPresets();
  try {
    const res = await fetch('/api/presets', { cache: 'no-store' });
    if (!res.ok) return { diskAvailable: false, presets: local };
    const data = await res.json();
    if (!data?.ok || !data.presets) return { diskAvailable: false, presets: local };

    const merged = { ...local, ...data.presets };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(merged));
    return { diskAvailable: true, presets: merged };
  } catch {
    return { diskAvailable: false, presets: local };
  }
}

/**
 * Save a preset in localStorage and (if available) on disk, auto-deduplicating
 * conflicting names and disk slugs.
 * @param {string} name
 * @param {object} preset
 */
export async function savePreset(name, preset) {
  const requested = name.trim();
  if (!requested) throw new Error('Preset name cannot be empty.');

  const all = loadSavedPresets();
  const key = resolveUniquePresetName(requested, all);
  const record = {
    ...preset,
    name: key,
    slug: slugifyName(key),
    updatedAt: new Date().toISOString(),
  };

  all[key] = record;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(all));

  try {
    const res = await fetch('/api/presets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(record),
    });
    if (res.ok) {
      const data = await res.json();
      return { preset: record, diskFile: data.file || null, renamed: key !== requested };
    }
  } catch {
    // Static mode fallback: localStorage only
  }
  return { preset: record, diskFile: null, renamed: key !== requested };
}

/**
 * Delete a named preset from localStorage and (if available) from disk.
 * @param {string} name
 */
export async function deletePreset(name) {
  const all = loadSavedPresets();
  delete all[name];
  localStorage.setItem(STORAGE_KEY, JSON.stringify(all));

  try {
    await fetch(`/api/presets/${encodeURIComponent(name)}`, { method: 'DELETE' });
  } catch {
    // Static mode fallback
  }
}

/**
 * Write an exported shader file to exports/ on disk if backend is running,
 * otherwise trigger a browser download.
 */
export async function saveExportToDiskOrDownload(filename, content, mimeType = 'application/javascript') {
  try {
    const res = await fetch('/api/exports', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filename, content }),
    });
    if (res.ok) {
      const data = await res.json();
      if (data?.ok && data.file) {
        return { diskFile: data.file };
      }
    }
  } catch {
    // Static mode fallback
  }

  downloadTextFile(filename, content, mimeType);
  return { diskFile: null };
}

/**
 * Trigger a browser file download.
 */
export function downloadTextFile(filename, content, mimeType = 'application/json') {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
