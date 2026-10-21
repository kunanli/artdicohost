import { createHash } from 'node:crypto';
import { validateVolunteer, validateVolunteerPosition, validateVolunteerShift, validateVolunteerAssignment, VOLUNTEER_ISSUE_LABELS, VOLUNTEER_LIMITS } from '../../shared/volunteer-schema.mjs';
import { projectVolunteerCoverage, assertVolunteerPlanChange } from './planning.mjs';
import { volunteerWorkbook } from './xlsx.mjs';

const ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/u, REGISTRATION = /^[A-Za-z0-9_-]{43}$/u;
const OPERATION = /^[A-Za-z0-9_-]{16,100}$/u;
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const revision = value => Number.isSafeInteger(value) && value >= 0;
const safeErrors = new WeakSet();
export function volunteerFailure(code = 'UNAVAILABLE') { const error = new Error(code); error.code = code; safeErrors.add(error); return error; }
export const isVolunteerFailure = value => safeErrors.has(value);
const fail = (code = 'UNAVAILABLE') => { throw volunteerFailure(code); };
export function canManageVolunteers(actor) { return typeof actor?.id === 'string' && /^[A-Za-z0-9_-]{1,80}$/u.test(actor.id) && Array.isArray(actor.roles)
  && (actor.roles.includes('superadmin') || actor.roles.includes('outreach') && actor.roles.includes('reviewer')); }
function actorValue(actor) { if (!canManageVolunteers(actor)) fail('FORBIDDEN'); return { id: actor.id, roles: [...actor.roles] }; }
function text(value, maximum = 300, required = false) {
  if (value === undefined || value === null) value = '';
  if (typeof value !== 'string' || !value.isWellFormed() || [...value].length > maximum || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value) || required && !value.trim()) fail();
  return value;
}
function records(value, maximum, pattern = ID) {
  if (!Array.isArray(value) || value.length > maximum) fail();
  const ids = new Set();
  for (const record of value) { if (!plain(record) || typeof record.id !== 'string' || !pattern.test(record.id) || ids.has(record.id)) fail(); ids.add(record.id); }
  return value;
}
function sourceRecords(snapshot, key, maximum, pattern = ID) {
  if (!plain(snapshot) || !revision(snapshot.revision)) fail();
  return records(snapshot[key], maximum, pattern);
}
function canonicalContact(record) {
  if (!plain(record.profile) || !plain(record.operations)) fail();
  const profile = record.profile;
  if (!['consented', 'declined', 'unknown'].includes(profile.contactConsent) || !['pending', 'attending', 'declined'].includes(record.operations.responseStatus)) fail();
  const issues = [];
  if (profile.contactConsent === 'declined' || record.operations.responseStatus === 'declined') issues.push('SOURCE_INELIGIBLE');
  else if (profile.contactConsent !== 'consented') issues.push('SOURCE_INELIGIBLE');
  return { name: text(profile.displayName || profile.name, 120, true), organization: text(profile.organization, 300), email: text(profile.email, 254),
    wechat: text(profile.wechat, 150), phone: text(profile.phone, 150), issues };
}
function canonicalRegistration(record, inactive, admission) {
  if (!plain(record.fields) || !plain(record.provenance) || !['public', 'staff_assisted', 'staff_entry'].includes(record.provenance.kind) || !plain(record.consent)) fail();
  const issues = [];
  if (inactive || admission?.status === 'withdrawn') issues.push('SOURCE_INELIGIBLE');
  if (record.provenance.kind === 'public' ? record.consent.accepted !== true : !text(record.provenance.permissionReference, 1000)) issues.push('SOURCE_INELIGIBLE');
  return { name: text(record.fields.name, 120, true), organization: text(record.fields.organization, 300), email: text(record.fields.email, 254),
    wechat: text(record.fields.wechat, 150), phone: text(record.fields.phone, 150), issues };
}

/** Validate trusted snapshots and expose only the fields needed for staffing.
 * Name/email are deliberately never used as identity or merge keys.
 */
