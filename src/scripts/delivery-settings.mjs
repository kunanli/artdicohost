import {createDeliveryMutations,deliverySettingsView} from '../lib/delivery-settings.mjs';
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
export function createDeliverySettings({root,request}){
  const $=selector=>root.querySelector(selector);let user=null,state=null,busy=false,externalBusy=false,generation=0,accountKey='',settingsDirty=false,readSequence=0;
  const mutations=createDeliveryMutations({request,revision:()=>state?.revision}),allowed=()=>user?.roles.includes('superadmin');
  function status(message,error=false){$('[data-delivery-status]').textContent=error?'':message;$('[data-delivery-error]').textContent=error?message:'';$('[data-delivery-error]').hidden=!error;}
  function lock(){
    for(const field of root.querySelectorAll('button,input,textarea'))field.disabled=busy||externalBusy||!allowed()||mutations.pending;
    $('[data-delivery-refresh]').disabled=busy||externalBusy||!allowed();$('[data-delivery-retry]').disabled=busy||externalBusy||!allowed()||!mutations.pending;$('[data-delivery-pending]').hidden=!mutations.pending;
    for(const field of root.querySelectorAll('[data-delivery-automatic] button,[data-delivery-automatic] input,[data-delivery-dispatch] button,[data-delivery-dispatch] textarea,[data-delivery-dispatch] input'))field.disabled||=!state;
  }
  function render(){
    if(!state)return;$('[data-delivery-state]').hidden=false;
    $('[data-delivery-mail-ready]').textContent=state.email.ready?(state.automaticEnabled?'设置可用，自动确认邮件已开启。':'寄件设置可用，自动确认邮件尚未开启。'):'寄件设置尚未完成；报名确认页仍可正常保存与打印。';
    const missing=$('[data-delivery-mail-missing]');missing.replaceChildren();for(const key of state.email.missing)missing.append(element('li','待配置：'+key));
    $('[data-delivery-wallet-ready]').textContent=walletMessages[state.wallet.reason];
    const walletMissing=$('[data-delivery-wallet-missing]');walletMissing.replaceChildren();walletMissing.hidden=!state.wallet.missing.length;
    for(const key of state.wallet.missing)walletMissing.append(element('li','待配置：'+(walletFields[key]?walletFields[key]+'（'+key+'）':'其他签章设置')));
    const expiry=$('[data-delivery-wallet-expiry]');expiry.hidden=!state.wallet.certificateExpiresAt;
    expiry.textContent=state.wallet.certificateExpiresAt?'签章证书到期：'+new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Shanghai',dateStyle:'medium',timeStyle:'short'}).format(new Date(state.wallet.certificateExpiresAt))+'（UTC+8）':'';
    $('[data-delivery-wallet-device]').hidden=!state.wallet.deviceTestRequired;
    if(!settingsDirty)$('[data-delivery-automatic] [name=enabled]').checked=state.automaticEnabled;
    const counts=$('[data-delivery-counts]');counts.replaceChildren();for(const[key,label]of[['total','已记录通知'],['providerAccepted','服务商已接受'],['rejected','明确未发出'],['unknown','结果不明']]){const item=element('div');item.append(element('dt',label),element('dd',String(state.counts[key])));counts.append(item);}lock();
  }
  async function load(expectedGeneration=generation){
    const sequence=++readSequence,value=deliverySettingsView(await request('/api/admin/registration-confirmation/settings'));
    if(expectedGeneration!==generation||sequence!==readSequence||!allowed())return false;
    if(!value)throw new Error('设置状态未通过核对，请稍后重新读取。');state=value;render();return true;
  }
  async function action(callback){
    if(busy||externalBusy||!allowed())return;const started=generation;busy=true;lock();
    try{await callback(started);}catch(error){if(started===generation)status(error.message||'结果尚未确认，请保留本页并再次确认。',true);}
    finally{if(started===generation){busy=false;lock();}}
  }
  async function accept(result,started){
    if(started!==generation||!allowed())return;
    if(result.kind==='settings'){settingsDirty=false;state=result.value;render();status('自动确认邮件设置已保存。不会自动向历史意向名单群发。');}
    else{
      const labels={provider_accepted:'服务商已接受',rejected:'明确未发出',unknown:'结果不明，不重发',disabled:'自动邮件未开启',not_configured:'设置未完成',not_applicable:'未提供邮箱',not_public:'工作人员代登记，不在公开报名补发范围',withdrawn:'报名已取消',unavailable:'暂时无法核对',not_attempted:'尚未处理'};
      const output=$('[data-delivery-results]');output.replaceChildren();for(const row of result.value.results)output.append(element('p',row.registrationId+' · '+labels[row.status]));
      status('已核对本次所选结果；服务商接受不等于本人收到。');await load(started);
    }
  }
  $('[data-delivery-refresh]').addEventListener('click',()=>action(async started=>{if(await load(started))status(mutations.pending?'已读取最新状态；请继续确认原操作，刷新不会重新发送。':'已读取最新设置。');}));
  $('[data-delivery-retry]').addEventListener('click',()=>action(async started=>accept(await mutations.retry(),started)));
  $('[data-delivery-automatic]').addEventListener('input',()=>{settingsDirty=true;});
  $('[data-delivery-automatic]').addEventListener('submit',event=>{event.preventDefault();if(mutations.pending)return;const enabled=event.currentTarget.elements.namedItem('enabled').checked;
    if(enabled&&!state?.email.ready){status('请先完成寄件设置，待状态可用后再开启自动确认信。',true);return;}action(async started=>accept(await mutations.run('settings',{enabled}),started));
  });
  $('[data-delivery-dispatch]').addEventListener('submit',event=>{
    event.preventDefault();if(mutations.pending||!event.currentTarget.reportValidity())return;
    const form=event.currentTarget,ids=[...new Set(form.elements.namedItem('registrationIds').value.split(/[\s,;，；]+/u).filter(Boolean))];
    if(!ids.length||ids.length>100||ids.some(id=>!/^[A-Za-z0-9_-]{43}$/u.test(id))){status('请填写最多 100 个完整登记编号。',true);return;}
    if(!state?.email.ready){status('请先完成寄件设置。',true);return;}
    if(!confirm('确认向所选 '+ids.length+' 份公开报名准备确认邮件？已接受或结果不明的发送不会重复执行。'))return;
    action(async started=>accept(await mutations.run('dispatch',{registrationIds:ids,retryRejected:form.elements.namedItem('retryRejected').checked}),started));
  });
  function clear(){
    generation++;readSequence++;user=null;state=null;busy=false;accountKey='';settingsDirty=false;mutations.clear();root.hidden=true;
    for(const form of root.querySelectorAll('form'))form.reset();for(const selector of ['[data-delivery-mail-missing]','[data-delivery-wallet-missing]','[data-delivery-counts]','[data-delivery-results]'])$(selector).replaceChildren();
    for(const selector of ['[data-delivery-mail-ready]','[data-delivery-wallet-ready]','[data-delivery-wallet-expiry]'])$(selector).textContent='';
    for(const selector of ['[data-delivery-wallet-missing]','[data-delivery-wallet-expiry]','[data-delivery-wallet-device]'])$(selector).hidden=true;
    $('[data-delivery-state]').hidden=true;status('');lock();
  }
  clear();
  return Object.freeze({
    get pending(){return mutations.pending;},clear,lock(value){externalBusy=value;lock();},
    async configure(account){
      const next=account?.id+'|'+[...(account?.roles??[])].sort().join(',');if(next!==accountKey)clear();user=account;accountKey=next;root.hidden=!allowed();if(!allowed()){clear();return;}
      const started=generation;try{await load(started);}catch(error){if(started===generation)status(error.message||'设置暂时无法读取，请稍后重试。',true);}if(started===generation)lock();
    },
  });
}
