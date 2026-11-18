import { GLEngine } from '../gl-engine.js';
import { PALETTES, GRADIENTS } from '../palettes.js';
import { ArenaSim } from '../core/arena-sim.js';
import { renderParamControls } from '../core/gui-builder.js';
import { GIMMICK_DEFS } from '../objects/arena-fighter.js';
import { fluidAdvectStudy } from '../shaders/fluid-advect.js';
import { ferrofluidStudy } from '../shaders/ferrofluid.js';
import { zebraRunwayStudy } from '../shaders/zebra-runway.js';
import { fractalPrngStudy } from '../shaders/fractal-prng.js';

const ARENA_GRID_SHADER = {
  id: 'arena-grid',
  name: 'Clean Tactical Grid',
  description: 'Minimalist dark tactical grid with clash shockwave illumination.',
  mode: 'single',
  usesTritone: false,
  usesGradient: false,
  params: [],
  fragmentShader: `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 outColor;
uniform vec2 u_resolution;
uniform float u_time;
uniform vec4 u_pointer;
void main() {
  vec2 aspect = vec2(u_resolution.x / max(u_resolution.y, 1.0), 1.0);
  vec2 p = (v_uv - 0.5) * aspect * 18.0;
  vec2 g = abs(fract(p - 0.5) - 0.5) / fwidth(p);
  float line = 1.0 - min(min(g.x, g.y), 1.0);
  float radial = length((v_uv - 0.5) * aspect);
  vec3 base = mix(vec3(0.06, 0.07, 0.09), vec3(0.02, 0.025, 0.035), smoothstep(0.0, 0.85, radial));
  vec3 gridCol = vec3(0.14, 0.16, 0.22);
  float imp = exp(-length((v_uv - u_pointer.xy) * aspect) * 6.0) * clamp(u_pointer.w * 0.12, 0.0, 0.35);
  vec3 col = mix(base, gridCol, line * 0.45) + vec3(0.35, 0.45, 0.65) * imp;
  outColor = vec4(col, 1.0);
}`,
};

