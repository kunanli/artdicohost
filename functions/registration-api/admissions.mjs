import { randomBytes, createHash } from 'node:crypto';
import { own, plainObject, parseTimestamp } from './policy.mjs';

export const MAX_ADMISSION_OPERATIONS = 2000;
export const MAX_ADMISSION_TEAMS = 100;
export const ADMISSION_STATUSES = Object.freeze(['confirmed', 'waitlisted', 'withdrawn', 'pending_review', 'rejected']);
const LEGACY_STATUSES = ['confirmed', 'waitlisted', 'withdrawn'];
export const ADMISSION_KINDS = Object.freeze(['attendee', 'crew']);
const ID = /^[A-Za-z0-9_-]{43}$/u;
const TEAM_ID = /^t_[A-Za-z0-9_-]{22}$/u;
const OPERATION = /^[A-Za-z0-9_-]{32,128}$/u;
const HASH = /^[a-f0-9]{64}$/u;
const ACTIONS = ['intake', 'staff_intake', 'settings', 'kind', 'withdraw', 'promote', 'team_save', 'team_remove', 'approve', 'reject', 'person_merge', 'person_roles'];
const exact = (value, names) => plainObject(value) && Reflect.ownKeys(value).length === names.length
  && names.every(name => { const field = Object.getOwnPropertyDescriptor(value, name); return field?.enumerable && Object.hasOwn(field, 'value'); });

export class AdmissionError extends Error {
  constructor(code = 'unavailable') { super('Admission operation was not verified.'); this.name = 'AdmissionError'; this.code = code; }
}
const fail = code => { throw new AdmissionError(code); };
export function validAdmissionOperation(value) { return typeof value === 'string' && OPERATION.test(value); }
export function validAdmissionId(value) { return typeof value === 'string' && ID.test(value); }

export function admissionDefaults({ capacity = 1000, staffReserve = 0, waitlistEnabled = false } = {}) {
  if (!Number.isSafeInteger(capacity) || capacity < 1 || capacity > 1000 || !Number.isSafeInteger(staffReserve) || staffReserve < 0 || staffReserve > capacity
    || typeof waitlistEnabled !== 'boolean') fail('invalid');
  return { capacity, staffReserve, waitlistEnabled };
}

/** A v1 index is interpreted conservatively without writing or changing any immutable person record. */
export function admissionView(index, defaults) {
  if ([2, 3].includes(index.schemaVersion)) return { ...structuredClone(index), schemaVersion: 3 };
  const requested = admissionDefaults(defaults);
  // A new initial reserve cannot retroactively invalidate historically accepted attendees.
  const settings = { ...requested, staffReserve: Math.min(requested.staffReserve, Math.max(0, requested.capacity - index.entries.length)) };
  const people = Object.fromEntries(index.entries.map((entry, position) => [entry.id,
    { kind: 'attendee', status: 'confirmed', queueNumber: position + 1, changedAt: entry.committedAt }]));
  const result = { ...structuredClone(index), schemaVersion: 3,
    admissions: { baseRevision: index.revision, settings, people, teams: [], audit: [] } };
  validateAdmissions(result, defaults);
  return result;
}

export function admissionSummary(index) {
  const { settings, people, teams } = index.admissions;
  const values = Object.values(people);
  const confirmed = values.filter(person => person.status === 'confirmed');
  const attendeeConfirmedCount = confirmed.filter(person => person.kind === 'attendee').length;
  const crewConfirmedCount = confirmed.length - attendeeConfirmedCount;
  return { ...settings, confirmedCount: confirmed.length, attendeeConfirmedCount, crewConfirmedCount,
    waitlistCount: values.filter(person => person.status === 'waitlisted').length,
    withdrawnCount: values.filter(person => person.status === 'withdrawn').length,
    pendingReviewCount: values.filter(person => person.status === 'pending_review').length,
    rejectedCount: values.filter(person => person.status === 'rejected').length,
    totalRegistered: values.length, teamCount: teams.length,
    remainingTotal: Math.max(0, settings.capacity - confirmed.length),
    remainingPublic: Math.max(0, Math.min(settings.capacity - confirmed.length, settings.capacity - settings.staffReserve - attendeeConfirmedCount)) };
}

