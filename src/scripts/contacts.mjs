import { parseContactImport, WORKBOOK_SOURCE_KEY, sourceLabels } from '../../shared/contact-import.mjs';
import { renderInvitation, invitationPngBlob, invitationFilename } from '../lib/invitation-renderer.mjs';
import { eventConfig } from '../config/event.mjs';

const $ = value => document.querySelector(value);
const responses = { pending: '尚未确认', attending: '已确认出席', declined: '不出席' };
const categoryLabels = new Map(sourceLabels.categories.map(item => [item.value, item.label]));
const interestLabels = new Map(sourceLabels.interests.map(item => [item.value, item.label]));
let user = null, csrfToken = '', revision = 0, contacts = [], content = null;
let busy = false, importPreview = null, currentContactId = null, invitationContactId = null, renderedSettings = null;
let operationsDirty = false, communications = null;

function matchesSavedInvitation() {
  const invitation = contactById(invitationContactId)?.invitation;
  if (!invitation?.generatedAt || !invitation.settings) return false;
  const current = settingsFromForm();
  return ['recipientName','date','time','venue','confirmed'].every(key => current[key] === invitation.settings[key]);
}
function clearCommunicationPreviews() {
  $('[data-wallet-preview]').hidden = true;
  $('[data-email-preview]').hidden = true;
  for (const selector of ['[data-wallet-title]','[data-wallet-name]','[data-wallet-date]','[data-wallet-time]','[data-wallet-location]','[data-wallet-notice]','[data-email-to]','[data-email-subject]','[data-email-text]']) $(selector).textContent = '';
}
function renderCommunicationStatus() {
  const item = contactById(invitationContactId);
  $('[data-wallet-status]').textContent = communications?.wallet.reason || 'Apple Wallet 账号与签名凭证尚未配置，目前可查看未签名卡片预览。';
  $('[data-email-status]').textContent = communications?.email.reason || 'EmailJS 服务与邮件模板尚未配置，目前仅提供确认信预览。';
  $('[data-email-eligibility]').textContent = item?.operations.responseStatus === 'attending' ? '对象已确认出席，可核对确认信内容。预览不会发送邮件。' : '请先核实对方回复，并在「详情与安排」中保存「已确认出席」，才可预览确认信。历史报名意向不会自动作为出席确认。';
}

