import { boothReadiness, prepareContactAssignments } from '../lib/arrangement-planner.mjs';

const ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/u;
const fields = ['code','organization','project','contactName','contactMethods','description','status'];
function node(tag, text) { const element = document.createElement(tag); if (text !== undefined) element.textContent = text; return element; }

export function createArrangementPlanner({ root, getContext, request, applyBooth, refreshArrangements, onBusy = () => {}, onDraftChange = () => {} }) {
  const $ = selector => root.querySelector(selector);
  const boothForm = $('[data-planner-booth]'), assignmentForm = $('[data-planner-assignment]');
  let selected = null, original = null, roster = null, intents = null, generation = 0, working = false, uncertain = false;
  let baseline = '', unapplied = false;
  function message(text, error = false) {
    $('[data-planner-error]').textContent = error ? text : ''; $('[data-planner-error]').hidden = !error;
    $('[data-planner-result]').textContent = error ? '' : text;
  }
  function configure() {
    const context = getContext();
    if (!context.allowed) { if (selected || roster || !root.hidden) clear(); return; }
    for (const control of root.querySelectorAll('input,textarea,select,button')) control.disabled = working || context.busy;
    $('[data-planner-save]').disabled = working || context.busy || context.dirty || uncertain || !roster || !assignmentForm.elements.namedItem('contactId').value;
    if (selected && selected.revision !== context.revision) {
      $('[data-planner-apply]').disabled = true; $('[data-planner-save]').disabled = true;
      message('内容版本已变化，请重新打开此位置，保留并核对尚未应用的编辑。', true);
    }
    $('[data-planner-refresh]').disabled = working || context.busy || context.dirty;
  }
  function clear() {
    const wasWorking = working;
    generation++; selected = null; original = null; roster = null; intents = null; working = false; uncertain = false; baseline = ''; unapplied = false;
    root.hidden = true; boothForm.reset(); assignmentForm.reset();
    for (const key of ['session-choices','booth-choices','readiness']) $('[data-planner-' + key + ']').replaceChildren();
    assignmentForm.elements.namedItem('contactId').replaceChildren(node('option', '请选择'));
    for (const key of ['title','note','person-state','preflight']) $('[data-planner-' + key + ']').textContent = '';
    message(''); if (wasWorking) onBusy(false); onDraftChange();
  }
  function selectedContact() { return roster?.contacts.find(contact => contact.id === assignmentForm.elements.namedItem('contactId').value); }
  function choices() {
    const context = getContext(), contact = selectedContact();
    for (const [kind, items] of [['session', context.content?.sessions ?? []],['booth', context.content?.booths ?? []]]) {
      const output = $('[data-planner-' + kind + '-choices]'); output.replaceChildren();
      for (const item of items.filter(item => item.status !== 'cancelled')) {
        const label = node('label'), box = node('input'); box.type = 'checkbox'; box.name = kind + 'Ids'; box.value = item.id;
        const target = selected?.type === kind && selected.id === item.id;
        box.checked = Boolean(contact?.operations[kind + 'Ids']?.includes(item.id)) || target;
        label.append(box, node('span', (kind === 'session' ? item.start + '–' + item.end + ' ' + item.title : item.code + ' · ' + (item.organization || '待确认机构')) + (target ? ' · 当前选择' : ''))); output.append(label);
      }
    }
    const reply = { pending: '待回复', attending: '已回复参加', declined: '已婉拒' }[contact?.operations.responseStatus] ?? '';
    const linked = intents?.conversions?.some(value => value.sourceContactId === contact?.id);
    $('[data-planner-person-state]').textContent = contact ? reply + ' · ' + (linked ? '已有工作人员代登记关联；保存时核对有效名额。' : '尚未关联代登记；这里仅作筹备安排，不确认报名。') : '';
    $('[data-planner-preflight]').textContent = '';
    configure();
  }
  async function loadPeople() {
    const context = getContext();
    if (!selected || !context.allowed || context.dirty || working) { if (context.dirty) message('请先保存内容草稿，再读取和保存人员安排。', true); return; }
    const current = ++generation; working = true; onBusy(true); configure();
    try {
      const [people, planning] = await Promise.all([request('/api/admin/contacts'), request('/api/admin/planning')]);
      const ledger = planning.features?.intentInvitations ? await request('/api/admin/intent-invitations') : null;
      if (current !== generation || !getContext().allowed) return;
      if (!Array.isArray(people.contacts) || !Number.isSafeInteger(people.revision)) throw new Error('名单格式无效。');
      roster = people; intents = ledger; uncertain = false;
      const select = assignmentForm.elements.namedItem('contactId'); select.replaceChildren();
      const placeholder = node('option', '请选择人员'); placeholder.value = ''; select.append(placeholder);
      for (const contact of people.contacts) {
        const option = node('option', contact.profile.displayName || contact.profile.name);
        option.value = contact.id; option.disabled = contact.profile.contactConsent === 'declined' || contact.operations.responseStatus === 'declined';
        if (option.disabled) option.textContent += ' · 已拒绝';
        if (contact.profile.organization) option.textContent += ' · ' + contact.profile.organization;
        select.append(option);
      }
      choices(); message('已读取名单；选择人员后核对全部分配，再明确保存。');
    } catch (error) { if (current === generation) { roster = null; intents = null; message(error.message || '名单未能读取。', true); } }
    finally { if (current === generation) { working = false; onBusy(false); configure(); } }
  }
  async function open(type, id, slotNumber = 0) {
    const context = getContext();
    if (!context.allowed || context.busy || !['booth','session'].includes(type) || id && !ID.test(id)) return;
    if (unapplied) { message('请先应用当前展位编辑，或明确关闭编辑面板后再切换。', true); return; }
    clear();
    const item = id ? context.content[type === 'booth' ? 'booths' : 'sessions'].find(entry => entry.id === id)
      : context.content.booths.find(entry => entry.slotNumber === slotNumber && entry.status !== 'cancelled');
    if (id && !item) return;
    selected = { type, id: item?.id ?? null, slotNumber: item?.slotNumber || slotNumber, revision: context.revision };
    original = item ? structuredClone(item) : null;
    root.hidden = false; boothForm.hidden = type !== 'booth'; $('[data-planner-people]').hidden = false;
    $('[data-planner-title]').textContent = type === 'booth' ? '直接调整第 ' + selected.slotNumber + ' 个展位' : '分配人员：' + item.title;
    $('[data-planner-note]').textContent = type === 'booth' ? '展位资料应用到当前内容草稿；负责人及联络方式不公开。保存草稿、发布仍分别操作。' : '使用当前已保存场次分配人员；不改变报名名额、实际回复或公开授权。';
    if (type === 'booth') {
      let code = item?.code || 'C-' + String(selected.slotNumber).padStart(2,'0');
      let suffix = 1; while (!item && context.content.booths.some(booth => booth.code === code)) code = 'C-' + String(selected.slotNumber).padStart(2,'0') + '-' + suffix++;
      for (const key of fields) boothForm.elements.namedItem(key).value = item?.[key] ?? (key === 'code' ? code : key === 'status' ? 'pending' : '');
      baseline = JSON.stringify(Object.fromEntries(new FormData(boothForm)));
      readiness();
    }
    configure(); root.scrollIntoView({ block: 'nearest', behavior: 'auto' });
    if (!context.dirty) await loadPeople(); else message('可继续编辑内容草稿；请先保存草稿，再配置人员。');
  }
  function readiness() {
    const output = $('[data-planner-readiness]'); output.replaceChildren();
    const value = Object.fromEntries(new FormData(boothForm));
    unapplied = JSON.stringify(value) !== baseline; onDraftChange();
    for (const warning of boothReadiness(value)) output.append(node('li', warning));
    output.hidden = !output.childElementCount;
  }
  boothForm.addEventListener('input', readiness);
  boothForm.addEventListener('submit', event => {
    event.preventDefault(); const context = getContext(); if (working || context.busy || !selected || !boothForm.reportValidity()) return;
    try {
      const result = applyBooth({ boothId: selected.id, slotNumber: selected.slotNumber, original, expectedRevision: selected.revision, changes: Object.fromEntries(new FormData(boothForm)) });
      selected.id = result.boothId; original = structuredClone(getContext().content.booths.find(booth => booth.id === result.boothId));
      baseline = JSON.stringify(Object.fromEntries(new FormData(boothForm))); unapplied = false; onDraftChange();
      message('已应用到内容草稿。可继续调整其他展位；保存草稿后再安排人员，发布后才更新公开页。'); configure();
    } catch (error) { message(error.message || '展位资料未应用。', true); }
  });
  assignmentForm.addEventListener('change', () => {
    const contact = selectedContact();
    if (!contact) return;
    try {
      prepareContactAssignments(contact, { sessionIds: [...new FormData(assignmentForm).getAll('sessionIds')], boothIds: [...new FormData(assignmentForm).getAll('boothIds')] }, getContext().content);
      $('[data-planner-preflight]').textContent = '本页核对通过；保存时仍由后台检查最新修订与冲突。';
    } catch (error) { $('[data-planner-preflight]').textContent = error.message; }
  });
  assignmentForm.elements.namedItem('contactId').addEventListener('change', choices);
  assignmentForm.addEventListener('submit', async event => {
    event.preventDefault(); const context = getContext(), contact = selectedContact();
    if (working || context.busy || context.dirty || uncertain || !roster || !contact || !selected || selected.revision !== context.revision) return;
    let operations;
    try { operations = prepareContactAssignments(contact, { sessionIds: [...new FormData(assignmentForm).getAll('sessionIds')], boothIds: [...new FormData(assignmentForm).getAll('boothIds')] }, context.content); }
    catch (error) { message(error.message, true); return; }
    const current = generation; let committed = false; working = true; onBusy(true); configure();
    try {
      const latest = await request('/api/admin/content');
      if (current !== generation || !getContext().allowed) return;
      if (latest.draft?.revision !== selected.revision) throw new Error('内容已由其他工作人员更新，请重新载入内容后再安排。');
      const linked = intents?.conversions?.some(value => value.sourceContactId === contact.id);
      const path = '/api/admin/contacts/' + encodeURIComponent(contact.id) + (linked ? '/assignments' : '');
      const body = linked ? { expectedContactRevision: roster.revision, sessionIds: operations.sessionIds, boothIds: operations.boothIds }
        : { expectedRevision: roster.revision, operations };
      // No automatic retry: if the commit acknowledgement is lost the next action is a read.
      uncertain = true;
      await request(path, { method: linked ? 'POST' : 'PUT', body: JSON.stringify(body) });
      committed = true;
      if (current !== generation || !getContext().allowed) return;
      await refreshArrangements();
      const latestRoster = await request('/api/admin/contacts');
      if (current !== generation || !getContext().allowed) return;
      if (!Array.isArray(latestRoster.contacts) || !Number.isSafeInteger(latestRoster.revision)) throw new Error('安排已保存，但最新名单未能读取；请重新读取核对。');
      roster = latestRoster; uncertain = false; choices(); message('人员安排已保存；没有自动修改出席回复或发布个人资料。');
    } catch (error) { if (current === generation) message((committed ? '安排已保存，后续刷新未完成。' : '') + (error.message || '保存结果未能确认。') + (uncertain ? ' 请先重新读取名单核对，不要重复保存。' : ''), true); }
    finally { if (current === generation) { working = false; onBusy(false); configure(); } }
  });
  $('[data-planner-close]').addEventListener('click', clear);
  $('[data-planner-refresh]').addEventListener('click', () => loadPeople());
  clear();
  return { open, configure, clear, hasUnapplied: () => unapplied };
}
