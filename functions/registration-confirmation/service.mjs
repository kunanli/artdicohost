import { eventConfig, readEventFactsReadiness, unchangedEventFacts, PUBLIC_CONTACT_EMAIL } from '../../src/config/event.mjs';
import { performance } from 'node:perf_hooks';
import { plainObject, own, parseTimestamp } from '../registration-api/policy.mjs';
import { CloudContentError } from '../cloud-content/errors.mjs';
import { createConfirmationTokens } from './tokens.mjs';
import { createConfirmationRepository, canonicalConfirmationKind, formalConfirmationKind, confirmationNoticeId, confirmationRequestHash, validConfirmationOperation, MAX_CONFIRMATION_BATCH } from './repository.mjs';
import { canManageEventOperations } from '../../shared/staff-permissions.mjs';
import { buildPosterInvitationSettings } from '../../shared/organizer-progress.mjs';
import { confirmationEmailPresentation } from './presentation.mjs';
import { CONFIRMATION_EMAIL_CONFIGURATION_FIELDS, CONFIRMATION_EMAIL_REASONS, confirmationDiagnostic } from '../../shared/confirmation-delivery.mjs';

const SITE = 'https://artdico.host';
const ID = /^[A-Za-z0-9_-]{43}$/u;
const STATUS = ['pending_review', 'confirmed', 'waitlisted', 'rejected', 'withdrawn'];
const actorValid = actor => typeof own(actor, 'id') === 'string' && /^[A-Za-z0-9_-]{1,80}$/u.test(actor.id)
  && canManageEventOperations(actor);
