import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { emptyVolunteerState, validateVolunteerState, VOLUNTEER_ACTIONS, VOLUNTEER_ID, VOLUNTEER_OPERATION_ID,
  VOLUNTEER_LIMITS, volunteerExactKeys, volunteerRevision, isVolunteerPlainObject } from '../../shared/volunteer-schema.mjs';

const HASH = /^[a-f0-9]{64}$/u, ACTOR = /^[A-Za-z0-9_-]{1,80}$/u;
const clone = value => structuredClone(value);
const fingerprint = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
function fail(code = 'STORAGE_UNAVAILABLE', status = 503) {
  const messages = { INVALID_REQUEST: '志愿者操作资料无效。', REVISION_CONFLICT: '志愿者资料已更新，请保留本页并重新核对。', OPERATION_CONFLICT: '此操作编号已用于另一份内容，请先核对原操作。', CAPACITY_EXCEEDED: '志愿者记录已达到维护上限，请保留资料并联系管理员。' };
  const error = new Error(messages[code] ?? '志愿者资料暂时无法核对，请保留本页后重试。'); error.code = code; error.status = status; throw error;
}
function canonicalPayload(value, depth = 0) {
  if (depth > 12) fail('INVALID_REQUEST', 400);
  if (value === null || typeof value === 'boolean' || typeof value === 'string' || Number.isFinite(value)) return value;
  if (Array.isArray(value)) {
    if (value.length > 1000 || Reflect.ownKeys(value).length !== value.length + 1
      || Object.keys(value).some((key, index) => key !== String(index) || !('value' in Object.getOwnPropertyDescriptor(value, key)))) fail('INVALID_REQUEST', 400);
    return value.map(item => canonicalPayload(item, depth + 1));
  }
  if (!isVolunteerPlainObject(value) || Reflect.ownKeys(value).length > 100
    || Reflect.ownKeys(value).some(key => typeof key !== 'string' || !('value' in Object.getOwnPropertyDescriptor(value, key)))) fail('INVALID_REQUEST', 400);
  return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonicalPayload(value[key], depth + 1)]));
}
function cursor(value) {
  return volunteerExactKeys(value, ['position', 'version', 'hash']) && volunteerRevision(value.position) && volunteerRevision(value.version)
    && (value.hash === null || typeof value.hash === 'string' && HASH.test(value.hash));
}
function unchangedHistory(previous, next) {
  for (const key of ['volunteers', 'positions', 'shifts', 'assignments']) {
    const nextIds = new Set(next[key].map(item => item.id));
    if (previous[key].some(item => !nextIds.has(item.id))) fail('INVALID_REQUEST', 400);
  }
  for (const volunteer of previous.volunteers) {
    const updated = next.volunteers.find(item => item.id === volunteer.id);
    if (!isDeepStrictEqual(volunteer.source, updated.source)) fail('INVALID_REQUEST', 400);
  }
  for (const assignment of previous.assignments) {
    const updated = next.assignments.find(item => item.id === assignment.id);
    if (updated.volunteerId !== assignment.volunteerId || updated.shiftId !== assignment.shiftId) fail('INVALID_REQUEST', 400);
  }
}

