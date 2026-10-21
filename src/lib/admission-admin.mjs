import { admissionSummary } from './admission-view.mjs';

const ID = /^[A-Za-z0-9_-]{43}$/u;
const TEAM = /^t_[A-Za-z0-9_-]{22}$/u;
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
/** Reject contradictory capacity data before presenting controls or seat counts. */
export function admissionAdminState(value) {
  if (!plain(value) || !Number.isSafeInteger(value.revision) || value.revision < 0 || !plain(value.settings)
    || !Array.isArray(value.people) || value.people.length > 1000 || !Array.isArray(value.teams) || value.teams.length > 1000) return null;
  const summary = admissionSummary(value.summary);
  if (!summary || ['capacity','staffReserve','waitlistEnabled'].some(key => summary[key] !== value.settings[key])) return null;
  const ids = new Set(), queues = new Set(), teams = new Set(), membership = new Map();
  for (const person of value.people) {
    if (!plain(person) || !ID.test(person.registrationId ?? '') || ids.has(person.registrationId)
      || !['attendee','crew'].includes(person.kind) || !['confirmed','waitlisted','withdrawn'].includes(person.status)
      || !Number.isSafeInteger(person.queueNumber) || person.queueNumber < 1 || person.queueNumber > value.people.length || queues.has(person.queueNumber)
      || person.teamId !== '' && !TEAM.test(person.teamId ?? '')) return null;
    ids.add(person.registrationId);queues.add(person.queueNumber);
  }
  for (const team of value.teams) {
    if (!plain(team) || !TEAM.test(team.id ?? '') || teams.has(team.id) || typeof team.name !== 'string' || !team.name.trim() || [...team.name].length > 160
      || !Array.isArray(team.memberIds) || team.memberIds.length < 1 || team.memberIds.length > 50) return null;
    teams.add(team.id);
    for (const id of team.memberIds) { if (!ids.has(id) || membership.has(id)) return null; membership.set(id, team.id); }
  }
  if (value.people.some(person => person.teamId !== (membership.get(person.registrationId) ?? ''))
    || value.people.filter(person => person.status === 'confirmed').length !== summary.confirmedCount
    || value.people.filter(person => person.status === 'confirmed' && person.kind === 'crew').length !== summary.crewConfirmedCount
    || value.people.filter(person => person.status === 'waitlisted').length !== summary.waitlistCount) return null;
  return { ...value, summary };
}

/** An uncertain write can only be retried with its original body and operation ID. */
export function createAdmissionOperations({ request, revision, operationId = () => {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/gu,'-').replace(/\//gu,'_').replace(/=+$/u,'');
} }) {
  let pending = null, busy = false, generation = 0;
  async function send() {
    if (busy || !pending) throw new Error('请先核对当前操作结果。');
    const started = generation, operation = pending;
    busy = true;
    try {
      const result = await request(operation.path, { method: operation.method, body: operation.body });
      if (started !== generation) throw new Error('会话已改变，原操作结果已丢弃。');
      const state = admissionAdminState(result);
      if (!state || !['updated','replayed'].includes(result.outcome)) throw new Error('名额结果尚未通过核对，请保留本页并再次确认同一操作。');
      pending = null; return state;
    } catch (error) {
      // A definite rejection did not commit. A transport/5xx/invalid ACK may have committed.
      if (started === generation && Number.isInteger(error.status) && error.status >= 400 && error.status < 500) pending = null;
      throw error;
    } finally { if (started === generation) busy = false; }
  }
  return Object.freeze({
    get pending() { return pending !== null; },
    async run(path, data, method = 'POST') {
      if (pending || busy) throw new Error('上次操作结果尚未确认，请先再次确认同一操作。');
      const id = operationId(), expectedRevision = revision();
      if (!/^[A-Za-z0-9_-]{32,128}$/u.test(id) || !Number.isSafeInteger(expectedRevision) || expectedRevision < 0) throw new Error('名额版本尚未载入，请先刷新。');
      pending = { path, method, body: JSON.stringify({ ...data, expectedRevision, operationId: id }) };
      return send();
    },
    retry: send,
    clear() { generation++; pending = null; busy = false; },
  });
}
