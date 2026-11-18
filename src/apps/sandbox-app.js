import { GLEngine } from '../gl-engine.js';
import { PALETTES, GRADIENTS } from '../palettes.js';
import { Stage2D } from '../core/stage-2d.js';
import { renderParamControls } from '../core/gui-builder.js';
import { MagnetNode } from '../objects/magnet-node.js';
import { ferrofluidStudy } from '../shaders/ferrofluid.js';
import { fluidAdvectStudy } from '../shaders/fluid-advect.js';
import { bubbleScreenStudy } from '../shaders/bubble-screen.js';
import { createLoadingOverlay } from '../core/loading-bar.js';
import { KeyframeAnimator } from '../core/keyframe-animator.js';
import { reloadShaderModule, connectShaderHotReload } from '../core/shader-hot-reload.js';
import { buildFiltersDeckHTML, wireFiltersDeck } from '../core/filter-controls.js';
import { initHudReorder } from '../core/hud-reorder.js';
import { getThumbnail, createThumbnailSession } from '../core/thumbnail-store.js';
import { populateStudySelect } from '../shaders/shader-params.js';

const SANDBOX_STUDIES = [ferrofluidStudy, fluidAdvectStudy, bubbleScreenStudy];

const PERF_PRESETS = {
  eco: { scale: 0.5, fps: 24 },
  balanced: { scale: 0.75, fps: 30 },
  high: { scale: 1.0, fps: 60 },
  ultra: { scale: 1.0, fps: 120 },
};

