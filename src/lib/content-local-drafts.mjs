import { validateContent } from '../../shared/content-schema.mjs';
import { contentSaveSnapshot } from './admin-save-state.mjs';

const ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/u;
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
const exact = (value, keys) => plain(value) && Object.keys(value).every(key => keys.includes(key));
const text = (value, max = 10000) => typeof value === 'string' && value.isWellFormed() && value.length <= max && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value);
const ids = value => Array.isArray(value) && value.length <= 50 && value.every(item => typeof item === 'string' && ID.test(item)) && new Set(value).size === value.length;
export const CONTENT_DRAFT_SECTIONS = Object.freeze(['overview','event','arrangements','guests','organizations','showcases','sessions','booths','publish']);
const formSections = Object.freeze({event:'event',guest:'guests',organization:'organizations',showcase:'showcases',session:'sessions',booth:'booths',planner:'arrangements'});
export const CONTENT_FORM_FIELDS = Object.freeze({
  event: ['title','date','timezone','venue','status','dateStatus','venueStatus','heroDescription','aboutTitle','aboutText','checkInTime','openingTime','endTime','contactEmail','mapUrl'],
  session: ['id','start','end','zone','title','format','speakerName','speakerStatus','guestId','status','internalNotes'],
  booth: ['id','code','organization','organizationId','project','zone','slotNumber','contactName','contactMethods','description','website','status','visibility','internalNotes'],
  guest: ['id','name','company','ggjRole','portraitId','contactId','title','bio','website','status','internalNotes','publicConsent','publicRoles','visibility'],
  showcase: ['id','kind','organizationId','title','teamName','school','contactName','email','wechat','memberCount','participationForms','responseStatus','materialLinks','summary','coverId','status','publicConsent','sessionId','boothId','visibility','internalNotes'],
  organization: ['id','name','logoId','website','participation','status','publicConsent','visibility','internalNotes'],
  plannerBooth: ['code','organization','organizationId','project','contactName','contactMethods','description','status'],
});
const arrays = new Set(['publicRoles','participationForms']);
/** Deliberately keeps incomplete text. Only an explicit save validates business fields. */
export function contentFormValue(type, input) {
  if (!CONTENT_FORM_FIELDS[type] || !exact(input, CONTENT_FORM_FIELDS[type])) return null;
  const result = {};
  for (const [key, value] of Object.entries(input)) {
    if (key === 'visibility') { if (!['public','private'].includes(value)) return null; }
    else if (key === 'publicConsent') { if (typeof value !== 'boolean') return null; }
    else if (arrays.has(key)) { if (!Array.isArray(value) || value.length > 8 || value.some(item => !text(item, 40)) || new Set(value).size !== value.length) return null; }
    else if (!text(value)) return null;
    result[key] = structuredClone(value);
  }
  return result;
}
/** New work fields preserve the old own-property shape; a blank legacy kind is display-only. */
export function showcaseOptionalFields(previous, raw, {isNew=false}={}) {
  if(!plain(raw)||previous!==null&&previous!==undefined&&!plain(previous))throw new TypeError('作品分类或组织关联无法核对。');
  const result={},kinds=['student','indie','team'];
  for(const key of ['kind','organizationId']){
    const supplied=Object.getOwnPropertyDescriptor(raw,key),saved=Object.getOwnPropertyDescriptor(previous??{},key);
    if(supplied&&!Object.hasOwn(supplied,'value')||saved&&!Object.hasOwn(saved,'value'))throw new TypeError('作品分类或组织关联须为明确值。');
    if(!supplied){if(saved)result[key]=saved.value;else if(key==='kind'&&isNew)throw new TypeError('请选择作品分类。');continue;}
    const value=supplied.value;if(typeof value!=='string')throw new TypeError('作品分类或组织关联须为明确文字。');
    if(key==='kind'){
      if(value===''){if(saved||isNew)throw new TypeError('请选择作品分类。');}
      else if(kinds.includes(value))result.kind=value;
      else throw new TypeError('请选择有效的作品分类。');
    }else{
      if(value!==''&&!ID.test(value))throw new TypeError('请选择已保存的参与组织，或明确解除关联。');
      if(value||saved)result.organizationId=value;
    }
  }
  return result;
}
export function readContentForm(form, type) {
  const result = {};
  for (const name of CONTENT_FORM_FIELDS[type] ?? []) {
    const field = form.elements.namedItem(name);
    if (arrays.has(name)) result[name] = Array.from(form.querySelectorAll('[name="' + name + '"]:checked'), item => item.value);
    else if (field?.type === 'checkbox') result[name] = field.checked;
    else if (field) result[name] = field.value;
  }
  return contentFormValue(type, result);
}
export function writeContentForm(form, type, value) {
  const fields = contentFormValue(type, value); if (!fields) throw new Error('本机表单暂存无法核对。');
  // Legacy form drafts never set an explicit visibility choice. Restore their
  // default without mutating saved content or the exact original request body.
  if (CONTENT_FORM_FIELDS[type]?.includes('visibility') && !Object.hasOwn(fields,'visibility')) {
    const field=form.elements.namedItem('visibility');if(field)field.value='public';
  }
  for (const [name, data] of Object.entries(fields)) {
    if (arrays.has(name)) { for (const field of form.querySelectorAll('[name="' + name + '"]')) field.checked = data.includes(field.value); continue; }
    const field = form.elements.namedItem(name); if (!field) continue;
    if (field.type === 'checkbox') field.checked = name === 'publicConsent' ? false : data;
    else {
      if (field.tagName === 'SELECT' && data && !Array.from(field.options).some(option => option.value === data)) {
        const missing = document.createElement('option'); missing.value = data; missing.textContent = '原关联需重新核对'; field.append(missing);
      }
      field.value = data;
    }
  }
  const visibility=form.elements.namedItem('visibility');
  for(const button of form.querySelectorAll('[data-content-visibility-switch]')){
    const visible=visibility?.value!=='private';button.dataset.visibility=visible?'public':'private';button.setAttribute('aria-checked',String(visible));
    const label=button.querySelector('[data-content-visibility-label]');if(label)label.textContent=visible?'公开':'未公开';
  }
}
export function contentLocalDraftValue(value, { kind } = {}) {
  if (!exact(value, ['schemaVersion','roleKey','content','forms','pendingSave','section','uncertain']) || value.schemaVersion !== 1 || !text(value.roleKey, 500)
    || Object.hasOwn(value,'section') && !CONTENT_DRAFT_SECTIONS.includes(value.section)
    || Object.hasOwn(value,'uncertain') && typeof value.uncertain !== 'boolean'
    || !exact(value.forms, [...Object.keys(CONTENT_FORM_FIELDS).filter(key => key !== 'plannerBooth'), 'planner'])) return false;
  const checked = validateContent(value.content); if (!checked.valid || JSON.stringify(checked.value) !== JSON.stringify(value.content)) return false;
  if (['session','booth','guest','showcase','organization'].filter(type => Object.hasOwn(value.forms, type)).length > 1) return false;
  for (const [type, record] of Object.entries(value.forms)) {
    if (type === 'planner') {
      if (!exact(record, ['selected','booth','assignment','contactsRevision','uncertain']) || !exact(record.selected, ['type','id','slotNumber'])
        || !['booth','session'].includes(record.selected.type) || record.selected.id !== null && !ID.test(record.selected.id ?? '')
        || !Number.isSafeInteger(record.selected.slotNumber) || record.selected.slotNumber < 0 || record.selected.slotNumber > 15
        || record.booth !== null && !contentFormValue('plannerBooth', record.booth)
        || record.contactsRevision !== null && (!Number.isSafeInteger(record.contactsRevision) || record.contactsRevision < 0)
        || typeof record.uncertain !== 'boolean' || record.assignment !== null && (!exact(record.assignment, ['contactId','sessionIds','boothIds'])
          || !ID.test(record.assignment.contactId ?? '') || !ids(record.assignment.sessionIds) || !ids(record.assignment.boothIds))) return false;
    } else if (type === 'event') {
      if (!exact(record, ['fields','faqItems']) || !contentFormValue(type, record.fields) || !Array.isArray(record.faqItems) || record.faqItems.length > 20
        || record.faqItems.some(item => !exact(item, ['question','answer']) || !text(item.question, 500) || !text(item.answer, 4000))) return false;
    } else if (!exact(record, ['editingId','fields','imageNeedsReselect']) || record.editingId !== null && !ID.test(record.editingId ?? '')
      || !contentFormValue(type, record.fields) || !ID.test(record.fields.id ?? '') || record.editingId !== null && record.editingId !== record.fields.id
      || typeof record.imageNeedsReselect !== 'boolean' || record.imageNeedsReselect && !['guest','showcase','organization'].includes(type)) return false;
  }
  if (kind === 'pending_submission' ? !value.pendingSave : value.pendingSave !== null) return false;
  if (value.pendingSave !== null) {
    const pending = contentSaveSnapshot(value.pendingSave.expectedRevision, value.pendingSave.content);
    if (!exact(value.pendingSave, ['expectedRevision','content']) || !pending || pending.content.eventId !== value.content.eventId
      || JSON.stringify(pending) !== JSON.stringify(value.pendingSave)) return false;
  }
  return true;
}
/** Legacy snapshots still contain the whole workspace, even when one raw form identifies where to resume. */
export function contentDraftLocation(value) {
  if (!contentLocalDraftValue(value,{kind:value?.pendingSave?'pending_submission':'editing'})) return null;
  const legacy=!Object.hasOwn(value,'section'),sections=[...new Set(Object.keys(formSections).filter(type=>Object.hasOwn(value.forms,type)).map(type=>formSections[type]))];
  if(!sections.length&&!legacy)sections.push(value.section);
  return {section:sections.length===1?sections[0]:null,sections,legacy,
    requiresReview:legacy||sections.length!==1||sections.some(section=>section!==value.section)};
}
/** Only the controller's first definitive rejection can use this atomic transition. Restored attempts remain unknown. */
function rejectContentPending(value) {
  if(value?.uncertain!==false||!contentLocalDraftValue(value,{kind:'pending_submission'}))return false;
  const {uncertain,pendingSave,...editing}=value;
  return {...editing,pendingSave:null};
}
export const CONTENT_DRAFT_POLICY = Object.freeze({
  fields: ['schemaVersion','roleKey','content','forms','pendingSave','section','uncertain'], pendingFields: ['pendingSave'], jsonFields: ['content','forms','pendingSave'],
  validate: contentLocalDraftValue,rejectPending:rejectContentPending,
});
/** Copy is deliberately a form/content whitelist, never an auth or image envelope. */
export function contentDraftCopy(value) {
  if (!contentLocalDraftValue(value, {kind: value?.pendingSave ? 'pending_submission' : 'editing'})) throw new Error('暂存内容无法核对，未复制。');
  return JSON.stringify({ eventId: value.content.eventId, ...(Object.hasOwn(value,'section')?{section:value.section}:{}), content: value.content, unappliedForms: value.forms }, null, 2);
}