export function validateAdmissions(index, defaults) {
  const value = index.admissions, statuses = index.schemaVersion === 2 ? LEGACY_STATUSES : ADMISSION_STATUSES;
  if (![2, 3].includes(index.schemaVersion) || !exact(value, ['baseRevision', 'settings', 'people', 'teams', 'audit', ...(Object.hasOwn(value ?? {},'personGroups')?['personGroups']:[])]) || !Number.isSafeInteger(value.baseRevision) || value.baseRevision < 0 || value.baseRevision > index.entries.length
    || !exact(value.settings, ['capacity', 'staffReserve', 'waitlistEnabled']) || !plainObject(value.people)
    || Object.keys(value.people).length !== index.entries.length || !Array.isArray(value.teams) || value.teams.length > MAX_ADMISSION_TEAMS
    || !Array.isArray(value.audit) || value.audit.length > MAX_ADMISSION_OPERATIONS || value.audit.length !== index.revision - value.baseRevision) fail();
  admissionDefaults(value.settings);
  if (defaults?.capacity !== undefined && value.settings.capacity !== defaults.capacity) fail();
  for (const [position, entry] of index.entries.entries()) {
    const person = own(value.people, entry.id);
    if (!exact(person, ['kind', 'status', 'queueNumber', 'changedAt']) || !ADMISSION_KINDS.includes(person.kind) || !statuses.includes(person.status)
      || person.queueNumber !== position + 1 || parseTimestamp(person.changedAt) === null || parseTimestamp(person.changedAt) < parseTimestamp(entry.committedAt)) fail();
  }
  const ids = new Set(index.entries.map(entry => entry.id)), teamIds = new Set(), memberships = new Set();
  for (const team of value.teams) {
    if (!exact(team, ['id', 'name', 'memberIds']) || !TEAM_ID.test(team.id ?? '') || teamIds.has(team.id) || typeof team.name !== 'string'
      || !team.name.trim() || [...team.name].length > 160 || /[\u0000-\u001f\u007f]/u.test(team.name)
      || !Array.isArray(team.memberIds) || team.memberIds.length < 1 || team.memberIds.length > 50 || new Set(team.memberIds).size !== team.memberIds.length) fail();
    teamIds.add(team.id);
    for (const id of team.memberIds) { if (!ids.has(id) || memberships.has(id)) fail(); memberships.add(id); }
  }
  validatePersonGroups(index);
  const operations = new Set(); let previousAt = -Infinity, intakes = 0;
  for (const [position, entry] of value.audit.entries()) {
    if (!exact(entry, ['revision', 'action', 'actorId', 'at', 'operationId', 'requestHash', 'details', 'result'])
      || entry.revision !== value.baseRevision + position + 1 || !ACTIONS.includes(entry.action) || index.schemaVersion === 2 && ['approve', 'reject'].includes(entry.action)
      || typeof entry.actorId !== 'string' || !/^[A-Za-z0-9_-]{1,80}$/u.test(entry.actorId) || parseTimestamp(entry.at) === null || parseTimestamp(entry.at) < previousAt
      || !HASH.test(entry.requestHash ?? '') || entry.operationId !== null && (!validAdmissionOperation(entry.operationId) || operations.has(entry.operationId))
      || !plainObject(entry.details) || !exact(entry.result, ['registrationId', 'teamId', 'promotedIds', 'releasedIds'])
      || entry.result.registrationId !== null && !ids.has(entry.result.registrationId)
      || entry.result.teamId !== null && !TEAM_ID.test(entry.result.teamId ?? '')) fail();
    if (entry.operationId !== null) operations.add(entry.operationId);
    for (const name of ['promotedIds', 'releasedIds']) if (!Array.isArray(entry.result[name]) || entry.result[name].length > 1000
      || new Set(entry.result[name]).size !== entry.result[name].length || entry.result[name].some(id => !ids.has(id))) fail();
    const allowedDetails = { intake: ['kind', 'status'], staff_intake: ['kind', 'status'], settings: ['staffReserve', 'waitlistEnabled'], kind: ['kind'], withdraw: [], promote: [], team_save: ['memberCount'], team_remove: [], approve: ['status'], reject: [], person_merge:['personId','contactCount','registrationCount','roles'], person_roles:['personId','contactCount','registrationCount','roles'] }[entry.action];
    if (!exact(entry.details, allowedDetails) || ['approve', 'reject'].includes(entry.action) && (entry.result.registrationId === null || entry.operationId === null)) fail();
    if (['intake', 'staff_intake'].includes(entry.action) && (!ADMISSION_KINDS.includes(entry.details.kind) || !statuses.includes(entry.details.status))
      || entry.action === 'settings' && (!Number.isSafeInteger(entry.details.staffReserve) || entry.details.staffReserve < 0 || entry.details.staffReserve > value.settings.capacity || typeof entry.details.waitlistEnabled !== 'boolean')
      || entry.action === 'kind' && !ADMISSION_KINDS.includes(entry.details.kind)
      || entry.action === 'approve' && !['confirmed', 'waitlisted'].includes(entry.details.status)
      || entry.action === 'team_save' && (!Number.isSafeInteger(entry.details.memberCount) || entry.details.memberCount < 1 || entry.details.memberCount > 50)) fail();
    if (['person_merge','person_roles'].includes(entry.action) && (!/^p_[a-f0-9]{32}$/u.test(entry.details.personId??'') || !Number.isInteger(entry.details.contactCount) || entry.details.contactCount<0 || entry.details.contactCount>100 || !Number.isInteger(entry.details.registrationCount) || entry.details.registrationCount<0 || entry.details.registrationCount>100 || !validPersonRoles(entry.details.roles))) fail();
    if (['intake', 'staff_intake'].includes(entry.action) && entry.result.registrationId !== index.entries[value.baseRevision + intakes++]?.id) fail();
    previousAt = parseTimestamp(entry.at);
  }
  if (intakes !== index.entries.length - value.baseRevision) fail();
  const summary = admissionSummary(index);
  if (summary.confirmedCount > summary.capacity || summary.attendeeConfirmedCount > summary.capacity - summary.staffReserve) fail();
  return index;
}

