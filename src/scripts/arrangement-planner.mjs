import { boothReadiness, prepareContactAssignments, assignmentSaveReceipt } from '../lib/arrangement-planner.mjs';
import { organizationChoices } from '../lib/content-relationships.mjs';
import { readContentForm,writeContentForm } from '../lib/content-local-drafts.mjs';

const ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/u;
const fields = ['code','organization','project','contactName','contactMethods','description','status'];
function node(tag, text) { const element = document.createElement(tag); if (text !== undefined) element.textContent = text; return element; }

export function createArrangementPlanner({ root, getContext, request, applyBooth, refreshArrangements, onBusy = () => {}, onDraftChange = () => {}, onBeforeAssignmentSave = async () => {} }) {
  const $ = selector => root.querySelector(selector);
  const boothForm = $('[data-planner-booth]'), assignmentForm = $('[data-planner-assignment]');
  let selected = null, original = null, roster = null, intents = null, generation = 0, working = false, uncertain = false;
  let baseline = '', unapplied = false, assignmentDirty = false, restoredAssignment = null;
  let pendingAssignment=null,boothSaveState='loaded',assignmentSaveState='loaded';
  function saveState(kind,state,detail=''){
    if(kind==='booth')boothSaveState=state;else assignmentSaveState=state;
    const title={loaded:kind==='booth'?'已载入展位资料':'选择人员并核对安排',dirty:'尚未保存',saving:'正在保存…',saved:'已保存',unknown:'保存结果待核对',conflict:'云端版本已变化',error:'保存未完成'}[state];
    $('[data-planner-'+kind+'-save-state]').dataset.saveState=state;
    $('[data-planner-'+kind+'-save-title]').textContent=title;
    $('[data-planner-'+kind+'-save-detail]').textContent=detail||({loaded:'修改后点击保存。',dirty:'填写内容仅在本页，点击保存后才会更新云端。',saving:'请等待云端回执，填写内容仍保留。',saved:'已核对云端保存回执。',unknown:'请核对云端保存结果，系统不会重复提交。',conflict:'填写内容仍保留，请先核对差异。',error:'填写内容仍保留，请检查后重试。'})[state];
    $(kind==='booth'?'[data-planner-apply]':'[data-planner-save]').textContent=state==='saving'?'正在保存…':'保存';
  }
  function assignmentFields(){return{contactId:assignmentForm.elements.namedItem('contactId').value,sessionIds:Array.from(assignmentForm.querySelectorAll('[name=sessionIds]:checked'),field=>field.value),boothIds:Array.from(assignmentForm.querySelectorAll('[name=boothIds]:checked'),field=>field.value)};}
  function restoreAssignmentFields(value){assignmentForm.elements.namedItem('contactId').value=value.contactId;choices();for(const[name,values]of[['sessionIds',value.sessionIds],['boothIds',value.boothIds]])for(const field of assignmentForm.querySelectorAll('[name='+name+']'))field.checked=values.includes(field.value);}
  function message(text, error = false) {
    $('[data-planner-error]').textContent = error ? text : ''; $('[data-planner-error]').hidden = !error;
    $('[data-planner-result]').textContent = error ? '' : text;
  }
  function configure() {
    const context = getContext();
    if (!context.allowed) { if (selected || roster || !root.hidden) clear(); return; }
    for (const control of root.querySelectorAll('input,textarea,select,button')) if(!control.hasAttribute('data-admin-save'))control.disabled = working || context.busy || context.active===false;
    if(uncertain)for(const control of assignmentForm.querySelectorAll('input,select,button'))control.disabled=true;
    $('[data-planner-save]').disabled = working || context.busy || context.active===false || context.dirty || uncertain || !roster || !assignmentForm.elements.namedItem('contactId').value;
    if(assignmentSaveState==='conflict'&&restoredAssignment)$('[data-planner-save]').disabled=true;
    if(selected?.type==='booth'&&!unapplied&&selected.id)$('[data-planner-apply]').disabled=true;
    if (selected && selected.revision !== context.revision) {
      $('[data-planner-apply]').disabled = true; $('[data-planner-save]').disabled = true;
      message('内容版本已变化，请保留填写并重新核对此位置。', true);
    }
    $('[data-planner-refresh]').disabled = working || context.busy || context.active===false || context.dirty;
    $('[data-planner-refresh]').textContent=uncertain?'核对云端保存结果':'重新读取名单';
  }
  function clear() {
    const wasWorking = working;
    generation++; selected = null; original = null; roster = null; intents = null; working = false; uncertain = false; baseline = ''; unapplied = false; assignmentDirty = false;restoredAssignment=null;pendingAssignment=null;
    root.hidden = true; boothForm.reset(); assignmentForm.reset();
    for (const key of ['session-choices','booth-choices','readiness']) $('[data-planner-' + key + ']').replaceChildren();
    assignmentForm.elements.namedItem('contactId').replaceChildren(node('option', '请选择'));
    const organization = boothForm.elements.namedItem('organizationId'), unlinked = node('option', '未关联组织'); unlinked.value = ''; organization.replaceChildren(unlinked);
    for (const key of ['title','note','person-state','preflight']) $('[data-planner-' + key + ']').textContent = '';
    saveState('booth','loaded');saveState('assignment','loaded');message(''); if (wasWorking) onBusy(false); onDraftChange();
  }
  function selectedContact() { return roster?.contacts.find(contact => contact.id === assignmentForm.elements.namedItem('contactId').value); }
  function choices() {
    const context = getContext(), contact = selectedContact();
    for (const [kind, items] of [['session', context.content?.sessions ?? []],['booth', context.content?.booths ?? []]]) {
      const output = $('[data-planner-' + kind + '-choices]'); output.replaceChildren();
      for (const item of items.filter(item => item.status !== 'cancelled')) {
        const label = node('label'), box = node('input'); box.type = 'checkbox'; box.name = kind + 'Ids'; box.value = item.id;
        const target = selected?.type === kind && selected.id === item.id;
        box.checked = Boolean(contact?.operations[kind + 'Ids']?.includes(item.id)) || Boolean(contact&&target&&assignmentDirty);
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
    const recovered=restoredAssignment??((assignmentDirty||uncertain)&&assignmentFields().contactId?{assignment:assignmentFields(),contactsRevision:pendingAssignment?.expectedRevision??roster?.revision,uncertain}:null);
    const current = ++generation; working = true; onBusy(true); configure();
    try {
      const [people, planning] = await Promise.all([request('/api/admin/contacts'), request('/api/admin/planning')]);
      const ledger = planning.features?.intentInvitations ? await request('/api/admin/intent-invitations') : null;
      if (current !== generation || !getContext().allowed) return;
      if (!Array.isArray(people.contacts) || !Number.isSafeInteger(people.revision)) throw new Error('名单格式无效。');
      roster = people; intents = ledger;
      const select = assignmentForm.elements.namedItem('contactId'); select.replaceChildren();
      const placeholder = node('option', '请选择人员'); placeholder.value = ''; select.append(placeholder);
      for (const contact of people.contacts) {
        const option = node('option', contact.profile.displayName || contact.profile.name);
        option.value = contact.id; option.disabled = contact.profile.contactConsent === 'declined' || contact.operations.responseStatus === 'declined';
        if (option.disabled) option.textContent += ' · 已拒绝';
        if (contact.profile.organization) option.textContent += ' · ' + contact.profile.organization;
        select.append(option);
      }
      choices();message('已读取名单；选择人员后核对全部分配，再明确保存。');
      if(recovered){
        restoredAssignment=null;
        const savedContact=people.contacts.find(contact=>contact.id===recovered.assignment.contactId);
        if(recovered.uncertain){
          try{
            const expected=pendingAssignment??{contactId:recovered.assignment.contactId,expectedRevision:recovered.contactsRevision,operations:{sessionIds:recovered.assignment.sessionIds,boothIds:recovered.assignment.boothIds}};
            assignmentSaveReceipt({revision:people.revision,contact:savedContact},expected,{readback:true});
            uncertain=false;pendingAssignment=null;assignmentDirty=false;restoreAssignmentFields(recovered.assignment);
            saveState('assignment','saved','已核对云端人员安排与本次填写一致，没有重复提交。');message('已核对云端人员安排与本次填写一致。');
          }catch{
            uncertain=true;assignmentDirty=true;restoredAssignment=recovered;
            if(savedContact)restoreAssignmentFields(recovered.assignment);
            saveState('assignment','unknown','云端安排尚未与原填写一致；原人员与选择仍保留，不会重复提交。');message('保存结果仍待核对。原人员与选择保留，请稍后再次核对云端。',true);
          }
        }else if(recovered.contactsRevision!==people.revision||!savedContact){
          restoredAssignment=recovered;assignmentDirty=true;
          if(savedContact)restoreAssignmentFields(recovered.assignment);
          saveState('assignment','conflict','人员名单已有变化，原选择仍保留；请先核对最新人员资料。');message('人员名单已有变化，原选择仍保留，请核对后再保存。',true);
        }else{restoreAssignmentFields(recovered.assignment);assignmentDirty=true;saveState('assignment','dirty');message('已恢复人员选择，请核对后明确保存。');}
      }else{uncertain=false;saveState('assignment','loaded');}
      onDraftChange();
    } catch (error) { if (current === generation) { roster = null; intents = null;saveState('assignment',uncertain?'unknown':'error',error.message||'名单未能读取，填写仍保留。');message(error.message || '名单未能读取。', true); } }
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
    if(!selected||selected.type!=='booth')return;
    const output = $('[data-planner-readiness]'); output.replaceChildren();
    const value = readContentForm(boothForm,'plannerBooth');
    unapplied = !selected.id||JSON.stringify(value) !== baseline;saveState('booth',unapplied?'dirty':boothSaveState==='saved'?'saved':'loaded');onDraftChange();
    for (const warning of boothReadiness(value)) output.append(node('li', warning));
    output.hidden = !output.childElementCount;
  }
  boothForm.addEventListener('input', readiness);
  boothForm.addEventListener('change', readiness);
  async function saveBooth({allowBusy=false}={}) {
    const context=getContext();
    if(working||!context.allowed||context.active===false||context.busy&&!allowBusy||!selected||selected.type!=='booth'||selected.revision!==context.revision||!boothForm.reportValidity())return false;
    const current=generation,identity=selected,submitted=readContentForm(boothForm,'plannerBooth');
    working=true;saveState('booth','saving');onBusy(true);configure();
    try{
      const result=await applyBooth({boothId:selected.id,slotNumber:selected.slotNumber,original,expectedRevision:selected.revision,changes:submitted});
      if(current!==generation||selected!==identity||!getContext().allowed)return false;
      // The controller retains the validated canonical candidate on a failed
      // request. Bind a new position to that same ID so a retry cannot duplicate it.
      const staged=getContext().content?.booths.find(booth=>booth.id===result.boothId);
      if(staged){selected.id=result.boothId;original=structuredClone(staged);}
      if(result.saved!==true){saveState('booth','unknown',result.error||'尚未确认保存，展位填写仍保留。请先核对云端保存结果。');message(result.error||'尚未确认保存，展位填写仍保留。',true);return false;}
      saveState('booth',unapplied?'dirty':'saved',unapplied?'本次提交已保存；之后新增的填写仍未保存。':'展位已保存到云端。公开页面另行发布。');message('展位已保存到云端，公开页面尚未改变。');return true;
    }catch(error){if(current===generation){saveState('booth','error',error.message);message(error.message||'展位尚未保存，填写仍保留。',true);}return false;}
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
    if(same&&clearBooth){baseline=JSON.stringify(current);unapplied=false;saveState('booth','saved','已核对展位保存回执。公开页面另行发布。');}
    onDraftChange();configure();return same;
  }
  boothForm.addEventListener('submit',event=>{event.preventDefault();void saveBooth();});
  assignmentForm.addEventListener('change', () => {
    if(working||uncertain)return;
    restoredAssignment=null;assignmentDirty=true;saveState('assignment','dirty');onDraftChange();
    const contact = selectedContact();
    if (!contact) return;
    try {
      prepareContactAssignments(contact, { sessionIds: [...new FormData(assignmentForm).getAll('sessionIds')], boothIds: [...new FormData(assignmentForm).getAll('boothIds')] }, getContext().content);
      $('[data-planner-preflight]').textContent = '本页核对通过；保存时仍由后台检查最新修订与冲突。';
    } catch (error) { $('[data-planner-preflight]').textContent = error.message; }
  });
  assignmentForm.elements.namedItem('contactId').addEventListener('change',()=>{if(working||uncertain)return;assignmentDirty=true;choices();});
  assignmentForm.addEventListener('submit', async event => {
    event.preventDefault(); const context = getContext(), contact = selectedContact();
    if (working || context.busy || context.active===false || context.dirty || uncertain || !roster || !contact || !selected || selected.revision !== context.revision) return;
    let operations;
    try { operations = prepareContactAssignments(contact, { sessionIds: [...new FormData(assignmentForm).getAll('sessionIds')], boothIds: [...new FormData(assignmentForm).getAll('boothIds')] }, context.content); }
    catch (error) { saveState('assignment','error',error.message);message(error.message, true); return; }
    const current = generation; let committed = false,requested=false; working = true;saveState('assignment','saving');onBusy(true);configure();
    try {
      const latest = await request('/api/admin/content');
      if (current !== generation || !getContext().allowed) return;
      if (latest.draft?.revision !== selected.revision) throw new Error('内容已由其他工作人员更新，请重新载入内容后再安排。');
      const linked = intents?.conversions?.some(value => value.sourceContactId === contact.id);
      const path = '/api/admin/contacts/' + encodeURIComponent(contact.id) + (linked ? '/assignments' : '');
      const body = linked ? { expectedContactRevision: roster.revision, sessionIds: operations.sessionIds, boothIds: operations.boothIds }
        : { expectedRevision: roster.revision, operations };
      // No automatic retry: if the commit acknowledgement is lost the next action is a read.
      const method=linked?'POST':'PUT';pendingAssignment={contactId:contact.id,expectedRevision:roster.revision,operations:structuredClone(operations),path,method,body:JSON.stringify(body)};uncertain=true;onDraftChange();
      await onBeforeAssignmentSave();if(current!==generation||!getContext().allowed)return;
      requested=true;
      const result=await request(path,{method,body:pendingAssignment.body});
      if (current !== generation || !getContext().allowed) return;
      const saved=assignmentSaveReceipt(result,pendingAssignment);committed=true;uncertain=false;pendingAssignment=null;
      roster={...roster,revision:saved.revision,contacts:roster.contacts.map(item=>item.id===saved.contact.id?saved.contact:item)};
      assignmentDirty=false;restoredAssignment=null;choices();onDraftChange();saveState('assignment','saved','已核对人员安排的云端保存回执。');
      await refreshArrangements();
      const latestRoster = await request('/api/admin/contacts');
      if (current !== generation || !getContext().allowed) return;
      if (!Array.isArray(latestRoster.contacts) || !Number.isSafeInteger(latestRoster.revision)) throw new Error('安排已保存，但最新名单未能读取；请重新读取核对。');
      if(latestRoster.revision<saved.revision)throw new Error('最新名单尚未包含已核对的保存版本。');
      roster=latestRoster;choices();onDraftChange();message('人员安排已保存；没有自动修改出席回复或发布个人资料。');
    } catch (error) { if (current === generation){
      if(!committed&&(!requested||[400,422].includes(error.status))){uncertain=false;pendingAssignment=null;}
      if(!committed)saveState('assignment',uncertain?'unknown':error.status===409?'conflict':'error',error.message);
      message((committed ? '安排已保存，后续刷新未完成。' : '') + (error.message || '保存结果未能确认。') + (uncertain ? ' 请先核对云端保存结果，不要重复保存。' : ''), true);
    } }
    finally { if (current === generation) { working = false; onBusy(false); configure(); } }
  });
  $('[data-planner-close]').addEventListener('click',()=>{if(working||getContext().busy)return;if((unapplied||assignmentDirty||uncertain)&&!confirm(uncertain?'关闭并放弃本页人员结果核对入口？这不会撤销可能已保存的云端操作。':'关闭并放弃本次尚未保存的安排填写？'))return;clear();});
  $('[data-planner-refresh]').addEventListener('click', () => loadPeople());
  clear();
  return { open, configure, clear, saveBooth, acknowledgeSaved, hasUnapplied: () => unapplied,hasLocalChanges:()=>unapplied||assignmentDirty||uncertain||Boolean(restoredAssignment),
    localDraft(){if(!selected||!unapplied&&!assignmentDirty&&!uncertain&&!restoredAssignment)return null;return{selected:{type:selected.type,id:selected.id,slotNumber:selected.slotNumber},booth:selected.type==='booth'?readContentForm(boothForm,'plannerBooth'):null,
      assignment:pendingAssignment?{contactId:pendingAssignment.contactId,sessionIds:pendingAssignment.operations.sessionIds,boothIds:pendingAssignment.operations.boothIds}:restoredAssignment?.assignment??(assignmentForm.elements.namedItem('contactId').value?assignmentFields():null),contactsRevision:pendingAssignment?.expectedRevision??restoredAssignment?.contactsRevision??roster?.revision??null,uncertain};},
    async restoreLocalDraft(record){await open(record.selected.type,record.selected.id,record.selected.slotNumber,{load:false});if(!selected)throw new Error('原场次或展位已不存在，未套用暂存。');if(record.booth){writeContentForm(boothForm,'plannerBooth',record.booth);readiness();}if(record.assignment){restoredAssignment={assignment:structuredClone(record.assignment),contactsRevision:record.contactsRevision,uncertain:record.uncertain};assignmentDirty=true;message('已保留原人员选择；请明确读取名单并核对，不会自动保存安排。');}onDraftChange();configure();},
  };
}
