import { canManageEventOperations } from '../../shared/staff-permissions.mjs';
import { validateImportedContact, createEmptyContactOperations, CONTACT_SCHEMA_VERSION, MAX_IMPORT_ROWS, HUODONGXING_SOURCE_EVENT_ID, HUODONGXING_SOURCE_KEY, HUODONGXING_TICKET_FIELDS, validateHuodongxingTicketRow } from '../../shared/contacts-schema.mjs';
import { failure, plainData, revision, identifier, iso } from './errors.mjs';
import { readContactSnapshot, validateSnapshotContact, contactHash } from './contact-snapshot.mjs';

const HASH = /^[a-f0-9]{64}$/u;
const sourceIdentity = contact => contact.source.key + '\0' + contact.source.rowId;
export function rowsSourceDigest(sourceKey, rows) { return contactHash(JSON.stringify({ sourceKey, rows })); }

/** Pure plan. Existing source identities keep subsequent staff edits; no merge,
 * overwrite, fabricated consent or process-local preview token. */
export function prepareIntentContactImport({ snapshot, existingContacts = [] } = {}) {
  const source = readContactSnapshot(snapshot);
  if (!Array.isArray(existingContacts)) throw failure();
  const target = new Map(), identities = new Map();
  for (const contact of existingContacts) {
    validateSnapshotContact(contact);
    if (target.has(contact.id) || identities.has(sourceIdentity(contact))) throw failure();
    target.set(contact.id, contact); identities.set(sourceIdentity(contact), contact);
  }
  const rows = []; let added = 0, unchanged = 0, conflicts = 0, possibleDuplicates = 0;
  for (const contact of source.contacts) {
    const current = target.get(contact.id) ?? identities.get(sourceIdentity(contact));
    const status = current ? current.id === contact.id && current.source.digest === contact.source.digest ? 'unchanged' : 'source_changed' : 'new';
    const duplicateContactIds = [...existingContacts, ...source.contacts].filter(other => other.id !== contact.id
      && (contact.profile.email && other.profile.email.toLowerCase() === contact.profile.email.toLowerCase()
        || contact.profile.wechat && other.profile.wechat.toLowerCase() === contact.profile.wechat.toLowerCase())).map(other => other.id);
    if (status === 'new') added++; else if (status === 'unchanged') unchanged++; else conflicts++;
    if (duplicateContactIds.length && status === 'new') possibleDuplicates++;
    rows.push({ contact, status, duplicateContactIds: [...new Set(duplicateContactIds)] });
  }
  return { digest: contactHash(snapshot), sourceRevision: source.revision, sourceAudit: source.audit,
    summary: { total: rows.length, new: added, added, unchanged, conflicts, invalid: 0, possibleDuplicates }, canCommit: conflicts === 0, rows };
}

function inputSnapshot(input, actorId, now, allowPossibleDuplicates = false, allowHuodongxing = false) {
  if (!plainData(input) || !['snapshot', 'rows'].includes(input.kind) || !HASH.test(input.originalSha256 ?? '')) throw failure('INVALID_INPUT', 400);
  if (input.kind === 'snapshot') {
    if (typeof input.snapshot !== 'string' || contactHash(input.snapshot) !== input.originalSha256) throw failure('INVALID_INPUT', 400);
    const checked=readContactSnapshot(input.snapshot);if(!allowHuodongxing&&checked.contacts.some(contact=>contact.source.key===HUODONGXING_SOURCE_KEY))throw failure('INVALID_INPUT',400);
    return { snapshot: input.snapshot, sourceDigest: contactHash(input.snapshot), sourceKind: 'snapshot', sourceFileSha256: input.originalSha256 };
  }
  if(!allowHuodongxing&&input.sourceKey===HUODONGXING_SOURCE_KEY)throw failure('INVALID_INPUT',400);
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/u.test(input.sourceKey ?? '') || !Array.isArray(input.rows) || !input.rows.length || input.rows.length > MAX_IMPORT_ROWS
    || typeof input.sourceFileBase64 !== 'string' || input.sourceFileBase64.length > Math.ceil(2 * 1024 * 1024 / 3) * 4
    || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(input.sourceFileBase64)) throw failure('INVALID_INPUT', 400);
  const file = Buffer.from(input.sourceFileBase64, 'base64');
  if (!file.length || file.length > 2 * 1024 * 1024 || file.toString('base64') !== input.sourceFileBase64 || contactHash(file) !== input.originalSha256) throw failure('INVALID_INPUT', 400);
  const seen = new Set(), normalized = [];
  for (const row of input.rows) {
    if (!plainData(row)) throw failure('INVALID_INPUT', 400);
    const result = validateImportedContact(row);
    if (!result.valid || seen.has(result.value.sourceRowId)) throw failure('INVALID_INPUT', 400);
    seen.add(result.value.sourceRowId); normalized.push(result.value);
  }
  let at; try { at = new Date(now()).toISOString(); } catch { throw failure(); }
  if (!iso(at)) throw failure();
  const contacts = normalized.map(({ sourceRowId, ...profile }) => ({ id: 'c_' + contactHash(input.sourceKey + '\0' + sourceRowId).slice(0, 32),
    source: { key: input.sourceKey, rowId: sourceRowId, digest: contactHash(JSON.stringify(profile)), importedAt: at },
    profile, operations: createEmptyContactOperations(), invitation: { settings: null, generatedAt: null, sentAt: null, sentGenerationAt: null, channel: null }, createdAt: at, updatedAt: at }));
  // The actual staff-reviewed normalization import is audited now; no fake
  // historic creation. Original XLSX bytes are hashed then discarded.
  const snapshot = JSON.stringify({ storageVersion: CONTACT_SCHEMA_VERSION, revision: 1, contacts,
    audit: [{ action: 'import_contacts', actorId, revision: 1, at, added: contacts.length, unchanged: 0, duplicateReviewAccepted: allowPossibleDuplicates }] });
  readContactSnapshot(snapshot);
  return { snapshot, sourceDigest: rowsSourceDigest(input.sourceKey, normalized), sourceKind: 'rows', sourceFileSha256: input.originalSha256 };
}
function staff(actor) {
  if (!plainData(actor) || !identifier(actor.id) || !Array.isArray(actor.roles) || !actor.roles.some(role => ['outreach', 'superadmin'].includes(role))) throw failure('FORBIDDEN', 403);
  return actor.id;
}
const token = (source, expectedRevision, actorId) => contactHash(JSON.stringify({ kind: source.sourceKind, payload: source.sourceDigest, file: source.sourceFileSha256, expectedRevision, actorId }));

