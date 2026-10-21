import { eventConfig } from '../../src/config/event.mjs';
import { performance } from 'node:perf_hooks';
import { plainObject, own, parseTimestamp } from '../registration-api/policy.mjs';
import { CloudContentError } from '../cloud-content/errors.mjs';
import { createConfirmationTokens } from './tokens.mjs';
import { createConfirmationRepository, canonicalConfirmationKind, confirmationNoticeId, confirmationRequestHash, validConfirmationOperation, MAX_CONFIRMATION_BATCH } from './repository.mjs';
import { canManageEventOperations } from '../../shared/staff-permissions.mjs';
import { buildPosterInvitationSettings } from '../../shared/organizer-progress.mjs';

const SITE = 'https://artdico.host';
const ID = /^[A-Za-z0-9_-]{43}$/u;
const STATUS = ['pending_review', 'confirmed', 'waitlisted', 'rejected', 'withdrawn'];
const actorValid = actor => typeof own(actor, 'id') === 'string' && /^[A-Za-z0-9_-]{1,80}$/u.test(actor.id)
  && canManageEventOperations(actor);
const automaticActor = 'system-confirmation';
const stateOf = notice => notice?.status === 'reserved' ? 'unknown' : notice?.status;
const conflict = error => error instanceof CloudContentError && error.code === 'WRITE_CONFLICT' && error.status === 409;
const ERRORS = { CONFIRMATION_UNAVAILABLE: 503, CONFIRMATION_NOT_FOUND: 404, FORBIDDEN: 403, AUTH_REQUIRED: 401,
  INVALID_REQUEST: 400, ORIGIN_REJECTED: 403, CSRF_REJECTED: 403, UNSUPPORTED_MEDIA_TYPE: 415,
  BODY_TOO_LARGE: 413, REQUEST_TIMEOUT: 408, REVISION_CONFLICT: 409, METHOD_NOT_ALLOWED: 405, NOT_FOUND: 404 };
export class ConfirmationError extends Error {
  constructor(code = 'CONFIRMATION_UNAVAILABLE', status = 503) { super('Confirmation could not be verified.');
    this.code = Object.hasOwn(ERRORS, code) && ERRORS[code] === status ? code : 'CONFIRMATION_UNAVAILABLE'; this.status = ERRORS[this.code]; }
}
const failure = (code, status) => { throw new ConfirmationError(code, status); };
function facts(event) {
  const value = { id: event?.id, title: event?.title, date: event?.date?.value,
    time: event?.time?.label || event?.time?.opening + '–' + event?.time?.end,
    venue: event?.venue?.address || event?.venue?.name, timezone: event?.time?.timezone, checkIn: event?.time?.start };
  if (Object.values(value).some(item => typeof item !== 'string' || !item.trim() || item.length > 1000 || /[\u0000-\u001f\u007f]/u.test(item))
    || !/^\d{4}-\d\d-\d\d$/u.test(value.date) || parseTimestamp(value.date + 'T23:59:59.000+08:00') === null
    || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/u.test(value.id)) throw new TypeError('Confirmed event facts required.');
  return Object.freeze(value);
}
const noticeEmail = notice => ({ status: stateOf(notice), noticeType: notice.kind, admissionStatus: notice.admissionStatus });

