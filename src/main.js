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

function renderHome() {
  document.title = 'toyheart.';
  root.innerHTML = `
    <main class="home-screen">
      <a href="#toybox" class="home-wordmark" aria-label="Enter Toybox">toyheart.</a>
    </main>
  `;
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
    renderHome();
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
