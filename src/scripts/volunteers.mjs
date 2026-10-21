import {createOperationsFormDraft,operationsDraftStore,captureDraftFields,applyDraftFields,removeOperationsDraft} from '../lib/operations-form-draft.mjs';
import { canManageVolunteers, volunteerWorkspaceView, volunteerSourceView, filterVolunteerRows, parseVolunteerSelection, sourceToken, parseSourceToken, personWorkspacePath, operationBody, operationReceipt, workflowLabels, admissionLabels, assignmentLabels, issueLabel } from '../lib/volunteer-workspace.mjs';

const $ = suffix => document.querySelector('[data-volunteer-' + suffix + ']');
const kinds = ['person', 'position', 'shift', 'assignment'];
const dialogs = Object.fromEntries(kinds.map(kind => [kind, { element: $(kind + '-dialog'), form: $(kind + '-form'), dirty: false, revision: null, source: null, links: null }]));
let user = null, csrfToken = '', view = null, epoch = 0, readSequence = 0, sourceSequence = 0, authSequence = 0;
let busy = false, reading = false, pending = null, sources = [], nextCursor = null, sourceQuery = '', sourceLoading = false, lastDeepLink = '';
let pendingDraft=null,pendingFormEntity='',pendingFormRevision='';
function setupPendingDraft(){if(pendingDraft||!view||!user)return;const generation=epoch;pendingDraft=createOperationsFormDraft({actorId:user.id,roles:user.roles,page:'volunteers',entity:'pending-operation',autoSave:false,form:$('authorized'),baseRevision:()=>view?.revision,isCurrent:()=>generation===epoch&&Boolean(user),capture:()=>({formEntity:pendingFormEntity,formRevision:pendingFormRevision}),apply:()=>{},onPending:request=>{if(request.path!=='/api/admin/volunteers/operations'||request.method!=='POST')throw new Error('原志愿者操作无法核对。');const body=operationBody(JSON.parse(request.body)),kind=body.action.replace('_upsert','').replace('volunteer','person');if(!kinds.includes(kind))throw new Error('原操作类型无法核对。');const draftEntity=request.fields.formEntity;if(typeof draftEntity!=='string'||!draftEntity.startsWith(kind+':')||!/^([A-Za-z]+):(new|[A-Za-z0-9_-]+)$/u.test(draftEntity))throw new Error('原表单关联无法核对。');const draftRevision=request.fields.formRevision===undefined?null:Number(request.fields.formRevision);if(draftRevision!==null&&(!/^[0-9]+$/u.test(request.fields.formRevision)||!Number.isSafeInteger(draftRevision)||draftRevision<1))throw new Error('原表单版本无法核对。');pendingFormEntity=draftEntity;pendingFormRevision=draftRevision===null?'':String(draftRevision);pending={type:'mutation',kind,body,uncertain:true,draftEntity,draftRevision};},onDiscard:()=>{pending=null;lock();},onChange:event=>{if(event.error?.code==='STALE_ACTOR'){clearPrivate();return;}lock();}});return pendingDraft.load();}
const drafts=new Map();
const draftNames={person:['id','source','workflowStatus','owner','followUpAt','lastContactAt','notes'],position:['id','name','zone','location','lead','description','status'],shift:['id','positionId','start','end','required','sessionId','boothId','status'],assignment:['id','volunteerId','shiftId','status']};
function openDraft(kind,record){
  drafts.get(kind)?.close();const generation=epoch,form=dialogs[kind].form,entity=kind+':'+(record?.id||'new'),names=draftNames[kind];dialogs[kind].draftEntity=entity;
  const draft=createOperationsFormDraft({actorId:user.id,roles:user.roles,page:'volunteers',entity,form,baseRevision:()=>dialogs[kind].revision,isCurrent:()=>generation===epoch&&Boolean(user)&&dialogs[kind].element.open,capture:()=>({...captureDraftFields(form,names),...(kind==='person'?{availabilityJson:JSON.stringify([...$('availability').children].map(row=>({start:row.querySelector('[name=start]').value,end:row.querySelector('[name=end]').value})))}:{})}),
    apply:fields=>{const{availabilityJson,...values}=fields;applyDraftFields(form,values,names);if(availabilityJson){const windows=JSON.parse(availabilityJson);if(!Array.isArray(windows)||windows.length>12||windows.some(value=>typeof value.start!=='string'||typeof value.end!=='string'||!/^([0-2][0-9]):[0-5][0-9]$/u.test(value.start)||!/^([0-2][0-9]):[0-5][0-9]$/u.test(value.end)))throw new Error('可服务时段无法核对。');$('availability').replaceChildren();for(const window of windows)availabilityRow(window);}dirty(kind);},
    onChange:event=>{if(event.error?.code==='STALE_ACTOR'){clearPrivate();return;}if(event.status==='discarded'&&pending?.kind===kind)pending=null;lock();}});
  drafts.set(kind,draft);void draft.load().then(async snapshot=>{if(generation!==epoch||!dialogs[kind].element.open||kind!=='person'||record)return;const source=parseSourceToken(snapshot?.record?.value?.fields?.source);if(source)await loadSources({exact:source});}).catch(()=>{});
}
const controllers = new Set();
const downloads = new Set();
const allowed = () => canManageVolunteers(user?.roles);
const changed = () => pending !== null || kinds.some(kind => dialogs[kind].dirty);
function node(tag, value, className) { const element = document.createElement(tag); if (value !== undefined) element.textContent = String(value); if (className) element.className = className; return element; }
function button(text, action, id) { const element = node('button', text, 'ah-admin-button'); element.type = 'button'; element.dataset.volunteerAction = action; if (id) element.dataset.id = id; return element; }
function announce(message = '', error = false) { $('status').textContent = error ? '' : message; $('error').textContent = error ? message : ''; $('error').hidden = !error; }
function formError(kind, message = '') { $(kind + '-error').textContent = message; $(kind + '-error').hidden = !message; }
function dirty(kind, value = true) { dialogs[kind].dirty = value; $(kind + '-dirty').textContent = value ? '尚未保存到云端。' : '';if(value&&!pending)drafts.get(kind)?.schedule(); }
function lock() {
  $('login-submit').disabled = busy || location.protocol === 'file:';
  $('refresh').disabled = busy || reading || Boolean(pending) || !allowed(); $('logout').disabled = busy || !user;
  const writable = allowed() && view !== null && !busy && !reading && !pending && !pendingDraft?.blocked;
  for (const key of ['add', 'add-position', 'add-shift', 'add-assignment', 'export']) $(key).disabled = !writable || key === 'export' && displayed().length === 0;
  for (const target of document.querySelectorAll('[data-volunteer-action]')) target.disabled = !writable;
  for (const kind of kinds) for (const field of dialogs[kind].form.elements) field.disabled = !writable || Boolean(drafts.get(kind)?.blocked) || kind === 'person' && field.name === 'source' && Boolean(dialogs.person.source) || kind === 'assignment' && ['volunteerId', 'shiftId'].includes(field.name) && Boolean(dialogs.assignment.links);
  for(const target of document.querySelectorAll('.operations-local-draft button'))target.disabled=busy||!allowed();
  $('add-availability').disabled = !writable || $('availability').children.length >= 12;
  for (const target of document.querySelectorAll('[data-volunteer-remove-availability]')) target.disabled = !writable;
  $('source-next').disabled = !writable || sourceLoading;
  for (const target of $('source-search').elements) target.disabled = !writable || sourceLoading;
  $('export-contact').disabled = !writable;
  $('pending').hidden = !pending;
  $('retry').disabled = busy || !allowed();
  for (const target of document.querySelectorAll('[data-volunteer-dialog-retry]')) { target.hidden = pending?.kind !== target.dataset.volunteerDialogRetry; target.disabled = busy || !allowed(); }
  for (const target of document.querySelectorAll('[data-volunteer-close]')) target.disabled = busy || !allowed();
}
function clearContent() {
  view = null;
  for (const key of ['metrics', 'roster', 'shifts', 'positions']) $(key).replaceChildren();
  for (const key of ['result-count', 'revision', 'source-warning']) $(key).textContent = '';
  $('source-warning').hidden = true;
  for (const key of ['roster-empty', 'shifts-empty', 'positions-empty']) $(key).hidden = true;
}
function clearPrivate() {
  pendingDraft?.close();pendingDraft=null;for(const draft of drafts.values())draft.close();drafts.clear();
  epoch++; readSequence++; sourceSequence++; authSequence++;
  for (const controller of controllers) controller.abort(); controllers.clear();
  for (const url of downloads) URL.revokeObjectURL(url); downloads.clear();
  user = null; csrfToken = ''; pending = null; busy = false; reading = false; sourceLoading = false; sources = []; nextCursor = null; lastDeepLink = '';
  clearContent();
  for (const kind of kinds) { dialogs[kind].element.close(); dialogs[kind].form.reset(); dialogs[kind].revision = null; dialogs[kind].source = null; dialogs[kind].links = null; dirty(kind, false); formError(kind); }
  $('availability').replaceChildren(); $('person-form').elements.source.replaceChildren(node('option', '请选择一位已保存人员')); $('person-form').elements.source.options[0].value = '';
  $('source-search').reset(); $('source-status').textContent = ''; $('source-next').hidden = true; $('person-source').textContent = ''; $('filters').reset(); $('export-contact').checked = false;
  $('login').reset(); $('user').textContent = ''; $('event').textContent = ''; $('workspace').hidden = true; $('authorized').hidden = true; $('denied').hidden = true; $('login-panel').hidden = false;
  lock();
}
function session(value) {
  if (!value || typeof value !== 'object' || typeof value.user?.id !== 'string' || !/^[A-Za-z0-9_-]{1,80}$/u.test(value.user.id) || !Array.isArray(value.user.roles) || value.user.roles.length > 20 || value.user.roles.some(role => typeof role !== 'string' || role.length > 80) || typeof value.csrfToken !== 'string' || value.csrfToken.length < 1 || value.csrfToken.length > 512 || value.user.label !== undefined && (typeof value.user.label !== 'string' || value.user.label.length > 320)) throw new Error('工作人员会话无法核对，请重新登录。');
  return { user: { id: value.user.id, label: value.user.label || value.user.id, roles: [...value.user.roles] }, csrfToken: value.csrfToken };
}
async function bytes(response, controller, maximum) {
  const declared = response.headers.get('content-length'); if (declared !== null && (!/^[0-9]+$/u.test(declared) || Number(declared) > maximum)) throw new Error('回应资料超出可核对范围。');
  const reader = response.body?.getReader(); if (!reader) throw new Error('云端回应为空，请重新核对。');
  const chunks = []; let length = 0;
  try { while (true) { if (controller.signal.aborted) throw new Error('读取已取消。'); const part = await reader.read(); if (part.done) break; if (!(part.value instanceof Uint8Array) || (length += part.value.length) > maximum) throw new Error('回应资料超出可核对范围。'); chunks.push(part.value); } const result = new Uint8Array(length); let offset = 0; for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.length; } return result; }
  finally { reader.cancel().catch(() => {}); reader.releaseLock(); }
}
const statusMessages = { 400: '填写格式无法核对，请检查表单。', 401: '会话已结束，请重新登录。', 403: '此账号没有志愿者名单与分工权限，请重新登录核对。', 409: '云端版本或操作发生冲突。填写内容仍保留；请重新读取后核对，取消此表单再编辑。', 413: '填写资料过大，请缩短内容。', 415: '请求格式无法核对。', 422: '这项安排未通过核对。请检查来源许可、本人回复、参会名额、可服务时段、重叠班次及需求人数。', 429: '操作较多，请稍后手动重试。', 503: '来源或云端资料暂时无法核对，不能据此判断人数为零。' };
async function request(path, { method = 'GET', body, generation = epoch, binary = false, current = () => true } = {}) {
  if (!/^\/api\/admin\/(?:session|login|logout|volunteers(?:\/sources(?:\?[^#]*)?|\/operations|\/export\.xlsx)?)$/u.test(path)) throw new Error('请求地址无效。');
  const controller = new AbortController(); controllers.add(controller); let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; controller.abort(); }, 15_000);
  try {
    const response = await fetch(path, { method, credentials: 'same-origin', cache: 'no-store', redirect: 'error', signal: controller.signal, headers: { Accept: binary ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' : 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}), ...(method !== 'GET' && csrfToken ? { 'X-CSRF-Token': csrfToken } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
    if (generation !== epoch || !current() || controller.signal.aborted) { response.body?.cancel().catch(() => {}); controller.abort(); throw new Error('会话或读取对象已改变，已忽略旧回应。'); }
    if (!response.ok) { response.body?.cancel().catch(() => {}); const error = new Error(path === '/api/admin/login' && response.status === 401 ? '账号或密码未通过验证。' : statusMessages[response.status] || '云端结果尚待核对，请手动确认同一操作。'); error.status = response.status; if ([401, 403].includes(response.status)) { clearPrivate(); announce(error.message, true); } throw error; }
    const mime = response.headers.get('content-type') ?? '';
    if (binary) {
      if (!/^application\/vnd\.openxmlformats-officedocument\.spreadsheetml\.sheet(?:\s*;|$)/iu.test(mime)) throw new Error('导出回应格式无法核对。');
      const result = await bytes(response, controller, 8 * 1024 * 1024); if (generation !== epoch || !current() || controller.signal.aborted) throw new Error('会话已改变，已忽略旧文件。');
      return { bytes: result, headers: response.headers };
    }
    if (!/^application\/json(?:\s*;|$)/iu.test(mime)) throw new Error('云端回应格式无法核对。');
    const data = await bytes(response, controller, 4 * 1024 * 1024); if (generation !== epoch || !current() || controller.signal.aborted) throw new Error('会话已改变，已忽略旧回应。');
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(data));
  } catch (error) { if (timedOut) throw new Error('等待超过时间，结果尚待核对；填写内容仍保留。'); throw error; }
  finally { clearTimeout(timer); controllers.delete(controller); }
}
function showSession(value) {
  const safe = session(value); clearPrivate(); user = safe.user; csrfToken = safe.csrfToken;
  $('user').textContent = user.label; $('login-panel').hidden = true; $('workspace').hidden = false; $('authorized').hidden = !allowed(); $('denied').hidden = allowed(); lock();
}
function filters() { return Object.fromEntries(new FormData($('filters'))); }
function displayed() { return view ? filterVolunteerRows(view, filters()) : []; }
function paragraph(output, value, className = 'volunteer-note') { output.append(node('p', value, className)); }
function warning(output, codes) { const unique = [...new Set(codes)]; if (unique.length) paragraph(output, unique.map(issueLabel).join('；'), 'volunteer-warning'); }
function zoneLabel(zone) { return zone === 'other' ? '其他区域' : zone + ' 区'; }
function shiftLabel(shift) { return shift.positionName + ' · ' + shift.start + '–' + shift.end + (shift.status === 'cancelled' ? '（已取消）' : ''); }
function renderRoster() {
  const output = $('roster'); output.replaceChildren(); if (!view) return;
  const rows = displayed(); $('result-count').textContent = '显示 ' + rows.length + ' / ' + view.volunteers.length + ' 笔名单；同一人的人数按明确身份去重。'; $('roster-empty').hidden = rows.length !== 0;
  for (const item of rows) {
    const row = node('tr'); row.dataset.volunteerId = item.id;
    const profile = node('td'); profile.append(node('strong', item.person.name)); if (item.person.organization) paragraph(profile, item.person.organization); const link = node('a', '个人工作页'); link.href = personWorkspacePath(item.source); profile.append(link);
    const communication = node('td'); communication.append(node('strong', workflowLabels[item.workflowStatus])); paragraph(communication, item.owner ? '负责：' + item.owner : '负责同事尚未分配'); paragraph(communication, '下次跟进：' + (item.followUpAt || '尚未安排')); if (item.lastContactAt) paragraph(communication, '上次联系：' + item.lastContactAt); if (item.notes) { const details = node('details'); details.append(node('summary', '沟通备注'), node('p', item.notes)); communication.append(details); }
    const availability = node('td'); paragraph(availability, item.availability.length ? item.availability.map(window => window.start + '–' + window.end).join('、') : '尚未确认可服务时段');
    const admission = node('td', admissionLabels[item.person.admissionStatus]);
    const allocation = node('td'), assignments = view.assignments.filter(entry => entry.volunteerId === item.id && entry.status !== 'cancelled');
    for (const entry of assignments) { const shift = view.shifts.find(shift => shift.id === entry.shiftId); paragraph(allocation, shiftLabel(shift) + ' · ' + assignmentLabels[entry.status]); warning(allocation, entry.issues); }
    if (!assignments.length) paragraph(allocation, '尚未安排班次'); warning(allocation, [...item.issues, ...item.person.issues]);
    const actions = node('td'); actions.append(button('编辑协作与时间', 'edit-person', item.id), button('安排班次', 'assign-person', item.id)); row.append(profile, communication, availability, admission, allocation, actions); output.append(row);
  }
}
function render() {
  if (!view) { lock(); return; }
  $('event').textContent = view.event.title + ' · ' + view.event.date + ' · 时间为 UTC+08';
  const metrics = $('metrics'); metrics.replaceChildren();
  for (const [key, label, unit] of [['activePeopleCount', '有效志愿者', '人'], ['confirmedPeopleCount', '本人已答应', '人'], ['assignedPeopleCount', '有效安排人员', '人'], ['requiredSlots', '班次总需求', '人次'], ['confirmedSlots', '已确认覆盖', '人次'], ['gapSlots', '尚缺人手', '人次']]) { const card = node('article'); card.append(node('span', label), node('strong', view.summary[key] + ' ' + unit)); metrics.append(card); }
  $('source-warning').hidden = view.summary.unverifiableSources === 0; $('source-warning').textContent = view.summary.unverifiableSources ? '有 ' + view.summary.unverifiableSources + ' 笔人员来源无法核对。人数统计仅包含可核对身份；先处理来源提示，再确认实际人手。' : '';
  $('revision').textContent = '已读取云端版本 ' + view.revision + '。每个表单需明确保存；新增、邀约回复、名额和逐班确认分别保存。';
  renderRoster();
  const positions = $('positions'); positions.replaceChildren(); $('positions-empty').hidden = view.positions.length !== 0;
  for (const item of view.positions) { const card = node('article', undefined, 'volunteer-position-card'); card.append(node('h3', item.name)); paragraph(card, zoneLabel(item.zone) + (item.location ? ' · ' + item.location : '') + (item.status === 'inactive' ? ' · 已停用' : '')); paragraph(card, item.lead ? '负责：' + item.lead : '负责同事尚未分配'); if (item.description) paragraph(card, item.description); card.append(button('编辑岗位', 'edit-position', item.id)); positions.append(card); }
  const shifts = $('shifts'); shifts.replaceChildren(); $('shifts-empty').hidden = view.shifts.length !== 0;
  for (const item of view.shifts) { const row = node('tr'), position = view.positions.find(entry => entry.id === item.positionId), name = node('td'); name.append(node('strong', item.positionName)); paragraph(name, zoneLabel(position.zone) + (item.status === 'cancelled' ? ' · 已取消' : '')); warning(name, item.issues);
    const time = node('td', item.start + '–' + item.end); if (item.sessionId) paragraph(time, '场次：' + (view.planning.sessions.find(entry => entry.id === item.sessionId)?.title || '历史关联待核对')); if (item.boothId) paragraph(time, '展位：' + (view.planning.booths.find(entry => entry.id === item.boothId)?.code || '历史关联待核对'));
    const actions = node('td'); for (const entry of view.assignments.filter(entry => entry.shiftId === item.id)) { const person = view.volunteers.find(person => person.id === entry.volunteerId); const line = node('div', undefined, 'volunteer-assignment'); paragraph(line, person.person.name + ' · ' + assignmentLabels[entry.status]); warning(line, entry.issues); line.append(button('调整安排', 'edit-assignment', entry.id)); actions.append(line); } actions.append(button('编辑班次', 'edit-shift', item.id), button('安排人员', 'assign-shift', item.id));
    row.append(name, time, node('td', item.status === 'cancelled' ? '已取消（原需求 ' + item.required + '）' : item.required + ' 人次'), node('td', item.proposedCount + ' 人次'), node('td', item.confirmedCount + ' 人次'), node('td', item.status === 'cancelled' ? '不计需求' : item.gap + ' 人次'), actions); shifts.append(row);
  }
  lock();
}
async function load() {
  if (!allowed() || reading) return; const generation = epoch, sequence = ++readSequence; reading = true; lock();
  try { const result = volunteerWorkspaceView(await request('/api/admin/volunteers', { generation, current: () => sequence === readSequence })); if (generation !== epoch || sequence !== readSequence) return; view = result;await setupPendingDraft();if(generation!==epoch)return; reading = false; render(); announce('已读取云端名单与分工。'); await deepLink(); }
  catch (error) { if (generation === epoch && sequence === readSequence) { clearContent(); announce(error.message, true); } }
  finally { if (generation === epoch && sequence === readSequence) { reading = false; lock(); } }
}
function option(select, value, label, { disabled = false } = {}) { const element = node('option', label); element.value = value; element.disabled = disabled; select.append(element); }
function setOptions(select, items, current, emptyLabel) { select.replaceChildren(); if (emptyLabel) option(select, '', emptyLabel); for (const item of items) option(select, item.value, item.label); if (current && !items.some(item => item.value === current)) option(select, current, '历史关联待核对'); select.value = current || ''; }
function renderSources(selected = '') {
  const select = dialogs.person.form.elements.source; select.replaceChildren(); option(select, '', '请选择一位已保存人员');
  for (const item of sources) { const existing = view?.volunteers.find(row => row.person.canonicalId && row.person.canonicalId === item.canonicalId || sourceToken(row.source) === sourceToken(item.source)); const token = sourceToken(item.source); option(select, token, item.name + (item.organization ? ' · ' + item.organization : '') + (existing ? '（已有志愿者记录）' : !item.eligible ? '（来源状态需核对）' : ''), { disabled: !item.eligible || Boolean(existing) }); }
  if (selected && !sources.some(item => sourceToken(item.source) === selected)) option(select, selected, '已保存的关联人员'); select.value = selected; $('source-next').hidden = nextCursor === null; lock();
}
async function loadSources({ append = false, exact = null } = {}) {
  if (!allowed() || !view || sourceLoading && append) return;
  const generation = epoch, sequence = ++sourceSequence; sourceLoading = true; const selected = dialogs.person.form.elements.source.value;
  if (!append) { sources = []; nextCursor = null; renderSources(selected); }
  const query = new URLSearchParams({ limit: '100', ...(exact ? { kind: exact.kind, id: exact.id } : { query: sourceQuery, cursor: append ? nextCursor || '0' : '0' }) });
  $('source-status').textContent = '正在核对已保存人员…'; lock();
  try { const result = volunteerSourceView(await request('/api/admin/volunteers/sources?' + query, { generation, current: () => sequence === sourceSequence && dialogs.person.element.open })); if (generation !== epoch || sequence !== sourceSequence) return null; sources = [...sources, ...result.candidates.filter(item => !sources.some(row => sourceToken(row.source) === sourceToken(item.source)))]; nextCursor = result.nextCursor; renderSources(exact ? sourceToken(exact) : selected); $('source-status').textContent = '已读取 ' + sources.length + ' / ' + result.total + ' 位可选择来源；已有名单或来源许可待核对者不可重复添加。'; return result; }
  catch (error) { if (generation === epoch && sequence === sourceSequence) { sources = []; nextCursor = null; renderSources(dialogs.person.source ? sourceToken(dialogs.person.source) : ''); $('source-status').textContent = '人员来源读取失败，不能判断为没有人员。'; formError('person', error.message); } return null; }
  finally { if (generation === epoch && sequence === sourceSequence) { sourceLoading = false; lock(); } }
}
function availabilityRow(window = { start: '', end: '' }) {
  const row = node('div', undefined, 'volunteer-availability-row'); row.dataset.volunteerAvailabilityRow = '';
  for (const [key, label] of [['start', '开始'], ['end', '结束']]) { const wrapper = node('label', label); const field = document.createElement('input'); field.type = 'time'; field.name = key; field.value = window[key]; field.required = true; wrapper.append(field); row.append(wrapper); }
  const remove = node('button', '移除此时段', 'ah-admin-text-button'); remove.type = 'button'; remove.dataset.volunteerRemoveAvailability = ''; remove.addEventListener('click', () => { if (pending || !view) return; row.remove(); dirty('person'); lock(); }); row.append(remove); $('availability').append(row); lock();
}
async function close(kind) { const generation=epoch,state = dialogs[kind]; if (pending) { if (!window.confirm('这项操作结果尚待确认。关闭表单会保留原内容及操作编号，请在页面点击「再次确认同一操作」。确定暂时关闭？')) return false; state.element.close(); return true; } if (state.dirty && !window.confirm('关闭表单并保留本机草稿？')) return false; if(state.dirty&&!drafts.get(kind)?.blocked)await drafts.get(kind)?.flush().catch(()=>{});if(generation!==epoch)return false;drafts.get(kind)?.close();drafts.delete(kind);state.element.close(); state.form.reset(); state.source = null; state.revision = null; if (kind === 'person') { sourceSequence++; sourceLoading = false; } dirty(kind, false); formError(kind); return true; }
async function open(kind, record = null, preset = {}) {
  if (!allowed() || !view || pending || pendingDraft?.blocked || busy) return;
  const generation=epoch;for (const other of kinds) if (dialogs[other].element.open && !await close(other)) return;if(generation!==epoch||!allowed()||!view)return;
  const state = dialogs[kind]; state.form.reset(); state.revision = view.revision; state.source = kind === 'person' && record ? record.source : null; state.links = kind === 'assignment' && record ? { volunteerId: record.volunteerId, shiftId: record.shiftId } : null; formError(kind); dirty(kind, false);
  const values = record || { id: '', ...preset }; for (const [name, value] of Object.entries(values)) if (state.form.elements[name] && typeof value !== 'object') state.form.elements[name].value = String(value);
  if (kind === 'person') {
    document.getElementById('volunteer-person-title').textContent = record ? '编辑志愿者协作与时间' : '从现有名单添加志愿者'; $('source-picker').hidden = Boolean(record); $('availability').replaceChildren(); for (const window of record?.availability || []) availabilityRow(window);
    sources = record ? [{ source: record.source, ...record.person }] : []; nextCursor = null; sourceQuery = ''; $('source-search').reset(); renderSources(record ? sourceToken(record.source) : ''); $('person-source').textContent = record ? record.person.name + ' · ' + admissionLabels[record.person.admissionStatus] : '先选择来源；保存后沿用同一份人员资料。';
  }
  if (kind === 'shift') { setOptions(state.form.elements.positionId, view.positions.map(item => ({ value: item.id, label: item.name + (item.status === 'inactive' ? '（已停用）' : '') })), record?.positionId || preset.positionId || '', '请选择岗位'); setOptions(state.form.elements.sessionId, view.planning.sessions.map(item => ({ value: item.id, label: item.title + ' · ' + item.start + '–' + item.end + (item.status === 'cancelled' ? '（已取消）' : '') })), record?.sessionId || '', '不关联场次'); setOptions(state.form.elements.boothId, view.planning.booths.map(item => ({ value: item.id, label: item.code + ' · ' + (item.organization || '组织待定') })), record?.boothId || '', '不关联展位'); if (!record) state.form.elements.required.value = '1'; }
  if (kind === 'assignment') { setOptions(state.form.elements.volunteerId, view.volunteers.map(item => ({ value: item.id, label: item.person.name + ' · ' + workflowLabels[item.workflowStatus] + ' · ' + admissionLabels[item.person.admissionStatus] })), record?.volunteerId || preset.volunteerId || '', '请选择志愿者'); setOptions(state.form.elements.shiftId, view.shifts.map(item => ({ value: item.id, label: shiftLabel(item) })), record?.shiftId || preset.shiftId || '', '请选择班次'); }
  state.element.showModal();openDraft(kind,record); lock();
  if (kind === 'person' && !record) void loadSources();
}
function uuid(prefix) { if (!globalThis.crypto?.randomUUID) throw new Error('当前浏览器不能安全建立操作编号，请使用新版浏览器。'); return prefix + '_' + crypto.randomUUID().replaceAll('-', ''); }
function payload(kind) {
  const form = dialogs[kind].form, value = name => String(form.elements[name].value).normalize('NFC').trim();
  const id = value('id') || uuid(kind === 'person' ? 'volunteer' : kind); form.elements.id.value = id;
  if (kind === 'person') { const source = dialogs.person.source || parseSourceToken(value('source')); const candidate = sources.find(item => sourceToken(item.source) === value('source')); if (!source || !dialogs.person.source && (!candidate?.eligible || view.volunteers.some(row => row.person.canonicalId && row.person.canonicalId === candidate.canonicalId || sourceToken(row.source) === sourceToken(source)))) throw new Error('请选择尚未加入名单且许可已核对的现有人员。'); const availability = [...$('availability').children].map(row => ({ start: row.querySelector('[name="start"]').value, end: row.querySelector('[name="end"]').value })).sort((a, b) => a.start.localeCompare(b.start)); if (availability.some((window, index) => !window.start || !window.end || window.start >= window.end || index > 0 && availability[index - 1].end > window.start)) throw new Error('请填写有效且互不重叠的可服务时段。'); return { id, source, workflowStatus: value('workflowStatus'), owner: value('owner'), followUpAt: value('followUpAt'), lastContactAt: value('lastContactAt'), notes: value('notes'), availability }; }
  if (kind === 'position') return { id, name: value('name'), zone: value('zone'), location: value('location'), lead: value('lead'), description: value('description'), status: value('status') };
  if (kind === 'shift') { if (value('start') >= value('end')) throw new Error('结束时间须晚于同一天的开始时间。'); const required = Number(value('required')); if (!Number.isSafeInteger(required) || required < 1 || required > 300) throw new Error('每班需求须为 1 至 300 的整数。'); return { id, positionId: value('positionId'), start: value('start'), end: value('end'), required, sessionId: value('sessionId'), boothId: value('boothId'), status: value('status') }; }
  const volunteerId = dialogs.assignment.links?.volunteerId || value('volunteerId'), shiftId = dialogs.assignment.links?.shiftId || value('shiftId'); const existing = view.assignments.find(item => item.volunteerId === volunteerId && item.shiftId === shiftId && item.id !== id); if (existing) throw new Error('同一人已有这个班次的安排，请从班次列表调整原记录。'); return { id, volunteerId, shiftId, status: value('status') };
}
async function submit(kind) {
  if (!view || !allowed() || pending || busy || reading || drafts.get(kind)?.blocked || !dialogs[kind].form.reportValidity()) return;
  try { const body = operationBody({ expectedRevision: dialogs[kind].revision, operationId: uuid('operation'), action: (kind === 'person' ? 'volunteer' : kind) + '_upsert', payload: payload(kind) }); pendingFormEntity=dialogs[kind].draftEntity;const local=await drafts.get(kind).flush();pendingFormRevision=String(local.revision);await pendingDraft.markPending({path:'/api/admin/volunteers/operations',method:'POST',body:JSON.stringify(body)});pending = { type: 'mutation', kind, body, draftEntity:pendingFormEntity,draftRevision:Number(pendingFormRevision) }; sourceSequence++; sourceLoading = false; dirty(kind); formError(kind); await confirmPending(); }
  catch (error) { if (user) formError(kind, error.message); }
}
async function validateFile(result, body) {
  if (result.bytes.length < 4 || result.bytes[0] !== 0x50 || result.bytes[1] !== 0x4b || result.bytes[2] !== 3 || result.bytes[3] !== 4) throw new Error('导出文件内容无法核对。');
  const operation = result.headers.get('x-volunteer-operation-id'), revision = result.headers.get('x-volunteer-revision'), count = result.headers.get('x-export-count'), digest = result.headers.get('x-export-sha256');
  if (operation !== body.operationId || !/^[0-9]+$/u.test(revision ?? '') || Number(revision) !== body.expectedRevision + 1 || count !== String(body.volunteerIds.length) || !/^[a-f0-9]{64}$/u.test(digest ?? '')) throw new Error('导出操作回执无法核对。');
  const actual = [...new Uint8Array(await crypto.subtle.digest('SHA-256', result.bytes))].map(byte => byte.toString(16).padStart(2, '0')).join(''); if (actual !== digest) throw new Error('导出文件校验未通过。');
}
async function confirmPending() {
  if (!pending || !allowed() || busy) return;
  const current = pending, generation = epoch; busy = true; $('pending-message').textContent = '正在确认这次操作。原内容及操作编号保持不变。'; lock();
  try {
    if (current.type === 'mutation') {
      const result = await request('/api/admin/volunteers/operations', { method: 'POST', body: current.body, generation }); if (generation !== epoch || pending !== current) return;
      const next = operationReceipt(result, current.body);if(drafts.has(current.kind)&&drafts.get(current.kind).snapshot?.revision===current.draftRevision)await drafts.get(current.kind).acknowledge();else if(current.draftEntity&&current.draftRevision!==null)await removeOperationsDraft({actorId:user.id,roles:user.roles,page:'volunteers',entity:current.draftEntity,expectedRevision:current.draftRevision,isCurrent:()=>generation===epoch});await pendingDraft.acknowledge();drafts.get(current.kind)?.close();drafts.delete(current.kind); pending = null; view = next; dirty(current.kind, false); dialogs[current.kind].element.close(); dialogs[current.kind].form.reset(); dialogs[current.kind].source = null; dialogs[current.kind].revision = null; formError(current.kind); render(); announce('已收到云端保存回执，名单与安排已更新。');
    } else {
      const result = await request('/api/admin/volunteers/export.xlsx', { method: 'POST', body: current.body, generation, binary: true }); await validateFile(result, current.body); if (generation !== epoch || pending !== current) return;
      const url = URL.createObjectURL(new Blob([result.bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })); downloads.add(url); const anchor = node('a'); anchor.href = url; anchor.download = 'artdico-volunteers.xlsx'; document.body.append(anchor); anchor.click(); anchor.remove(); setTimeout(() => { URL.revokeObjectURL(url); downloads.delete(url); }, 1000); pending = null; clearContent(); announce('已生成 Excel 并记录导出。文件下载由浏览器处理；请重新读取最新名单。');
    }
  } catch (error) {
    if (generation !== epoch || pending !== current) return;
    const rejected = [400, 413, 415, 422, 429].includes(error.status); if (rejected&&!current.uncertain) {await pendingDraft.acknowledge();pending = null;}
    if (current.kind) formError(current.kind, error.message);
    $('pending-message').textContent = error.message + ' 请点击「再次确认同一操作」；系统不会自动重送或新增第二笔。'; announce(error.message, true);
    if(error.status===409&&!current.uncertain){await pendingDraft.acknowledge();pending=null;clearContent();$('pending-message').textContent='';}else if(pending===current)current.uncertain=true;
  } finally { if (generation === epoch) { busy = false; lock(); } }
}
async function deepLink() {
  const selected = parseVolunteerSelection(location.hash); if (!selected || !view || !allowed() || lastDeepLink === location.hash || changed()) return; lastDeepLink = location.hash;
  const existing = view.volunteers.find(item => sourceToken(item.source) === sourceToken(selected) || selected.kind === 'contact' && item.person.contactId === selected.id || selected.kind === 'registration' && item.person.registrationId === selected.id);
  if (existing) { await open('person', existing); return; }
  await open('person'); const generation = epoch; const result = await loadSources({ exact: selected }); if (generation !== epoch || !dialogs.person.element.open || !result) return; const candidate = result.candidates.find(item => sourceToken(item.source) === sourceToken(selected)); if (!candidate?.eligible) { formError('person', '这位人员暂不可加入志愿者名单，请先核对来源许可与参与状态。'); return; }
  $('person-form').elements.source.value = sourceToken(selected); $('person-source').textContent = candidate.name + ' · ' + admissionLabels[candidate.admissionStatus]; dirty('person');
}
async function authenticate(body = null) {
  const sequence = ++authSequence, generation = epoch; busy = true; lock();
  try { const value = await request(body ? '/api/admin/login' : '/api/admin/session', { ...(body ? { method: 'POST', body } : {}), generation, current: () => sequence === authSequence }); if (sequence !== authSequence || generation !== epoch) return; showSession(value); announce('已恢复工作人员会话。'); if (allowed()) await load(); }
  catch (error) { if (generation === epoch && sequence === authSequence) announce(error.message, Boolean(body) || error.status !== 401); }
  finally { if (generation === epoch && sequence === authSequence) { busy = false; lock(); } }
}
for (const kind of kinds) {
  const retry = node('button', '再次确认同一操作', 'ah-admin-button'); retry.type = 'button'; retry.hidden = true; retry.dataset.volunteerDialogRetry = kind; retry.addEventListener('click', () => { void confirmPending(); }); dialogs[kind].form.querySelector('.ah-admin-dialog-actions').prepend(retry);
  dialogs[kind].form.addEventListener('input', () => dirty(kind)); dialogs[kind].form.addEventListener('change', () => dirty(kind));
  dialogs[kind].form.addEventListener('submit', event => { event.preventDefault(); void submit(kind); });
  dialogs[kind].element.addEventListener('cancel', event => { event.preventDefault(); close(kind); });
}
for (const target of document.querySelectorAll('[data-volunteer-close]')) target.addEventListener('click', () => close(target.dataset.volunteerClose));
$('login').addEventListener('submit', event => { event.preventDefault(); if (busy || !$('login').reportValidity()) return; const form = new FormData($('login')); const body = { username: String(form.get('username') || '').trim(), password: String(form.get('password') || '') }; $('login').elements.password.value = ''; void authenticate(body); });
$('logout').addEventListener('click',async()=>{if(busy||changed()&&!window.confirm('退出并清除本机草稿及待核对操作？云端结果需另行核对。'))return;const generation=epoch,actorId=user?.id;busy=true;lock();pendingDraft?.close();for(const draft of drafts.values())draft.close();try{if(actorId)await operationsDraftStore().clearActor(actorId);}finally{try{await request('/api/admin/logout',{method:'POST',body:{},generation});}catch{}finally{if(generation===epoch)clearPrivate();}}announce('已退出，本机填写已清空。');});
$('refresh').addEventListener('click', () => { void load(); });
$('retry').addEventListener('click', () => { void confirmPending(); });
$('add').addEventListener('click', () => open('person'));
$('add-position').addEventListener('click', () => open('position'));
$('add-shift').addEventListener('click', () => open('shift'));
$('add-assignment').addEventListener('click', () => open('assignment'));
$('add-availability').addEventListener('click', () => { if (!pending && view && $('availability').children.length < 12) { availabilityRow(); dirty('person'); } });
$('filters').addEventListener('submit', event => { event.preventDefault(); renderRoster(); lock(); });
$('filters').addEventListener('reset', () => { const generation = epoch; setTimeout(() => { if (generation === epoch) { renderRoster(); lock(); } }, 0); });
$('source-search').addEventListener('submit', event => { event.preventDefault(); sourceQuery = String(new FormData($('source-search')).get('query') || '').trim(); void loadSources(); });
$('source-next').addEventListener('click', () => { void loadSources({ append: true }); });
$('person-form').elements.source.addEventListener('change', event => { const candidate = sources.find(item => sourceToken(item.source) === event.target.value); $('person-source').textContent = candidate ? candidate.name + ' · ' + admissionLabels[candidate.admissionStatus] : ''; });
$('export').addEventListener('click', () => { if (!view || busy || pending || !allowed()) return; const volunteerIds = displayed().map(item => item.id); if (!volunteerIds.length) return; if (kinds.some(kind => dialogs[kind].dirty)) { announce('请先保存或关闭尚未保存的表单，再导出已保存名单。', true); return; } pending = { type: 'export', body: { expectedRevision: view.revision, operationId: uuid('export'), volunteerIds, includeContact: $('export-contact').checked } }; void confirmPending(); });
$('workspace').addEventListener('click', event => { const target = event.target.closest('[data-volunteer-action]'); if (!target || !view || pending || busy) return; const id = target.dataset.id; switch (target.dataset.volunteerAction) { case 'edit-person': open('person', view.volunteers.find(item => item.id === id)); break; case 'edit-position': open('position', view.positions.find(item => item.id === id)); break; case 'edit-shift': open('shift', view.shifts.find(item => item.id === id)); break; case 'edit-assignment': open('assignment', view.assignments.find(item => item.id === id)); break; case 'assign-person': open('assignment', null, { volunteerId: id }); break; case 'assign-shift': open('assignment', null, { shiftId: id }); break; } });
window.addEventListener('beforeunload', event => { if (changed()) { event.preventDefault(); event.returnValue = ''; } });
window.addEventListener('hashchange', () => { void deepLink(); });
lock(); if (location.protocol !== 'file:') void authenticate();
