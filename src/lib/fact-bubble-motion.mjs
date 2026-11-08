/** Share the existing bounded atmosphere clock; never intercept native scrolling. */
export function createFactBubbleMotion(root) {
  const orbit = root?.querySelector('.ah-home-fact-orbit');
  if (!orbit || !globalThis.CSS?.supports('translate', '0 1px')) return;
  const bubbles = [...orbit.querySelectorAll('.ah-home-fact-bubble')].map((element, index) => ({
    element, strength: .05 + index * .003, phase: index * 1.7, period: 6200 + index * 850, drift: 0, impulse: 0,
    top: 0, left: 0, width: 0, height: 0,
  }));
  const clamp = (value, limit) => Math.max(-limit, Math.min(limit, value));
  let lastScroll = scrollY, geometryDirty = true;
  function mark(element, state) { if (element.dataset.factMotion !== state) element.dataset.factMotion = state; }
  root.addEventListener('artdico:atmosphere-state', event => {
    lastScroll = scrollY; geometryDirty = true;
    for (const bubble of bubbles) {
      mark(bubble.element, event.detail.state === 'active' ? 'paused' : event.detail.state);
      if (event.detail.state === 'reduced' || event.detail.state === 'idle') {
        bubble.element.style.removeProperty('--ah-fact-float');
        bubble.element.style.removeProperty('--ah-fact-scroll');
        bubble.drift = 0; bubble.impulse = 0;
      }
    }
  });
  root.addEventListener('artdico:atmosphere-frame', event => {
    const detail = event.detail, compact = innerWidth <= 820, frame = orbit.getBoundingClientRect();
    const elapsed = Math.min(100, Math.max(0, detail.delta)), step = elapsed / (1000 / 30);
    const scrollDelta = clamp(detail.scrollY - lastScroll, 120); lastScroll = detail.scrollY;
    if (geometryDirty || detail.layoutDirty) {
      for (const bubble of bubbles) {
        const node = bubble.element;
        bubble.top = node.offsetTop; bubble.left = node.offsetLeft;
        bubble.width = node.offsetWidth; bubble.height = node.offsetHeight;
      }
      geometryDirty = false;
    }
    for (const bubble of bubbles) {
      const { element, top, left, width, height } = bubble, y = frame.top + top;
      if (!width || y + height < 0 || y > innerHeight) { mark(element, 'paused'); continue; }
      mark(element, 'active');
      bubble.phase += elapsed / bubble.period * Math.PI * 2;
      const float = Math.sin(bubble.phase) * (compact ? 4 : 8);
      bubble.impulse = clamp(bubble.impulse + scrollDelta * .025, compact ? 2 : 4) * Math.pow(.86, step);
      const target = clamp((innerHeight / 2 - y - height / 2) * bubble.strength, compact ? 6 : 12);
      bubble.drift += (target - bubble.drift) * (1 - Math.pow(.82, step));
      const drift = bubble.drift + bubble.impulse;
      element.style.setProperty('--ah-fact-float', float.toFixed(2) + 'px');
      element.style.setProperty('--ah-fact-scroll', drift.toFixed(2) + 'px');
      // Exclude the complete moving circle from background stars, including text.
      detail.spheres.push({ x: frame.left + left + width / 2, y: y + height / 2 + float + drift, rx: width / 2, ry: height / 2 });
    }
  });
}
