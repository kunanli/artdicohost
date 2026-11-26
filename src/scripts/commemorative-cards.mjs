import { cardCommunityLabel, cardJammerOption, WALLET_IDENTITIES, formatCardCollectorNumber, MAX_CARD_MANUAL_SEQUENCE } from '../../shared/general-application.mjs';
import { canManageEventOperations } from '../../shared/staff-permissions.mjs';
import { renderCommemorativeJpeg } from '../lib/commemorative-card-image.mjs';

const root = document.querySelector('[data-card-admin]');
const $ = selector => root.querySelector(selector);
const api = '/api/admin/registration-confirmation/cards';
const idPattern = /^[A-Za-z0-9_-]{43}$/u;
const proofPattern = /^[a-f0-9]{64}$/u;
const draftId = () => /^#application=([A-Za-z0-9_-]{43})$/u.exec(location.hash)?.[1] ?? '';
const stages = {
  check_delivery: '寄送待核对', pending_review: '核对活动行报名', set_identity: '设置卡面身份',
  retry_delivery: '可重新寄送', send: '待寄送', blocked: '暂不可寄送',
  submitted: '邮件服务已接收', waitlisted: '候补中', rejected: '申请未通过', withdrawn: '领取资格已取消',
};
const queueOrder = Object.keys(stages);
const todo = new Set(queueOrder.slice(0, 6));
const personReasons = new Set(['EMAIL_MISSING', 'CONTACT_EMAIL_CHANGED', 'CONTACT_CONSENT_REQUIRED', 'CONTACT_DECLINED', 'CONTACT_NOT_FOUND', 'STAFF_PERMISSION_REQUIRED']);
const sentTime = new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Taipei', dateStyle: 'medium', timeStyle: 'short', hourCycle: 'h23' });
const reasons = {
  PERMISSION_REQUIRED: '请由有寄送权限的工作人员发卡。',
  EMAIL_MISSING: '请在人员资料中补齐收件邮箱。',
  CONTACT_EMAIL_CHANGED: '联系人邮箱已变更，请先核对当前收件地址。',
  CONTACT_CONSENT_REQUIRED: '请先核实当前收件人的联络许可。',
  CONTACT_DECLINED: '收件人已婉拒或取消联络。',
  CONTACT_NOT_FOUND: '请先核对关联的人员资料。',
  STAFF_PERMISSION_REQUIRED: '请先核对代登记对象的寄送许可。',
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
const jammer = $('[data-ggj-jammer]');
const organization = $('#card-organization');
const phone = $('#card-phone');
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
const previewButton = $('[data-card-preview-open]');
const previewPanel = $('[data-card-preview-panel]');
const previewImage = $('[data-card-preview-image]');
const collectorForm = $('[data-card-collector-form]');
const collectorEdit = $('[data-card-collector-edit]');
const collectorSave = $('[data-card-collector-save]');
const collectorClear = $('[data-card-collector-clear]');
const manualSequence = $('#card-collector-sequence');
const savedFields = { identity, site: communitySite, role: communityRole, organization, phone, manualSequence };

let csrf = '', rows = [], filter = 'todo', activeId = '', current = null, busy = false, editingIdentity = false, version = 0;
let pendingTest = null, baseFields = null, reviewedProof = '', staleView = false, contextChanged = false, editingCollector = false;
const pendingApprovals = new Map();
const pendingDeliveries = new Map();
const rowFor = id => rows.find(row => row.sources.some(source => source.id === id));
const normalize = value => value.normalize('NFC').trim();
const searchable = value => value.normalize('NFKC').trim().toLocaleLowerCase();
const compactSerial = value => searchable(value).replace(/\s+/gu, '');

function parseManualSequence(input) {
  const value = input.normalize('NFKC').trim();
  if (!value) return null;
  if (!/^[0-9]{1,6}$/u.test(value)) return undefined;
  const number = Number(value);
  return number >= 1 && number <= MAX_CARD_MANUAL_SEQUENCE ? number : undefined;
}
function comparableField(key, value) {
  if (key !== 'manualSequence') return normalize(value);
  const sequence = parseManualSequence(value);
  return sequence === undefined ? value : String(sequence ?? '');
}
function matchesCollector(query, number) {
  const formatted = formatCardCollectorNumber(number);
  if (!query || !formatted) return false;
  const serialQuery = compactSerial(query);
  return /^[0-9]+$/u.test(serialQuery) && Number(serialQuery) === number.sequence
    || [formatted.short, formatted.full, formatted.full.split('-').at(-1)].some(serial => compactSerial(serial) === serialQuery);
}

function draftChanges() {
  if (!baseFields) return {};
  return Object.fromEntries(Object.entries(savedFields).filter(([key, input]) => comparableField(key, input.value) !== baseFields[key])
    .map(([key, input]) => [key, input.value]));
}
function hasDraft() { return Object.keys(draftChanges()).length > 0; }
function sameCard(left, right) { return left?.primaryId === right?.primaryId && left?.recipient === right?.recipient; }
function clearPreview() {
  reviewedProof = '';
  previewPanel.hidden = true;
  previewImage.removeAttribute('src');
  previewButton.setAttribute('aria-expanded', 'false');
  previewButton.textContent = '预览已保存卡面';
}
function editChanged() {
  if (hasDraft() && reviewedProof) clearPreview();
  renderActions();
}
for (const input of Object.values(savedFields)) input.addEventListener('input', editChanged);
function leaveDraft(nextId) {
  return nextId === current?.registrationId || !hasDraft() || window.confirm('当前卡面有未保存的修改。放弃修改并离开？');
}
function resetDraft() {
  if (!baseFields) return;
  for (const [key, input] of Object.entries(savedFields)) input.value = baseFields[key];
  editingIdentity = false;
  editingCollector = false;
  contextChanged = false;
  syncJammer();
  renderActions();
}
function deliveryAdvanced(before, after) {
  if (!sameCard(before, after) || !/^c_[a-f0-9]{64}$/u.test(after.deliveryReceiptId ?? '') || !Number.isSafeInteger(after.deliveryAttempt)) return false;
  return after.deliveryReceiptId !== before.deliveryReceiptId || after.deliveryAttempt > before.deliveryAttempt
    || before.status === 'unknown' && after.status !== 'unknown';
}

function syncJammer() {
  const option = cardJammerOption(communityRole.value);
  jammer.checked = option.selected;
  jammer.disabled = communityRole.disabled || !option.canToggle;
}
communityRole.addEventListener('input', syncJammer);
jammer.addEventListener('change', () => {
  communityRole.value = cardJammerOption(communityRole.value).toggleValue;
  syncJammer();
  editChanged();
});

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
  if (!reply.ok) throw Object.assign(new Error(value.error?.message || '暂时无法核对，请稍后重试。'), { status: reply.status, code: value.error?.code });
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
  pendingDeliveries.clear();
  pendingTest = null;
  staleView = false;
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
  const query = searchable(search.value);
  const counts = { all: 0, todo: 0, submitted: 0, test: 0 };
  for (const row of rows) {
    if (row.test) { counts.test++; continue; }
    counts.all++;
    if (todo.has(row.stage)) counts.todo++;
    if (row.stage === 'submitted') counts.submitted++;
  }
  for (const button of filters) {
    const key = button.dataset.cardFilter;
    button.setAttribute('aria-pressed', String(filter === key));
    button.querySelector('span').textContent = String(counts[key]);
    if (key === 'test') button.hidden = !counts.test && add.hidden;
  }
  const visible = [];
  for (const row of rows) {
    if (Boolean(row.test) !== (filter === 'test')) continue;
    if (!query && (filter === 'todo' && !todo.has(row.stage) || filter === 'submitted' && row.stage !== 'submitted')) continue;
    const match = query && (row.sources.find(source => searchable(source.bookingReference) === query)
      ?? row.sources.find(source => searchable(source.bookingReference).includes(query))
      ?? row.sources.find(source => searchable(source.name).includes(query)));
    if (query && !match && !searchable(row.name).includes(query) && !matchesCollector(query, row.collectorNumber)) continue;
    visible.push({ row, match });
  }
  visible.sort(({ row: left }, { row: right }) => {
      const stageDifference = queueOrder.indexOf(left.stage) - queueOrder.indexOf(right.stage);
      if (stageDifference) return stageDifference;
      if (left.stage === 'submitted') return (right.sentAt ?? right.submittedAt).localeCompare(left.sentAt ?? left.submittedAt) || left.id.localeCompare(right.id);
      return left.submittedAt.localeCompare(right.submittedAt) || left.id.localeCompare(right.id);
  });
  const empty = $('[data-card-empty]');
  empty.hidden = visible.length > 0;
  empty.textContent = query ? '没有匹配的纪念卡申请。' : filter === 'test' ? '目前没有测试卡。'
    : filter === 'todo' ? '目前没有待处理的申请。' : filter === 'submitted' ? '目前没有已提交的纪念卡。' : '目前没有纪念卡申请。';
  const focused = document.activeElement?.dataset.application;
  const selected = rowFor(activeId);
  list.replaceChildren(...visible.map(({ row, match }) => {
    const li = document.createElement('li');
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.application = match?.id ?? (selected === row ? activeId : row.id);
    button.dataset.stage = row.stage;
    button.setAttribute('aria-pressed', String(selected === row));
    const name = document.createElement('strong'), reference = document.createElement('span');
    name.textContent = row.name;
    reference.className = 'card-muted';
    reference.textContent = match && match.bookingReference !== row.bookingReference ? '匹配编号：' + match.bookingReference : row.bookingReference;
    const collector = formatCardCollectorNumber(row.collectorNumber);
    if (collector) {
      const serial = document.createElement('span');
      serial.dataset.cardCollectorReference = '';
      serial.textContent = collector.short;
      serial.title = collector.full;
      reference.append(' · ', serial);
    }
    button.append(name, reference);
    if (stages[row.stage]) {
      const status = document.createElement('small');
      status.textContent = stages[row.stage];
      button.append(status);
    }
    li.append(button);
    return li;
  }));
  if (focused) [...list.querySelectorAll('[data-application]')].find(button => button.dataset.application === focused)?.focus({ preventScroll: true });
}
function setView(value) {
  const stayOnApplication = current?.registrationId === value?.registrationId;
  const draft = stayOnApplication ? draftChanges() : {};
  contextChanged = stayOnApplication && Object.keys(draft).length > 0 && (contextChanged || !sameCard(current, value));
  editingIdentity = stayOnApplication && editingIdentity;
  editingCollector = stayOnApplication && editingCollector;
  if (!stayOnApplication || contextChanged || reviewedProof !== value?.previewProof) clearPreview();
  current = value;
  detail.hidden = !value;
  placeholder.hidden = Boolean(value);
  if (!value) {
    for (const selector of ['[data-card-name]', '[data-card-recipient]', '[data-card-reference]', '[data-card-state]', '[data-card-sent-at]', '[data-card-identity-value] span']) $(selector).textContent = '';
    $('[data-card-linked] ul').replaceChildren();
    $('[data-card-correct-email]').removeAttribute('href');
    identity.value = '';
    manualSequence.value = '';
    communityDetails.open = false;
    communityForm.reset();
    baseFields = null;
    syncJammer();
    return;
  }
  heading.textContent = value.name;
  $('[data-card-reference-label]').textContent = value.test ? '类型' : '当前活动行编号';
  const linked = $('[data-card-linked]');
  const otherReferences = (rowFor(value.registrationId)?.sources ?? []).filter(source => source.id !== value.registrationId);
  linked.hidden = otherReferences.length === 0;
  if (!stayOnApplication) linked.open = false;
  linked.querySelector('ul').replaceChildren(...otherReferences.map(source => {
    const item = document.createElement('li');
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'ah-admin-text-button';
    button.textContent = source.bookingReference;
    button.addEventListener('click', () => { if (!busy && leaveDraft(source.id)) void work(() => open(source.id, true), true); });
    item.append(button);
    return item;
  }));
  $('[data-card-reference]').textContent = value.bookingReference;
  $('[data-card-recipient]').textContent = value.recipient || '未填写';
  renderCollector(value);
  const preferences = value.applicationPreferences ?? {};
  const requestedIdentity = WALLET_IDENTITIES.find(option => option.value === preferences.requestedWalletIdentity);
  identity.value = value.identity || requestedIdentity?.value || '';
  const requestedIdentityText = $('[data-card-requested-identity]');
  requestedIdentityText.hidden = !requestedIdentity;
  requestedIdentityText.textContent = requestedIdentity ? '申请人所选身份：' + requestedIdentity.label : '';
  if (!stayOnApplication) communityDetails.open = false;
  communityDetails.hidden = value.admissionStatus !== 'confirmed' || !Number.isSafeInteger(value.communityRevision);
  const suggestedCommunity = { site: preferences.ggjSite ?? '', role: preferences.ggjRole ?? '' };
  const community = cardCommunityLabel(value.cardCommunity);
  const communityInput = value.cardCommunitySaved || community ? value.cardCommunity : suggestedCommunity;
  communitySite.value = communityInput?.site ?? '';
  communityRole.value = communityInput?.role ?? '';
  syncJammer();
  const profile = value.cardProfile ?? value.suggestedCardProfile;
  organization.value = profile?.organization ?? '';
  phone.value = profile?.phone ?? '';
  const proposed = cardCommunityLabel(suggestedCommunity), proposalText = $('[data-card-requested-community]');
  proposalText.hidden = !proposed;
  proposalText.textContent = proposed ? '申请人填写：' + proposed : '';
  const saved = [community, value.cardProfile?.organization].filter(Boolean).join(' · ');
  const pending = proposed && !value.cardCommunitySaved && !community || !value.cardProfile && (profile?.organization || profile?.phone);
  $('[data-card-community-summary]').textContent = '纪念卡补充资料' + (saved ? ' · ' + saved : '') + (pending ? '（待保存）' : '');
  baseFields = Object.fromEntries(Object.entries(savedFields).map(([key, input]) => [key, comparableField(key, input.value)]));
  for (const [key, input] of Object.entries(draft)) if (comparableField(key, input) !== baseFields[key]) savedFields[key].value = input;
  syncJammer();
  renderActions();
}

