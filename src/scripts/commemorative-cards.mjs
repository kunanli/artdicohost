import { cardCommunityLabel, WALLET_IDENTITIES } from '../../shared/general-application.mjs';
import { canManageEventOperations } from '../../shared/staff-permissions.mjs';

const root = document.querySelector('[data-card-admin]');
const $ = selector => root.querySelector(selector);
const api = '/api/admin/registration-confirmation/cards';
const idPattern = /^[A-Za-z0-9_-]{43}$/u;
const draftId = () => /^#application=([A-Za-z0-9_-]{43})$/u.exec(location.hash)?.[1] ?? '';
const stages = {
  check_delivery: '寄送结果未确认', pending_review: '核对报名', set_identity: '设置卡面身份',
  retry_delivery: '可重新寄送', send: '待寄送', blocked: '暂不可寄送',
  submitted: '已提交发送', waitlisted: '候补中', rejected: '报名未通过', withdrawn: '报名已取消',
};
const queueOrder = Object.keys(stages);
const todo = new Set(queueOrder.slice(0, 6));
const sentTime = new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Taipei', dateStyle: 'medium', timeStyle: 'short', hourCycle: 'h23' });
const reasons = {
  PERMISSION_REQUIRED: '请由有寄送权限的工作人员发卡。',
  EMAIL_MISSING: '请在人员资料中补齐收件邮箱。',
  EMAIL_UNAVAILABLE: '邮件寄送暂不可用。',
  EVENT_FACTS_MISMATCH: '请先核对已发布的活动信息。',
  EVENT_FACTS_UNAVAILABLE: '活动信息暂无法核对。',
};
const loginPanel = $('[data-card-login-panel]');
const workspace = $('[data-card-workspace]');
const logout = $('[data-card-logout]');
const login = $('[data-card-login]');
const search = $('[data-card-search]');
const list = $('[data-card-list]');
const filters = [...root.querySelectorAll('[data-card-filter]')];
const detail = $('[data-card-details]');
const heading = $('[data-card-name]');
const identityForm = $('[data-card-identity-form]');
const identity = $('#card-identity');
const communityDetails = $('[data-card-community]');
const communityForm = $('[data-card-community-form]');
const communitySite = $('#card-community-site');
const communityRole = $('#card-community-role');
const deliveryForm = $('[data-card-delivery]');
const approve = $('[data-card-approve]');
const check = $('[data-card-check]');
const errorBox = $('[data-card-error]');
const detailError = $('[data-card-detail-error]');
const message = $('[data-card-message]');
const placeholder = $('[data-card-placeholder]');
const add = $('[data-card-add]');
const createPanel = $('#card-create');
const createForm = $('[data-card-create]');
const remove = $('[data-card-remove]');

let csrf = '', rows = [], filter = 'todo', activeId = '', current = null, busy = false, editingIdentity = false, version = 0;
let pendingTest = null;
const pendingApprovals = new Map();
const rowFor = id => rows.find(row => row.sources.some(source => source.id === id));

