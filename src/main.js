import { getThumbnail, downloadRepoThumbnailsModule } from './core/thumbnail-store.js';

const root = document.getElementById('app-root');
let activeApp = null;
let routeToken = 0;

const HOME_OPTIONS = [
  {
    id: 'lab',
    index: '01',
    title: 'Lab',
    subtitle: 'Procedural Shader Studies & Exporter',
    description:
      'Author, tune, save presets, and export self-contained WebGL2 fragment & ping-pong shaders.',
  },
  {
    id: 'sandbox',
    index: '02',
    title: 'Sandbox',
    subtitle: 'Interactive 2D Fields & Ferrofluid Dish',
    description:
      'Spawn, drag, and orbit 2D magnetic poles over finite-volume ferrofluid and fluid advection shaders.',
  },
  {
    id: 'toybox',
    index: '03',
    title: 'Toybox',
    subtitle: 'Standalone Apps & Mini-Experiences',
    description:
      'Launch self-contained interactive toys, simulations, and arena experiments built on toyheart.',
  },
];

const TOYBOX_APPS = [
  {
    id: 'arena',
    index: '01',
    title: 'Arena',
    subtitle: '2D Gimmick Ball Battler',
    description:
      'Simulate autonomous 2D fighters with unique weapons, parries, physics rules, and reactive shader backdrops.',
  },
];

const APPS = [
  { id: 'lab', title: 'Lab', backHref: '#home', backLabel: 'Home', loader: () => import('./apps/lab-app.js') },
  { id: 'sandbox', title: 'Sandbox', backHref: '#home', backLabel: 'Home', loader: () => import('./apps/sandbox-app.js') },
  { id: 'arena', title: 'Arena', backHref: '#toybox', backLabel: 'Toybox', loader: () => import('./apps/arena-app.js') },
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
  () => import('./shaders/bubble-screen.js').then((m) => m.bubbleScreenStudy),
  () => import('./shaders/underwater.js').then((m) => m.underwaterStudy),
  () => import('./shaders/falling-objects.js').then((m) => m.fallingObjectsStudy),
];

async function renderSplash(token) {
  document.title = 'toyheart.';
  root.innerHTML = `
    <main class="home-screen">
      <canvas id="home-bg-canvas" class="home-bg-canvas"></canvas>
      <a href="#home" class="home-wordmark" aria-label="Enter Home">toyheart.</a>
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

function renderMenuScreen({ sectionLabel, items, backLinkHtml = '', showExportThumbs = false }) {
  document.title = `toyheart. // ${sectionLabel}`;
  const cardsHtml = items
    .map((item) => {
      const thumb = getThumbnail(`app:${item.id}`);
      const thumbHtml = thumb
        ? `<div class="toybox-card-thumb"><img src="${thumb}" alt="${item.title} preview" loading="lazy" /></div>`
        : '';
      return `
      <a href="#${item.id}" class="toybox-card">
        <div class="toybox-card-top">
          <span class="toybox-index">${item.index}</span>
          <span class="toybox-arrow">→</span>
        </div>
        ${thumbHtml}
        <h2 class="toybox-card-title">${item.title}</h2>
        <div class="toybox-card-sub">${item.subtitle}</div>
        <p class="toybox-card-desc">${item.description}</p>
      </a>
    `;
    })
    .join('');

  root.innerHTML = `
    <main class="toybox-screen">
      <div class="toybox-shell">
        <header class="toybox-header">
          <div class="toybox-header-left">
            ${backLinkHtml}
            <a href="#splash" class="toybox-brand">toyheart.</a>
            <span class="toybox-slash">//</span>
            <span class="toybox-section-label">${sectionLabel}</span>
          </div>
          ${
            showExportThumbs
              ? '<button id="export-thumbs-btn" type="button" class="toybox-export-thumbs" title="Download default-thumbnails.js for src/thumbnails/">Export Thumbnails</button>'
              : ''
          }
        </header>

        <div class="toybox-grid">
          ${cardsHtml}
        </div>
      </div>
    </main>
  `;

  if (showExportThumbs) {
    root.querySelector('#export-thumbs-btn')?.addEventListener('click', () => {
      downloadRepoThumbnailsModule();
    });
  }
}

function renderHomeMenu() {
  renderMenuScreen({
    sectionLabel: 'home',
    items: HOME_OPTIONS,
    showExportThumbs: true,
  });
}

function renderToybox() {
  renderMenuScreen({
    sectionLabel: 'toybox',
    items: TOYBOX_APPS,
    backLinkHtml: '<a href="#home" class="hud-back" title="Return to Home">← Home</a>',
  });
}

async function handleRoute() {
  const token = ++routeToken;
  const hash = (window.location.hash || '').replace(/^#\/?/, '').trim().toLowerCase();

  teardownActiveApp();

  if (!hash || hash === 'home') {
    renderHomeMenu();
    return;
  }

  if (hash === 'splash') {
    renderSplash(token);
    return;
  }

  if (hash === 'toybox') {
    renderToybox();
    return;
  }

  const app = APPS.find((t) => t.id === hash);
  if (!app) {
    renderHomeMenu();
    return;
  }

  document.title = `toyheart. // ${app.title.toLowerCase()}`;
  root.innerHTML = `
    <div class="apple-loader-overlay">
      <div class="apple-loader-card">
        <div class="apple-loader-brand">toyheart.</div>
        <div class="apple-loader-track">
          <div class="apple-loader-fill" style="width: 18%;"></div>
        </div>
        <div class="apple-loader-label">Loading ${app.title}...</div>
      </div>
    </div>
  `;

  try {
    const mod = await app.loader();
    if (token !== routeToken) return;
    activeApp = mod.mount(root);
  } catch (err) {
    if (token !== routeToken) return;
    root.innerHTML = `
      <main class="toybox-screen">
        <div class="toybox-shell">
          <p>Failed to load ${app.title}: ${err.message}</p>
          <a href="${app.backHref}" class="hud-back">← Back to ${app.backLabel}</a>
        </div>
      </main>
    `;
  }
}

window.addEventListener('hashchange', handleRoute);
handleRoute();