export function mount(root) {
  root.innerHTML = `
    <div class="stage-stack">
      <canvas id="gl-canvas"></canvas>
      <canvas id="sim-canvas"></canvas>
    </div>

    <div id="session-preview" class="session-preview" hidden>
      <div class="session-preview-card">
        <div class="session-thumb-wrap">
          <img id="session-thumb-img" class="session-thumb-img" alt="" hidden />
          <div id="session-thumb-empty" class="session-thumb-empty">Sandbox Ready</div>
        </div>
        <div class="session-preview-meta">
          <div id="session-preview-title" class="session-preview-title">Sandbox</div>
          <div id="session-preview-sub" class="session-preview-sub">Scene &amp; objects loaded — compile on play</div>
        </div>
        <button id="session-play-btn" type="button" class="btn-primary session-play-btn">▶ Compile &amp; Play</button>
      </div>
    </div>

    <aside id="hud" class="hud">
      <div class="hud-bar">
        <div class="hud-nav">
          <a href="#home" class="hud-back" title="Return to Home">← Home</a>
          <span class="hud-title">Sandbox</span>
        </div>
        <div class="hud-bar-actions">
          <button id="lock-hud" type="button" class="hud-lock-btn" title="Unlock to reorder tabs">🔒</button>
          <button id="toggle-hud" type="button">Hide (H)</button>
        </div>
      </div>

      <div class="hud-body">
        <div class="actions hud-transport" style="grid-template-columns: 1fr 1fr auto;">
          <button id="pause-btn" type="button">Pause</button>
          <button id="reseed-btn" type="button">Re-seed</button>
          <button id="hot-reload-btn" type="button" title="Hot-reload active shader (Shift+R)">↻</button>
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
              <option value="balanced">Balanced (0.75x · 30 fps)</option>
              <option value="high" selected>High (1.0x · 60 fps)</option>
              <option value="ultra">Ultra Exp (1.0x · 120 fps)</option>
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
                  <span>Height Above Dish (Z)</span>
                  <span id="obj-z-val" class="param-val">0.06</span>
                </div>
                <input id="obj-z-slider" type="range" min="0.01" max="0.32" step="0.005" value="0.065" />
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
              Left-drag magnet body (XY) or X/Y/Z arrows. Right-drag to orbit camera around dish. Scroll for charge (Shift+Scroll for Z).
            </div>
          </div>
        </details>

        <details class="builder-details">
          <summary>Object Keyframes</summary>
          <div class="builder-section">
            <div class="actions" style="border-top:none; padding-top:0;">
              <button id="kf-play-btn" type="button">▶ Play Timeline</button>
              <button id="kf-add-btn" type="button">+ Keyframe (K)</button>
            </div>
            <div class="param-row">
              <div class="param-header">
                <span>Playhead</span>
                <span id="kf-time-val" class="param-val">0.00s / 6.00s</span>
              </div>
              <input id="kf-scrubber" type="range" min="0" max="6" step="0.05" value="0" />
              <div id="kf-markers" class="kf-markers"></div>
            </div>
            <div class="actions" style="border-top:none; padding-top:0;">
              <button id="kf-del-btn" type="button">Del at Head</button>
              <button id="kf-clear-btn" type="button">Clear Track</button>
            </div>
            <div id="kf-status" class="sandbox-hint">Select a magnet, position it, and add keyframes at different times.</div>
          </div>
        </details>

        <div id="params-container" class="params-container"></div>

        ${buildFiltersDeckHTML()}
      </div>
    </aside>
  `;

  const glCanvas = root.querySelector('#gl-canvas');
  const simCanvas = root.querySelector('#sim-canvas');
  const sessionPreview = root.querySelector('#session-preview');
  const sessionThumbImg = root.querySelector('#session-thumb-img');
  const sessionThumbEmpty = root.querySelector('#session-thumb-empty');
  const sessionPreviewTitle = root.querySelector('#session-preview-title');
  const sessionPreviewSub = root.querySelector('#session-preview-sub');
  const sessionPlayBtn = root.querySelector('#session-play-btn');
  const hud = root.querySelector('#hud');
  const hudBody = root.querySelector('.hud-body');
  const lockHudBtn = root.querySelector('#lock-hud');
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
  const hotReloadBtn = root.querySelector('#hot-reload-btn');

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
  const objZSlider = root.querySelector('#obj-z-slider');
  const objZVal = root.querySelector('#obj-z-val');
  const objChargeSlider = root.querySelector('#obj-charge-slider');
  const objChargeVal = root.querySelector('#obj-charge-val');
  const objRadiusSlider = root.querySelector('#obj-radius-slider');
  const objRadiusVal = root.querySelector('#obj-radius-val');

  const kfPlayBtn = root.querySelector('#kf-play-btn');
  const kfAddBtn = root.querySelector('#kf-add-btn');
  const kfScrubber = root.querySelector('#kf-scrubber');
  const kfTimeVal = root.querySelector('#kf-time-val');
  const kfMarkers = root.querySelector('#kf-markers');
  const kfDelBtn = root.querySelector('#kf-del-btn');
  const kfClearBtn = root.querySelector('#kf-clear-btn');
  const kfStatus = root.querySelector('#kf-status');

  const engine = new GLEngine(glCanvas);
  const stage = new Stage2D(simCanvas, engine);
  const loader = createLoadingOverlay(root);
  const filters = wireFiltersDeck(root, glCanvas, engine);
  initHudReorder({ hud, hudBody, lockBtn: lockHudBtn, storageKey: 'toyheart.hudOrder.sandbox.v1' });
  const animator = new KeyframeAnimator();

  let activeStudy = SANDBOX_STUDIES[0];
  let activeParams = {};
  let seed = Math.random() * 100;
  let compiledStudyId = null;
  const thumbSession = createThumbnailSession({
    engine,
    getCanvases: () => [glCanvas, simCanvas],
  });

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

  function showSessionPreview(study) {
    sessionPreview.hidden = false;
    sessionPreviewTitle.textContent = study.name;
    sessionPreviewSub.textContent = `${study.mode === 'pingpong' ? 'Ping-Pong FBO' : '3D SDF Raymarcher'} · Ready to compile`;
    const thumb = getThumbnail(`sandbox:${study.id}`);
    if (thumb) {
      sessionThumbImg.src = thumb;
      sessionThumbImg.hidden = false;
      sessionThumbEmpty.hidden = true;
    } else {
      sessionThumbImg.hidden = true;
      sessionThumbEmpty.hidden = false;
    }
  }

  function applyAllActiveUniforms() {
    engine.setUniform('u_seed', seed);
    engine.setUniform('u_sandboxMode', 1.0);
    applyPalette(paletteSelect.value);
    applyGradient(gradientSelect.value);
    for (const [k, v] of Object.entries(activeParams)) {
      engine.setUniform(k, v);
    }
  }

  async function compileAndPlayActiveStudy() {
    const targetStudy = activeStudy;
    if (compiledStudyId === targetStudy.id) {
      if (compiledStudyId) thumbSession.captureNow({ force: false });

    sessionPreview.hidden = true;
      engine.setPaused(false);
      pauseBtn.textContent = 'Pause';
      return;
    }

    if (compiledStudyId) thumbSession.captureNow({ force: false });

    sessionPreview.hidden = true;
    loader.show(`Compiling ${targetStudy.name}...`, 15);
    const onProg = (pct, msg) => loader.setProgress(pct, msg);

    let committed = false;
    try {
      if (targetStudy.mode === 'pingpong') {
        committed = await engine.loadPingPongShadersAsync(targetStudy.simShader, targetStudy.displayShader, onProg);
        if (committed) engine.resetSimulation();
      } else {
        committed = await engine.loadFragmentShaderAsync(targetStudy.fragmentShader, onProg);
      }
    } finally {
      loader.hide();
    }
    if (!committed) return;

    compiledStudyId = targetStudy.id;
    applyAllActiveUniforms();
    engine.setPaused(false);
    pauseBtn.textContent = 'Pause';
    stage.stepAndRender(0.016, 0);

    thumbSession.arm({
      keys: [`sandbox:${targetStudy.id}`, 'app:sandbox'],
      study: targetStudy,
    });
  }

  function updateSelectedInspector(obj) {
    if (!obj) {
      selectedObjPanel.hidden = true;
      return;
    }
    selectedObjPanel.hidden = false;
    selectedObjTitle.textContent = `${obj.name} (${obj.charge >= 0 ? 'North +' : 'South −'})`;
    objModeSelect.value = obj.mode || 'manual';
    objZSlider.value = obj.z ?? 0.065;
    objZVal.textContent = Number(obj.z ?? 0.065).toFixed(2);
    objChargeSlider.value = obj.charge;
    objChargeVal.textContent = Number(obj.charge).toFixed(2);
    objRadiusSlider.value = obj.radius;
    objRadiusVal.textContent = Number(obj.radius).toFixed(3);
  }

  function renderKeyframeMarkers() {
    kfMarkers.innerHTML = '';
    const obj = stage.selectedObject;
    if (!obj) {
      kfStatus.textContent = 'Select a magnet to keyframe its X/Y/Z & charge.';
      return;
    }
    const track = animator.getTrack(obj);
    kfStatus.textContent = `${obj.name}: ${track.length} keyframe${track.length === 1 ? '' : 's'}`;
    for (const kf of track) {
      const dot = document.createElement('span');
      dot.className = 'kf-diamond';
      dot.style.left = `${(kf.t / animator.duration) * 100}%`;
      dot.title = `${kf.t.toFixed(2)}s`;
      kfMarkers.appendChild(dot);
    }
  }

  animator.onTimeUpdate = (t) => {
    kfScrubber.value = t;
    kfTimeVal.textContent = `${t.toFixed(2)}s / ${animator.duration.toFixed(2)}s`;
    if (stage.selectedObject) {
      objZSlider.value = stage.selectedObject.z ?? 0.065;
      objZVal.textContent = Number(stage.selectedObject.z ?? 0.065).toFixed(2);
    }
  };

  animator.onTracksChange = () => renderKeyframeMarkers();

  stage.onSelectionChange = (obj) => {
    updateSelectedInspector(obj);
    renderKeyframeMarkers();
  };

  stage.onObjectTransform = (obj) => {
    if (obj === stage.selectedObject) {
      objZSlider.value = obj.z;
      objZVal.textContent = Number(obj.z).toFixed(2);
    }
  };

  function spawnStarterObjects() {
    stage.clearObjects();
    const north = new MagnetNode({
      name: 'Magnet 1',
      x: 0.50,
      y: 0.50,
      z: 0.075,
      radius: 0.072,
      charge: 1.45,
      mode: 'manual',
    });
    stage.addObject(north);
  }

  function loadStudy(studyId) {
    const found = SANDBOX_STUDIES.find((s) => s.id === studyId);
    if (!found) return;
    activeStudy = found;
    activeParams = {};
    compiledStudyId = null;
    studySelect.value = found.id;
    studyDesc.textContent = activeStudy.description;
    paletteGroup.hidden = activeStudy.usesTritone === false;
    gradientGroup.hidden = !activeStudy.usesGradient;

    for (const param of activeStudy.params) {
      let val = param.type === 'toggle' ? (param.default ? 1 : 0) : param.default;
      if (param.key === 'u_emitters' && stage.objects.length > 0) {
        val = 0;
      }
      activeParams[param.key] = val;
    }

    stage.viewMode = activeParams.u_viewMode ?? (activeStudy.id === 'ferrofluid' ? 1 : 0);

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

    // Defer GPU compilation until the user clicks Play
    engine.setPaused(true);
    pauseBtn.textContent = 'Play';
    showSessionPreview(activeStudy);
  }

  populateStudySelect(studySelect, SANDBOX_STUDIES);

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
    filters.syncScaleDisplay(preset.scale);
  });

  sessionPlayBtn.addEventListener('click', () => {
    compileAndPlayActiveStudy();
  });

  pauseBtn.addEventListener('click', () => {
    if (compiledStudyId !== activeStudy.id) {
      compileAndPlayActiveStudy();
      return;
    }
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

  objZSlider.addEventListener('input', () => {
    const obj = stage.selectedObject;
    if (!obj) return;
    const val = parseFloat(objZSlider.value);
    obj.z = val;
    objZVal.textContent = val.toFixed(2);
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

  kfPlayBtn.addEventListener('click', () => {
    animator.playing = !animator.playing;
    kfPlayBtn.textContent = animator.playing ? '⏸ Pause Timeline' : '▶ Play Timeline';
  });

  kfAddBtn.addEventListener('click', () => {
    if (!stage.selectedObject) return;
    animator.addKeyframe(stage.selectedObject, animator.playhead);
  });

  kfScrubber.addEventListener('input', () => {
    animator.playing = false;
    kfPlayBtn.textContent = '▶ Play Timeline';
    animator.setPlayhead(parseFloat(kfScrubber.value), stage.objects);
  });

  kfDelBtn.addEventListener('click', () => {
    if (!stage.selectedObject) return;
    animator.removeKeyframeAt(stage.selectedObject, animator.playhead);
  });

  kfClearBtn.addEventListener('click', () => {
    if (!stage.selectedObject) return;
    animator.clearTrack(stage.selectedObject);
  });

  async function hotReloadActiveShader() {
    const targetId = activeStudy.id;
    const fresh = await reloadShaderModule(targetId);
    if (!fresh) return;
    const idx = SANDBOX_STUDIES.findIndex((s) => s.id === targetId);
    if (idx >= 0) SANDBOX_STUDIES[idx] = fresh;
    activeStudy = fresh;

    if (compiledStudyId === targetId) {
      compiledStudyId = null;
      await compileAndPlayActiveStudy();
    }
  }

  hotReloadBtn.addEventListener('click', hotReloadActiveShader);

  const disconnectWatch = connectShaderHotReload((file, map) => {
    const entry = map[activeStudy.id];
    if (entry && (entry.file === file || file === 'common.glsl.js')) {
      hotReloadActiveShader();
    }
  });

  function toggleHud() {
    const collapsed = hud.classList.toggle('collapsed');
    toggleHudBtn.textContent = collapsed ? 'Show GUI (H)' : 'Hide (H)';
  }

  const onKeyDown = (e) => {
    if (e.target?.tagName === 'INPUT' && e.target?.type === 'text') return;
    if (e.key === 'h' || e.key === 'H') toggleHud();
    if (e.key === 'p' || e.key === 'P') pauseBtn.click();
    if (e.key === 'r' || e.key === 'R') {
      if (e.shiftKey) hotReloadActiveShader();
      else reseedBtn.click();
    }
    if ((e.key === 'k' || e.key === 'K') && stage.selectedObject) {
      animator.addKeyframe(stage.selectedObject, animator.playhead);
    }
  };
  const onResize = () => {
    engine.resize();
    stage.resize();
  };

  toggleHudBtn.addEventListener('click', toggleHud);
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('resize', onResize);

  engine.setFrameHook((elapsed, dt) => {
    animator.step(dt, stage.objects);
    stage.stepAndRender(dt, elapsed);
  });

  spawnStarterObjects();
  loadStudy(activeStudy.id);
  engine.start();

  return {
    destroy() {
      disconnectWatch();
      thumbSession.destroy();
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('resize', onResize);
      loader.destroy();
      engine.destroy();
      root.innerHTML = '';
    },
  };
}
