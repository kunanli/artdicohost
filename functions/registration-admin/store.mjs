import { createHash } from 'node:crypto';
import { RegistrationAdminError, isRegistrationAdminError } from './errors.mjs';

export const REVIEW_STATUSES = Object.freeze(['new', 'in_review', 'awaiting_maria', 'approved', 'discussion', 'not_this_time', 'withdrawn']);
export const ACCOMMODATION_STATUSES = Object.freeze(['not_requested', 'requested', 'pending', 'approved', 'declined']);
export const RECOMMENDATIONS = Object.freeze(['', 'priority', 'consider', 'follow_up']);
export const MARIA_DECISIONS = Object.freeze(['', 'approved', 'discussion', 'not_this_time']);
export const INVITATION_STATUSES = Object.freeze(['not_sent', 'to_send', 'sent', 'declined']);
export const MAX_REGISTRATION_REVIEW_AUDIT = 1000;
const ID = /^[A-Za-z0-9_-]{1,80}$/u;
const RECORD_ID = /^[A-Za-z0-9_-]{43}$/u;
const EVENT = /^[a-z0-9][a-z0-9-]{0,79}$/u;
const FILTER_NAMES = ['query', 'category', 'status', 'accommodation', 'city', 'attendance'];
const TEXT_LIMITS = { proposedRole: 240, internalNotes: 4000, assignedTo: 120, nextStep: 1000, mariaFeedback: 2000 };
const REVIEW_KEYS = ['status', 'accommodationStatus', 'recommendation', ...Object.keys(TEXT_LIMITS), 'lastContactDate', 'mariaReviewDate', 'mariaDecision', 'invitationStatus'];
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const clone = value => structuredClone(value);
const fail = code => { throw new RegistrationAdminError(code); };
const hash = text => createHash('sha256').update(text).digest('hex');
const validTime = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
const ownValues = value => plain(value) && Reflect.ownKeys(value).every(key => typeof key === 'string' && Object.getOwnPropertyDescriptor(value, key)?.enumerable && Object.hasOwn(Object.getOwnPropertyDescriptor(value, key), 'value'));
function safeText(value, max, optional = true) {
  if (typeof value !== 'string' || [...value].length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value)) fail('INVALID_REVIEW');
  const text = value.normalize('NFC').trim();
  if (!optional && !text) fail('INVALID_REVIEW');
  return text;
}
function date(value) {
  if (value === '') return '';
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/u.test(value) || !Number.isFinite(Date.parse(value + 'T00:00:00.000Z')) || new Date(value + 'T00:00:00.000Z').toISOString().slice(0, 10) !== value) fail('INVALID_REVIEW');
  return value;
}
function enumValue(value, values) { if (!values.includes(value)) fail('INVALID_REVIEW'); return value; }

export function defaultRegistrationReview(registration) {
  return { status: 'new', accommodationStatus: registration.fields.accommodationChoice === 'needed' ? 'requested' : 'not_requested',
    recommendation: '', proposedRole: '', internalNotes: '', assignedTo: '', lastContactDate: '', nextStep: '', mariaReviewDate: '', mariaFeedback: '', mariaDecision: '', invitationStatus: 'not_sent', deletionRequested: null };
}

export function validateRegistrationReview(value, registration) {
  const result = editableReview(value);
  if (registration.fields.accommodationChoice !== 'needed' && result.accommodationStatus !== 'not_requested'
    || registration.fields.accommodationChoice === 'needed' && result.accommodationStatus === 'not_requested') fail('INVALID_REVIEW');
  return result;
}

function editableReview(value) {
  if (!ownValues(value) || Reflect.ownKeys(value).some(key => !REVIEW_KEYS.includes(key)) || REVIEW_KEYS.some(key => !Object.hasOwn(value, key))) fail('INVALID_REVIEW');
  const result = {
    status: enumValue(value.status, REVIEW_STATUSES), accommodationStatus: enumValue(value.accommodationStatus, ACCOMMODATION_STATUSES),
    recommendation: enumValue(value.recommendation, RECOMMENDATIONS), proposedRole: safeText(value.proposedRole, TEXT_LIMITS.proposedRole),
    internalNotes: safeText(value.internalNotes, TEXT_LIMITS.internalNotes), assignedTo: safeText(value.assignedTo, TEXT_LIMITS.assignedTo),
    lastContactDate: date(value.lastContactDate), nextStep: safeText(value.nextStep, TEXT_LIMITS.nextStep), mariaReviewDate: date(value.mariaReviewDate),
    mariaFeedback: safeText(value.mariaFeedback, TEXT_LIMITS.mariaFeedback), mariaDecision: enumValue(value.mariaDecision, MARIA_DECISIONS), invitationStatus: enumValue(value.invitationStatus, INVITATION_STATUSES),
  };
  return result;
}

