import { GLEngine } from '../gl-engine.js';
import { PALETTES, GRADIENTS } from '../palettes.js';
import { Stage2D } from '../core/stage-2d.js';
import { renderParamControls } from '../core/gui-builder.js';
import { MagnetNode } from '../objects/magnet-node.js';
import { ferrofluidStudy } from '../shaders/ferrofluid.js';
import { fluidAdvectStudy } from '../shaders/fluid-advect.js';

const SANDBOX_STUDIES = [ferrofluidStudy, fluidAdvectStudy];

const PERF_PRESETS = {
  eco: { scale: 0.5, fps: 24 },
  balanced: { scale: 0.75, fps: 30 },
  high: { scale: 1.0, fps: 60 },
};

export function mount(root) {
  root.innerHTML = `
    <div class="stage-stack">
      <canvas id="gl-canvas"></canvas>
      <canvas id="sim-canvas"></canvas>
    </div>

    <aside id="hud" class="hud">
      <div class="hud-bar">
        <div class="hud-nav">
          <a href="#toybox" class="hud-back" title="Return to Toybox">← Toybox</a>
          <span class="hud-title">Sandbox</span>
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

          <div id="palette-group" class="control-group" hidden>
            <label for="palette-select">Base / Tritone</label>
            <select id="palette-select"></select>
          </div>

          <div id="gradient-group" class="control-group">
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

        <details class="builder-details" open>
          <summary>2D Objects &amp; Fields</summary>
          <div class="builder-section">
            <div class="actions">
              <button id="spawn-attract-btn" type="button">+ Attract Pole</button>
              <button id="spawn-repel-btn" type="button">− Repel Pole</button>
            </div>
            <div class="actions" style="border-top:none; padding-top:0;">
              <button id="spawn-orbit-btn" type="button">⟳ Orbit Pair</button>
              <button id="clear-objs-btn" type="button">Clear All</button>
            </div>

            <label class="param-row param-toggle-row">
              <span>Show 2D Object Gizmos</span>
              <input id="toggle-gizmos" type="checkbox" class="param-toggle" checked />
            </label>
            <label class="param-row param-toggle-row">
              <span>Live Cursor Field</span>
              <input id="toggle-cursor-field" type="checkbox" class="param-toggle" checked />
            </label>

            <div id="selected-obj-panel" class="selected-obj-panel" hidden>
              <div class="builder-header-row">
                <span id="selected-obj-title" class="builder-title">Selected Object</span>
                <button id="delete-obj-btn" type="button" class="btn-small">Remove</button>
              </div>

              <div class="param-row">
                <div class="param-header">
                  <span>Motion Mode</span>
                </div>
                <select id="obj-mode-select">
                  <option value="manual">Manual Drag / Throw</option>
                  <option value="orbit">Autonomous Orbit</option>
                  <option value="pulse">Harmonic Pulse</option>
                </select>
              </div>

              <div class="param-row">
                <div class="param-header">
                  <span>Field Charge / Polarity</span>
                  <span id="obj-charge-val" class="param-val">1.20</span>
                </div>
                <input id="obj-charge-slider" type="range" min="-2.5" max="2.5" step="0.05" value="1.2" />
              </div>

              <div class="param-row">
                <div class="param-header">
                  <span>Field Radius</span>
                  <span id="obj-radius-val" class="param-val">0.07</span>
                </div>
                <input id="obj-radius-slider" type="range" min="0.025" max="0.18" step="0.005" value="0.065" />
              </div>
            </div>

            <div class="sandbox-hint">
              Drag poles on the canvas, throw them, or scroll over a pole to tune its magnetic charge.
            </div>
          </div>
        </details>

        <div id="params-container" class="params-container"></div>
      </div>
    </aside>
  `;

  const glCanvas = root.querySelector('#gl-canvas');
  const simCanvas = root.querySelector('#sim-canvas');
  const hud = root.querySelector('#hud');
  const toggleHudBtn = root.querySelector('#toggle-hud');
  const studySelect = root.querySelector('#study-select');
  const studyDesc = root.querySelector('#study-desc');
  const paletteGroup = root.querySelector('#palette-group');
  const paletteSelect = root.querySelector('#palette-select');
  const gradientGroup = root.querySelector('#gradient-group');
  const gradientSelect = root.querySelector('#gradient-select');
  const perfSelect = root.querySelector('#perf-select');
  const paramsContainer = root.querySelector('#params-container');
  const pauseBtn = root.querySelector('#pause-btn');
  const reseedBtn = root.querySelector('#reseed-btn');

  const spawnAttractBtn = root.querySelector('#spawn-attract-btn');
  const spawnRepelBtn = root.querySelector('#spawn-repel-btn');
  const spawnOrbitBtn = root.querySelector('#spawn-orbit-btn');
  const clearObjsBtn = root.querySelector('#clear-objs-btn');
  const toggleGizmosInput = root.querySelector('#toggle-gizmos');
  const toggleCursorFieldInput = root.querySelector('#toggle-cursor-field');

  const selectedObjPanel = root.querySelector('#selected-obj-panel');
  const selectedObjTitle = root.querySelector('#selected-obj-title');
  const deleteObjBtn = root.querySelector('#delete-obj-btn');
  const objModeSelect = root.querySelector('#obj-mode-select');
  const objChargeSlider = root.querySelector('#obj-charge-slider');
  const objChargeVal = root.querySelector('#obj-charge-val');
  const objRadiusSlider = root.querySelector('#obj-radius-slider');
  const objRadiusVal = root.querySelector('#obj-radius-val');

  const engine = new GLEngine(glCanvas);
  const stage = new Stage2D(simCanvas, engine);

  let activeStudy = SANDBOX_STUDIES[0];
  let activeParams = {};
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

  function updateSelectedInspector(obj) {
    if (!obj) {
      selectedObjPanel.hidden = true;
      return;
    }
    selectedObjPanel.hidden = false;
    selectedObjTitle.textContent = `${obj.name} (${obj.charge >= 0 ? 'North +' : 'South −'})`;
    objModeSelect.value = obj.mode || 'manual';
    objChargeSlider.value = obj.charge;
    objChargeVal.textContent = Number(obj.charge).toFixed(2);
    objRadiusSlider.value = obj.radius;
    objRadiusVal.textContent = Number(obj.radius).toFixed(3);
  }

  stage.onSelectionChange = (obj) => {
    updateSelectedInspector(obj);
  };

  function spawnStarterObjects() {
    stage.clearObjects();
    const northA = new MagnetNode({
      name: 'Pole Alpha',
      x: 0.42,
      y: 0.50,
      radius: 0.082,
      charge: 1.45,
      mode: 'orbit',
      orbitRadius: 0.13,
      orbitSpeed: 0.48,
      phase: 0.0,
    });
    const northB = new MagnetNode({
      name: 'Pole Beta',
      x: 0.62,
      y: 0.50,
      radius: 0.078,
      charge: 1.30,
      mode: 'manual',
    });
    stage.addObject(northA);
    stage.addObject(northB);
  }

  function loadStudy(studyId) {
    const found = SANDBOX_STUDIES.find((s) => s.id === studyId);
    if (!found) return;
    activeStudy = found;
    activeParams = {};
    studySelect.value = found.id;
    studyDesc.textContent = activeStudy.description;
    paletteGroup.hidden = activeStudy.usesTritone === false;
    gradientGroup.hidden = !activeStudy.usesGradient;

    if (activeStudy.mode === 'pingpong') {
      engine.loadPingPongShaders(activeStudy.simShader, activeStudy.displayShader);
      engine.resetSimulation();
    } else {
      engine.loadFragmentShader(activeStudy.fragmentShader);
    }

    engine.setUniform('u_seed', seed);
    applyPalette(paletteSelect.value);
    applyGradient(gradientSelect.value);

    for (const param of activeStudy.params) {
      let val = param.type === 'toggle' ? (param.default ? 1 : 0) : param.default;
      if (param.key === 'u_emitters' && stage.objects.length > 0) {
        val = 0;
      }
      activeParams[param.key] = val;
      engine.setUniform(param.key, val);
    }

    stage.viewMode = activeParams.u_viewMode ?? 0;

    renderParamControls({
      container: paramsContainer,
      params: activeStudy.params,
      values: activeParams,
      onChange: (key, val) => {
        engine.setUniform(key, val);
        if (key === 'u_viewMode') {
          stage.viewMode = val;
        }
      },
    });
  }

  for (const study of SANDBOX_STUDIES) {
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

  spawnAttractBtn.addEventListener('click', () => {
    const angle = Math.random() * Math.PI * 2;
    const r = 0.12 + Math.random() * 0.16;
    stage.addObject(
      new MagnetNode({
        name: `North #${stage.objects.length + 1}`,
        x: 0.5 + Math.cos(angle) * r,
        y: 0.5 + Math.sin(angle) * r,
        radius: 0.068,
        charge: 1.3,
        mode: 'manual',
      })
    );
  });

  spawnRepelBtn.addEventListener('click', () => {
    const angle = Math.random() * Math.PI * 2;
    const r = 0.12 + Math.random() * 0.16;
    stage.addObject(
      new MagnetNode({
        name: `South #${stage.objects.length + 1}`,
        x: 0.5 + Math.cos(angle) * r,
        y: 0.5 + Math.sin(angle) * r,
        radius: 0.068,
        charge: -1.25,
        mode: 'manual',
      })
    );
  });

  spawnOrbitBtn.addEventListener('click', () => {
    stage.addObject(
      new MagnetNode({
        name: `Orbiter +`,
        x: 0.5,
        y: 0.5,
        radius: 0.07,
        charge: 1.4,
        mode: 'orbit',
        orbitRadius: 0.22,
        orbitSpeed: 0.65,
        phase: 0,
      })
    );
    stage.addObject(
      new MagnetNode({
        name: `Orbiter −`,
        x: 0.5,
        y: 0.5,
        radius: 0.065,
        charge: -1.2,
        mode: 'orbit',
        orbitRadius: 0.22,
        orbitSpeed: 0.65,
        phase: Math.PI,
      })
    );
  });

  clearObjsBtn.addEventListener('click', () => stage.clearObjects());

  toggleGizmosInput.addEventListener('change', () => {
    stage.showGizmos = toggleGizmosInput.checked;
  });

  toggleCursorFieldInput.addEventListener('change', () => {
    stage.pointerFieldEnabled = toggleCursorFieldInput.checked;
  });

  deleteObjBtn.addEventListener('click', () => {
    if (stage.selectedObject) {
      stage.removeObject(stage.selectedObject);
    }
  });

  objModeSelect.addEventListener('change', () => {
    const obj = stage.selectedObject;
    if (!obj) return;
    obj.mode = objModeSelect.value;
    obj.anchorX = obj.x;
    obj.anchorY = obj.y;
  });

  objChargeSlider.addEventListener('input', () => {
    const obj = stage.selectedObject;
    if (!obj) return;
    const val = parseFloat(objChargeSlider.value);
    obj.setCharge ? obj.setCharge(val) : (obj.charge = val);
    objChargeVal.textContent = val.toFixed(2);
    selectedObjTitle.textContent = `${obj.name} (${obj.charge >= 0 ? 'North +' : 'South −'})`;
  });

  objRadiusSlider.addEventListener('input', () => {
    const obj = stage.selectedObject;
    if (!obj) return;
    const val = parseFloat(objRadiusSlider.value);
    obj.radius = val;
    objRadiusVal.textContent = val.toFixed(3);
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
    stage.resize();
  };

  toggleHudBtn.addEventListener('click', toggleHud);
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('resize', onResize);

  engine.setFrameHook((elapsed, dt) => {
    stage.stepAndRender(dt, elapsed);
  });

  spawnStarterObjects();
  loadStudy(activeStudy.id);
  engine.setPaused(false);
  engine.start();
  stage.stepAndRender(0.016, 0);

  return {
    destroy() {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('resize', onResize);
      engine.destroy();
      root.innerHTML = '';
    },
  };
}
