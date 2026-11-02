// Readable before enhancement: no scroll interception, hidden text or business I/O.
const root=document.querySelector('#artdico-host.ah-cosmos');
if(root&&typeof requestAnimationFrame==='function'&&typeof matchMedia==='function'){
  const header=root.querySelector('[data-home-header]');
  const reduced=matchMedia('(prefers-reduced-motion: reduce)');
  const compact=matchMedia('(max-width: 820px)');
  const progress=document.createElement('span');progress.dataset.scrollProgress='';progress.setAttribute('aria-hidden','true');header?.append(progress);
  const canvas=document.createElement('canvas');canvas.className='ah-scroll-atmosphere';canvas.dataset.scrollAtmosphere='';canvas.setAttribute('aria-hidden','true');
  document.body.append(canvas);
  const context=canvas.getContext('2d');
  const grain=document.createElement('canvas');grain.width=64;grain.height=128;
  const grainContext=grain.getContext('2d');
  let seed=41;const random=()=>{seed=(seed*16807)%2147483647;return(seed-1)/2147483646;};
  if(grainContext)for(let i=0;i<640;i++){grainContext.fillStyle='rgba(155,132,214,'+(.06+random()*.18)+')';grainContext.fillRect(random()*64,random()*128,1,1);}
  const texture=context?.createPattern(grain,'repeat');
  const particles=Array.from({length:40},()=>({x:random(),y:random(),size:.45+random()*.85,speed:.035+random()*.04,tint:random()}));
  const art=[...root.querySelectorAll('.ah-home-program-art,.ah-home-footer-art>img')].map(element=>{
    element.dataset.scrollArt='';return{element,scene:element.closest('section,footer')};
  }).filter(item=>item.scene);
  const nav=[...header?.querySelectorAll('a[href^="#"]')??[]];
  const destinations=[...new Map(nav.map(link=>[link.hash,document.getElementById(link.hash.slice(1))])).entries()].filter(([,element])=>element)
    .sort((a,b)=>a[1]===b[1]?0:a[1].compareDocumentPosition(b[1])&Node.DOCUMENT_POSITION_FOLLOWING?-1:1);
  const seen=new WeakSet(),revealNodes=new Set(),motions=new Map();
  let observer=null,frame=0,enabled=true,height=76,current='',settleUntil=0,phase=0,lastTime=0,canvasWidth=0,canvasHeight=0,ratio=1;
  const clamp=(value,min=0,max=1)=>Math.max(min,Math.min(max,value));
  const state=()=>!enabled||document.hidden?'hidden':reduced.matches?'reduced':'active';
  function cancelEntries(){for(const motion of motions.values())motion.cancel();motions.clear();}
  function settle(target){
    if(!(target instanceof Element))return;
    const section=target.closest('section,footer');
    for(const element of revealNodes)if(element===target||element.contains(target)||target.contains(element)||section&&element.closest('section,footer')===section){
      seen.add(element);element.dataset.scrollReveal='seen';observer?.unobserve(element);motions.get(element)?.cancel();motions.delete(element);
    }
  }
  function settleHash(){try{settle(document.getElementById(decodeURIComponent(location.hash.slice(1))));}catch{}}
  function observe(initial=false){
    observer?.disconnect();
    const selectors='.ah-section-heading,.ah-home-program-copy,.ah-register-intro,.ah-recruitment-grid>article>h3,.ah-recruitment-grid>article>p,.ah-venue>h2,.ah-faq>h2,.ah-home-footer-message>p';
    for(const element of root.querySelectorAll(selectors)){
      revealNodes.add(element);
      if(initial&&element.getBoundingClientRect().top<innerHeight*.85)seen.add(element);
      element.dataset.scrollReveal=seen.has(element)?'seen':'pending';
    }
    for(const element of revealNodes)if(!element.isConnected)revealNodes.delete(element);
    if(state()!=='active'||typeof IntersectionObserver!=='function')return;
    observer=new IntersectionObserver(entries=>{
      for(const entry of entries){
        const element=entry.target;
        if(!entry.isIntersecting||seen.has(element))continue;
        seen.add(element);element.dataset.scrollReveal='seen';observer.unobserve(element);
        if(state()!=='active'||element.matches(':focus-within')||typeof element.animate!=='function')continue;
        const motion=element.animate([{opacity:.8,transform:'translate3d(0,24px,0)'},{opacity:1,transform:'translate3d(0,0,0)'}],{duration:680,easing:'cubic-bezier(.2,.7,.2,1)',id:'ah-scroll-reveal'});
        motions.set(element,motion);motion.finished.then(()=>motions.delete(element),()=>motions.delete(element));
      }
    },{threshold:.12,rootMargin:'0px 0px -32px 0px'});
    for(const element of revealNodes)if(!seen.has(element))observer.observe(element);
  }
  function paintAtmosphere(y,completion,time){
    if(!context)return;
    const width=Math.min(innerWidth,1920),viewHeight=Math.max(1,innerHeight-height),dpr=Math.min(devicePixelRatio||1,1.5);
    if(width!==canvasWidth||viewHeight!==canvasHeight||ratio!==dpr){canvasWidth=width;canvasHeight=viewHeight;ratio=dpr;canvas.width=Math.ceil(width*dpr);canvas.height=Math.ceil(viewHeight*dpr);}
    context.setTransform(ratio,0,0,ratio,0,0);context.clearRect(0,0,width,viewHeight);
    const band=compact.matches?14:Math.min(100,width*.065),center=viewHeight*(.12+completion*.76);
    phase+=Math.min(40,Math.max(0,time-lastTime))*.008;
    context.save();context.beginPath();context.rect(0,0,band,viewHeight);context.rect(width-band,0,band,viewHeight);context.clip();
    for(const side of [0,1]){
      const edge=side?width:0,glow=context.createRadialGradient(edge,center,0,edge,center,viewHeight*.52);
      glow.addColorStop(0,'rgba(121,76,227,.095)');glow.addColorStop(.5,'rgba(64,114,223,.035)');glow.addColorStop(1,'rgba(72,40,130,0)');context.fillStyle=glow;context.fillRect(side?width-band:0,0,band,viewHeight);
      if(texture){context.save();context.translate(0,(y*.04+phase)%128);context.globalAlpha=.3;context.fillStyle=texture;context.fillRect(side?width-band:0,-128,band,viewHeight+128);context.restore();}
    }
    const count=compact.matches?18:particles.length;
    for(let i=0;i<count;i++){
      const particle=particles[i],py=(particle.y*viewHeight+y*particle.speed+phase)%viewHeight;
      const inset=(.1+particle.x*.7)*band,px=i%2?width-inset:inset;
      const alpha=(compact.matches?.18:.28)*(.5+Math.sin(py/viewHeight*Math.PI)*.5);
      context.fillStyle=particle.tint>.45?'rgba(172,133,255,'+alpha+')':'rgba(100,155,255,'+alpha+')';
      context.beginPath();context.arc(px,py,particle.size,0,Math.PI*2);context.fill();
    }
    context.restore();
    // Feather into the black page instead of leaving rectangular grain bands.
    context.save();context.globalCompositeOperation='destination-in';
    const feather=context.createLinearGradient(0,0,width,0);
    feather.addColorStop(0,'#000');feather.addColorStop(band/width,'transparent');
    feather.addColorStop(1-band/width,'transparent');feather.addColorStop(1,'#000');
    context.fillStyle=feather;context.fillRect(0,0,width,viewHeight);context.restore();
  }
  function requestFrame(){if(!frame&&enabled&&!document.hidden)frame=requestAnimationFrame(update);}
  function update(time){
    frame=0;if(!enabled||document.hidden)return;
    const y=Math.max(0,scrollY),completion=clamp(y/Math.max(1,document.documentElement.scrollHeight-innerHeight));
    const rectangles=art.map(item=>({...item,box:item.scene.getBoundingClientRect()}));
    let locationId=destinations[0]?.[0]??'';
    for(const [hash,element]of destinations)if(element.getBoundingClientRect().top<=height+innerHeight*.24)locationId=hash;
    header?.style.setProperty('--ah-scroll-progress',String(completion));
    if(header)header.dataset.scrolled=String(y>24);
    if(current!==locationId){current=locationId;root.dataset.currentSection=current.slice(1);for(const link of nav){if(link.hash===current)link.setAttribute('aria-current','location');else link.removeAttribute('aria-current');}}
    canvas.hidden=state()!=='active'||!context;
    if(state()==='active'){
      for(const{element,box,scene}of rectangles){
        if(box.bottom<0||box.top>innerHeight||typeof IntersectionObserver!=='function'){element.style.removeProperty('transform');continue;}
        const travel=compact.matches?10:24;
        const p=scene.id==='top'?clamp(y/Math.max(1,box.height)):clamp((innerHeight-box.top)/(innerHeight+box.height));
        const offset=scene.id==='top'?p:p-.5;
        element.style.transform='translate3d(0,'+(offset*travel*2).toFixed(2)+'px,0) rotate('+(offset*(compact.matches?5:10)).toFixed(2)+'deg)';
      }
      paintAtmosphere(y,completion,time);
      if(time<settleUntil)requestFrame();
    }
    lastTime=time;
  }
  function synchronize(){
    cancelEntries();root.dataset.motionState=state();
    for(const{element}of art)element.style.removeProperty('transform');
    canvas.hidden=state()!=='active'||!context;
    if(canvas.hidden)context?.clearRect(0,0,canvas.width,canvas.height);
    if(frame)cancelAnimationFrame(frame);frame=0;settleUntil=0;lastTime=performance.now();
    observe();settleHash();requestFrame();
  }
  function measureHeader(){
    const next=header?.getBoundingClientRect().height??(compact.matches?72:76);
    if(next!==height){height=next;document.documentElement.style.setProperty('--ah-header-height',height+'px');}
    requestFrame();
  }
  window.addEventListener('scroll',()=>{settleUntil=performance.now()+700;requestFrame();},{passive:true});
  window.addEventListener('resize',()=>{measureHeader();requestFrame();},{passive:true});
  window.addEventListener('hashchange',()=>{settleHash();requestFrame();});
  root.addEventListener('focusin',event=>settle(event.target));
  root.addEventListener('pointerdown',event=>settle(event.target),{passive:true});
  root.addEventListener('click',event=>{const link=event.target instanceof Element?event.target.closest('a[href^="#"]'):null;if(link)try{settle(document.getElementById(decodeURIComponent(link.hash.slice(1))));}catch{};});
  const refresh=()=>{observe();settleHash();requestFrame();};
  document.addEventListener('artdico:public-content-updated',refresh);
  root.addEventListener('artdico:guests-rendered',refresh);
  document.addEventListener('visibilitychange',synchronize);
  reduced.addEventListener('change',synchronize);compact.addEventListener('change',()=>{measureHeader();synchronize();});
  window.addEventListener('pagehide',()=>{enabled=false;synchronize();});
  window.addEventListener('pageshow',()=>{enabled=true;synchronize();});
  if(typeof ResizeObserver==='function'){const sizes=new ResizeObserver(measureHeader);if(header)sizes.observe(header);sizes.observe(root);}
  observe(true);settleHash();measureHeader();root.dataset.scrollMotion='ready';synchronize();
}
