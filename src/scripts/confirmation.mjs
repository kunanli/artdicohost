import { renderInvitation, invitationPngBlob } from '../lib/invitation-renderer.mjs';
import { confirmationToken, confirmationLink, confirmationEmailMessage, confirmationNotificationMessage, confirmationStatusLabels, createConfirmationClient, confirmationInvitationFacts, prepareConfirmationInvitation, confirmationWalletGuidance, CONFIRMATION_INVITATION_FILENAME, CONFIRMATION_CONTACT_EMAIL, CONFIRMATION_GROUP_UNAVAILABLE } from '../lib/confirmation-client.mjs';

const root = document.querySelector('[data-confirmation-page]');
if (root) {
  const $ = selector => root.querySelector(selector);
  $('.confirmation-skip').addEventListener('click',event=>{event.preventDefault();$('#confirmation-main').focus();});
  let token = confirmationToken(location.hash);
  const client = createConfirmationClient({apiOrigin:root.dataset.confirmationApi,pageOrigin:location.origin});
  let state = null, busy = false, generation = 0, walletUrl = null, printUrl = null, printRegistrationOpen = null, invitationUrl = null, controller = null;
  let groupTimer = null, groupCooldownTimer = null, groupNextReadAt = 0;
  const canvases=new Set();
  const contactButtons=[...root.querySelectorAll('[data-confirmation-contact-copy]')];
  const contactLabels=new Map(contactButtons.map(button=>[button,button.textContent]));
  const walletButton=$('[data-confirmation-wallet]'),walletBadge=$('[data-confirmation-wallet-badge]'),walletLabel=$('[data-confirmation-wallet-label]');
  let walletBadgeReady=Boolean(walletBadge?.complete&&walletBadge.naturalWidth>0);
  function syncWalletBadge(){
    const showBadge=walletBadgeReady&&!walletButton.hidden&&walletButton.dataset.walletAction==='add';
    if(walletBadge)walletBadge.hidden=!showBadge;
    if(walletLabel)walletLabel.hidden=showBadge;
    walletButton.classList.toggle('confirmation-wallet-badge',showBadge);
  }
  walletBadge?.addEventListener('load',()=>{walletBadgeReady=walletBadge.naturalWidth>0;syncWalletBadge();});
  walletBadge?.addEventListener('error',()=>{walletBadgeReady=false;syncWalletBadge();});
  const walletGuidance=()=>confirmationWalletGuidance({userAgent:navigator.userAgent,maxTouchPoints:navigator.maxTouchPoints,walletReady:state?.wallet.ready===true,invitationReady:state?.invitation.ready===true});
  function hideSafariGuide(){ $('[data-confirmation-safari-guide]').hidden=true;$('[data-confirmation-wechat-step]').hidden=true; }
  function releaseWallet() { if (walletUrl) URL.revokeObjectURL(walletUrl); walletUrl = null; }
  function clearInvitation(){
    if(invitationUrl)URL.revokeObjectURL(invitationUrl);invitationUrl=null;
    $('[data-confirmation-invitation-image]').removeAttribute('src');$('[data-confirmation-invitation-download]').removeAttribute('href');
    $('[data-confirmation-invitation-preview]').hidden=true;
    for(const canvas of canvases){canvas.width=0;canvas.height=0;}canvases.clear();
  }
  function clearGroupImage() { clearTimeout(groupTimer);groupTimer=null;const output=$('[data-confirmation-group-image]');for(const img of output.querySelectorAll('img'))img.removeAttribute('src');output.replaceChildren(); }
  function clearGroup() { clearGroupImage();$('[data-confirmation-group-status]').textContent='';$('[data-confirmation-group]').hidden=true; }
  function clearPrivateView(){
    for(const key of ['name','organization','event','date','time','venue','reference','email','application-received','pre-event-reminder'])$('[data-confirmation-'+key+']').textContent='';
    $('[data-confirmation-notifications]').hidden=true;$('[data-confirmation-private-link]').value='';$('[data-confirmation-copy-fallback]').hidden=true;
    walletButton.hidden=true;delete walletButton.dataset.walletAction;walletButton.removeAttribute('aria-label');walletButton.removeAttribute('aria-busy');if(walletLabel)walletLabel.textContent='加入 Apple Wallet';syncWalletBadge();
    $('[data-confirmation-invitation]').hidden=true;$('[data-confirmation-device]').textContent='';$('[data-confirmation-device]').hidden=true;
    $('[data-confirmation-facts-warning]').hidden=true;$('[data-confirmation-outcome-contact]').hidden=true;
    for(const selector of ['[data-confirmation-more]','[data-confirmation-registration]','[data-confirmation-notice-records]','[data-confirmation-group-help]'])$(selector).open=false;
    $('[data-confirmation-action-status]').textContent='';$('[data-confirmation-contact-status]').textContent='';
    for(const button of contactButtons)button.textContent=contactLabels.get(button);
    hideSafariGuide();
  }
  function invalidate(){generation++;controller?.abort();controller=null;printRegistrationOpen=null;releaseWallet();clearInvitation();clearGroup();clearPrivateView();$('[data-confirmation-content]').hidden=true;state=null;busy=false;delete root.dataset.admission;}
  function controls() {
    // Refresh explicitly cancels an older read, render or file preparation.
    $('[data-confirmation-refresh]').disabled=!token||!client.available;
    for(const button of root.querySelectorAll('[data-confirmation-print],[data-confirmation-copy],[data-confirmation-safari-copy],[data-confirmation-wallet]'))button.disabled=busy||!state;
    walletButton.setAttribute('aria-busy',String(busy&&Boolean(state)));
    const groupRefresh=$('[data-confirmation-group-refresh]'),cooling=Date.now()<groupNextReadAt;
    groupRefresh.disabled=busy||!state||cooling;groupRefresh.textContent=cooling?'稍后重读':'重新读取群码';
    const eligible=Boolean(confirmationInvitationFacts(state));$('[data-confirmation-invitation]').hidden=!eligible;$('[data-confirmation-invitation]').disabled=busy||!eligible;
  }
  function renderGroup(value) {
    clearGroup();if(value.admission.status!=='confirmed')return;
    $('[data-confirmation-group]').hidden=false;
    const unavailable=()=>{clearGroupImage();$('[data-confirmation-group-status]').textContent=CONFIRMATION_GROUP_UNAVAILABLE;};
    if(!value.groupInvite){unavailable();return;}
    const current=generation,img=document.createElement('img');img.alt='活动微信群入群二维码';img.referrerPolicy='no-referrer';img.crossOrigin='anonymous';img.decoding='async';
    const isCurrent=()=>current===generation&&$('[data-confirmation-group-image]').firstElementChild===img;
    img.addEventListener('error',()=>{if(isCurrent())unavailable();},{once:true});
    $('[data-confirmation-group-image]').append(img);$('[data-confirmation-group-status]').textContent='微信扫码或长按识别，以微信显示的入群结果为准。';img.src=value.groupInvite.qrImageUrl;
    // This timer only removes the expired image. A new read always needs an explicit action.
    groupTimer=setTimeout(()=>{if(isCurrent())unavailable();},Math.min(600_000,Math.max(0,Date.parse(value.groupInvite.expiresAt)-Date.now())));
  }
  function render(value) {
    clearInvitation();state=value;root.dataset.admission=value.admission.status;
    const labels=confirmationStatusLabels[value.admission.status];
    $('[data-confirmation-state]').textContent=labels[0];$('[data-confirmation-heading]').textContent=labels[1];$('[data-confirmation-intro]').textContent=labels[2];
    for(const[key,text]of Object.entries({name:value.attendee.name,organization:value.attendee.organization,event:value.event.title,date:value.event.date,time:value.event.time+'（UTC+8）'+(value.admission.status==='confirmed'?'，'+value.event.checkIn+' 开始签到':''),venue:value.event.venue,reference:value.referenceCode,email:confirmationEmailMessage(value.admission.status,value.email.status)}))$('[data-confirmation-'+key+']').textContent=text;
    $('[data-confirmation-notifications]').hidden=!value.notifications;
    for(const[kind,key]of [['applicationReceived','application-received'],['preEventReminder','pre-event-reminder']])$('[data-confirmation-'+key+']').textContent=value.notifications?confirmationNotificationMessage(kind,value.notifications[kind].status):'';
    $('[data-confirmation-print]').textContent=labels[3];$('[data-confirmation-copy]').textContent='复制私人链接';document.title=labels[1]+' · ARTDiCO HOST';
    $('.confirmation-person').hidden=value.admission.status==='withdrawn';
    $('[data-confirmation-save-heading]').textContent=value.admission.status==='confirmed'?'保存参会信息':'保存查询入口';
    $('[data-confirmation-outcome-contact]').hidden=!['rejected','withdrawn'].includes(value.admission.status);
    $('[data-confirmation-facts-warning]').hidden=value.eventFacts?.ready!==false;
    const guidance=walletGuidance();hideSafariGuide();
    walletButton.hidden=value.admission.status!=='confirmed'||!guidance.showWallet;
    if(walletLabel)walletLabel.textContent=guidance.label;else walletButton.textContent=guidance.label;
    walletButton.dataset.walletAction=guidance.action;walletButton.setAttribute('aria-label',guidance.label);syncWalletBadge();
    $('[data-confirmation-device]').textContent=value.admission.status==='confirmed'?guidance.message:'';$('[data-confirmation-device]').hidden=value.admission.status!=='confirmed';
    renderGroup(value);
    $('[data-confirmation-content]').hidden=false;$('[data-confirmation-error]').hidden=true;controls();
  }
  function showReadError(error){
    releaseWallet();clearInvitation();clearGroup();clearPrivateView();state=null;delete root.dataset.admission;$('[data-confirmation-content]').hidden=true;
    document.title='私人参会页 · ARTDiCO HOST';$('[data-confirmation-state]').textContent='私人参会页';$('[data-confirmation-heading]').textContent='暂时无法读取报名状态';$('[data-confirmation-intro]').textContent='请保留原查询链接，无需重复报名。';
    $('[data-confirmation-error]').textContent=error.message||'请稍后重新读取。';$('[data-confirmation-error]').hidden=false;
  }
  async function load() {
    invalidate();const current=generation;busy=true;controller=new AbortController();const signal=controller.signal;controls();$('[data-confirmation-state]').textContent='私人参会页';$('[data-confirmation-heading]').textContent='正在读取报名状态…';$('[data-confirmation-intro]').textContent='正在核对最新状态，请稍候。';
    try {
      if(!token)throw new Error('请从报名完成后的确认链接或确认邮件打开本页。');
      const value=await client.read(token,{signal});if(current!==generation)return;render(value);
    } catch(error) {if(current===generation&&!error.cancelled)showReadError(error);}
    finally {if(current===generation){busy=false;controller=null;controls();}}
  }
  $('[data-confirmation-refresh]').addEventListener('click',load);
  $('[data-confirmation-group-refresh]').addEventListener('click',()=>{
    if(busy||!state||Date.now()<groupNextReadAt)return;
    groupNextReadAt=Date.now()+5_000;clearTimeout(groupCooldownTimer);groupCooldownTimer=setTimeout(controls,5_000);void load();
  });
  for(const button of contactButtons)button.addEventListener('click',async()=>{
    const current=generation,view=state;
    try{await navigator.clipboard.writeText(CONFIRMATION_CONTACT_EMAIL);if(current!==generation||state!==view)return;button.textContent='已复制邮箱';$('[data-confirmation-contact-status]').textContent='联系邮箱已复制。';}
    catch{if(current!==generation||state!==view)return;button.textContent=CONFIRMATION_CONTACT_EMAIL;$('[data-confirmation-contact-status]').textContent='请手动复制 '+CONFIRMATION_CONTACT_EMAIL;}
  });
  async function copyPrivateLink(){
    if(!state||busy)return;const url=confirmationLink(token),current=generation,view=state;
    try {await navigator.clipboard.writeText(url);if(current===generation&&state===view)$('[data-confirmation-action-status]').textContent='私人链接已复制，请私下保存。';}
    catch{if(current!==generation||state!==view)return;const input=$('[data-confirmation-private-link]');input.value=url;$('[data-confirmation-copy-fallback]').hidden=false;$('[data-confirmation-action-status]').textContent='请手动复制下方私人链接。';input.focus();input.select();}
  }
  for(const button of root.querySelectorAll('[data-confirmation-copy],[data-confirmation-safari-copy]'))button.addEventListener('click',copyPrivateLink);
  $('[data-confirmation-safari-close]').addEventListener('click',()=>{hideSafariGuide();$('[data-confirmation-wallet]').focus();});
  $('[data-confirmation-safari-guide]').addEventListener('keydown',event=>{
    if(event.key==='Escape'){event.preventDefault();hideSafariGuide();$('[data-confirmation-wallet]').focus();}
  });
  function beforePrint(){if(printRegistrationOpen===null){printRegistrationOpen=$('[data-confirmation-registration]').open;$('[data-confirmation-registration]').open=true;}if(location.hash){printUrl=location.href;history.replaceState(null,'',location.pathname+location.search);}}
  function afterPrint(){if(printRegistrationOpen!==null){$('[data-confirmation-registration]').open=printRegistrationOpen;printRegistrationOpen=null;}if(printUrl){history.replaceState(null,'',printUrl);printUrl=null;}}
  window.addEventListener('beforeprint',beforePrint);window.addEventListener('afterprint',afterPrint);
  $('[data-confirmation-print]').addEventListener('click',()=>{if(!state||busy)return;beforePrint();try{window.print();}finally{afterPrint();}});
  $('[data-confirmation-wallet]').addEventListener('click',async()=>{
    if(!state?.wallet.ready||busy)return;
    const guidance=walletGuidance();
    if(guidance.action==='guide'){
      releaseWallet();$('[data-confirmation-wechat-step]').hidden=!guidance.wechat;$('[data-confirmation-safari-guide]').hidden=false;
      $('#confirmation-safari-heading').focus();return;
    }
    if(!['add','download'].includes(guidance.action))return;
    const current=generation;busy=true;controller=new AbortController();const signal=controller.signal;controls();releaseWallet();$('[data-confirmation-action-status]').textContent='正在准备 Wallet 票券…';
    try{const blob=await client.wallet(token,{signal});if(current!==generation)return;walletUrl=URL.createObjectURL(blob);const link=document.createElement('a');link.href=walletUrl;link.download='artdico-host.pkpass';document.body.append(link);link.click();link.remove();$('[data-confirmation-action-status]').textContent='票券文件已准备。请在支持 Apple Wallet 的设备上打开。';}
    catch(error){if(current===generation&&!error.cancelled)showReadError(error);}
    finally{if(current===generation){busy=false;controller=null;controls();}}
  });
  $('[data-confirmation-invitation]').addEventListener('click',async()=>{
    if(busy||!confirmationInvitationFacts(state))return;
    const current=generation,receiptToken=token,initial=state;busy=true;controller=new AbortController();const signal=controller.signal;
    const isCurrent=()=>current===generation&&receiptToken===token&&!signal.aborted;
    clearInvitation();controls();$('[data-confirmation-action-status]').textContent='正在核对并准备邀请函…';
    try{
      const result=await prepareConfirmationInvitation({receiptToken,initial,read:client.read,isCurrent,signal,generate:async settings=>{
        if(!isCurrent())throw new Error('已取消生成。');
        const canvas=document.createElement('canvas');canvases.add(canvas);
        try{await renderInvitation(canvas,settings);if(!isCurrent())throw new Error('已取消生成。');const blob=await invitationPngBlob(canvas);if(!isCurrent())throw new Error('已取消生成。');return blob;}
        finally{canvas.width=0;canvas.height=0;canvases.delete(canvas);}
      }});
      if(!isCurrent())return;render(result.view);invitationUrl=URL.createObjectURL(result.blob);
      const image=$('[data-confirmation-invitation-image]'),download=$('[data-confirmation-invitation-download]');
      image.src=invitationUrl;download.href=invitationUrl;download.download=CONFIRMATION_INVITATION_FILENAME;$('[data-confirmation-invitation-preview]').hidden=false;
      $('[data-confirmation-action-status]').textContent='邀请函已准备，可下载或长按图片保存。';
    }catch(error){if(!isCurrent()||error.cancelled)return;clearInvitation();if(error.view){render(error.view);$('[data-confirmation-action-status]').textContent=error.message||'邀请函暂时无法准备。';}else showReadError(error);}
    finally{if(current===generation){busy=false;controller=null;controls();}}
  });
  window.addEventListener('pagehide',()=>{invalidate();clearTimeout(groupCooldownTimer);groupCooldownTimer=null;printUrl=null;controls();});
  window.addEventListener('hashchange',()=>{printUrl=null;token=confirmationToken(location.hash);void load();});
  window.addEventListener('pageshow',event=>{if(event.persisted){token=confirmationToken(location.hash);void load();}});
  void load();
}
