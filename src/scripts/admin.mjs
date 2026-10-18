import { validateContent, toPublicContent } from '../../shared/content-schema.mjs';

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

function announce(message, error = false) {
  status.textContent = error ? '' : message;
  errorBox.textContent = error ? message : '';
  errorBox.hidden = !error;
}
function canEdit() { return user?.roles.includes('editor'); }
function canPublish() { return user?.roles.includes('publisher'); }
function lockControls() {
  $('[data-admin-login-submit]').disabled = busy || location.protocol === 'file:';
  $('[data-session-submit]').disabled = busy || !canEdit();
  $('[data-booth-submit]').disabled = busy || !canEdit();
  for (const node of document.querySelectorAll('[data-admin-save],[data-admin-add-session],[data-admin-add-booth],[data-row-action]')) node.disabled = busy || !canEdit();
  $('[data-admin-publish]').disabled = busy || !canPublish() || dirty;
  $('[data-admin-preview]').disabled = busy || !draft;
  $('[data-admin-logout]').disabled = busy;
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
  finally { busy = false; lockControls(); }
}
function showLogin() {
  user = null;
  csrfToken = '';
  draft = null;
  published = null;
  dirty = false;
  workspace.hidden = true;
  loginPanel.hidden = false;
  $('[data-admin-sessions]').replaceChildren();
  $('[data-admin-booths]').replaceChildren();
  $('[data-admin-public-preview]').replaceChildren();
  $('[data-admin-preview-panel]').hidden = true;
  for (const dialog of document.querySelectorAll('dialog')) if (dialog.open) dialog.close();
  for (const type of ['session', 'booth']) {
    $('[data-' + type + '-form]').reset();
    const error = $('[data-' + type + '-error]');
    error.textContent = '';
    error.hidden = true;
  }
  editingSession = null;
  editingBooth = null;
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
    button.setAttribute('aria-label', label + (type === 'session' ? '场次 ' + item.title : '展位 ' + item.code));
    button.addEventListener('click', () => {
      if (!canEdit() || busy) return;
      if (actionName === 'edit') openEditor(type, item);
      else {
        const key = type === 'session' ? 'sessions' : 'booths';
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
  $('[data-admin-booth-count]').textContent = String(draft.content.booths.length);
  const sessions = $('[data-admin-sessions]');
  sessions.replaceChildren();
  for (const item of [...draft.content.sessions].sort((a,b) => a.start.localeCompare(b.start) || a.zone.localeCompare(b.zone))) {
    const row = node('tr');
    cell(row, '时间', item.start + '–' + item.end);
    cell(row, '场地', item.zone + ' 区');
    cell(row, '场次', item.title);
    cell(row, '讲者', item.speakerStatus === 'confirmed' ? item.speakerName : '待确认' + (item.speakerName ? '（已记内部候选）' : ''));
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
  lockControls();
}
function openEditor(type, item = null) {
  if (!canEdit() || busy || !draft) return;
  const form = $('[data-' + type + '-form]');
  form.reset();
  const localError = $('[data-' + type + '-error]');
  localError.textContent = '';
  localError.hidden = true;
  const id = type + '-' + [...crypto.getRandomValues(new Uint8Array(16))].map(value => value.toString(16).padStart(2, '0')).join('');
  const value = item || (type === 'session' ? { id, start: '09:30', end: '10:00', zone: 'A', title: '', speakerName: '', speakerStatus: 'pending', status: 'draft', internalNotes: '' } : { id, code: '', organization: '', project: '', zone: 'C', status: 'pending', internalNotes: '' });
  for (const [key,valueText] of Object.entries(value)) {
    const field = form.elements.namedItem(key);
    if (field) field.value = valueText;
  }
  if (type === 'session') editingSession = item?.id ?? null;
  else editingBooth = item?.id ?? null;
  $('[data-' + type + '-dialog-title]').textContent = (item ? '编辑' : '新增') + (type === 'session' ? '活动场次' : '出席展位');
  $('[data-' + type + '-dialog]').showModal();
}
function submitEditor(type, event) {
  event.preventDefault();
  if (!canEdit() || busy || !draft) return;
  const form = event.currentTarget;
  if (!form.reportValidity()) return;
  const candidate = structuredClone(draft.content);
  const key = type === 'session' ? 'sessions' : 'booths';
  const editingId = type === 'session' ? editingSession : editingBooth;
  const value = Object.fromEntries(new FormData(form));
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
  $('[data-' + type + '-dialog]').close();
  setDirty(true);
  render();
  announce('修改已放入本页草稿，请保存后预览并发布。');
}
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
  output.append(list, node('h3', '出席展位'));
  if (!content.booths.length) output.append(node('p', '确认后的展位将在这里公布。'));
  for (const item of content.booths) output.append(node('p', item.code + ' · ' + item.organization + ' · ' + item.project));
  $('[data-admin-preview-panel]').hidden = false;
  $('[data-admin-preview-panel]').scrollIntoView({ behavior: 'smooth', block: 'start' });
  announce('正在预览本页草稿将公开的内容。内部备注和未确认讲者姓名均已隐藏。');
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
    announce('已登录。修改草稿后，需要发布才会显示到前台。');
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
  announce('发布成功。打开前台即可查看最新场次与已确认展位。');
}));
$('[data-admin-preview]').addEventListener('click', () => { try { previewPublic(); } catch (error) { announce(error.message, true); } });
$('[data-admin-preview-close]').addEventListener('click', () => { $('[data-admin-preview-panel]').hidden = true; });
$('[data-admin-add-session]').addEventListener('click', () => openEditor('session'));
$('[data-admin-add-booth]').addEventListener('click', () => openEditor('booth'));
$('[data-session-form]').addEventListener('submit', event => submitEditor('session', event));
$('[data-booth-form]').addEventListener('submit', event => submitEditor('booth', event));
for (const button of document.querySelectorAll('[data-close-dialog]')) button.addEventListener('click', () => $('[data-' + button.dataset.closeDialog + '-dialog]').close());
$('[data-admin-logout]').addEventListener('click', () => action(async () => {
  if (dirty && !confirm('还有未保存的修改，确定退出并放弃这些修改吗？')) return;
  await request('/api/admin/logout', { method: 'POST' });
  showLogin();
  announce('已退出。');
}));
window.addEventListener('beforeunload', event => { if (dirty) { event.preventDefault(); event.returnValue = ''; } });
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
    announce('已恢复工作人员会话。');
  });
}
