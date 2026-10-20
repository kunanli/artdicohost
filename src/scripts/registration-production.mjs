import { createRegistrationClient } from '../lib/registration-client.mjs';
import { registrationFields } from '../lib/registration-fields.mjs';
import { renderRegistrationSuccess } from './registration-success.mjs';

function node(tag,text) { const result = document.createElement(tag); result.textContent = text; return result; }

let currentPublicPrivacy=null;
let currentAvailability=null;
function renderPublicPrivacy(){
  const output=document.querySelector('[data-public-privacy]');
  if(output&&currentPublicPrivacy){output.replaceChildren();const labels={processor:'处理者',contactEmail:'联络邮箱',purpose:'用途',storageRegion:'存储地区',retention:'保留期限',rightsRequest:'查阅、更正、撤回及删除',sharing:'分享范围',version:'告知版本'};for(const[key,label]of Object.entries(labels))output.append(node('p',label+'：'+currentPublicPrivacy[key]));}
  for(const faq of document.querySelectorAll('[data-public-faq] details')){
    const question=faq.querySelector('summary')?.textContent??'',answer=faq.querySelector('p');if(!answer)continue;
    if(question.startsWith('现在可以报名吗？')&&currentAvailability)answer.textContent=currentAvailability.message;
    if(question.startsWith('如何修改或撤回资料？')&&currentPublicPrivacy&&answer.textContent.includes('预览表单不保存'))answer.textContent=currentPublicPrivacy.rightsRequest;
  }
}
document.addEventListener('artdico:registration-ready',event=>{currentPublicPrivacy=event.detail?.privacy??null;currentAvailability={message:'可以，通过本页正式表单提交。实际保存成功后将显示报名编号；住宿、讲者与展位另行确认。'};renderPublicPrivacy();});
document.addEventListener('artdico:registration-policy',event=>{currentPublicPrivacy=event.detail?.privacy??null;renderPublicPrivacy();});
document.addEventListener('artdico:registration-unavailable',event=>{currentAvailability=event.detail;renderPublicPrivacy();});
document.addEventListener('artdico:public-content-updated',renderPublicPrivacy);

