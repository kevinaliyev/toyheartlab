import { GLEngine } from './gl-engine.js';
import { PALETTES, GRADIENTS } from './palettes.js';
import {
  loadSavedPresets,
  syncPresetsFromDisk,
  savePreset,
  deletePreset,
  saveExportToDiskOrDownload,
  downloadTextFile,
} from './preset-store.js';
import { buildShaderObject, serializeShaderModule } from './shader-exporter.js';
import { watercolorStudy } from './shaders/watercolor.js';
import { zebraRunwayStudy } from './shaders/zebra-runway.js';
import { fractalPrngStudy } from './shaders/fractal-prng.js';
import { fluidAdvectStudy } from './shaders/fluid-advect.js';

const STUDIES = [watercolorStudy, zebraRunwayStudy, fractalPrngStudy, fluidAdvectStudy];

const canvas = document.getElementById('gl-canvas');
const hud = document.getElementById('hud');
const toggleHudBtn = document.getElementById('toggle-hud');
const studySelect = document.getElementById('study-select');
const paletteGroup = document.getElementById('palette-group');
const paletteSelect = document.getElementById('palette-select');
const gradientGroup = document.getElementById('gradient-group');
const gradientSelect = document.getElementById('gradient-select');
const perfSelect = document.getElementById('perf-select');
const paramsContainer = document.getElementById('params-container');
const pauseBtn = document.getElementById('pause-btn');
const reseedBtn = document.getElementById('reseed-btn');
const studyDesc = document.getElementById('study-desc');
const presetNameInput = document.getElementById('preset-name');
const savePresetBtn = document.getElementById('save-preset-btn');
const presetSelect = document.getElementById('preset-select');
const loadPresetBtn = document.getElementById('load-preset-btn');
const delPresetBtn = document.getElementById('del-preset-btn');
const downloadPresetBtn = document.getElementById('download-preset-btn');
const importPresetBtn = document.getElementById('import-preset-btn');
const importPresetFile = document.getElementById('import-preset-file');
const exportShaderBtn = document.getElementById('export-shader-btn');
const copyShaderBtn = document.getElementById('copy-shader-btn');
const builderStatus = document.getElementById('builder-status');

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

function renderPigmentPickers(container) {
  container.innerHTML = '';
  const scale = activeStudy.pigmentScale;
  if (!scale) return;

  const count = Math.round(activeParams[scale.countParam] ?? 1);
  const title = document.createElement('div');
  title.className = 'pigment-title';
  title.textContent = `Brush Pigments (${count})`;
  container.appendChild(title);

  const grid = document.createElement('div');
  grid.className = 'pigment-grid';

  for (let i = 0; i < count; i++) {
    const def = scale.defaults[i] || { label: `Brush ${i + 1}`, hex: '#333333' };
    if (!pigmentHexes[i]) pigmentHexes[i] = def.hex;

    const item = document.createElement('label');
    item.className = 'pigment-item';
    item.title = def.label;

    const swatch = document.createElement('input');
    swatch.type = 'color';
    swatch.value = pigmentHexes[i];
    engine.setUniform(`${scale.uniformPrefix}${i}`, scale.toUniform(swatch.value));

    swatch.addEventListener('input', () => {
      pigmentHexes[i] = swatch.value;
      engine.setUniform(`${scale.uniformPrefix}${i}`, scale.toUniform(swatch.value));
    });

    const num = document.createElement('span');
    num.textContent = `${i + 1}`;

    item.append(swatch, num);
    grid.appendChild(item);
  }

  container.appendChild(grid);
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
  const pigmentContainer = document.createElement('div');
  pigmentContainer.className = 'pigment-container';

  for (const param of activeStudy.params) {
    const isToggle = param.type === 'toggle';
    const isSelect = param.type === 'select';
    const rawVal = overrides?.params?.[param.key] ?? param.default;
    const initialVal = isToggle ? (rawVal ? 1 : 0) : rawVal;
    activeParams[param.key] = initialVal;
    engine.setUniform(param.key, initialVal);

    const row = document.createElement('label');
    row.className = isToggle ? 'param-row param-toggle-row' : 'param-row';

    if (isToggle) {
      const nameSpan = document.createElement('span');
      nameSpan.textContent = param.label;

      const input = document.createElement('input');
      input.type = 'checkbox';
      input.className = 'param-toggle';
      input.checked = Boolean(initialVal);

      input.addEventListener('change', () => {
        const val = input.checked ? 1 : 0;
        activeParams[param.key] = val;
        engine.setUniform(param.key, val);
      });

      row.append(nameSpan, input);
    } else if (isSelect) {
      const header = document.createElement('div');
      header.className = 'param-header';

      const nameSpan = document.createElement('span');
      nameSpan.textContent = param.label;
      header.appendChild(nameSpan);

      const select = document.createElement('select');
      for (const optDef of param.options) {
        const opt = document.createElement('option');
        opt.value = String(optDef.value);
        opt.textContent = optDef.label;
        if (optDef.value === initialVal) opt.selected = true;
        select.appendChild(opt);
      }

      select.addEventListener('change', () => {
        const val = parseFloat(select.value);
        activeParams[param.key] = val;
        engine.setUniform(param.key, val);
      });

      row.append(header, select);
    } else {
      const header = document.createElement('div');
      header.className = 'param-header';

      const nameSpan = document.createElement('span');
      nameSpan.textContent = param.label;

      const valSpan = document.createElement('span');
      valSpan.className = 'param-val';
      valSpan.textContent =
        param.step >= 1 ? String(initialVal) : Number(initialVal).toFixed(2);

      header.append(nameSpan, valSpan);

      const input = document.createElement('input');
      input.type = 'range';
      input.min = param.min;
      input.max = param.max;
      input.step = param.step;
      input.value = initialVal;

      input.addEventListener('input', () => {
        const val = parseFloat(input.value);
        activeParams[param.key] = val;
        valSpan.textContent = param.step >= 1 ? String(val) : val.toFixed(2);
        engine.setUniform(param.key, val);

        if (activeStudy.pigmentScale && param.key === activeStudy.pigmentScale.countParam) {
          renderPigmentPickers(pigmentContainer);
        }
      });

      row.append(header, input);
    }

    paramsContainer.appendChild(row);
  }

  if (activeStudy.pigmentScale) {
    pigmentHexes =
      Array.isArray(overrides?.pigments) && overrides.pigments.length > 0
        ? [...overrides.pigments]
        : activeStudy.pigmentScale.defaults.map((d) => d.hex);
    paramsContainer.appendChild(pigmentContainer);
    renderPigmentPickers(pigmentContainer);
  }
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

const PERF_PRESETS = {
  eco: { scale: 0.5, fps: 24 },
  balanced: { scale: 0.75, fps: 30 },
  high: { scale: 1.0, fps: 60 },
};

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

toggleHudBtn.addEventListener('click', toggleHud);
window.addEventListener('keydown', (e) => {
  if (e.target?.tagName === 'INPUT' && e.target?.type === 'text') return;
  if (e.key === 'h' || e.key === 'H') {
    toggleHud();
  }
});

window.addEventListener('resize', () => engine.resize());

refreshPresetDropdown();
syncPresetsFromDisk().then(({ diskAvailable }) => {
  refreshPresetDropdown();
  if (diskAvailable) setStatus('Disk sync active (presets/ & exports/)');
});
loadStudy(activeStudy.id);
engine.setPaused(true);
pauseBtn.textContent = 'Play';
engine.start();
