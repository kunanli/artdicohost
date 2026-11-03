import { createHmac, hkdfSync } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { createConfirmationTokens } from '../registration-confirmation/tokens.mjs';
import { encodeQrPng } from './qr.mjs';

const API = 'https://api.artdico.host', SITE = 'https://artdico.host';
const ID = /^[A-Za-z0-9_-]{43}$/u, CODE = /^[A-Za-z0-9_-]{22}$/u, ACTOR = /^[A-Za-z0-9_-]{1,80}$/u;
const STATUS = ['pending_review', 'confirmed', 'waitlisted', 'rejected', 'withdrawn'];
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const exact = (value, keys) => plain(value) && Object.keys(value).sort().join(',') === [...keys].sort().join(',');
const revision = value => Number.isSafeInteger(value) && value >= 0;
const timestamp = value => typeof value === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/u.test(value) && Number.isFinite(Date.parse(value));
const line = value => typeof value === 'string' && value.length <= 1000 && !/[\u0000-\u001f\u007f]/u.test(value);
export class EntryTicketError extends Error {
  constructor(code = 'ENTRY_UNAVAILABLE') { super('Entry ticket could not be verified.'); this.code = ['ENTRY_NOT_FOUND', 'ENTRY_CONFLICT', 'ENTRY_UNAVAILABLE', 'FORBIDDEN', 'INVALID_REQUEST'].includes(code) ? code : 'ENTRY_UNAVAILABLE'; }
}
const fail = code => { throw new EntryTicketError(code); };
export function canCheckIn(actor) { return plain(actor) && ACTOR.test(actor.id ?? '') && Array.isArray(actor.roles) && actor.roles.some(role => ['reviewer', 'superadmin'].includes(role)); }

