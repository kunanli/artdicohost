import { createGuestPhotoRotation } from './guest-photo-rotation.mjs';
import { createWorkCarousel } from './work-carousel.mjs';

/** One shuffle per newly encountered batch; live refreshes retain this page's order. */
export function createMosaicOrder(random=Math.random){
  let order=[];
  return (allIds,visibleIds=allIds)=>{
    const current=new Set(allIds);order=order.filter(id=>current.has(id));
    const known=new Set(order),added=allIds.filter(id=>!known.has(id));
    for(let i=added.length-1;i>0;i--){const j=Math.floor(random()*(i+1));[added[i],added[j]]=[added[j],added[i]];}
    order.push(...added);const visible=new Set(visibleIds);return order.filter(id=>visible.has(id));
  };
}

// Public homepage interactions only; no playback preference or business storage.
export function createHomeCollections({document:doc=globalThis.document,window:win=globalThis.window}={}) {
  if(!doc||!win)return {capture:()=>null,restore:()=>{},updateWorks:()=>{},prepareWorks:()=>{},reveal:()=>{},focusWorks:()=>{}};
  const grid=doc.querySelector('[data-public-showcases]'),filter=doc.querySelector('[data-public-works-filter]');
  const dialog=doc.querySelector('[data-work-lightbox]');
  const workCarousel=createWorkCarousel({grid,window:win});
  let previewId=null,previewTrigger=null;
  const guestRequests=new WeakMap(),automaticPhotos=new WeakSet();
  let guestRotation;
  const visibleFocusTarget=node=>node?.isConnected&&!node.disabled&&!node.closest('[hidden],[inert]')&&node.getClientRects().length;
  const works=()=>[...doc.querySelectorAll('[data-public-showcases] [data-showcase-id]')];
  const filtered=()=>works().filter(card=>!['student','indie'].includes(filter?.value)||card.dataset.workKind===filter.value);
  function heading(id){
    let target=doc.getElementById(id);
    if(id==='students-heading'&&!visibleFocusTarget(target)){
      const section=grid?.closest('section');
      for(let next=section?.nextElementSibling;next;next=next.nextElementSibling){
        const candidate=next.querySelector('h2');
        if(visibleFocusTarget(candidate)){target=candidate;break;}
      }
      if(!visibleFocusTarget(target))target=['agenda-heading','about-heading'].map(key=>doc.getElementById(key)).find(visibleFocusTarget);
    }
    if(visibleFocusTarget(target)){
      if(!target.hasAttribute('tabindex'))target.tabIndex=-1;
      target.focus({preventScroll:true});
    }
  }
  function closePreview({restoreFocus=true}={}){
    if(!dialog?.open)return;
    dialog.close();previewId=null;
    if(restoreFocus){
      if(visibleFocusTarget(previewTrigger))previewTrigger.focus({preventScroll:true});
      else heading('students-heading');
    }
  }
  function syncPreview(){
    if(!dialog?.open)return;
    const card=works().find(row=>row.dataset.showcaseId===previewId),photo=card?.querySelector('[data-work-preview] img:not([hidden])');
    if(!photo){closePreview();return;}
    const image=dialog.querySelector('img'),title=dialog.querySelector('[data-work-lightbox-title]');
    if(image){image.src=photo.src;image.alt=photo.alt;}
    if(title)title.textContent=card.querySelector('h3')?.textContent||'作品图';
    previewTrigger=card.querySelector('[data-work-preview]');
  }
  function updateWorks(preferred=workCarousel.current()){
    const cards=works(),visible=filtered();
    for(const card of cards)card.hidden=!visible.includes(card);
    workCarousel.update(preferred);
    syncPreview();
    renderMosaic(visible);
  }
  const mosaic=doc.querySelector('[data-work-mosaic]'),mosaicOrder=createMosaicOrder();
  function renderMosaic(cards){
    if(!mosaic)return;
    // Reconcile by stable work ID so publication refreshes retain keyboard focus.
    const focused=mosaic.contains(doc.activeElement)?doc.activeElement:null;
    const existing=new Map([...mosaic.children].map(node=>[node.dataset.mosaicId,node]));
    const byId=new Map(cards.map(card=>[card.dataset.showcaseId,card]));
    const ordered=mosaicOrder(works().map(card=>card.dataset.showcaseId),[...byId.keys()]);
    for(const [position,id] of ordered.entries()){
      const card=byId.get(id),title=card.querySelector('h3')?.textContent||'',photo=card.querySelector('[data-work-preview] img:not([hidden])');
      let item=existing.get(id);
      if(!item){item=doc.createElement('li');item.dataset.mosaicId=id;const button=doc.createElement('button');button.type='button';button.dataset.workThumbnail=id;item.append(button);}
      existing.delete(id);
      const button=item.firstElementChild;
      let image=button.querySelector('img'),caption=button.querySelector('span');
      if(photo){
        if(!image){image=doc.createElement('img');image.alt='';image.loading='lazy';image.referrerPolicy='no-referrer';image.crossOrigin='anonymous';image.addEventListener('error',()=>{image.hidden=true;});button.prepend(image);}
        if(image.getAttribute('src')!==photo.getAttribute('src')){image.hidden=false;image.src=photo.src;}
      }else image?.remove();
      if(!caption){caption=doc.createElement('span');button.append(caption);}
      if(caption.textContent!==title)caption.textContent=title;
      button.setAttribute('aria-label',title);
      if(mosaic.children[position]!==item)mosaic.insertBefore(item,mosaic.children[position]??null);
    }
    for(const item of existing.values())item.remove();
    if(focused?.isConnected&&doc.activeElement!==focused)focused.focus({preventScroll:true});
    mosaic.closest('[data-work-overview]').hidden=cards.length===0;
  }
  mosaic?.addEventListener('click',event=>{
    const button=event.target.closest('[data-work-thumbnail]');if(!button)return;
    workCarousel.select(button.dataset.workThumbnail,false);
    grid.focus({preventScroll:true});
    grid.closest('.ah-work-stage').scrollIntoView({block:'center',behavior:win.matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'});
  });
  filter?.addEventListener('change',()=>{workCarousel.prepare();updateWorks();});
  const guestButtons=()=>[...doc.querySelectorAll('[data-public-guests] [data-guest-toggle]')];
  function updateGuest(button,wanted,automatic=false){
    if(!button)return;
    if(automatic){if(wanted)automaticPhotos.add(button);else automaticPhotos.delete(button);}
    else guestRequests.set(button,Boolean(wanted));
    const shown=Boolean(guestRequests.get(button)||automaticPhotos.has(button))&&button.dataset.photoReady==='true';
    button.setAttribute('aria-pressed',String(shown));
    button.setAttribute('aria-label',button.dataset.guestIdentity+(button.dataset.photoState==='unavailable'?'':shown?'，显示文字':'，查看照片'));
    button.dispatchEvent(new CustomEvent('artdico:guest-photo-state',{bubbles:true}));
    if(!automatic)guestRotation?.refresh();
  }
  guestRotation=createGuestPhotoRotation({document:doc,window:win,buttons:guestButtons,manual:button=>guestRequests.get(button),render:(button,wanted)=>updateGuest(button,wanted,true)});
  function openGuest(button){
    if(!button)return;
    guestRotation.exclude(button);
    for(const other of guestButtons())updateGuest(other,other===button);
  }
  doc.addEventListener('artdico:guest-photo-change',event=>{
    const button=event.target;
    if(button.matches?.('[data-public-guests] [data-guest-toggle]'))updateGuest(button,button.dataset.photoState!=='unavailable'&&guestRequests.get(button));
  });
  doc.addEventListener('pointerover',event=>{
    const button=event.target.closest?.('[data-public-guests] [data-guest-toggle]');
    if(button&&event.pointerType!=='touch'&&win.matchMedia('(hover:hover) and (pointer:fine)').matches&&!button.contains(event.relatedTarget)){
      // Keep a photo being used by the keyboard stable while the pointer passes.
      if(guestButtons().some(other=>other!==button&&other===doc.activeElement&&other.getAttribute('aria-pressed')==='true'))return;
      openGuest(button);
    }
  });
  doc.addEventListener('pointerout',event=>{
    const button=event.target.closest?.('[data-public-guests] [data-guest-toggle]');
    if(button&&event.pointerType!=='touch'&&win.matchMedia('(hover:hover) and (pointer:fine)').matches&&!button.contains(event.relatedTarget))updateGuest(button,false);
  });
  doc.addEventListener('focusout',event=>{
    const button=event.target.closest?.('[data-public-guests] [data-guest-toggle]');
    if(button&&!button.contains(event.relatedTarget))updateGuest(button,false);
  });
  doc.addEventListener('click',event=>{
    const guest=event.target.closest?.('[data-public-guests] [data-guest-toggle]');
    if(guest&&guest.getAttribute('aria-disabled')!=='true'){
      if(guest.getAttribute('aria-pressed')==='true'){guestRotation.exclude(guest);updateGuest(guest,false);}else openGuest(guest);
    }
    if(!event.target.closest?.('[data-public-guests]'))for(const button of guestButtons())updateGuest(button,false);
    const button=event.target.closest?.('[data-work-preview]');if(!button||button.disabled||!dialog)return;
    const image=button.querySelector('img:not([hidden])');if(!image)return;
    previewId=button.closest('[data-showcase-id]').dataset.showcaseId;previewTrigger=button;
    if(!dialog.open)dialog.showModal();syncPreview();
  });
  doc.addEventListener('keydown',event=>{
    if(event.key==='Escape')for(const button of guestButtons())updateGuest(button,false);
  });
  dialog?.querySelector('[data-work-lightbox-close]')?.addEventListener('click',()=>closePreview());
  dialog?.addEventListener('cancel',event=>{event.preventDefault();closePreview();});
  dialog?.addEventListener('click',event=>{if(event.target===dialog)closePreview();});
  function reveal(id){
    const target=doc.getElementById(id);if(!target)return false;
    if(target.matches('[data-showcase-id]')){
      if(filter&&['student','indie'].includes(filter.value)&&target.dataset.workKind!==filter.value)filter.value='all';
      updateWorks(target.dataset.showcaseId);
      workCarousel.select(target.dataset.showcaseId);
    }
    for(let parent=target.parentElement;parent;parent=parent.parentElement)if(parent.tagName==='DETAILS')parent.open=true;
    if(target.matches('[data-organization-id]'))target.dispatchEvent(new CustomEvent('artdico:organization-reveal',{bubbles:true,detail:{id:target.id}}));
    if(target.matches('[data-guest-id]'))openGuest(target.querySelector('[data-guest-toggle]'));
    return true;
  }
  win.addEventListener('hashchange',()=>{const id=win.location.hash.slice(1);if(reveal(id)&&doc.getElementById(id)?.matches('[data-organization-id]'))win.requestAnimationFrame(()=>doc.getElementById(id)?.scrollIntoView({block:'start',behavior:'instant'}));});
  function capture(){
    const active=doc.activeElement,card=active?.closest?.('[data-guest-id],[data-showcase-id],[data-organization-id],[id^="program-"]');
    const focus=card?{id:card.id,self:card===active,index:[...card.querySelectorAll('a,button,summary,[tabindex]')].indexOf(active),href:active.getAttribute('href'),key:active.dataset.focusKey}:null;
    return {workId:workCarousel.current(),open:guestButtons().filter(button=>guestRequests.get(button)).map(button=>button.closest('[data-guest-id]').id),focus,active,scrollX:win.scrollX,scrollY:win.scrollY};
  }
  function restore(state){
    updateWorks(state?.workId);
    if(state?.workId)workCarousel.select(state.workId);
    for(const id of state?.open||[])openGuest(doc.getElementById(id)?.querySelector('[data-guest-toggle]'));
    if(state?.focus&&!state.active.isConnected){
      const card=doc.getElementById(state.focus.id),controls=card?[...card.querySelectorAll('a,button,summary,[tabindex]')]:[];
      const target=state.focus.self?card:controls.find(node=>state.focus.key&&node.dataset.focusKey===state.focus.key)||controls.find(node=>state.focus.href&&node.getAttribute('href')===state.focus.href)||controls[state.focus.index];
      if(visibleFocusTarget(target))target.focus({preventScroll:true});
      else heading(state.focus.id.startsWith('guest-')?'guests-heading':state.focus.id.startsWith('work-')?'students-heading':state.focus.id.startsWith('program-')?'agenda-heading':'booths-heading');
    }
    // A refresh may introduce the session/work addressed by the original URL.
    // Do not reselect an old hash over the visitor's later carousel choice.
    if(!state){
      const id=win.location.hash.slice(1),target=doc.getElementById(id);
      if(reveal(id)&&target?.matches('[data-showcase-id],[data-guest-id],[data-organization-id]'))win.requestAnimationFrame(()=>target.scrollIntoView({block:'start',behavior:'instant'}));
    }
    if(state){
      const position={left:state.scrollX,top:state.scrollY,behavior:'instant'};
      win.scrollTo(position);
      // Browser scroll anchoring settles on the next frame after replacement.
      win.requestAnimationFrame(()=>win.scrollTo(position));
    }
  }
  return {capture,restore,updateWorks,prepareWorks:workCarousel.prepare,reveal,focusWorks:()=>heading('students-heading')};
}
