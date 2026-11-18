import { GLEngine } from '../gl-engine.js';
import { PALETTES, GRADIENTS } from '../palettes.js';
import {
  loadSavedPresets,
  syncPresetsFromDisk,
  savePreset,
  deletePreset,
  saveExportToDiskOrDownload,
  downloadTextFile,
} from '../preset-store.js';
import { buildShaderObject, serializeShaderModule } from '../shader-exporter.js';
import { watercolorStudy } from '../shaders/watercolor.js';
import { zebraRunwayStudy } from '../shaders/zebra-runway.js';
import { fractalPrngStudy } from '../shaders/fractal-prng.js';
import { fluidAdvectStudy } from '../shaders/fluid-advect.js';
import { ferrofluidStudy } from '../shaders/ferrofluid.js';
import { renderParamControls } from '../core/gui-builder.js';

const STUDIES = [
  watercolorStudy,
  ferrofluidStudy,
  fluidAdvectStudy,
  zebraRunwayStudy,
  fractalPrngStudy,
];

const PERF_PRESETS = {
  eco: { scale: 0.5, fps: 24 },
  balanced: { scale: 0.75, fps: 30 },
  high: { scale: 1.0, fps: 60 },
};

export function mount(root) {
  root.innerHTML = `
    <canvas id="gl-canvas"></canvas>

    <aside id="hud" class="hud">
      <div class="hud-bar">
        <div class="hud-nav">
          <a href="#toybox" class="hud-back" title="Return to Toybox">← Toybox</a>
          <span class="hud-title">Lab</span>
        </div>
        <button id="toggle-hud" type="button">Hide (H)</button>
      </div>

      <div class="hud-body">
        <div class="actions hud-transport">
          <button id="pause-btn" type="button">Pause</button>
          <button id="reseed-btn" type="button">Re-seed</button>
        </div>

        <div class="hud-shared-block">
          <div class="control-group">
            <label for="study-select">Shader</label>
            <select id="study-select"></select>
          </div>

          <p id="study-desc" class="study-desc"></p>

          <div id="palette-group" class="control-group">
            <label for="palette-select">Base / Tritone</label>
            <select id="palette-select"></select>
          </div>

          <div id="gradient-group" class="control-group" hidden>
            <label for="gradient-select">Colour Gradient</label>
            <select id="gradient-select"></select>
          </div>

          <div class="control-group">
            <label for="perf-select">GPU Load / FPS</label>
            <select id="perf-select">
              <option value="eco">Eco (0.5x · 24 fps)</option>
              <option value="balanced" selected>Balanced (0.75x · 30 fps)</option>
              <option value="high">High (1.0x · 60 fps)</option>
            </select>
          </div>
        </div>

        <div id="params-container" class="params-container"></div>

        <details class="builder-details">
          <summary>Presets &amp; Export</summary>
          <div class="builder-section">
            <div class="builder-row">
              <input id="preset-name" type="text" placeholder="Preset name..." />
              <button id="save-preset-btn" type="button">Save</button>
            </div>
            <div class="builder-row">
              <select id="preset-select">
                <option value="">-- Saved presets --</option>
              </select>
              <button id="load-preset-btn" type="button">Load</button>
              <button id="del-preset-btn" type="button">Del</button>
            </div>
            <div class="actions">
              <button id="download-preset-btn" type="button">Save .json</button>
              <button id="import-preset-btn" type="button">Load .json</button>
              <input id="import-preset-file" type="file" accept=".json" hidden />
            </div>
          </div>

          <div class="builder-section">
            <div class="builder-title">Export Shader Object</div>
            <div class="actions">
              <button id="export-shader-btn" type="button">Export .js</button>
              <button id="copy-shader-btn" type="button">Copy JSON</button>
            </div>
            <div id="builder-status" class="builder-status"></div>
          </div>
        </details>
      </div>
    </aside>
  `;

  const canvas = root.querySelector('#gl-canvas');
  const hud = root.querySelector('#hud');
  const toggleHudBtn = root.querySelector('#toggle-hud');
  const studySelect = root.querySelector('#study-select');
  const paletteGroup = root.querySelector('#palette-group');
  const paletteSelect = root.querySelector('#palette-select');
  const gradientGroup = root.querySelector('#gradient-group');
  const gradientSelect = root.querySelector('#gradient-select');
  const perfSelect = root.querySelector('#perf-select');
  const paramsContainer = root.querySelector('#params-container');
  const pauseBtn = root.querySelector('#pause-btn');
  const reseedBtn = root.querySelector('#reseed-btn');
  const studyDesc = root.querySelector('#study-desc');
  const presetNameInput = root.querySelector('#preset-name');
  const savePresetBtn = root.querySelector('#save-preset-btn');
  const presetSelect = root.querySelector('#preset-select');
  const loadPresetBtn = root.querySelector('#load-preset-btn');
  const delPresetBtn = root.querySelector('#del-preset-btn');
  const downloadPresetBtn = root.querySelector('#download-preset-btn');
  const importPresetBtn = root.querySelector('#import-preset-btn');
  const importPresetFile = root.querySelector('#import-preset-file');
  const exportShaderBtn = root.querySelector('#export-shader-btn');
  const copyShaderBtn = root.querySelector('#copy-shader-btn');
  const builderStatus = root.querySelector('#builder-status');

  function setStatus(msg) {
    builderStatus.textContent = msg;
  }

  const engine = new GLEngine(canvas);
  let activeStudy = STUDIES[0];
  let activeParams = {};
  let pigmentHexes = [];
  let seed = Math.random() * 100;

  function applyPalette(paletteKey) {
    const pal = PALETTES[paletteKey] || PALETTES.archival;
    engine.setUniform('u_colorDark', pal.dark);
    engine.setUniform('u_colorMid', pal.mid);
    engine.setUniform('u_colorLight', pal.light);
  }

  function applyGradient(gradientKey) {
    const grad = GRADIENTS[gradientKey] || GRADIENTS.seeded;
    engine.setUniform('u_useGradient', grad.useSeed ? 0.0 : 1.0);
    engine.setUniform('u_gradA', grad.a);
    engine.setUniform('u_gradB', grad.b);
    engine.setUniform('u_gradC', grad.c);
    engine.setUniform('u_gradD', grad.d);
  }

  function loadStudy(studyId, overrides = null) {
    const found = STUDIES.find((s) => s.id === studyId);
    if (!found) return;
    activeStudy = found;
    activeParams = {};
    studySelect.value = found.id;
    studyDesc.textContent = activeStudy.description;
    paletteGroup.hidden = activeStudy.usesTritone === false;
    gradientGroup.hidden = !activeStudy.usesGradient;

    if (overrides?.seed !== undefined) seed = overrides.seed;
    if (overrides?.palette && PALETTES[overrides.palette]) paletteSelect.value = overrides.palette;
    if (overrides?.gradient && GRADIENTS[overrides.gradient]) gradientSelect.value = overrides.gradient;
    if (overrides?.perf && PERF_PRESETS[overrides.perf]) {
      perfSelect.value = overrides.perf;
      const preset = PERF_PRESETS[overrides.perf];
      engine.setRenderScale(preset.scale);
      engine.setMaxFps(preset.fps);
    }

    if (activeStudy.mode === 'pingpong') {
      engine.loadPingPongShaders(activeStudy.simShader, activeStudy.displayShader);
      engine.resetSimulation();
    } else {
      engine.loadFragmentShader(activeStudy.fragmentShader);
    }

    engine.setUniform('u_seed', seed);
    applyPalette(paletteSelect.value);
    applyGradient(gradientSelect.value);

    if (activeStudy.onFrame) {
      engine.setFrameHook((elapsed) => {
        activeStudy.onFrame(engine, elapsed, activeParams, seed);
      });
    } else {
      engine.setFrameHook(null);
    }

    paramsContainer.innerHTML = '';
    for (const param of activeStudy.params) {
      const isToggle = param.type === 'toggle';
      const rawVal = overrides?.params?.[param.key] ?? param.default;
      const initialVal = isToggle ? (rawVal ? 1 : 0) : rawVal;
      activeParams[param.key] = initialVal;
      engine.setUniform(param.key, initialVal);
    }

    if (activeStudy.pigmentScale) {
      pigmentHexes =
        Array.isArray(overrides?.pigments) && overrides.pigments.length > 0
          ? [...overrides.pigments]
          : activeStudy.pigmentScale.defaults.map((d) => d.hex);
    }

    renderParamControls({
      container: paramsContainer,
      params: activeStudy.params,
      values: activeParams,
      onChange: (key, val) => {
        engine.setUniform(key, val);
      },
      pigmentScale: activeStudy.pigmentScale || null,
      pigmentHexes,
      onPigmentChange: (idx, _hex, uniformVal) => {
        engine.setUniform(`${activeStudy.pigmentScale.uniformPrefix}${idx}`, uniformVal);
      },
    });
  }

  for (const study of STUDIES) {
    const opt = document.createElement('option');
    opt.value = study.id;
    opt.textContent = study.name;
    studySelect.appendChild(opt);
  }

  for (const pal of Object.values(PALETTES)) {
    const opt = document.createElement('option');
    opt.value = pal.id;
    opt.textContent = pal.label;
    paletteSelect.appendChild(opt);
  }

  for (const grad of Object.values(GRADIENTS)) {
    const opt = document.createElement('option');
    opt.value = grad.id;
    opt.textContent = grad.label;
    gradientSelect.appendChild(opt);
  }

  studySelect.addEventListener('change', () => loadStudy(studySelect.value));
  paletteSelect.addEventListener('change', () => applyPalette(paletteSelect.value));
  gradientSelect.addEventListener('change', () => applyGradient(gradientSelect.value));

  perfSelect.addEventListener('change', () => {
    const preset = PERF_PRESETS[perfSelect.value] || PERF_PRESETS.balanced;
    engine.setRenderScale(preset.scale);
    engine.setMaxFps(preset.fps);
  });

  pauseBtn.addEventListener('click', () => {
    const nextPaused = !engine.paused;
    engine.setPaused(nextPaused);
    pauseBtn.textContent = nextPaused ? 'Play' : 'Pause';
  });

  reseedBtn.addEventListener('click', () => {
    seed = Math.random() * 100;
    engine.setUniform('u_seed', seed);
    engine.resetSimulation();
  });

  function getCurrentSnapshot(name) {
    return {
      name: name || `${activeStudy.id}-preset`,
      studyId: activeStudy.id,
      palette: paletteSelect.value,
      gradient: gradientSelect.value,
      perf: perfSelect.value,
      seed,
      params: { ...activeParams },
      pigments: activeStudy.pigmentScale ? [...pigmentHexes] : [],
    };
  }

  function refreshPresetDropdown(selectedName = '') {
    const presets = loadSavedPresets();
    presetSelect.innerHTML = '<option value="">-- Saved presets --</option>';
    for (const key of Object.keys(presets).sort()) {
      const opt = document.createElement('option');
      opt.value = key;
      opt.textContent = `${key} (${presets[key].studyId})`;
      if (key === selectedName) opt.selected = true;
      presetSelect.appendChild(opt);
    }
  }

  savePresetBtn.addEventListener('click', async () => {
    const name = presetNameInput.value.trim() || `${activeStudy.id}-${Date.now().toString(36)}`;
    const { preset, diskFile, renamed } = await savePreset(name, getCurrentSnapshot(name));
    presetNameInput.value = preset.name;
    refreshPresetDropdown(preset.name);
    const suffix = renamed ? ' (deduplicated)' : '';
    setStatus(diskFile ? `Saved ${diskFile}${suffix}` : `Saved "${preset.name}"${suffix}`);
  });

  loadPresetBtn.addEventListener('click', () => {
    const key = presetSelect.value;
    if (!key) return;
    const preset = loadSavedPresets()[key];
    if (!preset) return;
    presetNameInput.value = key;
    loadStudy(preset.studyId, preset);
    setStatus(`Loaded "${key}"`);
  });

  delPresetBtn.addEventListener('click', async () => {
    const key = presetSelect.value;
    if (!key) return;
    await deletePreset(key);
    refreshPresetDropdown();
    setStatus(`Deleted "${key}"`);
  });

  downloadPresetBtn.addEventListener('click', () => {
    const name = presetNameInput.value.trim() || `${activeStudy.id}-preset`;
    const snap = getCurrentSnapshot(name);
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'preset';
    downloadTextFile(`${slug}.preset.json`, JSON.stringify(snap, null, 2), 'application/json');
    setStatus(`Downloaded ${slug}.preset.json`);
  });

  importPresetBtn.addEventListener('click', () => importPresetFile.click());

  importPresetFile.addEventListener('change', async () => {
    const file = importPresetFile.files?.[0];
    if (!file) return;
    try {
      const parsed = JSON.parse(await file.text());
      if (!parsed?.studyId) throw new Error('Missing studyId');
      const rawName = parsed.name || file.name.replace(/\.preset\.json$|\.json$/i, '');
      const { preset } = await savePreset(rawName, parsed);
      presetNameInput.value = preset.name;
      refreshPresetDropdown(preset.name);
      loadStudy(parsed.studyId, parsed);
      setStatus(`Loaded file "${preset.name}"`);
    } catch (err) {
      setStatus(`Import failed: ${err.message}`);
    } finally {
      importPresetFile.value = '';
    }
  });

  function buildCurrentShaderExport() {
    const name = presetNameInput.value.trim() || `${activeStudy.id}-shader`;
    const pigmentUniforms = {};
    if (activeStudy.pigmentScale) {
      for (let i = 0; i < 6; i++) {
        const hex = pigmentHexes[i] || activeStudy.pigmentScale.defaults[i]?.hex || '#333333';
        pigmentUniforms[`${activeStudy.pigmentScale.uniformPrefix}${i}`] =
          activeStudy.pigmentScale.toUniform(hex);
      }
    }
    return buildShaderObject({
      name,
      study: activeStudy,
      params: activeParams,
      palette: PALETTES[paletteSelect.value] || PALETTES.archival,
      gradient: GRADIENTS[gradientSelect.value] || GRADIENTS.seeded,
      seed,
      perf: PERF_PRESETS[perfSelect.value] || PERF_PRESETS.balanced,
      pigmentUniforms,
    });
  }

  exportShaderBtn.addEventListener('click', async () => {
    const obj = buildCurrentShaderExport();
    const slug = obj.id.split(':').pop() || 'shader';
    const { diskFile } = await saveExportToDiskOrDownload(
      `${slug}.shader.js`,
      serializeShaderModule(obj),
      'application/javascript'
    );
    setStatus(diskFile ? `Exported ${diskFile}` : `Downloaded ${slug}.shader.js`);
  });

  copyShaderBtn.addEventListener('click', async () => {
    const obj = buildCurrentShaderExport();
    try {
      await navigator.clipboard.writeText(JSON.stringify(obj));
      setStatus('Copied Shader Object JSON');
    } catch {
      setStatus('Clipboard blocked — use Export .js');
    }
  });

  function toggleHud() {
    const collapsed = hud.classList.toggle('collapsed');
    toggleHudBtn.textContent = collapsed ? 'Show GUI (H)' : 'Hide (H)';
  }

  const onKeyDown = (e) => {
    if (e.target?.tagName === 'INPUT' && e.target?.type === 'text') return;
    if (e.key === 'h' || e.key === 'H') toggleHud();
  };
  const onResize = () => engine.resize();

  toggleHudBtn.addEventListener('click', toggleHud);
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('resize', onResize);

  refreshPresetDropdown();
  syncPresetsFromDisk().then(({ diskAvailable }) => {
    refreshPresetDropdown();
    if (diskAvailable) setStatus('Disk sync active (presets/ & exports/)');
  });

  loadStudy(activeStudy.id);
  engine.setPaused(false);
  pauseBtn.textContent = 'Pause';
  engine.start();

  return {
    destroy() {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('resize', onResize);
      engine.destroy();
      root.innerHTML = '';
    },
  };
}
