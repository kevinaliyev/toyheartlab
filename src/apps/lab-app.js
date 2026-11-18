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
import { createLoadingOverlay } from '../core/loading-bar.js';
import { PathStudio } from '../core/path-studio.js';

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
  ultra: { scale: 1.0, fps: 120 },
};

export function mount(root) {
  root.innerHTML = `
    <canvas id="gl-canvas"></canvas>
    <canvas id="path-canvas" class="path-overlay-canvas" hidden></canvas>

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
              <option value="balanced">Balanced (0.75x · 30 fps)</option>
              <option value="high" selected>High (1.0x · 60 fps)</option>
              <option value="ultra">Ultra Exp (1.0x · 120 fps)</option>
            </select>
          </div>
        </div>

        <div id="params-container" class="params-container"></div>

        <details class="builder-details">
          <summary>Custom Emitter Paths</summary>
          <div class="builder-section">
            <label class="param-row param-toggle-row">
              <span>Draw Paths on Canvas</span>
              <input id="toggle-path-draw" type="checkbox" class="param-toggle" />
            </label>
            <div class="param-row">
              <div class="param-header"><span>Pen Assist Tool</span></div>
              <select id="path-tool-select">
                <option value="smart" selected>Smart Smooth (RDP + Spline)</option>
                <option value="magnetic">Magnetic Snap (Edges &amp; Symmetry)</option>
              </select>
            </div>
            <div class="builder-row">
              <input id="path-trace-text" type="text" placeholder="Trace word (e.g. toyheart)..." value="toyheart" />
              <button id="path-trace-btn" type="button">Trace</button>
            </div>
            <div class="actions" style="border-top:none; padding-top:0;">
              <button id="path-heart-btn" type="button">♥ Heart</button>
              <button id="path-spiral-btn" type="button">◎ Spiral</button>
            </div>
            <div class="actions" style="border-top:none; padding-top:0;">
              <button id="path-inf-btn" type="button">∞ Loop</button>
              <button id="path-clear-btn" type="button">Clear Paths</button>
            </div>
            <div id="path-status" class="builder-status">Using built-in study paths (0 custom)</div>
          </div>
        </details>

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
  const pathCanvas = root.querySelector('#path-canvas');
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
  const togglePathDraw = root.querySelector('#toggle-path-draw');
  const pathToolSelect = root.querySelector('#path-tool-select');
  const pathTraceText = root.querySelector('#path-trace-text');
  const pathTraceBtn = root.querySelector('#path-trace-btn');
  const pathHeartBtn = root.querySelector('#path-heart-btn');
  const pathSpiralBtn = root.querySelector('#path-spiral-btn');
  const pathInfBtn = root.querySelector('#path-inf-btn');
  const pathClearBtn = root.querySelector('#path-clear-btn');
  const pathStatus = root.querySelector('#path-status');
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
  const loader = createLoadingOverlay(root);
  const pathStudio = new PathStudio(pathCanvas, (strokes) => {
    pathStatus.textContent =
      strokes.length > 0
        ? `Custom keyframed paths active (${strokes.length} stroke${strokes.length > 1 ? 's' : ''})`
        : 'Using built-in study paths (0 custom)';
    if (activeStudy.id === 'watercolor' && strokes.length > 0) {
      engine.resetSimulation();
    }
  });
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

  function bindFrameHooks() {
    engine.setFrameHook((elapsed) => {
      if (pathStudio.strokes.length > 0) {
        const aspect = canvas.width / Math.max(canvas.height, 1);
        if (activeStudy.id === 'watercolor') {
          const speed = activeParams.u_speed ?? 0.65;
          const t = elapsed * speed;
          const dt = 0.02 * Math.max(speed, 0.15);
          const count = Math.min(6, pathStudio.strokes.length);
          for (let i = 0; i < 6; i++) {
            if (i < count) {
              const s = pathStudio.sampleBrushAt(t, i, dt, aspect, true);
              engine.setUniform(`u_brushPos${i}`, s.pos);
              engine.setUniform(`u_brushPrev${i}`, s.prev);
              engine.setUniform(`u_brushLift${i}`, s.lift);
            } else {
              engine.setUniform(`u_brushLift${i}`, 0.0);
            }
          }
          return;
        }
        // Drive any object-aware shader (e.g. fluid-advect) along custom paths
        const objs = pathStudio.strokes.map((_s, idx) => {
          const sample = pathStudio.sampleBrushAt(elapsed, idx, 0.02, aspect, false);
          return {
            x: sample.pos[0],
            y: sample.pos[1],
            vx: (sample.pos[0] - sample.prev[0]) * 30.0,
            vy: (sample.pos[1] - sample.prev[1]) * 30.0,
            radius: 0.06,
            charge: sample.lift > 0.05 ? 1.25 : 0.0,
          };
        });
        engine.setObjects(objs);
        return;
      }

      if (activeStudy.onFrame) {
        activeStudy.onFrame(engine, elapsed, activeParams, seed);
      }
    });
  }

  async function loadStudy(studyId, overrides = null) {
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

    loader.show(`Loading ${found.name}...`, 15);
    const onProg = (pct, msg) => loader.setProgress(pct, msg);

    let committed = false;
    try {
      if (activeStudy.mode === 'pingpong') {
        committed = await engine.loadPingPongShadersAsync(activeStudy.simShader, activeStudy.displayShader, onProg);
        if (committed) engine.resetSimulation();
      } else {
        committed = await engine.loadFragmentShaderAsync(activeStudy.fragmentShader, onProg);
      }
    } finally {
      loader.hide();
    }
    if (!committed) return;

    engine.setUniform('u_seed', seed);
    applyPalette(paletteSelect.value);
    applyGradient(gradientSelect.value);
    bindFrameHooks();

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

  togglePathDraw.addEventListener('change', () => {
    pathStudio.setEnabled(togglePathDraw.checked);
  });
  pathToolSelect.addEventListener('change', () => {
    pathStudio.tool = pathToolSelect.value;
    pathStudio.render();
  });
  pathTraceBtn.addEventListener('click', () => {
    pathStudio.traceText(pathTraceText.value);
    if (!togglePathDraw.checked) {
      togglePathDraw.checked = true;
      pathStudio.setEnabled(true);
    }
  });
  pathHeartBtn.addEventListener('click', () => pathStudio.loadPresetShape('heart'));
  pathSpiralBtn.addEventListener('click', () => pathStudio.loadPresetShape('spiral'));
  pathInfBtn.addEventListener('click', () => pathStudio.loadPresetShape('infinity'));
  pathClearBtn.addEventListener('click', () => {
    pathStudio.clear();
    engine.setObjects([]);
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
  const onResize = () => {
    engine.resize();
    pathStudio.resize();
    pathStudio.render();
  };

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
      loader.destroy();
      engine.destroy();
      root.innerHTML = '';
    },
  };
}
