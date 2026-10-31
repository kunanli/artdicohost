import { isDeepStrictEqual } from 'node:util';
import { validateStoredContact, validateContactOperations, preserveContactOperationDefaults } from '../../shared/contacts-schema.mjs';
import { guestPrefillFromContact } from '../../shared/contact-editor.mjs';
import { eventConfig } from '../../src/config/event.mjs';

const ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/u, ACTOR = /^[A-Za-z0-9_-]{1,80}$/u, REGISTRATION = /^[A-Za-z0-9_-]{43}$/u;
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const revision = value => Number.isSafeInteger(value) && value >= 0;
const permissionReference = '用户授权：工作人员保存已核实确认参加回复后，以原联系人 ID 登记本次活动报名并核对共同名额；保留原始来源，不代替本人完成网站隐私同意，不发送消息。';
export const ATTENDANCE_SYNC_REASONS = Object.freeze(['NOT_CONFIGURED', 'REVIEWER_REQUIRED', 'INVALID_RECEIPT', 'SOURCE_CHANGED', 'CONTACT_DECLINED',
  'REGISTRATION_UNAVAILABLE', 'REGISTRATION_INVALID', 'REGISTRATION_CONFLICT', 'REGISTRATION_CLOSED', 'REGISTRATION_INACTIVE', 'LINKAGE_UNAVAILABLE', 'REVISION_CONFLICT', 'STORAGE_UNAVAILABLE', 'FORBIDDEN']);
const unavailable = reason => ({ status: 'unavailable', reason });
function fullActor(actor) { return plain(actor) && typeof actor.id === 'string' && ACTOR.test(actor.id) && Array.isArray(actor.roles)
  && (actor.roles.includes('superadmin') || actor.roles.includes('outreach') && actor.roles.includes('reviewer')); }

/** A store's durable receipt remains distinct from a following admission action. */
export function contactOperationsAcknowledged({ saved, contactId, expectedRevision, operations } = {}) {
  const valid = plain(saved) && revision(expectedRevision) && saved.revision === expectedRevision + 1 && revision(saved.revision)
    && typeof contactId === 'string' && ID.test(contactId) && saved.contact?.id === contactId && validateStoredContact(saved.contact)
    && plain(operations) && saved.contact.operations.responseStatus === operations.responseStatus;
  if (!valid) return false;
  const normalized = validateContactOperations(preserveContactOperationDefaults(operations, saved.contact.operations));
  return normalized.valid && isDeepStrictEqual(normalized.value, saved.contact.operations);
}
export function attendanceAdmissionProjection(value) {
  if (!plain(value)) return unavailable('REGISTRATION_UNAVAILABLE');
  if (['confirmed', 'waitlisted', 'pending_review'].includes(value.status) && typeof value.registrationId === 'string' && REGISTRATION.test(value.registrationId)
    && typeof value.referenceCode === 'string' && REGISTRATION.test(value.referenceCode) && revision(value.revision))
    return { status: value.status, registrationId: value.registrationId, referenceCode: value.referenceCode, revision: value.revision,
      ...(['completed', 'pending', 'not_configured', 'not_applicable'].includes(value.confirmationEmail?.status)
        ? { confirmationEmail: { status: value.confirmationEmail.status } } : {}) };
  if (['requiresReviewer', 'unavailable'].includes(value.status) && ATTENDANCE_SYNC_REASONS.includes(value.reason)) return { status: value.status, reason: value.reason };
  return unavailable('REGISTRATION_UNAVAILABLE');
}

/** The callback is never called for a missing/bad ACK, or for a non-attending reply.
 * Old callback-free test/local adapters retain their original malformed result;
 * they cannot acquire a fabricated replySaved receipt.
 */
export async function contactOperationsResponse({ saved, contactId, expectedRevision, operations, actor, onCommitted, errorFactory } = {}) {
  if (!contactOperationsAcknowledged({ saved, contactId, expectedRevision, operations })) {
    if (onCommitted) throw errorFactory('CONTACT_STORAGE_ERROR', '联系人保存回执无法核对，请重新载入确认；尚未同步名额。', 503);
    return saved;
  }
  const response = { revision: saved.revision, contact: structuredClone(saved.contact), replySaved: true };
  if (saved.contact.operations.responseStatus !== 'attending') return response;
  response.admission = unavailable('NOT_CONFIGURED');
  if (onCommitted) {
    try { response.admission = attendanceAdmissionProjection(await onCommitted({ actor: structuredClone(actor), contactId, saved: structuredClone(saved) })); }
    catch { response.admission = unavailable('REGISTRATION_UNAVAILABLE'); }
  }
  return response;
}

