import { validateContent, toPublicContent } from '../../shared/content-schema.mjs';
import { showcaseSummary } from '../../shared/showcase-display.mjs';

const $ = selector => document.querySelector(selector);
const status = $('[data-admin-status]');
const errorBox = $('[data-admin-error]');
const loginPanel = $('[data-admin-login-panel]');
const workspace = $('[data-admin-workspace]');
let user = null;
let csrfToken = '';
let draft = null;
let published = null;
let dirty = false;
let busy = false;
let editingSession = null;
let editingBooth = null;
let editingGuest = null;
let editingShowcase = null;
let showcaseFormDirty = false;
let coverUploading = false;
let coverGeneration = 0;
let coverController = null;
let portraitUploading = false;
let portraitGeneration = 0;
let portraitController = null;
let guestFormDirty = false;
let pendingInvitee = takeInvitee();
function takeInvitee(){
  if(!location.hash.startsWith('#invitee='))return null;
  const raw=location.hash.slice(9);
  history.replaceState(null,'',location.pathname+location.search);
  return /^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/u.test(raw)?raw:null;
}
const portraitIdPattern = /^[a-f0-9]{64}\.(?:jpg|png|webp)$/u;
const contentKey = type => ({ session: 'sessions', booth: 'booths', guest: 'guests', showcase: 'showcases' })[type];
const typeLabel = type => ({ session: '活动场次', booth: '出席展位', guest: '嘉宾资料', showcase: '学生作品' })[type];

