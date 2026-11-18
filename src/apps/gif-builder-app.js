import { GLEngine } from '../gl-engine.js';
import { PALETTES, GRADIENTS } from '../palettes.js';
import { ALL_STUDIES } from '../shaders/studies.js';
import { populateStudySelect } from '../shaders/shader-params.js';
import { renderParamControls } from '../core/gui-builder.js';
import { createLoadingOverlay } from '../core/loading-bar.js';
import { buildFiltersDeckHTML, wireFiltersDeck } from '../core/filter-controls.js';
import { initHudReorder } from '../core/hud-reorder.js';
import { createThumbnailSession } from '../core/thumbnail-store.js';
import { encodeGIF } from '../core/gif-encoder.js';

const ASPECT_PRESETS = {
  sq512: { label: '1:1 Square (512×512)', w: 512, h: 512 },
  sq720: { label: '1:1 HD (720×720)', w: 720, h: 720 },
  wide720: { label: '16:9 Wide (720×405)', w: 720, h: 405 },
  vert720: { label: '9:16 Vertical (405×720)', w: 405, h: 720 },
  port640: { label: '4:5 Portrait (512×640)', w: 512, h: 640 },
};

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export function mount(root) {
  root.innerHTML = `
    <div class="gif-stage-wrap">
      <div id="gif-frame-box" class="gif-frame-box">
        <canvas id="gl-canvas"></canvas>
        <canvas id="overlay-canvas" class="gif-overlay-canvas"></canvas>
      </div>
    </div>

    <aside id="hud" class="hud">
      <div class="hud-bar">
        <div class="hud-nav">
          <a href="#toybox" class="hud-back" title="Return to Toybox">← Toybox</a>
          <span class="hud-title">Loop</span>
        </div>
        <div class="hud-bar-actions">
          <button id="lock-hud" type="button" class="hud-lock-btn" title="Unlock to reorder tabs">🔒</button>
          <button id="toggle-hud" type="button">Hide (H)</button>
        </div>
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
            <label for="palette-select">Tritone Palette</label>
            <select id="palette-select"></select>
          </div>

          <div id="gradient-group" class="control-group" hidden>
            <label for="gradient-select">Gradient Preset</label>
            <select id="gradient-select"></select>
          </div>
        </div>

        <details class="builder-details" open>
          <summary>Loop &amp; Framing</summary>
          <div class="builder-section">
            <div class="control-group">
              <label for="gif-aspect">Output Aspect / Size</label>
              <select id="gif-aspect"></select>
            </div>
            <div class="param-row">
              <div class="param-header">
                <span>Loop Duration</span>
                <span id="gif-dur-val" class="param-val">3.0s</span>
              </div>
              <input id="gif-dur" type="range" min="1.0" max="8.0" step="0.5" value="3.0" />
            </div>
            <div class="control-group">
              <label for="gif-fps">Capture FPS</label>
              <select id="gif-fps">
                <option value="12">12 fps</option>
                <option value="15">15 fps</option>
                <option value="24" selected>24 fps</option>
                <option value="30">30 fps</option>
                <option value="60">60 fps</option>
              </select>
            </div>
            <div class="control-group">
              <label for="gif-loop-mode">Loop Mode</label>
              <select id="gif-loop-mode">
                <option value="forward">Forward Loop</option>
                <option value="boomerang" selected>Boomerang (Ping-Pong)</option>
              </select>
            </div>
          </div>
        </details>

        <details class="builder-details">
          <summary>Stamp &amp; Overlay</summary>
          <div class="builder-section">
            <div class="control-group">
              <label for="gif-stamp-text">Corner Stamp</label>
              <input id="gif-stamp-text" type="text" value="toyheart." placeholder="Optional text stamp..." />
            </div>
            <label class="param-row param-toggle-row">
              <span>Frame Border</span>
              <input id="gif-border-toggle" type="checkbox" class="param-toggle" checked />
            </label>
            <label class="param-row param-toggle-row">
              <span>Show Timecode</span>
              <input id="gif-timecode-toggle" type="checkbox" class="param-toggle" />
            </label>
          </div>
        </details>

        <details class="builder-details" open>
          <summary>Export (.GIF / WebM / WebP)</summary>
          <div class="builder-section">
            <button id="export-gif-btn" type="button" class="btn-primary">✦ Export .GIF</button>
            <button id="export-webm-btn" type="button">● Record WebM Loop</button>
            <div class="actions">
              <button id="export-webp-btn" type="button">Save WebP Frame</button>
              <button id="export-sheet-btn" type="button">WebP Spritesheet</button>
            </div>
            <div id="gif-export-status" class="builder-status">Ready to capture.</div>
          </div>
        </details>

        <div id="params-container" class="params-container"></div>

        ${buildFiltersDeckHTML()}
      </div>
    </aside>
  `;

  const frameBox = root.querySelector('#gif-frame-box');
  const glCanvas = root.querySelector('#gl-canvas');
  const overlayCanvas = root.querySelector('#overlay-canvas');
  const overlayCtx = overlayCanvas.getContext('2d');

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
  const paramsContainer = root.querySelector('#params-container');

  const pauseBtn = root.querySelector('#pause-btn');
  const reseedBtn = root.querySelector('#reseed-btn');

  const aspectSelect = root.querySelector('#gif-aspect');
  const durSlider = root.querySelector('#gif-dur');
  const durVal = root.querySelector('#gif-dur-val');
  const fpsSelect = root.querySelector('#gif-fps');
  const loopModeSelect = root.querySelector('#gif-loop-mode');
  const stampInput = root.querySelector('#gif-stamp-text');
  const borderToggle = root.querySelector('#gif-border-toggle');
  const timecodeToggle = root.querySelector('#gif-timecode-toggle');

  const exportGifBtn = root.querySelector('#export-gif-btn');
  const exportWebmBtn = root.querySelector('#export-webm-btn');
  const exportWebpBtn = root.querySelector('#export-webp-btn');
  const exportSheetBtn = root.querySelector('#export-sheet-btn');
  const exportStatus = root.querySelector('#gif-export-status');

  const engine = new GLEngine(glCanvas);
  const loader = createLoadingOverlay(root);
  wireFiltersDeck(root, glCanvas, engine);
  initHudReorder({ hud, hudBody, lockBtn: lockHudBtn, storageKey: 'toyheart.hudOrder.gifBuilder.v1' });

  const thumbSession = createThumbnailSession({
    engine,
    getCanvases: () => [glCanvas, overlayCanvas],
  });

  let activeStudy = ALL_STUDIES.find((s) => s.id === 'falling-objects') || ALL_STUDIES[0];
  let activeParams = {};
  let seed = Math.random() * 100;
  let isRecording = false;
  let loopClock = 0;

  for (const [id, preset] of Object.entries(ASPECT_PRESETS)) {
    const opt = document.createElement('option');
    opt.value = id;
    opt.textContent = preset.label;
    aspectSelect.appendChild(opt);
  }
  aspectSelect.value = 'sq512';

  populateStudySelect(studySelect, ALL_STUDIES);

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

  function applyFrameAspect() {
    const preset = ASPECT_PRESETS[aspectSelect.value] || ASPECT_PRESETS.sq512;
    frameBox.style.aspectRatio = `${preset.w} / ${preset.h}`;
    frameBox.style.maxWidth = `${preset.w}px`;
    frameBox.style.maxHeight = `${preset.h}px`;
    engine.resize();
    overlayCanvas.width = glCanvas.width;
    overlayCanvas.height = glCanvas.height;
  }

  function renderOverlay(t, duration) {
    const w = overlayCanvas.width;
    const h = overlayCanvas.height;
    if (!w || !h) return;
    overlayCtx.clearRect(0, 0, w, h);

    if (borderToggle.checked) {
      overlayCtx.strokeStyle = 'rgba(255, 255, 255, 0.72)';
      overlayCtx.lineWidth = Math.max(2, Math.round(w * 0.005));
      const pad = overlayCtx.lineWidth * 1.5;
      overlayCtx.strokeRect(pad, pad, w - pad * 2, h - pad * 2);
    }

    const stamp = stampInput.value.trim();
    const fontSize = Math.max(11, Math.round(w * 0.028));
    overlayCtx.font = `700 ${fontSize}px ui-monospace, SFMono-Regular, Menlo, monospace`;
    overlayCtx.textBaseline = 'bottom';

    if (stamp) {
      overlayCtx.fillStyle = 'rgba(0, 0, 0, 0.45)';
      overlayCtx.fillText(stamp, Math.round(w * 0.04) + 1, h - Math.round(h * 0.035) + 1);
      overlayCtx.fillStyle = 'rgba(255, 255, 255, 0.92)';
      overlayCtx.fillText(stamp, Math.round(w * 0.04), h - Math.round(h * 0.035));
    }

    if (timecodeToggle.checked) {
      const tc = `${t.toFixed(2)}s / ${duration.toFixed(1)}s`;
      overlayCtx.textAlign = 'right';
      overlayCtx.fillStyle = 'rgba(0, 0, 0, 0.45)';
      overlayCtx.fillText(tc, w - Math.round(w * 0.04) + 1, h - Math.round(h * 0.035) + 1);
      overlayCtx.fillStyle = 'rgba(255, 255, 255, 0.88)';
      overlayCtx.fillText(tc, w - Math.round(w * 0.04), h - Math.round(h * 0.035));
      overlayCtx.textAlign = 'left';
    }
  }

  function evalLoopTime(rawClock, duration) {
    if (loopModeSelect.value === 'boomerang' && activeStudy.mode !== 'pingpong') {
      const phase = (rawClock % duration) / duration;
      const tri = phase < 0.5 ? phase * 2.0 : (1.0 - phase) * 2.0;
      return tri * (duration * 0.5);
    }
    return rawClock % duration;
  }

  function applyPalette(paletteId) {
    const pal = PALETTES[paletteId] || PALETTES.monochrome;
    engine.setUniform('u_colorDark', pal.dark);
    engine.setUniform('u_colorMid', pal.mid);
    engine.setUniform('u_colorLight', pal.light);
  }

  function applyGradient(gradientId) {
    const grad = GRADIENTS[gradientId] || GRADIENTS.seed;
    engine.setUniform('u_useGradient', grad.useSeed ? 0.0 : 1.0);
    engine.setUniform('u_gradA', grad.a);
    engine.setUniform('u_gradB', grad.b);
    engine.setUniform('u_gradC', grad.c);
    engine.setUniform('u_gradD', grad.d);
  }

  async function loadStudy(studyId) {
    const found = ALL_STUDIES.find((s) => s.id === studyId) || ALL_STUDIES[0];
    thumbSession.captureNow({ force: false });
    activeStudy = found;
    activeParams = {};
    studySelect.value = found.id;
    studyDesc.textContent = found.description;
    paletteGroup.hidden = found.usesTritone === false;
    gradientGroup.hidden = !found.usesGradient;

    loader.show(`Loading ${found.name}...`, 20);
    let committed = false;
    try {
      if (found.mode === 'pingpong') {
        committed = await engine.loadPingPongShadersAsync(found.simShader, found.displayShader, (p, m) =>
          loader.setProgress(p, m)
        );
        if (committed) engine.resetSimulation();
      } else {
        committed = await engine.loadFragmentShaderAsync(found.fragmentShader, (p, m) => loader.setProgress(p, m));
      }
    } finally {
      loader.hide();
    }
    if (!committed) return;

    loopClock = 0;
    engine.setUniform('u_seed', seed);
    applyPalette(paletteSelect.value);
    applyGradient(gradientSelect.value);

    for (const p of found.params) {
      const def = p.type === 'toggle' ? (p.default ? 1 : 0) : p.default;
      activeParams[p.key] = def;
      engine.setUniform(p.key, def);
    }

    const pigmentHexes = found.pigmentScale ? found.pigmentScale.defaults.map((d) => d.hex) : [];
    if (found.pigmentScale) {
      const { defaults, uniformPrefix, toUniform } = found.pigmentScale;
      defaults.forEach((d, idx) => {
        engine.setUniform(`${uniformPrefix}${idx}`, toUniform(d.hex));
      });
    }

    renderParamControls({
      container: paramsContainer,
      params: found.params,
      values: activeParams,
      onChange: (key, val) => {
        activeParams[key] = val;
        engine.setUniform(key, val);
      },
      pigmentScale: found.pigmentScale || null,
      pigmentHexes,
      onPigmentChange: (idx, _hex, uniformVal) => {
        engine.setUniform(`${found.pigmentScale.uniformPrefix}${idx}`, uniformVal);
      },
    });

    thumbSession.arm({
      keys: ['app:gif-builder'],
      study: found,
    });
  }

  engine.setFrameHook((_elapsed, dt) => {
    const duration = parseFloat(durSlider.value);
    loopClock += dt;
    const shaderT = evalLoopTime(loopClock, duration);
    if (activeStudy.mode !== 'pingpong') {
      engine.elapsed = shaderT;
    }
    if (activeStudy.onFrame) {
      activeStudy.onFrame(engine, shaderT, activeParams, seed);
    }
    renderOverlay(shaderT, duration);
  });

  function renderCompositeFrame(targetCanvas, targetCtx) {
    engine.renderFrame();
    targetCtx.clearRect(0, 0, targetCanvas.width, targetCanvas.height);
    targetCtx.drawImage(glCanvas, 0, 0, targetCanvas.width, targetCanvas.height);
    targetCtx.drawImage(overlayCanvas, 0, 0, targetCanvas.width, targetCanvas.height);
  }

  exportGifBtn.addEventListener('click', () => {
    const duration = parseFloat(durSlider.value);
    const fps = Math.min(30, parseInt(fpsSelect.value, 10) || 24);
    const totalFrames = Math.min(72, Math.max(8, Math.round(duration * fps)));
    const preset = ASPECT_PRESETS[aspectSelect.value] || ASPECT_PRESETS.sq512;
    const gifW = Math.min(480, preset.w);
    const gifH = Math.round((gifW / preset.w) * preset.h);

    const tmp = document.createElement('canvas');
    tmp.width = gifW;
    tmp.height = gifH;
    const ctx = tmp.getContext('2d', { willReadFrequently: true });
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';

    const wasPaused = engine.paused;
    // Keep paused=false synchronously during frame stepping so pingpong simProgram advances
    engine.paused = false;

    exportStatus.textContent = `Encoding ${totalFrames} GIF frames...`;
    const frames = [];
    for (let i = 0; i < totalFrames; i++) {
      const rawT = (i / totalFrames) * duration;
      const shaderT = evalLoopTime(rawT, duration);
      engine.elapsed = activeStudy.mode === 'pingpong' ? rawT : shaderT;
      if (activeStudy.onFrame) activeStudy.onFrame(engine, engine.elapsed, activeParams, seed);
      renderOverlay(shaderT, duration);
      renderCompositeFrame(tmp, ctx);
      frames.push(ctx.getImageData(0, 0, gifW, gifH).data);
    }

    engine.paused = wasPaused;
    const delayCs = Math.max(2, Math.round(100 / fps));
    const blob = encodeGIF({ width: gifW, height: gifH, frames, delayCs });
    downloadBlob(blob, `${activeStudy.id}-loop.gif`);
    exportStatus.textContent = `Saved ${activeStudy.id}-loop.gif (${(blob.size / 1024).toFixed(0)} KB)`;
  });

  exportWebpBtn.addEventListener('click', () => {
    const preset = ASPECT_PRESETS[aspectSelect.value] || ASPECT_PRESETS.sq512;
    const out = document.createElement('canvas');
    out.width = preset.w;
    out.height = preset.h;
    const ctx = out.getContext('2d');
    renderCompositeFrame(out, ctx);
    out.toBlob(
      (blob) => {
        if (blob) {
          downloadBlob(blob, `${activeStudy.id}-frame.webp`);
          exportStatus.textContent = `Saved ${activeStudy.id}-frame.webp`;
        }
      },
      'image/webp',
      0.92
    );
  });

  exportSheetBtn.addEventListener('click', () => {
    const duration = parseFloat(durSlider.value);
    const fps = parseInt(fpsSelect.value, 10) || 24;
    const totalFrames = Math.min(48, Math.max(8, Math.round(duration * fps)));
    const preset = ASPECT_PRESETS[aspectSelect.value] || ASPECT_PRESETS.sq512;
    const tileW = Math.min(256, preset.w);
    const tileH = Math.round((tileW / preset.w) * preset.h);
    const cols = Math.ceil(Math.sqrt(totalFrames));
    const rows = Math.ceil(totalFrames / cols);

    const sheet = document.createElement('canvas');
    sheet.width = cols * tileW;
    sheet.height = rows * tileH;
    const sCtx = sheet.getContext('2d');
    sCtx.imageSmoothingEnabled = true;
    sCtx.imageSmoothingQuality = 'high';

    const wasPaused = engine.paused;
    engine.paused = false;

    const framesMeta = {};
    for (let i = 0; i < totalFrames; i++) {
      const rawT = (i / totalFrames) * duration;
      const shaderT = evalLoopTime(rawT, duration);
      engine.elapsed = activeStudy.mode === 'pingpong' ? rawT : shaderT;
      if (activeStudy.onFrame) activeStudy.onFrame(engine, engine.elapsed, activeParams, seed);
      renderOverlay(shaderT, duration);
      engine.renderFrame();

      const col = i % cols;
      const row = Math.floor(i / cols);
      sCtx.drawImage(glCanvas, col * tileW, row * tileH, tileW, tileH);
      sCtx.drawImage(overlayCanvas, col * tileW, row * tileH, tileW, tileH);

      framesMeta[`frame_${i}`] = {
        frame: { x: col * tileW, y: row * tileH, w: tileW, h: tileH },
      };
    }

    engine.paused = wasPaused;
    sheet.toBlob(
      (blob) => {
        if (!blob) return;
        downloadBlob(blob, `${activeStudy.id}-sheet.webp`);
        const atlas = JSON.stringify({ frames: framesMeta, meta: { fps, duration, tileW, tileH } }, null, 2);
        downloadBlob(new Blob([atlas], { type: 'application/json' }), `${activeStudy.id}-sheet.atlas.json`);
        exportStatus.textContent = `Exported ${totalFrames}-frame WebP spritesheet + atlas.`;
      },
      'image/webp',
      0.90
    );
  });

  exportWebmBtn.addEventListener('click', () => {
    if (isRecording) return;
    if (typeof MediaRecorder === 'undefined') {
      exportStatus.textContent = 'MediaRecorder is not supported in this browser.';
      return;
    }

    const duration = parseFloat(durSlider.value);
    const fps = parseInt(fpsSelect.value, 10) || 24;
    const preset = ASPECT_PRESETS[aspectSelect.value] || ASPECT_PRESETS.sq512;

    const recCanvas = document.createElement('canvas');
    recCanvas.width = preset.w;
    recCanvas.height = preset.h;
    const recCtx = recCanvas.getContext('2d');

    const mimeType = MediaRecorder.isTypeSupported('video/webm;codecs=vp9')
      ? 'video/webm;codecs=vp9'
      : 'video/webm';
    const stream = recCanvas.captureStream(fps);
    const recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 4_500_000 });
    const chunks = [];

    isRecording = true;
    exportWebmBtn.disabled = true;
    exportWebmBtn.textContent = '● Recording...';

    recorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) chunks.push(e.data);
    };
    recorder.onstop = () => {
      isRecording = false;
      exportWebmBtn.disabled = false;
      exportWebmBtn.textContent = '● Record WebM Loop';
      const blob = new Blob(chunks, { type: mimeType });
      downloadBlob(blob, `${activeStudy.id}-loop.webm`);
      exportStatus.textContent = `Saved ${activeStudy.id}-loop.webm (${(blob.size / 1024).toFixed(0)} KB)`;
    };

    loopClock = 0;
    if (activeStudy.mode === 'pingpong') engine.resetSimulation();
    engine.setPaused(false);
    pauseBtn.textContent = 'Pause';
    recorder.start();

    const startMs = performance.now();
    const totalMs = duration * 1000;
    const pump = () => {
      if (!isRecording) return;
      renderCompositeFrame(recCanvas, recCtx);
      const elapsedMs = performance.now() - startMs;
      exportStatus.textContent = `Recording WebM... ${Math.min(100, Math.round((elapsedMs / totalMs) * 100))}%`;
      if (elapsedMs >= totalMs) {
        recorder.stop();
      } else {
        requestAnimationFrame(pump);
      }
    };
    requestAnimationFrame(pump);
  });

  studySelect.addEventListener('change', () => loadStudy(studySelect.value));
  paletteSelect.addEventListener('change', () => applyPalette(paletteSelect.value));
  gradientSelect.addEventListener('change', () => applyGradient(gradientSelect.value));
  aspectSelect.addEventListener('change', applyFrameAspect);
  durSlider.addEventListener('input', () => {
    durVal.textContent = `${parseFloat(durSlider.value).toFixed(1)}s`;
  });

  pauseBtn.addEventListener('click', () => {
    const nextPaused = !engine.paused;
    engine.setPaused(nextPaused);
    pauseBtn.textContent = nextPaused ? 'Play' : 'Pause';
  });

  reseedBtn.addEventListener('click', () => {
    seed = Math.random() * 100;
    engine.setUniform('u_seed', seed);
    if (activeStudy.mode === 'pingpong') engine.resetSimulation();
  });

  function toggleHud() {
    const collapsed = hud.classList.toggle('collapsed');
    toggleHudBtn.textContent = collapsed ? 'Show GUI (H)' : 'Hide (H)';
  }

  const onKeyDown = (e) => {
    if (e.target?.tagName === 'INPUT' && e.target?.type === 'text') return;
    if (e.key === 'h' || e.key === 'H') toggleHud();
    if (e.key === 'p' || e.key === 'P') pauseBtn.click();
    if (e.key === 'r' || e.key === 'R') reseedBtn.click();
  };
  const onResize = () => applyFrameAspect();

  toggleHudBtn.addEventListener('click', toggleHud);
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('resize', onResize);

  applyFrameAspect();
  loadStudy(activeStudy.id);
  engine.setPaused(false);
  engine.start();

  return {
    destroy() {
      isRecording = false;
      thumbSession.destroy();
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('resize', onResize);
      loader.destroy();
      engine.destroy();
      root.innerHTML = '';
    },
  };
}