/** Reuse the existing source-keyed registration and conversion journals. No mail,
 * intake widening, source mutation, or retry after an unknown write occurs here.
 */
export function createAttendanceSynchronizer({ intentService, registrationService, contactsStore } = {}) {
  for (const [dependency, methods] of [[intentService, ['convertContacts']], [registrationService, ['getStaffRegistrationBySource', 'getAdmissionStatus']], [contactsStore, ['read']]])
    if (dependency !== undefined && dependency !== null && methods.some(name => typeof dependency[name] !== 'function')) throw new TypeError('Attendance synchronization dependencies unavailable.');
  const configured = Boolean(intentService && registrationService && contactsStore);
  return async ({ actor, contactId, saved } = {}) => {
    // Saving an outreach reply must remain possible without reviewer permission.
    if (!fullActor(actor)) return { status: 'requiresReviewer', reason: 'REVIEWER_REQUIRED' };
    if (!configured) return unavailable('NOT_CONFIGURED');
    if (!contactOperationsAcknowledged({ saved, contactId, expectedRevision: saved?.revision - 1, operations: saved?.contact?.operations })
      || saved.contact.operations.responseStatus !== 'attending') return unavailable('INVALID_RECEIPT');
    if (saved.contact.profile.contactConsent === 'declined') return unavailable('CONTACT_DECLINED');
    try {
      const converted = await intentService.convertContacts({ actor: structuredClone(actor), contactIds: [contactId], expectedContactRevision: saved.revision, permissionReference });
      if (converted?.status !== 'completed' || converted.contactRevision !== saved.revision || !Array.isArray(converted.registrations) || converted.registrations.length !== 1
        || !Array.isArray(converted.failures) || converted.failures.length || !Array.isArray(converted.skipped) || converted.skipped.length) {
        const reason = converted?.failures?.[0]?.code;
        return unavailable(ATTENDANCE_SYNC_REASONS.includes(reason) ? reason : 'REGISTRATION_UNAVAILABLE');
      }
      const linked = converted.registrations[0];
      if (linked.contactId !== contactId || !['created', 'replayed'].includes(linked.outcome) || typeof linked.registrationId !== 'string' || !REGISTRATION.test(linked.registrationId)
        || typeof linked.referenceCode !== 'string' || !REGISTRATION.test(linked.referenceCode)) return unavailable('LINKAGE_UNAVAILABLE');
      // A conversion replay alone is not proof that the immutable registration
      // belongs to this source or remains active in the admission index.
      const source = await registrationService.getStaffRegistrationBySource({ actor: structuredClone(actor), sourceContactId: contactId });
      if (source?.outcome === 'withdrawn') return unavailable('REGISTRATION_INACTIVE');
      if (source?.outcome !== 'found' || source.receipt?.committed !== true || source.receipt.eventId !== eventConfig.id
        || source.receipt.registrationId !== linked.registrationId || source.receipt.referenceCode !== linked.referenceCode) return unavailable('LINKAGE_UNAVAILABLE');
      const roster = await contactsStore.read(), current = Array.isArray(roster?.contacts) ? roster.contacts.find(contact => contact.id === contactId) : null;
      if (!revision(roster?.revision) || roster.revision !== saved.revision || !validateStoredContact(current)
        || current.operations.responseStatus !== 'attending' || current.profile.contactConsent === 'declined'
        || !isDeepStrictEqual(current.source, saved.contact.source)) return unavailable('SOURCE_CHANGED');
      const admission = await registrationService.getAdmissionStatus(linked.registrationId);
      if (admission?.status === 'withdrawn') return unavailable('REGISTRATION_INACTIVE');
      if (!['confirmed', 'waitlisted', 'pending_review'].includes(admission?.status) || !revision(admission.revision)) return unavailable('REGISTRATION_UNAVAILABLE');
      return { status: admission.status, registrationId: linked.registrationId, referenceCode: linked.referenceCode, revision: admission.revision };
    } catch (error) {
      return unavailable(ATTENDANCE_SYNC_REASONS.includes(error?.code) ? error.code : 'REGISTRATION_UNAVAILABLE');
    }
  };
}

