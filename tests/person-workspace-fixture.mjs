import { createPersonWorkspaceApi } from '../functions/person-workspace/handler.mjs';

export const ORIGIN = 'https://api.artdico.host';
export const CONTACT = 'synthetic-person';
export const REGISTRATION = 'a'.repeat(43), OTHER_REGISTRATION = 'b'.repeat(43);
export const AT = '2026-10-21T00:00:00.000Z';
export const actor = roles => ({ id: 'synthetic-staff', roles });
export function fixture({ roles = ['superadmin'], linked = true } = {}) {
  const data = {
    contacts: { revision: 3, contacts: [{ id: CONTACT,
      profile: { name: '合成甲', displayName: '合成甲', organization: '合成机构', position: '研发', city: '深圳', email: 'contact@example.invalid',
        wechat: 'synthetic-contact', phone: '', contactConsent: 'consented', categories: ['developer'], interests: ['talk'],
        background: 'PRIVATE-QUESTIONNAIRE-BACKGROUND', needs: 'PRIVATE-QUESTIONNAIRE-NEEDS' },
      operations: { owner: '合成工作人员', priority: 'high', followUpAt: '2026-11-01', responseStatus: 'pending', notes: '已核对本人拟任讲者。',
        participationForms: ['speaker', 'attendee'], sessionIds: ['synthetic-session', 'removed-session'], boothIds: ['synthetic-booth'],
        sessionRoles: [{ sessionId: 'synthetic-session', roles: ['speaker'] }] },
      source: { raw: 'PRIVATE-ORIGINAL-SPREADSHEET' }, invitation: { generatedAt: AT, sentAt: null, channel: null }, audit: ['PRIVATE-CONTACT-AUDIT'] }] },
    intent: { revision: 7, conversions: linked ? [{ sourceContactId: CONTACT, registrationId: REGISTRATION, permissionReference: 'PRIVATE-PERMISSION-REFERENCE' }] : [],
      invitations: linked ? [{ id: 'synthetic-invite', sourceContactId: CONTACT, registrationId: REGISTRATION, channel: 'email', status: 'provider_accepted',
        sentChannel: null, createdAt: AT, updatedAt: AT, content: { text: 'PRIVATE-MESSAGE-CONTENT' }, digest: 'PRIVATE-DIGEST' }] : [],
      email: { publicKey: 'PRIVATE-EMAILJS-KEY' } },
    registration: { revision: 8, registration: { id: REGISTRATION, referenceCode: REGISTRATION, submittedAt: AT,
      provenance: { kind: 'staff_assisted', sourceContactId: CONTACT, permissionReference: 'PRIVATE-STAFF-PERMISSION' },
      consent: { accepted: false }, fields: { name: '合成甲', organization: '合成报名机构', position: '开发', city: '深圳', email: 'registration@example.invalid',
        wechat: 'synthetic-registration', phone: '', categories: ['industry'], participationInterests: ['workshop'], attendance: 'uncertain', accommodationChoice: 'needed',
        background: 'PRIVATE-REGISTRATION-ANSWER', topics: 'PRIVATE-REGISTRATION-TOPICS' } },
      review: { status: 'in_review', accommodationStatus: 'pending', assignedTo: '合成审核人', nextStep: '核对场次', invitationStatus: 'not_sent', deletionRequested: null,
        internalNotes: 'PRIVATE-REVIEW-NOTES', mariaFeedback: 'PRIVATE-MARIA-FEEDBACK' } },
    admission: { revision: 12, status: 'confirmed', kind: 'attendee', team: 'PRIVATE-TEAM-ROSTER' },
    content: { revision: 5, content: {
      sessions: [{ id: 'synthetic-session', title: '合成分享', start: '10:00', end: '11:00', zone: 'A', status: 'scheduled', internalNotes: 'PRIVATE-SESSION-NOTES' }],
      booths: [{ id: 'synthetic-booth', code: 'C01', organization: '合成机构', project: '合成作品', slotNumber: 1, status: 'confirmed',
        contactMethods: 'PRIVATE-BOOTH-PHONE', internalNotes: 'PRIVATE-BOOTH-NOTES' }],
      guests: [{ id: 'synthetic-guest', contactId: CONTACT, name: '合成甲', company: '合成机构', title: '开发者', status: 'confirmed',
        publicConsent: true, portraitId: 'f'.repeat(64) + '.webp', publicRoles: ['speaker', 'organizer'], internalNotes: 'PRIVATE-GUEST-NOTES' }],
      settings: { privateKey: 'PRIVATE-CONTENT-SETTINGS' } },
      published: { revision: 4, publishedAt: AT, content: { guests: [{ id: 'synthetic-guest', name: '合成甲', publicRoles: ['speaker'] }] } } },
    confirmations: { revision: 9, notices: [{ id: 'synthetic-confirmation', kind: 'registration', status: 'provider_accepted', admissionStatus: 'confirmed', attempt: 1,
      createdAt: AT, updatedAt: AT, recipient: 'PRIVATE-RECIPIENT', receiptToken: 'PRIVATE-CAPABILITY', body: 'PRIVATE-CONFIRMATION-CONTENT' }],
      settings: { enabled: true }, audit: ['PRIVATE-CONFIRMATION-AUDIT'] },
  };
  const calls = [];
  const loaders = Object.fromEntries(['Contacts', 'Intent', 'Registration', 'Admission', 'Content', 'Confirmations'].map(name => ['load' + name, async (...args) => {
    calls.push({ source: name.toLowerCase(), args }); return data[name.toLowerCase()];
  }]));
  let authentications = 0;
  const options = { authenticate: async () => { authentications++; return { user: actor(roles) }; }, ...loaders };
  const api = extra => createPersonWorkspaceApi({ ...options, ...extra });
  const request = (path = '/api/admin/people/contacts/' + CONTACT, init = {}) => new Request(ORIGIN + path, init);
  async function read(extra = {}, path) {
    const response = await api(extra)(request(path)); return { response, body: await response.json() };
  }
  return { data, calls, options, api, request, read, get authentications() { return authentications; } };
}
