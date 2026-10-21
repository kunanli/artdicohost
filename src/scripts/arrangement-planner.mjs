import { boothReadiness, prepareContactAssignments } from '../lib/arrangement-planner.mjs';
import { organizationChoices } from '../lib/content-relationships.mjs';
import { readContentForm,writeContentForm } from '../lib/content-local-drafts.mjs';

const ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/u;
const fields = ['code','organization','project','contactName','contactMethods','description','status'];
function node(tag, text) { const element = document.createElement(tag); if (text !== undefined) element.textContent = text; return element; }

export function createArrangementPlanner({ root, getContext, request, applyBooth, refreshArrangements, onBusy = () => {}, onDraftChange = () => {} }) {
  const $ = selector => root.querySelector(selector);
  const boothForm = $('[data-planner-booth]'), assignmentForm = $('[data-planner-assignment]');
  let selected = null, original = null, roster = null, intents = null, generation = 0, working = false, uncertain = false;
  let baseline = '', unapplied = false, assignmentDirty = false, restoredAssignment = null;
  function message(text, error = false) {
    $('[data-planner-error]').textContent = error ? text : ''; $('[data-planner-error]').hidden = !error;
    $('[data-planner-result]').textContent = error ? '' : text;
  }
  function configure() {
    const context = getContext();
    if (!context.allowed) { if (selected || roster || !root.hidden) clear(); return; }
    for (const control of root.querySelectorAll('input,textarea,select,button')) if(!control.hasAttribute('data-admin-save'))control.disabled = working || context.busy || context.active===false;
    $('[data-planner-save]').disabled = working || context.busy || context.active===false || context.dirty || uncertain || !roster || !assignmentForm.elements.namedItem('contactId').value;
    if (selected && selected.revision !== context.revision) {
      $('[data-planner-apply]').disabled = true; $('[data-planner-save]').disabled = true;
      message('内容版本已变化，请保留填写并重新核对此位置。', true);
    }
    $('[data-planner-refresh]').disabled = working || context.busy || context.active===false || context.dirty;
  }
  function clear() {
    const wasWorking = working;
    generation++; selected = null; original = null; roster = null; intents = null; working = false; uncertain = false; baseline = ''; unapplied = false; assignmentDirty = false;restoredAssignment=null;
    root.hidden = true; boothForm.reset(); assignmentForm.reset();
    for (const key of ['session-choices','booth-choices','readiness']) $('[data-planner-' + key + ']').replaceChildren();
    assignmentForm.elements.namedItem('contactId').replaceChildren(node('option', '请选择'));
    const organization = boothForm.elements.namedItem('organizationId'), unlinked = node('option', '未关联组织'); unlinked.value = ''; organization.replaceChildren(unlinked);
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
    if (!selected || !context.allowed || context.active===false || context.dirty || working) { if (context.dirty) message('请先保存内容草稿，再读取和保存人员安排。', true); return; }
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
      if(restoredAssignment){
        const recovered=restoredAssignment;restoredAssignment=null;
        if(recovered.contactsRevision!==people.revision||!people.contacts.some(contact=>contact.id===recovered.assignment.contactId)){message('人员名单已有变化，暂存选择未套用；请复制暂存后重新核对。',true);restoredAssignment=recovered;}
        else{assignmentForm.elements.namedItem('contactId').value=recovered.assignment.contactId;choices();for(const [name,values]of[['sessionIds',recovered.assignment.sessionIds],['boothIds',recovered.assignment.boothIds]])for(const field of assignmentForm.querySelectorAll('[name='+name+']'))field.checked=values.includes(field.value);assignmentDirty=true;uncertain=recovered.uncertain;message(uncertain?'上次人员保存结果待核对。请先重新读取名单比较，不会自动重送。':'已恢复人员选择，请核对后明确保存。');}
      }
    } catch (error) { if (current === generation) { roster = null; intents = null; message(error.message || '名单未能读取。', true); } }
    finally { if (current === generation) { working = false; onBusy(false); configure(); } }
  }
  async function open(type, id, slotNumber = 0, {load=true} = {}) {
    const context = getContext();
    if (!context.allowed || context.active===false || context.busy || !['booth','session'].includes(type) || id && !ID.test(id)) return;
    if (unapplied) { message('请先保存当前展位，或明确放弃填写后再切换。', true); return; }
    clear();
    const item = id ? context.content[type === 'booth' ? 'booths' : 'sessions'].find(entry => entry.id === id)
      : context.content.booths.find(entry => entry.slotNumber === slotNumber && entry.status !== 'cancelled');
    if (id && !item) return;
    selected = { type, id: item?.id ?? null, slotNumber: item?.slotNumber || slotNumber, revision: context.revision };
    original = item ? structuredClone(item) : null;
    root.hidden = false; boothForm.hidden = type !== 'booth'; $('[data-planner-people]').hidden = false;
    $('[data-planner-title]').textContent = type === 'booth' ? '直接调整第 ' + selected.slotNumber + ' 个展位' : '分配人员：' + item.title;
    $('[data-planner-note]').textContent = type === 'booth' ? '保存展位资料到云端；负责人及联络方式不公开。公开页面需另行发布。' : '使用当前已保存场次分配人员；不改变报名名额、实际回复或公开授权。';
    if (type === 'booth') {
      let code = item?.code || 'C-' + String(selected.slotNumber).padStart(2,'0');
      let suffix = 1; while (!item && context.content.booths.some(booth => booth.code === code)) code = 'C-' + String(selected.slotNumber).padStart(2,'0') + '-' + suffix++;
      for (const key of fields) boothForm.elements.namedItem(key).value = item?.[key] ?? (key === 'code' ? code : key === 'status' ? 'pending' : '');
      const organization = boothForm.elements.namedItem('organizationId'), unlinked = node('option', '未关联组织'); unlinked.value = ''; organization.replaceChildren(unlinked);
      for (const choice of organizationChoices(context.content, item?.organizationId ?? '')) { const option = node('option', choice.name + (choice.missing ? ' · 请核对原关联' : choice.status === 'withdrawn' ? ' · 已退出' : choice.status === 'pending' ? ' · 待确认' : '')); option.value = choice.id; organization.append(option); }
      organization.value = item?.organizationId ?? '';
      baseline = JSON.stringify(readContentForm(boothForm,'plannerBooth'));
      readiness();
    }
    configure(); root.scrollIntoView({ block: 'nearest', behavior: 'auto' });
    if (load&&!context.dirty) await loadPeople(); else message('可继续编辑内容草稿；保存内容后可明确读取人员名单。');
  }
  function readiness() {
    const output = $('[data-planner-readiness]'); output.replaceChildren();
    const value = readContentForm(boothForm,'plannerBooth');
    unapplied = JSON.stringify(value) !== baseline; onDraftChange();
    for (const warning of boothReadiness(value)) output.append(node('li', warning));
    output.hidden = !output.childElementCount;
  }
  boothForm.addEventListener('input', readiness);
  async function saveBooth({allowBusy=false}={}) {
    const context=getContext();
    if(working||!context.allowed||context.active===false||context.busy&&!allowBusy||!selected||selected.type!=='booth'||selected.revision!==context.revision||!boothForm.reportValidity())return false;
    const current=generation,identity=selected,submitted=readContentForm(boothForm,'plannerBooth');
    working=true;onBusy(true);configure();
    try{
      const result=await applyBooth({boothId:selected.id,slotNumber:selected.slotNumber,original,expectedRevision:selected.revision,changes:submitted});
      if(current!==generation||selected!==identity||!getContext().allowed)return false;
      // The controller retains the validated canonical candidate on a failed
      // request. Bind a new position to that same ID so a retry cannot duplicate it.
      const staged=getContext().content?.booths.find(booth=>booth.id===result.boothId);
      if(staged){selected.id=result.boothId;original=structuredClone(staged);}
      if(result.saved!==true){message(result.error||'尚未确认保存，展位填写仍保留。',true);return false;}
      message('展位已保存到云端，公开页面尚未改变。');return true;
    }catch(error){if(current===generation)message(error.message||'展位尚未保存，填写仍保留。',true);return false;}
    finally{if(current===generation){working=false;onBusy(false);configure();}}
  }
  function acknowledgeSaved(record=null,{clearBooth=true}={}){
    if(!selected)return false;
    const context=getContext(),items=context.content?.[selected.type==='booth'?'booths':'sessions'];
    const item=items?.find(value=>value.id===selected.id||selected.type==='booth'&&!selected.id&&value.slotNumber===selected.slotNumber);
    if(!item)return false;
    // Other content fields may have been saved while a separate personnel
    // selection remained open. Only our proven full snapshot advances this base.
    selected.id=item.id;selected.revision=context.revision;original=structuredClone(item);
    if(selected.type!=='booth'||!record||record.selected.type!=='booth'){configure();return true;}
    const current=readContentForm(boothForm,'plannerBooth'),same=JSON.stringify(current)===JSON.stringify(record.booth);
    if(same&&clearBooth){baseline=JSON.stringify(current);unapplied=false;}
    onDraftChange();configure();return same;
  }
  boothForm.addEventListener('submit',event=>{event.preventDefault();void saveBooth();});
  assignmentForm.addEventListener('change', () => {
    assignmentDirty=true;onDraftChange();
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
    if (working || context.busy || context.active===false || context.dirty || uncertain || !roster || !contact || !selected || selected.revision !== context.revision) return;
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
      roster = latestRoster; uncertain = false;assignmentDirty=false;choices();onDraftChange();message('人员安排已保存；没有自动修改出席回复或发布个人资料。');
    } catch (error) { if (current === generation) message((committed ? '安排已保存，后续刷新未完成。' : '') + (error.message || '保存结果未能确认。') + (uncertain ? ' 请先重新读取名单核对，不要重复保存。' : ''), true); }
    finally { if (current === generation) { working = false; onBusy(false); configure(); } }
  });
  $('[data-planner-close]').addEventListener('click', clear);
  $('[data-planner-refresh]').addEventListener('click', () => loadPeople());
  clear();
  return { open, configure, clear, saveBooth, acknowledgeSaved, hasUnapplied: () => unapplied,hasLocalChanges:()=>unapplied||assignmentDirty||uncertain||Boolean(restoredAssignment),
    localDraft(){if(!selected||!unapplied&&!assignmentDirty&&!uncertain&&!restoredAssignment)return null;return{selected:{type:selected.type,id:selected.id,slotNumber:selected.slotNumber},booth:selected.type==='booth'?readContentForm(boothForm,'plannerBooth'):null,
      assignment:restoredAssignment?.assignment??(assignmentForm.elements.namedItem('contactId').value?{contactId:assignmentForm.elements.namedItem('contactId').value,sessionIds:Array.from(assignmentForm.querySelectorAll('[name=sessionIds]:checked'),field=>field.value),boothIds:Array.from(assignmentForm.querySelectorAll('[name=boothIds]:checked'),field=>field.value)}:null),contactsRevision:restoredAssignment?.contactsRevision??roster?.revision??null,uncertain};},
    async restoreLocalDraft(record){await open(record.selected.type,record.selected.id,record.selected.slotNumber,{load:false});if(!selected)throw new Error('原场次或展位已不存在，未套用暂存。');if(record.booth){writeContentForm(boothForm,'plannerBooth',record.booth);readiness();}if(record.assignment){restoredAssignment={assignment:structuredClone(record.assignment),contactsRevision:record.contactsRevision,uncertain:record.uncertain};assignmentDirty=true;message('已保留原人员选择；请明确读取名单并核对，不会自动保存安排。');}onDraftChange();configure();},
  };
}