export function volunteerSourceProjection(input) {
  if (!plain(input)) fail();
  const contacts = sourceRecords(input.contacts, 'contacts', 5000), registrations = sourceRecords(input.registrations, 'registrations', 1000, REGISTRATION);
  if (!plain(input.intent) || !revision(input.intent.revision) || !Array.isArray(input.intent.conversions) || input.intent.conversions.length > 1000
    || !plain(input.admissions) || !revision(input.admissions.revision) || input.admissions.revision !== input.registrations.revision
    || !Array.isArray(input.admissions.people) || input.admissions.people.length > 1000
    || !Array.isArray(input.inactiveRegistrationIds) || input.inactiveRegistrationIds.length > 1000
    || input.inactiveRegistrationIds.some(id => !REGISTRATION.test(id)) || new Set(input.inactiveRegistrationIds).size !== input.inactiveRegistrationIds.length
    || !plain(input.content) || !revision(input.content.revision) || !plain(input.content.content)) fail();
  const content = input.content.content, sessions = records(content.sessions, 200), booths = records(content.booths, 200);
  if (!plain(content.event) || !ID.test(content.eventId ?? '') || !/^\d{4}-\d{2}-\d{2}$/u.test(content.event.date ?? '') || content.event.timezone !== 'Asia/Shanghai') fail();
  const event = { id: content.eventId, title: text(content.event.title, 200, true), date: content.event.date, timezone: 'Asia/Shanghai' };
  const contactById = new Map(contacts.map(record => [record.id, record])), registrationById = new Map(registrations.map(record => [record.id, record]));
  const admissions = new Map(), inactive = new Set(input.inactiveRegistrationIds), conversions = new Map(), reverse = new Map();
  for (const entry of input.admissions.people) {
    if (!plain(entry) || !REGISTRATION.test(entry.registrationId ?? '') || admissions.has(entry.registrationId) || !registrationById.has(entry.registrationId)
      || !['confirmed', 'waitlisted', 'withdrawn'].includes(entry.status) || !['crew', 'attendee'].includes(entry.kind)) fail();
    admissions.set(entry.registrationId, entry);
  }
  if (admissions.size !== registrations.length) fail();
  for (const entry of input.intent.conversions) {
    if (!plain(entry) || !ID.test(entry.sourceContactId ?? '') || !REGISTRATION.test(entry.registrationId ?? '') || conversions.has(entry.sourceContactId) || reverse.has(entry.registrationId)) fail();
    conversions.set(entry.sourceContactId, entry.registrationId); reverse.set(entry.registrationId, entry.sourceContactId);
  }
  const provenance = new Map(), brokenContacts = new Set(), brokenRegistrations = new Set();
  for (const record of registrations) if (record.provenance?.kind === 'staff_assisted') {
    const id = record.provenance.sourceContactId;
    if (!ID.test(id ?? '')) fail();
    if (provenance.has(id)) { brokenContacts.add(id); brokenRegistrations.add(provenance.get(id)); brokenRegistrations.add(record.id); }
    provenance.set(id, record.id);
    if (!contactById.has(id) || conversions.get(id) !== record.id || reverse.get(record.id) !== id) { brokenContacts.add(id); brokenRegistrations.add(record.id); }
  }
  for (const [contactId, registrationId] of conversions) {
    const record = registrationById.get(registrationId);
    if (!contactById.has(contactId) || !record || record.provenance?.kind !== 'staff_assisted' || record.provenance.sourceContactId !== contactId) {
      brokenContacts.add(contactId); brokenRegistrations.add(registrationId);
    }
  }
  const identities = Object.create(null), candidates = [];
  const build = (kind, id, contact, registration) => {
    const contactId = contact?.id ?? null, registrationId = registration?.id ?? null;
    const broken = brokenContacts.has(contactId ?? id) || brokenRegistrations.has(registrationId ?? id);
    const admission = registrationId ? admissions.get(registrationId) : null;
    const contactProfile = contact ? canonicalContact(contact) : null;
    const registrationProfile = registration ? canonicalRegistration(registration, inactive.has(registrationId), admission) : null;
    const profile = contactProfile ?? registrationProfile;
    const issues = [...new Set([...(contactProfile?.issues ?? []), ...(registrationProfile?.issues ?? []), ...(broken ? ['SOURCE_UNAVAILABLE'] : [])])];
    const value = { canonicalId: broken ? null : registrationId ? 'r:' + registrationId : 'c:' + contactId, contactId, registrationId,
      name: profile.name, organization: profile.organization, email: profile.email, wechat: profile.wechat, phone: profile.phone,
      eligible: !issues.length, admissionStatus: registrationId ? inactive.has(registrationId) ? 'withdrawn' : admission.status : 'unlinked', issues };
    identities[kind + ':' + id] = value;
    candidates.push({ source: { kind, id }, ...value });
  };
  for (const contact of contacts) {
    const relatedId = conversions.get(contact.id), related = relatedId && !brokenContacts.has(contact.id) ? registrationById.get(relatedId) : null;
    build('contact', contact.id, contact, related);
  }
  for (const registration of registrations) {
    const relatedId = reverse.get(registration.id), related = relatedId && !brokenRegistrations.has(registration.id) ? contactById.get(relatedId) : null;
    build('registration', registration.id, related, registration);
  }
  return { identities, candidates, event, content: { sessions, booths }, revisions: { contacts: input.contacts.revision, registrations: input.registrations.revision,
    admissions: input.admissions.revision, intent: input.intent.revision, content: input.content.revision } };
}