export function admissionSnapshot(index, defaults) {
  const value = admissionView(index, defaults), membership = new Map(value.admissions.teams.flatMap(team => team.memberIds.map(id => [id, team.id])));
  return { revision: value.revision, settings: { ...value.admissions.settings }, summary: admissionSummary(value),
    people: value.entries.map(entry => ({ registrationId: entry.id, ...value.admissions.people[entry.id], teamId: membership.get(entry.id) ?? '' })),
    teams: structuredClone(value.admissions.teams), ...(value.admissions.personGroups?{personGroups:structuredClone(value.admissions.personGroups)}:{}), auditCount: value.admissions.audit.length };
}

export function admissionFor(index, id, defaults) {
  const value = admissionView(index, defaults), person = own(value.admissions.people, id);
  if (!person) fail('not_found');
  return { status: person.status, kind: person.kind, revision: value.revision, queueNumber: person.queueNumber };
}

const canConfirm = (index, kind) => {
  const summary = admissionSummary(index);
  return summary.remainingTotal > 0 && (kind === 'crew' || summary.remainingPublic > 0);
};

export function releaseWithdrawn(index, ids, at) {
  const releasedIds = [];
  if (!Array.isArray(ids) || ids.length > 1000 || ids.some(id => !validAdmissionId(id))) fail('invalid');
  for (const id of new Set(ids)) {
    const person = own(index.admissions.people, id);
    if (!person || person.status === 'withdrawn') continue;
    if (person.status === 'confirmed') releasedIds.push(id);
    person.status = 'withdrawn'; person.changedAt = at;
  }
  return releasedIds;
}

/** Oldest approved waitlist first; application order is never an approval. */
export function promoteEligible(index, at) {
  const promotedIds = [], waitingSince = new Map();
  for (const event of index.admissions.audit) {
    if (['intake', 'staff_intake', 'approve'].includes(event.action) && event.details.status === 'waitlisted') {
      waitingSince.set(event.result.registrationId, event.revision);
    }
  }
  const waiting = index.entries.filter(entry => index.admissions.people[entry.id].status === 'waitlisted')
    .sort((a, b) => (waitingSince.get(a.id) ?? index.admissions.people[a.id].queueNumber)
      - (waitingSince.get(b.id) ?? index.admissions.people[b.id].queueNumber));
  for (const entry of waiting) {
    const person = index.admissions.people[entry.id];
    if (person.status === 'waitlisted' && canConfirm(index, person.kind)) {
      person.status = 'confirmed'; person.changedAt = at; promotedIds.push(entry.id);
    }
  }
  return promotedIds;
}

