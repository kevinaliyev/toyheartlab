const SHADER_MODULES = {
  watercolor: { path: '../shaders/watercolor.js', exportName: 'watercolorStudy', file: 'watercolor.js' },
  charcoal: { path: '../shaders/charcoal.js', exportName: 'charcoalStudy', file: 'charcoal.js' },
  ferrofluid: { path: '../shaders/ferrofluid.js', exportName: 'ferrofluidStudy', file: 'ferrofluid.js' },
  'fluid-advect': { path: '../shaders/fluid-advect.js', exportName: 'fluidAdvectStudy', file: 'fluid-advect.js' },
  'zebra-runway': { path: '../shaders/zebra-runway.js', exportName: 'zebraRunwayStudy', file: 'zebra-runway.js' },
  'fractal-prng': { path: '../shaders/fractal-prng.js', exportName: 'fractalPrngStudy', file: 'fractal-prng.js' },
  'noise-signal': { path: '../shaders/noise-signal.js', exportName: 'noiseSignalStudy', file: 'noise-signal.js' },
  'bubble-screen': { path: '../shaders/bubble-screen.js', exportName: 'bubbleScreenStudy', file: 'bubble-screen.js' },
  underwater: { path: '../shaders/underwater.js', exportName: 'underwaterStudy', file: 'underwater.js' },
  'falling-objects': { path: '../shaders/falling-objects.js', exportName: 'fallingObjectsStudy', file: 'falling-objects.js' },
};

/**
 * Dynamically re-import a shader study module with a cache-busting query param
 * so edits on disk take effect without a browser refresh.
 */
export async function reloadShaderModule(studyId) {
  const entry = SHADER_MODULES[studyId];
  if (!entry) return null;
  const mod = await import(`${entry.path}?t=${Date.now()}`);
  return mod[entry.exportName] || null;
}

/**
 * Subscribe to server-sent file change events for `src/shaders/`.
 * Returns a cleanup function.
 */
export function connectShaderHotReload(onFileChanged) {
  if (typeof EventSource === 'undefined') return () => {};
  const es = new EventSource('/api/watch');
  es.onmessage = (e) => {
    try {
      const data = JSON.parse(e.data);
      if (data?.file) {
        onFileChanged?.(data.file, SHADER_MODULES);
      }
    } catch {
      // Ignore malformed watch payloads
    }
  };
  return () => es.close();
}
