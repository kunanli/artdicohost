// Decorative entry motion. The HTML is visible before this enhancement,
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

// Guest motion belongs to the wrapper so text and an open disclosure stay still
// together. Nothing is hidden while waiting for an observer or an animation.
if(root&&typeof matchMedia==='function'&&typeof IntersectionObserver==='function'){
  const reduced=matchMedia('(prefers-reduced-motion: reduce)'),bubbles=new Map();
  let active=true;
  const observer=new IntersectionObserver(entries=>{
    for(const entry of entries){const state=bubbles.get(entry.target);if(state)state.visible=entry.isIntersecting;}
    synchronize();
  },{threshold:.1});
  function synchronize(){
    for(const [element,state] of bubbles){
      const still=element.matches(':hover,:focus-within')||Boolean(element.querySelector('details[open]'));
      if(active&&!document.hidden&&!reduced.matches&&state.visible&&!still)state.motion.play();else state.motion.pause();
    }
  }
  function refresh(){
    for(const [element,state] of bubbles){
      if(!element.isConnected||reduced.matches||!active){observer.unobserve(element);state.motion.cancel();bubbles.delete(element);}
    }
    if(reduced.matches||!active)return;
    let index=0;
    for(const element of root.querySelectorAll('[data-guest-float]')){
      if(!bubbles.has(element)&&typeof element.animate==='function'){
        const duration=5800+(index%5)*470;
        const motion=element.animate([{transform:'translate3d(0,0,0)'},{transform:'translate3d(2px,-6px,0)'},{transform:'translate3d(-1px,-2px,0)'},{transform:'translate3d(0,0,0)'}],{duration,iterations:Infinity,easing:'ease-in-out'});
        motion.pause();motion.currentTime=(index*730)%duration;
        bubbles.set(element,{motion,visible:false});observer.observe(element);
      }
      index++;
    }
    synchronize();
  }
  root.addEventListener('artdico:guests-rendered',refresh);
  for(const event of ['pointerover','focusin','toggle'])root.addEventListener(event,synchronize,true);
  for(const event of ['pointerout','focusout','click'])root.addEventListener(event,()=>queueMicrotask(synchronize),true);
  reduced.addEventListener('change',refresh);
  document.addEventListener('visibilitychange',synchronize);
  window.addEventListener('pagehide',()=>{active=false;refresh();});
  window.addEventListener('pageshow',()=>{active=true;refresh();});
  refresh();
}
