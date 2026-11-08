/** Only public, decoded portraits; one bounded timer and a local on/off preference. */
export function createGuestPhotoRotation({ document: doc, window: win, buttons, manual, render }) {
  const input = doc.querySelector('[data-guest-photo-rotation]');
  const section = input?.closest('section');
  if (!input || !section) return { clear() {}, refresh() {} };
  const reduced = win.matchMedia('(prefers-reduced-motion: reduce)');
  const key = 'artdico_guest_photo_rotation';
  let enabled = true, timer = null, active = new Set();
  try { const saved = win.localStorage.getItem(key); if (saved !== null) enabled = saved === 'true'; } catch { /* optional preference */ }
  const visible = button => { const r = button.getBoundingClientRect(); return r.width > 0 && r.bottom > 0 && r.top < win.innerHeight; };
  function clear() {
    for (const button of active) render(button, false);
    active.clear();
  }
  function allowed() {
    return input.checked && !reduced.matches && !doc.hidden && buttons().some(visible) &&
      !buttons().some(button => manual(button) || button === doc.activeElement || button.matches(':hover'));
  }
  function refresh() {
    for (const button of [...active]) if (!button.isConnected || !visible(button)) { active.delete(button); render(button, false); }
    if (!allowed()) { win.clearTimeout(timer); timer = null; clear(); return; }
    if (timer !== null) return;
    timer = win.setTimeout(() => {
      timer = null;
      if (!allowed()) { refresh(); return; }
      const previous = active;
      const eligible = buttons().filter(button => button.dataset.photoReady === 'true' && visible(button) && !previous.has(button));
      clear();
      const count = win.innerWidth < 821 ? 1 : 2;
      for (let i = 0; i < count && eligible.length; i++) {
        const [button] = eligible.splice(Math.floor(Math.random() * eligible.length), 1);
        active.add(button); render(button, true);
      }
      refresh();
    }, 4000);
  }
  input.addEventListener('change', () => {
    enabled = input.checked;
    try { win.localStorage.setItem(key, String(enabled)); } catch { /* optional preference */ }
    refresh();
  });
  for (const event of ['artdico:guests-rendered', 'artdico:guest-photo-change', 'visibilitychange']) doc.addEventListener(event, refresh);
  for (const event of ['focusin', 'focusout', 'pointerover', 'pointerout']) section.addEventListener(event, () => win.queueMicrotask(refresh));
  win.addEventListener('scroll', refresh, { passive: true });
  win.addEventListener('resize', refresh);
  win.addEventListener('pagehide', () => { win.clearTimeout(timer); timer = null; clear(); });
  win.addEventListener('pageshow', refresh);
  function syncPreference() { input.disabled = reduced.matches; input.checked = enabled && !reduced.matches; refresh(); }
  reduced.addEventListener('change', syncPreference);
  syncPreference();
  return { clear, refresh };
}
