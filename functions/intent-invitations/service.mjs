import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { validateStoredContact, validateContactOperations, validateInvitationSettings, preserveContactOperationDefaults, hasNewContactAllocations } from '../../shared/contacts-schema.mjs';
import { eventConfig } from '../../src/config/event.mjs';
import { failure, IntentInvitationError, plainData, identifier, revision, iso } from './errors.mjs';
import { createInvitationBatchOperations } from './batch.mjs';
import { buildPosterInvitationSettings, INVITATION_POSTER_RENDER_VERSION, INVITATION_POSTER_FACTS } from '../../shared/organizer-progress.mjs';

const hash = value => createHash('sha256').update(value).digest('hex');
const CATEGORY = { prospective_site: 'new_site', developer: 'industry', university: 'education' };
const INTEREST = { site_experience: 'roundtable', technical_share: 'workshop', industry_networking: 'attend',
  product_demo: 'exhibition', site_resources: 'site_support', sponsorship_partnership: 'partnership', attend_only: 'attend' };
function httpUrl(value) {
  if (typeof value !== 'string' || /\s/u.test(value)) return false;
  try { const url = new URL(value); return ['http:', 'https:'].includes(url.protocol) && !!url.hostname && !url.username && !url.password; }
  catch { return false; }
}
function optionalProjectionWarnings(profile) {
  const warnings = [];
  if (profile.website && !httpUrl(profile.website)) warnings.push('website');
  if (profile.caseLinks) {
    const lines = profile.caseLinks.split(/\r?\n/u).map(line => line.trim()).filter(Boolean);
    if (lines.length > 5 || lines.some(line => !httpUrl(line))) warnings.push('caseLinks');
  }
  return warnings;
}
const fields = profile => ({ name: profile.name, city: profile.city, organization: profile.organization, position: profile.position,
  email: profile.email, wechat: profile.wechat, background: profile.background,
  ...(!optionalProjectionWarnings(profile).includes('website') ? { website: profile.website } : {}),
  ...(!optionalProjectionWarnings(profile).includes('caseLinks') ? { caseLinks: profile.caseLinks } : {}),
  categories: [...new Set(profile.categories.map(category => CATEGORY[category] ?? category))],
  participationInterests: [...new Set(profile.interests.map(interest => INTEREST[interest] ?? interest))],
  // Historical answers remain historical. No attendance or lodging approval is inferred.
  ...(profile.attendanceIntent !== 'unknown' ? { attendance: profile.attendanceIntent === 'expected' ? 'expected' : 'uncertain' } : {}),
  ...(profile.accommodationIntent !== 'unknown' ? { accommodationChoice: ({ needed: 'needed', not_needed: 'not_needed', uncertain: 'uncertain' })[profile.accommodationIntent] } : {}),
  ...(profile.futureCooperation !== 'unknown' ? { cooperationInterest: profile.futureCooperation === 'interested' ? 'interested' : 'none' } : {}), topics: profile.topics,
});
// The same pure mapping is available to protected import-readiness tooling; it
// never writes records, grants applicant consent or creates a session.
export { fields as staffRegistrationFieldsFromContactProfile };
function actorValue(actor, registration = false) {
  if (!plainData(actor) || !identifier(actor.id) || !Array.isArray(actor.roles) || actor.roles.some(role => typeof role !== 'string')
    || !actor.roles.some(role => ['outreach', 'superadmin'].includes(role))
    || registration && !actor.roles.some(role => ['reviewer', 'superadmin'].includes(role))) throw failure('FORBIDDEN', 403);
  return { id: actor.id, roles: [...actor.roles] };
}
function reference(value) {
  if (typeof value !== 'string' || !value.trim() || value.length > 1000 || /[\u0000-\u001f\u007f]/u.test(value)) throw failure('INVALID_INPUT', 400);
  return value.trim();
}
function contactValue(roster, id, allowDeclined = false) {
  if (!identifier(id) || !plainData(roster) || !revision(roster.revision) || !Array.isArray(roster.contacts)) throw failure();
  const contact = roster.contacts.find(item => item.id === id);
  if (!contact) throw failure('CONTACT_NOT_FOUND', 404);
  if (!validateStoredContact(contact)) throw failure();
  if (!allowDeclined && declined(contact)) throw failure('CONTACT_DECLINED', 422);
  return structuredClone(contact);
}
const declined = contact => contact.profile.contactConsent === 'declined' || contact.operations.responseStatus === 'declined';
function selectedContacts(roster, contactIds) {
  if (!Array.isArray(contactIds) || !contactIds.length || contactIds.length > 100 || contactIds.some(id => !identifier(id)) || new Set(contactIds).size !== contactIds.length) throw failure('INVALID_INPUT', 400);
  return contactIds.map(id => contactValue(roster, id, true));
}

