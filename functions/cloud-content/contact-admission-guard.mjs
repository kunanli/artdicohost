import { CloudContentError } from './errors.mjs';

const fail = (code, message, status) => { throw new CloudContentError(code, message, status); };
const unavailable = () => fail('ADMISSION_STATUS_UNAVAILABLE', '报名名额状态暂时无法核对，请稍后重新检查。', 503);

/** Legacy contact planning remains private; a converted applicant cannot bypass
 * confirmed admission through the old operations or invitation-record routes.
 */
export function createContactAdmissionGuard({ contactsStore, lookupRegistration, getAdmissionStatus } = {}) {
  if (typeof contactsStore?.read !== 'function' || typeof lookupRegistration !== 'function' || typeof getAdmissionStatus !== 'function') throw new TypeError('联系人名额核对依赖未配置。');
  return async ({ contactId, actor, action, input }) => {
    let roster;
    try { roster = await contactsStore.read(); } catch { unavailable(); }
    if (!Number.isSafeInteger(input?.expectedRevision) || input.expectedRevision < 0) fail('INVALID_REVISION', '请提供有效的预期修订号。', 400);
    if (input.expectedRevision !== roster.revision) fail('REVISION_CONFLICT', '联系人资料已更新，请重新载入后再决定。', 409);
    const contact = roster.contacts.find(value => value.id === contactId);
    if (!contact) fail('CONTACT_NOT_FOUND', '此联系人不存在，请重新载入。', 404);
    if (action === 'operations') {
      const adding = ['sessionIds', 'boothIds', 'participationForms'].some(field => Array.isArray(input.operations?.[field])
        && input.operations[field].some(value => !(contact.operations[field] ?? []).includes(value)));
      if (!adding) return; // Notes and removing historical assignments remain possible.
      if (contact.profile.contactConsent === 'declined' || contact.operations.responseStatus === 'declined' || input.operations.responseStatus === 'declined') fail('CONTACT_DECLINED', '对象已拒绝联络或婉拒参加，不能新增安排。', 422);
    } else if (action !== 'invitation') unavailable();
    else if (contact.profile.contactConsent === 'declined' || contact.operations.responseStatus === 'declined') fail('CONTACT_DECLINED', '对象已拒绝联络或婉拒参加，不能记录正式邀请。', 422);
    let registrationId;
    try { registrationId = await lookupRegistration({ contactId, actor }); } catch { unavailable(); }
    if (registrationId === null) return; // Unconverted contacts are private preplanning only.
    if (typeof registrationId !== 'string' || !/^[A-Za-z0-9_-]{43}$/u.test(registrationId)) unavailable();
    let admission;
    try { admission = await getAdmissionStatus(registrationId); } catch { unavailable(); }
    if (!['confirmed', 'waitlisted', 'withdrawn'].includes(admission?.status)) unavailable();
    if (admission?.status !== 'confirmed') fail('ADMISSION_NOT_CONFIRMED', '此报名尚未确认名额，不能新增安排或记录正式邀请。', 422);
  };
}
