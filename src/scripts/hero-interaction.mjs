// Free background dust stays outside the sphere and readable foreground.
// Nothing captures pointers or changes native touch / scroll behavior.
const stage=document.querySelector('#artdico-host.ah-cosmos .ah-home-hero-stage');
const planet=stage?.querySelector('.ah-home-hero-planet');
if(stage&&planet&&typeof matchMedia==='function'){
  const image=planet.querySelector('img'),reduced=matchMedia('(prefers-reduced-motion: reduce)');
  const compact=matchMedia('(max-width: 820px)'),fine=matchMedia('(hover: hover) and (pointer: fine)');
  const canvas=document.createElement('canvas');canvas.dataset.heroParticles='';canvas.dataset.heroParticleMode='background';canvas.setAttribute('aria-hidden','true');canvas.hidden=true;
  stage.prepend(canvas);if(image)image.dataset.heroArt='';
  const context=canvas.getContext('2d'),hasObserver=typeof IntersectionObserver==='function';
  let visible=false,enabled=true,frame=0,touchTimer=0,lastPaint=0,elapsed=0,width=0,height=0,scale=1,geometryKey='';
  let targetX=0,targetY=0,currentX=0,currentY=0,pointerX=0,pointerY=0,pointerVx=0,pointerVy=0,lastPointerTime=0,pointerActive=false;
  let circle={x:0,y:0,rx:1,ry:1},blockers=[],particles=[];
  const clamp=(value,min=-1,max=1)=>Math.min(max,Math.max(min,value));
  function status(){return !enabled||document.hidden?'hidden':reduced.matches?'reduced':hasObserver&&context&&visible?'active':'idle';}
  function neutral(){targetX=0;targetY=0;pointerActive=false;pointerVx=0;pointerVy=0;lastPointerTime=0;}
  function clearPose(){
    neutral();currentX=0;currentY=0;
    for(const name of ['--ah-hero-x','--ah-hero-y','--ah-hero-angle','--ah-hero-light-x','--ah-hero-light-y','--ah-hero-glow'])planet.style.removeProperty(name);
  }
  function clearCanvas(){if(context){context.setTransform(1,0,0,1,0,0);context.clearRect(0,0,canvas.width,canvas.height);}}
  function stop(){
    if(frame)cancelAnimationFrame(frame);frame=0;lastPaint=0;clearTimeout(touchTimer);touchTimer=0;
    canvas.hidden=true;canvas.dataset.heroRenderedCount='0';clearCanvas();clearPose();
  }
  function excluded(x,y,pad=0){
    if(((x-circle.x)/(circle.rx+pad))**2+((y-circle.y)/(circle.ry+pad))**2<=1)return true;
    return blockers.some(box=>x>=box.x-pad&&x<=box.x+box.width+pad&&y>=box.y-pad&&y<=box.y+box.height+pad);
  }
  function populate(){
    let seed=7331;const random=()=>{seed=(seed*16807)%2147483647;return(seed-1)/2147483646;};
    const count=compact.matches?10:24;particles=[];
    for(let attempt=0;attempt<1200&&particles.length<count;attempt++){
      const x=8+random()*Math.max(1,width-16),y=8+random()*Math.max(1,height-16);
      if(excluded(x,y,5))continue;
      particles.push({x,y,vx:(random()-.5)*9,vy:-1.5-random()*4,size:1.1+random()*.65,alpha:.44+random()*.28,phase:random()*8,blue:random()>.55});
    }
  }
  function measure(){
    const box=stage.getBoundingClientRect(),ball=planet.getBoundingClientRect();width=Math.max(1,box.width);height=Math.max(1,box.height);
    scale=Math.min(devicePixelRatio||1,1.25,1000/Math.max(width,height));
    const nextWidth=Math.max(1,Math.round(width*scale)),nextHeight=Math.max(1,Math.round(height*scale));
    if(canvas.width!==nextWidth||canvas.height!==nextHeight){canvas.width=nextWidth;canvas.height=nextHeight;}
    // Include the complete silhouette, including the source artwork's clear
    // pixels and the maximum pointer pose. No image sampling or text reads.
    circle={x:ball.left-box.left+ball.width*.5,y:ball.top-box.top+ball.height*.5,rx:ball.width*.5+18,ry:ball.height*.5+18};
    const heading=stage.querySelector('h1');
    const titleRects=heading?[...heading.childNodes].flatMap(node=>{
      if(node instanceof Element)return[node.getBoundingClientRect()];
      if(node.nodeType!==Node.TEXT_NODE)return[];
      const range=document.createRange();range.selectNodeContents(node);return[...range.getClientRects()];
    }):[];
    const readable=[...stage.querySelectorAll('.ah-hero-description,a,button,input,select,textarea,summary')];
    blockers=[...titleRects,...readable.map(node=>node.getBoundingClientRect())].filter(rect=>rect.width>0&&rect.height>0)
      .map(rect=>({x:rect.left-box.left-10,y:rect.top-box.top-10,width:rect.width+20,height:rect.height+20}));
    const key=JSON.stringify([width,height,circle,blockers,compact.matches]);
    if(key!==geometryKey){geometryKey=key;clearCanvas();populate();}
  }
  function mask(){
    if(!context)return;
    // Separate destination-out fills form a union: overlapping exclusions
    // cannot accidentally reopen the sphere as an even-odd path would.
    context.save();context.globalCompositeOperation='destination-out';context.fillStyle='#000';
    context.beginPath();context.ellipse(circle.x,circle.y,circle.rx,circle.ry,0,0,Math.PI*2);context.fill();
    for(const box of blockers)context.fillRect(box.x,box.y,box.width,box.height);
    context.restore();
  }
  function draw(delta){
    if(!context)return;
    const dt=delta/1000;elapsed+=delta;currentX+=(targetX-currentX)*.2;currentY+=(targetY-currentY)*.2;
    if(Math.abs(currentX)<.001)currentX=0;if(Math.abs(currentY)<.001)currentY=0;
    planet.style.setProperty('--ah-hero-x',(currentX*6).toFixed(3)+'px');planet.style.setProperty('--ah-hero-y',(currentY*5).toFixed(3)+'px');
    planet.style.setProperty('--ah-hero-angle',(currentX*1.2).toFixed(3)+'deg');
    clearCanvas();context.setTransform(scale,0,0,scale,0,0);
    const forceRadius=clamp(Math.min(width,height)*.32,160,240);let rendered=0;
    for(const particle of particles){
      let vx=particle.vx+Math.sin(elapsed*.00023+particle.phase)*1.2,vy=particle.vy+Math.cos(elapsed*.00019+particle.phase)*.8;
      if(pointerActive){
        const dx=pointerX-particle.x,dy=pointerY-particle.y,distance=Math.max(1,Math.hypot(dx,dy)),influence=Math.max(0,1-distance/forceRadius);
        vx+=(dx/distance*14+pointerVx*.02)*influence;vy+=(dy/distance*14+pointerVy*.02)*influence;
      }
      particle.x+=vx*dt;particle.y+=vy*dt;
      if(particle.x<3||particle.x>width-3){particle.vx*=-1;particle.x=clamp(particle.x,3,width-3);}
      if(particle.y<3||particle.y>height-3){particle.vy*=-1;particle.y=clamp(particle.y,3,height-3);}
      if(excluded(particle.x,particle.y,4))continue;
      const color=particle.blue?'129,174,255':'170,135,240',radius=Math.max(particle.size,.85/scale);
      const halo=context.createRadialGradient(particle.x,particle.y,0,particle.x,particle.y,radius*2.5);
      halo.addColorStop(0,'rgba('+color+','+(particle.alpha*.24).toFixed(3)+')');halo.addColorStop(1,'rgba('+color+',0)');
      context.fillStyle=halo;context.fillRect(particle.x-radius*2.5,particle.y-radius*2.5,radius*5,radius*5);
      context.fillStyle='rgba('+color+','+particle.alpha.toFixed(3)+')';context.beginPath();context.arc(particle.x,particle.y,radius,0,Math.PI*2);context.fill();rendered++;
    }
    mask();if(canvas.dataset.heroRenderedCount!==String(rendered))canvas.dataset.heroRenderedCount=String(rendered);
    pointerVx*=.88;pointerVy*=.88;
  }
  function tick(time){
    frame=0;if(status()!=='active'){synchronize();return;}
    if(!lastPaint||time-lastPaint>=1000/30){const delta=lastPaint?Math.min(80,time-lastPaint):1000/30;lastPaint=time;draw(delta);}
    frame=requestAnimationFrame(tick);
  }
  function synchronize(){stop();const next=status();planet.dataset.heroMotion=next;if(next==='active'){measure();canvas.hidden=false;frame=requestAnimationFrame(tick);}}
  function point(event){
    if(status()!=='active')return;
    const box=stage.getBoundingClientRect(),ball=planet.getBoundingClientRect(),x=event.clientX-box.left,y=event.clientY-box.top,now=performance.now();
    if(lastPointerTime&&now-lastPointerTime<400){const seconds=Math.max(.008,(now-lastPointerTime)/1000);pointerVx=clamp((x-pointerX)/seconds,-300,300);pointerVy=clamp((y-pointerY)/seconds,-300,300);}
    pointerX=x;pointerY=y;lastPointerTime=now;pointerActive=true;
    targetX=clamp((event.clientX-ball.left-ball.width*.5)/(ball.width*.5));targetY=clamp((event.clientY-ball.top-ball.height*.5)/(ball.height*.5));
  }
  stage.addEventListener('pointermove',event=>{if(event.pointerType==='mouse'&&fine.matches)point(event);},{passive:true});
  stage.addEventListener('pointerleave',neutral,{passive:true});stage.addEventListener('pointercancel',neutral,{passive:true});
  stage.addEventListener('pointerdown',event=>{if(event.pointerType!=='touch')return;point(event);clearTimeout(touchTimer);touchTimer=setTimeout(neutral,420);},{passive:true});
  const refresh=()=>{if(status()==='active')measure();};
  reduced.addEventListener('change',synchronize);compact.addEventListener('change',synchronize);fine.addEventListener('change',neutral);
  document.addEventListener('visibilitychange',synchronize);document.addEventListener('artdico:public-content-updated',refresh);
  stage.addEventListener('load',refresh,true);document.fonts?.ready.then(refresh);
  window.addEventListener('pagehide',()=>{enabled=false;synchronize();});window.addEventListener('pageshow',()=>{enabled=true;synchronize();});
  window.addEventListener('resize',refresh,{passive:true});
  if(hasObserver){const observer=new IntersectionObserver(entries=>{for(const entry of entries)if(entry.target===stage){const next=entry.isIntersecting&&entry.intersectionRatio>=.025;if(next!==visible){visible=next;synchronize();}}},{threshold:[0,.025]});observer.observe(stage);}
  if(typeof ResizeObserver==='function'){const observer=new ResizeObserver(refresh);observer.observe(stage);observer.observe(planet);const heading=stage.querySelector('h1');if(heading){observer.observe(heading);for(const title of heading.children)observer.observe(title);}}
  synchronize();
}