/** Stateless, revision- and digest-bound preview, with one journal commit. */
export function createIntentContactImporter({ contactsStore, now = () => Date.now() } = {}) {
  if (!contactsStore || typeof contactsStore.read !== 'function' || typeof now !== 'function') throw new TypeError('Explicit contacts repository required.');
  async function load() { try { const roster = await contactsStore.read(); if (!revision(roster?.revision) || !Array.isArray(roster.contacts)) throw failure(); return roster; } catch { throw failure(); } }
  return Object.freeze({
    async preview({ actor, ...input } = {}) {
      const actorId = staff(actor), source = inputSnapshot(input, actorId, now), roster = await load();
      const plan = prepareIntentContactImport({ snapshot: source.snapshot, existingContacts: roster.contacts });
      return { previewToken: token(source, roster.revision, actorId), expectedRevision: roster.revision,
        summary: plan.summary, rows: [], canCommit: plan.canCommit, sourceDigest: source.sourceDigest };
    },
    async commit({ expectedRevision, previewToken, allowPossibleDuplicates = false, confirmSource = false, actor, ...input } = {}) {
      const actorId = staff(actor);
      if (!revision(expectedRevision) || typeof allowPossibleDuplicates !== 'boolean' || confirmSource !== true || typeof contactsStore.importContacts !== 'function') throw failure('INVALID_INPUT', 400);
      const source = inputSnapshot(input, actorId, now, allowPossibleDuplicates);
      if (previewToken !== token(source, expectedRevision, actorId)) throw failure('REVISION_CONFLICT', 409);
      const roster = await load(), plan = prepareIntentContactImport({ snapshot: source.snapshot, existingContacts: roster.contacts });
      if (!plan.canCommit || plan.summary.possibleDuplicates && !allowPossibleDuplicates) throw failure('REVISION_CONFLICT', 409);
      let result;
      try { result = await contactsStore.importContacts({ expectedRevision, ...source, actorId, allowPossibleDuplicates }); }
      catch (error) { if (error?.status === 409) throw failure('REVISION_CONFLICT', 409); if (error?.status === 422) throw failure('INVALID_INPUT', 422); throw failure(); }
      if (result?.committed !== true || result?.sourceDigest !== source.sourceDigest || !revision(result.revision)
        || typeof result.imported !== 'boolean' || result.imported && result.revision !== expectedRevision + 1 || !result.imported && result.revision < expectedRevision) throw failure();
      const confirmed = await load();
      if (confirmed.revision < result.revision) throw failure();
      return { revision: confirmed.revision, contacts: confirmed.contacts, summary: plan.summary, imported: result.imported };
    },
  });
}

