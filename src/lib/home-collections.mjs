// Homepage interactions only: no storage, registration state or network access.
export function createHomeCollections({document:doc=globalThis.document,window:win=globalThis.window}={}) {
  if(!doc||!win)return {capture:()=>null,restore:()=>{},updateWorks:()=>{},reveal:()=>{},focusWorks:()=>{}};
  const grid=doc.querySelector('[data-public-showcases]'),filter=doc.querySelector('[data-public-works-filter]');
  const dialog=doc.querySelector('[data-work-lightbox]');
  const peekImage=doc.querySelector('[data-work-peek] img');
  peekImage?.addEventListener('error',()=>{const peek=doc.querySelector('[data-work-peek]');if(peek)peek.hidden=true;});
  let selectedId=null,previewId=null,previewTrigger=null,touch=null;
  const guestRequests=new WeakMap();
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
  function updateWorks(preferred=selectedId){
    const cards=works(),visible=filtered();
    selectedId=(visible.find(card=>card.dataset.showcaseId===preferred)||visible[0])?.dataset.showcaseId||null;
    for(const card of cards)card.hidden=card.dataset.showcaseId!==selectedId;
    const index=visible.findIndex(card=>card.dataset.showcaseId===selectedId);
    const count=doc.querySelector('[data-public-works-count]');
    if(count)count.textContent=visible.length?`${index+1} / ${visible.length} 件作品`:'0 件作品';
    const empty=doc.querySelector('[data-public-works-filter-empty]');if(empty)empty.hidden=cards.length===0||visible.length>0;
    const previous=doc.querySelector('[data-public-work-prev]'),next=doc.querySelector('[data-public-work-next]');
    if(previous)previous.disabled=index<=0;if(next)next.disabled=index<0||index>=visible.length-1;
    const navigation=doc.querySelector('[data-work-navigation]');
    if(navigation){
      if(visible.length<2&&navigation.contains(doc.activeElement)){
        if(filter)filter.focus({preventScroll:true});else heading('students-heading');
      }
      navigation.hidden=visible.length<2;
    }
    const selected=visible[index],hasCover=Boolean(selected?.querySelector('[data-work-preview]:not([hidden]) img:not([hidden])'));
    const stage=grid?.closest('.ah-work-stage');
    if(stage)stage.dataset.workPresentation=!selected?'empty':hasCover?'image':'text';
    const peek=doc.querySelector('[data-work-peek]'),peekImage=peek?.querySelector('img');
    const following=hasCover?visible[index+1]?.querySelector('[data-work-preview]:not([hidden]) img:not([hidden])'):null;
    if(peek){peek.hidden=!following;if(peekImage){if(following){peekImage.src=following.src;peekImage.alt='';}else peekImage.removeAttribute('src');}}
    if(grid){grid.dataset.carouselReady='true';grid.setAttribute('aria-roledescription','作品轮播');}
    syncPreview();
  }
  function step(offset){const cards=filtered(),index=cards.findIndex(card=>card.dataset.showcaseId===selectedId);const target=cards[index+offset];if(target)updateWorks(target.dataset.showcaseId);}
  filter?.addEventListener('change',()=>updateWorks());
  doc.querySelector('[data-public-work-prev]')?.addEventListener('click',()=>step(-1));
  doc.querySelector('[data-public-work-next]')?.addEventListener('click',()=>step(1));
  grid?.addEventListener('pointerdown',event=>{if(event.pointerType==='touch'&&event.isPrimary!==false)touch={x:event.clientX,y:event.clientY};});
  grid?.addEventListener('pointercancel',()=>{touch=null;});
  grid?.addEventListener('pointerup',event=>{
    if(!touch)return;const dx=event.clientX-touch.x,dy=event.clientY-touch.y;touch=null;
    if(Math.abs(dx)>50&&Math.abs(dx)>Math.abs(dy)*1.5)step(dx<0?1:-1);
  });
  const guestButtons=()=>[...doc.querySelectorAll('[data-public-guests] [data-guest-toggle]')];
  function updateGuest(button,wanted){
    if(!button)return;
    guestRequests.set(button,Boolean(wanted));
    const shown=Boolean(wanted)&&button.dataset.photoReady==='true';
    button.setAttribute('aria-pressed',String(shown));
    button.setAttribute('aria-label',button.dataset.guestIdentity+(button.dataset.photoState==='unavailable'?'':shown?'，显示文字':'，查看照片'));
    button.dispatchEvent(new CustomEvent('artdico:guest-photo-state',{bubbles:true}));
  }
  function openGuest(button){
    if(!button)return;
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
      if(guestRequests.get(guest))updateGuest(guest,false);else openGuest(guest);
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
    return {open:guestButtons().filter(button=>guestRequests.get(button)).map(button=>button.closest('[data-guest-id]').id),focus,active,scrollX:win.scrollX,scrollY:win.scrollY};
  }
  function restore(state){
    updateWorks();
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
  return {capture,restore,updateWorks,reveal,focusWorks:()=>heading('students-heading')};
}
