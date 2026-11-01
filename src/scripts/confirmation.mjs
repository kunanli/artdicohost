import { renderInvitation, invitationPngBlob } from '../lib/invitation-renderer.mjs';
import { confirmationToken, confirmationLink, confirmationEmailMessage, confirmationStatusLabels, createConfirmationClient, confirmationInvitationFacts, prepareConfirmationInvitation, confirmationWalletGuidance, CONFIRMATION_INVITATION_FILENAME, CONFIRMATION_CONTACT_EMAIL, CONFIRMATION_GROUP_UNAVAILABLE } from '../lib/confirmation-client.mjs';

const root = document.querySelector('[data-confirmation-page]');
if (root) {
  const $ = selector => root.querySelector(selector);
  $('.confirmation-skip').addEventListener('click',event=>{event.preventDefault();$('#confirmation-main').focus();});
  let token = confirmationToken(location.hash);
  const client = createConfirmationClient({apiOrigin:root.dataset.confirmationApi,pageOrigin:location.origin});
  let state = null, busy = false, generation = 0, walletUrl = null, printUrl = null, invitationUrl = null, controller = null;
  let groupTimer = null, groupCooldownTimer = null, groupNextReadAt = 0;
  const canvases=new Set();
  function releaseWallet() { if (walletUrl) URL.revokeObjectURL(walletUrl); walletUrl = null; }
  function clearInvitation(){
    if(invitationUrl)URL.revokeObjectURL(invitationUrl);invitationUrl=null;
    $('[data-confirmation-invitation-image]').removeAttribute('src');$('[data-confirmation-invitation-download]').removeAttribute('href');
    $('[data-confirmation-invitation-preview]').hidden=true;
    for(const canvas of canvases){canvas.width=0;canvas.height=0;}canvases.clear();
  }
  function clearGroupImage() { clearTimeout(groupTimer);groupTimer=null;const output=$('[data-confirmation-group-image]');for(const img of output.querySelectorAll('img'))img.removeAttribute('src');output.replaceChildren(); }
  function clearGroup() { clearGroupImage();$('[data-confirmation-group-status]').textContent='';$('[data-confirmation-group]').hidden=true; }
  function clearPrivateView(){for(const key of ['name','organization','event','date','time','venue','reference','email'])$('[data-confirmation-'+key+']').textContent='';$('[data-confirmation-private-link]').value='';$('[data-confirmation-copy-fallback]').hidden=true;$('[data-confirmation-wallet]').hidden=true;$('[data-confirmation-invitation]').hidden=true;$('[data-confirmation-device]').textContent='';$('[data-confirmation-device]').hidden=true;$('[data-confirmation-facts-warning]').hidden=true;$('[data-confirmation-outcome-contact]').hidden=true;$('[data-confirmation-more]').open=false;$('[data-confirmation-action-status]').textContent='';}
  function invalidate(){generation++;controller?.abort();controller=null;releaseWallet();clearInvitation();clearGroup();clearPrivateView();$('[data-confirmation-content]').hidden=true;state=null;busy=false;delete root.dataset.admission;}
  function controls() {
    // Refresh explicitly cancels an older read, render or file preparation.
    $('[data-confirmation-refresh]').disabled=!token||!client.available;
    for(const button of root.querySelectorAll('[data-confirmation-print],[data-confirmation-copy],[data-confirmation-wallet]'))button.disabled=busy||!state;
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
    $('[data-confirmation-print]').textContent=labels[3];$('[data-confirmation-copy]').textContent='保存私人查询链接';document.title=labels[1]+' · ARTDiCO HOST';
    $('.confirmation-person').hidden=value.admission.status==='withdrawn';
    $('[data-confirmation-save-heading]').textContent=value.admission.status==='confirmed'?'保存参会信息':'保存查询入口';
    $('[data-confirmation-outcome-contact]').hidden=!['rejected','withdrawn'].includes(value.admission.status);
    $('[data-confirmation-facts-warning]').hidden=value.eventFacts?.ready!==false;
    const guidance=confirmationWalletGuidance({userAgent:navigator.userAgent,maxTouchPoints:navigator.maxTouchPoints,walletReady:value.wallet.ready,invitationReady:value.invitation.ready});
    $('[data-confirmation-wallet]').hidden=value.admission.status!=='confirmed'||!guidance.showWallet;
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
  for(const button of root.querySelectorAll('[data-confirmation-contact-copy]'))button.addEventListener('click',async()=>{
    try{await navigator.clipboard.writeText(CONFIRMATION_CONTACT_EMAIL);button.textContent='已复制邮箱';$('[data-confirmation-contact-status]').textContent='联系邮箱已复制。';}
    catch{button.textContent=CONFIRMATION_CONTACT_EMAIL;$('[data-confirmation-contact-status]').textContent='请手动复制 '+CONFIRMATION_CONTACT_EMAIL;}
  });
  $('[data-confirmation-copy]').addEventListener('click',async()=>{
    if(!state||busy)return;const url=confirmationLink(token),current=generation;
    try {await navigator.clipboard.writeText(url);if(current===generation)$('[data-confirmation-action-status]').textContent='确认链接已复制，请私下保存。';}
    catch{if(current!==generation)return;const input=$('[data-confirmation-private-link]');input.value=url;$('[data-confirmation-copy-fallback]').hidden=false;input.focus();input.select();}
  });
  function beforePrint(){if(location.hash){printUrl=location.href;history.replaceState(null,'',location.pathname+location.search);}}
  function afterPrint(){if(printUrl){history.replaceState(null,'',printUrl);printUrl=null;}}
  window.addEventListener('beforeprint',beforePrint);window.addEventListener('afterprint',afterPrint);
  $('[data-confirmation-print]').addEventListener('click',()=>{if(!state||busy)return;beforePrint();try{window.print();}finally{afterPrint();}});
  $('[data-confirmation-wallet]').addEventListener('click',async()=>{
    if(!state?.wallet.ready||busy)return;const current=generation;busy=true;controller=new AbortController();const signal=controller.signal;controls();releaseWallet();
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