function safeIssues(value) { return Array.isArray(value) ? [...new Set(value.map(item => typeof item === 'string' ? item : item?.code).filter(item => typeof item === 'string' && Object.hasOwn(VOLUNTEER_ISSUE_LABELS, item)))] : []; }
function blankPerson(source) { return { canonicalId: null, contactId: source.kind === 'contact' ? source.id : null, registrationId: source.kind === 'registration' ? source.id : null,
  name: '来源记录暂不可用', organization: '', email: '', wechat: '', phone: '', eligible: false, admissionStatus: 'unavailable', issues: ['SOURCE_UNAVAILABLE'] }; }
function coverageView(state, sources) {
  const projected = projectVolunteerCoverage(state, sources), summaries = projected.summary;
  const volunteerIssues = new Map(projected.volunteers.map(row => [row.id, safeIssues(row.issues)])), shifts = new Map(projected.shifts.map(row => [row.id, row]));
  const positions = new Map(state.positions.map(position => [position.id, position]));
  return { schemaVersion: 1, event: sources.event, revision: state.revision, revisions: { volunteers: state.revision, ...sources.revisions }, auditCount: state.audit.length,
    volunteers: state.volunteers.map(row => ({ ...row, person: structuredClone(sources.identities[row.source.kind + ':' + row.source.id] ?? blankPerson(row.source)), issues: volunteerIssues.get(row.id) ?? [] })),
    positions: structuredClone(state.positions), shifts: state.shifts.map(row => { const projected = shifts.get(row.id); return { ...row, positionName: positions.get(row.positionId)?.name ?? '',
      proposedCount: projected?.proposedCount ?? 0, confirmedCount: projected?.confirmedCount ?? 0, gap: projected?.gap ?? row.required, issues: safeIssues(projected?.issues) }; }),
    assignments: projected.assignments.map(row => ({ ...row, issues: safeIssues(row.issues) })),
    summary: { rosterCount: summaries.rosterCount, activePeopleCount: summaries.activeVolunteerCount, confirmedPeopleCount: summaries.confirmedVolunteerCount,
      admissionConfirmedPeopleCount: summaries.admissionConfirmedCount, assignedPeopleCount: summaries.assignedVolunteerCount, requiredSlots: summaries.requiredSlots,
      confirmedSlots: summaries.confirmedSlots, proposedSlots: summaries.proposedSlots, gapSlots: summaries.unfilledSlots, issueCount: projected.issues.length,
      unverifiableSources: summaries.unverifiableSources },
    planning: { sessions: sources.content.sessions.map(item => ({ id: item.id, title: text(item.title, 200), start: text(item.start, 5), end: text(item.end, 5), zone: text(item.zone, 10), status: text(item.status, 20) })),
      booths: sources.content.booths.map(item => ({ id: item.id, code: text(item.code, 20), organization: text(item.organization, 300), status: text(item.status, 20), slotNumber: Number.isInteger(item.slotNumber) ? item.slotNumber : 0 })) } };
}
const entityActions = { volunteer_upsert: ['volunteers', validateVolunteer], position_upsert: ['positions', validateVolunteerPosition], shift_upsert: ['shifts', validateVolunteerShift], assignment_upsert: ['assignments', validateVolunteerAssignment] };
function validCommand(input) { if (!plain(input) || !revision(input.expectedRevision) || !OPERATION.test(input.operationId ?? '') || !Object.hasOwn(entityActions, input.action)) fail('INVALID_REQUEST'); }
function normalizeEntity(action, payload) { const checked = entityActions[action][1](payload); if (!checked?.valid) fail('INVALID_REQUEST'); return checked.value; }
async function repositoryCall(callback) {
  try { return await callback(); } catch (error) {
    if (isVolunteerFailure(error)) throw error;
    if (['REVISION_CONFLICT', 'OPERATION_CONFLICT'].includes(error?.code)) fail('CONFLICT');
    if (error?.code === 'PLAN_CONFLICT') fail('PLAN_CONFLICT');
    if (error?.code === 'INVALID_REQUEST') fail('INVALID_REQUEST');
    if (error?.code === 'CAPACITY_EXCEEDED') fail('CAPACITY_EXCEEDED');
    fail();
  }
}