export function addAdmission(index, entry, kind, at, { reviewRequired = false } = {}) {
  if (!ADMISSION_KINDS.includes(kind) || Object.hasOwn(index.admissions.people, entry.id)) fail('invalid');
  if (typeof reviewRequired !== 'boolean' || reviewRequired && (index.schemaVersion !== 3 || kind !== 'attendee')) fail('invalid');
  const status = reviewRequired ? 'pending_review' : canConfirm(index, kind) ? 'confirmed' : index.admissions.settings.waitlistEnabled ? 'waitlisted' : null;
  if (status === null) return null;
  index.entries.push(entry);
  index.admissions.people[entry.id] = { kind, status, queueNumber: index.entries.length, changedAt: at };
  return status;
}

export function operationResult(patch = {}) { return { registrationId: null, teamId: null, promotedIds: [], releasedIds: [], ...patch }; }

/** Changes only mutable admission facts and links; the caller owns the single shared CAS commit. */
export function transitionAdmission(index, action, input, at, excludedIds = []) {
  if (!plainObject(input)) fail('invalid');
  const result = operationResult({ releasedIds: releaseWithdrawn(index, excludedIds, at) });
  let details = {};
  if (['person_merge','person_roles'].includes(action)) {
    const changed=transitionPerson(index,action,input,at);return {details:changed.details,result:operationResult({...changed.result,releasedIds:[...new Set([...result.releasedIds,...changed.result.releasedIds])]})};
  } else if (action === 'settings') {
    if (!exact(input, ['staffReserve', 'waitlistEnabled'])) fail('invalid');
    const settings = admissionDefaults({ ...index.admissions.settings, ...input });
    const summary = admissionSummary(index);
    if (summary.attendeeConfirmedCount > settings.capacity - settings.staffReserve) fail('capacity_conflict');
    index.admissions.settings = settings; details = { staffReserve: settings.staffReserve, waitlistEnabled: settings.waitlistEnabled };
  } else if (action === 'kind') {
    if (!exact(input, ['registrationId', 'kind']) || !validAdmissionId(input.registrationId) || !ADMISSION_KINDS.includes(input.kind)) fail('invalid');
    const person = own(index.admissions.people, input.registrationId);
    if (!person) fail('not_found');
    if (['withdrawn', 'rejected'].includes(person.status)) fail('forbidden');
    if (person.status === 'confirmed' && input.kind === 'attendee' && person.kind !== 'attendee'
      && admissionSummary(index).attendeeConfirmedCount >= index.admissions.settings.capacity - index.admissions.settings.staffReserve) fail('capacity_conflict');
    person.kind = input.kind; person.changedAt = at; details = { kind: input.kind }; result.registrationId = input.registrationId;
  } else if (['approve', 'reject'].includes(action)) {
    if (index.schemaVersion !== 3 || !exact(input, ['registrationId']) || !validAdmissionId(input.registrationId)) fail('invalid');
    const person = own(index.admissions.people, input.registrationId);
    if (!person) fail('not_found');
    if (person.status !== 'pending_review') fail('conflict');
    if (action === 'approve') {
      // Already approved applicants keep priority; unreviewed applications never
      // enter automatic promotion, regardless of their original queue number.
      result.promotedIds = promoteEligible(index, at);
      const status = canConfirm(index, person.kind) ? 'confirmed' : index.admissions.settings.waitlistEnabled ? 'waitlisted' : null;
      if (status === null) fail('capacity_conflict');
      person.status = status; details = { status };
    } else person.status = 'rejected';
    person.changedAt = at; result.registrationId = input.registrationId;
  } else if (action === 'withdraw') {
    if (!exact(input, ['registrationId']) || !validAdmissionId(input.registrationId)) fail('invalid');
    if (!Object.hasOwn(index.admissions.people, input.registrationId)) fail('not_found');
    result.releasedIds.push(...releaseWithdrawn(index, [input.registrationId], at)); result.registrationId = input.registrationId;
  } else if (action === 'promote') {
    if (!exact(input, [])) fail('invalid');
  } else if (action === 'team_save') {
    const keys = Object.hasOwn(input, 'id') ? ['id', 'name', 'memberIds'] : ['name', 'memberIds'];
    if (!exact(input, keys) || typeof input.name !== 'string' || !input.name.trim() || [...input.name].length > 160 || /[\u0000-\u001f\u007f]/u.test(input.name)
      || !Array.isArray(input.memberIds) || input.memberIds.length < 1 || input.memberIds.length > 50 || new Set(input.memberIds).size !== input.memberIds.length
      || input.memberIds.some(id => !validAdmissionId(id) || !Object.hasOwn(index.admissions.people, id))) fail('invalid');
    const id = input.id ?? 't_' + randomBytes(16).toString('base64url');
    if (!TEAM_ID.test(id ?? '')) fail('invalid');
    const existing = index.admissions.teams.findIndex(team => team.id === id);
    if (Object.hasOwn(input, 'id') && existing < 0) fail('not_found');
    if (existing < 0 && index.admissions.teams.length >= MAX_ADMISSION_TEAMS) fail('capacity_conflict');
    if (index.admissions.teams.some(team => team.id !== id && team.memberIds.some(member => input.memberIds.includes(member)))) fail('conflict');
    const team = { id, name: input.name.normalize('NFC').trim(), memberIds: [...input.memberIds] };
    if (existing < 0) index.admissions.teams.push(team); else index.admissions.teams[existing] = team;
    details = { memberCount: team.memberIds.length }; result.teamId = id;
  } else if (action === 'team_remove') {
    if (!exact(input, ['teamId']) || !TEAM_ID.test(input.teamId ?? '')) fail('invalid');
    const position = index.admissions.teams.findIndex(team => team.id === input.teamId);
    if (position < 0) fail('not_found');
    index.admissions.teams.splice(position, 1); result.teamId = input.teamId;
  } else fail('invalid');
  result.promotedIds = [...new Set([...result.promotedIds, ...promoteEligible(index, at)])];
  result.releasedIds = [...new Set(result.releasedIds)];
  return { details, result };
}