const BACKDROP_SHADERS = [
  fluidAdvectStudy,
  ferrofluidStudy,
  ARENA_GRID_SHADER,
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
    <div class="stage-stack">
      <canvas id="gl-canvas"></canvas>
      <canvas id="sim-canvas"></canvas>
    </div>

    <aside id="hud" class="hud">
      <div class="hud-bar">
        <div class="hud-nav">
          <a href="#toybox" class="hud-back" title="Return to Toybox">← Toybox</a>
          <span class="hud-title">Arena</span>
        </div>
        <button id="toggle-hud" type="button">Hide (H)</button>
      </div>

      <div class="hud-body">
        <div class="actions hud-transport">
          <button id="pause-btn" type="button">Pause</button>
          <button id="restart-btn" type="button" class="btn-primary">⚔ Restart (R)</button>
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
          <summary>Fighters &amp; Gimmicks</summary>
          <div class="builder-section">
            <div class="actions" style="border-top:none; padding-top:0;">
              <button id="random-match-btn" type="button">🎲 Randomize</button>
              <button id="swap-sides-btn" type="button">⇄ Swap Sides</button>
            </div>

            <div class="selected-obj-panel">
              <div class="builder-row">
                <input id="f0-color" type="color" value="#f43f5e" class="fighter-swatch" />
                <input id="f0-name" type="text" value="Crimson" />
              </div>
              <div class="param-row">
                <div class="param-header"><span>Fighter 1 Gimmick</span></div>
                <select id="f0-gimmick"></select>
              </div>
              <p id="f0-desc" class="sandbox-hint" style="margin:0;"></p>
              <div class="param-row">
                <div class="param-header">
                  <span>Max HP</span>
                  <span id="f0-hp-val" class="param-val">120</span>
                </div>
                <input id="f0-hp" type="range" min="40" max="300" step="10" value="120" />
              </div>
              <div class="param-row">
                <div class="param-header">
                  <span>Launch Speed</span>
                  <span id="f0-spd-val" class="param-val">0.52</span>
                </div>
                <input id="f0-spd" type="range" min="0.2" max="1.1" step="0.02" value="0.52" />
              </div>
            </div>

            <div class="selected-obj-panel">
              <div class="builder-row">
                <input id="f1-color" type="color" value="#38bdf8" class="fighter-swatch" />
                <input id="f1-name" type="text" value="Cobalt" />
              </div>
              <div class="param-row">
                <div class="param-header"><span>Fighter 2 Gimmick</span></div>
                <select id="f1-gimmick"></select>
              </div>
              <p id="f1-desc" class="sandbox-hint" style="margin:0;"></p>
              <div class="param-row">
                <div class="param-header">
                  <span>Max HP</span>
                  <span id="f1-hp-val" class="param-val">120</span>
                </div>
                <input id="f1-hp" type="range" min="40" max="300" step="10" value="120" />
              </div>
              <div class="param-row">
                <div class="param-header">
                  <span>Launch Speed</span>
                  <span id="f1-spd-val" class="param-val">0.52</span>
                </div>
                <input id="f1-spd" type="range" min="0.2" max="1.1" step="0.02" value="0.52" />
              </div>
            </div>
          </div>
        </details>

        <details class="builder-details" open>
          <summary>Arena &amp; Physics</summary>
          <div class="builder-section">
            <div class="param-row">
              <div class="param-header"><span>Cage Geometry</span></div>
              <select id="arena-shape">
                <option value="circle" selected>Circle Cage</option>
                <option value="shrinking">Shrinking Sudden-Death Ring</option>
                <option value="box">Rounded Box Cage</option>
              </select>
            </div>

            <div class="param-row">
              <div class="param-header">
                <span>Arena Size</span>
                <span id="arena-size-val" class="param-val">0.39</span>
              </div>
              <input id="arena-size" type="range" min="0.24" max="0.46" step="0.01" value="0.39" />
            </div>

            <div class="param-row">
              <div class="param-header">
                <span>Gravity</span>
                <span id="gravity-val" class="param-val">0.38</span>
              </div>
              <input id="gravity-slider" type="range" min="0.0" max="1.1" step="0.02" value="0.38" />
            </div>

            <div class="param-row">
              <div class="param-header">
                <span>Wall Bounciness</span>
                <span id="bounce-val" class="param-val">1.02</span>
              </div>
              <input id="bounce-slider" type="range" min="0.85" max="1.08" step="0.005" value="1.015" />
            </div>

            <div class="param-row">
              <div class="param-header">
                <span>Sim Speed (Slow-Mo / Turbo)</span>
                <span id="sim-speed-val" class="param-val">1.00x</span>
              </div>
              <input id="sim-speed" type="range" min="0.2" max="2.0" step="0.05" value="1.0" />
            </div>

            <label class="param-row param-toggle-row">
              <span>Shader Reacts to Fight</span>
              <input id="toggle-shader-react" type="checkbox" class="param-toggle" checked />
            </label>

            <label class="param-row param-toggle-row">
              <span>Procedural Bounce / Clash SFX</span>
              <input id="toggle-sfx" type="checkbox" class="param-toggle" checked />
            </label>

            <label class="param-row param-toggle-row">
              <span>Show Top Scoreboard Overlay</span>
              <input id="toggle-scoreboard" type="checkbox" class="param-toggle" checked />
            </label>
          </div>
        </details>

        <details class="builder-details">
          <summary>Shader Parameters</summary>
          <div id="params-container" class="params-container" style="border-top:none; padding-top:0.2rem;"></div>
        </details>
      </div>
    </aside>
  `;

  const glCanvas = root.querySelector('#gl-canvas');
  const simCanvas = root.querySelector('#sim-canvas');
  const hud = root.querySelector('#hud');
  const toggleHudBtn = root.querySelector('#toggle-hud');

  const restartBtn = root.querySelector('#restart-btn');
  const pauseBtn = root.querySelector('#pause-btn');
  const randomMatchBtn = root.querySelector('#random-match-btn');
  const swapSidesBtn = root.querySelector('#swap-sides-btn');

  const studySelect = root.querySelector('#study-select');
  const studyDesc = root.querySelector('#study-desc');
  const paletteGroup = root.querySelector('#palette-group');
  const paletteSelect = root.querySelector('#palette-select');
  const gradientGroup = root.querySelector('#gradient-group');
  const gradientSelect = root.querySelector('#gradient-select');
  const perfSelect = root.querySelector('#perf-select');
  const paramsContainer = root.querySelector('#params-container');

  const f0Color = root.querySelector('#f0-color');
  const f0Name = root.querySelector('#f0-name');
  const f0Gimmick = root.querySelector('#f0-gimmick');
  const f0Desc = root.querySelector('#f0-desc');
  const f0Hp = root.querySelector('#f0-hp');
  const f0HpVal = root.querySelector('#f0-hp-val');
  const f0Spd = root.querySelector('#f0-spd');
  const f0SpdVal = root.querySelector('#f0-spd-val');

  const f1Color = root.querySelector('#f1-color');
  const f1Name = root.querySelector('#f1-name');
  const f1Gimmick = root.querySelector('#f1-gimmick');
  const f1Desc = root.querySelector('#f1-desc');
  const f1Hp = root.querySelector('#f1-hp');
  const f1HpVal = root.querySelector('#f1-hp-val');
  const f1Spd = root.querySelector('#f1-spd');
  const f1SpdVal = root.querySelector('#f1-spd-val');

  const arenaShapeSelect = root.querySelector('#arena-shape');
  const arenaSizeSlider = root.querySelector('#arena-size');
  const arenaSizeVal = root.querySelector('#arena-size-val');
  const gravitySlider = root.querySelector('#gravity-slider');
  const gravityVal = root.querySelector('#gravity-val');
  const bounceSlider = root.querySelector('#bounce-slider');
  const bounceVal = root.querySelector('#bounce-val');
  const simSpeedSlider = root.querySelector('#sim-speed');
  const simSpeedVal = root.querySelector('#sim-speed-val');
  const toggleShaderReact = root.querySelector('#toggle-shader-react');
  const toggleSfx = root.querySelector('#toggle-sfx');
  const toggleScoreboard = root.querySelector('#toggle-scoreboard');

  const engine = new GLEngine(glCanvas);
  const arena = new ArenaSim(simCanvas, engine);
  let activeParams = {};
  let seed = Math.random() * 100;

  for (const gim of Object.values(GIMMICK_DEFS)) {
    for (const sel of [f0Gimmick, f1Gimmick]) {
      const opt = document.createElement('option');
      opt.value = gim.id;
      opt.textContent = gim.label;
      sel.appendChild(opt);
    }
  }

  f0Gimmick.value = arena.fighterConfigs[0].gimmickId;
  f1Gimmick.value = arena.fighterConfigs[1].gimmickId;

  function updateGimmickDescriptions() {
    f0Desc.textContent = GIMMICK_DEFS[f0Gimmick.value]?.description || '';
    f1Desc.textContent = GIMMICK_DEFS[f1Gimmick.value]?.description || '';
  }
  updateGimmickDescriptions();

  for (const study of BACKDROP_SHADERS) {
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

  function loadBackdropShader(studyId) {
    const study = BACKDROP_SHADERS.find((s) => s.id === studyId) || BACKDROP_SHADERS[0];
    studySelect.value = study.id;
    studyDesc.textContent = study.description || '';
    paletteGroup.hidden = study.usesTritone === false;
    gradientGroup.hidden = !study.usesGradient;
    activeParams = {};

    if (study.mode === 'pingpong') {
      engine.loadPingPongShaders(study.simShader, study.displayShader);
      engine.resetSimulation();
    } else {
      engine.loadFragmentShader(study.fragmentShader);
    }

    engine.setUniform('u_seed', seed);
    applyPalette(paletteSelect.value);
    applyGradient(gradientSelect.value);

    for (const param of study.params || []) {
      let val = param.type === 'toggle' ? (param.default ? 1 : 0) : param.default;
      if (param.key === 'u_emitters') val = 0;
      activeParams[param.key] = val;
      engine.setUniform(param.key, val);
    }

    renderParamControls({
      container: paramsContainer,
      params: study.params || [],
      values: activeParams,
      onChange: (key, val) => {
        engine.setUniform(key, val);
      },
    });
  }

  function syncConfigsFromUI() {
    arena.fighterConfigs[0].name = f0Name.value.trim() || 'Crimson';
    arena.fighterConfigs[0].hex = f0Color.value;
    arena.fighterConfigs[0].gimmickId = f0Gimmick.value;
    arena.fighterConfigs[0].maxHp = parseFloat(f0Hp.value);
    arena.fighterConfigs[0].speed = parseFloat(f0Spd.value);

    arena.fighterConfigs[1].name = f1Name.value.trim() || 'Cobalt';
    arena.fighterConfigs[1].hex = f1Color.value;
    arena.fighterConfigs[1].gimmickId = f1Gimmick.value;
    arena.fighterConfigs[1].maxHp = parseFloat(f1Hp.value);
    arena.fighterConfigs[1].speed = parseFloat(f1Spd.value);

    updateGimmickDescriptions();
  }

  for (const el of [f0Name, f0Color, f0Gimmick, f1Name, f1Color, f1Gimmick]) {
    el.addEventListener('change', () => {
      syncConfigsFromUI();
      arena.startMatch();
    });
  }

  f0Hp.addEventListener('input', () => {
    f0HpVal.textContent = f0Hp.value;
    syncConfigsFromUI();
  });
  f0Hp.addEventListener('change', () => arena.startMatch());

  f0Spd.addEventListener('input', () => {
    f0SpdVal.textContent = parseFloat(f0Spd.value).toFixed(2);
    syncConfigsFromUI();
  });
  f0Spd.addEventListener('change', () => arena.startMatch());

  f1Hp.addEventListener('input', () => {
    f1HpVal.textContent = f1Hp.value;
    syncConfigsFromUI();
  });
  f1Hp.addEventListener('change', () => arena.startMatch());

  f1Spd.addEventListener('input', () => {
    f1SpdVal.textContent = parseFloat(f1Spd.value).toFixed(2);
    syncConfigsFromUI();
  });
  f1Spd.addEventListener('change', () => arena.startMatch());

  restartBtn.addEventListener('click', () => {
    syncConfigsFromUI();
    arena.startMatch();
    if (engine.paused) {
      engine.setPaused(false);
      pauseBtn.textContent = 'Pause';
    }
  });

  pauseBtn.addEventListener('click', () => {
    const nextPaused = !engine.paused;
    engine.setPaused(nextPaused);
    pauseBtn.textContent = nextPaused ? 'Play' : 'Pause';
  });

  randomMatchBtn.addEventListener('click', () => {
    const keys = Object.keys(GIMMICK_DEFS);
    const g0 = keys[Math.floor(Math.random() * keys.length)];
    let g1 = keys[Math.floor(Math.random() * keys.length)];
    if (keys.length > 1 && g1 === g0) {
      g1 = keys[(keys.indexOf(g0) + 1) % keys.length];
    }
    f0Gimmick.value = g0;
    f1Gimmick.value = g1;
    syncConfigsFromUI();
    arena.startMatch();
  });

  swapSidesBtn.addEventListener('click', () => {
    const tmpG = f0Gimmick.value;
    f0Gimmick.value = f1Gimmick.value;
    f1Gimmick.value = tmpG;
    syncConfigsFromUI();
    arena.startMatch();
  });

  arenaShapeSelect.addEventListener('change', () => {
    arena.arenaShape = arenaShapeSelect.value;
    arena.startMatch();
  });

  arenaSizeSlider.addEventListener('input', () => {
    const v = parseFloat(arenaSizeSlider.value);
    arena.baseArenaRadius = v;
    arena.arenaRadius = v;
    arenaSizeVal.textContent = v.toFixed(2);
  });

  gravitySlider.addEventListener('input', () => {
    const v = parseFloat(gravitySlider.value);
    arena.gravity = v;
    gravityVal.textContent = v.toFixed(2);
  });

  bounceSlider.addEventListener('input', () => {
    const v = parseFloat(bounceSlider.value);
    arena.restitution = v;
    bounceVal.textContent = v.toFixed(2);
  });

  simSpeedSlider.addEventListener('input', () => {
    const v = parseFloat(simSpeedSlider.value);
    arena.simSpeed = v;
    simSpeedVal.textContent = `${v.toFixed(2)}x`;
  });

  toggleSfx.addEventListener('change', () => {
    arena.sfx.enabled = toggleSfx.checked;
  });

  toggleScoreboard.addEventListener('change', () => {
    arena.showHudOverlay = toggleScoreboard.checked;
  });

  studySelect.addEventListener('change', () => loadBackdropShader(studySelect.value));
  paletteSelect.addEventListener('change', () => applyPalette(paletteSelect.value));
  gradientSelect.addEventListener('change', () => applyGradient(gradientSelect.value));
  toggleShaderReact.addEventListener('change', () => {
    arena.shaderReact = toggleShaderReact.checked;
  });
  perfSelect.addEventListener('change', () => {
    const preset = PERF_PRESETS[perfSelect.value] || PERF_PRESETS.balanced;
    engine.setRenderScale(preset.scale);
    engine.setMaxFps(preset.fps);
  });

  function toggleHud() {
    const collapsed = hud.classList.toggle('collapsed');
    toggleHudBtn.textContent = collapsed ? 'Show GUI (H)' : 'Hide (H)';
  }

  const onKeyDown = (e) => {
    if (e.target?.tagName === 'INPUT' && e.target?.type === 'text') return;
    if (e.key === 'h' || e.key === 'H') toggleHud();
    if (e.key === 'r' || e.key === 'R') {
      syncConfigsFromUI();
      arena.startMatch();
    }
  };

  const onResize = () => {
    engine.resize();
    arena.resize();
  };

  toggleHudBtn.addEventListener('click', toggleHud);
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('resize', onResize);

  engine.setMaxFps(60);
  engine.setFrameHook((_elapsed, dt) => {
    arena.stepAndRender(dt);
  });

  loadBackdropShader(BACKDROP_SHADERS[0].id);
  syncConfigsFromUI();
  arena.startMatch();
  engine.setPaused(false);
  engine.start();

  return {
    destroy() {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('resize', onResize);
      arena.sfx.enabled = false;
      arena.sfx.ctx?.close?.().catch(() => {});
      engine.destroy();
      root.innerHTML = '';
    },
  };
}