function showError(text = '', target = errorBox) {
  for (const box of [errorBox, detailError]) {
    box.textContent = box === target ? text : '';
    box.hidden = !box.textContent;
  }
}
function rememberApplication(id) {
  const hash = id ? '#application=' + id : '';
  if (hash !== location.hash) history.replaceState(history.state, '', location.pathname + location.search + hash);
}
async function request(path, method = 'GET', body) {
  const reply = await fetch(path, {
    method, credentials: 'same-origin', cache: 'no-store', redirect: 'error',
    headers: { Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}), ...(method !== 'GET' && csrf ? { 'X-CSRF-Token': csrf } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(25000),
  });
  if (reply.status === 401 && path !== '/api/admin/login') clear();
  const value = await reply.json();
  if (!reply.ok) throw Object.assign(new Error(value.error?.message || '暂时无法核对，请稍后重试。'), { status: reply.status });
  return value;
}
function clear() {
  version++;
  csrf = '';
  rows = [];
  filter = 'todo';
  activeId = '';
  search.value = '';
  list.replaceChildren();
  for (const button of filters) button.querySelector('span').textContent = '';
  pendingApprovals.clear();
  pendingTest = null;
  createForm.reset();
  setCreateOpen(false);
  add.hidden = true;
  loginPanel.hidden = false;
  logout.hidden = true;
  workspace.hidden = true;
  setView(null);
  message.textContent = '';
}
function setCreateOpen(open) {
  createPanel.hidden = !open;
  add.setAttribute('aria-expanded', String(open));
}
function renderList() {
  const query = search.value.normalize('NFKC').trim().toLocaleLowerCase();
  const counts = { all: rows.length, todo: 0, submitted: 0 };
  for (const row of rows) {
    if (todo.has(row.stage)) counts.todo++;
    if (row.stage === 'submitted') counts.submitted++;
  }
  for (const button of filters) {
    const key = button.dataset.cardFilter;
    button.setAttribute('aria-pressed', String(filter === key));
    button.querySelector('span').textContent = String(counts[key]);
  }
  const visible = rows.filter(row => (filter === 'all' || filter === 'todo' && todo.has(row.stage) || filter === 'submitted' && row.stage === 'submitted')
    && (!query || [row.name, ...row.sources.flatMap(({ name, bookingReference }) => [name, bookingReference])]
      .some(value => value.normalize('NFKC').toLocaleLowerCase().includes(query))))
    .sort((left, right) => {
      const stageDifference = queueOrder.indexOf(left.stage) - queueOrder.indexOf(right.stage);
      if (stageDifference) return stageDifference;
      if (left.stage === 'submitted') return (right.sentAt ?? right.submittedAt).localeCompare(left.sentAt ?? left.submittedAt) || left.id.localeCompare(right.id);
      return left.submittedAt.localeCompare(right.submittedAt) || left.id.localeCompare(right.id);
    });
  const empty = $('[data-card-empty]');
  empty.hidden = visible.length > 0;
  empty.textContent = query ? '当前筛选没有匹配的申请。'
    : filter === 'todo' ? '目前没有待处理的申请。' : filter === 'submitted' ? '目前没有已提交的纪念卡。' : '目前没有纪念卡申请。';
  const focused = document.activeElement?.dataset.application;
  const selected = rowFor(activeId);
  list.replaceChildren(...visible.map(row => {
    const li = document.createElement('li');
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.application = row.id;
    button.dataset.stage = row.stage;
    button.setAttribute('aria-pressed', String(selected === row));
    const name = document.createElement('strong'), reference = document.createElement('span'), status = document.createElement('small');
    name.textContent = row.name;
    reference.className = 'card-muted';
    reference.textContent = row.bookingReference;
    status.textContent = stages[row.stage];
    button.append(name, reference, status);
    li.append(button);
    return li;
  }));
  if (focused) [...list.querySelectorAll('[data-application]')].find(button => button.dataset.application === focused)?.focus({ preventScroll: true });
}
function setView(value) {
  const stayOnApplication = current?.registrationId === value?.registrationId;
  current = value;
  detail.hidden = !value;
  placeholder.hidden = Boolean(value);
  if (!value) {
    for (const selector of ['[data-card-name]', '[data-card-recipient]', '[data-card-reference]', '[data-card-state]', '[data-card-sent-at]', '[data-card-identity-value] span']) $(selector).textContent = '';
    $('[data-card-linked] ul').replaceChildren();
    $('[data-card-correct-email]').removeAttribute('href');
    identity.value = '';
    communityDetails.open = false;
    communityForm.reset();
    return;
  }
  heading.textContent = value.name;
  $('[data-card-reference-label]').textContent = value.test ? '类型' : '活动行编号';
  const linked = $('[data-card-linked]');
  const otherReferences = [...new Set((rowFor(value.registrationId)?.sources ?? []).map(source => source.bookingReference))]
    .filter(reference => reference !== value.bookingReference);
  linked.hidden = otherReferences.length === 0;
  linked.open = false;
  linked.querySelector('ul').replaceChildren(...otherReferences.map(reference => {
    const item = document.createElement('li');
    item.textContent = reference;
    return item;
  }));
  $('[data-card-reference]').textContent = value.bookingReference;
  $('[data-card-recipient]').textContent = value.recipient || '未填写';
  const preferences = value.applicationPreferences ?? {};
  const requestedIdentity = WALLET_IDENTITIES.find(option => option.value === preferences.requestedWalletIdentity);
  identity.value = value.identity || requestedIdentity?.value || '';
  const requestedIdentityText = $('[data-card-requested-identity]');
  requestedIdentityText.hidden = !requestedIdentity;
  requestedIdentityText.textContent = requestedIdentity ? '申请人所选身份：' + requestedIdentity.label : '';
  if (!stayOnApplication) communityDetails.open = false;
  communityDetails.hidden = value.admissionStatus !== 'confirmed' || !Number.isSafeInteger(value.communityRevision);
  const suggestedCommunity = { site: preferences.ggjSite ?? '', role: preferences.ggjRole ?? '' };
  const communityInput = value.cardCommunitySaved ? value.cardCommunity : suggestedCommunity;
  communitySite.value = communityInput?.site ?? '';
  communityRole.value = communityInput?.role ?? '';
  const proposed = cardCommunityLabel(suggestedCommunity), proposalText = $('[data-card-requested-community]');
  proposalText.hidden = !proposed;
  proposalText.textContent = proposed ? '申请人填写：' + proposed : '';
  const community = cardCommunityLabel(value.cardCommunity);
  $('[data-card-community-summary]').textContent = community ? 'GGJ 社群 · ' + community
    : proposed && !value.cardCommunitySaved ? 'GGJ 社群（申请人已填写）' : 'GGJ 社群（选填）';
  renderActions();
}
function renderActions() {
  const value = current;
  if (!value) return;
  const verified = value.admissionStatus === 'confirmed';
  const sent = value.stage === 'submitted', uncertain = value.stage === 'check_delivery';
  const resend = value.canResend === true;
  const canSend = value.stage === 'send' || value.stage === 'retry_delivery' || resend;
  const reason = value.reason && (reasons[value.reason] ?? '收件权限暂无法核对。');
  const pending = pendingApprovals.has(value.registrationId);
  const identityValue = $('[data-card-identity-value]');
  identityValue.hidden = $('[data-card-identity-label]').hidden = !value.identity || !verified;
  identityValue.querySelector('span').textContent = value.identity ? identity.selectedOptions[0]?.textContent : '';
  $('[data-card-edit]').hidden = value.test || !verified || uncertain || sent || editingIdentity;
  const state = $('[data-card-state]');
  state.dataset.stage = value.stage;
  state.textContent = value.sendInProgress ? '纪念卡正在发送。'
    : uncertain ? '上次寄送结果未确认。'
    : sent ? '纪念卡邮件已提交发送'
    : reason || (value.stage === 'retry_delivery' ? '发送失败，可再次寄送。' : stages[value.stage]);
  const submittedAt = $('[data-card-sent-at]');
  submittedAt.hidden = !sent || !value.sentAt;
  submittedAt.textContent = submittedAt.hidden ? '' : '提交时间 ' + sentTime.format(new Date(value.sentAt));
  const correction = $('[data-card-correct-email]');
  correction.hidden = value.reason !== 'EMAIL_MISSING';
  if (!correction.hidden) correction.href = '/admin/person/#registration=' + encodeURIComponent(value.primaryId);
  else correction.removeAttribute('href');
  $('[data-card-verification]').hidden = value.stage !== 'pending_review';
  approve.textContent = pending ? '核对报名确认结果' : '核对无误，确认报名';
  identityForm.hidden = !verified || uncertain || sent || Boolean(value.identity && !editingIdentity);
  deliveryForm.hidden = !canSend || editingIdentity;
  deliveryForm.querySelector('[type="submit"]').textContent = resend || value.stage === 'retry_delivery' ? '重新发送纪念卡' : '发送纪念卡';
  $('[data-card-delivery-formats]').textContent = uncertain && resend
    ? '上次邮件可能已经寄出。重寄可能会收到多封邮件。'
    : value.walletReady
    ? '一封邮件可领取 JPEG 和 Apple Wallet。' : '可先寄送 JPEG。Apple Wallet 就绪后可用同一链接领取。';
  const deliveryBlock = $('[data-card-delivery-block]');
  deliveryBlock.hidden = !(uncertain || sent) || !reason || value.reason === 'EMAIL_MISSING';
  deliveryBlock.textContent = deliveryBlock.hidden ? '' : reason;
  check.hidden = !value.sendInProgress;
  $('[data-card-remove-panel]').hidden = !value.canRemove;
  remove.textContent = value.test ? '移除测试卡' : '移除纪念卡';
}
async function work(task, nearApplication = false) {
  if (busy) return;
  busy = true;
  showError();
  if (nearApplication) message.textContent = '';
  root.setAttribute('aria-busy', 'true');
  const focused = document.activeElement;
  const controls = [...root.querySelectorAll('button, select, input')].filter(node => !node.disabled && node !== logout);
  controls.forEach(node => { node.disabled = true; });
  try { await task(); } catch (error) { showError(error.message || '暂时无法核对，请稍后重试。', nearApplication && !workspace.hidden ? detailError : errorBox); }
  finally {
    controls.forEach(node => { node.disabled = false; });
    busy = false;
    root.removeAttribute('aria-busy');
    if (nearApplication && document.activeElement === document.body && !detail.hidden && detail.contains(focused)) {
      (focused.getClientRects().length ? focused : heading).focus({ preventScroll: true });
    }
  }
}
async function open(id, focus = false) {
  if (!idPattern.test(id)) return;
  const previous = activeId, readVersion = version;
  activeId = id;
  const selected = rowFor(id);
  for (const entry of list.querySelectorAll('[data-application]')) entry.setAttribute('aria-pressed', String(entry.dataset.application === selected?.id));
  editingIdentity = false;
  if (id !== previous) { message.textContent = ''; setView(null); }
  placeholder.textContent = '正在核对这份申请…';
  let value;
  try { value = await request(api + '/' + id); }
  catch (error) { if (version === readVersion) { setView(null); placeholder.textContent = '暂时无法读取这份申请。'; } throw error; }
  if (version !== readVersion) return;
  if (value.registrationId !== id || !idPattern.test(value.primaryId)) throw new Error('申请资料无法核对。');
  if (selected) Object.assign(selected, { name: value.name, status: value.status, stage: value.stage, format: value.format, sentAt: value.sentAt });
  renderList();
  setView(value);
  rememberApplication(id);
  if (focus) heading.focus();
}
async function refresh() {
  const readVersion = version;
  const value = await request(api);
  if (version !== readVersion) return;
  rows = value.applications;
  const id = activeId || draftId(), selected = rowFor(id);
  if (!activeId && selected && !todo.has(selected.stage)) filter = selected.stage === 'submitted' ? 'submitted' : 'all';
  renderList();
  if (selected) await open(id);
  else {
    activeId = '';
    setView(null);
    if (id) rememberApplication('');
    placeholder.textContent = id ? '这份申请已不在当前名单。' : '请选择一份申请。';
  }
}
async function start(session) {
  if (!session.user?.roles?.some(role => role === 'reviewer' || role === 'superadmin')) throw new Error('当前账号没有查看纪念卡申请的权限。');
  csrf = session.csrfToken;
  loginPanel.hidden = true;
  logout.hidden = false;
  workspace.hidden = false;
  add.hidden = !canManageEventOperations(session.user);
  await refresh();
}
login.addEventListener('submit', event => {
  event.preventDefault();
  void work(async () => {
    const username = login.elements.namedItem('username');
    const password = login.elements.namedItem('password');
    try { await start(await request('/api/admin/login', 'POST', { username: username.value, password: password.value })); }
    finally { password.value = ''; }
  });
});
logout.addEventListener('click', async () => {
  try { await request('/api/admin/logout', 'POST'); clear(); rememberApplication(''); showError(); }
  catch (error) { showError(error.message); }
});
list.addEventListener('click', event => {
  const button = event.target.closest('[data-application]');
  if (button) void work(() => open(button.dataset.application, true));
});
search.addEventListener('input', renderList);
for (const button of filters) button.addEventListener('click', () => { filter = button.dataset.cardFilter; renderList(); });
$('[data-card-refresh]').addEventListener('click', () => work(refresh));
add.addEventListener('click', () => {
  const open = createPanel.hidden;
  setCreateOpen(open);
  if (open) createForm.elements.namedItem('name').focus();
});
$('[data-card-cancel-create]').addEventListener('click', () => { setCreateOpen(false); add.focus(); });
createForm.addEventListener('submit', event => {
  event.preventDefault();
  const fields = Object.fromEntries(new FormData(createForm));
  void work(async () => {
    const key = JSON.stringify(fields);
    if (pendingTest?.key !== key) pendingTest = { key, operationId: crypto.randomUUID() };
    const { registrationId } = await request(api, 'POST', { ...fields, operationId: pendingTest.operationId });
    if (!idPattern.test(registrationId ?? '')) throw new Error('暂时无法核对这张测试卡。');
    filter = 'all';
    search.value = '';
    activeId = registrationId;
    await refresh();
    if (!csrf || current?.registrationId !== registrationId) throw new Error('暂时无法核对这张测试卡。');
    pendingTest = null;
    createForm.reset();
    setCreateOpen(false);
    message.textContent = '测试卡已保存，可以发送测试邮件。';
    heading.focus();
  });
});
remove.addEventListener('click', () => {
  const view = current;
  if (busy || !view?.canRemove || !window.confirm('移除「' + view.name + '」的纪念卡？这张卡的线上领取链接将失效。')) return;
  void work(async () => {
    try {
      await request(api + '/' + view.registrationId, 'DELETE', { primaryId: view.primaryId });
      if (csrf) await refresh();
    }
    catch (error) {
      if (csrf) await refresh();
      if (!csrf || rowFor(view.registrationId)) throw error;
    }
    if (csrf) message.textContent = '纪念卡已移除。';
  }, true);
});
check.addEventListener('click', () => work(() => open(activeId), true));
$('[data-card-edit]').addEventListener('click', () => { editingIdentity = true; renderActions(); identity.focus(); });

