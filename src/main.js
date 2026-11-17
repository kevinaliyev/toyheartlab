import { GLEngine } from './gl-engine.js';
import { PALETTES, GRADIENTS } from './palettes.js';
import { watercolorStudy } from './shaders/watercolor.js';
import { zebraRunwayStudy } from './shaders/zebra-runway.js';
import { fractalPrngStudy } from './shaders/fractal-prng.js';

const STUDIES = [fractalPrngStudy, watercolorStudy, zebraRunwayStudy];

const canvas = document.getElementById('gl-canvas');
const hud = document.getElementById('hud');
const toggleHudBtn = document.getElementById('toggle-hud');
const studySelect = document.getElementById('study-select');
const paletteSelect = document.getElementById('palette-select');
const gradientSelect = document.getElementById('gradient-select');
const perfSelect = document.getElementById('perf-select');
const paramsContainer = document.getElementById('params-container');
const pauseBtn = document.getElementById('pause-btn');
const reseedBtn = document.getElementById('reseed-btn');
const studyDesc = document.getElementById('study-desc');

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

function loadStudy(studyId) {
  const found = STUDIES.find((s) => s.id === studyId);
  if (!found) return;
  activeStudy = found;
  activeParams = {};
  studyDesc.textContent = activeStudy.description;

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
    const initialVal = isToggle ? (param.default ? 1 : 0) : param.default;
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
      input.checked = Boolean(param.default);

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
        if (optDef.value === param.default) opt.selected = true;
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
        param.step >= 1 ? String(param.default) : Number(param.default).toFixed(2);

      header.append(nameSpan, valSpan);

      const input = document.createElement('input');
      input.type = 'range';
      input.min = param.min;
      input.max = param.max;
      input.step = param.step;
      input.value = param.default;

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
    pigmentHexes = activeStudy.pigmentScale.defaults.map((d) => d.hex);
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

function toggleHud() {
  const collapsed = hud.classList.toggle('collapsed');
  toggleHudBtn.textContent = collapsed ? 'Show GUI (H)' : 'Hide (H)';
}

toggleHudBtn.addEventListener('click', toggleHud);
window.addEventListener('keydown', (e) => {
  if (e.key === 'h' || e.key === 'H') {
    toggleHud();
  }
});

window.addEventListener('resize', () => engine.resize());

loadStudy(activeStudy.id);
engine.start();