export function appendAdmissionAudit(index, { action, actorId, at, operationId = null, requestHash, details, result }) {
  if (index.admissions.audit.length >= MAX_ADMISSION_OPERATIONS || parseTimestamp(at) === null || parseTimestamp(at) < (parseTimestamp(index.admissions.audit.at(-1)?.at) ?? -Infinity)) fail();
  index.revision++;
  index.admissions.audit.push({ revision: index.revision, action, actorId, at, operationId, requestHash, details, result });
}


const CONTACT_ID=/^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/u;
export const PERSON_ROLES=Object.freeze(['attendee','speaker','guest','exhibitor']);
export const validPersonRoles=value=>value===null||Array.isArray(value)&&value.length<=4&&value.every(role=>PERSON_ROLES.includes(role))&&new Set(value).size===value.length;
export const validPersonKey=key=>typeof key==='string'&&(/^(contact):[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/u.test(key)||/^registration:[A-Za-z0-9_-]{43}$/u.test(key));
export function personGroupFor(value,{contactId,registrationId}={}){return (value?.admissions?.personGroups??value?.personGroups??[]).find(group=>contactId&&group.contactIds.includes(contactId)||registrationId&&group.registrationIds.includes(registrationId))??null;}
function validatePersonGroups(index){
 const groups=index.admissions.personGroups;if(groups===undefined)return;
 if(!Array.isArray(groups)||groups.length>1000)fail();const contacts=new Set(),registrations=new Set(),groupIds=new Set();
 for(const g of groups){
  if(!exact(g,['id','contactIds','registrationIds','primaryContactId','primaryRegistrationId','primaryKey','roles'])||!/^p_[a-f0-9]{32}$/u.test(g.id??'')||groupIds.has(g.id)
   ||!Array.isArray(g.contactIds)||g.contactIds.length>100||!Array.isArray(g.registrationIds)||g.registrationIds.length>100||g.contactIds.length+g.registrationIds.length<1
   ||!validPersonKey(g.primaryKey)||!(g.primaryKey.startsWith('contact:')?g.contactIds.includes(g.primaryKey.slice(8)):g.registrationIds.includes(g.primaryKey.slice(13)))||!validPersonRoles(g.roles)||!(g.contactIds.length?g.contactIds.includes(g.primaryContactId):g.primaryContactId===null)
   ||!(g.registrationIds.length?g.registrationIds.includes(g.primaryRegistrationId):g.primaryRegistrationId===null))fail();
  groupIds.add(g.id);
  for(const id of g.contactIds){if(!CONTACT_ID.test(id??'')||contacts.has(id))fail();contacts.add(id);}
  for(const id of g.registrationIds){if(!ID.test(id??'')||registrations.has(id)||!Object.hasOwn(index.admissions.people,id)||id!==g.primaryRegistrationId&&index.admissions.people[id].status!=='withdrawn')fail();registrations.add(id);}
 }
}
export function expandPersonKeys(index,keys){
 if(!Array.isArray(keys)||!keys.length||keys.length>20||keys.some(key=>!validPersonKey(key))||new Set(keys).size!==keys.length)fail('invalid');
 const contactIds=new Set(keys.filter(k=>k.startsWith('contact:')).map(k=>k.slice(8))),registrationIds=new Set(keys.filter(k=>k.startsWith('registration:')).map(k=>k.slice(13)));
 let changed=true;while(changed){changed=false;const before=contactIds.size+registrationIds.size;
  for(const id of contactIds){const keyHash=createHash('sha256').update('staff\0'+index.eventId+'\0'+id).digest('hex'),entry=index.entries.find(row=>row.keyHash===keyHash);if(entry)registrationIds.add(entry.id);}
  for(const group of index.admissions.personGroups??[])if(group.contactIds.some(id=>contactIds.has(id))||group.registrationIds.some(id=>registrationIds.has(id))){group.contactIds.forEach(id=>contactIds.add(id));group.registrationIds.forEach(id=>registrationIds.add(id));}
  changed=before!==contactIds.size+registrationIds.size;
 }
 if(contactIds.size>100||registrationIds.size>100||[...registrationIds].some(id=>!Object.hasOwn(index.admissions.people,id)))fail('invalid');
 return {contactIds:[...contactIds].sort(),registrationIds:[...registrationIds].sort()};
}
function transitionPerson(index,action,input,at){
 if(!exact(input,['keys','primaryKey','roles','contactRevision'])||!validPersonKey(input.primaryKey)||!validPersonRoles(input.roles)||!Number.isSafeInteger(input.contactRevision)||input.contactRevision<0)fail('invalid');
 const {contactIds,registrationIds}=expandPersonKeys(index,input.keys);
 if(input.primaryKey.startsWith('contact:')?!contactIds.includes(input.primaryKey.slice(8)):!registrationIds.includes(input.primaryKey.slice(13)))fail('invalid');
 if(action==='person_roles'&&input.keys.length!==1||action==='person_merge'&&input.keys.length<2)fail('invalid');
 const rank=id=>({confirmed:0,waitlisted:1,pending_review:2,rejected:3,withdrawn:4})[index.admissions.people[id].status];
 const previous=personGroupFor(index,input.primaryKey.startsWith('contact:')?{contactId:input.primaryKey.slice(8)}:{registrationId:input.primaryKey.slice(13)});
 const preferred=registrationIds.toSorted((a,b)=>rank(a)-rank(b)||index.admissions.people[a].queueNumber-index.admissions.people[b].queueNumber)[0]??null;
 const primaryContactId=input.primaryKey.startsWith('contact:')?input.primaryKey.slice(8):previous?.primaryContactId??contactIds[0]??null;
 const primaryRegistrationId=action==='person_roles'&&previous?previous.primaryRegistrationId:input.primaryKey.startsWith('registration:')?input.primaryKey.slice(13):preferred;
 if(primaryRegistrationId&&preferred&&rank(primaryRegistrationId)>rank(preferred))fail('conflict');
 const existingGroups=(index.admissions.personGroups??[]).filter(g=>g.contactIds.some(id=>contactIds.includes(id))||g.registrationIds.some(id=>registrationIds.includes(id)));
 const id=previous?.id??'p_'+createHash('sha256').update(input.primaryKey).digest('hex').slice(0,32);
 const aliases=registrationIds.filter(value=>value!==primaryRegistrationId);
 const releasedIds=releaseWithdrawn(index,aliases,at);
 // Removing duplicate identities never approves a pending application, promotes a
 // different person, or sends mail. Original records and old audit snapshots remain.
 index.admissions.teams=index.admissions.teams.map(team=>({...team,memberIds:team.memberIds.filter(member=>!aliases.includes(member))})).filter(team=>team.memberIds.length);
 const inherited=existingGroups.filter(g=>g.roles!==null);const group={id,contactIds,registrationIds,primaryContactId,primaryRegistrationId,primaryKey:action==='person_roles'&&previous?previous.primaryKey:input.primaryKey,roles:input.roles===null?(inherited.length?[...new Set(inherited.flatMap(g=>g.roles))].sort():null):[...input.roles].sort()};
 index.admissions.personGroups=[...(index.admissions.personGroups??[]).filter(g=>!existingGroups.includes(g)),group];
 validatePersonGroups(index);
 return {details:{personId:id,contactCount:contactIds.length,registrationCount:registrationIds.length,roles:group.roles},result:{registrationId:primaryRegistrationId,releasedIds}};
}
