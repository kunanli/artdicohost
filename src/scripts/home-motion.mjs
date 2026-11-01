// Decorative, finite motion only. The HTML is visible before this enhancement,
// and neither its loading nor an observer controls access to event information.
const root = document.querySelector('#artdico-host.ah-cosmos');
if (root && typeof matchMedia === 'function' && typeof IntersectionObserver === 'function') {
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const seen = new WeakSet(), motions = new Set();
  let observer;
  function cancel() {
    observer?.disconnect();
    for (const motion of motions) motion.cancel();
    motions.clear();
  }
  function animate(element, frames, options) {
    if (reduced.matches || document.hidden || typeof element.animate !== 'function') return;
    const motion = element.animate(frames, options);
    motions.add(motion);
    motion.finished.then(() => motions.delete(motion), () => motions.delete(motion));
  }
  function observe() {
    cancel();
    if (reduced.matches || document.hidden) return;
    observer = new IntersectionObserver(entries => {
      for (const entry of entries) {
        if (!entry.isIntersecting || seen.has(entry.target)) continue;
        seen.add(entry.target);
        observer.unobserve(entry.target);
        const artwork = entry.target.matches('.ah-home-hero-planet') ? entry.target.querySelector('img') : null;
        if (artwork) animate(artwork, [{ transform: 'rotate(-12deg)' }, { transform: 'rotate(348deg)' }], { duration: 12000, easing: 'linear' });
        else animate(entry.target, [{ opacity: .65, transform: 'translateY(16px)' }, { opacity: 1, transform: 'translateY(0)' }], { duration: 600, easing: 'ease-out' });
      }
    }, { threshold: .18 });
    for (const item of root.querySelectorAll('.ah-home-hero-planet,.ah-section-heading,.ah-home-program-planet,.ah-home-footer-message')) {
      if (!seen.has(item)) observer.observe(item);
    }
  }
  for (const planet of root.querySelectorAll('.ah-home-program-planet')) {
    planet.addEventListener('pointerenter', event => {
      if (event.pointerType !== 'mouse' || reduced.matches) return;
      const artwork = planet.querySelector('.ah-home-program-art');
      if (artwork) animate(artwork, [{ transform: 'rotate(0)' }, { transform: 'rotate(360deg)' }], { duration: 14000, easing: 'linear' });
    });
  }
  reduced.addEventListener('change', observe);
  document.addEventListener('visibilitychange', observe);
  window.addEventListener('pagehide', cancel);
  window.addEventListener('pageshow', observe);
  observe();
}
