// Only the decorative sphere moves. Pointer and touch scrolling stay native.
const planet=document.querySelector('#artdico-host.ah-cosmos .ah-home-hero-planet');
if(planet&&typeof matchMedia==='function'){
  const stage=planet.closest('.ah-home-hero-stage'),image=planet.querySelector('img');
  const reduced=matchMedia('(prefers-reduced-motion: reduce)');
  const compact=matchMedia('(max-width: 820px)'),fine=matchMedia('(hover: hover) and (pointer: fine)');
  const canvas=document.createElement('canvas');canvas.dataset.heroParticles='';canvas.setAttribute('aria-hidden','true');canvas.hidden=true;
  planet.append(canvas);if(image)image.dataset.heroArt='';
  const context=canvas.getContext('2d');
  const hasObserver=typeof IntersectionObserver==='function';
  let visible=false,enabled=true,frame=0,touchTimer=0,lastPaint=0,phase=0,width=0,height=0,scale=1;
  let targetX=0,targetY=0,currentX=0,currentY=0,pointerStrength=0,pointerAngle=0;
  const particles=Array.from({length:18},(_,index)=>({phase:index*Math.PI*2/18+.07*Math.sin(index*7),speed:.7+(index%5)*.09,size:.7+(index%3)*.22}));
  const clamp=(value,min=-1,max=1)=>Math.min(max,Math.max(min,value));
  function status(){return !enabled||document.hidden?'hidden':reduced.matches?'reduced':hasObserver&&context&&visible?'active':'idle';}
  function neutral(){targetX=0;targetY=0;pointerStrength=0;}
  function clearPose(){
    neutral();currentX=0;currentY=0;
    for(const name of ['--ah-hero-x','--ah-hero-y','--ah-hero-angle','--ah-hero-light-x','--ah-hero-light-y','--ah-hero-glow'])planet.style.removeProperty(name);
  }
  function stop(){
    if(frame)cancelAnimationFrame(frame);frame=0;lastPaint=0;
    clearTimeout(touchTimer);touchTimer=0;canvas.hidden=true;
    context?.clearRect(0,0,canvas.width,canvas.height);clearPose();
  }
  function resize(){
    const box=planet.getBoundingClientRect();width=Math.max(1,box.width);height=Math.max(1,box.height);
    scale=Math.min(devicePixelRatio||1,1.25,1000/Math.max(width,height));
    const nextWidth=Math.max(1,Math.round(width*scale)),nextHeight=Math.max(1,Math.round(height*scale));
    if(canvas.width!==nextWidth||canvas.height!==nextHeight){canvas.width=nextWidth;canvas.height=nextHeight;}
  }
  function draw(delta){
    if(!context)return;
    phase+=delta*.000055;
    currentX+=(targetX-currentX)*.2;currentY+=(targetY-currentY)*.2;
    if(Math.abs(currentX)<.001)currentX=0;if(Math.abs(currentY)<.001)currentY=0;
    planet.style.setProperty('--ah-hero-x',(currentX*6).toFixed(3)+'px');
    planet.style.setProperty('--ah-hero-y',(currentY*5).toFixed(3)+'px');
    planet.style.setProperty('--ah-hero-angle',(currentX*1.2).toFixed(3)+'deg');
    planet.style.setProperty('--ah-hero-light-x',(50+currentX*27).toFixed(2)+'%');
    planet.style.setProperty('--ah-hero-light-y',(48+currentY*25).toFixed(2)+'%');
    planet.style.setProperty('--ah-hero-glow',String(.12+pointerStrength*.35));
    context.setTransform(scale,0,0,scale,0,0);context.clearRect(0,0,width,height);
    const count=compact.matches?10:particles.length,cx=width*.5,cy=height*.5,radius=Math.min(width,height)*.474;
    for(let index=0;index<count;index++){
      const particle=particles[index],angle=phase*particle.speed+index*Math.PI*2/count+particle.phase*.05;
      const difference=Math.abs(Math.atan2(Math.sin(angle-pointerAngle),Math.cos(angle-pointerAngle)));
      const response=Math.max(0,1-difference/.65)*pointerStrength;
      const orbit=radius+Math.sin(angle*3+index)*width*.002+response*width*.004;
      const depth=.5+.5*Math.sin(angle),alpha=.22+depth*.34+response*.16;
      for(let trail=3;trail>=0;trail--){
        const theta=angle-trail*.012;
        context.fillStyle=(index%3===0?'rgba(124,172,255,':'rgba(183,142,255,')+(alpha*(1-trail*.23)).toFixed(3)+')';
        context.beginPath();context.arc(cx+Math.cos(theta)*orbit,cy+Math.sin(theta)*orbit*.98,particle.size*(trail? .55:1),0,Math.PI*2);context.fill();
      }
    }
  }
  function tick(time){
    frame=0;if(status()!=='active'){synchronize();return;}
    if(!lastPaint||time-lastPaint>=1000/30){const delta=lastPaint?Math.min(80,time-lastPaint):1000/30;lastPaint=time;draw(delta);}
    frame=requestAnimationFrame(tick);
  }
  function synchronize(){
    stop();const next=status();planet.dataset.heroMotion=next;
    if(next==='active'){resize();canvas.hidden=false;frame=requestAnimationFrame(tick);}
  }
  function point(event){
    if(status()!=='active')return;
    const box=planet.getBoundingClientRect(),dx=(event.clientX-box.left-box.width*.5)/(box.width*.5),dy=(event.clientY-box.top-box.height*.5)/(box.height*.5);
    targetX=clamp(dx);targetY=clamp(dy);pointerAngle=Math.atan2(dy,dx);
    pointerStrength=clamp(1.6-Math.hypot(dx,dy),0,1);
  }
  stage?.addEventListener('pointermove',event=>{if(event.pointerType==='mouse'&&fine.matches)point(event);},{passive:true});
  stage?.addEventListener('pointerleave',neutral,{passive:true});
  stage?.addEventListener('pointercancel',neutral,{passive:true});
  stage?.addEventListener('pointerdown',event=>{
    if(event.pointerType!=='touch')return;
    point(event);clearTimeout(touchTimer);touchTimer=setTimeout(neutral,420);
  },{passive:true});
  reduced.addEventListener('change',synchronize);
  compact.addEventListener('change',synchronize);
  fine.addEventListener('change',neutral);
  document.addEventListener('visibilitychange',synchronize);
  window.addEventListener('pagehide',()=>{enabled=false;synchronize();});
  window.addEventListener('pageshow',()=>{enabled=true;synchronize();});
  window.addEventListener('resize',()=>{if(status()==='active')resize();},{passive:true});
  if(hasObserver){
    const observer=new IntersectionObserver(entries=>{for(const entry of entries){if(entry.target!==planet)continue;const next=entry.isIntersecting&&entry.intersectionRatio>=.025;if(next!==visible){visible=next;synchronize();}}},{threshold:[0,.025]});
    observer.observe(planet);
  }
  if(typeof ResizeObserver==='function'){const observer=new ResizeObserver(()=>{if(status()==='active')resize();});observer.observe(planet);}
  synchronize();
}
