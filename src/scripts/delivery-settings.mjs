import {createDeliveryMutations,deliverySettingsView,deliveryReminderPreviewView,deliveryReminderRequestView,createReminderMutations,
  deliveryConfirmationPreviewView,deliveryConfirmationDraftPolicy,deliveryLegacyDispatchView,createConfirmationMutations} from '../lib/delivery-settings.mjs';
import {canManageEventOperations} from '../../shared/staff-permissions.mjs';
import {createSettingsFormDraft} from '../lib/settings-form-draft.mjs';
import '../styles/delivery-settings.css';
function element(tag,text){const node=document.createElement(tag);if(text!==undefined)node.textContent=text;return node;}
const walletMessages={WALLET_NOT_CONFIGURED:'尚未开放；请先完成 Apple Developer 与签章设置。',WALLET_DISABLED:'签章设置已完成，票券尚未开启。',
  CONFIGURED_SIGNER_DEVICE_TEST_REQUIRED:'票券签章设置可用。',WALLET_CERTIFICATE_EXPIRED:'签章证书已到期，请完成轮替后再开放票券。',
  WALLET_BUNDLE_UNAVAILABLE:'暂时无法读取签章设置包，请核对受控配置。',WALLET_CERTIFICATE_INVALID:'签章证书无效，请核对受控配置。',
  WALLET_CERTIFICATE_CHAIN_INVALID:'签章证书链无效，请核对 Apple WWDR 与根证书。',WALLET_CERTIFICATE_ID_MISMATCH:'签章证书与团队或 Pass Type ID 不一致。',
  WALLET_CERTIFICATE_TYPE_INVALID:'签章证书类型不适用于 Apple Wallet。',WALLET_IDENTITY_INVALID:'签章身份设置无效，请核对团队与票券标识。',
  WALLET_PRIVATE_KEY_INVALID:'签章私钥无效或与证书不匹配，请核对受控配置。',WALLET_UNAVAILABLE:'暂时无法核对票券签章状态，请重新读取设置。'};
const walletFields={APPLE_WALLET_TEAM_ID:'Apple 团队 ID',APPLE_WALLET_PASS_TYPE_ID:'Pass Type ID',APPLE_WALLET_ORGANIZATION_NAME:'主办单位名称',
  APPLE_WALLET_CERT_BASE64:'签章证书',APPLE_WALLET_KEY_BASE64:'签章私钥',APPLE_WALLET_WWDR_CERT_BASE64:'Apple WWDR 证书',APPLE_WALLET_ROOT_CERT_BASE64:'Apple 根证书'};
