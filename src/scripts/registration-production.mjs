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
document.addEventListener('artdico:registration-ready',event=>{currentPublicPrivacy=event.detail?.privacy??null;currentAvailability={message:'可以提交参会申请。申请收到后需由主办方人工审核；待审核不占参会名额。审核通过并确认名额后再发送正式邀请。'};renderPublicPrivacy();});
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
  let pendingFields = null;
  function unavailable(reason) {
    const closed=reason==='closed';
    form.dataset.registrationMode=closed?'closed':'unavailable';
    submit.disabled=true;
    submit.textContent=closed?'参会申请已关闭':'参会申请暂不可用';
    const message=closed?'本站已停止接收新申请。已保存申请的审核及结果查询不受影响。':'申请服务暂时无法确认，请稍后再试。当前不会提交或保存资料。';
    section.querySelector('[data-registration-notice]').textContent=message;
    section.querySelector('[data-registration-mode-label]').textContent=closed?'申请已关闭':'服务暂不可用';
    section.querySelector('[data-registration-open-label]').textContent='参会申请';
    section.querySelector('[data-registration-disclaimer]').textContent=message;
    section.querySelector('[data-registration-data-hint]').textContent='当前不受理提交，请勿填写真实资料。';
    for(const control of trackedControls())control.disabled=true;
    for(const status of document.querySelectorAll('[data-registration-availability]'))status.textContent=closed?'申请已关闭':'申请服务暂不可用';
    for(const faq of document.querySelectorAll('[data-public-faq] details'))if(faq.querySelector('summary')?.textContent.startsWith('现在可以报名吗？')){const answer=faq.querySelector('p');if(answer)answer.textContent=message;}
    document.dispatchEvent(new CustomEvent('artdico:registration-unavailable',{detail:{message}}));
  }
  function announce(message) { summary.textContent = message; summary.hidden = false; summary.focus(); }
  function lock(value) {
    form.dataset.submitting = String(value);
    form.dataset.applicationPending=String(frozen);
    submit.disabled = value;
    for (const control of trackedControls()) {
      if (value || frozen) { if (!control.disabled) { control.dataset.registrationLocked = 'true'; control.disabled = true; } }
      else if (control.dataset.registrationLocked) { control.disabled = false; delete control.dataset.registrationLocked; }
    }
    submit.textContent = value ? '正在确认申请结果…' : frozen ? '再次确认申请结果' : '提交参会申请';
  }
  async function submitFields(fields) {
    if (!config || form.dataset.submitting === 'true') return;
    lock(true); summary.hidden = true;
    try {
      const result = await client.submit(fields);
      if (!renderRegistrationSuccess(receipt,result)) {
        const labels={pending_review:'申请已收到，待主办方审核；尚未确认参会名额。编号：',confirmed:'参会名额已确认，编号：',waitlisted:'候补登记已保存，尚未确认参会。编号：',rejected:'本次申请未通过审核，编号：',withdrawn:'申请已撤回，编号：'};const fallback=node('p',(labels[result.body.admissionStatus]||'申请结果需核对，编号：')+result.body.reference_code+'。请保留编号，无需重复提交。');
        fallback.setAttribute('role','status');section.append(fallback);
      }
      frozen = false;
      pendingFields = null;
      form.dispatchEvent(new Event('artdico:registration-saved'));
      if (result.body.confirmation) { location.assign(result.body.confirmation.confirmationUrl); return; }
      receipt?.querySelector('h3,h2')?.focus();
    } catch (error) {
      frozen = client.pending;
      if (!frozen) pendingFields = null;
      announce(error.message || '申请尚未确认保存，请保留本页并明确核对同一申请结果。');
    } finally { lock(false); }
  }
  form.addEventListener('artdico:registration-submit', event => {
    if(event.detail?.fields?.consentAccepted!==true)return;
    pendingFields=registrationFields(event.detail.fields);
    void submitFields(pendingFields);
  });
  // Disabled controls are absent from FormData. Retry uses the original in-memory
  // fields through the controller, while the visible inputs remain protected.
  form.addEventListener('submit', event => {
    if (!frozen || form.dataset.submitting === 'true') return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if(pendingFields)void submitFields(pendingFields);
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
    details.append(node('dt','全场人数与截止时间'),node('dd','全场人数上限 '+value.capacity+' 人；申请截止 '+new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Taipei',dateStyle:'medium',timeStyle:'short'}).format(new Date(value.closesAt))+'（UTC+8）。申请须人工审核，待审核不占参会名额。'));
    section.querySelector('[data-registration-policy]').hidden = false;
    const admissions = value.admissions;
    if (admissions) details.append(node('dt','当前参会名额'),node('dd','已确认 '+admissions.confirmedCount+' 人；候补 '+admissions.waitlistCount+' 人。提交申请不保留名额；审核通过时再按共同容量确认名额或候补。'));
    section.querySelector('[data-registration-notice]').textContent='欢迎学生、组织者、游戏创作者与社群伙伴。申请收到后由主办方人工审核；通过并确认名额后再发送正式邀请。';
    section.querySelector('[data-registration-open-label]').textContent = '参会申请';
    section.querySelector('[data-registration-mode-label]').textContent = '人工审核';
    section.querySelector('[data-registration-data-hint]').textContent = '带 * 为必填。学校／机构、城市、微信可不填。';
    section.querySelector('[data-registration-disclaimer]').textContent = '申请需人工审核，待审核不占参会名额。网络异常时请保留本页，再次确认同一申请结果。';
    const consentCopy = form.querySelector('[data-registration-consent-copy]');
    consentCopy.replaceChildren(document.createTextNode('我已阅读以上个人信息处理告知，并同意按告知范围处理本次申请资料。'));
    const consent = form.elements.namedItem('consentAccepted');
    consent.checked = false;
    const consentHint = document.getElementById('field-consentAccepted-hint');
    if (consentHint) consentHint.textContent = '请主动勾选。工作人员不会代替你完成个人信息处理同意。';
    const emailHint = document.getElementById('field-email-hint');
    if (emailHint) emailHint.textContent = '用于查询申请及接收审核后的通知。';
    submit.textContent = '提交参会申请';
    form.dataset.registrationMode = 'production';
    for(const status of document.querySelectorAll('[data-registration-availability]'))status.textContent='参会申请开放，须人工审核';
    document.dispatchEvent(new CustomEvent('artdico:registration-ready',{detail:{privacy:value.privacy,closesAt:value.closesAt}}));
  }).catch(() => {
    unavailable('unavailable');
  });
}