function node(tag, value, className) {
  const element = document.createElement(tag);
  if (value !== undefined) element.textContent = value;
  if (className) element.className = className;
  return element;
}
function announce(message, error = false) {
  $('[data-contacts-status]').textContent = error ? '' : message;
  $('[data-contacts-error]').textContent = error ? message : '';
  $('[data-contacts-error]').hidden = !error;
}
function contactById(id) { return contacts.find(item => item.id === id); }
function permitted() { return user?.roles.includes('outreach'); }
function mayInvite(item) { return item?.profile.contactConsent === 'consented'; }
function requireInviteConsent() { if (!mayInvite(contactById(invitationContactId))) throw new Error('此对象未同意联络或授权尚未核对，不能生成或记录发出邀请。'); }
function lock() {
  $('[data-contacts-login-submit]').disabled = busy || location.protocol === 'file:';
  for (const field of document.querySelectorAll('[data-contacts-workspace] button,[data-contacts-file]')) field.disabled = busy || !permitted() || field.hasAttribute('data-consent-blocked');
  $('[data-contact-save]').disabled = busy || !permitted();
  $('[data-contact-fields]').disabled = busy || !permitted();
  for (const field of document.querySelectorAll('[data-invitation-form] input,[data-invitation-form] select')) field.disabled = busy || !permitted();
  $('[data-import-confirm]').disabled = busy || !importPreview?.canCommit || !!importPreview?.summary.possibleDuplicates && !$('[data-import-duplicates]').checked;
  $('[data-invitation-download]').disabled = busy || !renderedSettings || !mayInvite(contactById(invitationContactId));
  $('[data-invitation-record-sent]').disabled = busy || !$('[data-invitation-sent-confirm]').checked || !matchesSavedInvitation() || !mayInvite(contactById(invitationContactId));
  $('[data-wallet-preview-button]').disabled = busy || !permitted() || !mayInvite(contactById(invitationContactId));
  $('[data-email-preview-button]').disabled = busy || !permitted() || !mayInvite(contactById(invitationContactId)) || contactById(invitationContactId)?.operations.responseStatus !== 'attending';
  $('[data-wallet-add]').disabled = true;
  $('[data-email-send]').disabled = true;
  renderCommunicationStatus();
  $('[data-contacts-logout]').disabled = busy;
}
async function request(path, options = {}) {
  const headers = { Accept: 'application/json' };
  if (options.body) headers['Content-Type'] = 'application/json';
  if (options.method && options.method !== 'GET' && csrfToken) headers['X-CSRF-Token'] = csrfToken;
  const response = await fetch(path, { ...options, headers, credentials: 'same-origin', cache: 'no-store' });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 401 && path !== '/api/admin/login') clearPrivateState();
    const details = result.error?.fields ? [...new Set(Object.values(result.error.fields))].join(' ') : '';
    throw new Error(response.status === 409 ? (result.error?.code === 'INVITATION_GENERATION_MISMATCH' ? '邀请函生成记录已变化，请重新生成并下载当前版本，再核对实际发出的版本。' : '名单版本已更新或预览已过期。当前编辑仍保留，请先核对并刷新名单后重试。') : (result.error?.message || '操作未完成，请确认本地服务已启动。') + (details ? ' ' + details : ''));
  }
  return result;
}
async function action(callback) {
  if (busy) return;
  busy = true; lock();
  try { await callback(); } catch (error) { announce(error.message || '操作未完成。', true); }
  finally { busy = false; lock(); }
}
function clearImport() {
  importPreview = null;
  $('[data-import-preview]').hidden = true;
  $('[data-import-rows]').replaceChildren();
  $('[data-import-summary]').textContent = '';
  $('[data-import-duplicates]').checked = false;
  $('[data-contacts-file]').value = '';
  $('[data-contacts-file-name]').textContent = '支持本问卷的 Excel 导出格式';
}
function clearPrivateState() {
  user = null; csrfToken = ''; revision = 0; contacts = []; content = null; communications = null;
  currentContactId = null; invitationContactId = null; renderedSettings = null; operationsDirty = false;
  clearImport();
  $('[data-contacts-workspace]').hidden = true;
  $('[data-contacts-account]').hidden = true;
  $('[data-contacts-login-panel]').hidden = false;
  $('[data-contacts-user]').textContent = '';
  $('[data-contacts-rows]').replaceChildren();
  $('[data-contacts-metrics]').replaceChildren();
  $('[data-contacts-planning]').textContent = '';
  $('[data-contact-title]').textContent = '对象详情';
  $('[data-contacts-search]').value = '';
  $('[data-contacts-category]').value = '';
  $('[data-contacts-response]').value = '';
  $('[data-contacts-due]').checked = false;
  $('[data-contacts-result-count]').textContent = '';
  $('[data-contact-profile]').replaceChildren();
  $('[data-contact-sessions]').replaceChildren();
  $('[data-contact-booths]').replaceChildren();
  $('[data-contact-form]').reset();
  $('[data-invitation-form]').reset();
  $('[data-invitation-form] [name=recipientName]').value = '';
  $('[data-invitation-panel]').hidden = true;
  clearCommunicationPreviews();
  renderCommunicationStatus();
  const canvas = $('[data-invitation-canvas]');
  canvas.getContext('2d').clearRect(0,0,canvas.width,canvas.height);
  canvas.removeAttribute('data-ready'); $('[data-invitation-image]').hidden=true; $('[data-invitation-image]').removeAttribute('src');
  $('[data-invitation-caption]').textContent = '选择对象后点击预览，生成专属邀请函。';
  $('[data-contact-error]').textContent = '';
  $('[data-contact-error]').hidden = true;
  if ($('[data-contact-dialog]').open) $('[data-contact-dialog]').close();
}
async function loadWorkspace() {
  if (!permitted()) throw new Error('此账号没有邀约管理权限，请由维护人员为账号配置 outreach 权限。');
  const state = await request('/api/admin/contacts');
  const program = await request('/api/admin/content');
  communications = await request('/api/admin/communications');
  revision = state.revision; contacts = state.contacts; content = program.draft.content;
  $('[data-contacts-login-panel]').hidden = true;
  $('[data-contacts-workspace]').hidden = false;
  $('[data-contacts-account]').hidden = false;
  $('[data-contacts-user]').textContent = user.label || user.id;
  render();
}
function today() { return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Shanghai' }).format(new Date()); }
function due(item) { return !!item.operations.followUpAt && item.operations.followUpAt <= today() && item.operations.responseStatus === 'pending'; }
function invitationState(item) {
  if (item.invitation.sentAt) return item.invitation.sentGenerationAt === item.invitation.generatedAt ? '已手动发出' : '新版未记录发出';
  return item.invitation.generatedAt ? '已生成，尚未记录发出' : '尚未生成';
}
function render() {
  const metrics = $('[data-contacts-metrics]'); metrics.replaceChildren();
  for (const [label, count] of [['对象总数',contacts.length],['待跟进',contacts.filter(due).length],['已记录发出',contacts.filter(item=>!!item.invitation.sentAt).length],['出席已确认',contacts.filter(item=>item.operations.responseStatus==='attending').length],['尚待回复',contacts.filter(item=>item.operations.responseStatus==='pending').length]]) {
    const card=node('article');card.append(node('span',label),node('strong',String(count)));metrics.append(card);
  }
  $('[data-contacts-planning]').textContent='原问卷意向：自报 SO / RO '+contacts.filter(item=>item.profile.categories.some(value=>['so','ro'].includes(value))).length+' 位，筹备新站点 '+contacts.filter(item=>item.profile.categories.includes('prospective_site')).length+' 位，展示意向 '+contacts.filter(item=>item.profile.interests.includes('exhibition')).length+' 位，需要住宿 '+contacts.filter(item=>item.profile.accommodationIntent==='needed').length+' 位；同意联络 '+contacts.filter(mayInvite).length+' 位。意向不代表安排已确认。';
  const search=$('[data-contacts-search]').value.trim().toLowerCase();
  const type=$('[data-contacts-category]').value;
  const response=$('[data-contacts-response]').value;
  const onlyDue=$('[data-contacts-due]').checked;
  const matches=contacts.filter(item=>{
    const p=item.profile;
    return (!search||[p.name,p.displayName,p.organization,p.city,p.email,p.wechat].some(value=>value.toLowerCase().includes(search)))&&(!response||item.operations.responseStatus===response)&&(!onlyDue||due(item))&&(!type||(type.startsWith('category:')?p.categories.includes(type.slice(9)):p.interests.includes(type.slice(9))));
  });
  const body=$('[data-contacts-rows]');body.replaceChildren();
  for(const item of matches){
    const row=node('tr');
    const identity=node('td');identity.append(node('strong',item.profile.displayName),node('small',[item.profile.organization,item.profile.city].filter(Boolean).join(' · ')));row.append(identity);
    const tags=node('td');
    for(const value of item.profile.categories)tags.append(node('span',categoryLabels.get(value)||value,'contacts-tag'));
    for(const value of item.profile.interests)tags.append(node('span',interestLabels.get(value)||value,'contacts-tag'));
    row.append(tags);
    const invitation=node('td',invitationState(item));if(item.invitation.generatedAt)invitation.append(node('small',item.invitation.settings?.confirmed?'正式版':'暂定版'));row.append(invitation);
    const follow=node('td',item.operations.owner||'待分配');follow.append(node('small',item.operations.followUpAt||'未安排跟进日期'));if(item.operations.priority==='high')follow.append(node('small','优先跟进'));row.append(follow);
    row.append(node('td',responses[item.operations.responseStatus]));
    const actions=node('td');for(const [text,handler]of[['详情与安排',()=>openContact(item)],['邀请函',()=>openInvitation(item)]]){const button=node('button',text);button.type='button';if(text==='邀请函'&&!mayInvite(item)){button.textContent='联络未获同意';button.dataset.consentBlocked='true';button.disabled=true;}button.addEventListener('click',handler);actions.append(button);}row.append(actions);body.append(row);
  }
  $('[data-contacts-empty]').hidden=matches.length>0;
  $('[data-contacts-empty]').textContent=contacts.length?'没有符合筛选条件的对象。':'目前没有对象，请先导入并核对名单。';
  $('[data-contacts-result-count]').textContent='显示 '+matches.length+' / '+contacts.length+' 位';
  lock();
}
function detailPair(dl,label,value){if(!value)return;dl.append(node('dt',label),node('dd',value));}
function openContact(item){
  if(busy||!permitted())return;
  currentContactId=item.id;operationsDirty=false;
  $('[data-contact-title]').textContent=item.profile.displayName+' · 跟进与安排';
  const profile=$('[data-contact-profile]');const dl=node('dl');
  const p=item.profile;
  for(const [label,value]of[['机构 / 职务',[p.organization,p.position].filter(Boolean).join(' · ')],['城市',p.city],['邮箱',p.email],['微信',p.wechat],['身份',p.categories.map(value=>categoryLabels.get(value)||value).join('、')],['参与意向',p.interests.map(value=>interestLabels.get(value)||value).join('、')],['背景与经验',p.background],['关注主题',p.topics],['网站 / 作品',[p.website,p.caseLinks].filter(Boolean).join('\n')],['原出席意向',p.attendanceIntentLabel||'源选项码 '+(p.attendanceIntentCode||'未填')+'（待核对）'],['原住宿意向',p.accommodationIntentLabel||'源选项码 '+(p.accommodationIntentCode||'未填')+'（待核对）'],['原联络同意',p.contactConsentLabel||'源选项码 '+(p.contactConsentCode||'未填')+'（待核对）'],['原未来合作',p.futureCooperationLabel||'源选项码 '+(p.futureCooperationCode||'未填')+'（待核对）'],['原提交时间',p.submittedAt]])detailPair(dl,label,value);
  profile.replaceChildren(dl);
  const form=$('[data-contact-form]');form.reset();
  for(const key of ['owner','priority','followUpAt','notes','responseStatus'])form.elements.namedItem(key).value=item.operations[key];
  for(const [key,list,target]of[['sessionIds',content.sessions,'[data-contact-sessions]'],['boothIds',content.booths,'[data-contact-booths]']]){
    const holder=$(target);holder.replaceChildren();
    for(const record of list){const label=node('label');const input=node('input');input.type='checkbox';input.name=key;input.value=record.id;input.checked=item.operations[key].includes(record.id);input.disabled=record.status==='cancelled';label.append(input,document.createTextNode(key==='sessionIds'?record.start+'–'+record.end+' / '+record.zone+' 区 · '+record.title+(record.status==='cancelled'?'（已取消）':''):record.code+' · '+(record.organization||'待确认')+' · '+(record.project||'待确认')));holder.append(label);}
    const missing=item.operations[key].filter(id=>!list.some(record=>record.id===id));
    if(missing.length)holder.append(node('p','有 '+missing.length+' 条原安排已删除，请核对后重新选择。','contacts-empty-hint'));
    if(!list.length)holder.append(node('p',key==='boothIds'?'请先到场次与展位后台建立展位，再为对象安排出席展位。':'暂无可安排场次。','contacts-empty-hint'));
  }
  $('[data-contact-error]').hidden=true;$('[data-contact-error]').textContent='';
  $('[data-contact-dialog]').showModal();
}
function closeContact(){if(busy)return;if(operationsDirty&&!confirm('关闭将放弃未保存的跟进修改，继续吗？'))return;operationsDirty=false;$('[data-contact-dialog]').close();$('[data-contact-form]').reset();$('[data-contact-profile]').replaceChildren();}
function updateContact(result){revision=result.revision;contacts=contacts.map(item=>item.id===result.contact.id?result.contact:item);render();}
function openInvitation(item){
  if(busy||!permitted())return;
  if(!mayInvite(item)){announce('此对象未同意联络或授权尚未核对，不能生成邀请函。',true);return;}
  invitationContactId=item.id;renderedSettings=null;clearCommunicationPreviews();
  const form=$('[data-invitation-form]');form.reset();
  const settings=item.invitation.settings||{recipientName:item.profile.displayName,date:eventConfig.date.value,time:eventConfig.time.label,venue:eventConfig.venue.address,confirmed:false};
  for(const key of ['recipientName','date','time','venue'])form.elements.namedItem(key).value=settings[key];
  form.elements.namedItem('confirmed').checked=settings.confirmed===true;
  $('[data-invitation-sent-confirm]').checked=false;
  const canvas=$('[data-invitation-canvas]');canvas.getContext('2d').clearRect(0,0,canvas.width,canvas.height);canvas.removeAttribute('data-ready');$('[data-invitation-image]').hidden=true;$('[data-invitation-image]').removeAttribute('src');
  $('[data-invitation-caption]').textContent=item.profile.displayName+' · '+invitationState(item);
  $('[data-invitation-panel]').hidden=false;
  $('[data-invitation-panel]').scrollIntoView({behavior:'smooth',block:'start'});lock();
}
function settingsFromForm(){const form=$('[data-invitation-form]');return{recipientName:form.elements.namedItem('recipientName').value.trim(),date:form.elements.namedItem('date').value,time:form.elements.namedItem('time').value.trim(),venue:form.elements.namedItem('venue').value.trim(),confirmed:form.elements.namedItem('confirmed').checked};}

$('[data-contacts-login]').addEventListener('submit',event=>{event.preventDefault();const form=event.currentTarget;if(!form.reportValidity())return;action(async()=>{let result;try{result=await request('/api/admin/login',{method:'POST',body:JSON.stringify(Object.fromEntries(new FormData(form)))});}finally{form.elements.namedItem('password').value='';}user=result.user;csrfToken=result.csrfToken;$('[data-contacts-account]').hidden=false;$('[data-contacts-user]').textContent=user.label||user.id;await loadWorkspace();announce('已登录。名单和联系方式仅在此私有工作区显示。');});});
$('[data-contacts-logout]').addEventListener('click',()=>action(async()=>{await request('/api/admin/logout',{method:'POST'});clearPrivateState();announce('已退出，已清空本页的名单与邀请函预览。');}));
$('[data-contacts-refresh]').addEventListener('click',()=>action(async()=>{if(operationsDirty&&!confirm('有未保存的跟进修改，刷新将放弃这些修改。继续刷新吗？'))return;operationsDirty=false;if($('[data-contact-dialog]').open)$('[data-contact-dialog]').close();await loadWorkspace();clearImport();announce('已载入最新名单。');}));
for(const selector of ['[data-contacts-search]','[data-contacts-category]','[data-contacts-response]','[data-contacts-due]'])$(selector).addEventListener('input',render);
for(const [prefix,items,label]of[['category:',sourceLabels.categories,'身份'],['interest:',sourceLabels.interests,'参与意向']]){const group=node('optgroup');group.label=label;for(const item of items){const option=node('option',item.label);option.value=prefix+item.value;group.append(option);}$('[data-contacts-category]').append(group);}
$('[data-contacts-file]').addEventListener('change',event=>{const file=event.currentTarget.files?.[0];if(!file)return;action(async()=>{clearImport();if(!file.name.toLowerCase().endsWith('.xlsx')||file.size>2*1024*1024)throw new Error('请选择不超过 2 MB 的 .xlsx 文件。');announce('正在本机读取 Excel 并准备导入预览…');const {readSheet}=await import('read-excel-file/universal');const matrix=await readSheet(file);const parsed=parseContactImport(matrix);if(!parsed.rows.length||parsed.rows.length>500)throw new Error('每批请导入 1–500 位对象。');importPreview=await request('/api/admin/contacts/import/preview',{method:'POST',body:JSON.stringify({sourceKey:WORKBOOK_SOURCE_KEY,rows:parsed.rows})});$('[data-contacts-file-name]').textContent=file.name;const summary=importPreview.summary;$('[data-import-summary]').textContent='共 '+summary.total+' 位：新增 '+summary.new+'，已存在 '+summary.unchanged+'，来源变更 '+summary.conflicts+'，无效 '+summary.invalid+'，可能重复 '+summary.possibleDuplicates+'。';const holder=$('[data-import-rows]');for(const row of importPreview.rows){holder.append(node('p',row.displayName+' · '+({new:'准备新增',unchanged:'已存在，不重复导入',source_changed:'来源变更，需人工核对',invalid:'请先修正'}[row.status])+(row.messages.length?' · '+row.messages.join(' '):'')));}$('[data-import-preview]').hidden=false;announce(parsed.warnings.length?parsed.warnings.map(item=>item.message).join(' '):'请核对导入预览，确认后再写入私有名单。');});});
$('[data-import-duplicates]').addEventListener('change',lock);
$('[data-import-cancel]').addEventListener('click',()=>{clearImport();lock();announce('已取消本次导入预览，没有写入名单。');});
$('[data-import-confirm]').addEventListener('click',()=>action(async()=>{if(!importPreview?.canCommit)throw new Error('请先完成有效的导入预览。');const result=await request('/api/admin/contacts/import',{method:'POST',body:JSON.stringify({expectedRevision:revision,previewToken:importPreview.previewToken,allowPossibleDuplicates:$('[data-import-duplicates]').checked})});revision=result.revision;contacts=result.contacts;const summary=result.summary;clearImport();render();announce('已导入 '+summary.new+' 位，已有 '+summary.unchanged+' 位保持不变。没有自动生成邀请或确认出席。');}));
$('[data-contact-form]').addEventListener('input',()=>{operationsDirty=true;});
for(const button of document.querySelectorAll('[data-contact-close]'))button.addEventListener('click',closeContact);
$('[data-contact-dialog]').addEventListener('cancel',event=>{event.preventDefault();closeContact();});
$('[data-contact-form]').addEventListener('submit',event=>{event.preventDefault();const form=event.currentTarget;if(!form.reportValidity())return;const data=new FormData(form);action(async()=>{const operations=Object.fromEntries(['owner','priority','followUpAt','notes','responseStatus'].map(key=>[key,data.get(key)||'']));operations.sessionIds=data.getAll('sessionIds');operations.boothIds=data.getAll('boothIds');try{const result=await request('/api/admin/contacts/'+encodeURIComponent(currentContactId),{method:'PUT',body:JSON.stringify({expectedRevision:revision,operations})});updateContact(result);operationsDirty=false;$('[data-contact-dialog]').close();announce('跟进与安排已保存。此操作没有改变公开讲者或展位名单。');}catch(error){$('[data-contact-error]').textContent=error.message;$('[data-contact-error]').hidden=false;throw error;}});});
$('[data-invitation-form]').addEventListener('input',event=>{if(!['recipientName','date','time','venue','confirmed'].includes(event.target.name))return;renderedSettings=null;$('[data-invitation-image]').hidden=true;$('[data-invitation-image]').removeAttribute('src');$('[data-invitation-sent-confirm]').checked=false;clearCommunicationPreviews();lock();});
$('[data-invitation-form]').addEventListener('submit',event=>{event.preventDefault();if(!event.currentTarget.reportValidity())return;action(async()=>{requireInviteConsent();const settings=settingsFromForm();await renderInvitation($('[data-invitation-canvas]'),{templateUrl:'/invitations/template-blank.png',...settings});renderedSettings=settings;$('[data-invitation-canvas]').dataset.ready='true';$('[data-invitation-image]').src=$('[data-invitation-canvas]').toDataURL('image/png');$('[data-invitation-image]').hidden=false;$('[data-invitation-caption]').textContent=settings.recipientName+' · '+(settings.confirmed?'正式版预览':'暂定版预览')+' · 仅预览，不会发送';announce('邀请函预览已生成。下载只保存图片，不会发送给对象。');});});
$('[data-invitation-download]').addEventListener('click',()=>action(async()=>{requireInviteConsent();if(!renderedSettings||!invitationContactId)throw new Error('请先生成当前设置的邀请函预览。');const blob=await invitationPngBlob($('[data-invitation-canvas]'));if(!blob.size)throw new Error('图片生成未完成，请重试。');const link=node('a');const url=URL.createObjectURL(blob);try{link.href=url;link.download=invitationFilename(renderedSettings.recipientName,renderedSettings.confirmed);document.body.append(link);link.click();}finally{link.remove();setTimeout(()=>URL.revokeObjectURL(url),10000);}const result=await request('/api/admin/contacts/'+encodeURIComponent(invitationContactId)+'/invitation/generated',{method:'POST',body:JSON.stringify({expectedRevision:revision,settings:renderedSettings})});updateContact(result);$('[data-invitation-sent-confirm]').checked=false;announce('PNG 已生成并开始下载，已记录生成时间；尚未记录发出。');}));
$('[data-invitation-sent-confirm]').addEventListener('change',lock);
$('[data-invitation-channel]').addEventListener('change',()=>{$('[data-invitation-sent-confirm]').checked=false;lock();});
$('[data-invitation-record-sent]').addEventListener('click',()=>action(async()=>{requireInviteConsent();if(!$('[data-invitation-sent-confirm]').checked)throw new Error('请先确认你已经实际发出邀请。');if(!matchesSavedInvitation())throw new Error('当前设置与最近一次生成记录不同，请重新生成并下载，再核对实际发出的版本。');const result=await request('/api/admin/contacts/'+encodeURIComponent(invitationContactId)+'/invitation/sent',{method:'POST',body:JSON.stringify({expectedRevision:revision,channel:$('[data-invitation-channel]').value,generatedAt:contactById(invitationContactId).invitation.generatedAt,settings:settingsFromForm()})});updateContact(result);$('[data-invitation-sent-confirm]').checked=false;announce('已保存工作人员的手动发出记录。系统没有发送任何消息，也没有自动确认对方出席。');}));
$('[data-invitation-close]').addEventListener('click',()=>{$('[data-invitation-panel]').hidden=true;renderedSettings=null;clearCommunicationPreviews();lock();});
$('[data-wallet-preview-button]').addEventListener('click',()=>{if(!$('[data-invitation-form]').reportValidity())return;action(async()=>{requireInviteConsent();const result=await request('/api/admin/contacts/'+encodeURIComponent(invitationContactId)+'/wallet/preview',{method:'POST',body:JSON.stringify({settings:settingsFromForm()})});for(const [selector,value]of [['[data-wallet-title]',result.title],['[data-wallet-name]',result.name],['[data-wallet-date]',result.date],['[data-wallet-time]',result.time],['[data-wallet-location]',result.location],['[data-wallet-notice]',result.notice]])$(selector).textContent=value;$('[data-wallet-preview]').hidden=false;announce('已生成未签名 Wallet 卡片预览。尚未制作或发送 Apple Wallet 通行证。');});});
$('[data-email-preview-button]').addEventListener('click',()=>{if(!$('[data-invitation-form]').reportValidity())return;action(async()=>{requireInviteConsent();if(contactById(invitationContactId)?.operations.responseStatus!=='attending')throw new Error('请先核实并保存对方已确认出席的回复。');const result=await request('/api/admin/contacts/'+encodeURIComponent(invitationContactId)+'/email/preview',{method:'POST',body:JSON.stringify({settings:settingsFromForm()})});$('[data-email-to]').textContent=result.toEmail;$('[data-email-subject]').textContent=result.subject;$('[data-email-text]').textContent=result.text;$('[data-email-preview]').hidden=false;announce('确认信内容已生成，仅供核对，尚未发送。');});});
window.addEventListener('beforeunload',event=>{if(operationsDirty){event.preventDefault();event.returnValue='';}});
if(location.protocol==='file:'){announce('这是离线界面预览。请启动本地服务，使用有邀约管理权限的账号登录。');lock();}else{action(async()=>{const response=await fetch('/api/admin/session',{credentials:'same-origin',cache:'no-store',headers:{Accept:'application/json'}});if(response.status===401)return;if(!response.ok)throw new Error('请先启动本地后台服务。');const session=await response.json();user=session.user;csrfToken=session.csrfToken;$('[data-contacts-account]').hidden=false;$('[data-contacts-user]').textContent=user.label||user.id;await loadWorkspace();announce('已恢复工作人员会话。');});}