const readerValid = actor => typeof own(actor, 'id') === 'string' && /^[A-Za-z0-9_-]{1,80}$/u.test(actor.id)
  && Array.isArray(own(actor, 'roles')) && actor.roles.some(role => ['reviewer', 'superadmin'].includes(role));
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
  emailProvider, currentRegistration, currentProfiles, staffDeliveryPermission, personDeliveryPermission, deliveryAliases, noticePreviewSource, eventFactsReadiness, walletReadiness = () => ({ ready: false, reason: 'WALLET_NOT_CONFIGURED' }), groupInviteProvider, emailTicketProvider,
  clock = Date.now, expiresAt, batchTimeoutMs = 20_000, monotonicNow = () => performance.now() } = {}) {
  if (currentProfiles !== undefined && typeof currentProfiles !== 'function' || currentRegistration !== undefined && typeof currentRegistration !== 'function' || typeof registrationService?.repository?.readIndex !== 'function' || typeof registrationService.repository.readRecord !== 'function'
    || typeof registrationService.getAdmissionStatus !== 'function' || typeof journalFor !== 'function' || typeof clock !== 'function'
    || emailTicketProvider !== undefined && typeof emailTicketProvider !== 'function'
    || typeof walletReadiness !== 'function' || groupInviteProvider !== undefined && typeof groupInviteProvider !== 'function'
    || staffDeliveryPermission !== undefined && typeof staffDeliveryPermission !== 'function'
    || personDeliveryPermission !== undefined && typeof personDeliveryPermission !== 'function'
    || deliveryAliases !== undefined && typeof deliveryAliases !== 'function'
    || noticePreviewSource !== undefined && typeof noticePreviewSource !== 'function'
    || eventFactsReadiness !== undefined && typeof eventFactsReadiness !== 'function'
    || !Number.isSafeInteger(batchTimeoutMs) || batchTimeoutMs < 1 || batchTimeoutMs > 30_000 || typeof monotonicNow !== 'function') throw new TypeError('Trusted confirmation dependencies required.');
  const eventFacts = facts(event), eventId = eventFacts.id;
  const expiry = expiresAt ?? Date.parse(eventFacts.date + 'T23:59:59.000+08:00') + 90 * 24 * 60 * 60 * 1000;
  const tokens = createConfirmationTokens({ tokenSecret, eventId, expiresAt: expiry, clock });
  const prefix = 'cms/v1/registration-confirmations/' + eventId;
  let repository;
  const target = () => repository ??= createConfirmationRepository({ journal: journalFor(prefix), eventId, clock });
  const currentEventFacts = () => readEventFactsReadiness(eventFactsReadiness);
  async function deliveryPermission(record) {
    if(personDeliveryPermission){try{const permission=await personDeliveryPermission(structuredClone(record));if(permission?.eligible!==true)return{eligible:false,reason:permission?.reason==='CONTACT_DECLINED'?'CONTACT_DECLINED':'PERMISSION_UNAVAILABLE'};}catch{return{eligible:false,reason:'PERMISSION_UNAVAILABLE'};}}
    if (record.provenance.kind === 'public') return { eligible: true, reason: 'ELIGIBLE' };
    if (!staffDeliveryPermission) return { eligible: false, reason: 'STAFF_PERMISSION_REQUIRED' };
    try {
      const result = await staffDeliveryPermission(structuredClone(record));
      if (result?.eligible === true) return { eligible: true, reason: 'ELIGIBLE' };
      return { eligible: false, reason: ['CONTACT_CONSENT_REQUIRED', 'CONTACT_DECLINED', 'CONTACT_EMAIL_CHANGED', 'CONTACT_NOT_FOUND', 'STAFF_PERMISSION_REQUIRED'].includes(result?.reason) ? result.reason : 'PERMISSION_UNAVAILABLE' };
    } catch { return { eligible: false, reason: 'PERMISSION_UNAVAILABLE' }; }
  }
  async function providerState() {
    try {
      const value = await emailProvider?.readiness?.();
      return { ready: value?.ready === true && typeof emailProvider?.send === 'function',
        reason: value?.ready === true ? 'CONFIGURED_PROVIDER_NOT_DELIVERY_PROOF' : CONFIRMATION_EMAIL_REASONS.includes(value?.reason) && value.reason !== 'CONFIGURED_PROVIDER_NOT_DELIVERY_PROOF' ? value.reason : 'EMAIL_NOT_READY',
        enabled: value?.enabled === true,
        missing: Array.isArray(value?.missing) ? [...new Set(value.missing.filter(key => CONFIRMATION_EMAIL_CONFIGURATION_FIELDS.includes(key)))] : [],
        ...(Array.isArray(value?.invalid) ? { invalid: [...new Set(value.invalid.filter(key => CONFIRMATION_EMAIL_CONFIGURATION_FIELDS.includes(key)))] } : {}),
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
      const original = await registrationService.repository.readRecord(entry), record = currentRegistration ? await currentRegistration(structuredClone(original), value) : original, admission = record.currentAdmission ?? await registrationService.getAdmissionStatus(registrationId);
      if (!record || record.id !== original.id || record.eventId !== original.eventId || !plainObject(record.fields) || !Number.isSafeInteger(record.accessRevision ?? 0) || (record.accessRevision ?? 0) < 0) failure();
      if (!STATUS.includes(admission?.status) || !['attendee', 'crew'].includes(admission?.kind)
        || !Number.isSafeInteger(admission?.revision) || admission.revision < 0) failure();
      return { record, admission, entry, index: value };
    } catch (error) { if (error instanceof ConfirmationError) throw error; failure(); }
  }
  async function aliasesFor(loaded) {
    const group = loaded.index.admissions?.personGroups?.find(item => item.registrationIds.includes(loaded.record.id));
    const value = deliveryAliases ? await deliveryAliases(structuredClone(loaded.record)) : {
      registrationIds: group?.registrationIds ?? [loaded.record.id], primaryRegistrationId: group?.primaryRegistrationId ?? loaded.record.id };
    if (!Array.isArray(value?.registrationIds) || !value.registrationIds.length || value.registrationIds.length > 100
      || new Set(value.registrationIds).size !== value.registrationIds.length || value.registrationIds.some(id => !ID.test(id))
      || !value.registrationIds.includes(loaded.record.id) || !value.registrationIds.includes(value.primaryRegistrationId)) failure();
    return value;
  }
  const scopeOf = loaded => ({ accessRevision: loaded.record.accessRevision ?? 0, recipientDigest: confirmationRequestHash(loaded.record.fields.email ?? '') });
  const sameScope = (notice, scope) => (notice.accessRevision ?? 0) === scope.accessRevision && (scope.accessRevision === 0 || notice.recipientDigest === scope.recipientDigest);
  function relatedNotices(state, aliases, kind, scope) {
    return state.notices.filter(item => aliases.registrationIds.includes(item.registrationId)
      && (formalConfirmationKind(kind) ? formalConfirmationKind(item.kind) && item.admissionStatus === 'confirmed' : item.kind === kind)
      && (!scope || sameScope(item, scope)));
  }
  function strongestNotice(notices) {
    return notices.find(item => ['reserved', 'unknown'].includes(item.status))
      ?? notices.find(item => item.status === 'provider_accepted')
      ?? [...notices].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
  }
  function formalDeliveryStatus(state, registrationIds, notice, scope) {
    const status = notice ? stateOf(notice) : 'not_sent';
    // A process may stop after recording the batch and before reserving a notice.
    // Reads cannot prove that an unfinished batch did not reach the provider.
    return !['unknown', 'provider_accepted'].includes(status) && state.operations.some(operation => operation.action === 'dispatch'
      && operation.status !== 'completed' && operation.registrationIds.some(id => registrationIds.includes(id) && (!scope || sameScope(operation.recipientScopes?.[id] ?? {}, scope)))) ? 'unknown' : status;
  }
  function historicalUncertainty(state, aliases, kind, scope) {
    return relatedNotices(state, aliases, kind).some(notice => !sameScope(notice, scope) && ['reserved', 'unknown'].includes(notice.status))
      || state.operations.some(op => op.action === (kind === 'pre_event_reminder' ? 'reminder_dispatch' : 'dispatch') && op.status !== 'completed'
        && op.registrationIds.some(id => aliases.registrationIds.includes(id) && !sameScope(op.recipientScopes?.[id] ?? {}, scope)));
  }
  const reminderOpen = () => clock() < Date.parse(eventFacts.date + 'T' + eventFacts.checkIn + ':00+08:00');
  const applicable = (loaded, kind) => kind === 'application_received'
    ? loaded.record.provenance.kind === 'public' && loaded.record.consent?.accepted === true && loaded.admission.status === 'pending_review'
    : loaded.admission.status === 'confirmed' && (kind !== 'pre_event_reminder' || reminderOpen());
  const countNotices = notices => {
    const counts = { total: notices.length, providerAccepted: 0, rejected: 0, unknown: 0 };
    for (const notice of notices) counts[notice.status === 'provider_accepted' ? 'providerAccepted' : notice.status === 'rejected' ? 'rejected' : 'unknown']++;
    return counts;
  };
  function trustedProjection(registrationId, loaded) {
    const { record, admission, entry } = loaded, hidden = admission.status === 'withdrawn';
    return { registrationId, referenceCode: registrationId, admissionStatus: admission.status, admissionKind: admission.kind,
      admissionRevision: admission.revision, accessRevision: record.accessRevision ?? 0, name: hidden ? '' : record.fields.name, organization: hidden ? '' : record.fields.organization ?? '',
      event: { ...eventFacts }, submittedAt: entry.committedAt, hasEmail: typeof record.fields.email === 'string' && Boolean(record.fields.email) };
  }
  async function authorizedRegistration(registrationId) { return trustedProjection(registrationId, await loadRegistration(registrationId)); }
  async function authorizedContext(input) {
    const claims = tokens.verify(own(input, 'receiptToken'));
    if (!claims) failure('CONFIRMATION_NOT_FOUND', 404);
    const loaded = await loadRegistration(claims.registrationId);
    if ((claims.accessRevision ?? 0) !== (loaded.record.accessRevision ?? 0)) failure('CONFIRMATION_NOT_FOUND', 404);
    return { registrationId: claims.registrationId, loaded };
  }
  async function authorize(input) {
    const { registrationId, loaded } = await authorizedContext(input);
    return trustedProjection(registrationId, loaded);
  }
  /** Explicit, single-person staff read. No new registration, notice, or email. */
  async function staffConfirmationLink({ actor, registrationId } = {}) {
    if (!readerValid(actor)) failure('FORBIDDEN', 403);
    if (!ID.test(registrationId ?? '')) failure('INVALID_REQUEST', 400);
    const loaded = await loadRegistration(registrationId);
    if (loaded.admission.status !== 'confirmed') return { registrationId, ready: false, reason: 'ADMISSION_NOT_CONFIRMED' };
    const link = capability(registrationId, loaded.record.accessRevision ?? 0);
    // A withdrawal during issuance must not leave a newly displayed valid link.
    const latest = await loadRegistration(registrationId);
    if ((latest.record.accessRevision ?? 0) !== (loaded.record.accessRevision ?? 0)) failure();
    if (latest.admission.status !== 'confirmed') return { registrationId, ready: false, reason: 'ADMISSION_NOT_CONFIRMED' };
    return { registrationId, ready: true, ...link };
  }
  function invitationProjection({ record, admission }) {
    if (record.provenance.kind !== 'public' || admission.status !== 'confirmed') return { ready: false };
    try { return { ready: true, settings: buildPosterInvitationSettings(record.fields.name, event) }; }
    catch { return { ready: false }; }
  }
  function capability(registrationId, accessRevision = 0) {
    const signed = tokens.issue(registrationId, accessRevision);
    return { ...signed, confirmationUrl: SITE + '/registration/confirmation/#r=' + signed.receiptToken };
  }
  async function readEmail(registrationId, hasEmail, admissionStatus, loaded, noticeSnapshot, savedAliases) {
    if (!hasEmail) return { status: 'not_applicable' };
    const current = noticeSnapshot === undefined ? await target().read() : noticeSnapshot;
    if (!current) failure();
    const aliases = savedAliases === undefined ? await aliasesFor(loaded) : savedAliases;
    if (!aliases) failure();
    const notices = current.value.notices.filter(item => aliases.registrationIds.includes(item.registrationId) && formalConfirmationKind(item.kind) && sameScope(item, scopeOf(loaded)));
    const notice = strongestNotice(notices.filter(item => item.admissionStatus === 'confirmed'))
      ?? notices.find(item => item.kind === 'promotion') ?? notices.find(item => item.kind === 'registration');
    if (notice) return noticeEmail(notice);
    if (admissionStatus !== 'confirmed') return { status: 'not_applicable' };
    if (!current.value.settings.enabled) return { status: 'disabled' };
    return { status: (await providerState()).ready ? 'pending' : 'not_configured' };
  }
  async function reserve(registrationId, admission, actorId, retryRejected, deadline, requestedKind, loaded) {
    for (let tries = 0; tries < 4; tries++) {
      if (monotonicNow() >= deadline) return { status: 'not_attempted' };
      const aliases = await aliasesFor(deliveryAliases ? loaded : { ...loaded, index: (await registrationService.repository.readIndex()).value });
      if (aliases.primaryRegistrationId !== registrationId || !applicable(loaded, requestedKind)) return { status: 'not_applicable' };
      const current = await target().read(), kind = formalConfirmationKind(requestedKind)
        ? canonicalConfirmationKind(current.value, registrationId, admission.status) : requestedKind;
      const scope = scopeOf(loaded), allRelated = relatedNotices(current.value, aliases, kind), related = allRelated.filter(item => sameScope(item, scope)), previous = strongestNotice(related);
      if (historicalUncertainty(current.value, aliases, kind, scope)) return { status: 'unknown' };
      if (allRelated.reduce((total, item) => total + item.attempt, 0) >= 5 && (!previous || retryRejected)) return { status: 'not_attempted' };
      if (!current.value.settings.enabled) return { status: 'disabled' };
      if (previous && (!retryRejected || previous.status !== 'rejected' || related.reduce((total, item) => total + item.attempt, 0) >= 5)) return { notice: previous, owned: false };
      if (monotonicNow() >= deadline) return { status: 'not_attempted' };
      const checkedFacts = await currentEventFacts();
      if (!checkedFacts.ready || monotonicNow() >= deadline) return { status: 'not_attempted' };
      try {
        const saved = await target().append(current, 'reserve', { registrationId, kind, admissionStatus: admission.status, admissionRevision: admission.revision, retryRejected, ...(scope.accessRevision > 0 ? scope : {}) }, actorId);
        return { notice: saved.value.notices.find(item => item.id === confirmationNoticeId(eventId, registrationId, kind, scope.accessRevision, scope.recipientDigest)), owned: true, checkedFacts };
      } catch (error) { if (!conflict(error)) throw error; }
    }
    failure();
  }
  async function recordResult(notice, status, actorId, diagnostic) {
    for (let tries = 0; tries < 4; tries++) {
      const current = await target().read(), item = current.value.notices.find(value => value.id === notice.id);
      if (!item || item.attempt !== notice.attempt || item.status !== 'reserved' || item.actorId !== actorId) failure();
      try { const saved = await target().append(current, 'result', { noticeId: notice.id, status, attempt: notice.attempt, ...(diagnostic ? { diagnostic } : {}) }, actorId); return noticeEmail(saved.value.notices.find(value => value.id === notice.id)); }
      catch (error) { if (!conflict(error)) throw error; }
    }
    failure();
  }
  async function notify(registrationId, { kind = 'registration', actorId = automaticActor, retryRejected = false,
    deadline = monotonicNow() + batchTimeoutMs, expectedScope, recovery } = {}) {
    if (!recovery && !(await providerState()).ready) return { status: 'not_configured' };
    if (!recovery && monotonicNow() >= deadline) return { status: 'not_attempted' };
    const loaded = recovery?.loaded ?? await loadRegistration(registrationId), { record, admission } = loaded;
    if (!recovery && expectedScope && !sameScope(scopeOf(loaded), expectedScope)) return { status: 'not_attempted' };
    if ((record.accessRevision ?? 0) > 0 && actorId === automaticActor) return { status: 'not_applicable' };
    if (!recovery && !(await deliveryPermission(record)).eligible) return { status: 'not_public' };
    if (admission.status === 'withdrawn') return { status: 'withdrawn' };
    if (!applicable(loaded, kind)) return { status: 'not_applicable' };
    if (typeof record.fields.email !== 'string' || !record.fields.email) return { status: 'not_applicable' };
    const reserved = recovery ?? await reserve(registrationId, admission, actorId, retryRejected, deadline, kind, loaded);
    if (reserved.status) return reserved;
    if (!reserved.owned) return noticeEmail(reserved.notice);
    const notice = reserved.notice, checkedFacts = reserved.checkedFacts;
    // This guard runs here and again inside the actual transport after asynchronous
    // configuration loading. It cannot make separate admission/notice journals or
    // the external provider atomic; it closes the controllable pre-fetch window.
    let guardUnattempted = false, guardCode = 'DELIVERY_GUARD_BLOCKED';
    const canStart = async ({ signal } = {}) => {
      if (signal?.aborted || monotonicNow() >= deadline) { guardUnattempted = true; guardCode = 'DELIVERY_WINDOW_EXPIRED'; return false; }
      const latest = await loadRegistration(registrationId), aliases = await aliasesFor(latest);
      if (recovery && aliases.registrationIds.slice().sort().join(',') !== recovery.relatedRegistrationIds.join(',')) return false;
      if (recovery && await configurationIdentity() !== recovery.configurationIdentity) { guardCode = 'EMAIL_CONFIGURATION_CHANGED'; return false; }
      if (recovery && latest.admission.revision !== admission.revision) return false;
      if (aliases.primaryRegistrationId !== registrationId || !applicable(latest, kind)
        || (latest.record.accessRevision ?? 0) !== (record.accessRevision ?? 0) || latest.record.fields.email !== record.fields.email || !(await deliveryPermission(latest.record)).eligible) return false;
      const delivery = await target().read(), ownNotice = delivery.value.notices.find(item => item.id === notice.id);
      if (recovery && (delivery.value.notices.some(item => item.id !== notice.id && aliases.registrationIds.includes(item.registrationId)
        && formalConfirmationKind(item.kind) && item.admissionStatus === 'confirmed' && ['reserved', 'unknown', 'provider_accepted'].includes(item.status))
        || delivery.value.operations.some(op => op.operationId !== recovery.operationId && op.action === 'dispatch'
          && op.status !== 'completed' && op.registrationIds.some(id => aliases.registrationIds.includes(id))))) return false;
      if (historicalUncertainty(delivery.value, aliases, kind, scopeOf(loaded)) || !delivery.value.settings.enabled || ownNotice?.status !== 'reserved' || ownNotice.attempt !== notice.attempt
        || relatedNotices(delivery.value, aliases, kind, scopeOf(loaded)).some(item => item.id !== notice.id && ['reserved', 'unknown', 'provider_accepted'].includes(item.status))) return false;
      const unchanged = unchangedEventFacts(checkedFacts, await currentEventFacts());
      if (!unchanged || signal?.aborted || monotonicNow() >= deadline) { guardUnattempted = true; return false; }
      return true;
    };
    let mayStart = false;
    try { mayStart = await canStart(); } catch { guardCode = 'DELIVERY_GUARD_UNAVAILABLE'; }
    if (!mayStart) {
      try { await recordResult(notice, 'rejected', actorId, { code: monotonicNow() >= deadline ? 'DELIVERY_WINDOW_EXPIRED' : guardCode, transportStarted: false }); return { status: guardUnattempted || monotonicNow() >= deadline ? 'not_attempted' : 'rejected' }; }
      catch { return { status: 'unknown' }; }
    }
    async function beforeDeadline(work, maxMs) {
      const remaining=Math.max(0,Math.floor(deadline-monotonicNow())), duration=maxMs===undefined?remaining:Math.min(maxMs,remaining);
      if(duration<1)throw new Error('Confirmation preparation deadline.');
      let timer;try{return await Promise.race([Promise.resolve().then(work),new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('Confirmation preparation deadline.')),duration);timer.unref?.();})]);}finally{clearTimeout(timer);}
    }
    let link = capability(registrationId, loaded.record.accessRevision ?? 0), ticket;
    if (emailTicketProvider && kind !== 'application_received') {
      try { ticket=await beforeDeadline(()=>emailTicketProvider({ registrationId, accessRevision:record.accessRevision ?? 0 }));
        if(!plainObject(ticket)||typeof ticket.confirmationUrl!=='string')throw new Error('Ticket unavailable.');
        link={...link,confirmationUrl:ticket.confirmationUrl};
      } catch { try{return await recordResult(notice,'rejected',actorId,{code:'DELIVERY_GUARD_UNAVAILABLE',transportStarted:false});}catch{return{status:'unknown'};} }
    }
    const locale=record.fields.locale==='en'?'en':'zh-CN';
    let subject = eventFacts.title + (kind === 'application_received' ? '｜申请已收到，待审核' : kind === 'pre_event_reminder' ? '｜行前提醒' : '｜参会名额已确认');
    let text = kind === 'application_received' ? [record.fields.name + '，你好：', '', '你的申请已收到，待主办方人工审核。',
      '目前尚未确认参会名额；这封邮件不是正式邀请。', '登记编号：' + registrationId,
      '保存私人查询链接，核对后续审核结果：', link.confirmationUrl,
      '请保管此私人链接，无需重复申请。需要协助请联系 '+PUBLIC_CONTACT_EMAIL+'。'].join('\n')
      : kind === 'pre_event_reminder' ? reminderMessage(link.confirmationUrl, record.fields.name, registrationId).text
      : confirmationMessage(link.confirmationUrl, record.fields.name, registrationId).text;
    if(locale==='en'){
      subject=eventFacts.title+(kind==='application_received'?' | Application received':kind==='pre_event_reminder'?' | Event reminder':' | Attendance confirmed');
      text=[record.fields.name+',', '',kind==='application_received'?'We have received your application. Your attendance has not yet been confirmed.':kind==='pre_event_reminder'?'We look forward to seeing you. Please check your current attendance details before travelling.':'Your attendance is confirmed.',
        'Reference: '+registrationId,'Date: '+eventFacts.date,'Time: '+eventFacts.time+' (UTC+8)','Check-in: '+eventFacts.checkIn,'Venue: '+eventFacts.venue,
        'Your private attendance page:',link.confirmationUrl,
        ...(kind==='application_received'?[]:['On iPhone, open this page in Safari to add your pass to Apple Wallet.','Show the admission QR code below to staff on arrival.']),
        'Keep this link and your QR code private. For help, contact '+PUBLIC_CONTACT_EMAIL+'.'].join('\n');
    }
    let result,presentation,walletReady=false;
    if(kind!=='application_received'){
      try{walletReady=(await beforeDeadline(()=>walletState())).ready;}
      catch{
        // A slow signer check is not evidence that Wallet is unconfigured.
        // Keep the original send window, and retain a known-unsent notice
        // rather than successfully delivering a silently incomplete email.
        try{await recordResult(notice,'rejected',actorId,{code:'DELIVERY_WINDOW_EXPIRED',transportStarted:false});return{status:'not_attempted'};}
        catch{return{status:'unknown'};}
      }
    }
    try { presentation=confirmationEmailPresentation({locale,kind,subject,confirmationUrl:link.confirmationUrl,ticket,walletReady}); }
    catch { try{return await recordResult(notice,'rejected',actorId,{code:'DELIVERY_GUARD_UNAVAILABLE',transportStarted:false});}catch{return{status:'unknown'};} }
    try {
      result = await emailProvider.send({ recipient: record.fields.email, subject, text, canStart,
        ...(recovery ? { expectedConfigurationIdentity: recovery.configurationIdentity } : {}),
        idempotencyKey: 'c_' + confirmationRequestHash({ id: notice.id, attempt: notice.attempt }),
        templateVariables: { to_name: record.fields.name, to_email: record.fields.email, event_title: eventFacts.title,
          event_date: eventFacts.date, event_time: eventFacts.time, event_venue: eventFacts.venue, reference_code: registrationId, invitation_text: text, ...presentation } });
    } catch { result = { status: 'unknown' }; }
    const status = ['provider_accepted', 'rejected'].includes(result?.status) ? result.status : 'unknown';
    try { const safeDiagnostic = confirmationDiagnostic(result?.diagnostic);
      const diagnostic = safeDiagnostic && (safeDiagnostic.code === 'DELIVERY_UNKNOWN' ? status === 'unknown' : status === 'rejected') ? safeDiagnostic : null;
      const saved = await recordResult(notice, status, actorId, diagnostic);
      return result?.reason === 'DELIVERY_WINDOW_EXPIRED' && status === 'rejected' ? { status: 'not_attempted' } : saved;
    } catch { return { status: 'unknown' }; }
  }
  async function forSavedReceipt({ receipt, notify: send = true, timeoutMs = batchTimeoutMs } = {}) {
    if (receipt?.committed !== true || receipt.eventId !== eventId || !ID.test(receipt.registrationId ?? '')
      || receipt.referenceCode !== receipt.registrationId || parseTimestamp(receipt.committedAt) === null
      || !STATUS.includes(receipt.admissionStatus) || !['attendee', 'crew'].includes(receipt.admissionKind)
      || !Number.isSafeInteger(receipt.admissionRevision) || receipt.admissionRevision < 0 || typeof send !== 'boolean'
      || !Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > batchTimeoutMs) failure();
    const result = capability(receipt.registrationId, 0), deadline = monotonicNow() + timeoutMs;
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
  /** Only the trusted new-public-commit hook supplies this authority. Replays and
   * historical reads must never backfill a missing application receipt. */
  async function notifyApplicationReceived({ receipt, outcome } = {}) {
    if (outcome !== 'created') return { status: 'not_applicable' };
    if (receipt?.committed !== true || receipt.eventId !== eventId || !ID.test(receipt.registrationId ?? '')
      || receipt.referenceCode !== receipt.registrationId || parseTimestamp(receipt.committedAt) === null
      || receipt.admissionStatus !== 'pending_review') return { status: 'not_applicable' };
    try { return await notify(receipt.registrationId, { kind: 'application_received' }); }
    catch { return { status: 'unknown' }; }
  }
  async function notificationState(loaded, noticeSnapshot, savedAliases) {
    if (!loaded.record.fields.email) return { applicationReceived: { status: 'not_applicable' }, preEventReminder: { status: 'not_applicable' } };
    try {
      const current = noticeSnapshot === undefined ? await target().read() : noticeSnapshot;
      if (!current) failure();
      const aliases = savedAliases === undefined ? await aliasesFor(loaded) : savedAliases;
      if (!aliases) failure();
      const status = kind => {
        const notice = strongestNotice(relatedNotices(current.value, aliases, kind, scopeOf(loaded)));
        return { status: notice ? stateOf(notice) : kind === 'application_received' && loaded.record.provenance.kind !== 'public'
          || !loaded.record.fields.email ? 'not_applicable' : 'not_sent' };
      };
      return { applicationReceived: status('application_received'), preEventReminder: status('pre_event_reminder') };
    } catch { return { applicationReceived: { status: 'unknown' }, preEventReminder: { status: 'unknown' } }; }
  }
  async function confirmation(input) {
    const { registrationId, loaded } = await authorizedContext(input), value = trustedProjection(registrationId, loaded);
    let currentFacts = await currentEventFacts();
    let noticeSnapshot = null, savedAliases = null;
    if (value.hasEmail) try { noticeSnapshot = await target().read(); savedAliases = await aliasesFor(loaded); } catch { /* Histories fail closed independently of admission. */ }
    let email;
    if (['pending_review', 'rejected'].includes(value.admissionStatus)) email = { status: 'not_applicable' };
    else try { email = await readEmail(value.registrationId, value.hasEmail, value.admissionStatus, loaded, noticeSnapshot, savedAliases); } catch { email = { status: 'unknown' }; }
    let groupInvite = null;
    if (value.admissionStatus === 'confirmed' && groupInviteProvider) {
      try { const offered = await groupInviteProvider({ receipt: { committed: true, eventId, registrationId: value.registrationId,
        referenceCode: value.referenceCode, committedAt: value.submittedAt, admissionStatus: value.admissionStatus,
        admissionKind: value.admissionKind, admissionRevision: value.admissionRevision, accessRevision: value.accessRevision },
        verifiedAccess: { registrationId: value.registrationId, accessRevision: value.accessRevision, admissionStatus: value.admissionStatus }, origin: SITE });
        const url = new URL(offered?.qrImageUrl), expires = parseTimestamp(offered?.expiresAt);
        if (offered?.platform === 'wechat' && url.origin === 'https://api.artdico.host' && !url.username && !url.password && !url.hash
          && url.href.length <= 4096 && expires !== null && expires > clock()) groupInvite = { platform: 'wechat', qrImageUrl: url.href, expiresAt: new Date(expires).toISOString() };
      } catch { /* Optional current QR only. */ }
    }
    const wallet = value.admissionStatus === 'confirmed'
      ? currentFacts.ready ? await walletState() : { ready: false, reason: currentFacts.reason }
      : { ready: false, reason: 'ADMISSION_NOT_CONFIRMED' };
    if (['EVENT_FACTS_MISMATCH', 'EVENT_FACTS_UNAVAILABLE'].includes(wallet.reason)) {
      currentFacts = { ready: false, reason: wallet.reason, revision: null, key: null };
    }
    // The read is authorized against its loaded snapshot. Group/Wallet minting
    // independently rechecks current access after asynchronous work.
    return { event: value.event, referenceCode: value.referenceCode, submittedAt: value.submittedAt,
      attendee: { name: value.name, organization: value.organization },
      admission: { status: value.admissionStatus, kind: value.admissionKind, revision: value.admissionRevision },
      invitation: currentFacts.ready ? invitationProjection(loaded) : { ready: false },
      ...(eventFactsReadiness === undefined ? {} : { eventFacts: { ready: currentFacts.ready, reason: currentFacts.reason, revision: currentFacts.revision } }),
      email, notifications: await notificationState(loaded, noticeSnapshot, savedAliases), wallet, groupInvite };
  }
  async function settings({ actor } = {}) {
    if (!actorValid(actor)) failure('FORBIDDEN', 403);
    const current = await target().read(), counts = countNotices(current.value.notices.filter(item => formalConfirmationKind(item.kind)));
    const facts = await currentEventFacts();
    return { revision: current.value.revision, automaticEnabled: current.value.settings.enabled, email: await providerState(), counts,
      ...(eventFactsReadiness === undefined ? {} : { eventFacts: { ready: facts.ready, reason: facts.reason, revision: facts.revision } }),
      dispatch: { maxBatch: MAX_CONFIRMATION_BATCH, retryRejected: true, unknownNeverResent: true }, wallet: await walletState(true),
      notificationCounts: { applicationReceived: countNotices(current.value.notices.filter(item => item.kind === 'application_received')),
        preEventReminder: countNotices(current.value.notices.filter(item => item.kind === 'pre_event_reminder')) } };
  }
  async function setSettings({ actor, expectedRevision, operationId, enabled } = {}) {
    if (!actorValid(actor)) failure('FORBIDDEN', 403);
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0 || !validConfirmationOperation(operationId) || typeof enabled !== 'boolean') failure('INVALID_REQUEST', 400);
    const requestHash = confirmationRequestHash({ actorId: actor.id, enabled }), current = await target().read();
    const previous = current.value.operations.find(op => op.operationId === operationId);
    if (previous) {
      if (previous.action !== 'settings' || previous.actorId !== actor.id || previous.requestHash !== requestHash) failure('REVISION_CONFLICT', 409);
      return { outcome: 'replayed', operationId, enabled, ...await settings({ actor }) };
    }
    if (current.value.revision !== expectedRevision) failure('REVISION_CONFLICT', 409);
    try { await target().append(current, 'settings', { operationId, requestHash, enabled }, actor.id); }
    catch (error) { if (conflict(error)) failure('REVISION_CONFLICT', 409); failure(); }
    return { outcome: 'updated', operationId, enabled, ...await settings({ actor }) };
  }
  async function completeBatch(operationId, results, actorId, action = 'dispatch') {
    for (let tries = 0; tries < 4; tries++) {
      const current = await target().read();
      try { return await target().append(current, action + '_completed', { operationId, results }, actorId); }
      catch (error) { if (!conflict(error)) throw error; }
    }
    failure();
  }
  async function configurationIdentity() {
    try { const identity = await emailProvider?.configurationIdentity?.(); return typeof identity === 'string' && /^[a-f0-9]{64}$/u.test(identity) ? identity : null; }
    catch { return null; }
  }
  function recoveryEligible(state, aliases, scope, notice) {
    const family = state.notices.filter(item => aliases.registrationIds.includes(item.registrationId) && formalConfirmationKind(item.kind) && item.admissionStatus === 'confirmed');
    return notice?.status === 'rejected' && sameScope(notice, scope)
      && aliases.primaryRegistrationId === notice.registrationId && notice.admissionStatus === 'confirmed'
      && family.reduce((total, item) => total + item.attempt, 0) >= 5
      && !family.some(item => ['reserved', 'unknown', 'provider_accepted'].includes(item.status))
      && !state.operations.some(op => op.action === 'dispatch' && op.status !== 'completed' && op.registrationIds.some(id => aliases.registrationIds.includes(id)));
  }
  async function dispatchRecovery({ actor, operationId, registrationId, expectedAccessRevisions, requestHash, current, deadline }) {
    const loaded = await loadRegistration(registrationId), scope = scopeOf(loaded), aliases = await aliasesFor(loaded);
    if (scope.accessRevision !== expectedAccessRevisions[registrationId]) failure('REVISION_CONFLICT', 409);
    const kind = canonicalConfirmationKind(current.value, registrationId, loaded.admission.status);
    const notice = current.value.notices.find(item => item.id === confirmationNoticeId(eventId, registrationId, kind, scope.accessRevision, scope.recipientDigest));
    if (!applicable(loaded, kind) || !loaded.record.fields.email || aliases.primaryRegistrationId !== registrationId
      || !current.value.settings.enabled || !recoveryEligible(current.value, aliases, scope, notice)
      || !(await deliveryPermission(loaded.record)).eligible || !(await providerState()).ready) failure('REVISION_CONFLICT', 409);
    const checkedFacts = await currentEventFacts(), identity = await configurationIdentity();
    if (!checkedFacts.ready || !identity || monotonicNow() >= deadline) failure('REVISION_CONFLICT', 409);
    const relatedRegistrationIds = aliases.registrationIds.slice().sort();
    const latest = await loadRegistration(registrationId), latestAliases = await aliasesFor(latest);
    if (latest.record.fields.email !== loaded.record.fields.email || !sameScope(scopeOf(latest), scope)
      || latest.admission.status !== loaded.admission.status || latest.admission.revision !== loaded.admission.revision
      || latestAliases.primaryRegistrationId !== registrationId || latestAliases.registrationIds.slice().sort().join(',') !== relatedRegistrationIds.join(',')
      || !(await deliveryPermission(latest.record)).eligible || !unchangedEventFacts(checkedFacts, await currentEventFacts()) || monotonicNow() >= deadline) failure('REVISION_CONFLICT', 409);
    let reserved;
    try { const saved = await target().append(current, 'recovery_reserved', { operationId, requestHash, registrationId, kind,
      admissionStatus: loaded.admission.status, admissionRevision: loaded.admission.revision, retryRejected: true,
      ...scope, relatedRegistrationIds, configurationIdentity: identity }, actor.id);
      reserved = saved.value.notices.find(item => item.id === notice.id);
    } catch (error) { if (conflict(error)) failure('REVISION_CONFLICT', 409); failure(); }
    let email;
    try { email = await notify(registrationId, { kind, actorId: actor.id, retryRejected: true, deadline, expectedScope: scope,
      recovery: { notice: reserved, owned: true, operationId, checkedFacts, loaded, relatedRegistrationIds, configurationIdentity: identity } }); }
    catch { email = { status: 'unknown' }; }
    const results = [{ registrationId, status: email.status }];
    let saved; try { saved = await completeBatch(operationId, results, actor.id); } catch { failure(); }
    return { outcome: 'updated', revision: saved.value.revision, operationId,
      status: ['unknown', 'unavailable', 'not_attempted'].includes(email.status) ? 'partial' : 'completed', results };
  }
  async function dispatch({ actor, expectedRevision, operationId, registrationIds, retryRejected = false, expectedAccessRevisions, recoverRejected } = {}, kind = 'registration') {
    if (!actorValid(actor)) failure('FORBIDDEN', 403);
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0 || !validConfirmationOperation(operationId)
      || !Array.isArray(registrationIds) || !registrationIds.length || registrationIds.length > MAX_CONFIRMATION_BATCH
      || new Set(registrationIds).size !== registrationIds.length || registrationIds.some(id => !ID.test(id)) || typeof retryRejected !== 'boolean') failure('INVALID_REQUEST', 400);
    if (recoverRejected !== undefined && (typeof recoverRejected !== 'boolean' || kind !== 'registration' || registrationIds.length !== 1 || recoverRejected && (!retryRejected || expectedAccessRevisions === undefined))) failure('INVALID_REQUEST', 400);
    if (expectedAccessRevisions !== undefined && (!plainObject(expectedAccessRevisions) || Object.keys(expectedAccessRevisions).sort().join(',') !== [...registrationIds].sort().join(',') || registrationIds.some(id => !Number.isSafeInteger(expectedAccessRevisions[id]) || expectedAccessRevisions[id] < 0))) failure('INVALID_REQUEST', 400);
    const deadline = monotonicNow() + batchTimeoutMs;
    const action = kind === 'pre_event_reminder' ? 'reminder_dispatch' : 'dispatch';
    const requestHash = confirmationRequestHash({ actorId: actor.id, registrationIds, retryRejected,
      ...(action === 'reminder_dispatch' ? { kind } : {}), ...(recoverRejected === undefined ? {} : { recoverRejected }), ...(expectedAccessRevisions === undefined ? {} : { expectedAccessRevisions }) }), current = await target().read();
    const previous = current.value.operations.find(op => op.operationId === operationId);
    if (previous) {
      if (previous.action !== action || previous.actorId !== actor.id || previous.requestHash !== requestHash) failure('REVISION_CONFLICT', 409);
      return operationView(previous, current.value.revision);
    }
    if (current.value.revision !== expectedRevision) failure('REVISION_CONFLICT', 409);
    if (recoverRejected === true) return dispatchRecovery({ actor, operationId, registrationId: registrationIds[0], expectedAccessRevisions, requestHash, current, deadline });
    const recipientScopes = {};
    for (const id of registrationIds) { recipientScopes[id] = scopeOf(await loadRegistration(id));
      if (expectedAccessRevisions === undefined && recipientScopes[id].accessRevision > 0 || expectedAccessRevisions !== undefined && recipientScopes[id].accessRevision !== expectedAccessRevisions[id]) failure('REVISION_CONFLICT', 409); }
    try { await target().append(current, action + '_started', { operationId, requestHash, registrationIds, retryRejected, recipientScopes }, actor.id); }
    catch (error) { if (conflict(error)) failure('REVISION_CONFLICT', 409); failure(); }
    const results = []; let stop = false;
    for (const registrationId of registrationIds) {
      if (monotonicNow() >= deadline) stop = true;
      if (stop) { results.push({ registrationId, status: 'not_attempted' }); continue; }
      try {
        const email = await notify(registrationId, { kind, actorId: actor.id, retryRejected, deadline, expectedScope: recipientScopes[registrationId] });
        results.push({ registrationId, status: email.status });
        if (['unknown', 'not_attempted'].includes(email.status)) stop = true;
      } catch { results.push({ registrationId, status: 'unavailable' }); stop = true; }
    }
    let saved;
    try { saved = await completeBatch(operationId, results, actor.id, action); } catch { failure(); }
    return { outcome: 'updated', revision: saved.value.revision, operationId,
      status: stop ? 'partial' : 'completed', results, ...(action === 'reminder_dispatch' ? { kind } : {}) };
  }
  function operationView(operation, revision) {
    return { outcome: 'replayed', revision, operationId: operation.operationId,
      ...(operation.action === 'reminder_dispatch' ? { kind: 'pre_event_reminder' } : {}),
      status: operation.status !== 'completed' ? 'unknown'
        : operation.results.some(item => ['unknown', 'unavailable', 'not_attempted'].includes(item.status)) ? 'partial' : 'completed',
      results: operation.status === 'completed' ? operation.results : operation.registrationIds.map(registrationId => ({ registrationId, status: 'unknown' })) };
  }
  async function reminderOperation({ actor, operationId } = {}) {
    if (!actorValid(actor)) failure('FORBIDDEN', 403);
    if (!validConfirmationOperation(operationId)) failure('INVALID_REQUEST', 400);
    const current = await target().read(), operation = current.value.operations.find(item => item.operationId === operationId);
    if (!operation || operation.action !== 'reminder_dispatch' || operation.actorId !== actor.id) failure('CONFIRMATION_NOT_FOUND', 404);
    return operationView(operation, current.value.revision);
  }
  async function confirmationOperation({ actor, operationId } = {}) {
    if (!actorValid(actor)) failure('FORBIDDEN', 403);
    if (!validConfirmationOperation(operationId)) failure('INVALID_REQUEST', 400);
    const current = await target().read(), operation = current.value.operations.find(item => item.operationId === operationId);
    if (!operation || operation.action !== 'dispatch' || operation.actorId !== actor.id) failure('CONFIRMATION_NOT_FOUND', 404);
    return { ...operationView(operation, current.value.revision), kind: 'registration', checkedAt: new Date(clock()).toISOString() };
  }
  function confirmationMessage(url = '[私人参会页链接]', name = '[称呼]', reference = '[登记编号]') {
    return { subject: eventFacts.title + '｜参会名额已确认', privateUrlPlaceholder: '[私人参会页链接]',
      text: [name + '，你好：', '', '你的参会名额已确认。',
        '登记编号：' + reference, '日期：' + eventFacts.date, '活动时间：' + eventFacts.time + '（UTC+8）',
        '签到：' + eventFacts.checkIn, '地点：' + eventFacts.venue,
        '查看私人确认页、加入 Apple Wallet 或打印参会凭证：', url,
        'iPhone 用户请在 Safari 打开上述链接，点击「加入 Apple Wallet」。',
        '请保管此私人链接，不要转发；确认页始终以当前名额状态为准。',
        '住宿、讲者、展位与其他职责分别确认。需要更正或取消，请通过原联系渠道联系筹备团队。'].join('\n') };
  }
  function reminderMessage(url = '[私人参会页链接]', name = '[称呼]', reference = '[登记编号]') {
    return { subject: eventFacts.title + '｜行前提醒', privateUrlPlaceholder: '[私人参会页链接]',
      text: [name + '，你好：', '', '期待在活动现场与你见面。请在出发前打开私人参会页，核对最新名额及活动安排。',
        '登记编号：' + reference, '日期：' + eventFacts.date, '活动时间：' + eventFacts.time + '（UTC+8）',
        '签到：' + eventFacts.checkIn, '地点：' + eventFacts.venue,
        '交通指引请查看活动首页：https://artdico.host/#venue',
        '私人参会页（当前微信群及保存方式）：', url,
        '请私下保存链接，不要转发；以页面当前名额为准。需要协助请联系 '+PUBLIC_CONTACT_EMAIL+'。'].join('\n') };
  }
  async function staffNoticePreview({ actor, registrationIds, cursor } = {}, kind) {
    if (!actorValid(actor)) failure('FORBIDDEN', 403);
    if (registrationIds !== undefined && (!Array.isArray(registrationIds) || !registrationIds.length || registrationIds.length > MAX_CONFIRMATION_BATCH
      || registrationIds.some(id => !ID.test(id)) || new Set(registrationIds).size !== registrationIds.length)
      || cursor !== undefined && (typeof cursor !== 'string' || !/^[A-Za-z0-9_-]{1,512}$/u.test(cursor))) failure('INVALID_REQUEST', 400);
    let position = null;
    if (cursor) {
      try { position = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')); } catch { failure('INVALID_REQUEST', 400); }
      if (!plainObject(position) || Object.keys(position).sort().join(',') !== (kind === 'registration' ? 'kind,noticeRevision,offset,source' : 'noticeRevision,offset,source')
        || kind === 'registration' && position.kind !== kind
        || !/^[a-f0-9]{64}$/u.test(position.source ?? '') || !Number.isSafeInteger(position.noticeRevision) || position.noticeRevision < 0
        || !Number.isSafeInteger(position.offset) || position.offset < 0 || position.offset > 1000) failure('INVALID_REQUEST', 400);
    }
    if (!noticePreviewSource) failure();
    const source = await noticePreviewSource({ actor, ...(registrationIds ? { registrationIds: [...registrationIds] } : {}), offset: position?.offset ?? 0, limit: MAX_CONFIRMATION_BATCH });
    if (!/^[a-f0-9]{64}$/u.test(source?.revision ?? '') || !Number.isSafeInteger(source.total) || source.total < 0 || source.total > 1000
      || !Array.isArray(source.rows) || source.rows.length > MAX_CONFIRMATION_BATCH
      || new Set(source.rows.map(row => row.registrationId)).size !== source.rows.length) failure();
    const sourceRevision = kind === 'registration' ? confirmationRequestHash({ kind, baseSourceRevision: source.revision,
      scope: registrationIds === undefined ? 'all' : [...registrationIds].sort() }) : source.revision;
    const current = await target().read();
    if (position && (position.source !== sourceRevision || position.noticeRevision !== current.value.revision)) failure('REVISION_CONFLICT', 409);
    const [provider, checkedFacts] = await Promise.all([providerState(), currentEventFacts()]);
    let index;
    if (source.rows.some(row => row.relatedRegistrationIds === undefined)) index = (await registrationService.repository.readIndex()).value;
    const rows = source.rows.map(row => {
      if (!ID.test(row.registrationId ?? '') || typeof row.name !== 'string' || !row.name || row.name.length > 400
        || typeof row.organization !== 'string' || row.organization.length > 500 || typeof row.eligible !== 'boolean'
        || typeof row.reason !== 'string' || !/^[A-Z_]{1,80}$/u.test(row.reason)) failure();
      const group = index?.admissions?.personGroups?.find(item => item.registrationIds.includes(row.registrationId));
      const ids = row.relatedRegistrationIds ?? group?.registrationIds ?? [row.registrationId];
      if (!Array.isArray(ids) || !ids.length || ids.length > 100 || ids.some(id => !ID.test(id))
        || !ids.includes(row.registrationId) || new Set(ids).size !== ids.length) failure();
      const scope = { accessRevision: row.accessRevision ?? 0, recipientDigest: row.recipientDigest ?? '' };
      if (!Number.isSafeInteger(scope.accessRevision) || scope.accessRevision < 0 || scope.accessRevision > 0 && !/^[a-f0-9]{64}$/u.test(scope.recipientDigest)) failure();
      const allNotices = relatedNotices(current.value, { registrationIds: ids }, kind), notices = allNotices.filter(item => sameScope(item, scope)), notice = strongestNotice(notices);
      const status = kind === 'registration' ? formalDeliveryStatus(current.value, ids, notice, scope) : notice ? stateOf(notice) : 'not_sent';
      const reason = historicalUncertainty(current.value, { registrationIds: ids }, kind, scope) ? 'HISTORICAL_DELIVERY_UNKNOWN' : status === 'unknown' ? 'DELIVERY_UNKNOWN' : status === 'provider_accepted' ? 'ALREADY_ACCEPTED'
        : allNotices.reduce((total, item) => total + item.attempt, 0) >= 5 ? 'RETRY_LIMIT'
          : !row.eligible ? row.reason : !current.value.settings.enabled ? 'EMAIL_PAUSED' : !provider.ready ? 'EMAIL_NOT_READY'
            : !checkedFacts.ready ? checkedFacts.reason : kind === 'pre_event_reminder' && !reminderOpen() ? 'REMINDER_WINDOW_CLOSED' : 'ELIGIBLE';
      return { registrationId: row.registrationId, name: row.name, organization: row.organization, status,
        accessRevision: scope.accessRevision, eligible: reason === 'ELIGIBLE', reason, retryRejected: status === 'rejected' };
    });
    const next = (position?.offset ?? 0) + source.rows.length;
    if (next > source.total || next < source.total && !source.rows.length) failure();
    return { revision: current.value.revision, kind, ...(kind === 'registration' ? { sourceRevision } : {}), rows, total: source.total,
      nextCursor: next < source.total ? Buffer.from(JSON.stringify({ ...(kind === 'registration' ? { kind } : {}), source: sourceRevision,
        noticeRevision: current.value.revision, offset: next })).toString('base64url') : null,
      message: kind === 'registration' ? confirmationMessage() : reminderMessage() };
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
  /** Durable notice facts and conservative batch uncertainty; no invented notice. */
  async function staffHistory({ actor, registrationId, relatedRegistrationIds = [] } = {}) {
    if (!readerValid(actor)) failure('FORBIDDEN', 403);
    if (!ID.test(registrationId ?? '')) failure('INVALID_REQUEST', 400);
    if (!Array.isArray(relatedRegistrationIds) || relatedRegistrationIds.length > 100 || relatedRegistrationIds.some(id => !ID.test(id))) failure('INVALID_REQUEST', 400);
    const registrationIds = new Set([registrationId, ...relatedRegistrationIds]);
    const current = await target().read(), notices = current.value.notices.filter(item => registrationIds.has(item.registrationId) && formalConfirmationKind(item.kind));
    const scope = currentRegistration ? scopeOf(await loadRegistration(registrationId)) : null;
    const unresolved = !notices.some(item => stateOf(item) === 'unknown')
      && formalDeliveryStatus(current.value, [...registrationIds], strongestNotice(notices.filter(item => item.admissionStatus === 'confirmed'))) === 'unknown';
    return { revision: current.value.revision, ...(unresolved ? { unresolvedConfirmations: true } : {}),
      notices: notices
      .map(item => ({ id: item.id, kind: item.kind, status: stateOf(item), admissionStatus: item.admissionStatus, attempt: item.attempt,
        createdAt: item.createdAt, updatedAt: item.updatedAt, ...(scope ? { currentRecipient: sameScope(item, scope) } : {}) })) };
  }
  async function staffDirectory({ actor } = {}) {
    if (!readerValid(actor)) failure('FORBIDDEN', 403);
    const current = await target().read();
    const index = (await registrationService.repository.readIndex()).value;
    const candidateIds = new Set([...current.value.notices.filter(item => formalConfirmationKind(item.kind)).map(item => item.registrationId),
      ...current.value.operations.filter(op => op.action === 'dispatch' && op.status !== 'completed').flatMap(op => op.registrationIds)]);
    const canonical = new Set();
    for (const id of candidateIds) {
      if (!index.entries.some(entry => entry.id === id)) continue;
      canonical.add(index.admissions?.personGroups?.find(group => group.registrationIds.includes(id))?.primaryRegistrationId ?? id);
    }
    const notices = [], ids = [...canonical], profiles = currentProfiles ? await currentProfiles() : null; let position = 0;
    if (profiles !== null && !plainObject(profiles)) failure();
    await Promise.all(Array.from({ length: Math.min(8, ids.length) }, async () => {
      while (position < ids.length) {
        const registrationId = ids[position++];
        let aliases, scope;
        if (profiles !== null) {
          const group = index.admissions?.personGroups?.find(item => item.registrationIds.includes(registrationId));
          aliases = { registrationIds: group?.registrationIds ?? [registrationId], primaryRegistrationId: registrationId };
          const accessRevision = aliases.registrationIds.reduce((total, id) => total + (profiles[id]?.accessRevision ?? 0), 0);
          if (!Number.isSafeInteger(accessRevision) || accessRevision < 0) failure();
          let email = profiles[registrationId]?.fields?.email;
          if (accessRevision > 0 && email === undefined) { const entry = index.entries.find(item => item.id === registrationId); email = (await registrationService.repository.readRecord(entry)).fields.email ?? ''; }
          scope = { accessRevision, recipientDigest: accessRevision > 0 ? confirmationRequestHash(email) : '' };
        } else { const loaded = await loadRegistration(registrationId); aliases = await aliasesFor(loaded); scope = scopeOf(loaded); }
        const notice = strongestNotice(relatedNotices(current.value, aliases, 'registration', scope));
        const status = formalDeliveryStatus(current.value, aliases.registrationIds, notice, scope);
        if (['provider_accepted', 'unknown', 'rejected'].includes(status)) notices.push({ registrationId, status });
      }
    }));
    return { revision: current.value.revision, notices: notices.sort((a, b) => a.registrationId.localeCompare(b.registrationId)) };
  }
  /** Reads current eligibility and durable delivery state; never reserves or sends. */
  async function staffDeliveryState({ actor, registrationId } = {}) {
    if (!readerValid(actor)) failure('FORBIDDEN', 403);
    if (!ID.test(registrationId ?? '')) failure('INVALID_REQUEST', 400);
    const loaded = await loadRegistration(registrationId), { record, admission } = loaded;
    const current = await target().read(), canSend = actorValid(actor);
    const aliases = await aliasesFor(loaded), scope = scopeOf(loaded), allRelated = relatedNotices(current.value, aliases, 'registration'), related = allRelated.filter(item => sameScope(item, scope));
    const notice = strongestNotice(related);
    const status = formalDeliveryStatus(current.value, aliases.registrationIds, notice, scope);
    let reason = admission.status !== 'confirmed' ? 'ADMISSION_NOT_CONFIRMED'
      : !record.fields.email ? 'EMAIL_MISSING' : status === 'provider_accepted' ? 'ALREADY_ACCEPTED'
        : historicalUncertainty(current.value, aliases, 'registration', scope) ? 'HISTORICAL_DELIVERY_UNKNOWN' : status === 'unknown' ? 'DELIVERY_UNKNOWN' : !canSend ? 'OPERATOR_PERMISSION_REQUIRED'
          : allRelated.reduce((total, item) => total + item.attempt, 0) >= 5 ? 'RETRY_LIMIT' : null;
    let canRecover = false;
    const selectedNotice = related.find(item => item.registrationId === registrationId
      && item.kind === canonicalConfirmationKind(current.value, registrationId, admission.status));
    // Recovery is a separate explicit manager command; ordinary readiness stays false at the cap.
    if (reason === null || reason === 'RETRY_LIMIT' && recoveryEligible(current.value, aliases, scope, selectedNotice)) {
      const permission = await deliveryPermission(record), provider = permission.eligible && current.value.settings.enabled ? await providerState() : null;
      let readinessReason = !permission.eligible ? permission.reason : !current.value.settings.enabled ? 'EMAIL_PAUSED'
        : !provider.ready ? provider.reason : 'ELIGIBLE';
      if (readinessReason === 'ELIGIBLE') {
        const facts = await currentEventFacts();
        if (!facts.ready) readinessReason = facts.reason;
      }
      if (reason === 'RETRY_LIMIT') canRecover = readinessReason === 'ELIGIBLE' && await configurationIdentity() !== null;
      else reason = readinessReason;
    }
    return { registrationId, revision: current.value.revision, accessRevision: scope.accessRevision, admissionStatus: admission.status, status, reason,
      ready: reason === 'ELIGIBLE' && canSend, canSend, retryRejected: status === 'rejected',
      ...(canRecover ? { canRecover: true } : {}), ...(confirmationDiagnostic(notice?.diagnostic) ? { diagnostic: confirmationDiagnostic(notice.diagnostic) } : {}),
      recipient: admission.status === 'withdrawn' ? '' : record.fields.email ?? '' };
  }
  return Object.freeze({ prefix, forSavedReceipt, notifyApplicationReceived, authorize, authorizedRegistration, confirmation, staffConfirmationLink, settings, setSettings, dispatch,
    staffConfirmationPreview: input => staffNoticePreview(input, 'registration'), confirmationOperation,
    staffReminderPreview: input => staffNoticePreview(input, 'pre_event_reminder'), dispatchReminder: input => dispatch(input, 'pre_event_reminder'), reminderOperation,
    notifyApproved: input => notifyBatch(input, 'registration'), notifyPromoted: input => notifyBatch(input, 'promotion'), staffHistory, staffDirectory, staffDeliveryState });
}