export function createDeliverySettings({root,request,draftStore,eventId}){
  const $=selector=>root.querySelector(selector);let user=null,state=null,busy=false,externalBusy=false,generation=0,accountKey='',settingsDirty=false,readSequence=0,savePhase='loaded';
  let reminderPreview=null,reminderSequence=0,reminderDirty=false;const selectedReminderIds=new Set(),reminderIdentities=new Map();
  let formalPreview=null,formalSequence=0,formalDirty=false;const selectedFormalIds=new Set(),formalIdentities=new Map();
  const drafts=new Map(),persistedPending=new Set(),allowed=()=>canManageEventOperations(user);
  const formalRoleKey=()=>'settings:roles='+[...(user?.roles??[])].sort().join(',');
  const mutations=createDeliveryMutations({request:async(path,options)=>{
    const started=generation,kind=path.endsWith('/dispatch')?'dispatch':'settings',draft=drafts.get(kind);
    if(kind!=='settings')throw new Error('旧确认信只能核对原操作，不会重寄。');
    if(draft){const value={...JSON.parse(options.body),action:kind};if(draft.pending){if(JSON.stringify(draft.value)!==JSON.stringify(value))throw new Error('上次设置操作仍待核对，不能另建新操作。');}else await draft.markPending(value);}
    if(started!==generation||!allowed())throw new Error('会话已改变，未提交原操作。');return request(path,options);
  },revision:()=>state?.revision});
  const reminders=createReminderMutations({revision:()=>reminderPreview?.revision,request:async(path,options)=>{
    const started=generation,draft=drafts.get('reminder');
    if(options.method==='POST'){
      if(!draft)throw new Error('本机恢复记录尚未就绪，请重新读取设置。');
      if(draft.pending){if(draft.value?.body!==options.body)throw new Error('原提醒尚待核对，不能另建寄送。');}else await draft.markPending({body:options.body});
    }
    if(started!==generation||!allowed())throw new Error('会话已改变，未提交原提醒。');return request(path,options);
  }});
  const confirmations=createConfirmationMutations({revision:()=>formalPreview?.revision,request:async(path,options)=>{
    const started=generation,draft=drafts.get('formal');
    if(options.method==='POST'){
      if(!draft)throw new Error('本机恢复记录尚未就绪，未寄送确认信。');
      if(draft.pending){if(draft.value?.body!==options.body||draft.value.roleKey!==formalRoleKey())throw new Error('原确认信尚待核对，不能另建寄送。');}
      else await draft.markPending({body:options.body,roleKey:formalRoleKey()});
    }
    if(started!==generation||!allowed())throw new Error('会话已改变，未提交原确认信。');
    return request(path,options);
  }});
  const legacyDispatch=createConfirmationMutations({revision:()=>state?.revision,request:(path,options)=>{
    if(options.method!=='GET')throw new Error('旧确认信只能核对原操作。');
    return request(path,options);
  }});
  const pendingAny=()=>mutations.pending||reminders.pending||confirmations.pending||legacyDispatch.pending||persistedPending.size>0;
  function saveState(value,message){savePhase=value;const output=$('[data-delivery-save-state]');if(output){output.dataset.saveState=value;output.textContent=message??({loaded:'尚未修改',unsaved:'未保存',saving:'保存中…',saved:'已保存',unknown:'保存结果待核对',error:'未保存 · 请核对后重试'})[value]??'';}const button=$('[data-delivery-save-button]');if(button)button.textContent=value==='saving'?'保存中…':'保存';}
  function status(message,error=false){$('[data-delivery-status]').textContent=error?'':message;$('[data-delivery-error]').textContent=error?message:'';$('[data-delivery-error]').hidden=!error;}
  function lock(){
    for(const field of root.querySelectorAll('button,input,textarea'))field.disabled=busy||externalBusy||!allowed()||pendingAny();
    if(!busy&&(mutations.pending||persistedPending.has('settings')))saveState('unknown');
    const saveButton=$('[data-delivery-save-button]');if(saveButton)saveButton.disabled||=savePhase==='saved';
    $('[data-delivery-refresh]').disabled=busy||externalBusy||!allowed();$('[data-delivery-retry]').disabled=busy||externalBusy||!allowed()||!mutations.pending;$('[data-delivery-pending]').hidden=!mutations.pending;
    for(const field of root.querySelectorAll('[data-delivery-automatic] button,[data-delivery-automatic] input,[data-delivery-dispatch] button,[data-delivery-dispatch] textarea,[data-delivery-dispatch] input'))field.disabled||=!state;
    for(const[kind,selector]of[['settings','[data-delivery-automatic]'],['dispatch','[data-delivery-dispatch]']])for(const field of $(selector).querySelectorAll('input,button,textarea'))field.disabled||=persistedPending.size>0||drafts.get(kind)?.blocked;
    $('[data-reminder-refresh]').disabled=busy||externalBusy||!allowed()||!state||pendingAny();
    $('[data-reminder-lookup]').disabled=busy||externalBusy||!allowed()||!reminders.pending;
    $('[data-reminder-pending]').hidden=!reminders.pending;
    const reminderLocked=busy||externalBusy||!allowed()||!state||!reminderPreview||pendingAny()||drafts.get('reminder')?.blocked;
    for(const field of $('[data-reminder-form]').querySelectorAll('button,input'))if(!field.hasAttribute('data-reminder-lookup'))field.disabled=Boolean(reminderLocked);
    const retry=$('[data-reminder-retry-rejected]').checked;
    for(const field of root.querySelectorAll('[data-reminder-registration]')){const row=reminderPreview?.rows.find(row=>row.registrationId===field.value);field.disabled||=!row?.eligible||row.retryRejected&&!retry;}
    $('[data-reminder-select-all]').disabled||=!reminderPreview?.rows.some(row=>row.eligible&&(!row.retryRejected||retry));
    $('[data-reminder-next]').disabled||=!reminderPreview?.nextCursor;
    $('[data-reminder-send]').disabled||=selectedReminderIds.size===0;
    for(const field of root.querySelectorAll('[data-settings-local-draft="delivery-reminder"] button'))field.disabled=busy||externalBusy||!allowed()||['saving','conflict'].includes(drafts.get('reminder')?.state);
    const formalLocked=busy||externalBusy||!allowed()||!state||!formalPreview||pendingAny()||drafts.get('formal')?.blocked||drafts.get('dispatch')?.blocked;
    for(const field of $('[data-delivery-dispatch]').querySelectorAll('button,input'))field.disabled=Boolean(formalLocked);
    const formalRetry=$('[data-formal-retry-rejected]').checked;
    for(const field of root.querySelectorAll('[data-formal-registration]')){const row=formalPreview?.rows.find(row=>row.registrationId===field.value);field.disabled||=!row?.eligible||row.retryRejected&&!formalRetry;}
    $('[data-formal-refresh]').disabled=busy||externalBusy||!allowed()||!state||pendingAny()||drafts.get('dispatch')?.blocked;
    $('[data-formal-select-all]').disabled||=!formalPreview?.rows.some(row=>row.eligible&&(!row.retryRejected||formalRetry));
    $('[data-formal-next]').disabled||=!formalPreview?.nextCursor;
    $('[data-formal-send]').disabled||=!selectedFormalIds.size;
    $('[data-formal-pending]').hidden=!confirmations.pending;
    $('[data-formal-lookup]').disabled=busy||externalBusy||!allowed()||!confirmations.pending;
    $('[data-formal-legacy-recovery]').hidden=!legacyDispatch.pending;
    $('[data-formal-legacy-lookup]').disabled=busy||externalBusy||!allowed()||!legacyDispatch.pending;
    for(const slot of['formal','dispatch'])for(const field of root.querySelectorAll('[data-settings-local-draft="delivery-'+slot+'"] button'))field.disabled=busy||externalBusy||!allowed()||['saving','conflict'].includes(drafts.get(slot)?.state);
  }
  function render(){
    if(!state)return;$('[data-delivery-state]').hidden=false;
    $('[data-delivery-mail-ready]').textContent=state.email.ready?(state.automaticEnabled?'设置可用，报名通知已开启。':'寄件设置可用，报名通知已暂停。'):'寄件设置尚未完成；私人参会页仍可查询与保存。';
    const missing=$('[data-delivery-mail-missing]');missing.replaceChildren();for(const key of state.email.missing)missing.append(element('li','待配置：'+key));
    $('[data-delivery-wallet-ready]').textContent=walletMessages[state.wallet.reason];
    const walletMissing=$('[data-delivery-wallet-missing]');walletMissing.replaceChildren();walletMissing.hidden=!state.wallet.missing.length;
    for(const key of state.wallet.missing)walletMissing.append(element('li','待配置：'+(walletFields[key]?walletFields[key]+'（'+key+'）':'其他签章设置')));
    const expiry=$('[data-delivery-wallet-expiry]');expiry.hidden=!state.wallet.certificateExpiresAt;
    root.dispatchEvent(new CustomEvent('delivery-settings-state',{detail:{email:{ready:state.email.ready,automaticEnabled:state.automaticEnabled},wallet:{ready:state.wallet.ready,reason:state.wallet.reason,deviceTestRequired:state.wallet.deviceTestRequired,certificateExpiresAt:state.wallet.certificateExpiresAt}}}));
    expiry.textContent=state.wallet.certificateExpiresAt?'签章证书到期：'+new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Shanghai',dateStyle:'medium',timeStyle:'short'}).format(new Date(state.wallet.certificateExpiresAt))+'（UTC+8）':'';
    $('[data-delivery-wallet-device]').hidden=!state.wallet.deviceTestRequired;
    if(!settingsDirty)$('[data-delivery-automatic] [name=enabled]').checked=state.automaticEnabled;
    const counts=$('[data-delivery-counts]');counts.replaceChildren();appendCounts(counts,state.counts);
    const other=$('[data-delivery-notification-counts]');other.replaceChildren();for(const[key,label]of[['applicationReceived','申请回执'],['preEventReminder','行前提醒']])if(state.notificationCounts?.[key]){const list=element('dl');list.className='delivery-counts';appendCounts(list,state.notificationCounts[key]);other.append(element('h3',label),list);}lock();
  }
  function appendCounts(output,counts){for(const[key,label]of[['total','历史通知数'],['providerAccepted','邮件服务已接收'],['rejected','明确未发出'],['unknown','结果不明']]){const item=element('div');item.append(element('dt',label),element('dd',String(counts[key])));output.append(item);}}
  const reminderReasonLabels={ELIGIBLE:'可发送',EMAIL_MISSING:'缺少邮箱',ALREADY_ACCEPTED:'邮件服务已接收',DELIVERY_UNKNOWN:'结果待核对，不重寄',HISTORICAL_DELIVERY_UNKNOWN:'原邮箱寄送待核对',EMAIL_PAUSED:'通知已暂停',EMAIL_NOT_READY:'寄件设置未就绪',RETRY_LIMIT:'已达尝试上限',ADMISSION_NOT_CONFIRMED:'当前名额未确认',CONTACT_DECLINED:'已回复不参加',CONTACT_CONSENT_REQUIRED:'联系许可待核对',CONTACT_EMAIL_CHANGED:'邮箱有更新，请核对',CONTACT_NOT_FOUND:'未找到联系来源',STAFF_PERMISSION_REQUIRED:'联系许可待核对',PERMISSION_UNAVAILABLE:'联系许可待核对',EVENT_FACTS_MISMATCH:'活动信息待核对',EVENT_FACTS_UNAVAILABLE:'活动信息暂无法核对',REMINDER_WINDOW_CLOSED:'已过提醒时间'};
  function clearFormalPreview(message='请读取确认信名单。',{clearResults=true}={}){
    formalPreview=null;selectedFormalIds.clear();formalDirty=false;formalIdentities.clear();
    for(const selector of['[data-formal-rows]','[data-formal-subject]','[data-formal-message]'])$(selector).replaceChildren();
    $('[data-formal-preview]').hidden=true;$('[data-formal-status]').textContent=message;$('[data-formal-select-all]').checked=false;
    if(clearResults){$('[data-formal-results]').replaceChildren();$('[data-formal-results]').hidden=true;}
    $('[data-formal-selection]').textContent='';$('[data-formal-send]').textContent='发送确认信（0 人）';lock();
  }
  function updateFormalSelection(){
    const retry=$('[data-formal-retry-rejected]').checked;
    for(const id of selectedFormalIds){const row=formalPreview?.rows.find(row=>row.registrationId===id);if(!row?.eligible||row.retryRejected&&!retry)selectedFormalIds.delete(id);}
    const eligible=formalPreview?.rows.filter(row=>row.eligible&&(!row.retryRejected||retry))??[];
    for(const field of root.querySelectorAll('[data-formal-registration]'))field.checked=selectedFormalIds.has(field.value);
    $('[data-formal-selection]').textContent='已选择 '+selectedFormalIds.size+' 人';$('[data-formal-send]').textContent='发送确认信（'+selectedFormalIds.size+' 人）';
    $('[data-formal-select-all]').checked=Boolean(eligible.length)&&eligible.every(row=>selectedFormalIds.has(row.registrationId));formalDirty=selectedFormalIds.size>0;lock();
  }
  function renderFormalPreview(){
    const value=formalPreview;if(!value)return;
    $('[data-formal-preview]').hidden=false;$('[data-formal-subject]').textContent=value.message.subject;$('[data-formal-message]').textContent=value.message.text;
    $('[data-formal-status]').textContent='当前已确认 '+value.total+' 人 · 本页 '+value.rows.length+' 人';$('[data-formal-empty]').hidden=value.rows.length!==0;$('[data-formal-next]').hidden=!value.nextCursor;
    const output=$('[data-formal-rows]');output.replaceChildren();
    for(const row of value.rows){
      formalIdentities.set(row.registrationId,{name:row.name,organization:row.organization});
      const item=element('li'),label=element('label'),input=element('input'),identity=element('span'),result=element('span',row.retryRejected&&row.eligible?'明确未发出 · 勾选上方重试许可':reminderReasonLabels[row.reason]);
      input.type='checkbox';input.value=row.registrationId;input.dataset.formalRegistration='';input.setAttribute('aria-label','选择确认信收件人 '+row.name);
      identity.append(element('strong',row.name),element('small',row.organization||'未填写组织'));result.className='delivery-reminder-result';label.append(input,identity);item.append(label,result);output.append(item);
      input.addEventListener('change',()=>{if(input.checked)selectedFormalIds.add(row.registrationId);else selectedFormalIds.delete(row.registrationId);updateFormalSelection();});
    }updateFormalSelection();
  }
  async function loadFormalPreview(started=generation,cursor,keepResults=false){
    const sequence=++formalSequence;clearFormalPreview('正在核对确认信名单…',{clearResults:!keepResults});
    try{
      const raw=await request('/api/admin/registration-confirmation/preview',{method:'POST',body:JSON.stringify(cursor?{cursor}:{})});
      if(started!==generation||sequence!==formalSequence||!allowed())return;
      const value=deliveryConfirmationPreviewView(raw);if(!value)throw new Error('确认信名单未通过核对，请重新读取。');formalPreview=value;renderFormalPreview();
    }catch(error){if(started===generation&&sequence===formalSequence)clearFormalPreview('名单暂无法核对 · 请重新读取');throw error;}
  }
  function clearReminderPreview(message='先读取当前提醒名单。',{clearResults=true}={}){
    reminderPreview=null;selectedReminderIds.clear();reminderDirty=false;
    for(const selector of['[data-reminder-rows]','[data-reminder-subject]','[data-reminder-message]'])$(selector).replaceChildren();
    $('[data-reminder-preview]').hidden=true;$('[data-reminder-status]').textContent=message;$('[data-reminder-select-all]').checked=false;
    if(clearResults){reminderIdentities.clear();$('[data-reminder-results]').replaceChildren();$('[data-reminder-results]').hidden=true;}
    updateReminderSelection();
  }
  function updateReminderSelection(){
    const retry=$('[data-reminder-retry-rejected]').checked,eligible=reminderPreview?.rows.filter(row=>row.eligible&&(!row.retryRejected||retry))??[];
    for(const id of selectedReminderIds)if(!eligible.some(row=>row.registrationId===id))selectedReminderIds.delete(id);
    for(const input of root.querySelectorAll('[data-reminder-registration]'))input.checked=selectedReminderIds.has(input.value);
    $('[data-reminder-select-all]').checked=eligible.length>0&&eligible.every(row=>selectedReminderIds.has(row.registrationId));
    $('[data-reminder-select-all]').indeterminate=selectedReminderIds.size>0&&selectedReminderIds.size<eligible.length;
    $('[data-reminder-selection]').textContent='已选 '+selectedReminderIds.size+' 人';$('[data-reminder-send]').textContent='发送提醒（'+selectedReminderIds.size+' 人）';lock();
  }
  function renderReminderPreview(){
    const value=reminderPreview;if(!value)return;
    $('[data-reminder-preview]').hidden=false;$('[data-reminder-subject]').textContent=value.message.subject;$('[data-reminder-message]').textContent=value.message.text;
    $('[data-reminder-status]').textContent='当前已确认 '+value.total+' 人 · 本页 '+value.rows.length+' 人';$('[data-reminder-empty]').hidden=value.rows.length!==0;$('[data-reminder-next]').hidden=!value.nextCursor;
    const output=$('[data-reminder-rows]');output.replaceChildren();for(const row of value.rows){
      reminderIdentities.set(row.registrationId,{name:row.name,organization:row.organization});const item=element('li'),label=element('label'),input=element('input'),identity=element('span'),result=element('span',row.retryRejected&&row.eligible?'明确未发出 · 勾选上方重试许可':reminderReasonLabels[row.reason]);
      input.type='checkbox';input.value=row.registrationId;input.dataset.reminderRegistration='';input.setAttribute('aria-label','选择 '+row.name);identity.append(element('strong',row.name),element('small',row.organization||'未填写组织'));result.className='delivery-reminder-result';label.append(input,identity);item.append(label,result);output.append(item);
      input.addEventListener('change',()=>{if(input.checked)selectedReminderIds.add(row.registrationId);else selectedReminderIds.delete(row.registrationId);reminderDirty=selectedReminderIds.size>0;updateReminderSelection();});
    }updateReminderSelection();
  }
  async function loadReminderPreview(started=generation,cursor,keepResults=false){
    const sequence=++reminderSequence;clearReminderPreview('正在核对提醒名单…',{clearResults:!keepResults});
    try{
      const raw=await request('/api/admin/registration-confirmation/reminder-preview',{method:'POST',body:JSON.stringify(cursor?{cursor}:{})});
      if(started!==generation||sequence!==reminderSequence||!allowed())return;
      const value=deliveryReminderPreviewView(raw);if(!value)throw new Error('提醒名单未通过核对，请重新读取。');reminderPreview=value;renderReminderPreview();
    }catch(error){if(started===generation&&sequence===reminderSequence)clearReminderPreview('名单暂无法核对 · 请重新读取');throw error;}
  }
  async function load(expectedGeneration=generation){
    const sequence=++readSequence;let value;try{value=deliverySettingsView(await request('/api/admin/registration-confirmation/settings'));}catch(error){if(expectedGeneration===generation&&sequence===readSequence){state=null;clearReminderPreview('设置暂无法核对 · 请重新读取');clearFormalPreview('设置暂无法核对 · 请重新读取');lock();}throw error;}
    if(expectedGeneration!==generation||sequence!==readSequence||!allowed())return false;
    if(!value){state=null;clearReminderPreview('设置暂无法核对 · 请重新读取');clearFormalPreview('设置暂无法核对 · 请重新读取');throw new Error('设置状态未通过核对，请稍后重新读取。');}state=value;render();return true;
  }
  async function action(callback){
    if(busy||externalBusy||!allowed())return;const started=generation;busy=true;lock();
    try{await callback(started);}catch(error){if(started===generation){
      if(confirmations.knownRejected&&drafts.get('formal')?.pending&&allowed()){
        try{
          const draft=drafts.get('formal');await draft.rejectPending();if(started!==generation||!allowed())return;
          await draft.discard();if(started!==generation||!allowed())return;
          confirmations.acknowledgeRejection();persistedPending.delete('formal');clearFormalPreview('名单已有更新 · 请重新选择');
          if(await load(started))await loadFormalPreview(started);status('本次未寄送，请重新选择后发送。');return;
        }catch(recoveryError){if(started===generation&&allowed()){
          if(confirmations.pending||drafts.get('formal')?.pending)persistedPending.add('formal');
          else{status(recoveryError.message||'名单暂时无法核对，请重新读取。',true);return;}
        }}
      }
      if(started!==generation||!allowed())return;
      if(confirmations.pending&&!confirmations.knownRejected&&drafts.get('formal')?.pending&&!drafts.get('formal').blocked){try{await drafts.get('formal').markUncertain();}catch{if(started===generation&&allowed())persistedPending.add('formal');}}
      if(started!==generation||!allowed())return;
      if(!reminders.pending&&drafts.get('reminder')?.pending&&Number.isInteger(error.status)&&error.status>=400&&error.status<500){try{await drafts.get('reminder').discard();persistedPending.delete('reminder');clearReminderPreview('名单或设置已有更新 · 请重新读取核对');}catch{persistedPending.add('reminder');}}
      if(started!==generation)return;if(!mutations.pending)for(const[kind,draft]of drafts)if(draft.pending)persistedPending.add(kind);if(mutations.pending||persistedPending.has('settings'))saveState('unknown');else if(savePhase==='saving')saveState('error');status(error.message||'结果尚未确认，请保留本页并再次确认。',true);}}
    finally{if(started===generation){busy=false;lock();}}
  }
  async function accept(result,started){
    if(started!==generation||!allowed())return;
    await drafts.get(result.kind)?.discard();if(started!==generation||!allowed())return;persistedPending.delete(result.kind);
    if(result.kind==='settings'){readSequence++;settingsDirty=false;state=result.value;saveState('saved',result.requestedEnabled===state.automaticEnabled?'已保存':'已保存 · 当前设置已由其他操作更新');clearReminderPreview('通知设置已更新 · 请重新读取提醒名单');clearFormalPreview('通知设置已更新 · 请重新读取确认信名单');render();status('报名通知设置已保存，不会补寄历史名单。');}
  }
  function restoreFormalRecovery(controller,slot){
    const draft=drafts.get(slot);if(controller.pending||!draft?.pending)return;
    if(slot==='dispatch')controller.restoreLegacy(draft.value);else controller.restore(draft.value.body);
    persistedPending.add(slot);
  }
  async function acceptFormal(result,started,controller=confirmations,slot='formal'){
    if(started!==generation||!allowed())return;
    const ids=result.results.map(row=>row.registrationId);let identitiesReady=true;
    try{
      if(!ids.every(id=>formalIdentities.has(id))){
        const raw=await request('/api/admin/registration-confirmation/preview',{method:'POST',body:JSON.stringify({registrationIds:ids})});
        if(started!==generation||!allowed())return;
        const value=deliveryConfirmationPreviewView(raw);
        if(!value||value.total>ids.length||value.nextCursor!==null||value.rows.some(row=>!ids.includes(row.registrationId)))throw new Error('当前人员信息无法核对，请核对原寄送。');
        formalIdentities.clear();for(const row of value.rows)formalIdentities.set(row.registrationId,{name:row.name,organization:row.organization});
      }
      identitiesReady=ids.every(id=>formalIdentities.has(id));
    }catch(error){
      if(started===generation){clearFormalPreview('当前人员信息无法核对 · 请核对原寄送');restoreFormalRecovery(controller,slot);}throw error;
    }
    if(started!==generation||!allowed())return;
    const labels={provider_accepted:'邮件服务已接收',rejected:'明确未发出',unknown:'结果待核对，不重寄',disabled:'通知已暂停',not_configured:'寄件设置未就绪',not_applicable:'当前对象不适用',not_public:'当前对象不适用',withdrawn:'当前名额已取消',unavailable:'暂时无法核对',not_attempted:'尚未尝试，可重新选择'};
    const output=$('[data-formal-results]');output.replaceChildren();output.hidden=false;
    for(const row of result.results){const identity=formalIdentities.get(row.registrationId),item=element('p',(identity?.name||'当前人员信息无法核对')+' · '+labels[row.status]);if(identity?.organization)item.append(element('small',' · '+identity.organization));output.append(item);}
    selectedFormalIds.clear();updateFormalSelection();
    if(!identitiesReady)restoreFormalRecovery(controller,slot);
    if(controller.pending||!identitiesReady){
      if(slot==='formal'&&drafts.get(slot)?.pending&&!drafts.get(slot).blocked){try{await drafts.get(slot).markUncertain();}catch{if(started===generation&&allowed())persistedPending.add(slot);}}
      if(started!==generation||!allowed())return;
      persistedPending.add(slot);$('[data-formal-status]').textContent=identitiesReady?'原结果待核对 · 不会重寄':'当前人员信息无法核对 · 请保留原操作';status('已显示可核对结果；邮件服务已接收不等于本人收到。');return;
    }
    try{await drafts.get(slot)?.discard({resolvedPending:true});}catch(error){if(started===generation)restoreFormalRecovery(controller,slot);throw error;}
    if(started!==generation||!allowed())return;persistedPending.delete(slot);
    await load(started);if(started!==generation||!allowed()||pendingAny())return;
    await loadFormalPreview(started,undefined,true);status('已核对逐人结果；邮件服务已接收不等于本人收到。');
  }
  async function readReminderIdentities(result,started){
    const ids=result.results.map(row=>row.registrationId);if(ids.every(id=>reminderIdentities.has(id)))return true;
    try{
      const raw=await request('/api/admin/registration-confirmation/reminder-preview',{method:'POST',body:JSON.stringify({registrationIds:ids})});
      if(started!==generation||!allowed())return false;
      const value=deliveryReminderPreviewView(raw);if(!value||value.total>ids.length||value.nextCursor!==null||value.rows.some(row=>!ids.includes(row.registrationId)))throw new Error('原收件人信息尚未通过核对，请核对原寄送。');
      for(const id of ids)reminderIdentities.delete(id);for(const row of value.rows)reminderIdentities.set(row.registrationId,{name:row.name,organization:row.organization});return true;
    }catch(error){if(started===generation)clearReminderPreview('人员信息暂无法核对 · 请核对原寄送');throw error;}
  }
  async function acceptReminder(result,started){
    if(started!==generation||!allowed())return;
    if(!await readReminderIdentities(result,started)||started!==generation||!allowed())return;
    const output=$('[data-reminder-results]'),labels={provider_accepted:'邮件服务已接收',rejected:'明确未发出',unknown:'结果待核对，不重寄',disabled:'通知已暂停',not_configured:'寄件设置未就绪',not_applicable:'未提供邮箱',not_public:'当前对象不适用',withdrawn:'当前名额已取消',unavailable:'暂时无法核对',not_attempted:'尚未尝试，可重新选择'};
    output.replaceChildren();output.hidden=false;for(const row of result.results){const identity=reminderIdentities.get(row.registrationId),item=element('p',(identity?.name||'人员信息待核对')+' · '+labels[row.status]);if(identity?.organization)item.append(element('small',' · '+identity.organization));output.append(item);}
    reminderDirty=false;selectedReminderIds.clear();updateReminderSelection();
    if(reminders.pending){persistedPending.add('reminder');$('[data-reminder-status]').textContent='结果待核对 · 请核对原寄送，不会重寄';status('已记录可核对结果；邮件服务已接收不等于本人收到。');return;}
    await drafts.get('reminder')?.discard();if(started!==generation||!allowed())return;persistedPending.delete('reminder');
    await load(started);if(started!==generation||!allowed())return;await loadReminderPreview(started,undefined,true);status('已核对逐人结果；邮件服务已接收不等于本人收到。');
  }
  async function configureDrafts(started){
    if(!draftStore||!state||!user?.id)return;
    if(!drafts.has('settings')){
      const form=$('[data-delivery-automatic]'),fields=['enabled','expectedRevision','operationId','action'];
      const draft=createSettingsFormDraft({store:draftStore,actorId:user.id,eventId,entity:'delivery-settings',form,policy:{fields,pendingFields:fields,validate:(value,{kind})=>value.action==='settings'&&Number.isSafeInteger(value.expectedRevision)&&value.expectedRevision>=0&&typeof value.operationId==='string'&&(kind!=='pending_submission'||/^[A-Za-z0-9_-]{32,128}$/u.test(value.operationId))&&typeof value.enabled==='boolean'},baseRevision:()=>state.revision,isCurrent:()=>started===generation&&allowed(),
        capture:()=>({expectedRevision:state.revision,operationId:'',action:'settings',enabled:form.elements.namedItem('enabled').checked}),
        apply:value=>{form.elements.namedItem('enabled').checked=value.enabled;settingsDirty=true;saveState('unsaved');},
        onChange:lock,onPending:()=>persistedPending.add('settings'),onDiscard:()=>{persistedPending.delete('settings');mutations.clear();form.reset();settingsDirty=false;saveState('loaded');render();}});
      drafts.set('settings',draft);try{await draft.load();}catch{persistedPending.add('settings');}if(started!==generation)return;
    }
    if(!drafts.has('dispatch')){
      const fields=['registrationIds','retryRejected','expectedRevision','operationId','action'];
      const draft=createSettingsFormDraft({store:draftStore,actorId:user.id,eventId,entity:'delivery-dispatch',form:$('[data-delivery-legacy-pending]'),allowPendingDiscard:false,policy:{fields,pendingFields:fields,
        validate:(value,{kind})=>kind==='pending_submission'?Boolean(deliveryLegacyDispatchView(value)):value.action==='dispatch'&&Number.isSafeInteger(value.expectedRevision)&&value.expectedRevision>=0&&typeof value.operationId==='string'&&Array.isArray(value.registrationIds)&&value.registrationIds.length<=100&&value.registrationIds.every(id=>typeof id==='string'&&id.length<=100)&&typeof value.retryRejected==='boolean'},
        baseRevision:()=>state.revision,isCurrent:()=>started===generation&&allowed(),capture:()=>({}),apply:()=>{},
        onChange:lock,onPending:value=>{persistedPending.add('dispatch');try{legacyDispatch.restoreLegacy(value);}catch{status('旧确认信记录无法核对，请保留原记录。',true);}},
        onDiscard:()=>{persistedPending.delete('dispatch');legacyDispatch.clear();clearFormalPreview();lock();}});
      drafts.set('dispatch',draft);try{await draft.load();}catch{persistedPending.add('dispatch');}if(started!==generation)return;
    }
    if(!drafts.has('formal')){
      const roleKey=formalRoleKey();
      const draft=createSettingsFormDraft({store:draftStore,actorId:user.id,eventId,entity:'delivery-formal',scopePage:roleKey,form:$('[data-formal-pending]'),allowPendingDiscard:false,policy:deliveryConfirmationDraftPolicy({roleKey,
        canReject:value=>confirmations.knownRejected&&value.body===confirmations.body&&value.roleKey===roleKey&&started===generation&&allowed()}),
        baseRevision:()=>state.revision,isCurrent:()=>started===generation&&allowed()&&formalRoleKey()===roleKey,capture:()=>({body:confirmations.body,roleKey}),apply:()=>{},
        onChange:lock,onPending:value=>{persistedPending.add('formal');try{confirmations.restore(value.body);}catch{status('原确认信记录无法核对，请保留原记录。',true);}},
        onDiscard:()=>{persistedPending.delete('formal');confirmations.clear();clearFormalPreview();lock();}});
      drafts.set('formal',draft);try{await draft.load();}catch{persistedPending.add('formal');}if(started!==generation)return;
    }
    if(!drafts.has('reminder')){
      // Only the explicit pending request is stored here. The recovery host is
      // outside the selection area, so names, preview text and selections never
      // become ordinary browser drafts.
      const draft=createSettingsFormDraft({store:draftStore,actorId:user.id,eventId,entity:'delivery-reminder',form:$('[data-reminder-pending]'),policy:{fields:['body'],pendingFields:['body'],jsonFields:['body'],validate:value=>Object.keys(value).length===1&&Boolean(deliveryReminderRequestView(value.body))},baseRevision:()=>state?.revision??0,isCurrent:()=>started===generation&&allowed(),capture:()=>({body:reminders.body}),apply:()=>{},
        onChange:lock,onPending:value=>{try{reminders.restore(value.body);persistedPending.add('reminder');}catch{persistedPending.add('reminder');status('本机提醒记录待核对，请保留原记录。',true);}},
        onDiscard:()=>{persistedPending.delete('reminder');reminders.clear();clearReminderPreview('已清除本机记录 · 请重新读取名单核对');lock();}});
      drafts.set('reminder',draft);try{await draft.load();}catch{}if(started!==generation)return;
    }lock();
  }
  $('[data-delivery-refresh]').addEventListener('click',()=>action(async started=>{if(await load(started)){await configureDrafts(started);if(started===generation&&allowed())status(pendingAny()?'已读取最新状态；请核对原操作，不会重新发送。':'已读取最新设置。');}}));
  $('[data-delivery-retry]').addEventListener('click',()=>action(async started=>accept(await mutations.retry(),started)));
  const markSettings=()=>{settingsDirty=true;saveState('unsaved');lock();};$('[data-delivery-automatic]').addEventListener('input',markSettings);$('[data-delivery-automatic]').addEventListener('change',markSettings);
  $('[data-delivery-automatic]').addEventListener('submit',event=>{event.preventDefault();if(mutations.pending)return;const enabled=event.currentTarget.elements.namedItem('enabled').checked;
    if(enabled&&!state?.email.ready){saveState('error');status('请先完成寄件设置，待状态可用后再开启报名通知。',true);return;}action(async started=>{saveState('saving');await accept(await mutations.run('settings',{enabled}),started);});
  });
  $('[data-formal-refresh]').addEventListener('click',()=>action(started=>loadFormalPreview(started)));
  $('[data-formal-next]').addEventListener('click',()=>{const cursor=formalPreview?.nextCursor;if(cursor)action(started=>loadFormalPreview(started,cursor));});
  $('[data-formal-retry-rejected]').addEventListener('change',updateFormalSelection);
  $('[data-formal-select-all]').addEventListener('change',event=>{
    const selected=event.currentTarget.checked,retry=$('[data-formal-retry-rejected]').checked;selectedFormalIds.clear();
    if(selected)for(const row of formalPreview?.rows??[])if(row.eligible&&(!row.retryRejected||retry))selectedFormalIds.add(row.registrationId);updateFormalSelection();
  });
  $('[data-delivery-dispatch]').addEventListener('submit',event=>{
    event.preventDefault();if(!formalPreview||pendingAny()||!selectedFormalIds.size||drafts.get('formal')?.blocked||drafts.get('dispatch')?.blocked)return;
    const retryRejected=$('[data-formal-retry-rejected]').checked,ids=formalPreview.rows.filter(row=>selectedFormalIds.has(row.registrationId)&&row.eligible&&(!row.retryRejected||retryRejected)).map(row=>row.registrationId);
    if(ids.length!==selectedFormalIds.size){clearFormalPreview('名单有更新 · 请重新读取核对');return;}
    const expectedAccessRevisions=Object.fromEntries(ids.map(id=>[id,formalPreview.rows.find(row=>row.registrationId===id).accessRevision??0]));
    action(async started=>acceptFormal(await confirmations.run({registrationIds:ids,retryRejected,expectedAccessRevisions}),started));
  });
  $('[data-formal-lookup]').addEventListener('click',()=>action(async started=>{
    try{await acceptFormal(await confirmations.lookup(),started);}catch(error){if(started===generation&&allowed())restoreFormalRecovery(confirmations,'formal');throw error;}
  }));
  $('[data-formal-legacy-lookup]').addEventListener('click',()=>action(async started=>{
    try{await acceptFormal(await legacyDispatch.lookup(),started,legacyDispatch,'dispatch');}catch(error){if(started===generation&&allowed())restoreFormalRecovery(legacyDispatch,'dispatch');throw error;}
  }));
  $('[data-reminder-refresh]').addEventListener('click',()=>action(started=>loadReminderPreview(started)));
  $('[data-reminder-next]').addEventListener('click',()=>{const cursor=reminderPreview?.nextCursor;if(cursor)action(started=>loadReminderPreview(started,cursor));});
  $('[data-reminder-retry-rejected]').addEventListener('change',()=>updateReminderSelection());
  $('[data-reminder-select-all]').addEventListener('change',event=>{const selected=event.currentTarget.checked,retry=$('[data-reminder-retry-rejected]').checked;selectedReminderIds.clear();if(selected)for(const row of reminderPreview?.rows??[])if(row.eligible&&(!row.retryRejected||retry))selectedReminderIds.add(row.registrationId);reminderDirty=selectedReminderIds.size>0;updateReminderSelection();});
  $('[data-reminder-form]').addEventListener('submit',event=>{
    event.preventDefault();if(!reminderPreview||pendingAny()||!selectedReminderIds.size)return;
    const retryRejected=$('[data-reminder-retry-rejected]').checked,ids=reminderPreview.rows.filter(row=>selectedReminderIds.has(row.registrationId)&&row.eligible&&(!row.retryRejected||retryRejected)).map(row=>row.registrationId);
    if(ids.length!==selectedReminderIds.size){clearReminderPreview('名单有更新 · 请重新读取核对');return;}
    const expectedAccessRevisions=Object.fromEntries(ids.map(id=>[id,reminderPreview.rows.find(row=>row.registrationId===id).accessRevision??0]));
    action(async started=>acceptReminder(await reminders.run({registrationIds:ids,retryRejected,expectedAccessRevisions}),started));
  });
  $('[data-reminder-lookup]').addEventListener('click',()=>action(async started=>{const body=reminders.body;try{await acceptReminder(await reminders.lookup(),started);}catch(error){if(started===generation&&allowed()&&body&&!reminders.pending&&drafts.get('reminder')?.pending){reminders.restore(body);persistedPending.add('reminder');}throw error;}}));
  function clear(){
    for(const draft of drafts.values())draft.close();drafts.clear();persistedPending.clear();
    generation++;readSequence++;reminderSequence++;formalSequence++;user=null;state=null;busy=false;accountKey='';settingsDirty=false;mutations.clear();reminders.clear();confirmations.clear();legacyDispatch.clear();root.hidden=true;
    for(const form of root.querySelectorAll('form'))form.reset();for(const selector of ['[data-delivery-mail-missing]','[data-delivery-wallet-missing]','[data-delivery-counts]','[data-delivery-notification-counts]'])$(selector).replaceChildren();clearReminderPreview('先核对当前已确认名额，再选择收件人。');clearFormalPreview('选择需要寄送确认信的人员；已接收或结果待核对者不会重复寄送。');
    for(const selector of ['[data-delivery-mail-ready]','[data-delivery-wallet-ready]','[data-delivery-wallet-expiry]'])$(selector).textContent='';
    for(const selector of ['[data-delivery-wallet-missing]','[data-delivery-wallet-expiry]','[data-delivery-wallet-device]'])$(selector).hidden=true;
    $('[data-delivery-state]').hidden=true;saveState('loaded');status('');lock();
  }
  clear();
  return Object.freeze({
    get pending(){return pendingAny()||busy;},get dirty(){return settingsDirty||formalDirty||reminderDirty;},clear,lock(value){externalBusy=value;lock();},
    async configure(account){
      const next=account?.id+'|'+[...(account?.roles??[])].sort().join(',');if(next!==accountKey)clear();user=account;accountKey=next;root.hidden=!allowed();if(!allowed()){clear();return;}
      const started=generation;try{await load(started);await configureDrafts(started);}catch(error){if(started===generation)status(error.message||'设置暂时无法读取，请稍后重试。',true);}if(started===generation)lock();
    },
  });
}
