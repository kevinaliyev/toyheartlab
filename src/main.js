const root = document.getElementById('app-root');
let activeApp = null;
let routeToken = 0;

const TOOLS = [
  {
    id: 'lab',
    index: '01',
    title: 'Lab',
    subtitle: 'Procedural Shader Studies & Exporter',
    description:
      'Author, tune, save presets, and export self-contained WebGL2 fragment & ping-pong shaders.',
    loader: () => import('./apps/lab-app.js'),
  },
  {
    id: 'sandbox',
    index: '02',
    title: 'Sandbox',
    subtitle: 'Interactive 2D Fields & Ferrofluid Dish',
    description:
      'Spawn, drag, and orbit 2D magnetic poles over finite-volume ferrofluid and fluid advection shaders.',
    loader: () => import('./apps/sandbox-app.js'),
  },
  {
    id: 'arena',
    index: '03',
    title: 'Arena',
    subtitle: '2D Gimmick Ball Battler',
    description:
      'Simulate autonomous 2D fighters with unique weapons, parries, physics rules, and reactive shader backdrops.',
    loader: () => import('./apps/arena-app.js'),
  },
];

function teardownActiveApp() {
  if (activeApp) {
    try {
      activeApp.destroy?.();
    } catch {
      // Ignore teardown errors
    }
    activeApp = null;
  }
}

const HOME_SHADERS = [
  () => import('./shaders/zebra-runway.js').then((m) => m.zebraRunwayStudy),
  () => import('./shaders/fluid-advect.js').then((m) => m.fluidAdvectStudy),
  () => import('./shaders/fractal-prng.js').then((m) => m.fractalPrngStudy),
  () => import('./shaders/noise-signal.js').then((m) => m.noiseSignalStudy),
];

async function renderHome(token) {
  document.title = 'toyheart.';
  root.innerHTML = `
    <main class="home-screen">
      <canvas id="home-bg-canvas" class="home-bg-canvas"></canvas>
      <a href="#toybox" class="home-wordmark" aria-label="Enter Toybox">toyheart.</a>
    </main>
  `;

  const canvas = root.querySelector('#home-bg-canvas');
  if (!canvas) return;

  try {
    const lastIdx = Number(sessionStorage.getItem('toyheart.lastHomeShaderIdx'));
    const candidates = HOME_SHADERS.map((loader, idx) => ({ loader, idx })).filter(
      (item) => item.idx !== lastIdx
    );
    const chosen = candidates[Math.floor(Math.random() * candidates.length)] || {
      loader: HOME_SHADERS[0],
      idx: 0,
    };
    sessionStorage.setItem('toyheart.lastHomeShaderIdx', String(chosen.idx));
    const pick = chosen.loader;
    const [{ GLEngine }, { PALETTES, GRADIENTS }, study] = await Promise.all([
      import('./gl-engine.js'),
      import('./palettes.js'),
      pick(),
    ]);
    if (token !== routeToken) return;

    const engine = new GLEngine(canvas);
    engine.setRenderScale(0.75);
    engine.setMaxFps(30);

    let destroyed = false;
    activeApp = {
      destroy() {
        destroyed = true;
        window.removeEventListener('resize', onResize);
        engine.destroy();
      },
    };
    const onResize = () => engine.resize();
    window.addEventListener('resize', onResize);

    if (study.mode === 'pingpong') {
      await engine.loadPingPongShadersAsync(study.simShader, study.displayShader);
    } else {
      await engine.loadFragmentShaderAsync(study.fragmentShader);
    }
    if (destroyed || token !== routeToken) {
      engine.destroy();
      return;
    }

    const palList = Object.values(PALETTES);
    const pal = palList[Math.floor(Math.random() * palList.length)];
    const gradList = Object.values(GRADIENTS);
    const grad = gradList[Math.floor(Math.random() * gradList.length)];

    engine.setUniform('u_seed', Math.random() * 100);
    engine.setUniform('u_colorDark', pal.dark);
    engine.setUniform('u_colorMid', pal.mid);
    engine.setUniform('u_colorLight', pal.light);
    engine.setUniform('u_useGradient', grad.useSeed ? 0.0 : 1.0);
    engine.setUniform('u_gradA', grad.a);
    engine.setUniform('u_gradB', grad.b);
    engine.setUniform('u_gradC', grad.c);
    engine.setUniform('u_gradD', grad.d);

    for (const p of study.params || []) {
      let val = p.type === 'toggle' ? (p.default ? 1 : 0) : p.default;
      if (p.type === 'select' && p.options?.length) {
        val = p.options[Math.floor(Math.random() * p.options.length)].value;
      }
      engine.setUniform(p.key, val);
    }

    engine.setPaused(false);
    engine.start();
  } catch {
    // Fallback cleanly to archival background if WebGL is unavailable
  }
}

function renderToybox() {
  document.title = 'toyheart. // toybox';
  const cardsHtml = TOOLS.map(
    (tool) => `
      <a href="#${tool.id}" class="toybox-card">
        <div class="toybox-card-top">
          <span class="toybox-index">${tool.index}</span>
          <span class="toybox-arrow">→</span>
        </div>
        <h2 class="toybox-card-title">${tool.title}</h2>
        <div class="toybox-card-sub">${tool.subtitle}</div>
        <p class="toybox-card-desc">${tool.description}</p>
      </a>
    `
  ).join('');

  root.innerHTML = `
    <main class="toybox-screen">
      <div class="toybox-shell">
        <header class="toybox-header">
          <a href="#" class="toybox-brand">toyheart.</a>
          <span class="toybox-slash">//</span>
          <span class="toybox-section-label">toybox</span>
        </header>

        <div class="toybox-grid">
          ${cardsHtml}
        </div>
      </div>
    </main>
  `;
}

async function handleRoute() {
  const token = ++routeToken;
  const hash = (window.location.hash || '').replace(/^#\/?/, '').trim().toLowerCase();

  teardownActiveApp();

  if (!hash) {
    renderHome(token);
    return;
  }

  if (hash === 'toybox') {
    renderToybox();
    return;
  }

  const tool = TOOLS.find((t) => t.id === hash);
  if (!tool) {
    renderToybox();
    return;
  }

  document.title = `toyheart. // ${tool.title.toLowerCase()}`;
  root.innerHTML = `
    <div class="apple-loader-overlay">
      <div class="apple-loader-card">
        <div class="apple-loader-brand">toyheart.</div>
        <div class="apple-loader-track">
          <div class="apple-loader-fill" style="width: 18%;"></div>
        </div>
        <div class="apple-loader-label">Loading ${tool.title}...</div>
      </div>
    </div>
  `;

  try {
    const mod = await tool.loader();
    if (token !== routeToken) return;
    activeApp = mod.mount(root);
  } catch (err) {
    if (token !== routeToken) return;
    root.innerHTML = `
      <main class="toybox-screen">
        <div class="toybox-shell">
          <p>Failed to load ${tool.title}: ${err.message}</p>
          <a href="#toybox" class="hud-back">← Back to Toybox</a>
        </div>
      </main>
    `;
  }
}

window.addEventListener('hashchange', handleRoute);
handleRoute();