/** Runs within the store's already-loaded draft CAS, after omission preservation.
 * Unchanged links do not require contact access; a new link never copies consent.
 */
export function createGuestContactLinkGuard({ actor, contactsStore, errorFactory } = {}) {
  if (typeof errorFactory !== 'function') throw new TypeError('Guest relationship error factory required.');
  const reject = (code, message, status = 422) => { throw errorFactory(code, message, status); };
  return async context => {
    const { current, next, published } = context ?? {};
    if (!Array.isArray(current?.guests) || !Array.isArray(next?.guests)) reject('CONTACTS_UNAVAILABLE', '嘉宾关联资料暂时无法核对。', 503);
    const old = new Map(current.guests.map(guest => [guest.id, guest])), updated = new Map(next.guests.map(guest => [guest.id, guest]));
    const changed = next.guests.filter(guest => (guest.contactId || '') !== (old.get(guest.id)?.contactId || ''));
    const removed = current.guests.filter(guest => guest.contactId && !updated.has(guest.id));
    if (!changed.length && !removed.length) return;
    if (!Array.isArray(actor?.roles) || !actor.roles.includes('editor') || !actor.roles.includes('outreach')) reject('FORBIDDEN', '维护私人嘉宾关联须同时具备活动编辑与邀约权限。', 403);
    if (!Object.hasOwn(context, 'published') || published !== null && (!plain(published) || !revision(published.revision) || !plain(published.content)
      || !Array.isArray(published.content.guests) || published.content.guests.length > 200
      || published.content.guests.some(guest => !plain(guest) || typeof guest.id !== 'string' || !ID.test(guest.id)))) reject('CONTACTS_UNAVAILABLE', '嘉宾公开版本暂时无法核对，请重新读取后再调整人员关联。', 503);
    const publicIds = new Set(published?.content.guests.map(guest => guest.id) ?? []);
    if ([...changed, ...removed].some(guest => publicIds.has(guest.id))) reject('CONTACT_LINK_PUBLISHED', '这份嘉宾资料仍有公开版本；请先停止公开并保存发布，再更换关联人员。');
    if (changed.some(guest => guest.publicConsent !== false)) reject('CONTACT_LINK_CONSENT_REQUIRED', '人员关联已改变，请先取消公开授权并保存，再重新核实授权。');
    const contactIds = new Set(changed.map(guest => guest.contactId).filter(Boolean));
    if (!contactIds.size) return;
    if (typeof contactsStore?.read !== 'function') reject('CONTACTS_UNAVAILABLE', '私密联系人模块尚未配置，不能新增嘉宾关联。', 503);
    let roster;
    try { roster = await contactsStore.read(); } catch { reject('CONTACTS_UNAVAILABLE', '联系人资料暂时无法核对，请稍后再保存关联。', 503); }
    if (!revision(roster?.revision) || !Array.isArray(roster.contacts) || roster.contacts.length > 5000) reject('CONTACTS_UNAVAILABLE', '联系人资料暂时无法核对，请稍后再保存关联。', 503);
    for (const id of contactIds) {
      const matches = roster.contacts.filter(contact => contact?.id === id);
      if (!matches.length) reject('CONTACT_NOT_FOUND', '所选联系人不存在，请重新读取后选择。', 404);
      if (matches.length !== 1 || !validateStoredContact(matches[0])) reject('CONTACTS_UNAVAILABLE', '所选联系人资料暂时无法核对。', 503);
      const checked = guestPrefillFromContact(matches[0]);
      if (checked.errors?.contactConsent) reject('CONTACT_NOT_CONSENTED', '对象未明确同意联络，不能新增嘉宾关联。');
      if (checked.errors?.responseStatus) reject('CONTACT_DECLINED', '对象已婉拒参加，不能新增嘉宾关联。');
      if (!checked.valid || checked.value.contactId !== id) reject('VALIDATION_ERROR', '请先核对所选联系人的嘉宾称呼、机构与资料。');
    }
  };
}
