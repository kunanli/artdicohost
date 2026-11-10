/** Bounded direct manipulation and a damped spring, on the existing frame clock. */
export function createBubblePhysics(root) {
  if (!root || !globalThis.CSS?.supports('translate', '0 1px')) return;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)'), states = new Map();
  let pointer = null, suppressed = null;
  const targets = () => [...root.querySelectorAll('.ah-guest-bubble,.ah-home-fact-bubble')];
  const wrapper = circle => circle.closest('[data-guest-float]') || circle;
  const notify = () => root.dispatchEvent(new CustomEvent('artdico:bubble-interaction', { bubbles: true }));
  const hint = document.createElement('p'); hint.id = 'bubble-drag-help'; hint.className = 'ah-sr-only';
  hint.textContent = '可拖动气泡，松手回弹。方向键推动，Escape 归位。'; root.append(hint);
  function refresh() {
    for (const [node] of states) if (!node.isConnected) states.delete(node);
    if (pointer && !pointer.circle.isConnected) pointer = null;
    for (const circle of targets()) {
      const node = wrapper(circle);
      if (!states.has(node)) states.set(node, { circle, x: 0, y: 0, vx: 0, vy: 0 });
      circle.setAttribute('aria-describedby', [...new Set((circle.getAttribute('aria-describedby') || '').split(' ').filter(Boolean).concat(hint.id))].join(' '));
      if (circle.matches('.ah-home-fact-bubble')) {
        circle.tabIndex = 0; circle.setAttribute('role', 'group');
        const label = circle.querySelector('strong');
        if (label) { if (!label.id) label.id = 'bubble-label-' + [...root.querySelectorAll('.ah-home-fact-bubble')].indexOf(circle); circle.setAttribute('aria-labelledby', label.id); }
      }
    }
  }
  function clear(node, state) {
    state.x = state.y = state.vx = state.vy = 0;
    node.style.removeProperty('--ah-drag-x'); node.style.removeProperty('--ah-drag-y');
    node.removeAttribute('data-bubble-dragging'); node.removeAttribute('data-bubble-settling');
  }
  function reset() { pointer = null; for (const [node, state] of states) clear(node, state); notify(); }
  function constrain(node, state, x, y) {
    const rect = state.circle.getBoundingClientRect(), left = rect.left - state.x, top = rect.top - state.y;
    const radius = rect.width / 2, limit = Math.min(rect.width * .3, innerWidth <= 820 ? 48 : 90);
    const length = Math.hypot(x, y); if (length > limit) { x *= limit / length; y *= limit / length; }
    x = Math.max(8 - left, Math.min(innerWidth - 8 - left - rect.width, x));
    for (let pass = 0; pass < 3; pass++) for (const circle of targets()) {
      if (circle === state.circle) continue;
      const box = circle.getBoundingClientRect(); if (!box.width || box.bottom < 0 || box.top > innerHeight) continue;
      const dx = left + radius + x - box.left - box.width / 2, dy = top + rect.height / 2 + y - box.top - box.height / 2;
      const distance = Math.hypot(dx, dy), minimum = radius + box.width / 2 + 6;
      if (distance > 0 && distance < minimum) { x += dx / distance * (minimum - distance); y += dy / distance * (minimum - distance); }
    }
    // Resistance cannot carry a bubble outside its own bounded neighbourhood.
    const distance = Math.hypot(x, y); if (distance > limit) { x *= limit / distance; y *= limit / distance; }
    x = Math.max(8 - left, Math.min(innerWidth - 8 - left - rect.width, x));
    return { x, y };
  }
  function apply(node, state, x, y) {
    const next = constrain(node, state, x, y); state.x = next.x; state.y = next.y;
    node.style.setProperty('--ah-drag-x', state.x.toFixed(2) + 'px'); node.style.setProperty('--ah-drag-y', state.y.toFixed(2) + 'px');
  }
  root.addEventListener('pointerdown', event => {
    if (!event.isPrimary || event.button !== 0 || pointer) return;
    const circle = event.target.closest?.('.ah-guest-bubble,.ah-home-fact-bubble'); if (!circle) return;
    refresh(); const node = wrapper(circle), state = states.get(node);
    pointer = { id: event.pointerId, circle, node, state, type: event.pointerType, startX: event.clientX, startY: event.clientY, x: event.clientX, y: event.clientY, originX: state.x, originY: state.y, at: performance.now(), moved: false };
  });
  root.addEventListener('pointermove', event => {
    const p = pointer; if (!p || p.id !== event.pointerId) return;
    const dx = event.clientX - p.startX, dy = event.clientY - p.startY;
    if (!p.moved) {
      if (p.type === 'touch' && Math.abs(dy) > 8 && Math.abs(dy) > Math.abs(dx)) { pointer = null; return; }
      if (Math.hypot(dx, dy) < 7) return;
      p.moved = true; p.node.dataset.bubbleDragging = 'true'; p.node.removeAttribute('data-bubble-settling');
      p.circle.setPointerCapture(event.pointerId); notify();
    }
    if (event.cancelable) event.preventDefault();
    const now = performance.now(), elapsed = Math.max(8, now - p.at);
    p.state.vx = Math.max(-10, Math.min(10, (event.clientX - p.x) / elapsed * 16.67));
    p.state.vy = Math.max(-10, Math.min(10, (event.clientY - p.y) / elapsed * 16.67));
    p.x = event.clientX; p.y = event.clientY; p.at = now;
    apply(p.node, p.state, p.originX + dx * .85, p.originY + dy * .85);
  }, { passive: false });
  function release(event) {
    const p = pointer; if (!p || p.id !== event.pointerId) return;
    pointer = null;
    if (p.circle.hasPointerCapture(event.pointerId)) p.circle.releasePointerCapture(event.pointerId);
    if (!p.moved) return;
    suppressed = { circle: p.circle, until: performance.now() + 450 };
    p.node.removeAttribute('data-bubble-dragging');
    if (reduced.matches || root.dataset.atmosphereState !== 'active') clear(p.node, p.state);
    else p.node.dataset.bubbleSettling = 'true';
    notify();
  }
  for (const type of ['pointerup', 'pointercancel']) root.addEventListener(type, release);
  root.addEventListener('lostpointercapture', event => {
    // Touch starts with implicit capture on a text span. Moving capture to
    // its circle must not be mistaken for the end of that same gesture.
    if (pointer && event.target === pointer.circle && !pointer.circle.hasPointerCapture(event.pointerId)) release(event);
  });
  root.addEventListener('click', event => {
    if (event.detail > 0 && suppressed && performance.now() < suppressed.until && suppressed.circle.contains(event.target)) {
      event.preventDefault(); event.stopImmediatePropagation(); suppressed = null;
    }
  }, true);
  root.addEventListener('keydown', event => {
    if (event.key === 'Escape') { reset(); return; }
    const circle = event.target.closest?.('.ah-guest-bubble,.ah-home-fact-bubble');
    if (!circle || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
    event.preventDefault(); refresh(); const node = wrapper(circle), state = states.get(node);
    const dx = event.key === 'ArrowRight' ? 20 : event.key === 'ArrowLeft' ? -20 : 0;
    const dy = event.key === 'ArrowDown' ? 20 : event.key === 'ArrowUp' ? -20 : 0;
    apply(node, state, state.x + dx, state.y + dy); state.vx = dx * .15; state.vy = dy * .15;
    if (reduced.matches || root.dataset.atmosphereState !== 'active') clear(node, state); else node.dataset.bubbleSettling = 'true';
    notify();
  });
  root.addEventListener('artdico:atmosphere-frame', event => {
    const step = Math.min(3, Math.max(.1, event.detail.delta / 16.67));
    for (const [node, state] of states) {
      if (!node.isConnected) { states.delete(node); continue; }
      if (node.hasAttribute('data-bubble-settling')) {
        const box = state.circle.getBoundingClientRect();
        if (box.bottom < 0 || box.top > innerHeight) { clear(node, state); notify(); continue; }
        state.vx = (state.vx - state.x * .045 * step) * Math.pow(.78, step);
        state.vy = (state.vy - state.y * .045 * step) * Math.pow(.78, step);
        apply(node, state, state.x + state.vx * step, state.y + state.vy * step);
        if (Math.hypot(state.x, state.y, state.vx, state.vy) < .2) { clear(node, state); notify(); }
      }
      if ((state.x || state.y) && !state.circle.matches('.ah-home-fact-bubble')) {
        const box = state.circle.getBoundingClientRect();
        event.detail.spheres.push({ x: box.x + box.width / 2, y: box.y + box.height / 2, rx: box.width / 2, ry: box.height / 2 });
      }
    }
  });
  root.addEventListener('artdico:atmosphere-state', event => { if (event.detail.state !== 'active') reset(); });
  root.addEventListener('artdico:guests-rendered', refresh);
  window.addEventListener('resize', reset, { passive: true });
  refresh();
}