export function registrationFilters(input = {}) {
  if (!ownValues(input) || Object.keys(input).some(key => !FILTER_NAMES.includes(key))) fail('INVALID_REQUEST');
  const output = {};
  for (const key of FILTER_NAMES) {
    if (!Object.hasOwn(input, key) || input[key] === '') continue;
    if (typeof input[key] !== 'string' || [...input[key]].length > (key === 'query' ? 160 : 100) || /[\u0000-\u001f\u007f]/u.test(input[key])) fail('INVALID_REQUEST');
    output[key] = input[key].normalize('NFC').trim();
  }
  if (output.status && !REVIEW_STATUSES.includes(output.status) || output.accommodation && !ACCOMMODATION_STATUSES.includes(output.accommodation)
    || output.attendance && !['expected', 'uncertain', 'unavailable'].includes(output.attendance)
    || output.category && !['so', 'ro', 'new_site', 'industry', 'education', 'partner', 'sponsor', 'other'].includes(output.category)) fail('INVALID_REQUEST');
  return output;
}

function matches(item, filters) {
  const fields = item.fields, review = item.review;
  const text = [fields.name, fields.city, fields.organization, fields.position, item.referenceCode].filter(value => typeof value === 'string').join('\n').toLocaleLowerCase('zh-CN');
  return (!filters.query || text.includes(filters.query.toLocaleLowerCase('zh-CN')))
    && (!filters.city || (fields.city ?? '').toLocaleLowerCase('zh-CN') === filters.city.toLocaleLowerCase('zh-CN'))
    && (!filters.category || (fields.categories ?? []).includes(filters.category)) && (!filters.status || review.status === filters.status)
    && (!filters.accommodation || review.accommodationStatus === filters.accommodation) && (!filters.attendance || fields.attendance === filters.attendance);
}
function stats(items) {
  const result = { total: items.length, byStatus: {}, byCategory: {}, byAccommodation: {}, byAttendance: {} };
  for (const value of REVIEW_STATUSES) result.byStatus[value] = 0;
  for (const value of ACCOMMODATION_STATUSES) result.byAccommodation[value] = 0;
  for (const item of items) {
    result.byStatus[item.review.status]++;
    result.byAccommodation[item.review.accommodationStatus]++;
    for (const category of new Set(item.fields.categories?.length ? item.fields.categories : ['unknown'])) result.byCategory[category] = (result.byCategory[category] ?? 0) + 1;
    const attendance = item.fields.attendance || 'unknown';
    result.byAttendance[attendance] = (result.byAttendance[attendance] ?? 0) + 1;
  }
  return result;
}
function summary(item) {
  const fields = {};
  for (const key of ['name', 'city', 'organization', 'position', 'categories', 'participationInterests', 'attendance', 'accommodationChoice']) if (Object.hasOwn(item.fields, key)) fields[key] = clone(item.fields[key]);
  const provenance = item.provenance?.kind === 'staff_assisted' ? { kind: 'staff_assisted', sourceContactId: item.provenance.sourceContactId } : { kind: item.provenance.kind };
  return { id: item.id, eventId: item.eventId, submittedAt: item.submittedAt, referenceCode: item.referenceCode, fields, review: clone(item.review), provenance };
}
function csvCell(value) {
  const text = String(value ?? '').replace(/\r\n?/gu, '\n');
  // Spreadsheet import may ignore leading whitespace before a formula prefix.
  const safe = /^[\s\uFEFF]*[=+@-]/u.test(text) ? "'" + text : text;
  return '"' + safe.replaceAll('"', '""') + '"';
}
function csv(items, includeContact) {
  const headers = ['报名编号', '姓名', '机构', '城市', '身份', '参与意向', '到场安排', '候选审核', '住宿审核', '内部推荐', '推荐角色', 'Maria意见', '邀请状态', ...(includeContact ? ['邮箱', '微信'] : [])];
  const lines = [headers];
  for (const item of items) lines.push([item.referenceCode, item.fields.name, item.fields.organization, item.fields.city, (item.fields.categories ?? []).join(' / '),
    (item.fields.participationInterests ?? []).join(' / '), item.fields.attendance, item.review.status, item.review.accommodationStatus, item.review.recommendation,
    item.review.proposedRole, item.review.mariaDecision, item.review.invitationStatus, ...(includeContact ? [item.fields.email, item.fields.wechat] : [])]);
  return '\uFEFF' + lines.map(line => line.map(csvCell).join(',')).join('\r\n') + '\r\n';
}