function announce(message, error = false) {
  status.textContent = error ? '' : message;
  errorBox.textContent = error ? message : '';
  errorBox.hidden = !error;
}
function canEdit() { return user?.roles.includes('editor'); }
function canPublish() { return user?.roles.includes('publisher'); }
function lockControls() {
  $('[data-admin-login-submit]').disabled = busy || location.protocol === 'file:';
  $('[data-session-submit]').disabled = busy || portraitUploading || coverUploading || !canEdit();
  $('[data-showcase-submit]').disabled = busy || portraitUploading || coverUploading || !canEdit();
  $('[data-showcase-cover-file]').disabled = busy || !canEdit();
  $('[data-showcase-cover-remove]').disabled = busy || !canEdit();
  $('[data-booth-submit]').disabled = busy || portraitUploading || coverUploading || !canEdit();
  $('[data-guest-submit]').disabled = busy || portraitUploading || coverUploading || !canEdit();
  $('[data-guest-portrait-file]').disabled = busy || !canEdit();
  $('[data-guest-portrait-remove]').disabled = busy || !canEdit();
  for (const node of document.querySelectorAll('[data-admin-save],[data-admin-add-session],[data-admin-add-booth],[data-admin-add-guest],[data-admin-add-showcase],[data-row-action]')) node.disabled = busy || portraitUploading || coverUploading || !canEdit();
  $('[data-admin-publish]').disabled = busy || portraitUploading || coverUploading || !canPublish() || dirty;
  $('[data-admin-preview]').disabled = busy || !draft;
  $('[data-admin-logout]').disabled = busy || portraitUploading || coverUploading;
}
function setDirty(value) {
  dirty = value;
  $('[data-admin-unsaved]').textContent = value ? '有尚未保存的修改' : '草稿已保存';
  lockControls();
}
async function request(path, options = {}) {
  const headers = { Accept: 'application/json', ...options.headers };
  if (options.body) headers['Content-Type'] = 'application/json';
  if (options.method && options.method !== 'GET' && csrfToken) headers['X-CSRF-Token'] = csrfToken;
  const response = await fetch(path, { ...options, headers, credentials: 'same-origin', cache: 'no-store' });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 401 && path !== '/api/admin/login') showLogin();
    const message = response.status === 409 ? '草稿已被其他工作人员更新。你的修改仍保留在本页；请先复制需要保留的内容，再重新载入最新草稿。' : result.error?.message || '操作暂未完成，请重试。';
    throw new Error(message);
  }
  return result;
}
async function action(callback) {
  if (busy) return;
  busy = true;
  lockControls();
  try { await callback(); } catch (error) { announce(error.message || '操作未完成。', true); }
  finally { busy = false; lockControls(); if(pendingInvitee&&user&&draft)queueMicrotask(()=>action(prepareInvitedGuest)); }
}
function showLogin() {
  clearPortrait();
  clearCover();
  user = null;
  csrfToken = '';
  draft = null;
  published = null;
  dirty = false;
  workspace.hidden = true;
  loginPanel.hidden = false;
  $('[data-admin-sessions]').replaceChildren();
  $('[data-admin-booths]').replaceChildren();
  $('[data-admin-guests]').replaceChildren();
  $('[data-admin-showcases]').replaceChildren();
  for (const field of ['sessionId', 'boothId']) $('[data-showcase-form]').elements.namedItem(field).replaceChildren();
  $('[data-admin-public-preview]').replaceChildren();
  $('[data-admin-preview-panel]').hidden = true;
  for (const dialog of document.querySelectorAll('dialog')) if (dialog.open) dialog.close();
  for (const type of ['session', 'booth', 'guest', 'showcase']) {
    $('[data-' + type + '-form]').reset();
    const error = $('[data-' + type + '-error]');
    error.textContent = '';
    error.hidden = true;
  }
  const guestSelect=$('[data-session-form]').elements.namedItem('guestId');
  guestSelect.replaceChildren();
  const unlinked=node('option','手动维护讲者 · 未关联嘉宾');unlinked.value='';guestSelect.append(unlinked);
  editingSession = null;
  editingBooth = null;
  editingGuest = null;
  guestFormDirty = false;
  showcaseFormDirty = false;
  editingShowcase = null;
}
function node(tag, value, className) {
  const result = document.createElement(tag);
  if (value !== undefined) result.textContent = value;
  if (className) result.className = className;
  return result;
}
function cell(row, label, value) {
  const td = node('td', value);
  td.dataset.label = label;
  row.append(td);
  return td;
}
function rowActions(row, type, item) {
  const td = cell(row, '操作', undefined);
  for (const [label, actionName] of [['编辑', 'edit'], ['删除', 'delete']]) {
    const button = node('button', label);
    button.type = 'button';
    button.dataset.rowAction = actionName;
    button.setAttribute('aria-label', label + ({ session: '场次 ' + item.title, booth: '展位 ' + item.code, guest: '嘉宾 ' + item.name })[type]);
    button.addEventListener('click', () => {
      if (!canEdit() || busy) return;
      if (actionName === 'edit') openEditor(type, item);
      else {
        if (type === 'guest' && draft.content.sessions.some(session => session.guestId === item.id)) {
          announce('此嘉宾仍关联活动场次，请先在相关场次解除关联，再删除嘉宾。', true);
          return;
        }
        if (['session', 'booth'].includes(type) && (draft.content.showcases ?? []).some(showcase => showcase[type === 'session' ? 'sessionId' : 'boothId'] === item.id)) {
          announce('此记录仍关联学生作品，请先在作品安排中解除关联，再删除。', true);
          return;
        }
        const key = contentKey(type);
        draft.content[key] = draft.content[key].filter(entry => entry.id !== item.id);
        setDirty(true);
        render();
        announce('已从本页草稿移除。保存前可重新载入以恢复；前台尚未改变。');
      }
    });
    td.append(button);
  }
}
function render() {
  if (!draft) return;
  $('[data-admin-user]').textContent = user.label || user.id;
  $('[data-admin-role]').textContent = canPublish() ? '可编辑与发布' : canEdit() ? '可编辑草稿' : '只读';
  if (canPublish() && !canEdit()) $('[data-admin-role]').textContent = '可预览与发布';
  $('[data-admin-event-title]').textContent = draft.content.event.title;
  $('[data-admin-event-date]').textContent = draft.content.event.date + (draft.content.event.dateStatus === 'confirmed' ? '' : '（暂定）');
  $('[data-admin-event-venue]').textContent = draft.content.event.venue + (draft.content.event.venueStatus === 'confirmed' ? '' : '（暂定）');
  $('[data-admin-revision]').textContent = String(draft.revision);
  $('[data-admin-published-at]').textContent = published?.publishedAt ? new Date(published.publishedAt).toLocaleString('zh-CN') : '尚未发布';
  $('[data-admin-session-count]').textContent = String(draft.content.sessions.length);
  $('[data-admin-guest-count]').textContent = String(draft.content.guests?.length ?? 0);
  $('[data-admin-booth-count]').textContent = String(draft.content.booths.length);
  const sessions = $('[data-admin-sessions]');
  sessions.replaceChildren();
  for (const item of [...draft.content.sessions].sort((a,b) => a.start.localeCompare(b.start) || a.zone.localeCompare(b.zone))) {
    const row = node('tr');
    cell(row, '时间', item.start + '–' + item.end);
    cell(row, '场地', item.zone + ' 区');
    cell(row, '场次', item.title);
    const linkedGuest = item.guestId ? draft.content.guests?.find(guest => guest.id === item.guestId) : null;
    cell(row, '讲者', linkedGuest ? linkedGuest.name + (linkedGuest.status === 'confirmed' && linkedGuest.publicConsent ? '（已关联）' : '（待确认或授权）') : item.speakerStatus === 'confirmed' ? item.speakerName : '待确认' + (item.speakerName ? '（已记内部候选）' : ''));
    cell(row, '状态', { draft: '草稿', scheduled: '已安排', cancelled: '已取消' }[item.status]);
    rowActions(row, 'session', item);
    sessions.append(row);
  }
  $('[data-admin-sessions-empty]').hidden = draft.content.sessions.length > 0;
  const booths = $('[data-admin-booths]');
  booths.replaceChildren();
  for (const item of [...draft.content.booths].sort((a,b) => a.code.localeCompare(b.code))) {
    const row = node('tr');
    cell(row, '编号', item.code);
    cell(row, '出席单位', item.organization || '待确认');
    cell(row, '展示内容', item.project || '待确认');
    cell(row, '场地', item.zone + ' 区');
    cell(row, '状态', { pending: '待确认', confirmed: '已确认', cancelled: '已取消' }[item.status]);
    rowActions(row, 'booth', item);
    booths.append(row);
  }
  $('[data-admin-booths-empty]').hidden = draft.content.booths.length > 0;
  const guests = $('[data-admin-guests]');
  guests.replaceChildren();
  for (const item of draft.content.guests ?? []) {
    const row = node('tr');
    const photo = cell(row, '头像', undefined);
    if (portraitIdPattern.test(item.portraitId)) {
      const image = node('img', undefined, 'ah-admin-guest-avatar');
      image.src = '/api/admin/portraits/' + item.portraitId;
      image.alt = item.name + '的头像（内部预览）';
      image.width = 54; image.height = 54; image.loading = 'lazy';
      image.addEventListener('error', () => { image.remove(); photo.append(node('span', '预览不可用', 'ah-admin-guest-no-photo')); }, { once: true });
      photo.append(image);
    } else photo.append(node('span', '待上传', 'ah-admin-guest-no-photo'));
    cell(row, '姓名', item.name || '待填写');
    cell(row, '所属公司', item.company || '待填写');
    cell(row, 'GGJ 职务', item.ggjRole || '—');
    cell(row, '确认与授权', (item.status === 'confirmed' ? '已确认' : '待确认') + ' · ' + (item.publicConsent ? '已获公开授权' : '未获公开授权'));
    rowActions(row, 'guest', item);
    guests.append(row);
  }
  $('[data-admin-guests-empty]').hidden = (draft.content.guests?.length ?? 0) > 0;
  renderShowcases();
  lockControls();
}
function openEditor(type, item = null, allowBusy = false) {
  if (!canEdit() || (busy && !allowBusy) || !draft) return;
  if (type === 'showcase') { openShowcaseEditor(item); return; }
  const form = $('[data-' + type + '-form]');
  form.reset();
  const localError = $('[data-' + type + '-error]');
  localError.textContent = '';
  localError.hidden = true;
  if (type === 'guest') { clearPortrait(); guestFormDirty=false; $('[data-guest-consent-note]').textContent='确认状态与公开授权分别记录。更改资料或照片后，请重新核对授权；保存草稿不会自动公开。'; }
  if (type === 'session') fillSessionGuests();
  const id = type + '-' + [...crypto.getRandomValues(new Uint8Array(16))].map(value => value.toString(16).padStart(2, '0')).join('');
  const value = item || (type === 'session' ? { id, start: '09:30', end: '10:00', zone: 'A', title: '', speakerName: '', speakerStatus: 'pending', guestId: '', status: 'draft', internalNotes: '' } : type === 'booth' ? { id, code: '', organization: '', project: '', zone: 'C', status: 'pending', internalNotes: '' } : { id, name: '', company: '', ggjRole: '', portraitId: '', contactId: '', status: 'pending', publicConsent: false, internalNotes: '' });
  for (const [key,valueText] of Object.entries(value)) {
    const field = form.elements.namedItem(key);
    if (field?.type === 'checkbox') field.checked = valueText === true;
    else if (field) field.value = valueText;
  }
  if (type === 'session') { editingSession = item?.id ?? null; syncSessionGuest(); }
  else if (type === 'booth') editingBooth = item?.id ?? null;
  else { editingGuest = item?.id ?? null; showPortrait(value.portraitId); }
  $('[data-' + type + '-dialog-title]').textContent = (item ? '编辑' : '新增') + typeLabel(type);
  $('[data-' + type + '-dialog]').showModal();
}
async function prepareInvitedGuest(){
  if(!pendingInvitee)return false;
  const id=pendingInvitee;pendingInvitee=null;
  if(guestFormDirty&&!confirm('准备新的嘉宾资料会放弃本次尚未应用的修改，继续吗？'))return false;
  if(!canEdit()||!user?.roles.includes('outreach'))throw new Error('准备邀约对象的嘉宾草稿需要同时具备人员邀约与活动编辑权限。');
  const result=await request('/api/admin/contacts/'+encodeURIComponent(id)+'/guest-prefill');
  const prefill=result.prefill;
  if(!prefill||!['name','company','ggjRole','contactId'].every(key=>typeof prefill[key]==='string')||Object.keys(prefill).some(key=>!['name','company','ggjRole','contactId'].includes(key))||prefill.contactId!==id)throw new Error('嘉宾预填资料无效，请返回人员工作区重新核对。');
  const existing=(draft.content.guests??[]).find(guest=>guest.contactId===prefill.contactId);
  openEditor('guest',existing??null,true);
  const form=$('[data-guest-form]');
  if(existing){
    $('[data-guest-consent-note]').textContent='已打开该邀约对象关联的嘉宾资料。名单回复与嘉宾公开状态分别维护；请核实当前回复，再决定是否发布。';
    announce('已打开关联嘉宾，未重复新增。现有照片、资料与授权保持原记录。');
  }else{
    for(const key of ['name','company','ggjRole','contactId'])form.elements.namedItem(key).value=prefill[key];
    form.elements.namedItem('status').value='pending';form.elements.namedItem('publicConsent').checked=false;
    form.elements.namedItem('portraitId').value='';showPortrait('');guestFormDirty=true;
    $('[data-guest-consent-note]').textContent='已从邀约名单预填资料，实际回复：'+({pending:'待回复',attending:'确认参加',declined:'不参加'}[result.responseStatus]??'待核实')+'。请另行核实资料、出席与公开授权；尚未保存或公开。';
    announce('已准备关联嘉宾资料表，尚未保存。请核实职务、照片与公开同意，再应用修改。');
  }
  return true;
}
function closeGuestEditor(){
  if(busy||portraitUploading)return;
  if(guestFormDirty&&!confirm('关闭将放弃本次尚未应用的嘉宾资料，继续吗？'))return;
  $('[data-guest-dialog]').close();
}
function submitEditor(type, event) {
  event.preventDefault();
  if (!canEdit() || busy || portraitUploading || coverUploading || !draft) return;
  const form = event.currentTarget;
  if (!form.reportValidity()) return;
  const candidate = structuredClone(draft.content);
  const key = contentKey(type);
  const editingId = ({ session: editingSession, booth: editingBooth, guest: editingGuest, showcase: editingShowcase })[type];
  const value = Object.fromEntries(new FormData(form));
  if (type === 'guest') {
    delete value.portraitFile;
    value.publicConsent = form.elements.namedItem('publicConsent').checked;
  }
  if (type === 'showcase') {
    delete value.coverFile;
    value.memberCount = Number(form.elements.namedItem('memberCount').value);
    value.participationForms = new FormData(form).getAll('participationForms');
    value.publicConsent = form.elements.namedItem('publicConsent').checked;
    value.sessionId = form.elements.namedItem('sessionId').value;
    value.boothId = form.elements.namedItem('boothId').value;
  }
  if (type === 'session' && value.guestId) {
    value.speakerName = '';
    value.speakerStatus = 'pending';
  }
  candidate[key] ??= [];
  // Never allow an existing row's stable ID to change through the UI.
  if (editingId) value.id = editingId;
  const index = candidate[key].findIndex(item => item.id === editingId);
  if (index === -1) candidate[key].push(value); else candidate[key][index] = value;
  const result = validateContent(candidate);
  if (!result.valid) {
    const details = [...new Set(Object.values(result.errors))].join(' ');
    const localError = $('[data-' + type + '-error]');
    if (localError) { localError.textContent = details; localError.hidden = false; localError.focus(); }
    else announce(details, true);
    return;
  }
  const localError = $('[data-' + type + '-error]');
  if (localError) { localError.textContent = ''; localError.hidden = true; }
  draft.content = result.value;
  if(type==='guest')guestFormDirty=false;
  if(type==='showcase')showcaseFormDirty=false;
  $('[data-' + type + '-dialog]').close();
  setDirty(true);
  render();
  announce('修改已放入本页草稿，请保存后预览并发布。');
}
function fillSessionGuests() {
  const select = $('[data-session-form]').elements.namedItem('guestId');
  select.replaceChildren();
  const manual = node('option', '手动维护讲者 · 未关联嘉宾'); manual.value = ''; select.append(manual);
  for (const guest of draft.content.guests ?? []) {
    const option = node('option', (guest.name || '未命名嘉宾') + (guest.status === 'confirmed' && guest.publicConsent ? ' · 已确认并授权' : ' · 待确认或授权'));
    option.value = guest.id; select.append(option);
  }
}
function syncSessionGuest() {
  const form = $('[data-session-form]');
  const linked = Boolean(form.elements.namedItem('guestId').value);
  for (const name of ['speakerName', 'speakerStatus']) form.elements.namedItem(name).disabled = linked;
  if (linked) { form.elements.namedItem('speakerName').value = ''; form.elements.namedItem('speakerStatus').value = 'pending'; }
}
function revokeGuestConsent() {
  $('[data-guest-form]').elements.namedItem('publicConsent').checked = false;
  $('[data-guest-consent-note]').textContent = '资料或照片已变更，请重新核对这份资料与照片的公开授权。保存草稿不会自动公开。';
}
function showPortrait(id) {
  const image = $('[data-guest-portrait-preview]');
  const empty = $('[data-guest-portrait-empty]');
  image.hidden = true; image.removeAttribute('src');
  empty.hidden = false;
  if (typeof id !== 'string' || !portraitIdPattern.test(id)) return;
  image.src = '/api/admin/portraits/' + id;
  image.hidden = false; empty.hidden = true;
}
function clearPortrait() {
  portraitGeneration += 1;
  portraitController?.abort(); portraitController = null;
  portraitUploading = false;
  const form = $('[data-guest-form]');
  form.elements.namedItem('portraitId').value = '';
  $('[data-guest-portrait-file]').value = '';
  $('[data-guest-portrait-status]').textContent = '';
  showPortrait('');
  lockControls();
}
async function portraitBytes(file) {
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) throw new Error('请选择 JPEG、PNG 或 WebP 照片。');
  if (!file.size || file.size > 8 * 1024 * 1024) throw new Error('请选择不超过 8 MiB 的照片。');
  let source;
  try {
    if (typeof createImageBitmap === 'function') source = await createImageBitmap(file);
    else {
      const dataUrl = await new Promise((accept, reject) => {
        const reader = new FileReader();
        reader.onload = () => accept(reader.result);
        reader.onerror = () => reject(new Error('照片读取失败。'));
        reader.readAsDataURL(file);
      });
      source = new Image(); source.src = dataUrl; await source.decode();
    }
    const width = source.width || source.naturalWidth;
    const height = source.height || source.naturalHeight;
    if (!width || !height || width > 10000 || height > 10000 || width * height > 40_000_000) throw new Error('照片尺寸过大，请先缩小后重试。');
    const scale = Math.min(1, 1024 / Math.max(width, height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(width * scale)); canvas.height = Math.max(1, Math.round(height * scale));
    const context = canvas.getContext('2d', { alpha: false });
    if (!context) throw new Error('当前浏览器无法处理照片，请换用受支持的浏览器。');
    context.fillStyle = '#fff'; context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(source, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', .86));
    if (!blob || !blob.size || blob.size > 512 * 1024) throw new Error('处理后的照片仍超过 512 KiB，请选择较小的照片。');
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let binary = '';
    for (let offset = 0; offset < bytes.length; offset += 32768) binary += String.fromCharCode(...bytes.subarray(offset, offset + 32768));
    return { contentType: 'image/jpeg', dataBase64: btoa(binary) };
  } catch (error) {
    if (error instanceof Error && /^(?:请选择|照片尺寸|当前浏览器|处理后的)/u.test(error.message)) throw error;
    throw new Error('无法读取这张照片，请使用有效的 JPEG、PNG 或 WebP 图片重试。');
  } finally { source?.close?.(); }
}
async function uploadPortrait(event) {
  const file = event.currentTarget.files?.[0];
  clearPortrait(); revokeGuestConsent();
  const localError = $('[data-guest-error]'); localError.textContent = ''; localError.hidden = true;
  if (!file || !canEdit() || busy || !draft || !$('[data-guest-dialog]').open) return;
  const generation = portraitGeneration;
  const controller = new AbortController(); portraitController = controller;
  portraitUploading = true; lockControls();
  $('[data-guest-portrait-status]').textContent = '正在处理并上传照片…';
  try {
    const payload = await portraitBytes(file);
    if (generation !== portraitGeneration || controller.signal.aborted) return;
    const result = await request('/api/admin/portraits', { method: 'POST', body: JSON.stringify(payload), signal: controller.signal });
    if (generation !== portraitGeneration || controller.signal.aborted || !$('[data-guest-dialog]').open) return;
    if (!portraitIdPattern.test(result.portrait?.id) || result.portrait.contentType !== payload.contentType || !Number.isSafeInteger(result.portrait.bytes) || result.portrait.bytes < 1 || result.portrait.bytes > 512 * 1024) throw new Error('照片上传结果无效，请重试。');
    $('[data-guest-form]').elements.namedItem('portraitId').value = result.portrait.id;
    showPortrait(result.portrait.id);
    $('[data-guest-portrait-status]').textContent = '照片已上传。应用并保存嘉宾资料后才会关联；尚未公开。';
  } catch (error) {
    if (generation !== portraitGeneration || controller.signal.aborted) return;
    $('[data-guest-form]').elements.namedItem('portraitId').value = '';
    showPortrait('');
    $('[data-guest-portrait-status]').textContent = '照片未上传成功，未关联任何新照片。';
    localError.textContent = error.message || '照片上传未完成，请重试。'; localError.hidden = false;
  } finally {
    if (generation === portraitGeneration) { portraitUploading = false; portraitController = null; lockControls(); }
  }
}
$('[data-guest-portrait-preview]').addEventListener('error', event => {
  const id = $('[data-guest-form]').elements.namedItem('portraitId').value;
  if (!$('[data-guest-dialog]').open || !portraitIdPattern.test(id) || event.currentTarget.src !== location.origin + '/api/admin/portraits/' + id) return;
  event.currentTarget.hidden = true;
  $('[data-guest-portrait-empty]').hidden = false;
  $('[data-guest-portrait-status]').textContent = '照片预览不可用，请重新上传后再应用修改。';
  $('[data-guest-form]').elements.namedItem('portraitId').value = '';
  revokeGuestConsent();
});
function showcaseAssignment(item) {
  const parts=[];
  for (const [field,entries,label] of [['sessionId',draft.content.sessions,'分享'],['boothId',draft.content.booths,'展位']]) {
    if (!item[field]) continue;
    const entry=entries.find(candidate=>candidate.id===item[field]);
    parts.push(!entry ? label+'记录已失效' : entry.status==='cancelled' ? label+'已取消' : field==='sessionId' ? entry.start+'–'+entry.end+' / '+entry.zone+'区 · '+entry.title : entry.code+' / '+entry.zone+'区');
  }
  return parts.join('；') || '尚未分配场次或展位';
}
function renderShowcases() {
  if (!draft) return;
  const records=draft.content.showcases??[];
  const summary=showcaseSummary(records,draft.content);
  $('[data-showcase-confirmed-teams]').textContent=String(summary.confirmedTeams);
  $('[data-showcase-confirmed-students]').textContent=String(summary.confirmedStudents);
  $('[data-showcase-assigned-count]').textContent=summary.shareTeams+' / '+summary.boothTeams;
  $('[data-showcase-public-count]').textContent=String(summary.readyToPublishTeams);
  const filter=$('[data-showcase-filter]').value;
  const filtered=records.filter(item=>!filter||item.responseStatus===filter);
  $('[data-showcase-result-count]').textContent='显示 '+filtered.length+' / '+records.length+' 组';
  const output=$('[data-admin-showcases]');output.replaceChildren();
  for(const item of filtered){
    const card=node('article',undefined,'ah-admin-showcase-card');
    if(portraitIdPattern.test(item.coverId)){
      const image=node('img');image.src='/api/admin/portraits/'+item.coverId;image.alt=item.title+'作品图（内部预览）';image.width=320;image.height=180;image.loading='lazy';image.addEventListener('error',()=>image.remove(),{once:true});card.append(image);
    }
    const body=node('div',undefined,'ah-admin-showcase-body');
    body.append(node('h3',item.title||'未命名作品'),node('p',item.teamName||'团队名称待填写','ah-admin-showcase-team'));
    const badge=node('span',({pending:'待回复',attending:'确认参加',declined:'不参加'})[item.responseStatus]??'待回复','ah-admin-badge');badge.dataset.status=item.responseStatus;body.append(badge);
    body.append(node('p',(item.school||'学校待填写')+' · '+(item.contactName||'负责人待填写')+' · '+item.memberCount+' 人（填报）'));
    const forms=(item.participationForms??[]).map(form=>({booth:'展位试玩',share:'上台分享'})[form]).join(' / ')||'参与形式待选';
    body.append(node('p',forms),node('p',showcaseAssignment(item),'ah-admin-showcase-arrangement'));
    const materials=(item.materialLinks??'').split(/\r?\n/u).filter(value=>value.trim()).length;
    body.append(node('p','材料链接 '+materials+' 条 · '+(item.status==='confirmed'?'资料已核准':'资料待核准')+' · '+(item.publicConsent?'已获公开授权':'未获公开授权'),'ah-admin-small'));
    const actions=node('div',undefined,'ah-admin-showcase-actions');
    for(const [label,actionName]of [['编辑作品与安排','edit'],['删除','delete']]){
      const button=node('button',label,'ah-admin-button');button.type='button';button.dataset.rowAction=actionName;button.setAttribute('aria-label',label+' '+item.title);
      button.addEventListener('click',()=>{if(!canEdit()||busy||portraitUploading||coverUploading)return;if(actionName==='edit')openEditor('showcase',item);else if(confirm('从草稿移除此作品记录？保存并发布前，公开页面不会改变。')){draft.content.showcases=records.filter(entry=>entry.id!==item.id);setDirty(true);render();announce('已从本页草稿移除作品；仍需保存草稿并发布，才会改变公开页。');}});actions.append(button);
    }
    body.append(actions);card.append(body);output.append(card);
  }
  $('[data-admin-showcases-empty]').hidden=filtered.length>0;
  $('[data-admin-showcases-empty]').textContent=records.length?'此筛选下没有作品记录。':'还没有学生作品记录。新增资料后，再确认出席、收齐材料并安排展示。';
  lockControls();
}
function fillShowcaseAssignments() {
  const form=$('[data-showcase-form]');
  for(const[field,entries,label]of[['sessionId',draft.content.sessions,'场次'],['boothId',draft.content.booths,'展位']]){
    const select=form.elements.namedItem(field);select.replaceChildren();const empty=node('option','尚未安排');empty.value='';select.append(empty);
    for(const item of entries){
      const title=field==='sessionId'?item.start+'–'+item.end+' · '+item.zone+'区 · '+item.title:item.code+' · '+(item.organization||'待确认团队');
      const option=node('option',title+(item.status==='cancelled'?'（已取消）':''));option.value=item.id;select.append(option);
    }
  }
}
function openShowcaseEditor(item=null) {
  const form=$('[data-showcase-form]');clearCover();form.reset();fillShowcaseAssignments();
  const localError=$('[data-showcase-error]');localError.textContent='';localError.hidden=true;
  const id='showcase-'+[...crypto.getRandomValues(new Uint8Array(16))].map(value=>value.toString(16).padStart(2,'0')).join('');
  const value=item??{id,title:'',teamName:'',school:'',contactName:'',email:'',wechat:'',memberCount:1,participationForms:[],responseStatus:'pending',materialLinks:'',summary:'',coverId:'',status:'pending',publicConsent:false,sessionId:'',boothId:'',internalNotes:''};
  for(const[key,valueText]of Object.entries(value)){
    if(key==='participationForms')continue;
    const field=form.elements.namedItem(key);
    if(field?.type==='checkbox')field.checked=valueText===true;
    else if(field){
      if(['sessionId','boothId'].includes(key)&&valueText&&!Array.from(field.options).some(option=>option.value===valueText)){const missing=node('option','原分配记录已失效，请重新安排');missing.value=valueText;field.append(missing);}
      field.value=valueText;
    }
  }
  for(const field of form.querySelectorAll('[name=participationForms]'))field.checked=value.participationForms?.includes(field.value)??false;
  editingShowcase=item?.id??null;showcaseFormDirty=false;showCover(value.coverId);syncShowcaseForms();
  $('[data-showcase-consent-note]').textContent='公开授权与参加回复分别记录。学生基础资料、联系方式、材料链接及内部备注不进入公开作品页。';
  $('[data-showcase-dialog-title]').textContent=(item?'编辑':'新增')+'学生作品';$('[data-showcase-dialog]').showModal();
}
function syncShowcaseForms() {
  const form=$('[data-showcase-form]');
  for(const[field,type]of[['sessionId','share'],['boothId','booth']])form.elements.namedItem(field).disabled=!form.querySelector('[name=participationForms][value='+type+']').checked;
}
function revokeShowcaseConsent() {
  $('[data-showcase-form]').elements.namedItem('publicConsent').checked=false;
  $('[data-showcase-consent-note]').textContent='作品介绍或图片已变更，请重新核实这份内容的公开授权。私人材料不会随作品图公开。';
}
function showCover(id) {
  const image=$('[data-showcase-cover-preview]');image.hidden=true;image.removeAttribute('src');
  if(typeof id!=='string'||!portraitIdPattern.test(id))return;
  image.src='/api/admin/portraits/'+id;image.hidden=false;
}
function clearCover() {
  coverGeneration+=1;coverController?.abort();coverController=null;coverUploading=false;
  $('[data-showcase-form]').elements.namedItem('coverId').value='';$('[data-showcase-cover-file]').value='';$('[data-showcase-cover-status]').textContent='';showCover('');lockControls();
}
function closeShowcaseEditor() {
  if(busy||coverUploading)return;
  if(showcaseFormDirty&&!confirm('关闭将放弃本次尚未应用的作品资料，继续吗？'))return;
  $('[data-showcase-dialog]').close();
}
async function uploadCover(event) {
  const file=event.currentTarget.files?.[0];clearCover();revokeShowcaseConsent();showcaseFormDirty=true;
  const localError=$('[data-showcase-error]');localError.textContent='';localError.hidden=true;
  if(!file||!canEdit()||busy||!draft||!$('[data-showcase-dialog]').open)return;
  const generation=coverGeneration;const controller=new AbortController();coverController=controller;coverUploading=true;lockControls();
  $('[data-showcase-cover-status]').textContent='正在处理并上传作品图…';
  try{
    const payload=await portraitBytes(file);
    if(generation!==coverGeneration||controller.signal.aborted)return;
    const result=await request('/api/admin/portraits',{method:'POST',body:JSON.stringify(payload),signal:controller.signal});
    if(generation!==coverGeneration||controller.signal.aborted||!$('[data-showcase-dialog]').open)return;
    if(!portraitIdPattern.test(result.portrait?.id)||result.portrait.contentType!==payload.contentType||!Number.isSafeInteger(result.portrait.bytes)||result.portrait.bytes<1||result.portrait.bytes>512*1024)throw new Error('图片上传结果无效，请重试。');
    $('[data-showcase-form]').elements.namedItem('coverId').value=result.portrait.id;showCover(result.portrait.id);
    $('[data-showcase-cover-status]').textContent='作品图已上传；应用并保存后才会关联，尚未公开。';
  }catch(error){
    if(generation!==coverGeneration||controller.signal.aborted)return;
    $('[data-showcase-form]').elements.namedItem('coverId').value='';showCover('');$('[data-showcase-cover-status]').textContent='作品图上传未完成，未关联新图片。';localError.textContent=error.message||'图片上传失败。';localError.hidden=false;
  }finally{if(generation===coverGeneration){coverUploading=false;coverController=null;lockControls();}}
}
$('[data-showcase-cover-file]').addEventListener('change',uploadCover);
$('[data-showcase-cover-remove]').addEventListener('click',()=>{clearCover();revokeShowcaseConsent();showcaseFormDirty=true;});
$('[data-showcase-cover-preview]').addEventListener('error',event=>{
  const id=$('[data-showcase-form]').elements.namedItem('coverId').value;
  if(!$('[data-showcase-dialog]').open||!portraitIdPattern.test(id)||event.currentTarget.src!==location.origin+'/api/admin/portraits/'+id)return;
  showCover('');$('[data-showcase-form]').elements.namedItem('coverId').value='';revokeShowcaseConsent();$('[data-showcase-cover-status]').textContent='作品图预览不可用，请重新上传。';
});
$('[data-showcase-dialog]').addEventListener('close',()=>{clearCover();$('[data-showcase-form]').reset();editingShowcase=null;showcaseFormDirty=false;});
$('[data-showcase-dialog]').addEventListener('cancel',event=>{event.preventDefault();closeShowcaseEditor();});
$('[data-showcase-form]').addEventListener('input',()=>{showcaseFormDirty=true;});
$('[data-showcase-form]').addEventListener('change',()=>{showcaseFormDirty=true;});
for(const name of ['title','teamName','summary'])$('[data-showcase-form]').elements.namedItem(name).addEventListener('input',revokeShowcaseConsent);
for(const field of $('[data-showcase-form]').querySelectorAll('[name=participationForms]'))field.addEventListener('change',()=>{
  if(!field.checked)$('[data-showcase-form]').elements.namedItem(field.value==='share'?'sessionId':'boothId').value='';syncShowcaseForms();
});
function previewPublic() {
  if (!draft) return;
  const content = toPublicContent(draft.content);
  const output = $('[data-admin-public-preview]');
  output.replaceChildren();
  output.append(node('h3', content.event.title), node('p', content.event.date + ' · ' + content.event.venue));
  const list = node('div');
  for (const item of [...content.sessions].sort((a,b) => a.start.localeCompare(b.start) || a.zone.localeCompare(b.zone))) {
    list.append(node('p', item.start + '–' + item.end + ' / ' + item.zone + ' 区 · ' + item.title + ' · ' + (item.status === 'cancelled' ? '已取消' : item.speakerStatus === 'confirmed' ? item.speakerName : '讲者待确认')));
  }
  output.append(list, node('h3', '公开嘉宾'));
  if (!content.guests?.length) output.append(node('p', '名单确认并获授权后将在这里公布。'));
  const guestGrid = node('div', undefined, 'ah-admin-guest-preview-grid');
  for (const item of content.guests ?? []) {
    const card = node('article');
    if (portraitIdPattern.test(item.portraitId)) {
      const portrait = node('img');
      portrait.src = '/api/admin/portraits/' + item.portraitId;
      portrait.alt = item.name + '的头像'; portrait.width = 92; portrait.height = 92;
      portrait.addEventListener('error', () => { portrait.remove(); }, { once: true });
      card.append(portrait);
    }
    card.append(node('h4', item.name), node('p', item.company));
    if (item.ggjRole) card.append(node('p', item.ggjRole));
    guestGrid.append(card);
  }
  output.append(guestGrid, node('h3', '公开学生作品'));
  if (!content.showcases?.length) output.append(node('p', '符合公开门槛的学生作品将在这里展示。'));
  const showcaseGrid = node('div', undefined, 'ah-admin-showcase-preview-grid');
  for (const item of content.showcases ?? []) {
    const card = node('article'); const image = node('img');
    image.src='/api/admin/portraits/'+item.coverId;image.alt=item.title+'作品图';image.width=320;image.height=180;
    card.append(image,node('h4',item.title),node('p',item.teamName),node('p',item.summary));showcaseGrid.append(card);
  }
  output.append(showcaseGrid, node('h3', '出席展位'));
  if (!content.booths.length) output.append(node('p', '确认后的展位将在这里公布。'));
  for (const item of content.booths) output.append(node('p', item.code + ' · ' + item.organization + ' · ' + item.project));
  $('[data-admin-preview-panel]').hidden = false;
  $('[data-admin-preview-panel]').scrollIntoView({ behavior: 'smooth', block: 'start' });
  announce('正在预览本页草稿将公开的内容。内部备注、未确认或未获授权的嘉宾资料均已隐藏。');
}

$('[data-admin-login]').addEventListener('submit', event => {
  event.preventDefault();
  const form = event.currentTarget;
  if (!form.reportValidity()) return;
  action(async () => {
    const body = Object.fromEntries(new FormData(form));
    let result;
    try { result = await request('/api/admin/login', { method: 'POST', body: JSON.stringify(body) }); }
    finally { form.elements.namedItem('password').value = ''; }
    user = result.user;
    csrfToken = result.csrfToken;
    const state = await request('/api/admin/content');
    draft = state.draft;
    published = state.published;
    loginPanel.hidden = true;
    workspace.hidden = false;
    setDirty(false);
    render();
    if(!await prepareInvitedGuest())announce('已登录。修改草稿后，需要发布才会显示到前台。');
  });
});
$('[data-admin-save]').addEventListener('click', () => action(async () => {
  const validation = validateContent(draft.content);
  if (!validation.valid) throw new Error([...new Set(Object.values(validation.errors))].join(' '));
  const result = await request('/api/admin/content', { method: 'PUT', body: JSON.stringify({ expectedRevision: draft.revision, content: validation.value }) });
  draft = result.draft;
  setDirty(false);
  render();
  announce('草稿已保存，前台尚未改变。可先预览，再发布。');
}));
$('[data-admin-publish]').addEventListener('click', () => action(async () => {
  if (!canPublish() || dirty) throw new Error('请先保存草稿，并由有发布权限的工作人员发布。');
  const result = await request('/api/admin/content/publish', { method: 'POST', body: JSON.stringify({ expectedRevision: draft.revision }) });
  published = result.published;
  render();
  announce('发布成功。打开本地前台即可查看最新场次、公开嘉宾与已确认展位；云端接通状态以实际部署为准。');
}));
$('[data-admin-preview]').addEventListener('click', () => { try { previewPublic(); } catch (error) { announce(error.message, true); } });
$('[data-admin-preview-close]').addEventListener('click', () => { $('[data-admin-preview-panel]').hidden = true; });
$('[data-admin-add-session]').addEventListener('click', () => openEditor('session'));
$('[data-admin-add-booth]').addEventListener('click', () => openEditor('booth'));
$('[data-admin-add-guest]').addEventListener('click', () => openEditor('guest'));
$('[data-admin-add-showcase]').addEventListener('click', () => openEditor('showcase'));
$('[data-showcase-form]').addEventListener('submit', event => submitEditor('showcase', event));
$('[data-showcase-filter]').addEventListener('change',renderShowcases);
$('[data-session-form]').addEventListener('submit', event => submitEditor('session', event));
$('[data-booth-form]').addEventListener('submit', event => submitEditor('booth', event));
$('[data-guest-form]').addEventListener('submit', event => submitEditor('guest', event));
$('[name=guestId]').addEventListener('change', syncSessionGuest);
$('[data-guest-portrait-file]').addEventListener('change', uploadPortrait);
$('[data-guest-portrait-remove]').addEventListener('click', () => { clearPortrait(); revokeGuestConsent(); guestFormDirty=true; });
$('[data-guest-dialog]').addEventListener('close',()=>{clearPortrait();$('[data-guest-form]').reset();editingGuest=null;guestFormDirty=false;});
$('[data-guest-dialog]').addEventListener('cancel',event=>{event.preventDefault();closeGuestEditor();});
$('[data-guest-form]').addEventListener('input',()=>{guestFormDirty=true;});
$('[data-guest-form]').addEventListener('change',()=>{guestFormDirty=true;});
for (const name of ['name', 'company', 'ggjRole']) $('[data-guest-form]').elements.namedItem(name).addEventListener('input', revokeGuestConsent);
for (const button of document.querySelectorAll('[data-close-dialog]')) button.addEventListener('click', () => {if(button.dataset.closeDialog==='guest')closeGuestEditor();else if(button.dataset.closeDialog==='showcase')closeShowcaseEditor();else if(!busy)$('[data-' + button.dataset.closeDialog + '-dialog]').close();});
$('[data-admin-logout]').addEventListener('click', () => action(async () => {
  if ((dirty||guestFormDirty||showcaseFormDirty) && !confirm('还有未保存的修改，确定退出并放弃这些修改吗？')) return;
  await request('/api/admin/logout', { method: 'POST' });
  pendingInvitee=null;showLogin();
  announce('已退出。');
}));
window.addEventListener('hashchange',()=>{const id=takeInvitee();if(!id)return;pendingInvitee=id;if(user&&draft)action(prepareInvitedGuest);});
window.addEventListener('beforeunload', event => { if (dirty||guestFormDirty||showcaseFormDirty) { event.preventDefault(); event.returnValue = ''; } });
if (location.protocol === 'file:') {
  announce('这是离线界面预览。请启动本地内容服务并配置工作人员账号后登录。');
  $('[data-admin-login] button[type="submit"]').disabled = true;
} else {
  action(async () => {
    const response = await fetch('/api/admin/session', { credentials: 'same-origin', cache: 'no-store', headers: { Accept: 'application/json' } });
    if (response.status === 401) return;
    if (!response.ok) throw new Error('请确认本地内容服务已启动并完成账号配置。');
    const result = await response.json();
    user = result.user;
    csrfToken = result.csrfToken;
    const state = await request('/api/admin/content');
    draft = state.draft;
    published = state.published;
    loginPanel.hidden = true;
    workspace.hidden = false;
    setDirty(false);
    render();
    if(!await prepareInvitedGuest())announce('已恢复工作人员会话。');
  });
}
