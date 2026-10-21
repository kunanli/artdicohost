import { SESSION_ROLE_LABELS } from '../../shared/contacts-schema.mjs';
import { sessionTimeline } from '../lib/arrangement-planner.mjs';

const formats = { talk: '演讲', workshop: '工作坊', roundtable: '圆桌', showcase: '作品分享', social: '交流活动', break: '休息 / 签到', other: '待分类 / 其他' };
const replies = { pending: '待回复', attending: '确认参加', declined: '不参加' };
const forms = { guest: '嘉宾', speaker: '讲者', panelist: '圆桌嘉宾', host: '主持', organizer:'研讨会组织者', booth: '展位', student_showcase: '学生展示', attendee: '参会' };
const stableId = /^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/u;
function node(tag, text, className) {
  const element = document.createElement(tag);
  if (text !== undefined) element.textContent = text;
  if (className) element.className = className;
  return element;
}
function list(value) { return Array.isArray(value) ? value : []; }
function count(value) { return Number.isSafeInteger(value) && value >= 0 ? value : 0; }

/** A private, saved-only projection. Never derives arrangements from local draft edits. */
export function createArrangementsView({ root, load, edit, plan = edit }) {
  const $ = selector => root.querySelector(selector);
  let snapshot = null;
  let allowed = false;
  let locked = true;
  let dirty = false;
  let draftRevision = null;
  let loading = false;
  let generation = 0;
  let zone = 'A';
  let format = '';
  const refreshButton = $('[data-arrangements-refresh]');
  const outputSelectors = ['summary', 'slots', 'unplaced', 'cancelled', 'warnings', 'sessions', 'people-summary', 'student-summary', 'formats-summary', 'meta', 'result', 'timeline'];

  function clearSnapshot() {
    snapshot = null;
    $('[data-arrangements-body]').hidden = true;
    for (const key of outputSelectors) $('[data-arrangements-' + key + ']').replaceChildren();
    $('[data-arrangements-warnings-panel]').hidden = true;
    $('[data-arrangements-unplaced-panel]').hidden = true;
    $('[data-arrangements-cancelled-panel]').hidden = true;
  }
  function mismatch() { return Boolean(snapshot) && snapshot.revisions.content !== draftRevision; }
  function canJump() { return allowed && !locked && !dirty && !loading && !mismatch(); }
  function syncControls() {
    $('[data-arrangements-access]').hidden = allowed;
    $('[data-arrangements-dirty]').hidden = !allowed || !dirty;
    $('[data-arrangements-revision-warning]').hidden = !allowed || !mismatch();
    refreshButton.disabled = !allowed || locked || loading;
    for (const button of root.querySelectorAll('[data-arrangements-edit]')) button.disabled = !canJump();
    for (const button of root.querySelectorAll('[data-arrangements-plan]')) button.disabled = !allowed || locked || loading || mismatch() || (button.dataset.arrangementsPlan === 'session' && dirty);
    for (const control of root.querySelectorAll('[data-arrangements-zone],[data-arrangements-format]')) control.disabled = !allowed || loading;
  }
  function editButton(type, id, label, slotNumber = 0) {
    const button = node('button', label, 'ah-arrangements-edit');
    button.type = 'button';
    button.dataset.arrangementsEdit = type;
    button.addEventListener('click', () => {
      if (!canJump() || id && !stableId.test(id)) return;
      edit(type, id, slotNumber);
    });
    return button;
  }
  function planButton(type, id, slotNumber = 0, label = '直接编辑与分配') {
    const button = node('button', label, 'ah-arrangements-edit ah-arrangements-plan');
    button.type = 'button'; button.dataset.arrangementsPlan = type;
    button.addEventListener('click', () => {
      if (!allowed || locked || loading || mismatch() || type === 'session' && dirty || id && !stableId.test(id)) return;
      plan(type, id, slotNumber);
    });
    return button;
  }
  function renderTimeline() {
    const output = $('[data-arrangements-timeline]'); output.replaceChildren();
    for (const row of sessionTimeline(snapshot)) {
      const tr = node('tr'), time = node('th', row.start); time.scope = 'row'; tr.append(time);
      for (const zone of ['A','B','C']) {
        const cell = node('td');
        for (const session of row.zones[zone]) {
          const card = node('div', undefined, 'ah-arrangements-timeline-session');
          card.append(node('strong', session.title), node('small', session.start + '–' + session.end + ' · ' + ({scheduled:'已安排',draft:'草稿',cancelled:'已取消'})[session.status]));
          if (session.status !== 'cancelled') card.append(planButton('session', session.id, 0, '分配人员'));
          cell.append(card);
        }
        if (!cell.childElementCount) cell.textContent = '—';
        tr.append(cell);
      }
      output.append(tr);
    }
    if (!output.childElementCount) { const row = node('tr'), cell = node('td', '暂无已保存场次。'); cell.colSpan = 4; row.append(cell); output.append(row); }
  }
  function warnings(items) {
    const values = list(items);
    if (!values.length) return null;
    const output = node('ul', undefined, 'ah-arrangements-inline-warnings');
    for (const warning of values) if (typeof warning?.message === 'string') output.append(node('li', warning.message));
    return output.childElementCount ? output : null;
  }
  function people(items, primaryId = null) {
    const output = node('ul', undefined, 'ah-arrangements-people');
    for (const person of list(items)) {
      const item = node('li');
      if (primaryId && person.id === primaryId) item.append(node('small', '场次关联讲者', 'ah-arrangements-person-role'));
      item.append(node('strong', person.name || '姓名待核对'));
      if (person.organization) item.append(node('span', person.organization, 'ah-arrangements-organization'));
      const response = replies[person.responseStatus] || (person.guestStatus === 'confirmed' ? '嘉宾资料已确认 · 未关联回复' : '回复尚未关联');
      const badge = node('span', response, 'ah-arrangements-reply');
      badge.dataset.reply = person.responseStatus || 'unlinked'; item.append(badge);
      if (person.guestStatus && person.responseStatus) item.append(node('small', person.guestStatus === 'confirmed' ? '嘉宾资料已确认' : '嘉宾资料待确认'));
      const participation = list(person.participationForms).map(value => forms[value]).filter(Boolean).join(' / ');
      if (participation) item.append(node('small', '全活动职责：' + participation));
      if (list(person.rolesInSession).length) item.append(node('small','本场职责：'+person.rolesInSession.map(role=>SESSION_ROLE_LABELS[role]||role).join(' / '),'ah-arrangements-person-role'));
      if (person.guestId) item.append(editButton('guest', person.guestId, '嘉宾资料'));
      if(stableId.test(person.contactId??'')){const link=node('a','人员详情与关联报名','ah-arrangements-edit');link.href='/admin/contacts/#contact='+encodeURIComponent(person.contactId);item.append(link);}
      output.append(item);
    }
    return output;
  }
  function teams(items) {
    const output = node('ul', undefined, 'ah-arrangements-teams');
    for (const team of list(items)) {
      const item = node('li');
      item.append(node('strong', team.title || '作品名称待补'), node('span', team.teamName || '团队名称待补'));
      const response = node('span', replies[team.responseStatus] || '待回复', 'ah-arrangements-reply');
      response.dataset.reply = team.responseStatus || 'pending'; item.append(response);
      item.append(node('small', count(team.memberCount) + ' 人（团队填报，非签到）'));
      item.append(editButton('showcase', team.id, '作品与安排'));
      output.append(item);
    }
    return output;
  }
  function boothCard(row, history = false) {
    const card = node('article', undefined, 'ah-arrangements-slot');
    card.dataset.slotNumber = String(row.slotNumber);
    const heading = node('div', undefined, 'ah-arrangements-slot-heading');
    heading.append(node('span', row.label || (row.slotNumber ? String(row.slotNumber).padStart(2, '0') + ' 号位置' : '未指定位置')));
    const booth = row.booth;
    const badge = node('span', booth ? ({ confirmed: '已确认', pending: '待确认', cancelled: '已取消' })[booth.status] || '待核对' : '空位', 'ah-arrangements-slot-state');
    badge.dataset.status = booth?.status || 'empty'; heading.append(badge); card.append(heading);
    if (!booth) {
      card.dataset.empty = 'true';
      card.append(node('p', '待安排参展单位', 'ah-arrangements-vacant'), planButton('booth', null, row.slotNumber, '安排此位置'));
      return card;
    }
    card.append(node('h4', booth.organization || '机构 / 团队待确认'), node('p', booth.project || '项目待确认'), node('small', booth.code + ' · ' + booth.zone + ' 区', 'ah-arrangements-booth-code'));
    if(booth.description)card.append(node('p',booth.description,'ah-arrangements-description'));
    if(booth.contactName||booth.contactMethods){const contact=node('p',undefined,'ah-arrangements-booth-contact');contact.append(node('strong',booth.contactName||'负责人待填写'));if(booth.contactMethods)contact.append(node('span',booth.contactMethods));card.append(contact);}
    if (list(row.people).length) card.append(people(row.people));
    if (list(row.teams).length) card.append(teams(row.teams));
    if (!list(row.people).length && !list(row.teams).length) card.append(node('p', '参与人 / 作品团队尚未关联', 'ah-arrangements-assignment-empty'));
    const alert = warnings(row.warnings); if (alert) card.append(alert);
    if (!history) card.append(planButton('booth', booth.id, row.slotNumber));
    card.append(editButton('booth', booth.id, history ? '查看取消记录' : '完整编辑'));
    return card;
  }
  function renderSessions() {
    const output = $('[data-arrangements-sessions]'); output.replaceChildren();
    const all = list(snapshot?.sessions?.[zone]);
    const rows = all.filter(row => !format || row.format === format).slice().sort((a, b) => a.start.localeCompare(b.start) || a.zone.localeCompare(b.zone));
    $('[data-arrangements-result]').textContent = ({ A: 'A 区', B: 'B 区', other: '其他区域', workshops: '全部工作坊' })[zone] + ' · 显示 ' + rows.length + ' / ' + all.length + ' 场';
    for (const row of rows) {
      const item = node('article', undefined, 'ah-arrangements-session'); item.dataset.sessionStatus = row.status;
      const time = node('div', undefined, 'ah-arrangements-time');
      time.append(node('time', row.start + '–' + row.end), node('small', row.zone + ' 区'));
      const detail = node('div', undefined, 'ah-arrangements-session-detail');
      detail.append(node('span', formats[row.format] || formats.other, 'ah-arrangements-format'), node('h4', row.title));
      const state = { draft: '草稿 · 尚未安排', scheduled: '已安排', cancelled: '已取消' }[row.status] || '状态待核对';
      detail.append(node('p', state, 'ah-arrangements-session-state'));
      if (row.primarySpeaker && !row.primarySpeaker.personId) {
        const primary = row.primarySpeaker;
        detail.append(node('p', '场次讲者文字记录：' + (primary.name || '待确认') + (primary.status === 'confirmed' ? ' · 资料已确认' : ' · 待确认') + '（文字记录，尚未关联人员）', 'ah-arrangements-primary'));
      }
      const participants = people(row.people, row.primarySpeaker?.personId);
      if (participants.childElementCount) detail.append(participants);
      const students = teams(row.teams);
      if (students.childElementCount) detail.append(students);
      if (!row.primarySpeaker && !participants.childElementCount && !students.childElementCount) detail.append(node('p', '参与人员尚未关联', 'ah-arrangements-assignment-empty'));
      const alert = warnings(row.warnings); if (alert) detail.append(alert);
      if (row.status !== 'cancelled') detail.append(planButton('session', row.id, 0, '分配人员'));
      detail.append(editButton('session', row.id, '调整场次'));
      item.append(time, detail); output.append(item);
    }
    if (!rows.length) output.append(node('p', '此区域与形式下暂无已保存场次。', 'ah-arrangements-empty'));
    syncControls();
  }
  function render() {
    const summary = snapshot.summary;
    const metrics = [
      ['已安排位置', summary.booths.activePlaced, '/ 15'],
      ['已确认展位', summary.booths.confirmedPlaced, '个位置'],
      ['待确认展位', summary.booths.pendingPlaced, '个位置'],
      ['空位待安排', summary.booths.unassignedPositions, '个位置'],
      ['尚未指定位置', summary.booths.unplacedRecords, '条展位记录'],
    ];
    const summaryOutput = $('[data-arrangements-summary]'); summaryOutput.replaceChildren();
    for (const [label, value, unit] of metrics) {
      const metric = node('article'); metric.append(node('span', label), node('strong', String(count(value))), node('small', unit)); summaryOutput.append(metric);
    }
    $('[data-arrangements-meta]').textContent = '已保存内容 #' + snapshot.revisions.content + ' · 名单 #' + snapshot.revisions.contacts + ' · 读取于 ' + new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }) + '；两类记录分别保存。';
    const slots = $('[data-arrangements-slots]'); slots.replaceChildren();
    for (const row of snapshot.boothRows) slots.append(boothCard(row));
    for (const [key, rows, title] of [
      ['unplaced', snapshot.unplacedBooths, '尚未指定位置的有效展位'],
      ['cancelled', snapshot.cancelledBooths, '已取消展位 · 不占位置'],
    ]) {
      const output = $('[data-arrangements-' + key + ']'); output.replaceChildren();
      for (const row of list(rows)) output.append(boothCard(row, key === 'cancelled'));
      $('[data-arrangements-' + key + '-panel]').hidden = !output.childElementCount;
      $('[data-arrangements-' + key + '-title]').textContent = title + '（' + output.childElementCount + '）';
    }
    const warningOutput = $('[data-arrangements-warnings]'); warningOutput.replaceChildren();
    for (const warning of list(snapshot.warnings)) if (typeof warning?.message === 'string') warningOutput.append(node('li', warning.message));
    $('[data-arrangements-warnings-panel]').hidden = !warningOutput.childElementCount;
    $('[data-arrangements-warnings-title]').textContent = '需要核对的安排（' + warningOutput.childElementCount + '）';
    const persons = summary.people;
    $('[data-arrangements-people-summary]').textContent = '已关联 ' + count(persons.assignedContacts) + ' 位邀约对象 · 确认参加 ' + count(persons.attendingContacts) + ' · 待回复 ' + count(persons.pendingContacts) + ' · 不参加 ' + count(persons.declinedContacts) + '；另有 ' + count(persons.unlinkedConfirmedGuests) + ' 位已确认嘉宾未关联回复。';
    const students = summary.studentTeams ?? {};
    $('[data-arrangements-student-summary]').textContent = '作品已关联 ' + count(students.assignedTeams) + ' 件 · 确认参加 ' + count(students.attendingTeams) + ' 件 · 填报成员总数 ' + count(students.reportedAttendingMembers) + ' 人（作品团队填报，非去重参会人数或签到）。';
    const sessionsByFormat = summary.sessions.byFormat;
    $('[data-arrangements-formats-summary]').textContent = ['talk','workshop'].map(key => {
      const item = sessionsByFormat[key];
      return formats[key] + '：已安排 ' + count(item.scheduled) + ' 场 · 已记讲者 ' + count(item.withPrimarySpeaker) + ' · 待补讲者 ' + count(item.missingPrimarySpeaker);
    }).join('；') + '。讲者统计只计已安排场次，含待核实的文字记录，不代表确认出席。';
    $('[data-arrangements-body]').hidden = false;
    renderTimeline(); renderSessions();
  }
  function validSnapshot(value) {
    return value?.schemaVersion === 1 && Number.isSafeInteger(value.revisions?.content) && value.revisions.content >= 0
      && Number.isSafeInteger(value.revisions?.contacts) && value.revisions.contacts >= 0
      && value.summary?.booths?.capacity === 15 && value.summary.people && value.sessions
      && ['talk','workshop'].every(key => ['scheduled','withPrimarySpeaker','missingPrimarySpeaker'].every(field => Number.isSafeInteger(value.summary.sessions?.byFormat?.[key]?.[field]) && value.summary.sessions.byFormat[key][field] >= 0))
      && ['A', 'B', 'other', 'workshops'].every(key => Array.isArray(value.sessions[key]))
      && Array.isArray(value.boothRows) && value.boothRows.length === 15
      && value.boothRows.every((row, index) => row?.slotNumber === index + 1);
  }
  async function refresh() {
    if (!allowed || loading) return;
    const current = ++generation; loading = true;
    clearSnapshot();
    $('[data-arrangements-error]').hidden = true;
    $('[data-arrangements-error]').textContent = '';
    $('[data-arrangements-status]').textContent = '正在读取已保存安排…'; syncControls();
    try {
      const value = await load();
      if (current !== generation || !allowed) return;
      if (!validSnapshot(value)) throw new Error('安排资料格式无效，请重新读取。');
      snapshot = value; render();
      $('[data-arrangements-status]').textContent = '已读取保存的安排；下方统计不代表报名受理或现场签到。';
    } catch {
      if (current !== generation || !allowed) return;
      clearSnapshot();
      $('[data-arrangements-status]').textContent = '';
      $('[data-arrangements-error]').textContent = '无法读取最新已保存安排，旧总览已清除。请稍后刷新，或重新登录后核对。';
      $('[data-arrangements-error]').hidden = false;
    } finally {
      if (current === generation) { loading = false; syncControls(); }
    }
  }
  function clear() {
    ++generation; loading = false; allowed = false; dirty = false; draftRevision = null;
    clearSnapshot(); zone = 'A'; format = ''; $('[data-arrangements-format]').value = '';
    for (const button of root.querySelectorAll('[data-arrangements-zone]')) button.setAttribute('aria-pressed', String(button.dataset.arrangementsZone === zone));
    $('[data-arrangements-status]').textContent = ''; $('[data-arrangements-error]').textContent = ''; $('[data-arrangements-error]').hidden = true;
    syncControls();
  }
  function configure(state) {
    if (!state.allowed && allowed) clear();
    allowed = state.allowed === true; locked = state.busy === true; dirty = state.dirty === true; draftRevision = state.draftRevision ?? null;
    syncControls();
  }
  for (const button of root.querySelectorAll('[data-arrangements-zone]')) button.addEventListener('click', () => {
    if (!snapshot || !allowed || loading) return;
    zone = button.dataset.arrangementsZone;
    for (const control of root.querySelectorAll('[data-arrangements-zone]')) control.setAttribute('aria-pressed', String(control === button));
    renderSessions();
  });
  $('[data-arrangements-format]').addEventListener('change', event => { format = event.currentTarget.value; if (snapshot) renderSessions(); });
  clear();
  return { configure, refresh, clear };
}