/** Durable receipts, independent email issuance and read-only attendee confirmation. */
export function createRegistrationConfirmationService({ registrationService, journalFor, tokenSecret, event = eventConfig,
  emailProvider, walletReadiness = () => ({ ready: false, reason: 'WALLET_NOT_CONFIGURED' }), groupInviteProvider,
  clock = Date.now, expiresAt, batchTimeoutMs = 20_000, monotonicNow = () => performance.now() } = {}) {
  if (typeof registrationService?.repository?.readIndex !== 'function' || typeof registrationService.repository.readRecord !== 'function'
    || typeof registrationService.getAdmissionStatus !== 'function' || typeof journalFor !== 'function' || typeof clock !== 'function'
    || typeof walletReadiness !== 'function' || groupInviteProvider !== undefined && typeof groupInviteProvider !== 'function'
    || !Number.isSafeInteger(batchTimeoutMs) || batchTimeoutMs < 1 || batchTimeoutMs > 30_000 || typeof monotonicNow !== 'function') throw new TypeError('Trusted confirmation dependencies required.');
  const eventFacts = facts(event), eventId = eventFacts.id;
  const expiry = expiresAt ?? Date.parse(eventFacts.date + 'T23:59:59.000+08:00') + 90 * 24 * 60 * 60 * 1000;
  const tokens = createConfirmationTokens({ tokenSecret, eventId, expiresAt: expiry, clock });
  const prefix = 'cms/v1/registration-confirmations/' + eventId;
  let repository;
  const target = () => repository ??= createConfirmationRepository({ journal: journalFor(prefix), eventId, clock });
  async function providerState() {
    try {
      const value = await emailProvider?.readiness?.();
      return { ready: value?.ready === true && typeof emailProvider?.send === 'function',
        reason: value?.ready === true ? 'CONFIGURED_PROVIDER_NOT_DELIVERY_PROOF' : 'EMAIL_NOT_READY',
        enabled: value?.enabled === true,
        missing: Array.isArray(value?.missing) ? value.missing.filter(key => typeof key === 'string' && /^[A-Z][A-Z0-9_]{0,79}$/u.test(key)) : [],
        template: 'confirmation', deliveryProof: false };
    } catch { return { ready: false, enabled: false, reason: 'EMAIL_NOT_READY', missing: [], template: 'confirmation', deliveryProof: false }; }
  }
  async function walletState(admin = false) {
    try { const value = await walletReadiness(), basic = { ready: value?.ready === true, reason: typeof value?.reason === 'string' && /^[A-Z_]{1,80}$/u.test(value.reason) ? value.reason : 'WALLET_NOT_CONFIGURED' };
      if (!admin) return basic;
      return { ...basic, missing: Array.isArray(value?.missing) ? value.missing.filter(key => typeof key === 'string' && /^[A-Z][A-Z0-9_]{0,79}$/u.test(key)).slice(0, 20) : [],
        deviceTestRequired: value?.deviceTestRequired !== false,
        ...(parseTimestamp(value?.certificateExpiresAt) === null ? {} : { certificateExpiresAt: new Date(value.certificateExpiresAt).toISOString() }) };
    }
    catch { return { ready: false, reason: 'WALLET_NOT_CONFIGURED' }; }
  }
  async function loadRegistration(registrationId) {
    if (!ID.test(registrationId ?? '')) failure('CONFIRMATION_NOT_FOUND', 404);
    try {
      const { value } = await registrationService.repository.readIndex(), entry = value.entries.find(item => item.id === registrationId);
      if (!entry) failure('CONFIRMATION_NOT_FOUND', 404);
      const record = await registrationService.repository.readRecord(entry), admission = await registrationService.getAdmissionStatus(registrationId);
      if (!STATUS.includes(admission?.status) || !['attendee', 'crew'].includes(admission?.kind)
        || !Number.isSafeInteger(admission?.revision) || admission.revision < 0) failure();
      return { record, admission, entry };
    } catch (error) { if (error instanceof ConfirmationError) throw error; failure(); }
  }
  function trustedProjection(registrationId, loaded) {
    const { record, admission, entry } = loaded, hidden = admission.status === 'withdrawn';
    return { registrationId, referenceCode: registrationId, admissionStatus: admission.status, admissionKind: admission.kind,
      admissionRevision: admission.revision, name: hidden ? '' : record.fields.name, organization: hidden ? '' : record.fields.organization ?? '',
      event: { ...eventFacts }, submittedAt: entry.committedAt, hasEmail: typeof record.fields.email === 'string' && Boolean(record.fields.email) };
  }
  async function authorizedRegistration(registrationId) { return trustedProjection(registrationId, await loadRegistration(registrationId)); }
  async function authorizedContext(input) {
    const claims = tokens.verify(own(input, 'receiptToken'));
    if (!claims) failure('CONFIRMATION_NOT_FOUND', 404);
    return { registrationId: claims.registrationId, loaded: await loadRegistration(claims.registrationId) };
  }
  async function authorize(input) {
    const { registrationId, loaded } = await authorizedContext(input);
    return trustedProjection(registrationId, loaded);
  }
  function invitationProjection({ record, admission }) {
    if (record.provenance.kind !== 'public' || admission.status !== 'confirmed') return { ready: false };
    try { return { ready: true, settings: buildPosterInvitationSettings(record.fields.name, event) }; }
    catch { return { ready: false }; }
  }
  function capability(registrationId) {
    const signed = tokens.issue(registrationId);
    return { ...signed, confirmationUrl: SITE + '/registration/confirmation/#r=' + signed.receiptToken };
  }
  async function readEmail(registrationId, hasEmail, admissionStatus) {
    if (!hasEmail) return { status: 'not_applicable' };
    const current = await target().read(), notices = current.value.notices.filter(item => item.registrationId === registrationId);
    const notice = notices.find(item => item.kind === 'promotion') ?? notices.find(item => item.kind === 'registration');
    if (notice) return noticeEmail(notice);
    if (admissionStatus !== 'confirmed') return { status: 'not_applicable' };
    if (!current.value.settings.enabled) return { status: 'disabled' };
    return { status: (await providerState()).ready ? 'pending' : 'not_configured' };
  }
  async function reserve(registrationId, admission, actorId, retryRejected, deadline) {
    if (admission.status !== 'confirmed') return { status: 'not_applicable' };
    for (let tries = 0; tries < 4; tries++) {
      if (monotonicNow() >= deadline) return { status: 'not_attempted' };
      const current = await target().read(), kind = canonicalConfirmationKind(current.value, registrationId, admission.status);
      const previous = current.value.notices.find(item => item.id === confirmationNoticeId(eventId, registrationId, kind));
      if (!current.value.settings.enabled) return { status: 'disabled' };
      if (previous && (!retryRejected || previous.status !== 'rejected' || previous.attempt >= 5)) return { notice: previous, owned: false };
      if (monotonicNow() >= deadline) return { status: 'not_attempted' };
      try {
        const saved = await target().append(current, 'reserve', { registrationId, kind, admissionStatus: admission.status, admissionRevision: admission.revision, retryRejected }, actorId);
        return { notice: saved.value.notices.find(item => item.id === confirmationNoticeId(eventId, registrationId, kind)), owned: true };
      } catch (error) { if (!conflict(error)) throw error; }
    }
    failure();
  }
  async function recordResult(notice, status, actorId) {
    for (let tries = 0; tries < 4; tries++) {
      const current = await target().read(), item = current.value.notices.find(value => value.id === notice.id);
      if (!item || item.attempt !== notice.attempt || item.status !== 'reserved') failure();
      try { const saved = await target().append(current, 'result', { noticeId: notice.id, status }, actorId); return noticeEmail(saved.value.notices.find(value => value.id === notice.id)); }
      catch (error) { if (!conflict(error)) throw error; }
    }
    failure();
  }
  async function notify(registrationId, { kind = 'registration', actorId = automaticActor, retryRejected = false,
    deadline = monotonicNow() + batchTimeoutMs } = {}) {
    if (!(await providerState()).ready) return { status: 'not_configured' };
    if (monotonicNow() >= deadline) return { status: 'not_attempted' };
    const loaded = await loadRegistration(registrationId), { record, admission } = loaded;
    if (record.provenance.kind !== 'public') return { status: 'not_public' };
    if (admission.status === 'withdrawn') return { status: 'withdrawn' };
    if (admission.status !== 'confirmed') return { status: 'not_applicable' };
    if (typeof record.fields.email !== 'string' || !record.fields.email) return { status: 'not_applicable' };
    const reserved = await reserve(registrationId, admission, actorId, retryRejected, deadline);
    if (reserved.status) return reserved;
    if (!reserved.owned) return noticeEmail(reserved.notice);
    const notice = reserved.notice;
    // The reservation is already durable. Recheck withdrawal/current admission
    // immediately before the only external request; any failure remains unknown.
    let latest;
    try { latest = await loadRegistration(registrationId); }
    catch { try { return await recordResult(notice, 'rejected', actorId); } catch { return { status: 'unknown' }; } }
    if (latest.admission.status !== 'confirmed' || latest.admission.status !== admission.status
      || latest.record.fields.email !== record.fields.email || latest.record.provenance.kind !== 'public') {
      try { return await recordResult(notice, 'rejected', actorId); } catch { return { status: 'unknown' }; }
    }
    // An administrator may have paused automatic notices after reservation.
    // Recheck the durable switch immediately before contacting the provider.
    const delivery = await target().read();
    if (!delivery.value.settings.enabled) {
      try { return await recordResult(notice, 'rejected', actorId); } catch { return { status: 'unknown' }; }
    }
    if (monotonicNow() >= deadline) {
      try { await recordResult(notice, 'rejected', actorId); return { status: 'not_attempted' }; } catch { return { status: 'unknown' }; }
    }
    const link = capability(registrationId);
    const subject = eventFacts.title + '｜参会名额已确认';
    const text = [record.fields.name + '，你好：', '', '你的参会名额已确认。',
      '登记编号：' + registrationId, '日期：' + eventFacts.date, '活动时间：' + eventFacts.time + '（UTC+8）',
      '签到：' + eventFacts.checkIn, '地点：' + eventFacts.venue,
      '查看最新状态、打印确认页及下载个人邀请函：' + link.confirmationUrl,
      '请保管此私人链接，不要转发；确认页始终以当前名额状态为准。',
      '住宿、讲者、展位与其他职责分别确认。需要更正或取消，请通过原联系渠道联系筹备团队。'].join('\n');
    let result;
    try {
      result = await emailProvider.send({ recipient: record.fields.email, subject, text, canStart: () => monotonicNow() < deadline,
        idempotencyKey: 'c_' + confirmationRequestHash({ id: notice.id, attempt: notice.attempt }),
        templateVariables: { to_name: record.fields.name, to_email: record.fields.email, event_title: eventFacts.title,
          event_date: eventFacts.date, event_time: eventFacts.time, event_venue: eventFacts.venue, reference_code: registrationId, invitation_text: text } });
    } catch { result = { status: 'unknown' }; }
    const status = ['provider_accepted', 'rejected'].includes(result?.status) ? result.status : 'unknown';
    try { const saved = await recordResult(notice, status, actorId);
      return result?.reason === 'DELIVERY_WINDOW_EXPIRED' && status === 'rejected' ? { status: 'not_attempted' } : saved;
    } catch { return { status: 'unknown' }; }
  }
  async function forSavedReceipt({ receipt, notify: send = true } = {}) {
    if (receipt?.committed !== true || receipt.eventId !== eventId || !ID.test(receipt.registrationId ?? '')
      || receipt.referenceCode !== receipt.registrationId || parseTimestamp(receipt.committedAt) === null
      || !STATUS.includes(receipt.admissionStatus) || !['attendee', 'crew'].includes(receipt.admissionKind)
      || !Number.isSafeInteger(receipt.admissionRevision) || receipt.admissionRevision < 0 || typeof send !== 'boolean') failure();
    const result = capability(receipt.registrationId), deadline = monotonicNow() + batchTimeoutMs;
    // An application receipt has no formal notification reservation. The same
    // capability reads the current decision after a later explicit approval.
    if (!send || receipt.admissionStatus !== 'confirmed') return { ...result, email: { status: 'not_applicable' } };
    // Unconfigured notification adds no object access to the successful write.
    // This is configuration state, not a claim about historical delivery.
    if (!(await providerState()).ready) return { ...result, email: { status: 'not_configured' } };
    try { const email = await notify(receipt.registrationId, { deadline }); return { ...result,
      email: ['not_public', 'withdrawn'].includes(email.status) ? { status: 'not_applicable' }
        : email.status === 'not_attempted' ? { status: 'pending' } : email }; }
    catch { return { ...result, email: { status: 'unknown' } }; }
  }
  async function confirmation(input) {
    const { registrationId, loaded } = await authorizedContext(input), value = trustedProjection(registrationId, loaded);
    let email;
    if (['pending_review', 'rejected'].includes(value.admissionStatus)) email = { status: 'not_applicable' };
    else try { email = await readEmail(value.registrationId, value.hasEmail, value.admissionStatus); } catch { email = { status: 'unknown' }; }
    let groupInvite = null;
    if (value.admissionStatus === 'confirmed' && groupInviteProvider) {
      try { const offered = await groupInviteProvider({ receipt: { committed: true, eventId, registrationId: value.registrationId,
        referenceCode: value.referenceCode, committedAt: value.submittedAt, admissionStatus: value.admissionStatus,
        admissionKind: value.admissionKind, admissionRevision: value.admissionRevision }, origin: SITE });
        const url = new URL(offered?.qrImageUrl), expires = parseTimestamp(offered?.expiresAt);
        if (offered?.platform === 'wechat' && url.origin === 'https://api.artdico.host' && !url.username && !url.password && !url.hash
          && url.href.length <= 4096 && expires !== null && expires > clock()) groupInvite = { platform: 'wechat', qrImageUrl: url.href, expiresAt: new Date(expires).toISOString() };
      } catch { /* Optional current QR only. */ }
    }
    return { event: value.event, referenceCode: value.referenceCode, submittedAt: value.submittedAt,
      attendee: { name: value.name, organization: value.organization },
      admission: { status: value.admissionStatus, kind: value.admissionKind, revision: value.admissionRevision },
      invitation: invitationProjection(loaded),
      email, wallet: value.admissionStatus === 'confirmed' ? await walletState() : { ready: false, reason: 'ADMISSION_NOT_CONFIRMED' }, groupInvite };
  }
  async function settings({ actor } = {}) {
    if (!actorValid(actor)) failure('FORBIDDEN', 403);
    const current = await target().read(), counts = { total: current.value.notices.length, providerAccepted: 0, rejected: 0, unknown: 0 };
    for (const notice of current.value.notices) counts[notice.status === 'provider_accepted' ? 'providerAccepted' : notice.status === 'rejected' ? 'rejected' : 'unknown']++;
    return { revision: current.value.revision, automaticEnabled: current.value.settings.enabled, email: await providerState(), counts,
      dispatch: { maxBatch: MAX_CONFIRMATION_BATCH, retryRejected: true, unknownNeverResent: true }, wallet: await walletState(true) };
  }
  async function setSettings({ actor, expectedRevision, operationId, enabled } = {}) {
    if (!actorValid(actor)) failure('FORBIDDEN', 403);
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0 || !validConfirmationOperation(operationId) || typeof enabled !== 'boolean') failure('INVALID_REQUEST', 400);
    const requestHash = confirmationRequestHash({ actorId: actor.id, enabled }), current = await target().read();
    const previous = current.value.operations.find(op => op.operationId === operationId);
    if (previous) {
      if (previous.action !== 'settings' || previous.actorId !== actor.id || previous.requestHash !== requestHash) failure('REVISION_CONFLICT', 409);
      return { outcome: 'replayed', ...await settings({ actor }) };
    }
    if (current.value.revision !== expectedRevision) failure('REVISION_CONFLICT', 409);
    try { await target().append(current, 'settings', { operationId, requestHash, enabled }, actor.id); }
    catch (error) { if (conflict(error)) failure('REVISION_CONFLICT', 409); failure(); }
    return { outcome: 'updated', ...await settings({ actor }) };
  }
  async function completeBatch(operationId, results, actorId) {
    for (let tries = 0; tries < 4; tries++) {
      const current = await target().read();
      try { return await target().append(current, 'dispatch_completed', { operationId, results }, actorId); }
      catch (error) { if (!conflict(error)) throw error; }
    }
    failure();
  }
  async function dispatch({ actor, expectedRevision, operationId, registrationIds, retryRejected = false } = {}) {
    if (!actorValid(actor)) failure('FORBIDDEN', 403);
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0 || !validConfirmationOperation(operationId)
      || !Array.isArray(registrationIds) || !registrationIds.length || registrationIds.length > MAX_CONFIRMATION_BATCH
      || new Set(registrationIds).size !== registrationIds.length || registrationIds.some(id => !ID.test(id)) || typeof retryRejected !== 'boolean') failure('INVALID_REQUEST', 400);
    const deadline = monotonicNow() + batchTimeoutMs;
    const requestHash = confirmationRequestHash({ actorId: actor.id, registrationIds, retryRejected }), current = await target().read();
    const previous = current.value.operations.find(op => op.operationId === operationId);
    if (previous) {
      if (previous.action !== 'dispatch' || previous.actorId !== actor.id || previous.requestHash !== requestHash) failure('REVISION_CONFLICT', 409);
      return { outcome: 'replayed', revision: current.value.revision, operationId, status: previous.status !== 'completed' ? 'unknown'
        : previous.results.some(item => ['unknown', 'unavailable', 'not_attempted'].includes(item.status)) ? 'partial' : 'completed',
      results: previous.status === 'completed' ? previous.results : previous.registrationIds.map(registrationId => ({ registrationId, status: 'unknown' })) };
    }
    if (current.value.revision !== expectedRevision) failure('REVISION_CONFLICT', 409);
    try { await target().append(current, 'dispatch_started', { operationId, requestHash, registrationIds, retryRejected }, actor.id); }
    catch (error) { if (conflict(error)) failure('REVISION_CONFLICT', 409); failure(); }
    const results = []; let stop = false;
    for (const registrationId of registrationIds) {
      if (monotonicNow() >= deadline) stop = true;
      if (stop) { results.push({ registrationId, status: 'not_attempted' }); continue; }
      try {
        const email = await notify(registrationId, { actorId: actor.id, retryRejected, deadline });
        results.push({ registrationId, status: email.status });
        if (['unknown', 'not_attempted'].includes(email.status)) stop = true;
      } catch { results.push({ registrationId, status: 'unavailable' }); stop = true; }
    }
    let saved;
    try { saved = await completeBatch(operationId, results, actor.id); } catch { failure(); }
    return { outcome: 'updated', revision: saved.value.revision, operationId,
      status: stop ? 'partial' : 'completed', results };
  }
  async function notifyBatch({ registrationIds, timeoutMs = batchTimeoutMs } = {}, kind) {
    if (!Array.isArray(registrationIds) || registrationIds.length > MAX_CONFIRMATION_BATCH || registrationIds.some(id => !ID.test(id))
      || new Set(registrationIds).size !== registrationIds.length || !Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > batchTimeoutMs) failure('INVALID_REQUEST', 400);
    const deadline = monotonicNow() + timeoutMs;
    if (!(await providerState()).ready) return { status: 'not_configured', results: [] };
    const results = []; let stop = false;
    for (const registrationId of registrationIds) {
      if (monotonicNow() >= deadline) stop = true;
      if (stop) { results.push({ registrationId, status: 'not_attempted' }); continue; }
      try {
        const email = await notify(registrationId, { kind, deadline });
        const status = kind === 'registration' && ['not_public', 'withdrawn'].includes(email.status) ? 'not_applicable' : email.status;
        results.push({ registrationId, status }); if (['unknown', 'not_attempted'].includes(status)) stop = true;
      }
      catch { results.push({ registrationId, status: 'unavailable' }); stop = true; }
    }
    return { results };
  }
  /** Trusted staff projection reads durable notices only; no capability or provider access. */
  async function staffHistory({ actor, registrationId } = {}) {
    const roles = own(actor, 'roles');
    if (typeof own(actor, 'id') !== 'string' || !/^[A-Za-z0-9_-]{1,80}$/u.test(actor.id)
      || !Array.isArray(roles) || !roles.some(role => ['reviewer', 'superadmin'].includes(role))) failure('FORBIDDEN', 403);
    if (!ID.test(registrationId ?? '')) failure('INVALID_REQUEST', 400);
    const current = await target().read();
    return { revision: current.value.revision, notices: current.value.notices.filter(item => item.registrationId === registrationId)
      .map(item => ({ id: item.id, kind: item.kind, status: stateOf(item), admissionStatus: item.admissionStatus, attempt: item.attempt,
        createdAt: item.createdAt, updatedAt: item.updatedAt })) };
  }
  return Object.freeze({ prefix, forSavedReceipt, authorize, authorizedRegistration, confirmation, settings, setSettings, dispatch,
    notifyApproved: input => notifyBatch(input, 'registration'), notifyPromoted: input => notifyBatch(input, 'promotion'), staffHistory });
}
