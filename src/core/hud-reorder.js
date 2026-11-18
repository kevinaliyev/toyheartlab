/**
 * Reorderable HUD Deck Manager with a Lock/Unlock toggle in `.hud-bar`.
 * - When locked (default), all controls & collapsible tabs work normally.
 * - When unlocked, top-level HUD sections inside `.hud-body` can be dragged and
 *   reordered vertically, persisting the order per mini-app in localStorage.
 */
export function initHudReorder({ hud, hudBody, lockBtn, storageKey }) {
  if (!hud || !hudBody || !lockBtn) return;

  let unlocked = false;
  let draggedEl = null;

  // Assign stable IDs to reorderable children of .hud-body (skipping pinned .hud-transport)
  const items = Array.from(hudBody.children).filter(
    (el) => !el.classList.contains('hud-transport')
  );
  items.forEach((el, idx) => {
    if (!el.dataset.deckId) {
      const summaryText = el.querySelector('summary')?.textContent?.trim();
      el.dataset.deckId =
        el.id ||
        (summaryText
          ? summaryText.toLowerCase().replace(/[^a-z0-9]+/g, '-')
          : `deck-${idx}`);
    }
    el.classList.add('hud-deck-item');
  });

  // Restore saved order
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey) || '[]');
    if (Array.isArray(saved) && saved.length > 0) {
      const byId = new Map(items.map((el) => [el.dataset.deckId, el]));
      for (const id of saved) {
        const el = byId.get(id);
        if (el) hudBody.appendChild(el);
      }
      for (const el of items) {
        if (!saved.includes(el.dataset.deckId)) hudBody.appendChild(el);
      }
    }
  } catch {
    // Ignore malformed saved order
  }

  function saveOrder() {
    try {
      const order = Array.from(hudBody.children)
        .filter((el) => el.dataset.deckId)
        .map((el) => el.dataset.deckId);
      localStorage.setItem(storageKey, JSON.stringify(order));
    } catch {
      // Ignore storage quota errors
    }
  }

  function setUnlocked(next) {
    unlocked = next;
    hud.classList.toggle('hud-reordering', unlocked);
    lockBtn.textContent = unlocked ? '🔓' : '🔒';
    lockBtn.title = unlocked ? 'Lock tab order' : 'Unlock to reorder tabs';
    lockBtn.setAttribute('aria-pressed', String(unlocked));

    for (const el of hudBody.children) {
      if (!el.dataset.deckId) continue;
      el.draggable = unlocked;
    }
  }

  lockBtn.addEventListener('click', () => setUnlocked(!unlocked));

  hudBody.addEventListener('dragstart', (e) => {
    if (!unlocked) {
      e.preventDefault();
      return;
    }
    const item = e.target.closest?.('.hud-deck-item');
    if (!item || item.parentElement !== hudBody) return;
    draggedEl = item;
    item.classList.add('hud-dragging');
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', item.dataset.deckId || '');
  });

  hudBody.addEventListener('dragover', (e) => {
    if (!unlocked || !draggedEl) return;
    e.preventDefault();
    const target = e.target.closest?.('.hud-deck-item');
    if (!target || target === draggedEl || target.parentElement !== hudBody) return;

    const rect = target.getBoundingClientRect();
    const after = e.clientY > rect.top + rect.height * 0.5;
    if (after) {
      hudBody.insertBefore(draggedEl, target.nextSibling);
    } else {
      hudBody.insertBefore(draggedEl, target);
    }
  });

  hudBody.addEventListener('dragend', () => {
    if (draggedEl) {
      draggedEl.classList.remove('hud-dragging');
      draggedEl = null;
      saveOrder();
    }
  });

  setUnlocked(false);
}
