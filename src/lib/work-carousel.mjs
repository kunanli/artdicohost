import EmblaCarousel from 'embla-carousel';

/** Centre the published cards without cloning records, images, or stable IDs. */
export function createWorkCarousel({ grid, window: win = globalThis.window } = {}) {
  const stage = grid?.closest('.ah-work-stage');
  if (!grid || !stage || !win) return { prepare() {}, update() {}, select() {}, current: () => null };
  const reduced = win.matchMedia('(prefers-reduced-motion: reduce)');
  const doc = grid.ownerDocument;
  let autoplay = null, dragging = false;
  const visible = () => { const r = stage.getBoundingClientRect(); return r.width > 0 && r.bottom > 0 && r.top < win.innerHeight; };
  function playback() {
    win.clearTimeout(autoplay); autoplay = null;
    if (!carousel || slides.length < 2 || reduced.matches || doc.hidden || !visible() || dragging || wheelLocked ||
        stage.matches(':hover') || stage.contains(doc.activeElement) || doc.querySelector('[data-work-lightbox][open]')) return;
    autoplay = win.setTimeout(() => {
      autoplay = null;
      if (carousel.canScrollNext()) carousel.scrollNext(); else carousel.scrollTo(0);
      playback();
    }, 2500);
  }
  let carousel = null, slides = [], selectedId = null, wheel = 0, wheelLocked = false, wheelTimer = null;
  const originalTabindex = new WeakMap();
  const cards = () => [...grid.querySelectorAll(':scope > [data-showcase-id]')].filter(card => !card.hidden);
  function markActive() {
    if (carousel) selectedId = slides[carousel.selectedScrollSnap()]?.dataset.showcaseId ?? null;
    grid.dataset.currentWork = selectedId ?? '';
    for (const card of slides) {
      const active = card.dataset.showcaseId === selectedId;
      card.dataset.workActive = String(active);
      if (active) card.setAttribute('aria-current', 'true'); else card.removeAttribute('aria-current');
      for (const control of card.querySelectorAll('button,a[href]')) {
        if (!originalTabindex.has(control)) originalTabindex.set(control, control.getAttribute('tabindex'));
        const value = active || !carousel ? originalTabindex.get(control) : '-1';
        if (value === null) control.removeAttribute('tabindex'); else control.setAttribute('tabindex', value);
      }
      const preview = card.querySelector('[data-work-preview]'), title = card.querySelector('h3')?.textContent ?? '';
      if (preview) preview.setAttribute('aria-label', active || !carousel ? '查看' + title + '的作品大图' : '居中查看' + title + '的作品');
    }
  }
  function select(id, jump = true) {
    const index = slides.findIndex(card => card.dataset.showcaseId === id);
    if (index < 0) return;
    selectedId = id;
    if (carousel) carousel.scrollTo(index, jump || reduced.matches);
    else {
      const card = slides[index].getBoundingClientRect(), frame = grid.getBoundingClientRect();
      grid.scrollTo({ left: grid.scrollLeft + card.x + card.width / 2 - frame.x - frame.width / 2, behavior: 'instant' });
    }
    markActive();
    playback();
  }
  function sideClick(event) {
    // Embla suppresses the synthetic click following a drag before this handler.
    if (!carousel || event.defaultPrevented) return;
    const card = event.target.closest?.('[data-showcase-id]');
    if (!card || card.dataset.showcaseId === selectedId) return;
    event.preventDefault(); event.stopPropagation(); select(card.dataset.showcaseId, false);
  }
  function prepare() {
    win.clearTimeout(autoplay); autoplay = null; dragging = false;
    if (carousel) selectedId = slides[carousel.selectedScrollSnap()]?.dataset.showcaseId ?? selectedId;
    carousel?.destroy(); carousel = null; slides = [];
    stage.removeEventListener('click', sideClick, true);
    stage.removeAttribute('data-carousel-ready');
    win.clearTimeout(wheelTimer); wheel = 0; wheelLocked = false;
  }
  function update(preferred = selectedId) {
    const next = cards(), index = Math.max(0, next.findIndex(card => card.dataset.showcaseId === preferred));
    if (carousel && next.length === slides.length && next.every((card, i) => card === slides[i])) {
      if (next[index]) select(next[index].dataset.showcaseId);
      return;
    }
    prepare(); slides = next; selectedId = next[index]?.dataset.showcaseId ?? null;
    grid.dataset.galleryReady = 'true'; grid.setAttribute('aria-roledescription', '作品画廊');
    if (next.length) {
      stage.dataset.carouselReady = 'true';
      try {
        carousel = EmblaCarousel(stage, { container: grid, align: 'center', containScroll: false,
          loop: next.length > 2, startIndex: index, duration: 28, watchDrag: next.length > 1, watchSlides: false });
        carousel.on('select', markActive).on('reInit', () => { markActive(); playback(); }).on('pointerDown', () => {
          dragging = true; playback();
        }).on('pointerUp', () => {
          dragging = false;
          if (reduced.matches && carousel) carousel.scrollTo(carousel.selectedScrollSnap(), true);
          playback();
        });
        stage.addEventListener('click', sideClick, true);
      } catch {
        carousel?.destroy(); carousel = null; stage.removeAttribute('data-carousel-ready');
      }
    }
    markActive();
    playback();
  }
  grid.addEventListener('keydown', event => {
    if (event.target !== grid || !['ArrowLeft','ArrowRight','Home','End'].includes(event.key)) return;
    const index = slides.findIndex(card => card.dataset.showcaseId === selectedId);
    const target = event.key === 'Home' ? 0 : event.key === 'End' ? slides.length - 1
      : (index + (event.key === 'ArrowRight' ? 1 : -1) + slides.length) % slides.length;
    if (slides[target]) { event.preventDefault(); select(slides[target].dataset.showcaseId, false); }
  });
  stage.addEventListener('wheel', event => {
    const delta = event.shiftKey && !event.deltaX ? event.deltaY : event.deltaX;
    if (!carousel || slides.length < 2 || !delta || !event.shiftKey && Math.abs(event.deltaX) <= Math.abs(event.deltaY)) return;
    event.preventDefault();
    win.clearTimeout(wheelTimer); wheelTimer = win.setTimeout(() => { wheel = 0; wheelLocked = false; playback(); }, 180);
    win.clearTimeout(autoplay); autoplay = null;
    if (wheelLocked) return;
    wheel += delta * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? stage.clientWidth : 1);
    if (Math.abs(wheel) < 60) return;
    wheelLocked = true;
    if (wheel > 0) carousel.scrollNext(reduced.matches); else carousel.scrollPrev(reduced.matches);
  }, { passive: false });
  grid.addEventListener('scroll', () => {
    if (carousel) return;
    const frame = grid.getBoundingClientRect(), centre = frame.x + frame.width / 2;
    selectedId = slides.reduce((closest, card) => {
      const distance = node => { const box = node.getBoundingClientRect(); return Math.abs(box.x + box.width / 2 - centre); };
      return !closest || distance(card) < distance(closest) ? card : closest;
    }, null)?.dataset.showcaseId ?? null;
    markActive();
  }, { passive: true });
  for (const event of ['pointerenter', 'pointerleave', 'focusin']) stage.addEventListener(event, playback);
  stage.addEventListener('focusout', () => win.queueMicrotask(playback));
  doc.addEventListener('visibilitychange', playback);
  win.addEventListener('pagehide', () => { win.clearTimeout(autoplay); autoplay = null; });
  win.addEventListener('pageshow', playback);
  if (win.IntersectionObserver) new win.IntersectionObserver(playback).observe(stage);
  else { win.addEventListener('scroll', playback, { passive: true }); win.addEventListener('resize', playback); }
  const lightbox = doc.querySelector('[data-work-lightbox]');
  if (lightbox && win.MutationObserver) new win.MutationObserver(playback).observe(lightbox, { attributes: true, attributeFilter: ['open'] });
  reduced.addEventListener('change', () => { if (reduced.matches && carousel) carousel.scrollTo(carousel.selectedScrollSnap(), true); playback(); });
  return { prepare, update, select, current: () => selectedId };
}
