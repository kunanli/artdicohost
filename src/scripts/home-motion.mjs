// Guest floating is independent of the page's scroll decoration.
const root = document.querySelector('#artdico-host.ah-cosmos');
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
