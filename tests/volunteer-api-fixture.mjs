import { createObjectJournal } from '../functions/cloud-content/object-journal.mjs';
import { createVolunteerRepository } from '../functions/volunteers/repository.mjs';
import { createVolunteerService } from '../functions/volunteers/service.mjs';
import { createVolunteersApi } from '../functions/volunteers/handler.mjs';
import { memoryObjects } from './helpers/cloud-memory-objects.mjs';

export const VOLUNTEER_FIXTURE_ORIGIN = 'https://api.artdico.host';
export const VOLUNTEER_FIXTURE_REGISTRATION = 'r'.repeat(43);
export const VOLUNTEER_FIXTURE_SECRET = 'SYNTHETIC_RAW_QUESTION_AND_PROVIDER_SECRET_NEVER_EXPOSE';
export function fixtureVolunteer(id = 'volunteer_01', source = { kind: 'contact', id: 'contact_01' }) {
  return { id, source, workflowStatus: 'confirmed', owner: '合成负责同事', followUpAt: '', lastContactAt: '', notes: '合成私密沟通记录', availability: [{ start: '09:00', end: '18:00' }] };
}
export function fixturePosition() { return { id: 'position_01', name: '签到接待', zone: 'A', location: '合成入口', lead: '合成负责人', description: '', status: 'active' }; }
export function fixtureShift(id = 'shift_01') { return { id, positionId: 'position_01', start: '09:00', end: '10:00', required: 1, status: 'active', sessionId: '', boothId: '' }; }

/** Shared synthetic real-service fixture. Never imported by the production closure. */
export function volunteerFixture({ authenticate, clock = () => Date.parse('2026-10-21T05:00:00.000Z') } = {}) {
  const actor = { id: 'volunteer_operator', roles: ['outreach', 'reviewer'] }, csrfToken = 'synthetic-volunteer-csrf-token-123456';
  const objects = memoryObjects(), journal = createObjectJournal({ objects, prefix: 'cms/v1/volunteers/ggj-cn-2026' });
  const sources = {
    contacts: { revision: 2, contacts: [
      { id: 'contact_01', profile: { name: '=合成人员一', displayName: '', organization: '合成组织', email: 'volunteer-one@example.invalid', wechat: 'synthetic-wechat-one', phone: 'synthetic-phone-one', contactConsent: 'consented', rawAnswer: VOLUNTEER_FIXTURE_SECRET }, operations: { responseStatus: 'attending' }, sourceDigest: VOLUNTEER_FIXTURE_SECRET },
      { id: 'contact_02', profile: { name: '合成人员二', displayName: '', organization: '合成院校', email: 'volunteer-two@example.invalid', wechat: '', phone: '', contactConsent: 'consented' }, operations: { responseStatus: 'pending' } },
    ] },
    intent: { revision: 1, conversions: [{ sourceContactId: 'contact_01', registrationId: VOLUNTEER_FIXTURE_REGISTRATION }] },
    registrations: { revision: 1, registrations: [{ id: VOLUNTEER_FIXTURE_REGISTRATION, fields: { name: '=合成人员一', organization: '合成组织', email: 'stale-profile@example.invalid', wechat: '', rawQuestion: VOLUNTEER_FIXTURE_SECRET },
      provenance: { kind: 'staff_assisted', sourceContactId: 'contact_01', permissionReference: VOLUNTEER_FIXTURE_SECRET }, consent: { accepted: false } }] },
    admissions: { revision: 1, people: [{ registrationId: VOLUNTEER_FIXTURE_REGISTRATION, status: 'confirmed', kind: 'attendee' }] },
    content: { revision: 3, content: { schemaVersion: 1, eventId: 'ggj-cn-2026', event: { title: '合成 GGJ 志愿者活动', date: '2026-12-05', timezone: 'Asia/Shanghai' },
      sessions: [{ id: 'session_01', title: '合成交流', start: '10:00', end: '11:00', zone: 'A', status: 'confirmed', internalNotes: VOLUNTEER_FIXTURE_SECRET }],
      booths: [{ id: 'booth_01', code: 'C-01', organization: '合成展位', status: 'confirmed', slotNumber: 1, contactName: VOLUNTEER_FIXTURE_SECRET }] } },
    inactiveRegistrationIds: [],
  };
  let sourceReads = 0, sourceFailure = false;
  const getSources = async () => { sourceReads++; if (sourceFailure) throw new Error(VOLUNTEER_FIXTURE_SECRET); return structuredClone(sources); };
  const repository = createVolunteerRepository({ journal, eventId: 'ggj-cn-2026', clock }), service = createVolunteerService({ repository, getSources, clock });
  const api = createVolunteersApi({ authenticate: authenticate ?? (async () => ({ user: actor, csrfToken })), service });
  let serial = 0;
  async function operate(action, payload, overrides = {}) {
    return service.operate({ actor, expectedRevision: (await repository.read()).revision, operationId: 'synthetic_operation_' + String(++serial).padStart(8, '0'), action, payload, ...overrides });
  }
  return { actor, user: actor, csrfToken, objects, journal, repository, service, api, sources, operate, get sourceReads() { return sourceReads; }, setSourceFailure(value) { sourceFailure = value; } };
}
export const createVolunteerApiFixture = volunteerFixture;
