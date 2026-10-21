import { validateContent, toPublicContent, GUEST_PUBLIC_ROLES, GUEST_PUBLIC_ROLE_LABELS } from '../../shared/content-schema.mjs';
import { showcaseSummary } from '../../shared/showcase-display.mjs';
import { createArrangementsView } from './arrangements-view.mjs';
import { createInitialPresentation } from '../config/content.mjs';
import { completeBoothSlots } from '../lib/booth-slots.mjs';
import { prepareBoothDraft } from '../lib/arrangement-planner.mjs';
import { createArrangementPlanner } from './arrangement-planner.mjs';
import { prepareProfileImage, processedImageSummary } from '../lib/profile-image.mjs';
import { editStaffImage } from '../lib/staff-image-editor.mjs';
import { createOrganizationsEditor } from './organizations.mjs';
import { contentSaveSnapshot, confirmedContentSave, inspectContentSave, sameContent, contentSaveUiState } from '../lib/admin-save-state.mjs';

const $ = selector => document.querySelector(selector);
const status = $('[data-admin-status]');
const errorBox = $('[data-admin-error]');
const loginPanel = $('[data-admin-login-panel]');
const workspace = $('[data-admin-workspace]');
let user = null;
let csrfToken = '';
let requestSessionGeneration = 0;
let draft = null;
let published = null;
let dirty = false;
let sessionFormDirty = false, boothFormDirty = false;
let saveOutcome = 'loaded', saveProblem = '', pendingSave = null, confirmedSaveRevision = null;
let savingContent = false, checkingContentSave = false, retryContentReady = false;
let eventFormDirty = false;
let busy = false;
let plannerBusy = false;
let planner = null;
let organizations = null;
let pendingBooth = takeBoothLink();
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
let portraitPreviewGeneration = 0;
let portraitController = null;
let portraitPending = null;
let guestFormDirty = false;
let pendingInvitee = takeInvitee();
function takeBoothLink() {
  const match = /^#booth=([A-Za-z0-9][A-Za-z0-9_-]{0,79})$/u.exec(location.hash);
  if (!match) return null;
  history.replaceState(null, '', location.pathname + location.search);
  return match[1];
}
function takeInvitee(){
  if(!location.hash.startsWith('#invitee='))return null;
  const raw=location.hash.slice(9);
  history.replaceState(null,'',location.pathname+location.search);
  return /^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/u.test(raw)?raw:null;
}
const portraitIdPattern = /^[a-f0-9]{64}\.(?:jpg|png|webp)$/u;
const contentKey = type => ({ session: 'sessions', booth: 'booths', guest: 'guests', showcase: 'showcases' })[type];
const typeLabel = type => ({ session: '活动场次', booth: '出席展位', guest: '嘉宾资料', showcase: '学生作品' })[type];