// External tickets have a separate private journal. Uploads and reads never
// invoke the invitation/confirmation sender or impersonate website consent.
const HUI_OPERATION = /^[a-f0-9]{64}$/u;
const HUI_REGISTRATION = /^[A-Za-z0-9_-]{43}$/u;
const HUI_MAX_BYTES = 1024 * 1024;
const HUI_RESULT_STATUSES = ['imported','linked','existing','needs_review','capacity_conflict'];
const huiExact = (value,keys) => plainData(value) && Object.keys(value).length===keys.length && keys.every(key=>Object.hasOwn(value,key));
const huiText = (value,max=1000) => typeof value==='string' && value.isWellFormed() && [...value].length<=max && !/[\u0000-\u001f\u007f-\u009f]/u.test(value);
const huiRowValue = row => Object.fromEntries(HUODONGXING_TICKET_FIELDS.filter(key=>key!=='sourceRow').map(key=>[key,row[key]]));
const huiRowDigest = row => contactHash(JSON.stringify(huiRowValue(row)));
const huiContactId = tid => 'c_'+contactHash(HUODONGXING_SOURCE_KEY+'\0'+tid).slice(0,32);
const huiProfile = row => {
  const checked=validateImportedContact({sourceRowId:row.tid,name:row.name,email:row.email,phone:row.phone,wechat:row.wechat,submittedAt:row.registeredAt});
  if(!checked.valid)throw failure('INVALID_INPUT',422);
  const {sourceRowId,...profile}=checked.value;return profile;
};
function huiStaff(actor) {
  if(!plainData(actor)||!/^[A-Za-z0-9_-]{1,80}$/u.test(actor.id??'')||!canManageEventOperations(actor))throw failure('FORBIDDEN',403);
  return actor.id;
}
function huiResume(input) {
  return Object.fromEntries(['sourceEventId','originalSha256','expectedRevision','expectedTicketRevision','expectedAdmissionRevision','previewToken','selectedTids','links','separateTids','confirmSource','confirmPermission','permissionReference'].map(key=>[key,structuredClone(input[key])]));
}
function huiRowIssue(row) {
  if(row.status!=='有效票')return 'TICKET_STATUS_REVIEW';
  if(!row.name)return 'NAME_MISSING';if(!row.email)return 'EMAIL_MISSING';if(!row.registeredAt)return 'REGISTRATION_TIME_MISSING';
  return null;
}
export function validateHuodongxingLedger(input) {
  if(!huiExact(input,['schemaVersion','kind','eventId','sourceEventId','revision','tickets','operations','audit'])||input.schemaVersion!==1||input.kind!=='huodongxing_ticket_ledger'||input.eventId!=='ggj-cn-2026'||input.sourceEventId!==HUODONGXING_SOURCE_EVENT_ID||!revision(input.revision)
    ||!Array.isArray(input.tickets)||input.tickets.length>1000||!Array.isArray(input.operations)||input.operations.length>1000||!Array.isArray(input.audit)||input.audit.length!==input.revision||input.audit.length>2000||Buffer.byteLength(JSON.stringify(input))>=HUI_MAX_BYTES)throw failure();
  const tids=new Set(),operations=new Set();
  for(const ticket of input.tickets){
    if(!huiExact(ticket,['tid','row','rowDigest','contactId','registrationId','sourceFileSha256','permissionReference','actorId','recordedAt'])||!plainData(ticket.row))throw failure();
    const checked=validateHuodongxingTicketRow({sourceRow:2,...ticket.row});
    if(!checked.valid||JSON.stringify(huiRowValue(checked.value))!==JSON.stringify(ticket.row)||ticket.tid!==checked.value.tid||huiRowIssue(checked.value)||tids.has(ticket.tid)||ticket.contactId!==huiContactId(ticket.tid)||!HUI_REGISTRATION.test(ticket.registrationId)||ticket.rowDigest!==huiRowDigest(checked.value)||!HASH.test(ticket.sourceFileSha256)||!huiText(ticket.permissionReference)||!ticket.permissionReference.trim()||!identifier(ticket.actorId)||!iso(ticket.recordedAt))throw failure();
    tids.add(ticket.tid);
  }
  for(const op of input.operations){
    if(!huiExact(op,['operationId','requestHash','actorId','startedAt','updatedAt','finished','status','reservedBytes','resume','results'])||!HUI_OPERATION.test(op.operationId)||!HASH.test(op.requestHash)||operations.has(op.operationId)||!identifier(op.actorId)||!iso(op.startedAt)||!iso(op.updatedAt)||op.updatedAt<op.startedAt||typeof op.finished!=='boolean'||!Number.isSafeInteger(op.reservedBytes)||op.reservedBytes<1000||op.reservedBytes>=HUI_MAX_BYTES||!['pending','partial','completed'].includes(op.status)||!Array.isArray(op.results)||!huiExact(op.resume,['sourceEventId','originalSha256','expectedRevision','expectedTicketRevision','expectedAdmissionRevision','previewToken','selectedTids','links','separateTids','confirmSource','confirmPermission','permissionReference']))throw failure();
    const r=op.resume;if(r.sourceEventId!==HUODONGXING_SOURCE_EVENT_ID||!HASH.test(r.originalSha256)||!['expectedRevision','expectedTicketRevision','expectedAdmissionRevision'].every(key=>revision(r[key]))||!HASH.test(r.previewToken)||r.confirmSource!==true||r.confirmPermission!==true||!huiText(r.permissionReference)||!r.permissionReference.trim()||!Array.isArray(r.selectedTids)||!r.selectedTids.length||r.selectedTids.length>100||r.selectedTids.some(tid=>!huiText(tid,100)||!tid)||new Set(r.selectedTids).size!==r.selectedTids.length||!Array.isArray(r.links)||!Array.isArray(r.separateTids)||r.links.length>100||r.separateTids.length>100)throw failure();
    const resolutions=new Set();for(const link of r.links){if(!huiExact(link,['tid','registrationId'])||!r.selectedTids.includes(link.tid)||!HUI_REGISTRATION.test(link.registrationId)||resolutions.has(link.tid))throw failure();resolutions.add(link.tid);}for(const tid of r.separateTids){if(!r.selectedTids.includes(tid)||resolutions.has(tid))throw failure();resolutions.add(tid);}
    const results=new Set();for(const result of op.results){if(!huiExact(result,['tid','status','contactId','registrationId','reason'])||!r.selectedTids.includes(result.tid)||results.has(result.tid)||!HUI_RESULT_STATUSES.includes(result.status)||result.contactId!==huiContactId(result.tid)||result.registrationId!==null&&!HUI_REGISTRATION.test(result.registrationId)||result.reason!==null&&!huiText(result.reason,100)||['imported','linked','existing'].includes(result.status)&&result.registrationId===null)throw failure();results.add(result.tid);}
    if(op.finished!==(op.results.length===r.selectedTids.length)||op.status!==(op.finished&&op.results.every(row=>['imported','linked','existing'].includes(row.status))?'completed':op.results.length?'partial':'pending'))throw failure();
    operations.add(op.operationId);
  }
  let previous='';for(const [index,item]of input.audit.entries()){if(!huiExact(item,['revision','action','operationId','actorId','at','tid'])||item.revision!==index+1||!['started','ticket_result'].includes(item.action)||!operations.has(item.operationId)||!identifier(item.actorId)||!iso(item.at)||item.at<previous||item.action==='started'&&item.tid!==null||item.action==='ticket_result'&&(!huiText(item.tid,100)||!item.tid))throw failure();previous=item.at;}
  for(const op of input.operations){const audits=input.audit.filter(item=>item.operationId===op.operationId);if(audits.some(item=>item.actorId!==op.actorId||item.at<op.startedAt)||audits.filter(item=>item.action==='started').length!==1||audits.filter(item=>item.action==='ticket_result').length!==op.results.length)throw failure();for(const [index,result]of op.results.entries()){if(result.tid!==op.resume.selectedTids[index]||audits.filter(item=>item.action==='ticket_result'&&item.tid===result.tid).length!==1)throw failure();}if(audits.some(item=>item.action==='ticket_result'&&!op.results.some(result=>result.tid===item.tid)))throw failure();}
  for(const ticket of input.tickets){if(!input.operations.some(op=>op.actorId===ticket.actorId&&op.resume.originalSha256===ticket.sourceFileSha256&&op.resume.permissionReference===ticket.permissionReference&&op.startedAt<=ticket.recordedAt&&op.results.some(result=>['imported','linked'].includes(result.status)&&result.tid===ticket.tid&&result.contactId===ticket.contactId&&result.registrationId===ticket.registrationId)))throw failure();}
  return structuredClone(input);
}

