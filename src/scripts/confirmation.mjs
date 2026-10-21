import { confirmationToken, confirmationLink, confirmationEmailLabels, createConfirmationClient } from '../lib/confirmation-client.mjs';

const root = document.querySelector('[data-confirmation-page]');
if (root) {
  const $ = selector => root.querySelector(selector), token = confirmationToken(location.hash);
  const client = createConfirmationClient({apiOrigin:root.dataset.confirmationApi,pageOrigin:location.origin});
  let state = null, busy = false, generation = 0, walletUrl = null, printUrl = null;
  function releaseWallet() { if (walletUrl) URL.revokeObjectURL(walletUrl); walletUrl = null; }
  function clearGroup() { const output=$('[data-confirmation-group-image]');for(const img of output.querySelectorAll('img'))img.removeAttribute('src');output.replaceChildren();$('[data-confirmation-group]').hidden=true; }
  function clearPrivateView(){for(const key of ['name','organization','event','date','time','venue','reference','email'])$('[data-confirmation-'+key+']').textContent='';$('[data-confirmation-private-link]').value='';$('[data-confirmation-copy-fallback]').hidden=true;$('[data-confirmation-wallet]').hidden=true;}
  function controls() {
    $('[data-confirmation-refresh]').disabled=busy||!token||!client.available;
    for(const button of root.querySelectorAll('[data-confirmation-print],[data-confirmation-copy],[data-confirmation-wallet]'))button.disabled=busy||!state;
  }
  function render(value) {
    state=value;root.dataset.admission=value.admission.status;
    const labels={confirmed:['名额已确认','报名已确认','期待在现场与你相见。请保存登记编号，方便签到和后续核对。'],waitlisted:['尚未确认名额','候补登记已保存','你已进入候补队列，目前尚未确认参会名额。请等待筹备团队的后续通知，无需重复报名。'],withdrawn:['名额已取消','这份报名已取消','这份报名当前不再占用参会名额。如需调整，请通过原联系渠道向筹备团队核对。']}[value.admission.status];
    $('[data-confirmation-state]').textContent=labels[0];$('[data-confirmation-heading]').textContent=labels[1];$('[data-confirmation-intro]').textContent=labels[2];
    for(const[key,text]of Object.entries({name:value.attendee.name,organization:value.attendee.organization,event:value.event.title,date:value.event.date,time:value.event.time+'（UTC+8），'+value.event.checkIn+' 开始签到',venue:value.event.venue,reference:value.referenceCode,email:confirmationEmailLabels[value.email.status]}))$('[data-confirmation-'+key+']').textContent=text;
    $('.confirmation-person').hidden=value.admission.status==='withdrawn';
    $('[data-confirmation-wallet]').hidden=!value.wallet.ready;
    clearGroup();
    if(value.groupInvite){const img=document.createElement('img');img.alt='活动微信群入群二维码';img.referrerPolicy='no-referrer';img.crossOrigin='anonymous';img.decoding='async';img.addEventListener('error',()=>{if($('[data-confirmation-group-image]').firstElementChild===img)clearGroup();},{once:true});$('[data-confirmation-group-image]').append(img);$('[data-confirmation-group]').hidden=false;img.src=value.groupInvite.qrImageUrl;}
    $('[data-confirmation-content]').hidden=false;$('[data-confirmation-error]').hidden=true;controls();
  }
  async function load() {
    if(busy)return;const current=++generation;busy=true;state=null;releaseWallet();clearGroup();controls();
    $('[data-confirmation-content]').hidden=true;clearPrivateView();delete root.dataset.admission;$('[data-confirmation-action-status]').textContent='';
    try {
      if(!token)throw new Error('请从报名完成后的确认链接或确认邮件打开本页。');
      const value=await client.read(token);if(current!==generation)return;render(value);
    } catch(error) {
      if(current!==generation)return;delete root.dataset.admission;$('[data-confirmation-state]').textContent='报名确认';$('[data-confirmation-heading]').textContent='暂时无法读取报名状态';$('[data-confirmation-intro]').textContent='请保留原有登记编号，无需重复报名。';
      $('[data-confirmation-error]').textContent=error.message||'请稍后重新读取。';$('[data-confirmation-error]').hidden=false;
    } finally {if(current===generation){busy=false;controls();}}
  }
  $('[data-confirmation-refresh]').addEventListener('click',load);
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
    if(!state?.wallet.ready||busy)return;const current=generation;busy=true;controls();releaseWallet();
    try{const blob=await client.wallet(token);if(current!==generation)return;walletUrl=URL.createObjectURL(blob);const link=document.createElement('a');link.href=walletUrl;link.download='artdico-host.pkpass';document.body.append(link);link.click();link.remove();$('[data-confirmation-action-status]').textContent='票券文件已准备。请在支持 Apple Wallet 的设备上打开。';}
    catch(error){if(current===generation)$('[data-confirmation-action-status]').textContent=error.message||'票券暂时无法准备，请稍后再试。';}
    finally{if(current===generation){busy=false;controls();}}
  });
  window.addEventListener('pagehide',()=>{generation++;releaseWallet();clearGroup();clearPrivateView();$('[data-confirmation-content]').hidden=true;state=null;busy=false;controls();});
  window.addEventListener('pageshow',event=>{if(event.persisted)void load();});
  void load();
}