/** Separate opaque capabilities, private immutable mappings and a per-attendee atomic check-in. */
export function createEntryTicketService({ objects, journalFor, tokenSecret, event, authorizedRegistration, groupInviteProvider, groupImageProvider, clock = Date.now } = {}) {
  if (!objects || !['get', 'append'].every(name => typeof objects[name] === 'function') || typeof journalFor !== 'function'
    || typeof authorizedRegistration !== 'function' || typeof clock !== 'function'
    || typeof tokenSecret !== 'string' || Buffer.byteLength(tokenSecret) < 32 || Buffer.byteLength(tokenSecret) > 1024
    || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/u.test(event?.id ?? '')
    || groupInviteProvider !== undefined && typeof groupInviteProvider !== 'function' || groupImageProvider !== undefined && typeof groupImageProvider !== 'function') throw new TypeError('Trusted entry dependencies required.');
  const eventId = event.id, expiresAt = Date.parse(event.date?.value + 'T23:59:59.000+08:00') + 90 * 86400000;
  const entryExpiresAt = Date.parse(event.date?.value + 'T23:59:59.000+08:00');
  const tokens = createConfirmationTokens({ tokenSecret, eventId, expiresAt, clock });
  const key = Buffer.from(hkdfSync('sha256', Buffer.from(tokenSecret), Buffer.from(eventId), Buffer.from('artdico-entry-links-v1'), 32));
  const prefix = 'cms/v1/entry-tickets/' + eventId;
  const codeFor = value => createHmac('sha256', key).update(JSON.stringify(value)).digest('base64url').slice(0, 22);
  function now() { const value = clock(); if (!Number.isSafeInteger(value) || value < 0) fail(); return value; }
  function mapping(registrationId, accessRevision, purpose) { return { v: 1, eventId, registrationId, accessRevision, purpose, expiresAt: purpose === 'entry' ? entryExpiresAt : expiresAt }; }
  function validMapping(value, code) {
    return exact(value, ['v', 'eventId', 'registrationId', 'accessRevision', 'purpose', 'expiresAt']) && value.v === 1 && value.eventId === eventId
      && ID.test(value.registrationId ?? '') && revision(value.accessRevision) && ['receipt', 'entry'].includes(value.purpose)
      && value.expiresAt === (value.purpose === 'entry' ? entryExpiresAt : expiresAt) && value.expiresAt > now() && codeFor(value) === code;
  }
  async function load(registrationId, accessRevision) {
    let record; try { record = await authorizedRegistration(registrationId); }
    catch (error) { fail(['CONFIRMATION_NOT_FOUND', 'ENTRY_NOT_FOUND'].includes(error?.code) ? 'ENTRY_NOT_FOUND' : 'ENTRY_UNAVAILABLE'); }
    if (!plain(record) || record.registrationId !== registrationId || record.event?.id !== eventId || !STATUS.includes(record.admissionStatus)
      || !revision(record.accessRevision ?? 0) || !line(record.name) || !line(record.organization ?? '')) fail();
    if (record.admissionStatus === 'withdrawn' || (record.accessRevision ?? 0) !== accessRevision) fail('ENTRY_NOT_FOUND');
    const related = record.relatedRegistrationIds ?? [registrationId];
    if (!Array.isArray(related) || related.length < 1 || related.length > 100 || new Set(related).size !== related.length
      || !related.includes(registrationId) || related.some(id => !ID.test(id ?? ''))) fail();
    return { ...record, relatedRegistrationIds: [...related].sort() };
  }
  const mappingKey = code => prefix + '/links/l-' + code + '/mapping.jsonl';
  async function mappingObject(code) {
    let saved; try { saved = await objects.get(mappingKey(code), { maxBytes: 1024 }); } catch { fail(); }
    if (saved === null) return null;
    if (!saved || saved.objectType !== 'Appendable' || saved.contentType !== 'application/x-ndjson' || !(saved.data instanceof Uint8Array)
      || saved.data.length < 1 || saved.data.length > 1024) fail();
    let value; try { value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(saved.data)); } catch { fail(); }
    // One append at offset zero is the entire immutable mapping. Canonical bytes and
    // the purpose-separated HMAC prevent accepting an appended replacement or corruption.
    if (!validMapping(value, code) || !Buffer.from(saved.data).equals(Buffer.from(JSON.stringify(value) + '\n'))) fail('ENTRY_NOT_FOUND');
    return value;
  }
  async function readMapping(code, purpose) {
    if (!CODE.test(code ?? '')) fail('ENTRY_NOT_FOUND');
    const value = await mappingObject(code);
    if (!value || value.purpose !== purpose) fail('ENTRY_NOT_FOUND');
    return { mapping: value, record: await load(value.registrationId, value.accessRevision) };
  }
  async function saveMapping(value) {
    const code = codeFor(value);
    if (!validMapping(value, code)) fail();
    try {
      const current = await mappingObject(code);
      if (current !== null) { if (!isDeepStrictEqual(current, value)) fail(); return code; }
      try { await objects.append(mappingKey(code), 0, Buffer.from(JSON.stringify(value) + '\n')); }
      catch { /* A concurrent identical issuance or lost map ACK is resolved by reading only. */ }
      if (!isDeepStrictEqual(await mappingObject(code), value)) fail();
    } catch { fail(); }
    return code;
  }
  async function offeredGroup(record) {
    if (!groupInviteProvider || record.admissionStatus !== 'confirmed') return null;
    const offered = await groupInviteProvider({ receipt: { committed: true, eventId, registrationId: record.registrationId,
      referenceCode: record.registrationId, committedAt: record.submittedAt, admissionStatus: 'confirmed', accessRevision: record.accessRevision ?? 0 } });
    if (!offered) return null;
    const url = new URL(offered.qrImageUrl);
    if (url.origin !== API || url.username || url.password || url.search || url.hash || !url.pathname.startsWith('/api/admin/registration/group-invite/')
      || offered.platform !== 'wechat' || !timestamp(offered.expiresAt) || Date.parse(offered.expiresAt) <= now()) fail();
    return offered;
  }
  const journal = id => journalFor(prefix + '/checkins/r-' + id);
  function checkedState(state, registrationId) {
    if (!state || !revision(state.cursor?.version)) fail();
    if (state.value === null && state.cursor.version === 0) return { revision: 0, checkedIn: null };
    const value = state.value;
    if (!exact(value, ['schemaVersion', 'eventId', 'registrationId', 'revision', 'checkedIn']) || value.schemaVersion !== 1 || value.eventId !== eventId
      || value.registrationId !== registrationId || value.revision !== 1 || state.cursor.version !== 1
      || !exact(value.checkedIn, ['operationId', 'actorId', 'checkedInAt', 'accessRevision', 'ticketCode', 'relatedRegistrationIds']) || !ID.test(value.checkedIn.operationId ?? '')
      || !Array.isArray(value.checkedIn.relatedRegistrationIds) || value.checkedIn.relatedRegistrationIds.length < 1 || value.checkedIn.relatedRegistrationIds.length > 100
      || new Set(value.checkedIn.relatedRegistrationIds).size !== value.checkedIn.relatedRegistrationIds.length || !value.checkedIn.relatedRegistrationIds.includes(registrationId)
      || value.checkedIn.relatedRegistrationIds.some(id => !ID.test(id ?? ''))
      || !ACTOR.test(value.checkedIn.actorId ?? '') || !timestamp(value.checkedIn.checkedInAt) || !revision(value.checkedIn.accessRevision) || !CODE.test(value.checkedIn.ticketCode ?? '')) fail();
    return value;
  }
  async function context(code, actor) {
    if (!canCheckIn(actor)) fail('FORBIDDEN');
    const value = await readMapping(code, 'entry');
    const related = value.record.relatedRegistrationIds, states = new Map(); let position = 0;
    await Promise.all(Array.from({ length: Math.min(8, related.length) }, async () => {
      while (position < related.length) { const id = related[position++], state = await journal(id).read(); states.set(id, { state, checked: checkedState(state, id) }); }
    }));
    const primary = states.get(value.mapping.registrationId);
    const previous = [...states.values()].filter(item => item.checked.checkedIn).sort((a, b) => a.checked.checkedIn.checkedInAt.localeCompare(b.checked.checkedIn.checkedInAt))[0];
    return { ...value, state: primary.state, checked: previous?.checked ?? primary.checked };
  }
  function view(code, record, checked, actor) {
    const eligible = record.admissionStatus === 'confirmed';
    return { ticketCode: code, revision: checked.revision, registrationId: record.registrationId, name: eligible ? record.name : '',
      organization: eligible ? record.organization ?? '' : '', admissionStatus: record.admissionStatus,
      checkedInAt: checked.checkedIn?.checkedInAt ?? null, eligible, canCheckIn: canCheckIn(actor) && eligible && !checked.checkedIn };
  }
  return Object.freeze({
    prefix,
    async issueEntry({ registrationId, accessRevision = 0 } = {}) {
      if (!ID.test(registrationId ?? '') || !revision(accessRevision)) fail('INVALID_REQUEST');
      const record = await load(registrationId, accessRevision);
      if (record.admissionStatus !== 'confirmed') fail('ENTRY_NOT_FOUND');
      const code = await saveMapping(mapping(registrationId, accessRevision, 'entry'));
      const latest = await load(registrationId, accessRevision);
      if (latest.admissionStatus !== 'confirmed') fail('ENTRY_NOT_FOUND');
      return { admissionUrl: API + '/admin/checkin/#ticket=' + code };
    },
    async issue({ registrationId, accessRevision = 0 } = {}) {
      if (!ID.test(registrationId ?? '') || !revision(accessRevision)) fail('INVALID_REQUEST');
      const record = await load(registrationId, accessRevision), receiptCode = await saveMapping(mapping(registrationId, accessRevision, 'receipt'));
      const confirmationUrl = SITE + '/r/#' + receiptCode;
      const result = { confirmationUrl, expiresAt: new Date(expiresAt).toISOString() };
      if (record.admissionStatus === 'confirmed') {
        const entryCode = await saveMapping(mapping(registrationId, accessRevision, 'entry'));
        Object.assign(result, { admissionUrl: API + '/admin/checkin/#ticket=' + entryCode,
          admissionQrImageUrl: API + '/api/admin/registration/entry-links/' + receiptCode + '/entry.png' });
        const group = await offeredGroup(record);
        if (group) Object.assign(result, { groupQrImageUrl: API + '/api/admin/registration/entry-links/' + receiptCode + '/group.png', groupExpiresAt: group.groupExpiresAt ?? group.expiresAt });
      }
      await load(registrationId, accessRevision);
      return result;
    },
    async resolve({ code } = {}) {
      const { mapping: value } = await readMapping(code, 'receipt');
      const signed = tokens.issue(value.registrationId, value.accessRevision);
      return { confirmationUrl: SITE + '/registration/confirmation/#r=' + signed.receiptToken };
    },
    async entryImage({ code } = {}) {
      const value = await readMapping(code, 'receipt');
      if (value.record.admissionStatus !== 'confirmed' || now() >= entryExpiresAt) fail('ENTRY_NOT_FOUND');
      const entry = mapping(value.mapping.registrationId, value.mapping.accessRevision, 'entry'), entryCode = codeFor(entry);
      // Image reads do not mint mappings or check-ins. Issuance must already have saved the entry.
      await readMapping(entryCode, 'entry');
      const data = await encodeQrPng(API + '/admin/checkin/#ticket=' + entryCode);
      const latest = await load(entry.registrationId, entry.accessRevision);
      if (latest.admissionStatus !== 'confirmed') fail('ENTRY_NOT_FOUND');
      return { data, contentType: 'image/png' };
    },
    async groupImage({ code } = {}) {
      const value = await readMapping(code, 'receipt');
      if (value.record.admissionStatus !== 'confirmed' || !groupImageProvider) fail('ENTRY_NOT_FOUND');
      const offered = await offeredGroup(value.record);
      if (!offered) fail('ENTRY_NOT_FOUND');
      const token = new URL(offered.qrImageUrl).pathname.split('/').at(-1);
      const result = await groupImageProvider(token);
      if (!result || !(result.data instanceof Uint8Array) || !['image/png', 'image/jpeg', 'image/webp'].includes(result.contentType) || !result.data.length || result.data.length > 2 * 1024 * 1024) fail();
      const latest = await load(value.mapping.registrationId, value.mapping.accessRevision);
      if (latest.admissionStatus !== 'confirmed') fail('ENTRY_NOT_FOUND');
      return { data: result.data, contentType: result.contentType };
    },
    async inspect({ code, actor } = {}) { const value = await context(code, actor); return view(code, value.record, value.checked, actor); },
    async operation({ code, actor, operationId } = {}) {
      if (!ID.test(operationId ?? '')) fail('INVALID_REQUEST');
      const value = await context(code, actor), saved = value.checked.checkedIn;
      if (!saved || saved.operationId !== operationId || saved.actorId !== actor.id || saved.ticketCode !== code) return { found: false };
      return { found: true, result: { ...view(code, value.record, value.checked, actor), operationId, outcome: JSON.stringify(saved.relatedRegistrationIds) === JSON.stringify(value.record.relatedRegistrationIds) ? 'checked_in' : 'already_checked_in' } };
    },
    async checkIn({ code, actor, operationId, expectedRevision } = {}) {
      if (!ID.test(operationId ?? '') || !revision(expectedRevision)) fail('INVALID_REQUEST');
      const value = await context(code, actor), saved = value.checked.checkedIn;
      if (value.record.admissionStatus !== 'confirmed') fail('ENTRY_NOT_FOUND');
      if (saved) return { ...view(code, value.record, value.checked, actor), operationId,
        outcome: saved.operationId === operationId && saved.actorId === actor.id && saved.ticketCode === code && JSON.stringify(saved.relatedRegistrationIds) === JSON.stringify(value.record.relatedRegistrationIds) ? 'checked_in' : 'already_checked_in' };
      if (value.checked.revision !== expectedRevision) fail('ENTRY_CONFLICT');
      const refreshed = await context(code, actor), latest = refreshed.record;
      if (latest.admissionStatus !== 'confirmed') fail('ENTRY_NOT_FOUND');
      if (JSON.stringify(latest.relatedRegistrationIds) !== JSON.stringify(value.record.relatedRegistrationIds)) fail('ENTRY_CONFLICT');
      if (refreshed.checked.checkedIn) return { ...view(code, latest, refreshed.checked, actor), operationId, outcome: 'already_checked_in' };
      const next = { schemaVersion: 1, eventId, registrationId: value.mapping.registrationId, revision: 1,
        checkedIn: { operationId, actorId: actor.id, checkedInAt: new Date(now()).toISOString(), accessRevision: value.mapping.accessRevision, ticketCode: code, relatedRegistrationIds: latest.relatedRegistrationIds } };
      let committed;
      try { committed = await journal(value.mapping.registrationId).commit(value.state.cursor, next); }
      catch (error) { if (error?.code === 'WRITE_CONFLICT') fail('ENTRY_CONFLICT'); fail(); }
      if (!isDeepStrictEqual(committed.value, next)) fail();
      const record = await load(value.mapping.registrationId, value.mapping.accessRevision);
      if (record.admissionStatus !== 'confirmed') fail('ENTRY_NOT_FOUND');
      if (JSON.stringify(record.relatedRegistrationIds) !== JSON.stringify(latest.relatedRegistrationIds)) fail('ENTRY_CONFLICT');
      return { ...view(code, record, checkedState(committed, value.mapping.registrationId), actor), operationId, outcome: 'checked_in' };
    },
  });
}