for (const section of document.querySelectorAll('[data-registration-api-origin]')) {
  const form = section.querySelector('[data-registration-form]');
  if (!(form instanceof HTMLFormElement)) continue;
  const client = createRegistrationClient({apiOrigin:section.dataset.registrationApiOrigin,pageOrigin:location.origin});
  const submit = form.querySelector('[data-submit]');
  const summary = form.querySelector('[data-form-error]');
  const receipt = section.querySelector('[data-registration-success]');
  const trackedControls = () => [...form.querySelectorAll('input,select,textarea,[data-next-step],[data-prev-step]')];
  let frozen = false;
  let config = null;
  function unavailable(reason) {
    const closed=reason==='closed';
    form.dataset.registrationMode=closed?'closed':'unavailable';
    submit.disabled=true;
    submit.textContent=closed?'正式报名已关闭':'正式报名暂不可用';
    const message=closed?'本站正式报名已关闭，不再受理新报名。已保存的报名仍然有效。':'本站正式报名暂时无法确认，请稍后再试。当前不会提交或保存资料。';
    section.querySelector('[data-registration-notice]').textContent=message;
    section.querySelector('[data-registration-mode-label]').textContent=closed?'报名已关闭':'服务暂不可用';
    section.querySelector('[data-registration-open-label]').textContent='查看报名字段';
    section.querySelector('[data-registration-disclaimer]').textContent=message;
    section.querySelector('[data-registration-data-hint]').textContent='当前不受理提交，请勿填写真实资料。';
    for(const control of trackedControls())control.disabled=true;
    for(const status of document.querySelectorAll('[data-registration-availability]'))status.textContent=closed?'报名已关闭':'报名状态暂不可用';
    for(const faq of document.querySelectorAll('[data-public-faq] details'))if(faq.querySelector('summary')?.textContent.startsWith('现在可以报名吗？')){const answer=faq.querySelector('p');if(answer)answer.textContent=message;}
    document.dispatchEvent(new CustomEvent('artdico:registration-unavailable',{detail:{message}}));
  }
  function announce(message) { summary.textContent = message; summary.hidden = false; summary.focus(); }
  function lock(value) {
    form.dataset.submitting = String(value);
    submit.disabled = value;
    for (const control of trackedControls()) {
      if (value || frozen) { if (!control.disabled) { control.dataset.registrationLocked = 'true'; control.disabled = true; } }
      else if (control.dataset.registrationLocked) { control.disabled = false; delete control.dataset.registrationLocked; }
    }
    submit.textContent = value ? '正在确认保存结果…' : frozen ? '再次确认报名结果' : '确认并提交报名';
  }
  form.addEventListener('artdico:registration-submit', async event => {
    if (!config || form.dataset.submitting === 'true' || event.detail?.fields?.consentAccepted !== true) return;
    const fields = registrationFields(event.detail.fields);
    lock(true); summary.hidden = true;
    try {
      const result = await client.submit(fields);
      if (!renderRegistrationSuccess(receipt,result)) throw new Error('保存结果无法确认，请保留本页并再次确认。');
      frozen = false;
      form.dispatchEvent(new Event('artdico:registration-saved'));
      receipt.querySelector('h3,h2')?.focus();
    } catch (error) {
      frozen = client.pending;
      announce(error.message || '报名尚未确认保存，请保留本页并重试。');
    } finally { lock(false); }
  });
  // Disabled controls are absent from FormData. Retry uses the original in-memory
  // fields through the controller, while the visible inputs remain protected.
  form.addEventListener('submit', event => {
    if (!frozen || form.dataset.submitting === 'true') return;
    event.preventDefault();
    for (const control of trackedControls()) if (control.dataset.registrationLocked) control.disabled = false;
    queueMicrotask(() => { if (frozen) for (const control of trackedControls()) if (control.dataset.registrationLocked) control.disabled = true; });
  },true);
  window.addEventListener('beforeunload', event => { if (client.pending) {event.preventDefault();event.returnValue='';} });
  client.configure().then(value => {
    if(value?.privacy)document.dispatchEvent(new CustomEvent('artdico:registration-policy',{detail:{privacy:value.privacy}}));
    if (!value || value.enabled !== true) { unavailable(value?.reason??'unavailable'); return; }
    config = value;
    const details = section.querySelector('[data-registration-policy-details]');
    const labels = {processor:'处理者',contactEmail:'联系邮箱',purpose:'使用目的',storageRegion:'存储地区',retention:'保留期限',rightsRequest:'查阅、更正、撤回及删除',sharing:'资料分享范围',version:'告知版本'};
    details.replaceChildren();
    for (const [key,label] of Object.entries(labels)) details.append(node('dt',label),node('dd',value.privacy[key]));
    details.append(node('dt','全场人数与截止时间'),node('dd','全场人数上限 '+value.capacity+' 人；报名截止 '+new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Taipei',dateStyle:'medium',timeStyle:'short'}).format(new Date(value.closesAt))+'（UTC+8）。住宿与展位另行确认。'));
    section.querySelector('[data-registration-policy]').hidden = false;
    section.querySelector('[data-registration-notice]').textContent = '欢迎组织者、学生、游戏创作者与社群伙伴报名。资料实际保存成功后，才会显示报名编号；住宿、讲者与展位分别确认。';
    section.querySelector('[data-registration-open-label]').textContent = '填写活动报名';
    section.querySelector('[data-registration-mode-label]').textContent = '正式报名';
    section.querySelector('[data-registration-data-hint]').textContent = '带 * 为必填。请填写真实且必要的联络资料；不收取身份证、酒店订单或财务账单。';
    section.querySelector('[data-registration-disclaimer]').textContent = '提交前请阅读个人信息处理告知。网络异常时请保留本页，再次确认结果；不要重复新建报名。';
    const consentCopy = form.querySelector('[data-registration-consent-copy]');
    consentCopy.replaceChildren(document.createTextNode('我已阅读以上个人信息处理告知，并同意按告知范围处理本次报名资料。'));
    const consent = form.elements.namedItem('consentAccepted');
    consent.checked = false;
    const consentHint = document.getElementById('field-consentAccepted-hint');
    if (consentHint) consentHint.textContent = '请主动勾选。工作人员不会代替你完成个人信息处理同意。';
    const emailHint = document.getElementById('field-email-hint');
    if (emailHint) emailHint.textContent = '未填写微信时，邮箱将作为替代联络方式。';
    submit.textContent = '确认并提交报名';
    form.dataset.registrationMode = 'production';
    for(const status of document.querySelectorAll('[data-registration-availability]'))status.textContent='报名已开放';
    document.dispatchEvent(new CustomEvent('artdico:registration-ready',{detail:{privacy:value.privacy,closesAt:value.closesAt}}));
  }).catch(() => {
    unavailable('unavailable');
  });
}
