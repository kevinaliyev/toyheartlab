/**
 * Global cross-shader Filters deck (Resolution Scaler, Nearest-Neighbor Pixelate,
 * Contrast, Saturation, Hue Shift). Persists across shader switches.
 */
export function buildFiltersDeckHTML() {
  return `
    <details class="builder-details">
      <summary>Filters</summary>
      <div class="builder-section">
        <div class="param-row">
          <div class="param-header">
            <span>Resolution Scale</span>
            <span id="filter-scale-val" class="param-val">1.00x</span>
          </div>
          <input id="filter-scale" type="range" min="0.25" max="2.0" step="0.05" value="1.0" />
        </div>

        <label class="param-row param-toggle-row">
          <span>Crisp Pixelate (Nearest)</span>
          <input id="filter-pixelate" type="checkbox" class="param-toggle" />
        </label>

        <div class="param-row">
          <div class="param-header">
            <span>Contrast</span>
            <span id="filter-contrast-val" class="param-val">1.00</span>
          </div>
          <input id="filter-contrast" type="range" min="0.5" max="1.8" step="0.05" value="1.0" />
        </div>

        <div class="param-row">
          <div class="param-header">
            <span>Saturation</span>
            <span id="filter-sat-val" class="param-val">1.00</span>
          </div>
          <input id="filter-sat" type="range" min="0.0" max="2.0" step="0.05" value="1.0" />
        </div>

        <div class="param-row">
          <div class="param-header">
            <span>Hue Shift</span>
            <span id="filter-hue-val" class="param-val">0°</span>
          </div>
          <input id="filter-hue" type="range" min="0" max="360" step="5" value="0" />
        </div>

        <button id="filter-reset-btn" type="button">Reset Filters</button>
      </div>
    </details>
  `;
}

export function wireFiltersDeck(root, canvas, engine) {
  const scaleSlider = root.querySelector('#filter-scale');
  const scaleVal = root.querySelector('#filter-scale-val');
  const pixelateToggle = root.querySelector('#filter-pixelate');
  const contrastSlider = root.querySelector('#filter-contrast');
  const contrastVal = root.querySelector('#filter-contrast-val');
  const satSlider = root.querySelector('#filter-sat');
  const satVal = root.querySelector('#filter-sat-val');
  const hueSlider = root.querySelector('#filter-hue');
  const hueVal = root.querySelector('#filter-hue-val');
  const resetBtn = root.querySelector('#filter-reset-btn');

  if (!scaleSlider) return { syncScaleDisplay: () => {} };

  function applyCanvasCssFilters() {
    const c = parseFloat(contrastSlider.value);
    const s = parseFloat(satSlider.value);
    const h = parseFloat(hueSlider.value);
    if (c === 1 && s === 1 && h === 0) {
      canvas.style.filter = '';
    } else {
      canvas.style.filter = `contrast(${c}) saturate(${s}) hue-rotate(${h}deg)`;
    }
  }

  scaleSlider.addEventListener('input', () => {
    const v = parseFloat(scaleSlider.value);
    scaleVal.textContent = `${v.toFixed(2)}x`;
    engine.setRenderScale(v);
  });

  pixelateToggle.addEventListener('change', () => {
    canvas.style.imageRendering = pixelateToggle.checked ? 'pixelated' : 'auto';
  });

  contrastSlider.addEventListener('input', () => {
    const v = parseFloat(contrastSlider.value);
    contrastVal.textContent = v.toFixed(2);
    applyCanvasCssFilters();
  });

  satSlider.addEventListener('input', () => {
    const v = parseFloat(satSlider.value);
    satVal.textContent = v.toFixed(2);
    applyCanvasCssFilters();
  });

  hueSlider.addEventListener('input', () => {
    const v = parseFloat(hueSlider.value);
    hueVal.textContent = `${Math.round(v)}°`;
    applyCanvasCssFilters();
  });

  resetBtn.addEventListener('click', () => {
    scaleSlider.value = '1.0';
    scaleVal.textContent = '1.00x';
    engine.setRenderScale(1.0);
    pixelateToggle.checked = false;
    canvas.style.imageRendering = 'auto';
    contrastSlider.value = '1.0';
    contrastVal.textContent = '1.00';
    satSlider.value = '1.0';
    satVal.textContent = '1.00';
    hueSlider.value = '0';
    hueVal.textContent = '0°';
    canvas.style.filter = '';
  });

  return {
    syncScaleDisplay(scale) {
      scaleSlider.value = String(scale);
      scaleVal.textContent = `${Number(scale).toFixed(2)}x`;
    },
  };
}