/** Confirmed event facts, without granting a speaker, booth, lodging or GGJ credential. */
export function buildRegistrationInvitation(contact, registration, event = eventConfig, { renderVersion } = {}) {
  if (!plainData(event) || event.status !== 'confirmed' || event.date?.status !== 'confirmed' || event.venue?.confirmed !== true
    || typeof event.title !== 'string' || !event.title.trim() || event.title.length > 300 || /[\u0000-\u001f\u007f]/u.test(event.title)
    || !identifier(event.id) || !identifier(registration?.registrationId) || !identifier(registration.referenceCode)) throw failure('INVALID_INPUT', 400);
  if (renderVersion !== undefined && renderVersion !== INVITATION_POSTER_RENDER_VERSION) throw failure('INVALID_INPUT', 400);
  let poster;
  if (renderVersion !== undefined) {
    try { poster = buildPosterInvitationSettings(contact.profile.displayName || contact.profile.name, event); }
    catch { throw failure('INVALID_INPUT', 400); }
  }
  const checked = validateInvitationSettings(poster ?? { recipientName: contact.profile.displayName || contact.profile.name,
    date: event.date.value, time: event.time?.start + '–' + event.time?.end,
    venue: event.venue.address || event.venue.name, confirmed: true });
  if (!checked.valid) throw failure('INVALID_INPUT', 400);
  const settings = checked.value, title = poster ? INVITATION_POSTER_FACTS.title : event.title;
  return {
    kind: 'registered_attendee_invitation', eventId: event.id, title,
    registrationId: registration.registrationId, referenceCode: registration.referenceCode, settings,
    subject: title + '｜活动邀请函',
    text: [settings.recipientName + '，你好：', '', '筹备团队已为你登记本次活动报名，邀请你参加' + title + '。',
      '报名编号：' + registration.referenceCode, '日期：' + settings.date, '时间：' + settings.time, '地点：' + settings.venue,
      ...(poster ? [/^(?:[01]\d|2[0-3]):[0-5]\d$/u.test(event.time?.start ?? '') ? '签到：' + event.time.start + '；活动时间以本邀请所列时段为准。' : '活动时间以本邀请所列时段为准。']
        : ['09:30 签到，10:00 正式活动开始；楼层、入口和交通资讯另行公布。']),
      '演讲、圆桌、展位、住宿及 GGJ 官方站点资格分别沟通；本邀请不自动授予上述安排。',
      '如不能参加或需要更正、撤回资料，请通过原联系渠道告知筹备团队。'].join('\n'),
  };
}
function invitationId(eventId, registrationId, channel, digest, renderVersion) {
  // A new manual design/content has its own durable preparation identity. The
  // legacy manual and all email identities retain their original bytes.
  return 'i_' + hash(eventId + '\0' + registrationId + '\0' + channel
    + (channel === 'manual' && renderVersion === INVITATION_POSTER_RENDER_VERSION ? '\0' + digest : '')).slice(0, 32);
}

