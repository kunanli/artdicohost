// One original sphere, handed from the Hero into the shared reading background.
// The page renderer owns the only ambient loop; pointer / touch remain passive.
const root=document.querySelector('#artdico-host.ah-cosmos');
const stage=root?.querySelector('.ah-home-hero-stage'),planet=stage?.querySelector('.ah-home-hero-planet');
const layer=document.querySelector('[data-reading-atmosphere]');
if(root&&stage&&planet&&layer&&typeof matchMedia==='function'){
  const image=planet.querySelector('img'),compact=matchMedia('(max-width: 820px)'),fine=matchMedia('(hover: hover) and (pointer: fine)');
  const background=image?.cloneNode(false);
  let ready=false,currentX=0,currentY=0,targetX=0,targetY=0,touchTimer=0,lastStyle='',lastDetail=null,slot=null;
  const clamp=(value,min=0,max=1)=>Math.min(max,Math.max(min,value));
  const smooth=value=>value*value*(3-2*value);
  if(image)image.dataset.heroArt='';
  if(background){
    background.removeAttribute('data-hero-art');background.removeAttribute('data-astro-image');background.dataset.backgroundPlanet='';background.alt='';background.hidden=true;
    background.loading='eager';background.setAttribute('aria-hidden','true');layer.prepend(background);
  }
  function neutral(){targetX=0;targetY=0;}
  function reset(state){
    neutral();currentX=0;currentY=0;lastStyle='';clearTimeout(touchTimer);touchTimer=0;
    for(const name of ['--ah-hero-x','--ah-hero-y','--ah-hero-angle','--ah-hero-scroll-x','--ah-hero-scroll-y','--ah-hero-scroll-scale','--ah-hero-opacity'])planet.style.removeProperty(name);
    planet.dataset.heroMotion=state;planet.dataset.heroRetreat='0';
    if(background)background.hidden=true;
  }
  function measureSlot(scrollPosition){
    const rect=stage.getBoundingClientRect(),style=getComputedStyle(planet);
    slot={left:rect.left+(parseFloat(style.left)||0),top:rect.top+scrollPosition+(parseFloat(style.top)||0),width:Math.max(1,parseFloat(style.width)||planet.offsetWidth),height:Math.max(1,parseFloat(style.height)||planet.offsetHeight),stageLeft:rect.left,stageTop:rect.top+scrollPosition,stageWidth:rect.width,stageHeight:rect.height};
  }
  function render(detail){
    lastDetail=detail;
    if(root.dataset.atmosphereState!=='active'){reset(root.dataset.atmosphereState??'idle');return;}
    if(!slot||detail.layoutDirty)measureSlot(detail.scrollY);
    const width=slot.width,height=slot.height,originX=slot.left,originY=slot.top-detail.scrollY;
    if(slot.stageTop+slot.stageHeight-detail.scrollY<=detail.headerHeight)neutral();
    currentX+=(targetX-currentX)*.2;currentY+=(targetY-currentY)*.2;
    if(Math.abs(currentX)<.001)currentX=0;if(Math.abs(currentY)<.001)currentY=0;
    const distance=Math.max(innerHeight*.65,Math.min(innerHeight*1.15,slot.stageHeight*.85));
    const start=Math.max(0,slot.stageTop-detail.headerHeight),progress=clamp((detail.scrollY-start)/Math.max(1,distance)),ease=smooth(progress);
    const targetWidth=Math.max(1,Math.min(compact.matches?300:540,innerWidth*(compact.matches?.60:.42))),size=width+(targetWidth-width)*ease,scale=size/width;
    const centerX=(originX+width*.5)*(1-ease)+innerWidth*(compact.matches?.64:.72)*ease;
    const centerY=(originY+height*.5)*(1-ease)+innerHeight*.46*ease;
    const x=centerX-size*.5,y=centerY-height*scale*.5,depth=1+(compact.matches?.14-1:.18-1)*ease;
    const cross=smooth(clamp((progress-.12)/.34)),dx=currentX*6,dy=currentY*5,angle=currentX*1.2;
    const signature=[x,y,size,scale,cross,depth,dx,dy,angle].map(value=>value.toFixed(4)).join(',');
    if(signature!==lastStyle){
      lastStyle=signature;planet.dataset.heroMotion='active';planet.dataset.heroRetreat=progress.toFixed(4);
      planet.style.setProperty('--ah-hero-x',dx.toFixed(3)+'px');planet.style.setProperty('--ah-hero-y',dy.toFixed(3)+'px');planet.style.setProperty('--ah-hero-angle',angle.toFixed(3)+'deg');
      if(ready&&background){
        planet.style.setProperty('--ah-hero-scroll-x',(x-originX).toFixed(3)+'px');planet.style.setProperty('--ah-hero-scroll-y',(y-originY).toFixed(3)+'px');planet.style.setProperty('--ah-hero-scroll-scale',scale.toFixed(6));planet.style.setProperty('--ah-hero-opacity',String(1-cross));
        background.hidden=false;background.style.width=size.toFixed(3)+'px';background.style.height=(height*scale).toFixed(3)+'px';
        background.style.transform='translate3d('+(x+dx*scale).toFixed(3)+'px,'+(y+dy*scale).toFixed(3)+'px,0) rotate('+angle.toFixed(3)+'deg)';background.style.opacity=String(cross*depth);
      }
    }
    if(ready)detail.spheres.push({x:centerX+dx*scale,y:centerY+dy*scale,rx:size*.5,ry:height*scale*.5});
    else detail.spheres.push({x:originX+width*.5+dx,y:originY+height*.5+dy,rx:width*.5,ry:height*.5});
  }
  function loaded(){ready=Boolean(background?.complete&&background.naturalWidth);lastStyle='';if(lastDetail)render({...lastDetail,spheres:[]});}
  background?.addEventListener('load',loaded);background?.addEventListener('error',()=>{ready=false;reset(root.dataset.atmosphereState??'idle');});
  if(background?.complete)loaded();
  root.addEventListener('artdico:atmosphere-frame',event=>render(event.detail));
  root.addEventListener('artdico:atmosphere-state',event=>{if(event.detail.state!=='active')reset(event.detail.state);else lastStyle='';});
  function point(event){
    if(root.dataset.atmosphereState!=='active')return;
    if(!slot)measureSlot(scrollY);targetX=clamp((event.clientX-slot.stageLeft)/Math.max(1,slot.stageWidth)*2-1,-1,1);targetY=clamp((event.clientY-(slot.stageTop-scrollY))/Math.max(1,slot.stageHeight)*2-1,-1,1);
  }
  stage.addEventListener('pointermove',event=>{if(event.pointerType==='mouse'&&fine.matches)point(event);},{passive:true});
  stage.addEventListener('pointerleave',neutral,{passive:true});stage.addEventListener('pointercancel',neutral,{passive:true});
  stage.addEventListener('pointerdown',event=>{if(event.pointerType!=='touch')return;point(event);clearTimeout(touchTimer);touchTimer=setTimeout(neutral,420);},{passive:true});
  fine.addEventListener('change',neutral);compact.addEventListener('change',()=>{lastStyle='';});
  reset(root.dataset.atmosphereState??'idle');
}
