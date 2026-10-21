import { randomBytes } from 'node:crypto';
import { own, plainObject, parseTimestamp } from './policy.mjs';

export const MAX_ADMISSION_OPERATIONS = 2000;
export const MAX_ADMISSION_TEAMS = 100;
export const ADMISSION_STATUSES = Object.freeze(['confirmed', 'waitlisted', 'withdrawn']);
export const ADMISSION_KINDS = Object.freeze(['attendee', 'crew']);
const ID = /^[A-Za-z0-9_-]{43}$/u;
const TEAM_ID = /^t_[A-Za-z0-9_-]{22}$/u;
const OPERATION = /^[A-Za-z0-9_-]{32,128}$/u;
const HASH = /^[a-f0-9]{64}$/u;
const ACTIONS = ['intake', 'staff_intake', 'settings', 'kind', 'withdraw', 'promote', 'team_save', 'team_remove'];
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
  if (index.schemaVersion === 2) return structuredClone(index);
  const requested = admissionDefaults(defaults);
  // A new initial reserve cannot retroactively invalidate historically accepted attendees.
  const settings = { ...requested, staffReserve: Math.min(requested.staffReserve, Math.max(0, requested.capacity - index.entries.length)) };
  const people = Object.fromEntries(index.entries.map((entry, position) => [entry.id,
    { kind: 'attendee', status: 'confirmed', queueNumber: position + 1, changedAt: entry.committedAt }]));
  const result = { ...structuredClone(index), schemaVersion: 2,
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
    totalRegistered: values.length, teamCount: teams.length,
    remainingTotal: Math.max(0, settings.capacity - confirmed.length),
    remainingPublic: Math.max(0, Math.min(settings.capacity - confirmed.length, settings.capacity - settings.staffReserve - attendeeConfirmedCount)) };
}