/** Shared durable CAS log. Reads never initialize or migrate storage. */
export function createVolunteerRepository({ journal, eventId, clock = Date.now } = {}) {
  if (!journal || typeof journal.read !== 'function' || typeof journal.commit !== 'function' || typeof eventId !== 'string' || !VOLUNTEER_ID.test(eventId) || typeof clock !== 'function') throw new TypeError('Trusted volunteer journal and event required.');
  async function load() {
    try {
      const result = await journal.read();
      if (!volunteerExactKeys(result, ['value', 'cursor']) || !cursor(result.cursor)) fail();
      if (result.value === null) {
        if (result.cursor.position !== 0 || result.cursor.version !== 0 || result.cursor.hash !== null) fail();
        return { value: emptyVolunteerState(eventId), cursor: clone(result.cursor) };
      }
      if (result.cursor.position <= 0 || result.cursor.version <= 0 || result.cursor.hash === null) fail();
      const value = validateVolunteerState(result.value, { eventId });
      if (value.revision !== result.cursor.version) fail();
      return { value, cursor: clone(result.cursor) };
    } catch { fail(); }
  }
  return Object.freeze({
    async read() { return (await load()).value; },
    async mutate({ actorId, expectedRevision, operationId, action, payload, details } = {}, apply) {
      if (typeof actorId !== 'string' || !ACTOR.test(actorId) || !volunteerRevision(expectedRevision) || typeof operationId !== 'string' || !VOLUNTEER_OPERATION_ID.test(operationId) || !VOLUNTEER_ACTIONS.includes(action)
        || typeof apply !== 'function' || details !== undefined && action !== 'export') fail('INVALID_REQUEST', 400);
      const canonical = canonicalPayload(payload);
      if (new TextEncoder().encode(JSON.stringify(canonical)).byteLength > 64 * 1024) fail('INVALID_REQUEST', 400);
      const digest = fingerprint({ actorId, expectedRevision, action, payload: canonical });
      const current = await load(), previous = current.value;
      const replay = previous.audit.find(entry => entry.operationId === operationId);
      if (replay) {
        if (replay.actorId !== actorId || replay.fingerprint !== digest || replay.action !== action) fail('OPERATION_CONFLICT', 409);
        return { outcome: 'replayed', state: clone(previous) };
      }
      if (expectedRevision !== previous.revision) fail('REVISION_CONFLICT', 409);
      if (previous.audit.length >= VOLUNTEER_LIMITS.audit) fail('CAPACITY_EXCEEDED', 409);
      let transformed;
      try { transformed = await apply(clone(previous)); } catch (error) { throw error; }
      if (!isVolunteerPlainObject(transformed) || transformed.eventId !== undefined && transformed.eventId !== eventId
        || transformed.schemaVersion !== undefined && transformed.schemaVersion !== 1) fail('INVALID_REQUEST', 400);
      const now = clock();
      if (!Number.isSafeInteger(now) || now < 0 || !Number.isFinite(new Date(now).getTime())) fail();
      const at = new Date(now).toISOString();
      if (previous.audit.length && previous.audit.at(-1).at > at) fail();
      const entry = { revision: previous.revision + 1, operationId, action, actorId, fingerprint: digest, at, ...(details === undefined ? {} : { details: clone(details) }) };
      const candidate = { schemaVersion: 1, eventId, revision: entry.revision,
        volunteers: transformed.volunteers, positions: transformed.positions, shifts: transformed.shifts, assignments: transformed.assignments,
        audit: [...previous.audit, entry] };
      for (const key of ['volunteers', 'positions', 'shifts', 'assignments']) if (Array.isArray(candidate[key]) && candidate[key].length > VOLUNTEER_LIMITS[key]) fail('CAPACITY_EXCEEDED', 409);
      try { if (new TextEncoder().encode(JSON.stringify(candidate)).byteLength > VOLUNTEER_LIMITS.bytes) fail('CAPACITY_EXCEEDED', 409); }
      catch (error) { if (error?.code === 'CAPACITY_EXCEEDED') throw error; fail('INVALID_REQUEST', 400); }
      let next;
      try { next = validateVolunteerState(candidate, { eventId }); } catch { fail('INVALID_REQUEST', 400); }
      unchangedHistory(previous, next);
      if (new TextEncoder().encode(JSON.stringify(next)).byteLength >= VOLUNTEER_LIMITS.bytes) fail('CAPACITY_EXCEEDED', 409);
      try {
        const ack = await journal.commit(clone(current.cursor), next);
        if (!volunteerExactKeys(ack, ['value', 'cursor']) || !cursor(ack.cursor) || !isDeepStrictEqual(ack.value, next)
          || ack.cursor.version !== next.revision || ack.cursor.position <= current.cursor.position || ack.cursor.hash === null) fail();
      } catch (error) {
        if (error?.code === 'WRITE_CONFLICT' && error?.status === 409 || error?.code === 'REVISION_CONFLICT' && error?.status === 409) fail('REVISION_CONFLICT', 409);
        fail();
      }
      return { outcome: 'updated', state: clone(next) };
    },
  });
}
