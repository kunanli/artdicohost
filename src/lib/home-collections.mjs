// Homepage interactions only: no storage, registration state or network access.
export function createHomeCollections({document:doc=globalThis.document,window:win=globalThis.window}={}) {
  if(!doc||!win)return {capture:()=>null,restore:()=>{},updateWorks:()=>{},reveal:()=>{}};
  const grid=doc.querySelector('[data-public-showcases]'),filter=doc.querySelector('[data-public-works-filter]');
  const dialog=doc.querySelector('[data-work-lightbox]');
  const peekImage=doc.querySelector('[data-work-peek] img');
  peekImage?.addEventListener('error',()=>{const peek=doc.querySelector('[data-work-peek]');if(peek)peek.hidden=true;});
  let selectedId=null,previewId=null,previewTrigger=null,touch=null,closeTimer=null;
  const hoverOpened=new WeakSet();
  const visibleFocusTarget=node=>node?.isConnected&&!node.disabled&&!node.closest('[hidden],[inert]')&&node.getClientRects().length;
  const works=()=>[...doc.querySelectorAll('[data-public-showcases] [data-showcase-id]')];
  const filtered=()=>works().filter(card=>!['student','indie'].includes(filter?.value)||card.dataset.workKind===filter.value);
  function heading(id){doc.getElementById(id)?.focus({preventScroll:true});}
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
  const guestDetails=()=>[...doc.querySelectorAll('[data-public-guests] details.ah-guest-details')];
  function openGuest(details){clearTimeout(closeTimer);for(const other of guestDetails())other.open=other===details;}
  doc.addEventListener('toggle',event=>{const details=event.target;if(details.matches?.('[data-public-guests] details.ah-guest-details')&&details.open)openGuest(details);},true);
  doc.addEventListener('pointerover',event=>{
    const details=event.target.closest?.('[data-public-guests] details.ah-guest-details');
    if(details&&win.matchMedia('(hover:hover) and (pointer:fine)').matches&&!details.contains(event.relatedTarget)){
      clearTimeout(closeTimer);
      // Hover must not collapse the card currently used by the keyboard.
      if(guestDetails().some(other=>other!==details&&other.open&&other.contains(doc.activeElement)))return;
      if(!details.open){openGuest(details);hoverOpened.add(details);}
    }
  });
  doc.addEventListener('pointerout',event=>{
    const details=event.target.closest?.('[data-public-guests] details.ah-guest-details');
    if(details&&win.matchMedia('(hover:hover) and (pointer:fine)').matches&&!details.contains(event.relatedTarget)){
      clearTimeout(closeTimer);closeTimer=setTimeout(()=>{if(!details.contains(doc.activeElement))details.open=false;},150);
    }
  });
  doc.addEventListener('click',event=>{
    const summary=event.target.closest?.('[data-guest-toggle]'),guest=summary?.closest('details');
    if(guest){
      // Apply the single-card rule before the deferred native toggle event.
      // A pointer click after hover keeps its just-revealed card open.
      event.preventDefault();
      summary.focus({preventScroll:true});
      if(!(event.detail>0&&hoverOpened.has(guest)&&guest.open)){
        if(guest.open)guest.open=false;else openGuest(guest);
      }
      hoverOpened.delete(guest);
    }
    if(!event.target.closest?.('[data-public-guests]'))for(const details of guestDetails())details.open=false;
    const button=event.target.closest?.('[data-work-preview]');if(!button||button.disabled||!dialog)return;
    const image=button.querySelector('img:not([hidden])');if(!image)return;
    previewId=button.closest('[data-showcase-id]').dataset.showcaseId;previewTrigger=button;
    if(!dialog.open)dialog.showModal();syncPreview();
  });
  doc.addEventListener('keydown',event=>{
    if(event.key==='Escape')for(const details of guestDetails())if(details.open){details.open=false;if(details.contains(doc.activeElement))details.querySelector('summary')?.focus({preventScroll:true});}
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
    if(target.matches('[data-guest-id]'))openGuest(target.querySelector('details'));
    return true;
  }
  win.addEventListener('hashchange',()=>reveal(win.location.hash.slice(1)));
  function capture(){
    clearTimeout(closeTimer);
    const active=doc.activeElement,card=active?.closest?.('[data-guest-id],[data-showcase-id],[data-organization-id],[id^="program-"]');
    const focus=card?{id:card.id,self:card===active,index:[...card.querySelectorAll('a,button,summary,[tabindex]')].indexOf(active),href:active.getAttribute('href'),key:active.dataset.focusKey}:null;
    return {open:guestDetails().filter(details=>details.open).map(details=>details.closest('[data-guest-id]').id),focus,active,scrollX:win.scrollX,scrollY:win.scrollY};
  }
  function restore(state){
    updateWorks();
    for(const id of state?.open||[]){const details=doc.getElementById(id)?.querySelector('details');if(details)openGuest(details);}
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
      // Disclosure layout and browser scroll anchoring settle on the next frame.
      win.requestAnimationFrame(()=>win.scrollTo(position));
    }
  }
  return {capture,restore,updateWorks,reveal};
}