/** Trusted source loading is deliberately inside the complete role gate. */
export function createVolunteerService({ repository, getSources, clock = Date.now } = {}) {
  if (!repository || !['read', 'mutate'].every(key => typeof repository[key] === 'function') || typeof getSources !== 'function' || typeof clock !== 'function') throw new TypeError('Volunteer dependencies unavailable.');
  async function source(actor) { try { return volunteerSourceProjection(await getSources(actor)); } catch { fail(); } }
  async function readFor(actor) { const [state, sources] = await Promise.all([repositoryCall(() => repository.read()), source(actor)]); return { state, sources, view: coverageView(state, sources) }; }
  return Object.freeze({
    async read({ actor } = {}) { const staff = actorValue(actor); return (await readFor(staff)).view; },
    async sources({ actor, query = '', kind = '', id = '', cursor = 0, limit = 100 } = {}) {
      const staff = actorValue(actor);
      if (typeof query !== 'string' || !query.isWellFormed() || [...query].length > 200 || /[\u0000-\u001f\u007f]/u.test(query) || !['', 'contact', 'registration'].includes(kind)
        || typeof id !== 'string' || id && (!kind || query || !(kind === 'contact' ? ID : REGISTRATION).test(id))
        || !Number.isSafeInteger(cursor) || cursor < 0 || !Number.isInteger(limit) || limit < 1 || limit > 200) fail('INVALID_REQUEST');
      const loaded = await source(staff), term = query.trim().toLocaleLowerCase('zh-CN'), seen = new Set();
      const candidates = loaded.candidates.filter(row => {
        if (kind && row.source.kind !== kind || id && row.source.id !== id || term && ![row.name, row.organization, row.source.id].some(value => value.toLocaleLowerCase('zh-CN').includes(term))) return false;
        if (!kind && row.canonicalId) { if (seen.has(row.canonicalId)) return false; seen.add(row.canonicalId); }
        return true;
      });
      const selected = candidates.slice(cursor, cursor + limit);
      return { schemaVersion: 1, candidates: selected, total: candidates.length, nextCursor: cursor + selected.length < candidates.length ? String(cursor + selected.length) : null };
    },
    async operate(input = {}) {
      const staff = actorValue(input.actor); validCommand(input);
      const entity = normalizeEntity(input.action, input.payload), loaded = await source(staff);
      const result = await repositoryCall(() => repository.mutate({ actorId: staff.id, expectedRevision: input.expectedRevision, operationId: input.operationId, action: input.action, payload: entity }, current => {
        const [collection] = entityActions[input.action], previous = current[collection].find(row => row.id === entity.id), after = structuredClone(current);
        if (input.action === 'volunteer_upsert') {
          const identity = loaded.identities[entity.source.kind + ':' + entity.source.id];
          if (!previous && !identity?.eligible || previous && entity.workflowStatus !== previous.workflowStatus && !['declined', 'inactive'].includes(entity.workflowStatus) && !identity?.eligible) fail('SOURCE_NOT_ELIGIBLE');
          if (!previous && current.volunteers.some(row => {
            const existing = loaded.identities[row.source.kind + ':' + row.source.id];
            return row.source.kind === entity.source.kind && row.source.id === entity.source.id || identity?.canonicalId && existing?.canonicalId === identity.canonicalId;
          })) fail('DUPLICATE_SOURCE');
        }
        const index = after[collection].findIndex(row => row.id === entity.id); if (index < 0) after[collection].push(entity); else after[collection][index] = entity;
        if (after[collection].length > VOLUNTEER_LIMITS[collection]) fail('CAPACITY_EXCEEDED');
        if (input.action === 'shift_upsert' && !after.positions.some(row => row.id === entity.positionId)
          || input.action === 'assignment_upsert' && (!after.volunteers.some(row => row.id === entity.volunteerId) || !after.shifts.some(row => row.id === entity.shiftId))) fail('INVALID_REQUEST');
        assertVolunteerPlanChange(current, after, { action: input.action, id: entity.id }, loaded);
        return after;
      }));
      const receipt = result.state.audit.find(row => row.operationId === input.operationId);
      if (!receipt || receipt.actorId !== staff.id || receipt.action !== input.action) fail();
      return { outcome: result.outcome, operation: { operationId: receipt.operationId, action: receipt.action, revision: receipt.revision }, ...coverageView(result.state, loaded) };
    },
    async exportXlsx({ actor, expectedRevision, operationId, volunteerIds, includeContact } = {}) {
      const staff = actorValue(actor);
      if (!revision(expectedRevision) || !OPERATION.test(operationId ?? '') || !Array.isArray(volunteerIds) || !volunteerIds.length || volunteerIds.length > 500
        || volunteerIds.some(id => !ID.test(id)) || new Set(volunteerIds).size !== volunteerIds.length || typeof includeContact !== 'boolean') fail('INVALID_REQUEST');
      const loaded = await readFor(staff), ids = [...volunteerIds].sort(), existingAudit = loaded.state.audit.find(entry => entry.operationId === operationId);
      if (existingAudit && (existingAudit.action !== 'export' || existingAudit.actorId !== staff.id)) fail('CONFLICT');
      if (loaded.state.revision !== expectedRevision && !(existingAudit && loaded.state.revision === expectedRevision + 1)) fail('CONFLICT');
      if (ids.some(id => !loaded.state.volunteers.some(row => row.id === id))) fail('INVALID_REQUEST');
      const view = { ...loaded.view, revision: expectedRevision, revisions: { ...loaded.view.revisions, volunteers: expectedRevision } };
      const workbook = volunteerWorkbook({ view, volunteerIds: ids, includeContact }), sha256 = createHash('sha256').update(workbook).digest('hex');
      if (existingAudit?.details?.sha256 && existingAudit.details.sha256 !== sha256) fail('CONFLICT');
      const result = await repositoryCall(() => repository.mutate({ actorId: staff.id, expectedRevision, operationId, action: 'export', payload: { volunteerIds: ids, includeContact },
        details: { volunteerIds: ids, includeContact, sha256 } }, state => state));
      const receipt = result.state.audit.find(row => row.operationId === operationId);
      if (!receipt || receipt.action !== 'export' || receipt.actorId !== staff.id || receipt.details?.sha256 !== sha256) fail();
      return { workbook, revision: receipt.revision, count: ids.length, sha256, outcome: result.outcome };
    },
    async readPerson({ actor, contactId = null, registrationId = null } = {}) {
      const staff = actorValue(actor);
      if (contactId !== null && (typeof contactId !== 'string' || !ID.test(contactId)) || registrationId !== null && (typeof registrationId !== 'string' || !REGISTRATION.test(registrationId)) || !contactId && !registrationId) fail('INVALID_REQUEST');
      const loaded = await readFor(staff), contact = contactId ? loaded.sources.identities['contact:' + contactId] : null,
        registration = registrationId ? loaded.sources.identities['registration:' + registrationId] : null;
      if (contactId && !contact || registrationId && !registration || contact && registration && (!contact.canonicalId || contact.canonicalId !== registration.canonicalId)) fail();
      const canonicalId = (contact ?? registration).canonicalId;
      if (!canonicalId) fail();
      const shifts = new Map(loaded.view.shifts.map(row => [row.id, row])), positions = new Map(loaded.view.positions.map(row => [row.id, row]));
      const entries = loaded.view.volunteers.filter(row => row.person.canonicalId === canonicalId).map(row => ({ id: row.id, workflowStatus: row.workflowStatus, availability: row.availability,
        assignments: loaded.view.assignments.filter(entry => entry.volunteerId === row.id).map(entry => {
          const shift = shifts.get(entry.shiftId), position = shift && positions.get(shift.positionId);
          return { id: entry.id, status: entry.status, shiftId: entry.shiftId, positionId: shift?.positionId ?? '', positionName: position?.name ?? '', zone: position?.zone ?? '', location: position?.location ?? '',
            start: shift?.start ?? '', end: shift?.end ?? '', shiftStatus: shift?.status ?? 'missing', eligible: entry.valid, issues: entry.issues };
        }) }));
      return { revision: loaded.view.revision, entries };
    },
  });
}