/** Fixed-event, staff-attested normalized import. The bytes are provenance,
 * never a claim that this service reparsed XLSX or queried the external platform. */
export function createHuodongxingImporter({contactsStore,registrationService,journal,now=()=>Date.now(),inactiveRegistrationIds,currentProfiles,currentProfileRevision}={}) {
  if(!contactsStore||!['read','importContacts'].every(key=>typeof contactsStore[key]==='function')||!registrationService||!['getStaffRegistrationBySource','submitStaffRegistration','getAdmissionStatus','managePerson'].every(key=>typeof registrationService[key]==='function')||!journal||!['read','commit'].every(key=>typeof journal[key]==='function'))throw new TypeError('External ticket dependencies required.');
  const at=()=>{const value=new Date(now()).toISOString();if(!iso(value))throw failure();return value;};
  async function ledger(){const saved=await journal.read();if(!saved||!revision(saved.cursor?.version))throw failure();if(saved.value===null){if(saved.cursor.version!==0)throw failure();return {cursor:saved.cursor,value:{schemaVersion:1,kind:'huodongxing_ticket_ledger',eventId:'ggj-cn-2026',sourceEventId:HUODONGXING_SOURCE_EVENT_ID,revision:0,tickets:[],operations:[],audit:[]}};}const value=validateHuodongxingLedger(saved.value);if(value.revision!==saved.cursor.version)throw failure();return {...saved,value};}
  async function save(current,next,action,op,tid=null){const timestamp=at();next.revision=current.value.revision+1;next.audit.push({revision:next.revision,action,operationId:op.operationId,actorId:op.actorId,at:timestamp,tid});validateHuodongxingLedger(next);try{const saved=await journal.commit(current.cursor,next);if(JSON.stringify(saved.value)!==JSON.stringify(next)||saved.cursor.version!==next.revision)throw failure();return saved;}catch(error){if(error?.code==='WRITE_CONFLICT')throw failure('REVISION_CONFLICT',409);throw failure();}}
  function source(input){
    if(!plainData(input)||input.kind!=='huodongxing'||input.sourceEventId!==HUODONGXING_SOURCE_EVENT_ID||!HASH.test(input.originalSha256)||typeof input.sourceFileBase64!=='string'||input.sourceFileBase64.length>Math.ceil(2*1024*1024/3)*4||!Array.isArray(input.rows)||!input.rows.length||input.rows.length>MAX_IMPORT_ROWS)throw failure('INVALID_INPUT',400);
    const file=Buffer.from(input.sourceFileBase64,'base64');if(!file.length||file.length>2*1024*1024||file.toString('base64')!==input.sourceFileBase64||contactHash(file)!==input.originalSha256)throw failure('INVALID_INPUT',400);
    const rows=[],seen=new Set();for(const row of input.rows){const check=validateHuodongxingTicketRow(row);if(!check.valid||seen.has(check.value.tid))throw failure('INVALID_INPUT',422);seen.add(check.value.tid);rows.push(check.value);}
    return {rows,digest:contactHash(JSON.stringify(rows.map(huiRowValue))),file:input.originalSha256};
  }
  async function state(){const [roster,index,saved]=await Promise.all([contactsStore.read(),registrationService.repository.readIndex(),ledger()]);if(!revision(roster?.revision)||!Array.isArray(roster.contacts))throw failure();return {roster,index,saved};}
  function canonical(index,id){return index.value.admissions?.personGroups?.find(group=>group.registrationIds.includes(id))?.primaryRegistrationId??id;}
  const readCache=()=>({records:new Map(),review:null});
  async function reviewed(cache){
    const revisionBefore=currentProfileRevision?await currentProfileRevision():null;if(revisionBefore!==null&&!revision(revisionBefore))throw failure();if(cache.review&&revisionBefore!==null&&cache.review.revision===revisionBefore)return cache.review;
    const [profiles,inactive]=await Promise.all([currentProfiles?currentProfiles():{},inactiveIds()]);if(!plainData(profiles)||Object.keys(profiles).length>1000)throw failure();const revisionAfter=currentProfileRevision?await currentProfileRevision():null;if(revisionBefore!==revisionAfter)throw failure('REVISION_CONFLICT',409);cache.review={revision:revisionAfter,profiles,inactive};return cache.review;
  }
  async function registrationRows(index,cache=readCache()){
    const {profiles,inactive}=await reviewed(cache),entries=index.value.entries.filter(entry=>canonical(index,entry.id)===entry.id),rows=new Array(entries.length);let position=0;
    await Promise.all(Array.from({length:Math.min(8,entries.length)},async()=>{while(position<entries.length){const offset=position++,entry=entries[offset];let original=cache.records.get(entry.recordHash);if(!original){original=await registrationService.repository.readRecord(entry);cache.records.set(entry.recordHash,original);}if(original.id!==entry.id||!plainData(original.fields))throw failure();const correction=profiles[entry.id];if(correction!==undefined&&(!plainData(correction)||!plainData(correction.fields)))throw failure();const fields={...original.fields,...(correction?.fields??{})};for(const key of ['name','organization','email','phone','wechat'])if(fields[key]!==undefined&&typeof fields[key]!=='string')throw failure();const status=(await admissionAt(index,entry.id,inactive)).status;rows[offset]={registrationId:entry.id,name:fields.name,organization:fields.organization??'',email:fields.email??'',phone:fields.phone??'',wechat:fields.wechat??'',status};}}));
    return rows;
  }
  function matches(row,other){return row.email&&other.email?.toLowerCase()===row.email||row.phone&&other.phone===row.phone||row.wechat&&other.wechat===row.wechat||row.name&&other.name===row.name;}
  async function otherRegistrationCandidate(row,contactId,actor,cache){const found=await registrationService.getStaffRegistrationBySource({sourceContactId:contactId,actor});if(!['found','not_found'].includes(found.outcome))throw failure();const own=found.receipt?.registrationId;return (await registrationRows(await registrationService.repository.readIndex(),cache)).some(other=>other.registrationId!==own&&matches(row,other));}
  function remainingReservations(value){const remaining=value.operations.filter(op=>!op.finished).flatMap(op=>op.resume.selectedTids.filter(tid=>!op.results.some(row=>row.tid===tid)));return {audits:remaining.length,tickets:new Set(remaining.filter(tid=>!value.tickets.some(ticket=>ticket.tid===tid))).size};}
  async function plan(source,snapshot,actorId,cache=readCache()){
    const registrations=await registrationRows(snapshot.index,cache),rows=[];
    for(const row of source.rows){const contactId=huiContactId(row.tid),ticket=snapshot.saved.value.tickets.find(item=>item.tid===row.tid),contact=snapshot.roster.contacts.find(item=>item.id===contactId);let reason=huiRowIssue(row),registrationId=ticket?.registrationId??null,status='new';
      const candidates=registrations.filter(other=>matches(row,other)).map(({registrationId,name,organization,status})=>({registrationId,name,organization,status}));
      if(ticket){status='existing';if(ticket.rowDigest!==huiRowDigest(row))reason='SOURCE_CHANGED';else{registrationId=canonical(snapshot.index,ticket.registrationId);const current=await registrationService.getAdmissionStatus(registrationId);if(current.status!=='confirmed')reason='ADMISSION_'+current.status.toUpperCase();}}
      if(contact&&(contact.archivedAt||contact.source.key!==HUODONGXING_SOURCE_KEY||contact.source.rowId!==row.tid||!huiRowIssue(row)&&contact.source.digest!==contactHash(JSON.stringify(huiProfile(row)))))reason='SOURCE_CHANGED';
      if(contact&&(contact.profile.contactConsent==='declined'||contact.operations.responseStatus==='declined'))reason='CONTACT_DECLINED';
      if(!reason&&!ticket&&(candidates.length||snapshot.roster.contacts.some(other=>other.id!==contactId&&matches(row,{name:other.profile.name,email:other.profile.email,phone:other.profile.phone,wechat:other.profile.wechat}))||source.rows.some(other=>other.tid!==row.tid&&matches(row,other))))reason='POSSIBLE_DUPLICATE';
      const canSelect=!reason||reason==='POSSIBLE_DUPLICATE';if(reason)status='needs_review';
      rows.push({tid:row.tid,sourceRow:row.sourceRow,name:row.name,email:row.email,status,reason,contactId,registrationId,candidates,canSelect});
    }
    const revisions={expectedRevision:snapshot.roster.revision,expectedTicketRevision:snapshot.saved.value.revision,expectedAdmissionRevision:snapshot.index.value.revision};
    return {kind:'huodongxing',sourceEventId:HUODONGXING_SOURCE_EVENT_ID,...revisions,previewToken:contactHash(JSON.stringify({actorId,file:source.file,digest:source.digest,...revisions})),summary:{total:rows.length,new:rows.filter(row=>row.status==='new').length,existing:rows.filter(row=>row.status==='existing').length,needsReview:rows.filter(row=>row.status==='needs_review').length,eligible:rows.filter(row=>row.canSelect).length},rows,canCommit:rows.some(row=>row.canSelect)};
  }
  async function inactiveIds(){if(inactiveRegistrationIds===undefined)return null;if(typeof inactiveRegistrationIds!=='function')throw failure();const ids=await inactiveRegistrationIds();if(!Array.isArray(ids)||ids.length>1000||ids.some(id=>!HUI_REGISTRATION.test(id)))throw failure();return new Set(ids);}
  async function admissionAt(index,id,inactive){return inactive===null?await registrationService.getAdmissionStatus(id):{status:inactive.has(id)?'withdrawn':index.value.admissions?.people?.[id]?.status??'unavailable'};}
  async function projection(op){const index=await registrationService.repository.readIndex(),inactive=await inactiveIds(),roster=await contactsStore.read(),results=[];for(const result of op.results){let current=structuredClone(result);if(['imported','linked','existing'].includes(current.status)){const id=canonical(index,current.registrationId),admission=await admissionAt(index,id,inactive),group=index.value.admissions?.personGroups?.find(item=>item.registrationIds.includes(id)),contacts=roster.contacts.filter(item=>group?.contactIds.includes(item.id)||item.id===current.contactId);current.registrationId=id;if(contacts.some(item=>item.archivedAt||item.profile.contactConsent==='declined'||item.operations.responseStatus==='declined'))current={...current,status:'needs_review',reason:'CONTACT_DECLINED'};else if(admission.status!=='confirmed')current={...current,status:'needs_review',reason:'ADMISSION_'+admission.status.toUpperCase()};}results.push(current);}return {kind:'huodongxing',operationId:op.operationId,status:op.finished&&results.some(row=>!['imported','linked','existing'].includes(row.status))?'partial':op.status,finished:op.finished,results,registrationIds:[...new Set(results.filter(row=>['imported','linked','existing'].includes(row.status)).map(row=>row.registrationId))],resume:structuredClone(op.resume)};}

  function selection(input,source){
    if(!HUI_OPERATION.test(input.operationId)||!['expectedRevision','expectedTicketRevision','expectedAdmissionRevision'].every(key=>revision(input[key]))||!HASH.test(input.previewToken)||input.confirmSource!==true||input.confirmPermission!==true||!huiText(input.permissionReference)||!input.permissionReference.trim()||!Array.isArray(input.selectedTids)||!input.selectedTids.length||input.selectedTids.length>100||new Set(input.selectedTids).size!==input.selectedTids.length||input.selectedTids.some(tid=>!source.rows.some(row=>row.tid===tid))||!Array.isArray(input.links)||!Array.isArray(input.separateTids)||input.links.length>100||input.separateTids.length>100)throw failure('INVALID_INPUT',400);
    const seen=new Set();for(const link of input.links){if(!huiExact(link,['tid','registrationId'])||!input.selectedTids.includes(link.tid)||!HUI_REGISTRATION.test(link.registrationId)||seen.has(link.tid))throw failure('INVALID_INPUT',400);seen.add(link.tid);}for(const tid of input.separateTids){if(!input.selectedTids.includes(tid)||seen.has(tid))throw failure('INVALID_INPUT',400);seen.add(tid);}
  }
  async function permission(record,roster){const snapshot=await state(),ticket=snapshot.saved.value.tickets.find(item=>canonical(snapshot.index,item.registrationId)===record.id);if(!ticket)return {eligible:false,reason:'STAFF_PERMISSION_REQUIRED'};const contact=(roster??snapshot.roster).contacts.find(item=>item.id===ticket.contactId);if(!contact||contact.archivedAt)return {eligible:false,reason:'CONTACT_NOT_FOUND'};if(contact.profile.contactConsent==='declined'||contact.operations.responseStatus==='declined')return {eligible:false,reason:'CONTACT_DECLINED'};if(contact.source.key!==HUODONGXING_SOURCE_KEY||contact.source.rowId!==ticket.tid||contact.source.digest!==contactHash(JSON.stringify(huiProfile({...ticket.row,sourceRow:2}))))return {eligible:false,reason:'STAFF_PERMISSION_REQUIRED'};if(!(record.profileCorrection?.accessRevision>0)&&contact.profile.email!==record.fields.email)return {eligible:false,reason:'CONTACT_EMAIL_CHANGED'};return {eligible:true};}
  return Object.freeze({
    async preview({actor,...input}={}){const actorId=huiStaff(actor),parsed=source(input);return plan(parsed,await state(),actorId);},
    async operation({actor,operationId}={}){huiStaff(actor);if(!HUI_OPERATION.test(operationId))throw failure('INVALID_INPUT',400);const op=(await ledger()).value.operations.find(item=>item.operationId===operationId);if(!op)throw failure('CONTACT_NOT_FOUND',404);return projection(op);},
    deliveryPermission:permission,
    async attendanceEvidence({registrationIds}={}){
      if(!Array.isArray(registrationIds)||registrationIds.length>1000||registrationIds.some(id=>!HUI_REGISTRATION.test(id))||new Set(registrationIds).size!==registrationIds.length)throw failure('INVALID_INPUT',400);
      const snapshot=await state(),verified=[],inactive=await inactiveIds();
      for(const registrationId of registrationIds){if(canonical(snapshot.index,registrationId)!==registrationId)continue;const tickets=snapshot.saved.value.tickets.filter(item=>canonical(snapshot.index,item.registrationId)===registrationId);if(!tickets.length)continue;
        if((await admissionAt(snapshot.index,registrationId,inactive)).status!=='confirmed')continue;const group=snapshot.index.value.admissions?.personGroups?.find(item=>item.registrationIds.includes(registrationId));if(group&&snapshot.roster.contacts.some(contact=>group.contactIds.includes(contact.id)&&(contact.archivedAt||contact.profile.contactConsent==='declined'||contact.operations.responseStatus==='declined')))continue;
        if(tickets.some(ticket=>{const contact=snapshot.roster.contacts.find(item=>item.id===ticket.contactId);return contact&&!contact.archivedAt&&contact.profile.contactConsent!=='declined'&&contact.operations.responseStatus!=='declined'&&contact.source.key===HUODONGXING_SOURCE_KEY&&contact.source.rowId===ticket.tid&&contact.source.digest===contactHash(JSON.stringify(huiProfile({...ticket.row,sourceRow:2})));}))verified.push(registrationId);
      }
      return {kind:'huodongxing',verified:true,sourceEventId:HUODONGXING_SOURCE_EVENT_ID,revision:snapshot.saved.value.revision,registrationIds:verified};
    },
    async commit({actor,...input}={}){
      const actorId=huiStaff(actor),parsed=source(input),cache=readCache();selection(input,parsed);const requestHash=contactHash(JSON.stringify(input));let current=await ledger(),op=current.value.operations.find(item=>item.operationId===input.operationId);
      if(op){if(op.requestHash!==requestHash||op.actorId!==actorId)throw failure('REVISION_CONFLICT',409);if(op.finished)return projection(op);}
      else{
        const snapshot=await state(),preview=await plan(parsed,snapshot,actorId,cache);if(input.previewToken!==preview.previewToken||input.expectedRevision!==preview.expectedRevision||input.expectedTicketRevision!==preview.expectedTicketRevision||input.expectedAdmissionRevision!==preview.expectedAdmissionRevision)throw failure('REVISION_CONFLICT',409);
        for(const tid of input.selectedTids){const row=preview.rows.find(item=>item.tid===tid);if(!row.canSelect||row.reason==='POSSIBLE_DUPLICATE'&&!input.links.some(link=>link.tid===tid)&&!input.separateTids.includes(tid))throw failure('INVALID_INPUT',422);const link=input.links.find(link=>link.tid===tid);if(link&&!row.candidates.some(candidate=>candidate.registrationId===link.registrationId&&candidate.status==='confirmed'))throw failure('INVALID_INPUT',422);}
        const reserved=remainingReservations(snapshot.saved.value);
        const timestamp=at();op={operationId:input.operationId,requestHash,actorId,startedAt:timestamp,updatedAt:timestamp,finished:false,status:'pending',reservedBytes:1,resume:huiResume(input),results:[]};
        // Bound the entire planned ledger before touching contact or admission
        // journals. File bytes never enter this snapshot or its backups.
        const projected=structuredClone(snapshot.saved.value);projected.operations.push({...op,finished:true,status:'completed',results:input.selectedTids.map(tid=>({tid,status:'imported',contactId:huiContactId(tid),registrationId:'r'.repeat(43),reason:null}))});
        for(const tid of input.selectedTids)if(!projected.tickets.some(ticket=>ticket.tid===tid)){const row=parsed.rows.find(item=>item.tid===tid);projected.tickets.push({tid,row:huiRowValue(row),rowDigest:huiRowDigest(row),contactId:huiContactId(tid),registrationId:'r'.repeat(43),sourceFileSha256:parsed.file,permissionReference:input.permissionReference,actorId,recordedAt:timestamp});}
        projected.operations.at(-1).reservedBytes=HUI_MAX_BYTES-1;projected.audit.push({revision:++projected.revision,action:'started',operationId:op.operationId,actorId,at:timestamp,tid:null});for(const tid of input.selectedTids)projected.audit.push({revision:++projected.revision,action:'ticket_result',operationId:op.operationId,actorId,at:timestamp,tid});
        op.reservedBytes=Math.max(1000,Buffer.byteLength(JSON.stringify(projected))-Buffer.byteLength(JSON.stringify(snapshot.saved.value))+1024);
        if(Buffer.byteLength(JSON.stringify(snapshot.saved.value))+snapshot.saved.value.operations.filter(item=>!item.finished).reduce((sum,item)=>sum+item.reservedBytes,0)+op.reservedBytes>=HUI_MAX_BYTES||projected.tickets.length+reserved.tickets>1000||projected.operations.length>1000||snapshot.saved.value.audit.length+reserved.audits+input.selectedTids.length+1>2000)throw failure('CAPACITY_EXCEEDED',409);
        const next=structuredClone(snapshot.saved.value);next.operations.push(op);current=await save(snapshot.saved,next,'started',op);
      }
      // Preserve the existing bounded migration archive model: one explicit
      // file operation stages its missing contacts as one batch, never one
      // archive per ticket. A lost ACK is recovered by stable source IDs.
      const stagedRoster=await contactsStore.read(),stagedLedger=await ledger(),stagedOperation=stagedLedger.value.operations.find(item=>item.operationId===input.operationId);
      const missing=parsed.rows.filter(row=>input.selectedTids.includes(row.tid)&&!stagedOperation.results.some(result=>result.tid===row.tid)&&!stagedLedger.value.tickets.some(ticket=>ticket.tid===row.tid)&&!stagedRoster.contacts.some(contact=>contact.id===huiContactId(row.tid)));
      if(missing.length){const rows=missing.map(row=>({sourceRowId:row.tid,...huiProfile(row)})),sourceValue=inputSnapshot({kind:'rows',sourceKey:HUODONGXING_SOURCE_KEY,rows,sourceFileBase64:input.sourceFileBase64,originalSha256:parsed.file},actorId,now,true,true);await contactsStore.importContacts({expectedRevision:stagedRoster.revision,...sourceValue,actorId,allowPossibleDuplicates:true});}
      for(const tid of input.selectedTids){
        current=await ledger();op=current.value.operations.find(item=>item.operationId===input.operationId);if(op.results.some(item=>item.tid===tid))continue;const pendingCapacity=remainingReservations(current.value);if(current.value.tickets.length+pendingCapacity.tickets>1000||current.value.audit.length+pendingCapacity.audits>2000)throw failure('CAPACITY_EXCEEDED',409);
        const row=parsed.rows.find(item=>item.tid===tid),contactId=huiContactId(tid);let result={tid,status:'needs_review',contactId,registrationId:null,reason:null},ticket=current.value.tickets.find(item=>item.tid===tid);
        if(ticket){const id=canonical(await registrationService.repository.readIndex(),ticket.registrationId),admission=await registrationService.getAdmissionStatus(id);if(ticket.rowDigest!==huiRowDigest(row))result.reason='SOURCE_CHANGED';else if(admission.status!=='confirmed')result.reason='ADMISSION_'+admission.status.toUpperCase();else result={...result,status:'existing',registrationId:id};}
        else{
          const issue=huiRowIssue(row);if(issue)result.reason=issue;
          else{
            let roster=await contactsStore.read(),contact=roster.contacts.find(item=>item.id===contactId);const profile=huiProfile(row),digest=contactHash(JSON.stringify(profile));
            if(contact&&(contact.source.digest!==digest||contact.source.key!==HUODONGXING_SOURCE_KEY||contact.source.rowId!==tid||contact.archivedAt))result.reason='SOURCE_CHANGED';
            else if(contact&&(contact.profile.contactConsent==='declined'||contact.operations.responseStatus==='declined'))result.reason='CONTACT_DECLINED';
            else if(!input.links.some(item=>item.tid===tid)&&!input.separateTids.includes(tid)&&(roster.contacts.some(other=>other.id!==contactId&&matches(row,{name:other.profile.name,email:other.profile.email,phone:other.profile.phone,wechat:other.profile.wechat}))||await otherRegistrationCandidate(row,contactId,actor,cache)))result.reason='POSSIBLE_DUPLICATE';
            else{
              if(!contact||contact.source.digest!==digest)throw failure();
              const link=input.links.find(item=>item.tid===tid);
              if(link){const index=await registrationService.repository.readIndex(),id=canonical(index,link.registrationId),admission=await registrationService.getAdmissionStatus(id);if(id!==link.registrationId||admission.status!=='confirmed')result.reason='LINK_CHANGED';else{const resolved=await registrationService.getStaffRegistrationBySource({sourceContactId:contactId,actor});if(!['found','not_found'].includes(resolved.outcome))throw failure();if(resolved.outcome!=='found'||resolved.receipt.registrationId!==id){const linked=await registrationService.managePerson({actor,action:'person_merge',expectedRevision:index.value.revision,operationId:contactHash(input.operationId+'\0'+tid+'\0link'),input:{keys:['contact:'+contactId,'registration:'+id],primaryKey:'registration:'+id,roles:null,contactRevision:roster.revision},verifySources:async next=>{const current=await contactsStore.read();return current.revision===roster.revision&&current.contacts.some(item=>item.id===contactId&&item.source.digest===digest)&&next.admissions.people[id]?.status==='confirmed';}});if(!['updated','replayed'].includes(linked.outcome))throw failure(linked.outcome==='conflict'?'REVISION_CONFLICT':'STORAGE_UNAVAILABLE',linked.outcome==='conflict'?409:503);}}}
              if(!result.reason){const found=await registrationService.getStaffRegistrationBySource({sourceContactId:contactId,actor});let saved=found.outcome==='found'?{outcome:'replayed',receipt:found.receipt}:null;if(found.outcome!=='found'&&found.outcome!=='not_found')throw failure();
                if(!saved){const fields={name:contact.profile.name,email:contact.profile.email,phone:contact.profile.phone,wechat:contact.profile.wechat};saved=await registrationService.submitStaffRegistration({sourceContactId:contactId,actor,input:{fields,permissionReference:input.permissionReference},requireConfirmed:true});}
                if(saved.outcome==='capacity_conflict')result={...result,status:'capacity_conflict',reason:'CAPACITY_CONFLICT'};
                else if(!['created','replayed'].includes(saved.outcome)){if(['unavailable','conflict'].includes(saved.outcome))throw failure(saved.outcome==='conflict'?'REVISION_CONFLICT':'STORAGE_UNAVAILABLE',saved.outcome==='conflict'?409:503);result.reason='REGISTRATION_'+saved.outcome.toUpperCase();}
                else{const index=await registrationService.repository.readIndex(),id=canonical(index,saved.receipt.registrationId),admission=await registrationService.getAdmissionStatus(id);if(admission.status!=='confirmed')result.reason='ADMISSION_'+admission.status.toUpperCase();else{result={...result,status:link?'linked':'imported',registrationId:id};ticket={tid,row:huiRowValue(row),rowDigest:huiRowDigest(row),contactId,registrationId:id,sourceFileSha256:parsed.file,permissionReference:input.permissionReference,actorId,recordedAt:at()};}}
              }
            }
          }
        }
        current=await ledger();const next=structuredClone(current.value);op=next.operations.find(item=>item.operationId===input.operationId);if(op.results.some(item=>item.tid===tid))continue;if(ticket&&!next.tickets.some(item=>item.tid===tid)&&result.registrationId)next.tickets.push(ticket);op.results.push(result);op.updatedAt=at();op.finished=op.results.length===op.resume.selectedTids.length;op.status=op.finished&&op.results.every(item=>['imported','linked','existing'].includes(item.status))?'completed':'partial';current=await save(current,next,'ticket_result',op,tid);
      }
      return projection(current.value.operations.find(item=>item.operationId===input.operationId));
    },
  });
}