/** Independent review journal; accepted applications remain immutable and never get overwritten by staff. */
export function createRegistrationReviewStore({ journal, loadRegistrations, eventId, clock = Date.now } = {}) {
  if (!journal || !['read', 'commit'].every(name => typeof journal[name] === 'function') || typeof loadRegistrations !== 'function' || typeof eventId !== 'string' || !EVENT.test(eventId) || typeof clock !== 'function') throw new TypeError('报名审核依赖未配置。');
  const initial = () => ({ schemaVersion: 1, kind: 'registration_reviews', eventId, revision: 0, reviews: {}, audit: [] });
  const at = () => { const now = clock(); if (!Number.isSafeInteger(now) || now < 0) fail('STORAGE_UNAVAILABLE'); return new Date(now).toISOString(); };
  async function guarded(action) {
    try { return await action(); }
    catch (error) { if (isRegistrationAdminError(error)) throw error; if (error?.code === 'WRITE_CONFLICT' && error.status === 409) fail('REVISION_CONFLICT'); fail('STORAGE_UNAVAILABLE'); }
  }
  function reviewState(stored) {
    if (!stored) fail('STORAGE_UNAVAILABLE');
    const state = stored.value ?? initial();
    if (!ownValues(state) || Object.keys(state).sort().join(',') !== 'audit,eventId,kind,reviews,revision,schemaVersion'
      || state.schemaVersion !== 1 || state.kind !== 'registration_reviews' || state.eventId !== eventId || !Number.isSafeInteger(state.revision) || state.revision < 0
      || !ownValues(state.reviews) || !Array.isArray(state.audit) || state.audit.length > MAX_REGISTRATION_REVIEW_AUDIT || state.revision !== state.audit.length
      || stored.cursor?.version !== state.revision
      || Buffer.byteLength(JSON.stringify(state)) > 1024 * 1024) fail('STORAGE_UNAVAILABLE');
    for (const [id, review] of Object.entries(state.reviews)) {
      if (!RECORD_ID.test(id) || !ownValues(review) || Object.keys(review).sort().join(',') !== [...REVIEW_KEYS, 'deletionRequested'].sort().join(',')) fail('STORAGE_UNAVAILABLE');
      try { const editable = { ...review }; delete editable.deletionRequested; editableReview(editable); } catch { fail('STORAGE_UNAVAILABLE'); }
      if (review.deletionRequested !== null && (!ownValues(review.deletionRequested) || Object.keys(review.deletionRequested).sort().join(',') !== 'reason,requestedAt,requestedBy,status'
        || !['request', 'retention', 'duplicate', 'other'].includes(review.deletionRequested.reason) || review.deletionRequested.status !== 'pending'
        || !validTime(review.deletionRequested.requestedAt) || typeof review.deletionRequested.requestedBy !== 'string' || !ID.test(review.deletionRequested.requestedBy))) fail('STORAGE_UNAVAILABLE');
    }
    let previousAt = '';
    for (let index = 0; index < state.audit.length; index++) {
      const entry = state.audit[index];
      if (!ownValues(entry) || Object.keys(entry).sort().join(',') !== 'action,actor,at,metadata,registrationId,revision'
        || typeof entry.actor !== 'string' || !ID.test(entry.actor) || !validTime(entry.at) || entry.at < previousAt || entry.revision !== index + 1 || !['update_review', 'export', 'deletion_requested'].includes(entry.action)
        || entry.registrationId !== null && !Object.hasOwn(state.reviews, entry.registrationId) || !ownValues(entry.metadata)) fail('STORAGE_UNAVAILABLE');
      const meta = entry.metadata;
      if (entry.action === 'update_review' && (Object.keys(meta).join(',') !== 'changedFields' || !Array.isArray(meta.changedFields) || meta.changedFields.some(key => !REVIEW_KEYS.includes(key)) || new Set(meta.changedFields).size !== meta.changedFields.length)
        || entry.action === 'export' && (entry.registrationId !== null || Object.keys(meta).sort().join(',') !== 'contactIncluded,count,filterNames' || !Number.isSafeInteger(meta.count) || meta.count < 0 || meta.count > 1000 || typeof meta.contactIncluded !== 'boolean'
          || !Array.isArray(meta.filterNames) || meta.filterNames.some(key => !FILTER_NAMES.includes(key)) || new Set(meta.filterNames).size !== meta.filterNames.length)
        || entry.action === 'deletion_requested' && (Object.keys(meta).join(',') !== 'reason' || !['request', 'retention', 'duplicate', 'other'].includes(meta.reason))) fail('STORAGE_UNAVAILABLE');
      previousAt = entry.at;
    }
    return state;
  }
  async function snapshot() {
    const [stored, source] = await Promise.all([journal.read(), loadRegistrations()]);
    if (!ownValues(source) || !Array.isArray(source.registrations) || source.registrations.length > 1000 || !Number.isSafeInteger(source.revision) || source.revision < 0) fail('STORAGE_UNAVAILABLE');
    const state = reviewState(stored);
    const seen = new Set();
    const registrations = source.registrations.map(record => {
      if (!ownValues(record) || typeof record.id !== 'string' || !RECORD_ID.test(record.id) || seen.has(record.id) || record.eventId !== eventId || !validTime(record.submittedAt)
        || !ownValues(record.fields) || typeof record.fields.name !== 'string'
        || !ownValues(record.provenance) || !['public', 'staff_assisted', 'staff_entry'].includes(record.provenance.kind) || !ownValues(record.consent)
        || record.provenance.kind === 'public' && record.consent.accepted !== true
        || record.provenance.kind === 'staff_assisted' && (record.consent.accepted !== false || typeof record.provenance.sourceContactId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/u.test(record.provenance.sourceContactId))
        || record.provenance.kind === 'staff_entry' && (record.consent.accepted !== false || record.consent.version !== null || record.consent.acceptedAt !== null
          || !ID.test(record.provenance.actorId ?? '') || !validTime(record.provenance.recordedAt) || typeof record.provenance.permissionReference !== 'string' || !record.provenance.permissionReference.trim()
          || !/^[A-Za-z0-9_-]{32,128}$/u.test(record.provenance.operationId ?? ''))) fail('STORAGE_UNAVAILABLE');
      const full = record.provenance.kind === 'public';
      if (['city', 'attendance', 'accommodationChoice'].some(key => (full || Object.hasOwn(record.fields, key)) && typeof record.fields[key] !== 'string')
        || ['organization', 'position'].some(key => Object.hasOwn(record.fields, key) && typeof record.fields[key] !== 'string')
        || ['categories', 'participationInterests'].some(key => (full || Object.hasOwn(record.fields, key)) && (!Array.isArray(record.fields[key]) || record.fields[key].some(value => typeof value !== 'string')))) fail('STORAGE_UNAVAILABLE');
      seen.add(record.id);
      const review = Object.hasOwn(state.reviews, record.id) ? state.reviews[record.id] : defaultRegistrationReview(record);
      try {
        const editable = { ...review }; delete editable.deletionRequested;
        validateRegistrationReview(editable, record);
      } catch { fail('STORAGE_UNAVAILABLE'); }
      return { ...clone(record), referenceCode: record.referenceCode ?? record.id, review: clone(review) };
    }).sort((a, b) => b.submittedAt.localeCompare(a.submittedAt) || a.id.localeCompare(b.id));
    // A missing application must not silently drop a review or be re-created from its audit.
    if (Object.keys(state.reviews).some(id => !RECORD_ID.test(id) || !seen.has(id))) fail('STORAGE_UNAVAILABLE');
    return { state: clone(state), cursor: stored.cursor, registrations, applicationRevision: source.revision };
  }
  async function mutation(expectedRevision, actor, action) {
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0 || typeof actor !== 'string' || !ID.test(actor)) fail('INVALID_REQUEST');
    const current = await snapshot();
    if (current.state.revision !== expectedRevision) fail('REVISION_CONFLICT');
    if (current.state.audit.length >= MAX_REGISTRATION_REVIEW_AUDIT) fail('CAPACITY_REACHED');
    const timestamp = at(), next = current.state;
    if (timestamp < (next.audit.at(-1)?.at ?? '')) fail('STORAGE_UNAVAILABLE');
    const result = action(current, next, timestamp);
    next.revision++;
    next.audit.push({ revision: next.revision, actor, at: timestamp, action: result.action, registrationId: result.registrationId ?? null, metadata: result.metadata ?? {} });
    if (Buffer.byteLength(JSON.stringify(next)) > 1024 * 1024) fail('CAPACITY_REACHED');
    const committed = await journal.commit(current.cursor, next);
    if (!committed || committed.value?.revision !== next.revision || hash(JSON.stringify(committed.value)) !== hash(JSON.stringify(next))) fail('STORAGE_UNAVAILABLE');
    return { ...result.value, revision: next.revision };
  }
  return Object.freeze({
    /** Call only after a committed receipt or signed ID is proven; never reads the application repository. */
    async isWithdrawn(id) { return guarded(async () => {
      if (typeof id !== 'string' || !RECORD_ID.test(id)) fail('INVALID_REQUEST');
      const state = reviewState(await journal.read());
      if (!Object.hasOwn(state.reviews, id)) return false;
      return state.reviews[id].status === 'withdrawn' || state.reviews[id].deletionRequested !== null;
    }); },
    async list({ filters: input = {}, cursor = '', limit = 25 } = {}) { return guarded(async () => {
      const filters = registrationFilters(input);
      if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100 || typeof cursor !== 'string' || cursor.length > 1024) fail('INVALID_REQUEST');
      const current = await snapshot(), filterHash = hash(JSON.stringify(filters));
      let offset = 0;
      if (cursor) {
        let parsed;
        try { if (!/^[A-Za-z0-9_-]+$/u.test(cursor)) throw new Error(); parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')); } catch { fail('INVALID_REQUEST'); }
        if (!ownValues(parsed) || Object.keys(parsed).sort().join(',') !== 'applicationRevision,filterHash,offset,revision' || !Number.isSafeInteger(parsed.offset) || parsed.offset < 0 || parsed.offset > 1000 || parsed.filterHash !== filterHash) fail('INVALID_REQUEST');
        if (parsed.revision !== current.state.revision || parsed.applicationRevision !== current.applicationRevision) fail('REVISION_CONFLICT');
        offset = parsed.offset;
      }
      const selected = current.registrations.filter(item => matches(item, filters));
      const nextOffset = offset + limit;
      const nextCursor = nextOffset < selected.length ? Buffer.from(JSON.stringify({ offset: nextOffset, revision: current.state.revision, applicationRevision: current.applicationRevision, filterHash })).toString('base64url') : null;
      return { registrations: selected.slice(offset, nextOffset).map(summary), total: selected.length, overallTotal: current.registrations.length,
        nextCursor, stats: stats(selected), revision: current.state.revision };
    }); },
    async detail(id) { return guarded(async () => {
      if (typeof id !== 'string' || !ID.test(id)) fail('NOT_FOUND');
      const current = await snapshot(), item = current.registrations.find(record => record.id === id);
      if (!item) fail('NOT_FOUND');
      const registration = clone(item); delete registration.review;
      return { registration, review: item.review, revision: current.state.revision };
    }); },
    async saveReview(id, expectedRevision, value, actor) { return guarded(() => mutation(expectedRevision, actor, (current, next) => {
      const item = current.registrations.find(record => record.id === id);
      if (!item) fail('NOT_FOUND');
      const review = { ...validateRegistrationReview(value, item), deletionRequested: item.review.deletionRequested };
      const changedFields = REVIEW_KEYS.filter(key => review[key] !== item.review[key]);
      next.reviews[id] = review;
      return { action: 'update_review', registrationId: id, metadata: { changedFields }, value: { review } };
    })); },
    async exportCsv(expectedRevision, input, actor, { includeContact = false } = {}) { return guarded(() => {
      if (typeof includeContact !== 'boolean') fail('INVALID_REQUEST');
      const filters = registrationFilters(input);
      return mutation(expectedRevision, actor, (current) => {
        const selected = current.registrations.filter(item => matches(item, filters));
        return { action: 'export', metadata: { count: selected.length, contactIncluded: includeContact, filterNames: Object.keys(filters) }, value: { csv: csv(selected, includeContact), count: selected.length } };
      });
    }); },
    async requestDeletion(id, expectedRevision, reason, actor) { return guarded(() => mutation(expectedRevision, actor, (current, next, timestamp) => {
      if (!['request', 'retention', 'duplicate', 'other'].includes(reason)) fail('INVALID_REQUEST');
      const item = current.registrations.find(record => record.id === id);
      if (!item) fail('NOT_FOUND');
      if (item.review.deletionRequested) fail('REVISION_CONFLICT');
      const review = { ...item.review, deletionRequested: { requestedAt: timestamp, requestedBy: actor, reason, status: 'pending' } };
      next.reviews[id] = review;
      return { action: 'deletion_requested', registrationId: id, metadata: { reason }, value: { review, erased: false, maintenanceRequired: true } };
    })); },
  });
}
