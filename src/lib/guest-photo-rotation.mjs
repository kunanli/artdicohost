/** Automatic public portraits only; old on/off preferences no longer apply. */
export function createGuestPhotoRotation({ document: doc, window: win, buttons, manual, render }) {
  const section = doc.querySelector('#guests');
  if (!section) return { clear() {}, refresh() {}, exclude() {} };
  const reduced = win.matchMedia('(prefers-reduced-motion: reduce)');
  let timer = null, active = new Set(), started = false, enabled = true;
  const visible = button => { const r = button.getBoundingClientRect(); return r.width > 0 && Math.min(r.bottom, win.innerHeight) - Math.max(r.top, 0) >= Math.min(r.height * .35, 80); };
  const busy = button => manual(button) || button === doc.activeElement ||
    button.closest('[data-bubble-dragging],[data-bubble-settling]') ||
    win.matchMedia('(hover:hover) and (pointer:fine)').matches && button.matches(':hover');
  const interactive = () => buttons().some(busy);
  const amount = count => Math.min(count > 2 ? count - 1 : count, Math.ceil(count * .65));
  function fillAroundInteraction() {
    const eligible = buttons().filter(button => button.dataset.photoReady === 'true' && visible(button) && !busy(button));
    const pool = eligible.filter(button => !active.has(button));
    let shown = eligible.filter(button => active.has(button)).length;
    while (shown < amount(eligible.length) && pool.length) {
      const button = pool.splice(Math.floor(Math.random() * pool.length), 1)[0];
      active.add(button); render(button, true); shown++;
    }
  }
  function clear() {
    for (const button of active) render(button, false);
    active.clear();
  }
  function exclude(button) { if (active.delete(button)) render(button, false); }
  function refresh() {
    for (const button of [...active]) if (!button.isConnected || !visible(button) || button.dataset.photoReady !== 'true') exclude(button);
    if (!enabled || reduced.matches || doc.hidden || !buttons().some(visible)) {
      win.clearTimeout(timer); timer = null; clear(); return;
    }
    // Freeze the current mix while a visitor interacts; other portraits stay visible.
    if (interactive()) { win.clearTimeout(timer); timer = null; fillAroundInteraction(); return; }
    if (timer !== null) return;
    timer = win.setTimeout(() => {
      timer = null;
      if (interactive() || reduced.matches || doc.hidden || !enabled) { refresh(); return; }
      const eligible = buttons().filter(button => button.dataset.photoReady === 'true' && visible(button));
      const fresh = eligible.filter(button => !active.has(button)), previous = eligible.filter(button => active.has(button));
      const next = new Set(), count = amount(eligible.length);
      while (next.size < count) {
        const pool = fresh.length ? fresh : previous;
        if (!pool.length) break;
        next.add(pool.splice(Math.floor(Math.random() * pool.length), 1)[0]);
      }
      for (const button of active) if (!next.has(button)) render(button, false);
      for (const button of next) if (!active.has(button)) render(button, true);
      active = next; started = true; refresh();
    }, started ? 2800 : 1200);
  }
  for (const event of ['artdico:guests-rendered', 'artdico:guest-photo-change', 'visibilitychange', 'artdico:bubble-interaction']) doc.addEventListener(event, refresh);
  for (const event of ['focusin', 'focusout', 'pointerover', 'pointerout']) section.addEventListener(event, () => win.queueMicrotask(refresh));
  win.addEventListener('scroll', refresh, { passive: true });
  win.addEventListener('resize', refresh);
  win.addEventListener('pagehide', () => { enabled = false; win.clearTimeout(timer); timer = null; clear(); });
  win.addEventListener('pageshow', () => { enabled = true; refresh(); });
  reduced.addEventListener('change', refresh);
  refresh();
  return { clear, refresh, exclude };
}
