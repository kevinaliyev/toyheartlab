/**
 * Traditional Apple / iOS-style slim pill progress bar overlay.
 * Renders cleanly above the canvas while heavy WebGL2 shaders compile in the background.
 */
export function createLoadingOverlay(container) {
  const el = document.createElement('div');
  el.className = 'apple-loader-overlay';
  el.hidden = true;
  el.innerHTML = `
    <div class="apple-loader-card">
      <div class="apple-loader-brand">toyheart.</div>
      <div class="apple-loader-track">
        <div class="apple-loader-fill"></div>
      </div>
      <div class="apple-loader-label">Preparing shader...</div>
    </div>
  `;
  container.appendChild(el);

  const fill = el.querySelector('.apple-loader-fill');
  const labelEl = el.querySelector('.apple-loader-label');
  let hideTimer = null;

  return {
    show(label = 'Compiling shader...', progress = 12) {
      if (hideTimer) {
        clearTimeout(hideTimer);
        hideTimer = null;
      }
      el.hidden = false;
      el.classList.remove('fade-out');
      labelEl.textContent = label;
      fill.style.width = `${Math.max(4, Math.min(100, progress))}%`;
    },
    setProgress(progress, label = null) {
      if (label !== null) labelEl.textContent = label;
      fill.style.width = `${Math.max(4, Math.min(100, progress))}%`;
    },
    hide() {
      fill.style.width = '100%';
      el.classList.add('fade-out');
      hideTimer = setTimeout(() => {
        el.hidden = true;
        el.classList.remove('fade-out');
      }, 220);
    },
    destroy() {
      if (hideTimer) clearTimeout(hideTimer);
      el.remove();
    },
  };
}
