// Readable before enhancement: no scroll interception, hidden text or business I/O.
const root=document.querySelector('#artdico-host.ah-cosmos');
if(root&&typeof requestAnimationFrame==='function'&&typeof matchMedia==='function'){
  const header=root.querySelector('[data-home-header]');
  const heroPlanet=root.querySelector('.ah-home-hero-planet');
  const reduced=matchMedia('(prefers-reduced-motion: reduce)');
  const compact=matchMedia('(max-width: 820px)');
  const progress=document.createElement('span');progress.dataset.scrollProgress='';progress.setAttribute('aria-hidden','true');header?.append(progress);
  const layer=document.createElement('div');layer.className='ah-reading-atmosphere';layer.dataset.readingAtmosphere='';layer.setAttribute('aria-hidden','true');layer.hidden=true;
  const canvas=document.createElement('canvas');canvas.className='ah-scroll-atmosphere';canvas.dataset.scrollAtmosphere='';canvas.dataset.heroParticles='';canvas.dataset.heroParticleMode='viewport-background';canvas.setAttribute('aria-hidden','true');
  layer.append(canvas);document.body.prepend(layer);
  const context=canvas.getContext('2d');
  let seed=41;const random=()=>{seed=(seed*16807)%2147483647;return(seed-1)/2147483646;};
  const particles=Array.from({length:56},()=>({x:random(),y:random(),size:1.1+random()*.7,vx:(random()-.5)*4,vy:-1.5-random()*3,alpha:.46+random()*.24,tint:random()}));
  const art=[...root.querySelectorAll('.ah-home-program-art,.ah-home-footer-art>img')].map(element=>{
    element.dataset.scrollArt='';return{element,scene:element.closest('section,footer')};
  }).filter(item=>item.scene);
  const nav=[...header?.querySelectorAll('a[href^="#"]')??[]];
  const destinations=[...new Map(nav.map(link=>[link.hash,document.getElementById(link.hash.slice(1))])).entries()].filter(([,element])=>element)
    .sort((a,b)=>a[1]===b[1]?0:a[1].compareDocumentPosition(b[1])&Node.DOCUMENT_POSITION_FOLLOWING?-1:1);
  const seen=new WeakSet(),revealedIds=new Set(),revealNodes=new Set(),motions=new Map();
  let observer=null,frame=0,enabled=true,height=76,current='',phase=0,lastPaint=0,canvasWidth=0,canvasHeight=0,ratio=1,uiDirty=true,geometryDirty=true,nodesDirty=true,layoutDirty=true;
  let maskBoxes=[],readables=[],textRanges=[],pointerX=0,pointerY=0,pointerActive=false;
  const clamp=(value,min=0,max=1)=>Math.max(min,Math.min(max,value));
  const state=()=>!enabled||document.hidden?'hidden':reduced.matches?'reduced':'active';
  const ambientActive=()=>state()==='active'&&context&&typeof IntersectionObserver==='function';
  function clearCanvas(){if(context){context.setTransform(1,0,0,1,0,0);context.clearRect(0,0,canvas.width,canvas.height);}}
  function invalidate(nodes=false){geometryDirty=true;layoutDirty=true;nodesDirty=nodesDirty||nodes;uiDirty=true;clearCanvas();requestFrame();}
  function cacheGeometry(){
    const selector='h1>*,.ah-hero-description,h2,h3,h4,p,small,strong,em,label,legend,button,a,input,select,textarea,summary,figcaption,dt,dd,img:not([data-hero-art])';
    if(nodesDirty){
      readables=[...root.querySelectorAll(selector)];textRanges=[];
      const walker=document.createTreeWalker(root,NodeFilter.SHOW_TEXT);let node;
      while((node=walker.nextNode())){
        const parent=node.parentElement;if(!parent||parent.closest('script,style,noscript')||parent.closest(selector))continue;
        const range=document.createRange();range.selectNodeContents(node);textRanges.push({range,parent});
      }
      nodesDirty=false;
    }
    const boxes=[];
    function include(rect,lift=false){
      if(rect.width<=0||rect.height<=0||rect.bottom<height||rect.top>innerHeight||rect.right<0||rect.left>innerWidth)return;
      const pad=lift?42:10;boxes.push({x:rect.left-10,y:rect.top-height-pad,width:rect.width+20,height:rect.height+pad*2});
    }
    for(const node of readables)if(node.isConnected)include(node.getBoundingClientRect(),Boolean(node.closest('[data-scroll-mode="lift"]')));
    for(const{range,parent}of textRanges)if(parent.isConnected)for(const rect of range.getClientRects())include(rect,Boolean(parent.closest('[data-scroll-mode="lift"]')));
    maskBoxes=boxes;geometryDirty=false;
  }
  function cancelEntries(){for(const motion of motions.values())motion.cancel();motions.clear();}
  function markSeen(element){seen.add(element);if(element.id)revealedIds.add(element.id);element.dataset.scrollReveal='seen';}
  function settle(target){
    if(!(target instanceof Element))return;
    // An explicit section jump exposes its heading immediately. It must not
    // consume every later card's entrance, nor treat a touch pan as a click.
    const scope=target.matches('section,footer')?target.querySelector('.ah-section-heading,.ah-register-intro,h2')??target:target;
    for(const element of revealNodes)if(element===scope||element.contains(scope)||scope.contains(element)){
      markSeen(element);observer?.unobserve(element);motions.get(element)?.cancel();motions.delete(element);
    }
  }
  function settleHash(){try{settle(document.getElementById(decodeURIComponent(location.hash.slice(1))));}catch{}}
  function observe(initial=false){
    observer?.disconnect();
    const definitions=[
      {selector:'.ah-section-heading,.ah-register-intro,.ah-venue>h2,.ah-faq>h2',phase:'title',mode:'lift'},
      {selector:'.ah-home-program-copy,.ah-home-footer-message>p',phase:'body',mode:'lift'},
      {selector:'.ah-home-fact-bubble,[data-public-guests]>[data-guest-id],[data-public-organizations]>[data-organization-id],.ah-work-stage,.ah-showcase-empty,.ah-agenda-row,.ah-booth-card,.ah-recruitment-grid>article,.ah-venue>p,.ah-venue>a,.ah-venue>details,.ah-faq-message',phase:'body',mode:'fade'},
    ];
    for(const definition of definitions)for(const element of root.querySelectorAll(definition.selector)){
      revealNodes.add(element);element.dataset.scrollPhase=definition.phase;element.dataset.scrollMode=definition.mode;
      element.dataset.scrollOrder=element.matches('.ah-agenda-row')?'0':String([...element.parentElement.children].filter(node=>node.matches(definition.selector)).indexOf(element)%4);
      const box=element.getBoundingClientRect();
      if(element.id&&revealedIds.has(element.id)||initial&&box.width>0&&box.height>0&&box.top<innerHeight*.85&&box.bottom>0)markSeen(element);
      element.dataset.scrollReveal=seen.has(element)?'seen':'pending';
    }
    for(const element of revealNodes)if(!element.isConnected)revealNodes.delete(element);
    if(state()!=='active'||typeof IntersectionObserver!=='function')return;
    observer=new IntersectionObserver(entries=>{
      for(const entry of entries){
        const element=entry.target;
        if(!entry.isIntersecting||seen.has(element))continue;
        markSeen(element);observer.unobserve(element);
        if(state()!=='active'||element.matches(':focus-within')||typeof element.animate!=='function')continue;
        const frames=element.dataset.scrollMode==='lift'?[{opacity:0,transform:'translate3d(0,36px,0)'},{opacity:1,transform:'translate3d(0,0,0)'}]:[{opacity:0},{opacity:1}];
        const delay=element.dataset.scrollPhase==='title'?0:160+Number(element.dataset.scrollOrder)*80;
        const motion=element.animate(frames,{duration:840,delay,easing:'cubic-bezier(.22,.61,.36,1)',fill:'backwards',id:'ah-scroll-reveal'});
        motions.set(element,motion);motion.finished.then(()=>motions.delete(element),()=>motions.delete(element));
      }
    },{threshold:.12,rootMargin:'0px 0px -32px 0px'});
    for(const element of revealNodes)if(!seen.has(element))observer.observe(element);
  }
  function paintAtmosphere(y,time,delta,spheres){
    if(!context)return;
    // Logical dimensions never reach zero; bitmap axes/area stay bounded even
    // for the existing one-pixel viewport regression or an oversized display.
    const width=Math.max(1,innerWidth),viewHeight=Math.max(1,innerHeight-height);
    const dpr=Math.min(devicePixelRatio||1,1.25,1600/Math.max(width,viewHeight),Math.sqrt(1600000/(width*viewHeight)));
    if(width!==canvasWidth||viewHeight!==canvasHeight||ratio!==dpr){
      canvasWidth=width;canvasHeight=viewHeight;ratio=dpr;canvas.width=Math.max(1,Math.floor(width*dpr));canvas.height=Math.max(1,Math.floor(viewHeight*dpr));geometryDirty=true;
    }
    clearCanvas();context.setTransform(ratio,0,0,ratio,0,0);
    if(geometryDirty)cacheGeometry();
    const circles=spheres.map(box=>({x:box.x,y:box.y-height,rx:box.rx+18,ry:box.ry+18}));
    const excluded=(x,py,pad=0)=>circles.some(ball=>((x-ball.x)/(ball.rx+pad))**2+((py-ball.y)/(ball.ry+pad))**2<=1)
      ||maskBoxes.some(box=>x>=box.x-pad&&x<=box.x+box.width+pad&&py>=box.y-pad&&py<=box.y+box.height+pad);
    const count=compact.matches?24:particles.length,dt=Math.min(100,delta)/1000;let rendered=0;phase+=dt;
    if(width>=8&&viewHeight>=8)for(let i=0;i<count;i++){
      const particle=particles[i];
      let px=particle.x*width,py=particle.y*viewHeight;
      let vx=particle.vx+Math.sin(phase*.23+i)*.7,vy=particle.vy;
      if(pointerActive){const dx=pointerX-px,dy=pointerY-height-py,distance=Math.max(1,Math.hypot(dx,dy)),force=Math.max(0,1-distance/210);vx+=dx/distance*10*force;vy+=dy/distance*10*force;}
      px=(px+vx*dt+width)%width;py=(py+vy*dt+viewHeight)%viewHeight;particle.x=px/width;particle.y=py/viewHeight;
      const visualY=(py+y*.012)%viewHeight;
      if(excluded(px,visualY,4))continue;
      const radius=Math.max(particle.size,.85/ratio),color=particle.tint>.45?'170,135,240':'129,174,255';
      const glow=context.createRadialGradient(px,visualY,0,px,visualY,radius*2.5);glow.addColorStop(0,'rgba('+color+','+(particle.alpha*.25).toFixed(3)+')');glow.addColorStop(1,'rgba('+color+',0)');
      context.fillStyle=glow;context.fillRect(px-radius*2.5,visualY-radius*2.5,radius*5,radius*5);
      context.fillStyle='rgba('+color+','+particle.alpha.toFixed(3)+')';context.beginPath();context.arc(px,visualY,radius,0,Math.PI*2);context.fill();rendered++;
    }
    context.save();context.globalCompositeOperation='destination-out';context.fillStyle='#000';
    for(const ball of circles){context.beginPath();context.ellipse(ball.x,ball.y,Math.max(1,ball.rx),Math.max(1,ball.ry),0,0,Math.PI*2);context.fill();}
    for(const box of maskBoxes)context.fillRect(box.x,box.y,box.width,box.height);
    context.restore();if(canvas.dataset.heroRenderedCount!==String(rendered))canvas.dataset.heroRenderedCount=String(rendered);
  }
  function requestFrame(){if(!frame&&enabled&&!document.hidden)frame=requestAnimationFrame(update);}
  function update(time){
    frame=0;
    // A retained native MQL can update .matches before its change event is
    // delivered. Converge through the same cleanup before stopping the loop.
    const nextState=state(),nextAtmosphere=ambientActive()?'active':nextState==='active'?'idle':nextState;
    if(root.dataset.motionState!==nextState||root.dataset.atmosphereState!==nextAtmosphere){synchronize();return;}
    if(!enabled||document.hidden)return;
    const active=ambientActive(),interval=compact.matches?1000/16:1000/30,paintDue=!lastPaint||time-lastPaint>=interval,y=Math.max(0,scrollY);
    if(uiDirty){
      const completion=clamp(y/Math.max(1,document.documentElement.scrollHeight-innerHeight));
      const rectangles=art.map(item=>({...item,box:item.scene.getBoundingClientRect()}));
      let locationId=destinations[0]?.[0]??'';
      for(const[hash,element]of destinations)if(element.getBoundingClientRect().top<=height+innerHeight*.24)locationId=hash;
      header?.style.setProperty('--ah-scroll-progress',String(completion));if(header)header.dataset.scrolled=String(y>24);
      if(current!==locationId){current=locationId;root.dataset.currentSection=current.slice(1);for(const link of nav){if(link.hash===current)link.setAttribute('aria-current','location');else link.removeAttribute('aria-current');}}
      if(active)for(const{element,box}of rectangles){
        if(box.bottom<0||box.top>innerHeight){element.style.removeProperty('transform');continue;}
        const offset=clamp((innerHeight-box.top)/(innerHeight+box.height))-.5,travel=compact.matches?10:24;
        element.style.transform='translate3d(0,'+(offset*travel*2).toFixed(2)+'px,0) rotate('+(offset*(compact.matches?5:10)).toFixed(2)+'deg)';
      }
      uiDirty=false;
    }
    if(active&&paintDue){
      const detail={time,delta:lastPaint?Math.min(100,time-lastPaint):interval,scrollY:y,headerHeight:height,layoutDirty,spheres:[]};
      root.dispatchEvent(new CustomEvent('artdico:atmosphere-frame',{detail}));
      paintAtmosphere(y,time,detail.delta,detail.spheres);lastPaint=time;layoutDirty=false;
    }
    if(active)requestFrame();
  }
  function synchronize(){
    cancelEntries();root.dataset.motionState=state();
    for(const{element}of art)element.style.removeProperty('transform');
    if(frame)cancelAnimationFrame(frame);frame=0;lastPaint=0;uiDirty=true;geometryDirty=true;layoutDirty=true;
    const next=ambientActive()?'active':state()==='active'?'idle':state();root.dataset.atmosphereState=next;layer.hidden=next!=='active';canvas.hidden=layer.hidden;
    if(layer.hidden){clearCanvas();canvas.dataset.heroRenderedCount='0';}
    root.dispatchEvent(new CustomEvent('artdico:atmosphere-state',{detail:{state:next}}));
    observe();settleHash();requestFrame();
  }
  function measureHeader(){
    const next=header?.getBoundingClientRect().height??(compact.matches?72:76);
    if(next!==height){height=next;document.documentElement.style.setProperty('--ah-header-height',height+'px');}
    geometryDirty=true;layoutDirty=true;uiDirty=true;requestFrame();
  }
  window.addEventListener('scroll',()=>{geometryDirty=true;uiDirty=true;requestFrame();},{passive:true});
  window.addEventListener('resize',()=>{measureHeader();requestFrame();},{passive:true});
  window.addEventListener('hashchange',()=>{settleHash();geometryDirty=true;uiDirty=true;requestFrame();});
  root.addEventListener('focusin',event=>settle(event.target));
  root.addEventListener('pointerdown',event=>{const target=event.target instanceof Element?event.target.closest('a,button,summary,input,select,textarea,[tabindex]'):null;if(target)settle(target);},{passive:true});
  root.addEventListener('click',event=>{const link=event.target instanceof Element?event.target.closest('a[href^="#"]'):null;if(link)try{settle(document.getElementById(decodeURIComponent(link.hash.slice(1))));}catch{};});
  const refresh=()=>{observe();settleHash();invalidate(true);};
  document.addEventListener('artdico:public-content-updated',refresh);
  root.addEventListener('artdico:guests-rendered',refresh);
  root.addEventListener('pointermove',event=>{if(event.pointerType==='mouse'){pointerX=event.clientX;pointerY=event.clientY;pointerActive=true;}},{passive:true});
  root.addEventListener('pointerleave',()=>{pointerActive=false;},{passive:true});
  if(typeof MutationObserver==='function'){const changes=new MutationObserver(()=>invalidate(true));changes.observe(root,{subtree:true,childList:true,characterData:true,attributes:true,attributeFilter:['hidden','open']});}
  document.fonts?.ready.then(()=>invalidate(true));
  document.addEventListener('visibilitychange',synchronize);
  reduced.addEventListener('change',synchronize);compact.addEventListener('change',()=>{measureHeader();synchronize();});
  window.addEventListener('pagehide',()=>{enabled=false;synchronize();});
  window.addEventListener('pageshow',()=>{enabled=true;synchronize();});
  if(typeof ResizeObserver==='function'){const sizes=new ResizeObserver(measureHeader);if(header)sizes.observe(header);sizes.observe(root);}
  observe(true);settleHash();measureHeader();root.dataset.scrollMotion='ready';synchronize();
}
