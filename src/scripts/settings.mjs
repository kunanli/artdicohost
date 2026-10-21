import {createStaffSettings} from './staff-settings.mjs';
import {createDeliverySettings} from './delivery-settings.mjs';
import {createSettingsSession} from '../lib/settings-session.mjs';
import {canManageEventOperations,canManageAccounts} from '../../shared/staff-permissions.mjs';
import {createBrowserDraftStore} from '../lib/browser-drafts.mjs';
import {eventConfig} from '../config/event.mjs';

const root=document.querySelector('[data-settings-admin]'),$=selector=>root.querySelector(selector);
const secure=location.protocol==='https:'||['127.0.0.1','localhost'].includes(location.hostname);
let user=null,busy=false,epoch=0,groupState=null;
function announce(message,error=false){$('[data-settings-page-status]').textContent=error?'':message;$('[data-settings-page-error]').textContent=error?message:'';$('[data-settings-page-error]').hidden=!error;if(error)$('[data-settings-page-error]').focus();}
const transport=createSettingsSession({
  onExpired(path){const hadUser=Boolean(user);clear();if(path==='/api/admin/login')announce('账号或密码未通过验证。',true);else if(hadUser)announce('会话已结束，请重新登录。',true);},
  onForbidden(){clear();announce('此账号的设置权限已改变。请重新登录核对权限。',true);},
});
const request=(path,options)=>transport.request(path,options);
const draftStore=createBrowserDraftStore();
const staffRoot=$('[data-staff-settings]'),deliveryRoot=$('[data-delivery-settings]');
const staffSettings=createStaffSettings({root:staffRoot,request,draftStore,eventId:eventConfig.id,binaryRequest:(path,body)=>request(path,{method:'POST',body:JSON.stringify(body),binary:true})});
const deliverySettings=createDeliverySettings({root:deliveryRoot,request,draftStore,eventId:eventConfig.id});
const pending=()=>staffSettings.pending||deliverySettings.pending;
const dirty=()=>staffSettings.dirty||deliverySettings.dirty;
function lock(){
  for(const field of $('[data-settings-login]').querySelectorAll('input,button'))field.disabled=busy||!secure;
  $('[data-settings-refresh]').disabled=busy||!canManageEventOperations(user);
  $('[data-settings-logout]').disabled=busy;
  staffSettings.lock(busy);deliverySettings.lock(busy);
}
function clear(){
  epoch++;transport.clear();user=null;busy=false;groupState=null;staffSettings.clear();deliverySettings.clear();
  $('[data-settings-workspace]').hidden=true;$('[data-settings-account]').hidden=true;$('[data-settings-login-panel]').hidden=false;
  $('[data-settings-authorized]').hidden=true;$('[data-settings-access-denied]').hidden=true;$('[data-settings-user]').textContent='';
  $('[data-settings-login]').reset();for(const selector of ['[data-settings-mail-summary]','[data-settings-group-summary]','[data-settings-wallet-summary]'])$(selector).textContent='状态尚未载入';
  for(const link of root.querySelectorAll('[data-staff-admin-link],[data-settings-accounts-link]'))link.hidden=true;
  for(const details of root.querySelectorAll('.settings-workspace-tools, .delivery-guide'))details.open=false;
  lock();
}
async function load(){
  if(!canManageEventOperations(user))return;
  const started=epoch;await Promise.all([staffSettings.configure(user),deliverySettings.configure(user)]);
  if(started!==epoch)return;
}
async function acceptSession(result){
  user=transport.setSession(result);
  $('[data-settings-user]').textContent=user.label||user.id;
  $('[data-settings-login-panel]').hidden=true;$('[data-settings-account]').hidden=false;$('[data-settings-workspace]').hidden=false;
  const allowed=canManageEventOperations(user);$('[data-settings-access-denied]').hidden=allowed;$('[data-settings-authorized]').hidden=!allowed;
  for(const link of root.querySelectorAll('[data-staff-admin-link],[data-settings-accounts-link]'))link.hidden=!canManageAccounts(user);
  if(allowed){
    await load();
    const anchor=location.hash;
    if(['#delivery-settings-heading','#wallet-settings-title','#group-settings-title','#staff-settings-title','#invitation-settings-title',...(canManageAccounts(user)?['#staff-accounts-title']:[])].includes(anchor))requestAnimationFrame(()=>{
      if(user!==result.user||location.hash!==anchor||$('[data-settings-workspace]').hidden)return;
      const heading=document.getElementById(anchor.slice(1));if(heading){heading.tabIndex=-1;heading.focus({preventScroll:true});heading.scrollIntoView({block:'start',behavior:'instant'});}
    });
  }
}
async function action(callback){
  if(busy)return;const started=epoch;busy=true;lock();
  try{await callback(started);}catch(error){if(started===epoch)announce(error.message||'设置操作尚未完成，请重新核对。',true);}
  finally{if(started===epoch){busy=false;lock();}}
}
function renderGroup(){
  if(!groupState)return;
  const expires=Date.parse(groupState.expiresAt),remaining=expires-Date.now();
  $('[data-settings-group-summary]').textContent=!groupState.configured?'尚未配置 · 上传入群原图':groupState.expired||remaining<=0?'已过期 · 请替换二维码':(remaining<=86400000?'24 小时内到期 · ':'已配置 · ')+new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Shanghai',month:'numeric',day:'numeric',hour:'numeric',minute:'2-digit',hour12:false}).format(new Date(expires))+' 到期（UTC+8）';
}
staffRoot.addEventListener('staff-settings-state',event=>{groupState=event.detail;renderGroup();});
deliveryRoot.addEventListener('delivery-settings-state',event=>{
  const {email,wallet}=event.detail;
  $('[data-settings-mail-summary]').textContent=email.ready?(email.automaticEnabled?'设置可用 · 自动确认已开启':'设置可用 · 自动确认未开启'):'尚未就绪 · 核对受控配置与寄件开关';
  $('[data-settings-wallet-summary]').textContent=wallet.ready?(wallet.deviceTestRequired?'签章可用 · 仍需 iPhone 验收':'签章可用'):wallet.reason==='WALLET_NOT_CONFIGURED'?'尚未配置 · 完成开发者注册后继续':wallet.reason==='WALLET_DISABLED'?'已配置 · 票券尚未开启':wallet.reason==='WALLET_CERTIFICATE_EXPIRED'?'证书已到期 · 需要轮替':'暂未就绪 · 请核对签章设置';
});
// Advance expiry labels locally; opening or refreshing the page never writes or sends.
setInterval(renderGroup,60000);
$('[data-settings-login]').addEventListener('submit',event=>{
  event.preventDefault();const form=event.currentTarget;if(!form.reportValidity())return;
  const login=Object.fromEntries(new FormData(form));
  action(async started=>{let result;try{result=await request('/api/admin/login',{method:'POST',body:JSON.stringify(login)});}finally{if(started===epoch)form.elements.namedItem('password').value='';login.password='';}
    if(started!==epoch)return;await acceptSession(result);if(started===epoch)announce('已登录。设置修改分别保存；不会自动补寄历史名单。');});
});
$('[data-settings-refresh]').addEventListener('click',()=>{
  if(pending()){announce('有操作正在进行或结果尚待确认，请先在对应区块确认原操作。刷新不会发送邮件。',true);return;}
  action(async started=>{await load();if(started===epoch)announce('已重新读取状态；未保存的表单仍保留。请同时核对各区块的读取结果。');});
});
$('[data-settings-logout]').addEventListener('click',()=>{
  if((pending()||dirty())&&!confirm(pending()?'有操作正在进行或结果尚待确认。建议先核对原操作，退出会清空本页的重试入口。仍要退出吗？':'有未保存的设置内容，确定退出并清空本页吗？'))return;
  action(async started=>{const actorId=user?.id;await request('/api/admin/logout',{method:'POST'});if(started!==epoch)return;clear();let cleared=true;try{if(actorId)await draftStore.clearActor(actorId);}catch{cleared=false;}announce(cleared?'已退出，本页资料与此账号的本机草稿已清空。':'已退出并清空本页。此浏览器的本机草稿尚未确认清除，请在共用设备清除本站数据。',!cleared);});
});
window.addEventListener('beforeunload',event=>{if(dirty()||pending()){event.preventDefault();event.returnValue='';}});
window.addEventListener('pagehide',()=>staffSettings.wipeSecrets());
clear();
if(secure)action(async started=>{const result=await request('/api/admin/session');if(started!==epoch)return;await acceptSession(result);if(started===epoch)announce('已恢复工作人员会话。');});
else announce('请通过已配置的 HTTPS 工作人员入口登录。',true);