approve.addEventListener('click', () => work(async () => {
  const view = current;
  if (!view) return;
  const id = view.registrationId;
  const body = pendingApprovals.get(id) ?? {
    primaryId: view.primaryId, expectedRevision: view.admissionRevision, operationId: crypto.randomUUID(),
  };
  pendingApprovals.set(id, body);
  try { await request(api + '/' + id + '/approve', 'POST', body); }
  catch (error) {
    if (error.status && error.status < 500) pendingApprovals.delete(id);
    if (csrf) await open(id);
    throw error;
  }
  pendingApprovals.delete(id);
  if (csrf) await open(id);
}, true));
identityForm.addEventListener('submit', event => {
  event.preventDefault();
  void work(async () => {
    const view = current;
    if (!view || !identity.value) return;
    try { await request(api + '/' + view.registrationId, 'PATCH', { primaryId: view.primaryId, expectedRevision: view.reviewRevision, identity: identity.value }); }
    catch (error) { if (csrf) await open(view.registrationId); throw error; }
    if (csrf) { await open(view.registrationId); message.textContent = '卡面身份已保存。'; }
  }, true);
});
communityForm.addEventListener('submit', event => {
  event.preventDefault();
  void work(async () => {
    const view = current;
    if (!view || view.admissionStatus !== 'confirmed' || !Number.isSafeInteger(view.communityRevision)) return;
    try {
      await request(api + '/' + view.registrationId, 'PATCH', {
        primaryId: view.primaryId,
        expectedCommunityRevision: view.communityRevision,
        cardCommunity: { site: communitySite.value, role: communityRole.value },
      });
    } catch (error) {
      if (csrf) await open(view.registrationId);
      throw error;
    }
    if (csrf) { await open(view.registrationId); message.textContent = 'GGJ 社群已保存。'; }
  }, true);
});
deliveryForm.addEventListener('submit', event => {
  event.preventDefault();
  void work(async () => {
    const view = current;
    if (!view || !['send', 'retry_delivery'].includes(view.stage) && !view.canResend) return;
    message.textContent = '正在发送…';
    let receipt;
    try {
      receipt = await request(api + '/' + view.registrationId, 'POST', {
        primaryId: view.primaryId, expectedRevision: view.deliveryRevision, expectedAccessRevision: view.accessRevision,
        identity: view.identity, format: 'jpeg', ...(view.canResend ? { resend: true } : {}),
      });
    } catch (error) {
      if (csrf) {
        message.textContent = '正在核对寄送结果…';
        await open(view.registrationId);
        message.textContent = '';
      }
      throw error;
    }
    if (!csrf) return;
    await open(view.registrationId);
    if (view.canResend && receipt.status === 'provider_accepted') message.textContent = '已重新提交纪念卡邮件。';
    else message.textContent = ['provider_accepted', 'unknown', 'rejected'].includes(receipt.status) ? '' : '这次未能发送，请查看当前状态。';
  }, true);
});

login.querySelector('[type="submit"]').disabled = false;
void work(async () => {
  try { await start(await request('/api/admin/session')); }
  catch (error) { if (error.status !== 401) throw error; }
});