/** Selected, audited staff conversion. Source data and public-applicant consent are never fabricated. */
export function createIntentInvitationService({ registrationService, contactsStore, contentStore, repository,
  emailProvider, isRegistrationActive, getAdmissionStatus = registrationService?.getAdmissionStatus?.bind(registrationService), event = eventConfig, now = () => Date.now() } = {}) {
  if (!registrationService || typeof registrationService.submitStaffRegistration !== 'function'
    || !contactsStore || typeof contactsStore.read !== 'function' || typeof contactsStore.saveOperations !== 'function'
    || typeof contentStore?.read !== 'function' || !repository || typeof repository.read !== 'function' || typeof repository.commit !== 'function'
    || typeof isRegistrationActive !== 'function' || typeof now !== 'function') throw new TypeError('Explicit registration, contacts, planning, review and invitation repositories required.');
  function timestamp() { try { const result = new Date(now()).toISOString(); if (iso(result)) return result; } catch { /* Fixed error only. */ } throw failure(); }
  async function readState() {
    try { return await repository.read(); }
    catch (error) { if (error instanceof IntentInvitationError) throw error; throw failure(); }
  }
  async function requireActive(registrationId, actor) {
    let active;
    try { active = await isRegistrationActive({ registrationId, actor }); } catch { throw failure(); }
    if (active !== true) throw failure('REGISTRATION_INACTIVE', 409);
  }
  async function requireConfirmed(registrationId) {
    let admission;
    try { admission = await getAdmissionStatus?.(registrationId); } catch { throw failure(); }
    if (!plainData(admission) || !['confirmed', 'waitlisted', 'withdrawn', 'pending_review', 'rejected'].includes(admission.status)
      || !revision(admission.revision)) throw failure();
    if (admission.status !== 'confirmed') throw failure(admission.status === 'waitlisted' ? 'REGISTRATION_WAITLISTED' : 'REGISTRATION_INACTIVE', 409);
    return { status: admission.status, revision: admission.revision };
  }
  function requireSource(contact, registration) {
    if (registration.sourceDigest !== contact.source.digest || registration.sourceKey !== contact.source.key
      || registration.sourceRowId !== contact.source.rowId) throw failure('REGISTRATION_CHANGED', 409);
  }
  async function rosterAt(expected) {
    if (!revision(expected)) throw failure('INVALID_INPUT', 400);
    let roster; try { roster = await contactsStore.read(); } catch { throw failure(); }
    if (!plainData(roster) || !revision(roster.revision) || !Array.isArray(roster.contacts)) throw failure();
    if (roster.revision !== expected) throw failure('REVISION_CONFLICT', 409);
    return roster;
  }
  async function record(state, action, actorId, sourceContactId, invitationId = null, detail = {}) {
    const at = timestamp();
    if (state.value.audit.length && at < state.value.audit.at(-1).at) throw failure();
    state.value.revision++;
    state.value.audit.push({ revision: state.value.revision, action, actorId, sourceContactId, invitationId, at, ...detail });
    try { return await repository.commit(state.cursor, state.value); }
    catch (error) { if (error instanceof IntentInvitationError) throw error; throw failure(); }
  }
  const conversionFor = (state, id) => state.value.conversions.find(item => item.sourceContactId === id);
  async function effectiveConversion(state,id,actor) {
    const original=conversionFor(state,id);
    if(!original||typeof registrationService.getPersonGroups!=='function')return original;
    const snapshot=await registrationService.getPersonGroups({actor});if(!Array.isArray(snapshot?.groups))throw failure();
    const group=snapshot.groups.find(row=>row.contactIds.includes(id));
    return group?.primaryRegistrationId?{...original,registrationId:group.primaryRegistrationId,referenceCode:group.primaryRegistrationId}:original;
  }
  function invitationProjection(item) {
    const safe = structuredClone(item);
    // An interrupted reservation never implies delivery and must not be replayed.
    if (safe.status === 'issuing') safe.status = 'unknown';
    return safe;
  }
  async function inspectBatch({ contactIds, expectedContactRevision, actor, renderVersion }) {
    const roster = await rosterAt(expectedContactRevision), selected = selectedContacts(roster, contactIds), state = await readState();
    const entries = [], bindings = [];
    for (const contact of selected) {
      const registration = conversionFor(state, contact.id);
      let reason = null, contentDigest = null, admission = null;
      if (declined(contact)) reason = 'CONTACT_DECLINED';
      else if (contact.profile.contactConsent !== 'consented') reason = 'CONTACT_NOT_CONSENTED';
      else if (!registration) reason = 'REGISTRATION_REQUIRED';
      else {
        try {
          requireSource(contact, registration);
          await requireActive(registration.registrationId, actor);
          admission = await requireConfirmed(registration.registrationId);
          const content = buildRegistrationInvitation(contact, registration, event, { renderVersion });
          contentDigest = hash(JSON.stringify(content));
          const id = invitationId(event.id, registration.registrationId, 'manual', contentDigest, renderVersion);
          const previous = state.value.invitations.find(item => item.id === id);
          const dispatched = state.value.invitations.filter(item => item.sourceContactId === contact.id
            && ['issuing', 'unknown', 'provider_accepted', 'manually_sent'].includes(item.status));
          const dispatch = dispatched.find(item => ['issuing', 'unknown'].includes(item.status)) ?? dispatched[0];
          if (dispatch) reason = ['issuing', 'unknown'].includes(dispatch.status) ? 'INVITATION_STATUS_UNKNOWN' : 'INVITATION_DISPATCH_RECORDED';
          else if (previous && (previous.digest !== contentDigest || !isDeepStrictEqual(previous.content, content))) reason = 'INVITATION_CHANGED';
        } catch (error) {
          if (!(error instanceof IntentInvitationError) || error.code === 'STORAGE_UNAVAILABLE') throw failure();
          reason = error.code;
        }
      }
      entries.push({ contactId: contact.id, eligible: reason === null, reason,
        ...(registration ? { registrationId: registration.registrationId, referenceCode: registration.referenceCode } : {}) });
      bindings.push({ contactId: contact.id, sourceDigest: contact.source.digest, sourceKey: contact.source.key,
        sourceRowId: contact.source.rowId, registrationId: registration?.registrationId ?? null,
        referenceCode: registration?.referenceCode ?? null, contentDigest, admission, reason });
    }
    return { contactRevision: roster.revision, entries, bindings };
  }
  let service;
  const batch = createInvitationBatchOperations({ inspect: inspectBatch, authorize: actorValue,
    issueManual: input => service.issueInvitation(input) });
  service = Object.freeze({
    previewInvitations: batch.preview,
    prepareInvitations: batch.prepare,
    async read({ actor } = {}) {
      actorValue(actor);
      const state = await readState(),identity=typeof registrationService.getPersonGroups==='function'?await registrationService.getPersonGroups({actor}):null;
      if(identity&&!Array.isArray(identity.groups))throw failure();
      return { ...(identity?.groups.length?{personGroups:identity.groups,admissionRevision:identity.revision}:{}), revision: state.value.revision, conversions: structuredClone(state.value.conversions),
        invitations: state.value.invitations.map(invitationProjection), email: emailProvider?.readiness?.() ?? { ready: false, reason: 'EMAIL_NOT_READY' } };
    },
    async previewConversions({ contactIds, expectedContactRevision, actor } = {}) {
      actorValue(actor, true);
      const roster = await rosterAt(expectedContactRevision);
      const entries = selectedContacts(roster, contactIds).map(contact => ({ contactId: contact.id, eligible: !declined(contact),
        reason: declined(contact) ? 'CONTACT_DECLINED' : null, warnings: declined(contact) ? [] : optionalProjectionWarnings(contact.profile) }));
      return { contactRevision: roster.revision, entries, summary: { selected: entries.length, eligible: entries.filter(entry => entry.eligible).length,
        skipped: entries.filter(entry => !entry.eligible).length, optionalFieldsOmitted: entries.reduce((count, entry) => count + entry.warnings.length, 0) } };
    },
    async convertContacts({ contactIds, expectedContactRevision, actor, permissionReference } = {}) {
      const staff = actorValue(actor, true), permission = reference(permissionReference);
      const roster = await rosterAt(expectedContactRevision);
      // Validate the entire selection before the first registration write.
      const selection = selectedContacts(roster, contactIds), selected = selection.filter(contact => !declined(contact));
      const skipped = selection.filter(declined).map(contact => ({ contactId: contact.id, reason: 'CONTACT_DECLINED' }));
      const registrations = [], failures = [], warnings = [];
      for (const contact of selected) {
        try {
          const state = await readState(), existing = await effectiveConversion(state, contact.id, staff);
          if (existing) {
            registrations.push({ contactId: contact.id, registrationId: existing.registrationId, referenceCode: existing.referenceCode, outcome: 'replayed' });
            if (existing.projectionWarnings?.length) warnings.push({ contactId: contact.id, fields: existing.projectionWarnings });
            continue;
          }
          // Recheck the selected roster before each independent registration. This is
          // an explicit partial batch, not a transaction across two private journals.
          await rosterAt(expectedContactRevision);
          let outcome;
          if (typeof registrationService.getStaffRegistrationBySource === 'function') {
            const found = await registrationService.getStaffRegistrationBySource({ sourceContactId: contact.id, actor: staff });
            if (found?.outcome === 'found') outcome = { outcome: 'replayed', receipt: found.receipt };
            else if (found?.outcome !== 'not_found') { failures.push({ contactId: contact.id, code: 'REGISTRATION_UNAVAILABLE' }); break; }
          }
          outcome ??= await registrationService.submitStaffRegistration({ sourceContactId: contact.id, actor: staff,
            input: { fields: fields(contact.profile), permissionReference: permission } });
          if (!['created', 'replayed'].includes(outcome?.outcome) || outcome.receipt?.committed !== true
            || outcome.receipt.eventId !== event.id || !iso(outcome.receipt.committedAt)
            || !identifier(outcome.receipt.registrationId) || !identifier(outcome.receipt.referenceCode)) {
            const fieldErrors = Array.isArray(outcome?.fieldErrors) ? outcome.fieldErrors.filter(field => typeof field === 'string' && /^fields\.[A-Za-z][A-Za-z0-9.]{0,99}$/u.test(field)).slice(0, 40) : [];
            failures.push({ contactId: contact.id, code: ({ invalid: 'REGISTRATION_INVALID', conflict: 'REGISTRATION_CONFLICT', closed: 'REGISTRATION_CLOSED', forbidden: 'FORBIDDEN' })[outcome?.outcome] ?? 'REGISTRATION_UNAVAILABLE', ...(fieldErrors.length ? { fields: fieldErrors } : {}) });
            continue;
          }
          const projectionWarnings = optionalProjectionWarnings(contact.profile);
          const item = { sourceContactId: contact.id, registrationId: outcome.receipt.registrationId, referenceCode: outcome.receipt.referenceCode,
            sourceDigest: contact.source.digest, sourceKey: contact.source.key, sourceRowId: contact.source.rowId,
            permissionReference: permission, recordedAt: timestamp(), actorId: staff.id, projectionWarnings };
          state.value.conversions.push(item);
          await record(state, 'convert_contact', staff.id, contact.id, null, { projectionWarnings });
          registrations.push({ contactId: contact.id, registrationId: item.registrationId, referenceCode: item.referenceCode, outcome: outcome.outcome });
          if (projectionWarnings.length) warnings.push({ contactId: contact.id, fields: projectionWarnings });
        } catch (error) {
          failures.push({ contactId: contact.id, code: error instanceof IntentInvitationError ? error.code : 'STORAGE_UNAVAILABLE' });
          // Unknown registration or ledger outcomes are resolved by explicit read or
          // idempotent staff submission later; do not continue a blind batch mutation.
          if (failures.at(-1).code === 'STORAGE_UNAVAILABLE' || failures.at(-1).code === 'REVISION_CONFLICT') break;
        }
      }
      return { status: failures.length ? registrations.length ? 'partial' : 'unavailable' : 'completed',
        contactRevision: roster.revision, registrations, failures, skipped, warnings };
    },
    async assignContact({ contactId, expectedContactRevision, sessionIds, boothIds, sessionRoles, actor } = {}) {
      const staff = actorValue(actor), roster = await rosterAt(expectedContactRevision), contact = contactValue(roster, contactId, true);
      const state = await readState();
      const registration = await effectiveConversion(state, contactId, staff);
      if (!registration) throw failure('REGISTRATION_REQUIRED', 409);
      let planning; try { planning = (await contentStore.read()).draft.content; } catch { throw failure(); }
      const operations = preserveContactOperationDefaults({ ...contact.operations, sessionIds, boothIds, ...(sessionRoles === undefined ? {} : { sessionRoles }) }, contact.operations);
      if (sessionRoles === undefined) operations.sessionRoles = (contact.operations.sessionRoles ?? []).filter(entry => Array.isArray(sessionIds) && sessionIds.includes(entry.sessionId));
      const checked = validateContactOperations(operations, planning);
      if (!checked.valid) throw failure('INVALID_ASSIGNMENT', 422);
      const adding = hasNewContactAllocations(checked.value, contact.operations);
      if (adding) {
        if (declined(contact)) throw failure('CONTACT_DECLINED', 422);
        requireSource(contact, registration);
        await requireActive(registration.registrationId, staff);
        await requireConfirmed(registration.registrationId);
      }
      // Removing or retaining historical references allocates no new place;
      // staff must be able to clean these up after withdrawal or declined contact.
      try { return await contactsStore.saveOperations(contactId, expectedContactRevision, checked.value, staff.id); }
      catch (error) {
        if (error?.status === 409) throw failure('REVISION_CONFLICT', 409);
        if (error?.status === 422) throw failure('INVALID_ASSIGNMENT', 422);
        throw failure();
      }
    },
    async issueInvitation({ contactId, expectedContactRevision, channel = 'manual', expectedRegistrationId, actor, confirmEmail = false, batchId, renderVersion } = {}) {
      const staff = actorValue(actor), roster = await rosterAt(expectedContactRevision), contact = contactValue(roster, contactId);
      if (!['manual', 'email'].includes(channel) || typeof confirmEmail !== 'boolean' || !identifier(expectedRegistrationId)
        || renderVersion !== undefined && (channel !== 'manual' || renderVersion !== INVITATION_POSTER_RENDER_VERSION)
        || batchId !== undefined && (channel !== 'manual' || typeof batchId !== 'string' || !/^b_[a-f0-9]{64}$/u.test(batchId))) throw failure('INVALID_INPUT', 400);
      if (contact.profile.contactConsent !== 'consented') throw failure('CONTACT_NOT_CONSENTED', 422);
      const state = await readState(), registration = conversionFor(state, contactId);
      if (!registration) throw failure('REGISTRATION_REQUIRED', 409);
      if (registration.registrationId !== expectedRegistrationId) throw failure('REGISTRATION_CHANGED', 409);
      requireSource(contact, registration);
      await requireActive(registration.registrationId, staff);
      await requireConfirmed(registration.registrationId);
      const content = buildRegistrationInvitation(contact, registration, event, { renderVersion }), digest = hash(JSON.stringify(content));
      const id = invitationId(event.id, registration.registrationId, channel, digest, renderVersion);
      const previous = state.value.invitations.find(item => item.id === id);
      if (batchId && state.value.invitations.some(item => item.sourceContactId === contactId
        && ['issuing', 'unknown', 'provider_accepted', 'manually_sent'].includes(item.status))) throw failure('INVITATION_CHANGED', 409);
      if (previous) {
        if (previous.digest !== digest || !isDeepStrictEqual(previous.content, content)) throw failure('INVITATION_CHANGED', 409);
        return { invitation: invitationProjection(previous), contactRevision: roster.revision, replayed: true };
      }
      if (channel === 'email' && (confirmEmail !== true || emailProvider?.readiness?.().ready !== true || typeof emailProvider.send !== 'function')) throw failure('EMAIL_NOT_READY', 503);
      // The roster, review and admission live in separate journals. Recheck as
      // close to each manual reservation as possible; this is not a cross-journal transaction.
      if (channel === 'manual') {
        const latest = contactValue(await rosterAt(expectedContactRevision), contactId);
        if (latest.profile.contactConsent !== 'consented') throw failure('CONTACT_NOT_CONSENTED', 422);
        requireSource(latest, registration);
        if (!isDeepStrictEqual(buildRegistrationInvitation(latest, registration, event, { renderVersion }), content)) throw failure('REVISION_CONFLICT', 409);
        await requireActive(registration.registrationId, staff);
        await requireConfirmed(registration.registrationId);
      }
      const at = timestamp(), invitation = { id, sourceContactId: contactId, registrationId: registration.registrationId,
        referenceCode: registration.referenceCode, digest, channel, status: channel === 'manual' ? 'prepared' : 'issuing',
        content, createdAt: at, updatedAt: at, actorId: staff.id, sentChannel: null };
      state.value.invitations.push(invitation);
      const reserved = await record(state, channel === 'manual' ? 'prepare_invitation' : 'reserve_email', staff.id, contactId, id, batchId ? { batchId } : {});
      if (channel === 'manual') return { invitation: invitationProjection(invitation), contactRevision: roster.revision, replayed: false };
      // Reservation must be acknowledged before the only provider request. Any
      // interrupted result leaves 'issuing', exposed as unknown, never resent.
      let result;
      try {
        const latest = contactValue(await rosterAt(expectedContactRevision), contactId);
        if (latest.profile.contactConsent !== 'consented' || latest.profile.email !== contact.profile.email
          || !isDeepStrictEqual(buildRegistrationInvitation(latest, registration, event, { renderVersion }), content)) throw failure('REVISION_CONFLICT', 409);
        await requireActive(registration.registrationId, staff);
        await requireConfirmed(registration.registrationId);
      } catch {
        const rejected = reserved.value.invitations.find(item => item.id === id);
        rejected.status = 'rejected'; rejected.updatedAt = timestamp();
        try { await record(reserved, 'email_result', staff.id, contactId, id); } catch { rejected.status = 'unknown'; }
        return { invitation: invitationProjection(rejected), contactRevision: roster.revision, replayed: false };
      }
      try {
        result = await emailProvider.send({ recipient: contact.profile.email, subject: content.subject, text: content.text,
          templateVariables: { to_name: content.settings.recipientName, to_email: contact.profile.email,
            event_title: content.title, event_date: content.settings.date, event_time: content.settings.time,
            event_venue: content.settings.venue, reference_code: content.referenceCode, invitation_text: content.text }, idempotencyKey: id });
      } catch { result = { status: 'unknown' }; }
      const current = reserved.value.invitations.find(item => item.id === id);
      current.status = ['provider_accepted', 'rejected'].includes(result?.status) ? result.status : 'unknown'; current.updatedAt = timestamp();
      try { await record(reserved, 'email_result', staff.id, contactId, id); }
      catch { return { invitation: invitationProjection({ ...current, status: 'unknown' }), contactRevision: roster.revision, replayed: false }; }
      return { invitation: invitationProjection(current), contactRevision: roster.revision, replayed: false };
    },
    async markManualSent({ invitationId, channel, actor } = {}) {
      const staff = actorValue(actor);
      if (!identifier(invitationId) || !['wechat', 'email', 'other'].includes(channel)) throw failure('INVALID_INPUT', 400);
      const state = await readState(), invitation = state.value.invitations.find(item => item.id === invitationId);
      if (!invitation || invitation.channel !== 'manual') throw failure('INVALID_INPUT', 400);
      await requireActive(invitation.registrationId, staff);
      await requireConfirmed(invitation.registrationId);
      let roster; try { roster = await contactsStore.read(); } catch { throw failure(); }
      const contact = contactValue(roster, invitation.sourceContactId);
      if (contact.profile.contactConsent !== 'consented') throw failure('CONTACT_NOT_CONSENTED', 422);
      if (invitation.status === 'manually_sent') {
        if (invitation.sentChannel !== channel) throw failure('INVITATION_CHANGED', 409);
        return { invitation: invitationProjection(invitation), contactRevision: roster.revision, replayed: true };
      }
      if (invitation.status !== 'prepared') throw failure('INVITATION_CHANGED', 409);
      invitation.status = 'manually_sent'; invitation.sentChannel = channel; invitation.updatedAt = timestamp();
      await record(state, 'manual_sent', staff.id, contact.id, invitation.id);
      return { invitation: invitationProjection(invitation), contactRevision: roster.revision, replayed: false };
    },
  });
  return service;
}
