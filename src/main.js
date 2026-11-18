import {
  getThumbnail,
  exportRepoThumbnails,
  pickRepoThumbnailsPath,
  getLinkedThumbnailsName,
} from './core/thumbnail-store.js';

const root = document.getElementById('app-root');
let activeApp = null;
let routeToken = 0;

const HOME_OPTIONS = [
  {
    id: 'lab',
    index: '01',
    title: 'Lab',
    subtitle: 'Procedural Shader Viewer & Preset Store',
    description: 'Configure uninteractive shaders.',
  },
  {
    id: 'sandbox',
    index: '02',
    title: 'Sandbox',
    subtitle: 'Interactive 2D Fields & Ferrofluid Dish',
    description: 'Interact with shader modules using sandbox controllers.',
  },
  {
    id: 'toybox',
    index: '03',
    title: 'Toybox',
    subtitle: 'Standalone Apps & Mini-Experiences',
    description: 'Toys :)',
  },
];

const SANDBOX_MODULES = [
  {
    id: 'sandbox/ferrofluid',
    thumbKey: 'sandbox:ferrofluid',
    index: '01',
    title: 'Magnetic Ferrofluid',
    subtitle: '2.5D / Raymarched 3D SDF Dish',
    description: 'Drag, raise, and orbit 3D magnetic poles over ferrofluid bridges and Rosensweig spikes.',
  },
  {
    id: 'sandbox/fluid-advect',
    thumbKey: 'sandbox:fluid-advect',
    index: '02',
    title: 'Fluid Advection',
    subtitle: 'Ping-Pong Curl-Noise Fluid',
    description: 'Sculpt divergence-free dye currents with live cursor fields and orbiting emitters.',
  },
  {
    id: 'sandbox/bubble-screen',
    thumbKey: 'sandbox:bubble-screen',
    index: '03',
    title: 'Bubble Screen',
    subtitle: 'Thin-Film Soap Bubbles',
    description: 'Pop iridescent bubbles into mist rings using draggable or orbiting 2D objects.',
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
  {
    id: 'gif-builder',
    index: '02',
    title: 'Loop / GIF Studio',
    subtitle: 'WebM Loop & WebP Spritesheet Builder',
    description:
      'Frame, boomerang-loop, stamp, and export Lab shaders into compact WebM loops, WebP frames, and spritesheet atlases.',
  },
];

const APPS = [
  { id: 'lab', title: 'Lab', backHref: '#home', backLabel: 'Home', loader: () => import('./apps/lab-app.js') },
  { id: 'sandbox', title: 'Sandbox', backHref: '#home', backLabel: 'Home', loader: () => import('./apps/sandbox-app.js') },
  { id: 'arena', title: 'Arena', backHref: '#toybox', backLabel: 'Toybox', loader: () => import('./apps/arena-app.js') },
  {
    id: 'gif-builder',
    title: 'Loop / GIF Studio',
    backHref: '#toybox',
    backLabel: 'Toybox',
    loader: () => import('./apps/gif-builder-app.js'),
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
  () => import('./shaders/watercolor.js').then((m) => m.watercolorStudy),
  () => import('./shaders/charcoal.js').then((m) => m.charcoalStudy),
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

    let destroyed = false;
    let engine = new GLEngine(canvas);
    engine.setRenderScale(0.75);
    engine.setMaxFps(30);

    const onResize = () => engine?.resize();
    const onKeyDown = (e) => {
      if (e.key === 'r' || e.key === 'R') {
        teardownActiveApp();
        renderSplash(routeToken);
      } else if (e.key === 'p' || e.key === 'P') {
        if (engine) {
          engine.destroy();
          engine = null;
        }
        canvas.hidden = true;
      }
    };

    activeApp = {
      destroy() {
        destroyed = true;
        window.removeEventListener('resize', onResize);
        window.removeEventListener('keydown', onKeyDown);
        engine?.destroy();
        engine = null;
      },
    };
    window.addEventListener('resize', onResize);
    window.addEventListener('keydown', onKeyDown);

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

    const homeSeed = Math.random() * 100;
    const homeParams = {};
    engine.setUniform('u_seed', homeSeed);
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
      homeParams[p.key] = val;
      engine.setUniform(p.key, val);
    }

    if (study.pigmentScale) {
      const { defaults, uniformPrefix, toUniform } = study.pigmentScale;
      defaults.forEach((d, idx) => {
        engine.setUniform(`${uniformPrefix}${idx}`, toUniform(d.hex));
      });
    }

    if (study.onFrame) {
      engine.setFrameHook((elapsed) => {
        study.onFrame(engine, elapsed, homeParams, homeSeed);
      });
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
      let thumb = getThumbnail(item.thumbKey || `app:${item.id}`);
      if (!thumb && item.id === 'toybox') {
        thumb = getThumbnail('app:arena') || getThumbnail('app:gif-builder');
      }
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
        ${item.subtitle ? `<div class="toybox-card-sub">${item.subtitle}</div>` : ''}
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
              ? `<div class="toybox-header-actions">
                  <button id="link-thumbs-btn" type="button" class="toybox-link-thumbs" title="Link default-thumbnails.js path on disk">🔗</button>
                  <button id="export-thumbs-btn" type="button" class="toybox-export-thumbs" title="Export thumbnails to linked path (or download)">Export Thumbnails</button>
                </div>`
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
    const linkBtn = root.querySelector('#link-thumbs-btn');
    const exportBtn = root.querySelector('#export-thumbs-btn');

    getLinkedThumbnailsName().then((name) => {
      if (name && linkBtn) {
        linkBtn.title = `Linked: ${name} (click to change)`;
      }
    });

    linkBtn?.addEventListener('click', async () => {
      const res = await pickRepoThumbnailsPath();
      if (res.ok) {
        linkBtn.title = `Linked: ${res.name} (click to change)`;
        if (exportBtn) {
          exportBtn.textContent = `Linked → ${res.name}`;
          setTimeout(() => {
            exportBtn.textContent = 'Export Thumbnails';
          }, 1800);
        }
      }
    });

    exportBtn?.addEventListener('click', async () => {
      const res = await exportRepoThumbnails();
      exportBtn.textContent = res.writtenToDisk ? `Saved → ${res.name}` : 'Downloaded';
      setTimeout(() => {
        exportBtn.textContent = 'Export Thumbnails';
      }, 1800);
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

function renderSandboxMenu() {
  renderMenuScreen({
    sectionLabel: 'sandbox',
    items: SANDBOX_MODULES,
    backLinkHtml: '<a href="#home" class="hud-back" title="Return to Home">← Home</a>',
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

  if (hash === 'sandbox') {
    renderSandboxMenu();
    return;
  }

  if (hash === 'toybox') {
    renderToybox();
    return;
  }

  let appId = hash;
  let mountOptions = {};
  if (hash.startsWith('sandbox/')) {
    appId = 'sandbox';
    mountOptions = {
      initialStudyId: hash.slice('sandbox/'.length),
      autoPlay: true,
    };
  }

  const app = APPS.find((t) => t.id === appId);
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
    activeApp = mod.mount(root, mountOptions);
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