function renderCollector(value) {
  const collector = value.collector;
  const show = Number.isSafeInteger(collector?.revision);
  const serial = formatCardCollectorNumber(collector?.number);
  const firstClaim = $('[data-card-collector-claim]');
  const time = Date.parse(collector?.claimedAt ?? '');
  const order = collector?.sequence;
  const claimed = Number.isFinite(time) && Number.isSafeInteger(order) && order > 0;
  $('[data-card-collector-summary]').hidden = $('[data-card-collector-number-label]').hidden = !show;
  $('[data-card-collector-number]').textContent = serial?.full ?? '尚未生成';
  firstClaim.hidden = $('[data-card-collector-claim-label]').hidden = !show;
  firstClaim.textContent = claimed ? (value.test ? 'TEST · ' : '') + '第 ' + order + ' 位 · ' + sentTime.format(time) + '（UTC+8）' : '尚未领取';
  manualSequence.value = String(collector?.manualSequence ?? '');
}
function renderActions() {
  const value = current;
  if (!value) return;
  const verified = value.admissionStatus === 'confirmed';
  const sent = value.stage === 'submitted', uncertain = value.stage === 'check_delivery';
  const unconfirmed = pendingDeliveries.has(value.primaryId);
  const needCheck = uncertain || unconfirmed || value.sendInProgress;
  const resend = value.canResend === true;
  const canSend = value.stage === 'send' || value.stage === 'retry_delivery' || resend;
  const dirty = hasDraft();
  const canPreview = verified && value.preview && proofPattern.test(value.previewProof ?? '');
  const previewReviewed = canPreview && reviewedProof === value.previewProof;
  const reason = value.reason && (reasons[value.reason] ?? '收件权限暂无法核对。');
  const pending = pendingApprovals.has(value.registrationId);
  const identityValue = $('[data-card-identity-value]');
  identityValue.hidden = $('[data-card-identity-label]').hidden = !value.identity || !verified;
  identityValue.querySelector('span').textContent = WALLET_IDENTITIES.find(option => option.value === value.identity)?.label ?? '';
  $('[data-card-edit]').hidden = value.test || !verified || value.sendInProgress || editingIdentity;
  const state = $('[data-card-state]');
  state.dataset.stage = value.stage;
  state.textContent = staleView ? '申请资料暂未核对，请刷新后继续。' : value.sendInProgress ? '纪念卡正在发送。'
    : needCheck ? '本次寄送待核对。重寄可能产生重复邮件。'
    : sent ? '邮件服务已接收'
    : reason || (value.stage === 'retry_delivery' ? '发送失败，可再次寄送。' : stages[value.stage]);
  const submittedAt = $('[data-card-sent-at]');
  submittedAt.hidden = !sent || needCheck || !value.sentAt;
  submittedAt.textContent = submittedAt.hidden ? '' : '提交时间 ' + sentTime.format(new Date(value.sentAt));
  const correction = $('[data-card-correct-email]');
  correction.hidden = !personReasons.has(value.reason);
  if (!correction.hidden) correction.href = '/admin/person/#registration=' + encodeURIComponent(value.primaryId);
  else correction.removeAttribute('href');
  $('[data-card-verification]').hidden = value.stage !== 'pending_review';
  const approval = pendingApprovals.get(value.registrationId);
  approve.textContent = !pending ? '通过纪念卡申请' : approval.checked ? '重试同一审核' : '核对审核结果';
  approve.disabled = busy || staleView;
  identityForm.hidden = !verified || value.sendInProgress || Boolean(value.identity && !editingIdentity);
  identityForm.querySelector('[type="submit"]').disabled = busy || staleView || contextChanged;
  communityForm.querySelector('[type="submit"]').disabled = busy || staleView || contextChanged;
  $('[data-card-cancel-identity]').hidden = !value.identity || !editingIdentity;
  const canEditCollector = value.canEditCollector === true && Number.isSafeInteger(value.collector?.revision);
  collectorEdit.hidden = !canEditCollector || editingCollector;
  collectorEdit.textContent = value.collector?.manualSequence == null ? '设置序号' : '修改序号';
  collectorEdit.setAttribute('aria-expanded', String(canEditCollector && editingCollector));
  collectorEdit.disabled = busy || staleView || contextChanged;
  collectorForm.hidden = !canEditCollector || !editingCollector;
  collectorSave.disabled = busy || staleView || contextChanged || comparableField('manualSequence', manualSequence.value) === baseFields?.manualSequence;
  collectorClear.hidden = !manualSequence.value.trim();
  const draftStatus = $('[data-card-draft-status]');
  draftStatus.hidden = !dirty;
  draftStatus.textContent = contextChanged ? '主记录或收件人已变更。请核对当前资料后放弃旧修改。' : '有未保存的卡面修改。';
  $('[data-card-discard-draft]').hidden = !dirty;
  $('[data-card-preview]').hidden = !verified || !value.identity;
  previewButton.disabled = busy || !canPreview || dirty || staleView;
  deliveryForm.hidden = !canSend || editingIdentity;
  const dispatch = deliveryForm.querySelector('[type="submit"]');
  dispatch.textContent = resend || needCheck || value.stage === 'retry_delivery' ? '重新发送纪念卡' : '发送纪念卡';
  dispatch.classList.toggle('ah-admin-primary', !needCheck && !sent);
  dispatch.disabled = busy || dirty || staleView || !previewReviewed || value.sendInProgress;
  const sendHint = $('[data-card-send-hint]');
  sendHint.textContent = !canPreview ? '暂时无法核对已保存卡面，请刷新后再试。'
    : dirty ? '请先保存卡面修改。' : !previewReviewed ? '请先预览已保存卡面，再寄送给上方收件人。' : '';
  sendHint.hidden = !sendHint.textContent;
  const formats = $('[data-card-delivery-formats]');
  formats.hidden = uncertain;
  formats.textContent = value.walletReady
    ? '一封邮件可领取 JPEG 和 Apple Wallet。' : '可先寄送 JPEG。Apple Wallet 就绪后可用同一链接领取。';
  const deliveryBlock = $('[data-card-delivery-block]');
  deliveryBlock.hidden = !(uncertain || sent) || !reason || value.reason === 'EMAIL_MISSING';
  deliveryBlock.textContent = deliveryBlock.hidden ? '' : reason;
  check.hidden = !needCheck;
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
    syncJammer();
    renderActions();
    root.removeAttribute('aria-busy');
    if (nearApplication && document.activeElement === document.body && !detail.hidden && detail.contains(focused)) {
      (focused.getClientRects().length ? focused : heading).focus({ preventScroll: true });
    }
  }
}
async function open(id, focus = false) {
  if (!idPattern.test(id)) return;
  const readVersion = version;
  placeholder.textContent = '正在核对这份申请…';
  let value;
  try {
    value = await request(api + '/' + id);
    if (value.registrationId !== id || !idPattern.test(value.primaryId)) throw new Error('申请资料无法核对。');
  } catch (error) {
    if (version === readVersion) {
      if (current?.registrationId === id) { staleView = true; clearPreview(); renderActions(); }
      placeholder.textContent = '暂时无法读取这份申请。';
    }
    throw error;
  }
  if (version !== readVersion) return null;
  if (id !== activeId) message.textContent = '';
  activeId = id;
  staleView = false;
  const selected = rowFor(id);
  if (selected) Object.assign(selected, { name: value.name, status: value.status, stage: value.stage, format: value.format,
    sentAt: value.sentAt, collectorNumber: value.collector?.number ?? null });
  if (value.admissionStatus === 'confirmed') pendingApprovals.delete(id);
  setView(value);
  const receipt = pendingDeliveries.get(value.primaryId);
  if (receipt && deliveryAdvanced(receipt, value) && ['provider_accepted', 'rejected'].includes(value.status)) {
    pendingDeliveries.delete(value.primaryId);
    renderActions();
  }
  renderList();
  rememberApplication(id);
  if (focus) heading.focus();
  return value;
}
async function refresh() {
  const readVersion = version;
  const value = await request(api);
  if (version !== readVersion) return;
  rows = value.applications;
  const id = activeId || draftId(), selected = rowFor(id);
  if (selected?.test) filter = 'test';
  else if (!activeId && selected && !todo.has(selected.stage)) filter = selected.stage === 'submitted' ? 'submitted' : 'all';
  renderList();
  if (selected) await open(id);
  else {
    if (current && hasDraft()) {
      staleView = true;
      clearPreview();
      renderActions();
      throw new Error('这份申请已不在当前名单。未保存的修改仍留在这里。');
    }
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
  if (busy || !leaveDraft('')) return;
  await work(async () => { await request('/api/admin/logout', 'POST'); clear(); rememberApplication(''); });
});
list.addEventListener('click', event => {
  const button = event.target.closest('[data-application]');
  if (button && !busy && leaveDraft(button.dataset.application)) void work(() => open(button.dataset.application, true), true);
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
  if (!leaveDraft('')) return;
  const fields = Object.fromEntries(new FormData(createForm));
  void work(async () => {
    const key = JSON.stringify(fields);
    if (pendingTest?.key !== key) pendingTest = { key, operationId: crypto.randomUUID() };
    const { registrationId } = await request(api, 'POST', { ...fields, operationId: pendingTest.operationId });
    if (!idPattern.test(registrationId ?? '')) throw new Error('暂时无法核对这张测试卡。');
    filter = 'test';
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
  if (busy || !view?.canRemove) return;
  const references = [...new Set((rowFor(view.registrationId)?.sources ?? []).map(source => source.bookingReference))];
  const scope = view.test || !references.length ? '' : ' 关联活动行编号：' + references.join('、') + '。';
  const unsaved = hasDraft() ? '未保存的卡面修改也将放弃。' : '';
  if (!window.confirm('移除「' + view.name + '」的纪念卡？线上领取链接将失效。' + scope + unsaved)) return;
  resetDraft();
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
check.addEventListener('click', () => work(async () => {
  const result = await open(activeId);
  if (!result) return;
  message.textContent = result.sendInProgress ? '寄送仍在处理中，可稍后核对。'
    : pendingDeliveries.has(result.primaryId) || result.status === 'unknown' ? '目前尚无这次寄送的明确回执。'
    : result.status === 'provider_accepted' ? '已核对记录：邮件服务已接收。'
    : result.status === 'rejected' ? '已核对记录：本次邮件发送失败。' : '目前未有寄送记录。';
}, true));
$('[data-card-edit]').addEventListener('click', () => { editingIdentity = true; renderActions(); identity.focus(); });
$('[data-card-cancel-identity]').addEventListener('click', () => {
  identity.value = baseFields.identity;
  editingIdentity = false;
  editChanged();
  $('[data-card-edit]').focus();
});
collectorEdit.addEventListener('click', () => {
  editingCollector = true;
  renderActions();
  manualSequence.focus();
});
collectorClear.addEventListener('click', () => {
  manualSequence.value = '';
  editChanged();
  manualSequence.focus();
});
$('[data-card-collector-cancel]').addEventListener('click', () => {
  manualSequence.value = baseFields.manualSequence;
  editingCollector = false;
  editChanged();
  collectorEdit.focus();
});
$('[data-card-discard-draft]').addEventListener('click', () => {
  if (window.confirm('放弃这份纪念卡未保存的修改？')) resetDraft();
});
window.addEventListener('beforeunload', event => {
  if (!hasDraft()) return;
  event.preventDefault();
  event.returnValue = '';
});

async function previewSavedCard() {
  const view = current, started = version;
  if (!view?.preview || !proofPattern.test(view.previewProof ?? '') || hasDraft() || staleView) return;
  if (!previewPanel.hidden && reviewedProof === view.previewProof) {
    previewPanel.hidden = true;
    previewButton.setAttribute('aria-expanded', 'false');
    previewButton.textContent = '预览已保存卡面';
    return;
  }
  const jpeg = await renderCommemorativeJpeg(view.preview);
  // A local data URL works with the staff pages’ restrictive image policy.
  const src = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('暂时无法显示已保存的卡面。'));
    reader.readAsDataURL(jpeg);
  });
  if (started !== version || current !== view || hasDraft()) return;
  previewImage.src = String(src);
  previewPanel.hidden = false;
  previewButton.setAttribute('aria-expanded', 'true');
  previewButton.textContent = '收起卡面预览';
  reviewedProof = view.previewProof;
}
previewButton.addEventListener('click', () => work(previewSavedCard, true));

approve.addEventListener('click', () => work(async () => {
  const view = current, started = version;
  if (!view || staleView) return;
  const id = view.registrationId;
  let pending = pendingApprovals.get(id);
  if (pending && !pending.checked) {
    const fresh = await open(id);
    if (!fresh) return;
    if (fresh.admissionStatus === 'confirmed') message.textContent = '已核对：这份纪念卡可以领取。';
    else if (fresh.stage === 'pending_review' && fresh.primaryId === pending.body.primaryId) {
      pending.checked = true;
      message.textContent = '尚未读到审核回执。可重试同一审核。';
    } else pendingApprovals.delete(id);
    return;
  }
  pending ??= { body: { primaryId: view.primaryId, expectedRevision: view.admissionRevision, operationId: crypto.randomUUID() }, checked: false };
  pendingApprovals.set(id, pending);
  pending.checked = false;
  let failure;
  try { await request(api + '/' + id + '/approve', 'POST', pending.body); }
  catch (error) {
    if (started !== version) return;
    failure = error;
    if (error.status && error.status < 500) pendingApprovals.delete(id);
  }
  if (started !== version) return;
  const fresh = await open(id);
  if (fresh?.admissionStatus === 'confirmed' && fresh.primaryId === view.primaryId) {
    message.textContent = '纪念卡申请已通过。';
  } else if (failure) throw failure;
  else message.textContent = '审核已提交，结果待核对。';
}, true));

async function saveCardFields(view, body, matches, announcement) {
  const started = version;
  let failure;
  try { await request(api + '/' + view.registrationId, 'PATCH', body); }
  catch (error) { failure = error; }
  if (started !== version) return;
  let fresh;
  try { fresh = await open(view.registrationId); }
  catch (error) {
    if (started === version) throw failure ?? new Error('修改已提交，暂时无法核对。请刷新这份申请。');
    return;
  }
  if (!fresh) return;
  if (!sameCard(view, fresh) || !matches(fresh)) {
    throw new Error((failure?.message ?? '保存结果待核对。') + (hasDraft() ? ' 未保存的修改仍保留。' : ''));
  }
  announcement();
  clearPreview();
}
identityForm.addEventListener('submit', event => {
  event.preventDefault();
  void work(async () => {
    const view = current;
    if (!view || !identity.value || staleView || contextChanged) return;
    const selected = identity.value;
    await saveCardFields(view, { primaryId: view.primaryId, expectedRevision: view.reviewRevision, identity: selected },
      fresh => fresh.identity === selected, () => { editingIdentity = false; message.textContent = '卡面身份已保存。'; });
  }, true);
});
communityForm.addEventListener('submit', event => {
  event.preventDefault();
  void work(async () => {
    const view = current;
    if (!view || view.admissionStatus !== 'confirmed' || !Number.isSafeInteger(view.communityRevision) || staleView || contextChanged) return;
    const cardCommunity = { site: normalize(communitySite.value), role: normalize(communityRole.value) };
    const cardProfile = { organization: normalize(organization.value), phone: normalize(phone.value) };
    await saveCardFields(view, { primaryId: view.primaryId, expectedCommunityRevision: view.communityRevision, cardCommunity, cardProfile },
      fresh => fresh.cardCommunitySaved && Object.entries(cardCommunity).every(([key, value]) => fresh.cardCommunity?.[key] === value)
        && Object.entries(cardProfile).every(([key, value]) => fresh.cardProfile?.[key] === value),
      () => { message.textContent = '纪念卡资料已保存。'; });
  }, true);
});
collectorForm.addEventListener('submit', event => {
  event.preventDefault();
  void work(async () => {
    const view = current;
    if (!view?.canEditCollector || !Number.isSafeInteger(view.collector?.revision) || staleView || contextChanged) return;
    const sequence = parseManualSequence(manualSequence.value);
    if (sequence === undefined) throw new Error('请输入 1–999999 的整数，或留空清除手动序号。');
    if (sequence === view.collector.manualSequence) return;
    await saveCardFields(view, { primaryId: view.primaryId, expectedCollectorRevision: view.collector.revision, manualSequence: sequence },
      fresh => fresh.collector?.manualSequence === sequence, () => {
        editingCollector = false;
        message.textContent = sequence === null ? '手动序号已清除。' : '收藏序号已保存。';
      });
  }, true);
});
deliveryForm.addEventListener('submit', event => {
  event.preventDefault();
  const view = current;
  if (busy || !view || staleView || hasDraft() || !proofPattern.test(view.previewProof ?? '') || reviewedProof !== view.previewProof
    || !['send', 'retry_delivery'].includes(view.stage) && !view.canResend) return;
  const repeat = view.canResend || view.stage === 'retry_delivery' || pendingDeliveries.has(view.primaryId);
  if (repeat && !window.confirm('重新发送纪念卡给 ' + view.recipient + '？收件人可能会收到另一封邮件。')) return;
  void work(async () => {
    const started = version;
    message.textContent = '正在发送…';
    let receipt, failure;
    const { primaryId, recipient, status, deliveryReceiptId, deliveryAttempt } = view;
    pendingDeliveries.set(primaryId, { primaryId, recipient, status, deliveryReceiptId, deliveryAttempt });
    try {
      receipt = await request(api + '/' + view.registrationId, 'POST', {
        primaryId: view.primaryId, expectedRevision: view.deliveryRevision, expectedAccessRevision: view.accessRevision,
        expectedPreviewProof: view.previewProof, identity: view.identity, format: 'jpeg', ...(view.canResend ? { resend: true } : {}),
      });
    } catch (error) {
      if (started !== version) return;
      failure = error;
      clearPreview();
      if (error.status && error.status < 500) pendingDeliveries.delete(view.primaryId);
    }
    if (started !== version) return;
    let fresh;
    try { fresh = await open(view.registrationId); }
    catch (error) {
      if (started !== version) return;
      if (receipt?.status === 'provider_accepted') message.textContent = '邮件服务已接收。请刷新申请以核对最新状态。';
      else if (pendingDeliveries.has(view.primaryId)) message.textContent = '寄送结果待核对，请先使用「核对寄送结果」。';
      else throw failure ?? error;
      return;
    }
    if (!fresh) return;
    const advanced = deliveryAdvanced(view, fresh);
    if (receipt?.status === 'provider_accepted' || advanced && fresh.status === 'provider_accepted') {
      pendingDeliveries.delete(view.primaryId);
      if (!view.test && filter === 'todo' && fresh.stage === 'submitted') { filter = 'submitted'; renderList(); }
      message.textContent = repeat ? '已重新提交纪念卡邮件。' : '邮件服务已接收。';
    } else if (receipt?.status === 'rejected' || advanced && fresh.status === 'rejected') {
      pendingDeliveries.delete(view.primaryId);
      message.textContent = '本次邮件未能发送。';
    } else if (failure && !pendingDeliveries.has(view.primaryId)) throw failure;
    else if (failure || receipt?.status === 'unknown') message.textContent = '寄送结果待核对，请先使用「核对寄送结果」。';
    else {
      pendingDeliveries.delete(view.primaryId);
      message.textContent = '这次未能发送，请查看当前状态。';
    }
  }, true);
});

login.querySelector('[type="submit"]').disabled = false;
void work(async () => {
  try { await start(await request('/api/admin/session')); }
  catch (error) { if (error.status !== 401) throw error; }
});