const arrangements = createArrangementsView({
  root: $('[data-arrangements]'),
  load: () => request('/api/admin/arrangements'),
  plan: (type, id, slotNumber) => planner?.open(type, id, slotNumber),
  edit: (type, id, slotNumber) => {
    if (!draft || busy || dirty || portraitUploading || coverUploading || organizations?.hasUnapplied()) return;
    const item = id ? draft.content[contentKey(type)]?.find(entry => entry.id === id) : null;
    if (id && !item) { announce('此记录已不在本页草稿中，请重新读取最新资料。', true); return; }
    openEditor(type, item);
    if (type === 'booth' && !item && slotNumber) $('[data-booth-form]').elements.namedItem('slotNumber').value = String(slotNumber);
  },
});
planner = createArrangementPlanner({
  root: $('[data-arrangement-planner]'), request,
  getContext: () => ({ content: draft?.content, revision: draft?.revision, dirty, busy: busy || portraitUploading || coverUploading || organizations?.hasUnapplied(),
    allowed: Boolean(canEdit() && user?.roles.includes('outreach')) }),
  onBusy: value => { plannerBusy = value; lockControls(); },
  onDraftChange: () => lockControls(),
  refreshArrangements: () => arrangements.refresh(),
  applyBooth: ({ expectedRevision, ...input }) => {
    if (!canEdit() || busy || portraitUploading || coverUploading || organizations?.hasUnapplied() || !draft || expectedRevision !== draft.revision) throw new Error('内容版本已变化，请重新打开展位核对。');
    const result = prepareBoothDraft(draft.content, { ...input, newId: 'booth_' + crypto.randomUUID().replaceAll('-', '') });
    draft.content = result.content; setDirty(true); render();
    announce('展位已应用到内容草稿；保存草稿后才能更新总览，发布仍需另行操作。');
    return result;
  },
});
organizations = createOrganizationsEditor({
  root: $('[data-organizations]'), request,
  getContext: () => ({ content: draft?.content, revision: draft?.revision, user, busy: busy || plannerBusy || portraitUploading || coverUploading }),
  onApply: records => {
    if (!canEdit() || busy || plannerBusy || !draft) throw new Error('请重新读取可编辑草稿后，再应用组织资料。');
    const candidate = { ...draft.content, organizations: records }, checked = validateContent(candidate);
    if (!checked.valid) throw new Error([...new Set(Object.values(checked.errors))].join(' '));
    draft.content = checked.value; setDirty(true);
  },
  onChange: () => { lockControls(); resumePendingLinks(); }, announce,
});
function announce(message, error = false) {
  status.textContent = error ? '' : message;
  errorBox.textContent = error ? message : '';
  errorBox.hidden = !error;
}
function canEdit() { return user?.roles.includes('editor'); }
function canPublish() { return user?.roles.includes('publisher'); }
function unappliedInputs() {
  return [[eventFormDirty, '活动基本资料'], [sessionFormDirty, '场次编辑'], [boothFormDirty, '展位编辑'],
    [guestFormDirty || portraitUploading || portraitPending, '嘉宾资料'], [showcaseFormDirty || coverUploading, '学生作品'],
    [planner?.hasUnapplied(), '总览展位编辑'], [organizations?.hasUnapplied(), '组织资料']].filter(([changed]) => changed).map(([, label]) => label);
}
function hasUnappliedInputs() { return unappliedInputs().length > 0; }
function hasUnsavedChanges() { return dirty || hasUnappliedInputs() || savingContent || ['unknown', 'conflict'].includes(saveOutcome); }
function renderSaveState() {
  const state = contentSaveUiState({ loaded: Boolean(user && draft), canEdit: canEdit(), dirty, unapplied: unappliedInputs(),
    busy: busy || plannerBusy || portraitUploading || coverUploading || organizations?.uploading || checkingContentSave,
    saving: savingContent, outcome: saveOutcome, revision: draft?.revision, confirmedRevision: confirmedSaveRevision, problem: saveProblem, retryReady: retryContentReady });
  for (const output of document.querySelectorAll('[data-admin-save-state],[data-admin-unsaved]')) if (output.textContent !== state.title) output.textContent = state.title;
  for (const output of document.querySelectorAll('[data-admin-save-description]')) if (output.textContent !== state.description) output.textContent = state.description;
  for (const output of document.querySelectorAll('[data-admin-savebar],[data-admin-save-feedback]')) output.dataset.saveState = state.state;
  $('[data-admin-savebar]').hidden = !user || !draft;
  for (const button of document.querySelectorAll('[data-admin-save]')) button.disabled = !state.canSave;
  for (const button of document.querySelectorAll('[data-admin-check-save]')) { button.hidden = !pendingSave || !['unknown', 'conflict'].includes(saveOutcome); button.disabled = !state.canCheck; button.textContent = checkingContentSave ? '正在核对…' : '核对云端保存结果'; }
  for (const button of document.querySelectorAll('[data-admin-retry-save]')) { button.hidden = !pendingSave || !retryContentReady; button.disabled = !state.canRetry; }
  updateSavebarSpace();
}
function updateSavebarSpace() {
  const bar = $('[data-admin-savebar]');
  $('#artdico-admin').style.setProperty('--admin-savebar-space', Math.ceil(bar.hidden ? 0 : bar.getBoundingClientRect().height) + 48 + 'px');
}
function lockControls() {
  const controlsBusy = busy || plannerBusy;
  const organizationBusy = organizations?.uploading === true;
  $('[data-event-submit]').disabled = controlsBusy || portraitUploading || coverUploading || organizationBusy || !canEdit();
  for (const field of $('[data-event-form]').querySelectorAll('input,select,textarea,[data-event-add-faq],[data-event-faq-remove]')) field.disabled = controlsBusy || organizationBusy || !canEdit();
  $('[data-admin-login-submit]').disabled = controlsBusy || location.protocol === 'file:';
  $('[data-session-submit]').disabled = controlsBusy || portraitUploading || coverUploading || organizationBusy || !canEdit();
  $('[data-showcase-submit]').disabled = controlsBusy || portraitUploading || coverUploading || organizationBusy || !canEdit();
  $('[data-showcase-cover-file]').disabled = controlsBusy || organizationBusy || !canEdit();
  $('[data-showcase-cover-remove]').disabled = controlsBusy || organizationBusy || !canEdit();
  $('[data-booth-submit]').disabled = controlsBusy || portraitUploading || coverUploading || organizationBusy || !canEdit();
  $('[data-guest-submit]').disabled = controlsBusy || portraitUploading || Boolean(portraitPending) || coverUploading || organizationBusy || !canEdit();
  $('[data-guest-portrait-file]').disabled = controlsBusy || portraitUploading || Boolean(portraitPending) || organizationBusy || !canEdit();
  $('[data-guest-portrait-remove]').disabled = controlsBusy || organizationBusy || !canEdit();
  $('[data-guest-portrait-edit]').disabled = controlsBusy || portraitUploading || Boolean(portraitPending) || organizationBusy || !canEdit() || !portraitIdPattern.test($('[data-guest-form]').elements.namedItem('portraitId').value);
  for (const selector of ['[data-guest-portrait-retry]','[data-guest-portrait-discard]']) {
    $(selector).hidden = !portraitPending;
    $(selector).disabled = controlsBusy || portraitUploading || organizationBusy || !canEdit();
  }
  for (const node of document.querySelectorAll('[data-admin-save],[data-admin-add-session],[data-admin-add-booth],[data-admin-fill-booths],[data-admin-add-guest],[data-admin-add-showcase],[data-row-action]')) node.disabled = controlsBusy || portraitUploading || coverUploading || organizationBusy || !canEdit();
  $('[data-admin-publish]').disabled = controlsBusy || portraitUploading || coverUploading || organizationBusy || !canPublish() || dirty || hasUnappliedInputs() || savingContent || ['unknown', 'conflict'].includes(saveOutcome);
  $('[data-admin-preview]').disabled = controlsBusy || !draft;
  $('[data-admin-logout]').disabled = controlsBusy || portraitUploading || coverUploading || organizationBusy;
  arrangements.configure({ allowed: Boolean(canEdit() && user?.roles.includes('outreach')), busy: controlsBusy || portraitUploading || coverUploading || organizationBusy, dirty, draftRevision: draft?.revision });
  planner?.configure();
  organizations?.configure();
  renderSaveState();
}
function setDirty(value) {
  dirty = value;
  if (value && !['unknown', 'conflict'].includes(saveOutcome)) saveProblem = '';
  lockControls();
}
async function request(path, options = {}) {
  const sessionGeneration = requestSessionGeneration;
  const { binaryImage = false, ...fetchOptions } = options;
  const headers = { Accept: binaryImage ? 'image/png,image/jpeg,image/webp' : 'application/json', ...options.headers };
  if (options.body) headers['Content-Type'] = 'application/json';
  if (options.method && options.method !== 'GET' && csrfToken) headers['X-CSRF-Token'] = csrfToken;
  const response = await fetch(path, { ...fetchOptions, headers, credentials: 'same-origin', cache: 'no-store', redirect: 'error' });
  if (sessionGeneration !== requestSessionGeneration) throw new Error('会话已变化，请在当前工作区重新操作。');
  const result = binaryImage && response.ok ? null : await response.json().catch(() => ({}));
  if (sessionGeneration !== requestSessionGeneration) throw new Error('会话已变化，请在当前工作区重新操作。');
  if (!response.ok) {
    if (response.status === 401 && path !== '/api/admin/login') { showLogin(); announce('会话已结束，请重新登录。', true); }
    const message = response.status === 503 && result?.error?.code === 'CONTENT_NOT_READY' ? '后台服务暂不可用，可能正在更新。请稍后重试。' : response.status === 409 ? '草稿已被其他工作人员更新。你的修改仍保留在本页；请先复制需要保留的内容，再重新载入最新草稿。' : result?.error?.message || '操作暂未完成，请重试。';
    const failure = new Error(message); failure.status = response.status;
    failure.code = result?.error?.code === 'CONTENT_NOT_READY' ? 'CONTENT_NOT_READY' : '';
    throw failure;
  }
  if (binaryImage) {
    const id = path.split('/').at(-1), type = response.headers.get('content-type')?.split(';')[0].trim();
    const expectedType = id?.endsWith('.jpg') ? 'image/jpeg' : id?.endsWith('.png') ? 'image/png' : 'image/webp';
    if (!portraitIdPattern.test(id ?? '') || type !== expectedType) throw new Error('原图片格式未能核对，请重新选择图片。');
    const reader = response.body?.getReader(); if (!reader) throw new Error('原图片暂时无法读取，请稍后重试。');
    const parts = []; let length = 0;
    try {
      while (true) {
        const chunk = await reader.read(); if (chunk.done) break;
        length += chunk.value.byteLength;
        if (length > 512 * 1024) throw new Error('原图片超过安全读取范围，请重新选择图片。');
        parts.push(chunk.value);
      }
    } catch (failure) { await reader.cancel().catch(() => {}); throw failure; }
    finally { reader.releaseLock(); }
    if (!length) throw new Error('原图片暂时无法读取，请重新选择图片。');
    const file = new File(parts, id, { type });
    if (!globalThis.crypto?.subtle) throw new Error('当前浏览器无法校验原图片，请从本机重新选择图片。');
    const digest = [...new Uint8Array(await crypto.subtle.digest('SHA-256', await file.arrayBuffer()))].map(byte => byte.toString(16).padStart(2,'0')).join('');
    if (digest !== id.split('.')[0]) throw new Error('原图片内容未能核对，请重新选择图片。');
    if (sessionGeneration !== requestSessionGeneration) throw new Error('会话已变化，请在当前工作区重新操作。');
    return file;
  }
  return result;
}
async function action(callback) {
  if (busy || plannerBusy || organizations?.uploading) return;
  busy = true;
  lockControls();
  try { await callback(); } catch (error) { announce(error.message || '操作未完成。', true); }
  finally { busy = false; lockControls(); resumePendingLinks(); }
}
function resumePendingLinks() {
  if (!user || !draft || busy || plannerBusy || portraitUploading || portraitPending || organizations?.hasUnapplied()) return;
  if (pendingBooth) { const id = pendingBooth; pendingBooth = null; planner.open('booth', id); return; }
  if (pendingInvitee) queueMicrotask(() => action(prepareInvitedGuest));
}
function showLogin() {
  requestSessionGeneration += 1;
  clearPortrait();
  clearCover();
  organizations?.clear();
  arrangements.clear();
  planner?.clear();
  user = null;
  csrfToken = '';
  draft = null;
  published = null;
  dirty = false;
  eventFormDirty = false;
  sessionFormDirty = false; boothFormDirty = false;
  saveOutcome = 'loaded'; saveProblem = ''; pendingSave = null; confirmedSaveRevision = null;
  savingContent = false; checkingContentSave = false; retryContentReady = false;
  $('[data-event-form]').reset();
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
    for (const field of $('[data-' + type + '-form]').querySelectorAll('input[type=hidden]')) field.value = '';
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
  renderSaveState();
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
  const actions = type === 'guest' ? [['编辑','edit'],...(item.status==='confirmed'||item.publicConsent ? [['停止公开','unpublish']] : [])] : [['编辑','edit'],['删除','delete']];
  for (const [label, actionName] of actions) {
    const button = node('button', label);
    button.type = 'button';
    button.dataset.rowAction = actionName;
    button.setAttribute('aria-label', label + ({ session: '场次 ' + item.title, booth: '展位 ' + item.code, guest: '嘉宾 ' + item.name })[type]);
    button.addEventListener('click', () => {
      if (!canEdit() || busy) return;
      if (actionName === 'edit') openEditor(type, item);
      else if(actionName==='unpublish'){
        if(!confirm('停止公开此人物？全部人物资料及场次关联会保留，保存并发布后才更新前台。'))return;
        const current=draft.content.guests.find(guest=>guest.id===item.id);if(!current)return;
        current.status='pending';current.publicConsent=false;setDirty(true);render();
        announce('已在草稿停止公开人物，资料、照片与场次关联保留。仍需保存草稿及发布。');
      }
      else {
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
  if (!eventFormDirty) for (const [name,value] of Object.entries(draft.content.event)) {
    const field = $('[data-event-form]').elements.namedItem(name);
    if (field) field.value = value;
  }
  if (!eventFormDirty) {
    const presentation = draft.content.event.presentation ?? createInitialPresentation();
    for (const name of ['heroDescription','aboutTitle','aboutText','checkInTime','openingTime','endTime','contactEmail','mapUrl']) $('[data-event-form]').elements.namedItem(name).value = presentation[name] ?? '';
    renderFaqFields(presentation.faqItems ?? []);
  }
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
    const titleCell = cell(row, '场次', item.title);
    titleCell.append(node('small', ({talk:'演讲',workshop:'工作坊',roundtable:'圆桌',showcase:'作品分享',social:'交流活动',break:'休息 / 签到',other:'待分类 / 其他'})[item.format] || '待分类 / 其他', 'ah-admin-row-format'));
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
    const codeCell = cell(row, '编号', item.code);
    codeCell.append(node('small', item.slotNumber ? String(item.slotNumber).padStart(2,'0')+' 号位置' : '未指定位置', 'ah-admin-row-format'));
    cell(row, '出席单位', item.organization || '待确认');
    const projectCell=cell(row, '展示内容', item.project || '待确认');
    if(item.description)projectCell.append(node('small',item.description));
    const contactCell=cell(row,'负责人 / 联系方式',item.contactName||'负责人待填写');
    contactCell.append(node('small',item.contactMethods||'联系方式待填写 · 不公开'));
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
    const identity=cell(row,'姓名 / 公开职责',item.name||'待填写');
    if(item.publicRoles?.length)identity.append(node('small',item.publicRoles.map(role=>GUEST_PUBLIC_ROLE_LABELS[role]).join(' · ')));
    const affiliation=cell(row,'机构 / 职称',item.company||'待填写');if(item.title)affiliation.append(node('small',item.title));
    cell(row,'GGJ 职务',item.ggjRole||'—');
    cell(row, '确认与授权', (item.status === 'confirmed' ? '已确认' : '待确认') + ' · ' + (item.publicConsent ? '已获公开授权' : '未获公开授权'));
    rowActions(row, 'guest', item);
    guests.append(row);
  }
  $('[data-admin-guests-empty]').hidden = (draft.content.guests?.length ?? 0) > 0;
  renderShowcases();
  organizations?.render();
  lockControls();
}
function openEditor(type, item = null, allowBusy = false) {
  if (!canEdit() || (busy && !allowBusy) || organizations?.hasUnapplied() || !draft) return;
  if (type === 'showcase') { openShowcaseEditor(item); return; }
  const form = $('[data-' + type + '-form]');
  form.reset();
  const localError = $('[data-' + type + '-error]');
  localError.textContent = '';
  localError.hidden = true;
  if (type === 'guest') { clearPortrait(); guestFormDirty=false; $('[data-guest-consent-note]').textContent='确认状态与公开授权分别记录。更改资料或照片后，请重新核对授权；保存草稿不会自动公开。'; }
  if (type === 'session') { sessionFormDirty = false; fillSessionGuests(); }
  if (type === 'booth') boothFormDirty = false;
  const id = type + '-' + [...crypto.getRandomValues(new Uint8Array(16))].map(value => value.toString(16).padStart(2, '0')).join('');
  const value = item || (type === 'session' ? { id, start: '09:30', end: '10:00', zone: 'A', title: '', format: 'other', speakerName: '', speakerStatus: 'pending', guestId: '', status: 'draft', internalNotes: '' } : type === 'booth' ? { id, code: '', organization: '', project: '', zone: 'C', slotNumber: 0, status: 'pending', internalNotes: '' } : { id, name: '', company: '', ggjRole: '', portraitId: '', contactId: '', status: 'pending', publicConsent: false, internalNotes: '' });
  for (const [key,valueText] of Object.entries(value)) {
    if(type==='guest'&&key==='publicRoles'){for(const option of form.querySelectorAll('[name=publicRoles]'))option.checked=valueText.includes(option.value);continue;}
    const field = form.elements.namedItem(key);
    if (field?.type === 'checkbox') field.checked = valueText === true;
    else if (field) field.value = valueText;
  }
  if (type === 'session' && !value.format) form.elements.namedItem('format').value = 'other';
  if (type === 'booth' && value.slotNumber === undefined) form.elements.namedItem('slotNumber').value = '0';
  if (type === 'session') { editingSession = item?.id ?? null; syncSessionGuest(); }
  else if (type === 'booth') editingBooth = item?.id ?? null;
  else { editingGuest = item?.id ?? null; showPortrait(value.portraitId); }
  $('[data-' + type + '-dialog-title]').textContent = (item ? '编辑' : '新增') + typeLabel(type);
  $('[data-' + type + '-dialog]').showModal();
  lockControls();
}
async function prepareInvitedGuest(){
  if(!pendingInvitee||organizations?.hasUnapplied())return false;
  const id=pendingInvitee;pendingInvitee=null;
  if(guestFormDirty&&!confirm('准备新的嘉宾资料会放弃本次尚未应用的修改，继续吗？'))return false;
  if(!canEdit()||!user?.roles.includes('outreach'))throw new Error('准备邀约对象的嘉宾草稿需要同时具备人员邀约与活动编辑权限。');
  const result=await request('/api/admin/contacts/'+encodeURIComponent(id)+'/guest-prefill');
  const prefill=result.prefill;
  if(!prefill||!['name','company','ggjRole','contactId'].every(key=>typeof prefill[key]==='string')||Object.keys(prefill).some(key=>!['name','company','ggjRole','contactId','title','bio','website','publicRoles'].includes(key))||prefill.contactId!==id||['title','bio','website'].some(key=>prefill[key]!==undefined&&typeof prefill[key]!=='string')||prefill.publicRoles!==undefined&&(!Array.isArray(prefill.publicRoles)||prefill.publicRoles.length>4||prefill.publicRoles.some(role=>!GUEST_PUBLIC_ROLES.includes(role))||new Set(prefill.publicRoles).size!==prefill.publicRoles.length))throw new Error('嘉宾预填资料无效，请返回人员工作区重新核对。');
  const existing=(draft.content.guests??[]).find(guest=>guest.contactId===prefill.contactId);
  openEditor('guest',existing??null,true);
  const form=$('[data-guest-form]');
  if(existing){
    $('[data-guest-consent-note]').textContent='已打开该邀约对象关联的嘉宾资料。名单回复与嘉宾公开状态分别维护；请核实当前回复，再决定是否发布。';
    announce('已打开关联嘉宾，未重复新增。现有照片、资料与授权保持原记录。');
  }else{
    for(const key of ['name','company','ggjRole','contactId','title','bio','website'])if(prefill[key]!==undefined)form.elements.namedItem(key).value=prefill[key];
    for(const option of form.querySelectorAll('[name=publicRoles]'))option.checked=prefill.publicRoles?.includes(option.value)??false;
    form.elements.namedItem('status').value='pending';form.elements.namedItem('publicConsent').checked=false;
    form.elements.namedItem('portraitId').value='';showPortrait('');guestFormDirty=true;
    $('[data-guest-consent-note]').textContent='已从邀约名单预填资料，实际回复：'+({pending:'待回复',attending:'确认参加',declined:'不参加'}[result.responseStatus]??'待核实')+'。请另行核实资料、出席与公开授权；尚未保存或公开。';
    if(Array.isArray(result.omittedFields)&&result.omittedFields.some(field=>['title','bio','website'].includes(field)))$('[data-guest-consent-note]').textContent+=' 部分原始资料超出公开栏位限制或网址格式无效，未自动带入；原始名单资料仍完整保留，请另行核对。';
    announce('已准备关联嘉宾资料表，尚未保存。请核实职务、照片与公开同意，再应用修改。');
  }
  return true;
}
function closeGuestEditor(){
  if(busy)return;
  if((guestFormDirty||portraitUploading||portraitPending)&&!confirm('关闭将放弃本次尚未应用的嘉宾资料及图片编辑，继续吗？'))return;
  $('[data-guest-dialog]').close();
}
function closeSimpleEditor(type) {
  if (busy || plannerBusy) return;
  const changed = type === 'booth' ? boothFormDirty : sessionFormDirty;
  if (changed && !confirm('关闭将放弃本次尚未应用的' + typeLabel(type) + '修改，继续吗？')) return;
  $('[data-' + type + '-dialog]').close();
  if (type === 'booth') boothFormDirty = false; else sessionFormDirty = false;
  lockControls();
}
function submitEditor(type, event) {
  event.preventDefault();
  if (!canEdit() || busy || portraitUploading || coverUploading || !draft) return;
  if (type === 'guest' && portraitPending) return;
  const form = event.currentTarget;
  if (!form.reportValidity()) return;
  const candidate = structuredClone(draft.content);
  const key = contentKey(type);
  const editingId = ({ session: editingSession, booth: editingBooth, guest: editingGuest, showcase: editingShowcase })[type];
  const value = Object.fromEntries(new FormData(form));
  if (type === 'booth') value.slotNumber = Number(form.elements.namedItem('slotNumber').value);
  if (type === 'guest') {
    delete value.portraitFile;
    value.publicConsent = form.elements.namedItem('publicConsent').checked;
    value.publicRoles = new FormData(form).getAll('publicRoles');
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
  if(type==='session')sessionFormDirty=false;
  if(type==='booth')boothFormDirty=false;
  $('[data-' + type + '-dialog]').close();
  setDirty(true);
  render();
  announce('修改仅应用到本页，尚未保存到云端。请点击固定保存栏的「保存到云端」；公开发布另外执行。');
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
  const previous = $('[data-guest-portrait-preview]'), image = previous.cloneNode(false), stamp = ++portraitPreviewGeneration;
  previous.removeAttribute('src'); previous.replaceWith(image);
  const empty = $('[data-guest-portrait-empty]');
  image.hidden = true; image.removeAttribute('src');
  empty.hidden = false;
  if (typeof id !== 'string' || !portraitIdPattern.test(id)) return;
  const path = '/api/admin/portraits/' + id;
  image.addEventListener('error', () => {
    if (stamp !== portraitPreviewGeneration || !image.isConnected || $('[data-guest-portrait-preview]') !== image || !$('[data-guest-dialog]').open || $('[data-guest-form]').elements.namedItem('portraitId').value !== id || image.getAttribute('src') !== path) return;
    image.hidden = true; empty.hidden = false;
    $('[data-guest-portrait-status]').textContent = '照片预览暂不可用，原照片引用仍保留。服务恢复后可重新编辑或选择图片。';
  }, { once: true });
  image.src = path;
  image.hidden = false; empty.hidden = true;
}
function cancelPortraitWork() {
  portraitGeneration += 1;
  portraitController?.abort(); portraitController = null;
  portraitUploading = false;
  portraitPending = null;
  $('[data-guest-image-editor]').replaceChildren();
  $('[data-guest-image-editor]').hidden = true;
}
function clearPortrait() {
  cancelPortraitWork();
  const form = $('[data-guest-form]');
  form.elements.namedItem('portraitId').value = '';
  $('[data-guest-portrait-file]').value = '';
  $('[data-guest-portrait-status]').textContent = '';
  showPortrait('');
  lockControls();
}
function portraitContext() {
  return { content: draft?.content, revision: draft?.revision, account: user?.id + '|' + [...(user?.roles ?? [])].sort().join(','), id: $('[data-guest-form]').elements.namedItem('id').value };
}
function portraitContextMatches(context) {
  const current = portraitContext();
  return canEdit() && $('[data-guest-dialog]').open && current.content === context.content && current.revision === context.revision && current.account === context.account && current.id === context.id;
}
async function sendPortrait(pending, generation, controller) {
  const result = await request('/api/admin/portraits', { method: 'POST', body: JSON.stringify(pending.prepared.payload), signal: controller.signal });
  if (generation !== portraitGeneration || controller.signal.aborted || !portraitContextMatches(pending.context)) return;
  const payload = pending.prepared.payload;
  if (!portraitIdPattern.test(result.portrait?.id) || result.portrait.contentType !== payload.contentType || !Number.isSafeInteger(result.portrait.bytes) || result.portrait.bytes < 1 || result.portrait.bytes > 512 * 1024) throw new Error('照片上传结果无效，可重试同一份图片。');
  revokeGuestConsent(); guestFormDirty = true;
  $('[data-guest-form]').elements.namedItem('portraitId').value = result.portrait.id;
  showPortrait(result.portrait.id);
  portraitPending = null;
  $('[data-guest-portrait-status]').textContent = processedImageSummary(pending.prepared)+' 照片已上传；应用并保存后才会关联，尚未公开。';
}
function portraitFailure(error) {
  const localError = $('[data-guest-error]');
  $('[data-guest-portrait-status]').textContent = portraitPending ? '已保留待上传图片及当前填写资料，原照片仍保留。请稍后重试上传，或取消本次图片。' : '图片编辑未完成，原有照片与填写资料仍保留。';
  localError.textContent = error.message || '照片上传未完成，请重试。'; localError.hidden = false;
}
async function editPortrait(fileOrLoader) {
  if (!canEdit() || busy || !draft || !$('[data-guest-dialog]').open) return;
  cancelPortraitWork();
  const localError = $('[data-guest-error]'); localError.textContent = ''; localError.hidden = true;
  const generation = portraitGeneration, context = portraitContext(), returnFocus = $(typeof fileOrLoader === 'function' ? '[data-guest-portrait-edit]' : '[data-guest-portrait-file]');
  const controller = new AbortController(); portraitController = controller;
  portraitUploading = true; lockControls();
  const active = () => generation === portraitGeneration && !controller.signal.aborted && portraitContextMatches(context);
  $('[data-guest-portrait-status]').textContent = '正在准备图片编辑…';
  try {
    const file = typeof fileOrLoader === 'function' ? await fileOrLoader(controller.signal) : fileOrLoader;
    if (!active()) return;
    $('[data-guest-image-editor]').hidden = false;
    const edited = await editStaffImage(file, { root: $('[data-guest-image-editor]'), kind: 'guest', signal: controller.signal });
    if (!active()) return;
    $('[data-guest-image-editor]').hidden = true;
    if (!edited) { $('[data-guest-portrait-status]').textContent = '已取消图片编辑，原有照片与资料保留。'; return; }
    guestFormDirty = true;
    $('[data-guest-portrait-status]').textContent = '正在处理并上传编辑后的照片…';
    const prepared = await prepareProfileImage(edited,{maxEdge:800,preserveTransparency:true,signal:controller.signal});
    if (!active()) return;
    portraitPending = { prepared, context };
    await sendPortrait(portraitPending, generation, controller);
  } catch (error) {
    if (active()) portraitFailure(error);
  } finally {
    if (generation === portraitGeneration) {
      portraitUploading = false; portraitController = null; $('[data-guest-image-editor]').hidden = true; $('[data-guest-portrait-file]').value = ''; lockControls();
      if ($('[data-guest-dialog]').open && document.activeElement === document.body) (portraitPending ? $('[data-guest-portrait-retry]') : returnFocus).focus({ preventScroll: true });
    }
  }
}
function uploadPortrait(event) { const file = event.currentTarget.files?.[0]; if (file) return editPortrait(file); }
async function retryPortrait() {
  const pending = portraitPending;
  if (!pending || portraitUploading || busy || !portraitContextMatches(pending.context)) return;
  const generation = portraitGeneration, controller = new AbortController(); portraitController = controller;
  portraitUploading = true; lockControls();
  $('[data-guest-error]').hidden = true;
  $('[data-guest-portrait-status]').textContent = '正在重试上传同一份图片…';
  try { await sendPortrait(pending, generation, controller); }
  catch (error) { if (generation === portraitGeneration && !controller.signal.aborted && portraitContextMatches(pending.context)) portraitFailure(error); }
  finally { if (generation === portraitGeneration) { portraitUploading = false; portraitController = null; lockControls(); if ($('[data-guest-dialog]').open && document.activeElement === document.body) (portraitPending ? $('[data-guest-portrait-retry]') : $('[data-guest-portrait-edit]')).focus({ preventScroll: true }); } }
}
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
    const prepared=await prepareProfileImage(file,{maxEdge:1600,signal:controller.signal}),payload=prepared.payload;
    if(generation!==coverGeneration||controller.signal.aborted)return;
    const result=await request('/api/admin/portraits',{method:'POST',body:JSON.stringify(payload),signal:controller.signal});
    if(generation!==coverGeneration||controller.signal.aborted||!$('[data-showcase-dialog]').open)return;
    if(!portraitIdPattern.test(result.portrait?.id)||result.portrait.contentType!==payload.contentType||!Number.isSafeInteger(result.portrait.bytes)||result.portrait.bytes<1||result.portrait.bytes>512*1024)throw new Error('图片上传结果无效，请重试。');
    $('[data-showcase-form]').elements.namedItem('coverId').value=result.portrait.id;showCover(result.portrait.id);
    $('[data-showcase-cover-status]').textContent=processedImageSummary(prepared)+' 作品图已上传；应用并保存后才会关联，尚未公开。';
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
$('[data-showcase-dialog]').addEventListener('close',()=>{clearCover();$('[data-showcase-form]').reset();editingShowcase=null;showcaseFormDirty=false;lockControls();});
$('[data-showcase-dialog]').addEventListener('cancel',event=>{event.preventDefault();closeShowcaseEditor();});
$('[data-showcase-form]').addEventListener('input',()=>{showcaseFormDirty=true;lockControls();});
$('[data-showcase-form]').addEventListener('change',()=>{showcaseFormDirty=true;lockControls();});
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
  output.append(list);
  organizations?.appendPublicPreview(content, output);
  output.append(node('h3', '公开嘉宾'));
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
    card.append(node('h4',item.name),node('p',[item.title,item.company].filter(Boolean).join(' · ')));
    if(item.publicRoles?.length)card.append(node('p',item.publicRoles.map(role=>GUEST_PUBLIC_ROLE_LABELS[role]).join(' · ')));
    if(item.bio)card.append(node('p',item.bio));
    if(item.website){const link=node('a','个人 / 机构网站');link.href=item.website;link.target='_blank';link.rel='noopener noreferrer';card.append(link);}
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
    requestSessionGeneration += 1;
    user = result.user;
    csrfToken = result.csrfToken;
    const state = await request('/api/admin/content');
    draft = state.draft;
    published = state.published;
    loginPanel.hidden = true;
    workspace.hidden = false;
    setDirty(false);
    render();
    await arrangements.refresh();
    if (!user || !draft) return;
    if(!await prepareInvitedGuest())announce('已登录。修改草稿后，需要发布才会显示到前台。');
  });
});
function renderFaqFields(items) {
  const output = $('[data-event-faq]'); output.replaceChildren();
  for (const item of items) addFaqFields(item);
}
function addFaqFields(item = {question:'',answer:''}) {
  const row = node('fieldset',undefined,'ah-admin-faq-row');
  row.append(node('legend','常见问题'));
  const questionLabel = node('label','问题');
  const question = node('input'); question.name = 'faqQuestion'; question.maxLength = 200; question.required = true; question.value = item.question; questionLabel.append(question);
  const answerLabel = node('label','回答');
  const answer = node('textarea'); answer.name = 'faqAnswer'; answer.maxLength = 1500; answer.required = true; answer.rows = 3; answer.value = item.answer; answerLabel.append(answer);
  const remove = node('button','移除此问题','ah-admin-text-button'); remove.type = 'button'; remove.dataset.eventFaqRemove = ''; remove.addEventListener('click',() => { row.remove();eventFormDirty = true;lockControls(); });
  row.append(questionLabel,answerLabel,remove); $('[data-event-faq]').append(row);
}
$('[data-event-add-faq]').addEventListener('click',() => {
  if (!canEdit() || busy) return;
  if ($('[data-event-faq]').children.length >= 20) { announce('常见问题最多 20 条。',true);return; }
  addFaqFields();eventFormDirty = true;lockControls();
});
$('[data-event-form]').addEventListener('input', () => { eventFormDirty = true;lockControls(); });
$('[data-event-form]').addEventListener('change', () => { eventFormDirty = true;lockControls(); });
$('[data-event-form]').addEventListener('submit', event => {
  event.preventDefault();
  if (!draft || busy || !canEdit()) return;
  const candidate = structuredClone(draft.content);
  const form = event.currentTarget;
  for (const name of ['title','date','timezone','venue','status','dateStatus','venueStatus']) candidate.event[name] = form.elements.namedItem(name).value;
  candidate.event.presentation = {};
  for (const name of ['heroDescription','aboutTitle','aboutText','checkInTime','openingTime','endTime','contactEmail','mapUrl']) candidate.event.presentation[name] = form.elements.namedItem(name).value;
  candidate.event.presentation.faqItems = [...$('[data-event-faq]').children].map(row => ({question:row.querySelector('[name=faqQuestion]').value,answer:row.querySelector('[name=faqAnswer]').value}));
  const result = validateContent(candidate);
  const error = $('[data-event-error]');
  if (!result.valid) { error.textContent = [...new Set(Object.values(result.errors))].join(' '); error.hidden = false; error.focus(); return; }
  error.hidden = true; error.textContent = '';
  draft.content = result.value; eventFormDirty = false;
  setDirty(true); render();
  announce('活动基本资料已应用到本页草稿。请保存草稿，再预览与发布。');
});
async function timedContentRequest(options = {}) {
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 15_000);
  try { return await request('/api/admin/content', { ...options, signal: controller.signal }); }
  finally { clearTimeout(timer); }
}
function acceptSavedContent(saved, submitted) {
  const unchanged = sameContent(draft.content, submitted.content), localContent = draft.content;
  draft = { revision: saved.revision, content: unchanged ? saved.content : localContent };
  confirmedSaveRevision = saved.revision; saveOutcome = 'saved'; saveProblem = ''; pendingSave = null; savingContent = false; retryContentReady = false;
  setDirty(!unchanged); render();
  return unchanged;
}
async function reportSavedContent({ checked = false, unchanged = true, epoch }) {
  announce(checked ? '已核对：当前云端草稿与待核对的提交内容一致。' : '草稿已保存到云端，公开页面尚未改变。');
  let overviewFailed = false;
  try { await arrangements.refresh(); } catch { overviewFailed = true; }
  if (epoch !== requestSessionGeneration || !user || !draft) return;
  overviewFailed ||= user.roles.includes('outreach') && !$('[data-arrangements-error]').hidden;
  announce((checked ? '已核对：当前云端草稿与待核对的提交内容一致。' : '草稿已保存到云端，公开页面尚未改变。')
    + (!unchanged ? '后续本页修改仍未保存。' : '') + (overviewFailed ? '现场总览暂未刷新；保存已完成，可稍后刷新总览。' : ''));
}
async function saveContentDraft() {
  if (!draft || !canEdit()) throw new Error('此账号没有保存活动内容的权限。');
  if (hasUnappliedInputs()) throw new Error('还有未应用的输入，请先应用或明确取消编辑，再保存到云端。');
  if (['unknown', 'conflict'].includes(saveOutcome)) throw new Error('请先核对云端保存结果；本页修改仍保留，不重复保存或覆盖。');
  if (!dirty) return;
  const submitted = contentSaveSnapshot(draft.revision, draft.content);
  if (!submitted) throw new Error('草稿未通过校验，尚未提交保存；本页修改仍保留。');
  await persistContentSnapshot(submitted);
}
async function retryContentDraft() {
  if (!draft || !canEdit() || !pendingSave || !retryContentReady || !['unknown', 'conflict'].includes(saveOutcome)) return;
  if (hasUnappliedInputs()) throw new Error('请先应用或明确取消正在编辑的输入；重试只保存上次提交的同一份内容。');
  await persistContentSnapshot(pendingSave);
}
async function persistContentSnapshot(submitted) {
  const epoch = requestSessionGeneration;
  pendingSave = submitted; retryContentReady = false; savingContent = true; saveOutcome = 'saving'; saveProblem = ''; lockControls();
  try {
    const result = await timedContentRequest({ method: 'PUT', body: JSON.stringify(submitted) });
    if (epoch !== requestSessionGeneration || !user || !draft) return;
    const saved = confirmedContentSave(result, submitted);
    if (!saved) throw new Error('保存回执内容或版本无法核对。');
    const unchanged = acceptSavedContent(saved, submitted);
    await reportSavedContent({ unchanged, epoch });
  } catch (error) {
    if (epoch !== requestSessionGeneration || !user || !draft) return;
    savingContent = false;
    if (error.status === 409) {
      saveOutcome = 'conflict'; saveProblem = '云端草稿版本已变化，本页修改仍保留。请先核对本次内容是否已保存；不会自动覆盖。';
    } else if ([400, 403, 422].includes(error.status)) {
      saveOutcome = 'loaded'; pendingSave = null; saveProblem = '本次保存未通过验证，本页修改仍保留。' + (error.message || '请核对后再保存。');
    } else {
      saveOutcome = 'unknown'; saveProblem = '保存结果未确认，本页修改仍保留。请先点击「核对云端保存结果」，不要重复保存或刷新。';
    }
    announce(saveProblem, true);
  } finally { if (epoch === requestSessionGeneration) { savingContent = false; lockControls(); } }
}
async function checkContentSave() {
  if (!canEdit() || !draft || !pendingSave || !['unknown', 'conflict'].includes(saveOutcome)) return;
  const submitted = pendingSave, epoch = requestSessionGeneration;
  checkingContentSave = true; retryContentReady = false; lockControls();
  try {
    const result = await timedContentRequest();
    if (epoch !== requestSessionGeneration || pendingSave !== submitted || !user || !draft) return;
    const proof = inspectContentSave(result, submitted);
    if (proof.state === 'confirmed') {
      const unchanged = acceptSavedContent(proof.draft, submitted);
      await reportSavedContent({ checked: true, unchanged, epoch });
    } else {
      if (proof.state === 'conflict') saveOutcome = 'conflict';
      retryContentReady = proof.state === 'retryable';
      saveProblem = proof.state === 'conflict' ? '云端已有不同的内容，本页修改仍保留。请先保留这份编辑，再重新载入核对；不会自动合并或覆盖。'
        : proof.state === 'retryable' ? '云端仍为原版本，尚未证实本次保存。可明确重试同一份提交；后续本页编辑另行保存，不会混入重试。'
          : '目前尚未证实本次修改已保存。本页内容保留，请稍后再次核对，不要重复保存或刷新。';
      announce(saveProblem, true);
    }
  } catch (error) {
    if (epoch !== requestSessionGeneration || !user || !draft) return;
    saveProblem = '暂时无法核对云端保存结果。本页修改仍保留，请稍后再次核对，不要刷新。'; announce(saveProblem, true);
  } finally { if (epoch === requestSessionGeneration) { checkingContentSave = false; lockControls(); } }
}
for (const button of document.querySelectorAll('[data-admin-save]')) button.addEventListener('click', () => action(saveContentDraft));
for (const button of document.querySelectorAll('[data-admin-check-save]')) button.addEventListener('click', () => action(checkContentSave));
for (const button of document.querySelectorAll('[data-admin-retry-save]')) button.addEventListener('click', () => action(retryContentDraft));
$('[data-admin-publish]').addEventListener('click', () => action(async () => {
  if (organizations?.hasUnapplied()) throw new Error('组织资料仍在编辑，请先应用并保存草稿，再发布。');
  if (planner?.hasUnapplied()) throw new Error('总览展位仍有未应用编辑，请先应用并保存草稿。');
  if (!canPublish() || dirty || hasUnappliedInputs() || ['unknown', 'conflict'].includes(saveOutcome)) throw new Error('请先应用全部编辑并确认草稿已保存，再由有发布权限的工作人员发布。');
  const result = await request('/api/admin/content/publish', { method: 'POST', body: JSON.stringify({ expectedRevision: draft.revision }) });
  published = result.published;
  render();
  announce('发布成功。打开本地前台即可查看最新场次、公开嘉宾与已确认展位；云端接通状态以实际部署为准。');
}));
$('[data-arrangements-refresh]').addEventListener('click', () => action(() => arrangements.refresh()));
$('[data-admin-preview]').addEventListener('click', () => { try { previewPublic(); } catch (error) { announce(error.message, true); } });
$('[data-admin-preview-close]').addEventListener('click', () => { $('[data-admin-preview-panel]').hidden = true; });
$('[data-admin-add-session]').addEventListener('click', () => openEditor('session'));
$('[data-admin-add-booth]').addEventListener('click', () => openEditor('booth'));
$('[data-admin-fill-booths]').addEventListener('click',()=>{
  if(!canEdit()||busy||portraitUploading||coverUploading||!draft)return;
  try{
    const result=completeBoothSlots(draft.content.booths);
    if(!result.created){announce('十五个位置已有待确认或已确认展位，未新增重复记录。');return;}
    const candidate={...draft.content,booths:result.booths};const validation=validateContent(candidate);
    if(!validation.valid)throw new Error([...new Set(Object.values(validation.errors))].join(' '));
    draft.content=validation.value;setDirty(true);render();announce('已在本页草稿补齐 '+result.created+' 个待确认展位位置。机构、负责人、联系方式与展示内容仍待填写，请核对后保存。');
  }catch(error){announce(error.message||'展位位置未补齐，请核对资料。',true);}
});
$('[data-admin-add-guest]').addEventListener('click', () => openEditor('guest'));
$('[data-admin-add-showcase]').addEventListener('click', () => openEditor('showcase'));
$('[data-showcase-form]').addEventListener('submit', event => submitEditor('showcase', event));
$('[data-showcase-filter]').addEventListener('change',renderShowcases);
$('[data-session-form]').addEventListener('submit', event => submitEditor('session', event));
$('[data-booth-form]').addEventListener('submit', event => submitEditor('booth', event));
for (const type of ['session', 'booth']) {
  const form = $('[data-' + type + '-form]'), dialog = $('[data-' + type + '-dialog]');
  for (const eventName of ['input', 'change']) form.addEventListener(eventName, () => {
    if (!canEdit() || busy || !dialog.open) return;
    if (type === 'booth') boothFormDirty = true; else sessionFormDirty = true;
    lockControls();
  });
  dialog.addEventListener('cancel', event => { event.preventDefault(); closeSimpleEditor(type); });
  dialog.addEventListener('close', () => {
    if (dialog.open) return;
    if (type === 'booth') { boothFormDirty = false; editingBooth = null; } else { sessionFormDirty = false; editingSession = null; }
    form.reset(); lockControls();
  });
}
$('[data-guest-form]').addEventListener('submit', event => submitEditor('guest', event));
$('[name=guestId]').addEventListener('change', syncSessionGuest);
$('[data-guest-portrait-file]').addEventListener('change', uploadPortrait);
$('[data-guest-portrait-edit]').addEventListener('click', () => {
  const id = $('[data-guest-form]').elements.namedItem('portraitId').value;
  if (portraitIdPattern.test(id) && !portraitPending && !portraitUploading) return editPortrait(signal => request('/api/admin/portraits/' + id, { binaryImage: true, signal }));
});
$('[data-guest-portrait-retry]').addEventListener('click', retryPortrait);
$('[data-guest-portrait-discard]').addEventListener('click', () => {
  cancelPortraitWork();
  $('[data-guest-portrait-status]').textContent = '已取消待上传图片，原有照片与填写资料保留。';
  $('[data-guest-error]').hidden = true;
  showPortrait($('[data-guest-form]').elements.namedItem('portraitId').value); lockControls();
  $('[data-guest-portrait-file]').focus({ preventScroll: true });
});
$('[data-guest-portrait-remove]').addEventListener('click', () => { clearPortrait(); revokeGuestConsent(); guestFormDirty=true; });
$('[data-guest-dialog]').addEventListener('close',()=>{clearPortrait();$('[data-guest-form]').reset();editingGuest=null;guestFormDirty=false;lockControls();});
$('[data-guest-dialog]').addEventListener('cancel',event=>{event.preventDefault();closeGuestEditor();});
for (const type of ['input','change']) $('[data-guest-form]').addEventListener(type,event=>{if (!event.target.closest('[data-image-editor]') && event.target !== $('[data-guest-portrait-file]')) {guestFormDirty=true;lockControls();}});
for (const name of ['name','company','ggjRole','title','bio','website']) $('[data-guest-form]').elements.namedItem(name).addEventListener('input', revokeGuestConsent);
for(const option of $('[data-guest-form]').querySelectorAll('[name=publicRoles]'))option.addEventListener('change',revokeGuestConsent);
for (const button of document.querySelectorAll('[data-close-dialog]')) button.addEventListener('click', () => {if(button.dataset.closeDialog==='guest')closeGuestEditor();else if(button.dataset.closeDialog==='showcase')closeShowcaseEditor();else closeSimpleEditor(button.dataset.closeDialog);});
$('[data-admin-logout]').addEventListener('click', () => action(async () => {
  if (hasUnsavedChanges() && !confirm('还有未保存到云端的修改，确定退出并放弃这些修改吗？')) return;
  await request('/api/admin/logout', { method: 'POST' });
  pendingInvitee=null;showLogin();
  announce('已退出。');
}));
window.addEventListener('hashchange',()=>{const booth=takeBoothLink();if(booth){pendingBooth=booth;resumePendingLinks();return;}const id=takeInvitee();if(!id)return;pendingInvitee=id;resumePendingLinks();});
window.addEventListener('beforeunload', event => { if (hasUnsavedChanges()) { event.preventDefault(); event.returnValue = ''; } });
if (typeof ResizeObserver === 'function') new ResizeObserver(updateSavebarSpace).observe($('[data-admin-savebar]'));
window.addEventListener('resize', updateSavebarSpace);
if (location.protocol === 'file:') {
  announce('这是离线界面预览。请启动本地内容服务并配置工作人员账号后登录。');
  $('[data-admin-login] button[type="submit"]').disabled = true;
} else {
  action(async () => {
    const response = await fetch('/api/admin/session', { credentials: 'same-origin', cache: 'no-store', headers: { Accept: 'application/json' } });
    if (response.status === 401) return;
    if (!response.ok) throw new Error('请确认本地内容服务已启动并完成账号配置。');
    const result = await response.json();
    requestSessionGeneration += 1;
    user = result.user;
    csrfToken = result.csrfToken;
    const state = await request('/api/admin/content');
    draft = state.draft;
    published = state.published;
    loginPanel.hidden = true;
    workspace.hidden = false;
    setDirty(false);
    render();
    await arrangements.refresh();
    if (!user || !draft) return;
    if(!await prepareInvitedGuest())announce('已恢复工作人员会话。');
  });
}
