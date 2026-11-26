import { createRegistrationClient } from '../lib/registration-client.mjs';
import { createBrowserDraftStore } from '../lib/browser-drafts.mjs';
import { createApplicationDraft, applicationDraftFromFields } from '../lib/application-draft.mjs';
import { cardJammerOption, validateWalletApplicationFields, WALLET_APPLICATION_INTAKE, WALLET_PREFERENCE_FIELDS } from '../../shared/general-application.mjs';
import { eventConfig } from '../config/event.mjs';

for(const section of document.querySelectorAll('[data-wallet-api-origin]')){
 const form=section.querySelector('[data-wallet-form]'),button=form.querySelector('[data-wallet-submit]'),error=form.querySelector('[data-wallet-error]'),status=form.querySelector('[data-wallet-draft-status]'),restore=form.querySelector('[data-wallet-draft-restore]');
 const configMessage=form.querySelector('[data-wallet-config-status]'),retry=form.querySelector('[data-wallet-config-retry]');
 let draft,config=null,blocked=false,busy=false,done=false,loaded=false,timer=null,writing=Promise.resolve(),editing=0,savedEditing=0,revision=0;
 let configState='loading';
 const client=createRegistrationClient({apiOrigin:section.dataset.walletApiOrigin,pageOrigin:location.origin,applicationKind:'wallet',pendingStore:{prepare:value=>draft.pendingStore.prepare(value),update:value=>draft.pendingStore.update(value),clear:value=>draft.pendingStore.clear(value),reject:value=>draft.pendingStore.reject(value)}});
 const control=name=>form.elements.namedItem('wallet.'+name);
 const role=control('ggjRole'),jammer=form.querySelector('[data-ggj-jammer]');
 const fieldNames=['name','email','wechat','huodongxingReference','phone','organization',...WALLET_PREFERENCE_FIELDS];
 const text=(node,value)=>{node.textContent=value;};
 function syncJammer(){
  const option=cardJammerOption(role.value);
  jammer.checked=option.selected;
  jammer.disabled=role.disabled||!option.canToggle;
 }
 function fields(){return{intake:WALLET_APPLICATION_INTAKE,locale:document.documentElement.lang.startsWith('en')?'en':'zh-CN',...Object.fromEntries(fieldNames.map(name=>[name,control(name).value])),categories:['other'],participationInterests:['attend']};}
 function apply(value){
  for(const name of fieldNames)control(name).value=value[name]??'';
  control('consentAccepted').checked=false;
  syncJammer();
 }
 function lock(){
  for(const input of form.querySelectorAll('input,select,textarea'))input.disabled=busy||done||client.pending||!loaded||!config;
  syncJammer();
  button.disabled=busy||done||!loaded||blocked||!client.pending&&!config;
  const serviceLabel={loading:'正在确认申请服务…',unavailable:'申请服务暂时不可用',closed:'纪念卡申请已关闭',open:'提交纪念卡申请'}[configState];
  text(button,busy?'正在核对纪念卡申请…':client.pending?'核对原纪念卡申请':serviceLabel);
  const canRetry=!client.pending&&!done&&configState==='unavailable';
  retry.hidden=!canRetry;
  const message=canRetry?'请重试连接申请服务。已保存的本机资料会保留。':'';
  if(configMessage.textContent!==message)text(configMessage,message);
  restore.hidden=!blocked;restore.disabled=busy;
 }
 function announce(message){text(error,message);error.hidden=false;error.focus();}
 function adopt(snapshot){
  revision=snapshot.revision;
  if(snapshot.record?.kind==='pending_submission'){
   const pending=snapshot.record.value;apply(JSON.parse(pending.payloadJson).fields);
   if(!client.pending)client.restorePending(pending);
   text(status,'上次纪念卡申请结果待核对，请点击下方按钮核对原申请。');
  }else if(snapshot.record?.kind==='editing'){apply(snapshot.record.value);text(status,'已恢复本机纪念卡申请，请核对后提交。');}
  else text(status,'输入会暂存于本机，成功提交后清除。');
  blocked=false;loaded=true;savedEditing=editing;lock();
 }
 function save(){
  const version=editing,value=applicationDraftFromFields(fields());
  writing=writing.catch(()=>{}).then(async()=>{
   if(blocked||client.pending||done)return;
   try{const snapshot=await draft.save(value);revision=snapshot.revision;savedEditing=version;if(editing===version)text(status,'纪念卡申请已暂存于本机。');}
   catch{blocked=true;text(status,'本机申请有变化或暂存失败，当前输入仍保留；请先恢复核对。');lock();throw new Error('DRAFT_UNAVAILABLE');}
  });return writing;
 }
 function queue(){if(busy||done||client.pending)return;editing++;clearTimeout(timer);if(loaded&&!blocked)timer=setTimeout(()=>{timer=null;void save().catch(()=>{});},400);}
 jammer.addEventListener('change',()=>{role.value=cardJammerOption(role.value).toggleValue;syncJammer();queue();});
 form.addEventListener('input',event=>{
  if(event.target===role)syncJammer();
  if(!event.isComposing&&event.target!==jammer&&event.target.name!=='wallet.consentAccepted')queue();
 });
 form.addEventListener('compositionend',queue);
 restore.addEventListener('click',()=>{if(busy)return;clearTimeout(timer);void writing.catch(()=>{}).then(()=>draft.read()).then(adopt).catch(()=>announce('本机申请暂不可读取，请保留当前输入后重试。'));});
 const initialization=(async()=>{
  try{
   draft=createApplicationDraft({store:createBrowserDraftStore({indexedDB:globalThis.indexedDB}),eventId:eventConfig.id,intake:WALLET_APPLICATION_INTAKE});adopt(await draft.read());
   draft.subscribe(()=>{if(busy||done)return;void writing.catch(()=>{}).then(()=>draft.read()).then(snapshot=>{if(snapshot.revision!==revision){blocked=true;text(status,'另一页签已更新纪念卡申请，请先恢复核对。');lock();}}).catch(()=>{blocked=true;lock();});});
  }catch{blocked=true;loaded=false;text(status,'本机暂存不可用，请更换浏览器后申请。');lock();}
 })();
 async function configure(retrying=false){
  configState='loading';
  lock();
  let value;
  try{value=await client.configure();}catch{value=null;}
  await initialization;
  if(value?.enabled===true&&value.eventId===eventConfig.id){
   config=value;
   configState='open';
   document.dispatchEvent(new CustomEvent('artdico:registration-policy',{detail:{privacy:value.privacy}}));
  }else{
   config=null;
   configState=value?.reason==='closed'&&(!value.eventId||value.eventId===eventConfig.id)?'closed':'unavailable';
  }
  lock();
  if(retrying){
   if(config&&loaded&&!client.pending)control('huodongxingReference').focus();
   else if(!retry.hidden)retry.focus();
  }
 }
 retry.addEventListener('click',()=>{if(configState==='unavailable')void configure(true);});
 void configure();
 form.addEventListener('submit',async event=>{
  event.preventDefault();if(busy||done||blocked||!loaded||!client.pending&&!config)return;
  if(!client.pending&&!form.reportValidity())return;
  let value;
  if(!client.pending){const checked=validateWalletApplicationFields(fields());if(!checked.valid){announce(checked.errors.preferences??'请核对活动行报名资料、姓名、邮箱与微信号。');return;}value=checked.value;}
  clearTimeout(timer);timer=null;busy=true;error.hidden=true;lock();
  try{
   await writing.catch(()=>{});if(blocked)throw new Error('请先恢复核对本机申请。');
   if(!client.pending){await save();if(blocked)throw new Error('请先恢复核对本机申请。');}
   const result=client.pending?await client.resume():await client.submit(value);
   done=true;savedEditing=editing;
   const output=section.querySelector('[data-wallet-result]');output.replaceChildren();
   for(const[tag,copy]of [['h3','纪念卡申请已收到'],['p','工作人员将核对活动行报名并确认卡面身份，领取链接将发送至你的邮箱。'],['p','申请编号：']]){const node=document.createElement(tag);node.textContent=copy;if(tag==='p'&&copy==='申请编号：'){const code=document.createElement('code');code.textContent=result.body.reference_code;node.append(code);}output.append(node);}
   output.hidden=false;form.hidden=true;output.focus();
  }catch(cause){
   if(client.pending)text(status,'上次纪念卡申请结果待核对，请点击下方按钮核对原申请。');
   else control('consentAccepted').checked=false;
   announce(cause.message||'申请结果尚待核对，请保留当前页面。');
  }finally{busy=false;lock();}
 });
 window.addEventListener('pagehide',()=>{clearTimeout(timer);if(loaded&&!busy&&!done&&!blocked&&!client.pending&&editing>savedEditing)void save().catch(()=>{});});
 window.addEventListener('beforeunload',event=>{if(!done&&(client.pending||editing>savedEditing)){event.preventDefault();event.returnValue='';}});
}