export function validateAdmissions(index, defaults) {
  const value = index.admissions;
  if (!exact(value, ['baseRevision', 'settings', 'people', 'teams', 'audit']) || !Number.isSafeInteger(value.baseRevision) || value.baseRevision < 0 || value.baseRevision > index.entries.length
    || !exact(value.settings, ['capacity', 'staffReserve', 'waitlistEnabled']) || !plainObject(value.people)
    || Object.keys(value.people).length !== index.entries.length || !Array.isArray(value.teams) || value.teams.length > MAX_ADMISSION_TEAMS
    || !Array.isArray(value.audit) || value.audit.length > MAX_ADMISSION_OPERATIONS || value.audit.length !== index.revision - value.baseRevision) fail();
  admissionDefaults(value.settings);
  if (defaults?.capacity !== undefined && value.settings.capacity !== defaults.capacity) fail();
  for (const [position, entry] of index.entries.entries()) {
    const person = own(value.people, entry.id);
    if (!exact(person, ['kind', 'status', 'queueNumber', 'changedAt']) || !ADMISSION_KINDS.includes(person.kind) || !ADMISSION_STATUSES.includes(person.status)
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
  const operations = new Set(); let previousAt = -Infinity, intakes = 0;
  for (const [position, entry] of value.audit.entries()) {
    if (!exact(entry, ['revision', 'action', 'actorId', 'at', 'operationId', 'requestHash', 'details', 'result'])
      || entry.revision !== value.baseRevision + position + 1 || !ACTIONS.includes(entry.action)
      || typeof entry.actorId !== 'string' || !/^[A-Za-z0-9_-]{1,80}$/u.test(entry.actorId) || parseTimestamp(entry.at) === null || parseTimestamp(entry.at) < previousAt
      || !HASH.test(entry.requestHash ?? '') || entry.operationId !== null && (!validAdmissionOperation(entry.operationId) || operations.has(entry.operationId))
      || !plainObject(entry.details) || !exact(entry.result, ['registrationId', 'teamId', 'promotedIds', 'releasedIds'])
      || entry.result.registrationId !== null && !ids.has(entry.result.registrationId)
      || entry.result.teamId !== null && !TEAM_ID.test(entry.result.teamId ?? '')) fail();
    if (entry.operationId !== null) operations.add(entry.operationId);
    for (const name of ['promotedIds', 'releasedIds']) if (!Array.isArray(entry.result[name]) || entry.result[name].length > 1000
      || new Set(entry.result[name]).size !== entry.result[name].length || entry.result[name].some(id => !ids.has(id))) fail();
    const allowedDetails = { intake: ['kind', 'status'], staff_intake: ['kind', 'status'], settings: ['staffReserve', 'waitlistEnabled'], kind: ['kind'], withdraw: [], promote: [], team_save: ['memberCount'], team_remove: [] }[entry.action];
    if (!exact(entry.details, allowedDetails)) fail();
    if (['intake', 'staff_intake'].includes(entry.action) && (!ADMISSION_KINDS.includes(entry.details.kind) || !ADMISSION_STATUSES.includes(entry.details.status))
      || entry.action === 'settings' && (!Number.isSafeInteger(entry.details.staffReserve) || entry.details.staffReserve < 0 || entry.details.staffReserve > value.settings.capacity || typeof entry.details.waitlistEnabled !== 'boolean')
      || entry.action === 'kind' && !ADMISSION_KINDS.includes(entry.details.kind)
      || entry.action === 'team_save' && (!Number.isSafeInteger(entry.details.memberCount) || entry.details.memberCount < 1 || entry.details.memberCount > 50)) fail();
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
    teams: structuredClone(value.admissions.teams), auditCount: value.admissions.audit.length };
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

/** Oldest eligible person first; reserved crew capacity never counts as an anonymous person. */
export function promoteEligible(index, at) {
  const promotedIds = [];
  for (const entry of index.entries) {
    const person = index.admissions.people[entry.id];
    if (person.status === 'waitlisted' && canConfirm(index, person.kind)) {
      person.status = 'confirmed'; person.changedAt = at; promotedIds.push(entry.id);
    }
  }
  return promotedIds;
}

export function addAdmission(index, entry, kind, at) {
  if (!ADMISSION_KINDS.includes(kind) || Object.hasOwn(index.admissions.people, entry.id)) fail('invalid');
  const status = canConfirm(index, kind) ? 'confirmed' : index.admissions.settings.waitlistEnabled ? 'waitlisted' : null;
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
  if (action === 'settings') {
    if (!exact(input, ['staffReserve', 'waitlistEnabled'])) fail('invalid');
    const settings = admissionDefaults({ ...index.admissions.settings, ...input });
    const summary = admissionSummary(index);
    if (summary.attendeeConfirmedCount > settings.capacity - settings.staffReserve) fail('capacity_conflict');
    index.admissions.settings = settings; details = { staffReserve: settings.staffReserve, waitlistEnabled: settings.waitlistEnabled };
  } else if (action === 'kind') {
    if (!exact(input, ['registrationId', 'kind']) || !validAdmissionId(input.registrationId) || !ADMISSION_KINDS.includes(input.kind)) fail('invalid');
    const person = own(index.admissions.people, input.registrationId);
    if (!person) fail('not_found');
    if (person.status === 'withdrawn') fail('forbidden');
    if (person.status === 'confirmed' && input.kind === 'attendee' && person.kind !== 'attendee'
      && admissionSummary(index).attendeeConfirmedCount >= index.admissions.settings.capacity - index.admissions.settings.staffReserve) fail('capacity_conflict');
    person.kind = input.kind; person.changedAt = at; details = { kind: input.kind }; result.registrationId = input.registrationId;
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
  result.promotedIds = promoteEligible(index, at);
  result.releasedIds = [...new Set(result.releasedIds)];
  return { details, result };
}

export function appendAdmissionAudit(index, { action, actorId, at, operationId = null, requestHash, details, result }) {
  if (index.admissions.audit.length >= MAX_ADMISSION_OPERATIONS || parseTimestamp(at) === null || parseTimestamp(at) < (parseTimestamp(index.admissions.audit.at(-1)?.at) ?? -Infinity)) fail();
  index.revision++;
  index.admissions.audit.push({ revision: index.revision, action, actorId, at, operationId, requestHash, details, result });
}
