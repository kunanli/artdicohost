import {personGroupFor} from '../registration-api/admissions.mjs';
import { PARTICIPATION_FORMS, SESSION_ROLES, validateStoredContact } from '../../shared/contacts-schema.mjs';
import { GUEST_PUBLIC_ROLES, PORTRAIT_ID_PATTERN, isContentVisible, contentSchema, normalizeGuestAttendance } from '../../shared/content-schema.mjs';
import { parseTimestamp } from '../registration-api/policy.mjs';
import { canManageEventOperations } from '../../shared/staff-permissions.mjs';
import { personWorkRecommendation, PEOPLE_HEALTH_KINDS } from '../../shared/organizer-progress.mjs';
import { assessPublishedEventFacts } from '../../src/config/event.mjs';

export const CONTACT_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/u;
export const REGISTRATION_ID = /^[A-Za-z0-9_-]{43}$/u;
export const HISTORY_LIMIT = 200;
// Minimal person projection deliberately excludes the volunteer journal's detailed
// source diagnostics. Keep this allowlist aligned with VOLUNTEER_ISSUE_LABELS.
const VOLUNTEER_ISSUES = ['SOURCE_UNAVAILABLE', 'SOURCE_INELIGIBLE', 'DUPLICATE_PERSON', 'VOLUNTEER_INACTIVE',
  'VOLUNTEER_NOT_CONFIRMED', 'ADMISSION_NOT_CONFIRMED', 'SHIFT_CANCELLED', 'POSITION_INACTIVE',
  'CONTENT_LINK_INVALID', 'OUTSIDE_AVAILABILITY', 'TIME_CONFLICT', 'SHIFT_OVER_CAPACITY'];
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value)
  && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const fail = () => { throw new TypeError('Person source is unavailable.'); };
const list = (value, max = 5000) => { if (!Array.isArray(value) || value.length > max) fail(); return value; };
export const revisionValue = value => { if (!Number.isSafeInteger(value) || value < 0) fail(); return value; };
function text(value, maximum = 500, fallback = '') {
  if (value === undefined || value === null) return fallback;
  if (typeof value !== 'string' || [...value].length > maximum || !value.isWellFormed() || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value)) fail();
  return value;
}
const oneOf = (value, choices, fallback) => { if (value === undefined && fallback !== undefined) return fallback; if (!choices.includes(value)) fail(); return value; };
const identifier = value => { if (typeof value !== 'string' || !CONTACT_ID.test(value)) fail(); return value; };
export function timestamp(value, nullable = true) {
  if (nullable && (value === undefined || value === null || value === '')) return null;
  if (typeof value !== 'string' || value.length > 40 || parseTimestamp(value) === null) fail();
  return new Date(value).toISOString();
}
function strings(value, maximum = 50, itemMaximum = 160, allowed) {
  const result = list(value ?? [], maximum).map(item => text(item, itemMaximum));
  if (result.some(item => !item || allowed && !allowed.includes(item)) || new Set(result).size !== result.length) fail();
  return result;
}
function ids(value) { return strings(value, 50, 80).map(identifier); }
function records(value, idPattern, max = 5000) {
  const output = list(value, max), seen = new Set();
  for (const item of output) { if (!plain(item) || typeof item.id !== 'string' || !idPattern.test(item.id) || seen.has(item.id)) fail(); seen.add(item.id); }
  return output;
}

export function contactsSource(value) {
  if (!plain(value)) fail();
  return { revision: revisionValue(value.revision), contacts: records(value.contacts, CONTACT_ID) };
}
export function contactProjection(value) {
  if (!plain(value) || !plain(value.profile) || !plain(value.operations)) fail();
  const profile = {};
  for (const [key, maximum] of Object.entries({ name: 120, displayName: 120, organization: 300, position: 200, city: 160, email: 254, wechat: 150, phone: 150 })) profile[key] = text(value.profile[key], maximum);
  if (!profile.name) fail();
  if (!profile.displayName) profile.displayName = profile.name;
  profile.contactConsent = oneOf(value.profile.contactConsent, ['consented', 'declined', 'unknown'], 'unknown');
  profile.categories = strings(value.profile.categories, 30);
  profile.interests = strings(value.profile.interests, 30);
  const source = value.operations, sessionIds = ids(source.sessionIds), boothIds = ids(source.boothIds);
  const operations = { owner: text(source.owner, 120), priority: oneOf(source.priority, ['normal', 'high'], 'normal'),
    followUpAt: text(source.followUpAt, 10), responseStatus: oneOf(source.responseStatus, ['pending', 'attending', 'declined'], 'pending'),
    notes: text(source.notes, 6000), participationForms: strings(source.participationForms, PARTICIPATION_FORMS.length, 40, PARTICIPATION_FORMS),
    sessionRoles: list(source.sessionRoles ?? [], 50).map(entry => {
      if (!plain(entry) || !sessionIds.includes(entry.sessionId)) fail();
      return { sessionId: identifier(entry.sessionId), roles: strings(entry.roles, SESSION_ROLES.length, 40, SESSION_ROLES) };
    }), sessionIds, boothIds };
  if (new Set(operations.sessionRoles.map(entry => entry.sessionId)).size !== operations.sessionRoles.length) fail();
  if (operations.followUpAt && (!/^\d{4}-\d\d-\d\d$/u.test(operations.followUpAt)
    || parseTimestamp(operations.followUpAt + 'T00:00:00Z') === null)) fail();
  const sourceProfile = Object.hasOwn(value, 'sourceProfile') ? value.sourceProfile : value.profile;
  if (!plain(sourceProfile)) fail();
  return { id: identifier(value.id), profile, operations, sourceCategories: strings(sourceProfile.categories, 30) };
}
export function intentSource(value) {
  if (!plain(value)) fail();
  revisionValue(value.revision);
  const conversions = list(value.conversions, 1000), seen = new Set(), registrations = new Set();
  for (const item of conversions) {
    if (!plain(item) || typeof item.sourceContactId !== 'string' || !CONTACT_ID.test(item.sourceContactId)
      || typeof item.registrationId !== 'string' || !REGISTRATION_ID.test(item.registrationId)
      || seen.has(item.sourceContactId) || registrations.has(item.registrationId)&&!value.personGroups?.some(group=>group.primaryRegistrationId===item.registrationId&&group.contactIds.includes(item.sourceContactId)&&group.contactIds.includes(conversions.find(other=>other!==item&&other.registrationId===item.registrationId)?.sourceContactId))) fail();
    seen.add(item.sourceContactId); registrations.add(item.registrationId);
  }
  const invitations = records(value.invitations, CONTACT_ID, 1000);
  for (const item of invitations) {
    if (typeof item.sourceContactId !== 'string' || !CONTACT_ID.test(item.sourceContactId)
      || typeof item.registrationId !== 'string' || !REGISTRATION_ID.test(item.registrationId)
      || !['manual', 'email'].includes(item.channel) || !['prepared', 'issuing', 'provider_accepted', 'unknown', 'rejected', 'manually_sent'].includes(item.status)) fail();
    if (timestamp(item.updatedAt, false) < timestamp(item.createdAt, false)) fail();
    if (!(item.sentChannel === null || item.sentChannel === undefined || ['wechat', 'email', 'other'].includes(item.sentChannel))) fail();
    const conversion = conversions.find(entry => entry.sourceContactId === item.sourceContactId);
    if (!conversion || conversion.registrationId !== item.registrationId) fail();
  }
  return { revision: value.revision, conversions, invitations, ...(value.personGroups?{personGroups:value.personGroups}: {}) };
}
export function registrationSource(value, expectedId) {
  if (!plain(value) || !plain(value.registration) || value.registration.id !== expectedId || !plain(value.registration.fields)
    || !plain(value.registration.provenance) || !plain(value.review)) fail();
  revisionValue(value.revision);
  const record = value.registration, fields = {};
  for (const [key, maximum] of Object.entries({ name: 120, organization: 300, position: 200, city: 160, email: 254, wechat: 150, phone: 150,
    attendance: 40, accommodationChoice: 40 })) fields[key] = text(record.fields[key], maximum);
  if (!fields.name) fail();
  fields.categories = strings(record.fields.categories, 30);
  fields.participationInterests = strings(record.fields.participationInterests, 30);
  const kind = oneOf(record.provenance.kind, ['public', 'staff_assisted', 'staff_entry']);
  if (kind === 'staff_assisted' && (typeof record.provenance.sourceContactId !== 'string' || !CONTACT_ID.test(record.provenance.sourceContactId))) fail();
  const review = { status: oneOf(value.review.status, ['new', 'in_review', 'awaiting_maria', 'approved', 'discussion', 'not_this_time', 'withdrawn']),
    accommodationStatus: oneOf(value.review.accommodationStatus, ['not_requested', 'requested', 'pending', 'approved', 'declined']),
    assignedTo: text(value.review.assignedTo, 120), nextStep: text(value.review.nextStep, 1000),
    invitationStatus: oneOf(value.review.invitationStatus, ['not_sent', 'to_send', 'sent', 'declined']),
    deletionRequested: value.review.deletionRequested !== null && value.review.deletionRequested !== undefined };
  const registration = { id: expectedId, referenceCode: text(record.referenceCode, 128, expectedId),
    submittedAt: timestamp(record.submittedAt, false), provenance: { kind }, fields, review };
  return { revision: value.revision, registration, sourceContactId: kind === 'staff_assisted' ? record.provenance.sourceContactId : null };
}
export function admissionSource(value) {
  if (!plain(value)) fail();
  return { status: oneOf(value.status, ['confirmed', 'waitlisted', 'withdrawn', 'pending_review', 'rejected']), kind: oneOf(value.kind, ['attendee', 'crew']), revision: revisionValue(value.revision) };
}
export function contentSource(value) {
  if (!plain(value) || !plain(value.content)) fail();
  return { revision: revisionValue(value.revision), content: { sessions: records(value.content.sessions, CONTACT_ID, 200),
    booths: records(value.content.booths, CONTACT_ID, 200), guests: value.content.guests,
    ...(Object.hasOwn(value.content, 'organizations') ? { organizations: value.content.organizations } : {}) },
    hasPublished: Object.hasOwn(value, 'published'), published: value.published };
}
/** Legacy contacts have no memberships. Explicit malformed new values are never empty. */
export function organizationMemberships(operations) {
  if (!plain(operations)) fail();
  const field = Object.getOwnPropertyDescriptor(operations, 'organizationMemberships');
  if (!field) return [];
  if (!field.enumerable || !('value' in field)) fail();
  const seen = new Set();
  return Array.from(list(field.value, 20), item => {
    if (!plain(item) || Reflect.ownKeys(item).length !== 3 || !['organizationId', 'role', 'title'].every(key => {
      const property = Object.getOwnPropertyDescriptor(item, key); return property?.enumerable && 'value' in property;
    })) fail();
    const organizationId = identifier(item.organizationId), title = text(item.title, 120);
    if (typeof item.title !== 'string' || /[\u0000-\u001f\u007f]/u.test(title) || seen.has(organizationId)) fail();
    seen.add(organizationId);
    return { organizationId, role: oneOf(item.role, ['lead', 'member']), title };
  });
}
export function organizationLookupProjection(source) {
  return records(Object.hasOwn(source.content, 'organizations') ? source.content.organizations : [], CONTACT_ID, 200).map(item => {
    const name = text(item.name, 160);
    if (!name.trim() || /[\u0000-\u001f\u007f]/u.test(name)) fail();
    return { id: item.id, name, status: oneOf(item.status, ['pending', 'confirmed', 'withdrawn']),
      participation: oneOf(item.participation, ['undecided', 'exhibitor', 'attendee']) };
  });
}
export function organizationsProjection(contactRaw, source) {
  const organizations = organizationLookupProjection(source), memberships = organizationMemberships(contactRaw.operations).map(item => {
    const organization = organizations.find(entry => entry.id === item.organizationId);
    return { ...item, name: organization?.name ?? '', organizationStatus: organization?.status ?? 'missing',
      participation: organization?.participation ?? '', missing: !organization };
  });
  return { state: memberships.length ? 'available' : 'unlinked', memberships };
}
function publicGuestValue(item, saved = false) {
  if (!item || !isContentVisible(item)) return null;
  const portraitId=text(item.portraitId,80);
  if(portraitId&&!PORTRAIT_ID_PATTERN.test(portraitId))return null;
  const portraitUrl=portraitId?'/api/public/portraits/'+portraitId:'';
  if(saved&&item.portraitUrl!==portraitUrl)return null;
  const result = { id: item.id, name: text(item.name, 120), company: text(item.company, 160), ggjRole: text(item.ggjRole, 160),
    portraitId, portraitUrl,
    status: item.status, publicConsent: item.publicConsent, ...(Object.hasOwn(item, 'visibility') ? { visibility: item.visibility } : {}) };
  for (const [key, maximum] of Object.entries({ title: 200, bio: 4000, website: 500 })) if (Object.hasOwn(item, key)) result[key] = text(item[key], maximum);
  if (Object.hasOwn(item, 'publicRoles')) result.publicRoles = strings(item.publicRoles, GUEST_PUBLIC_ROLES.length, 40, GUEST_PUBLIC_ROLES);
  return result;
}
/** Public snapshots deliberately omit contactId. Only a current explicit draft link
 * can attribute a saved guest ID; orphan publication requires staff verification. */
export function publicProfileProjection(contactId, source, { responseStatus } = {}) {
  if (!source.hasPublished) fail();
  const guests = records(source.content.guests ?? [], CONTACT_ID, 200), published = source.published;
  if (published !== null && (!plain(published) || !plain(published.content))) fail();
  const savedGuests = published === null ? [] : records(published.content.guests, CONTACT_ID, 200);
  const attendance = published !== null && Object.hasOwn(published.content, 'guestAttendance')
    ? normalizeGuestAttendance(published.content.guestAttendance, savedGuests.map(item => item.id)) : null;
  const publishedRevision = published === null ? null : revisionValue(published.revision);
  if (publishedRevision !== null && publishedRevision > source.revision) fail();
  const publishedAt = published === null ? null : timestamp(published.publishedAt, false);
  const profiles = guests.filter(item => item.contactId === contactId).map(item => {
    if (typeof item.publicConsent !== 'boolean' || Object.hasOwn(item, 'visibility') && !['public','private'].includes(item.visibility)) fail();
    const portraitId = text(item.portraitId, 80);
    if (portraitId && !PORTRAIT_ID_PATTERN.test(portraitId)) fail();
    const saved = savedGuests.find(saved => saved.id === item.id), draftPublic = publicGuestValue(item), savedPublic = publicGuestValue(saved, true);
    return { id: item.id, name: text(item.name, 120), company: text(item.company, 300), title: text(item.title, 200),
      status: oneOf(item.status, ['pending', 'confirmed']), publicConsent: item.publicConsent, ...(Object.hasOwn(item, 'visibility') ? { visibility: item.visibility } : {}), hasPortrait: Boolean(portraitId),
      publicRoles: strings(item.publicRoles, GUEST_PUBLIC_ROLES.length, 40, GUEST_PUBLIC_ROLES), published: Boolean(saved),
      publishedMatchesDraft: Boolean(draftPublic && savedPublic && JSON.stringify(draftPublic) === JSON.stringify(savedPublic)
        && (!['pending', 'attending', 'declined'].includes(responseStatus)
          || (responseStatus === 'attending') === Boolean(attendance?.confirmedGuestIds.includes(item.id)))) };
  });
  const orphanedPublication = !profiles.length && savedGuests.some(saved => !guests.some(item => item.id === saved.id));
  return { state: orphanedPublication ? 'unavailable' : profiles.length ? 'available' : 'unlinked', profiles, publishedRevision, publishedAt };
}
export function arrangementsProjection(contact, source) {
  const linkedGuestIds = records(source.content.guests ?? [], CONTACT_ID, 200).filter(item => item.contactId === contact.id).map(item => item.id);
  const sessionIds = [...new Set([...contact.operations.sessionIds,
    ...source.content.sessions.filter(item => linkedGuestIds.includes(item.guestId)
      || item.participants?.some(participant => linkedGuestIds.includes(participant.guestId))).map(item => item.id)])];
  const sessions = sessionIds.map(id => {
    const item = source.content.sessions.find(entry => entry.id === id), roles = contact.operations.sessionRoles.find(entry => entry.sessionId === id)?.roles ?? [];
    return { id, title: text(item?.title, 200), start: text(item?.start, 5), end: text(item?.end, 5), zone: text(item?.zone, 1),
      status: item ? oneOf(item.status, ['draft', 'scheduled', 'cancelled']) : 'missing', roles, missing: !item };
  });
  const booths = contact.operations.boothIds.map(id => {
    const item = source.content.booths.find(entry => entry.id === id);
    if (item?.slotNumber !== undefined && (!Number.isSafeInteger(item.slotNumber) || item.slotNumber < 0 || item.slotNumber > contentSchema.maxBoothPosition)) fail();
    return { id, code: text(item?.code, 20), organization: text(item?.organization, 200), project: text(item?.project, 200),
      position: item?.slotNumber ? String(item.slotNumber) : '', status: item ? oneOf(item.status, ['pending', 'confirmed', 'cancelled']) : 'missing', missing: !item };
  });
  return { sessions, booths };
}
export function confirmationsSource(value) {
  if (!plain(value)) fail();
  if (Object.hasOwn(value, 'unresolvedConfirmations') && typeof value.unresolvedConfirmations !== 'boolean') fail();
  const notices = records(value.notices, CONTACT_ID, 2000).map(item => ({ id: item.id,
    kind: oneOf(item.kind, ['registration', 'promotion']), status: oneOf(item.status, ['reserved', 'provider_accepted', 'rejected', 'unknown']) === 'reserved' ? 'unknown' : item.status,
    admissionStatus: oneOf(item.admissionStatus, ['confirmed', 'waitlisted']), attempt: revisionValue(item.attempt),
    createdAt: timestamp(item.createdAt, false), updatedAt: timestamp(item.updatedAt, false) }));
  return { revision: revisionValue(value.revision), notices,
    ...(Object.hasOwn(value, 'unresolvedConfirmations') ? { unresolvedConfirmations: value.unresolvedConfirmations } : {}) };
}

/** Selected-person-only volunteer projection. Private notes, source profiles,
 * roster totals and unrelated people never cross this boundary. */
export function volunteersSource(value) {
  if (!plain(value)) fail();
  const revision = revisionValue(value.revision), assignmentsSeen = new Set();
  const time = value => {
    const result = text(value, 5);
    if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/u.test(result)) fail();
    return result;
  };
  const entries = records(value.entries, CONTACT_ID, 500).map(entry => ({
    id: entry.id,
    workflowStatus: oneOf(entry.workflowStatus, ['pending', 'invited', 'confirmed', 'declined', 'inactive']),
    availability: list(entry.availability, 12).map(window => {
      if (!plain(window)) fail();
      const start = time(window.start), end = time(window.end);
      if (end <= start) fail();
      return { start, end };
    }),
    assignments: records(entry.assignments, CONTACT_ID, 1000).map(item => {
      if (assignmentsSeen.has(item.id) || assignmentsSeen.size >= 1000 || typeof item.eligible !== 'boolean' || !Array.isArray(item.issues)) fail();
      assignmentsSeen.add(item.id);
      const start = time(item.start), end = time(item.end);
      if (end <= start) fail();
      return { id: item.id, status: oneOf(item.status, ['proposed', 'confirmed', 'cancelled']),
        shiftId: identifier(item.shiftId), positionId: identifier(item.positionId),
        positionName: text(item.positionName, 200), zone: oneOf(item.zone, ['A', 'B', 'C', 'other']),
        location: text(item.location, 300), start, end,
        shiftStatus: oneOf(item.shiftStatus, ['active', 'cancelled']), eligible: item.eligible,
        issues: strings(item.issues, VOLUNTEER_ISSUES.length, 40, VOLUNTEER_ISSUES) };
    }),
  }));
  return { revision, entries };
}
const descending = (a, b) => (b.updatedAt ?? b.at ?? '').localeCompare(a.updatedAt ?? a.at ?? '') || a.id.localeCompare(b.id);
export function communicationProjection({ contactRaw, contactId, registrationId, intent, confirmations }) {
  const group = (intent?.personGroups ?? []).find(item => item.contactIds.includes(contactId)
    && (registrationId === null || item.registrationIds.includes(registrationId)));
  const contactIds = new Set(group ? group.contactIds : [contactId]), registrationIds = new Set(group ? group.registrationIds : [registrationId]);
  const invitations = (intent?.invitations ?? []).filter(item => contactIds.has(item.sourceContactId) && registrationIds.has(item.registrationId))
    .map(item => ({ id: item.id, channel: item.channel, status: item.status === 'issuing' ? 'unknown' : item.status,
      sentChannel: item.sentChannel ?? null, createdAt: timestamp(item.createdAt), updatedAt: timestamp(item.updatedAt) })).sort(descending);
  const notices = [...(confirmations?.notices ?? [])].sort(descending);
  const timeline = [
    ...invitations.map(item => ({ source: 'invitation', id: item.id, at: item.updatedAt, status: item.status, channel: item.channel, kind: null })),
    ...notices.map(item => ({ source: 'confirmation', id: item.id, at: item.updatedAt, status: item.status, channel: 'email', kind: item.kind })),
  ];
  // Legacy invitation facts belong to the already-authorized contacts source.
  // They remain readable if the independent invitation ledger is unavailable;
  // clients must gate this source by availability.contact, not invitations.
  if (contactRaw?.invitation?.generatedAt) timeline.push({ source: 'legacy_invitation', id: 'legacy-generated',
    at: timestamp(contactRaw.invitation.generatedAt), status: 'prepared', channel: 'manual', kind: null });
  if (contactRaw?.invitation?.sentAt) timeline.push({ source: 'legacy_invitation', id: 'legacy-sent',
    at: timestamp(contactRaw.invitation.sentAt), status: 'manually_sent', channel: oneOf(contactRaw.invitation.channel, ['wechat', 'email', 'other']), kind: null });
  timeline.sort(descending);
  return { historyLimit: HISTORY_LIMIT, invitationTotal: invitations.length, confirmationTotal: notices.length, timelineTotal: timeline.length,
    unresolvedInvitations: invitations.some(item => item.status === 'unknown'),
    unresolvedConfirmations: confirmations?.unresolvedConfirmations === true || notices.some(item => ['unknown', 'reserved'].includes(item.status)),
    historyTruncated: invitations.length > HISTORY_LIMIT || notices.length > HISTORY_LIMIT || timeline.length > HISTORY_LIMIT,
    invitations: invitations.slice(0, HISTORY_LIMIT), confirmations: notices.slice(0, HISTORY_LIMIT), timeline: timeline.slice(0, HISTORY_LIMIT) };
}

export function personPermissions(actor) {
  const roles = Array.isArray(actor?.roles) ? actor.roles : [];
  const contact = roles.includes('superadmin') || roles.includes('outreach'), registration = roles.includes('superadmin') || roles.includes('reviewer');
  return { contact, registration, invitations: contact, confirmations: registration, arrangements: contact,
    volunteers: roles.includes('superadmin') || roles.includes('outreach') && roles.includes('reviewer') };
}

/** Minimal staff directory. Never use names or email addresses as identity links. */
export function peopleDirectoryProjection({ permissions, roster, intent, registrationDirectory, admissions, content, deliveries } = {}) {
  if (!plain(permissions)) fail();
  const contacts = permissions.contact ? contactsSource(roster).contacts : [];
  const outreach = permissions.contact ? intentSource(intent) : null;
  const program = permissions.contact ? contentSource(content) : null;
  const organizations = program ? organizationLookupProjection(program) : [];
  let applications = [], admissionMap = new Map();
  if (permissions.registration) {
    if (!plain(registrationDirectory) || !plain(admissions)) fail();
    revisionValue(registrationDirectory.revision); revisionValue(registrationDirectory.applicationRevision); revisionValue(admissions.revision);
    applications = records(registrationDirectory.registrations, REGISTRATION_ID, 1000).map(record => {
      if (!plain(record.fields) || !plain(record.provenance) || typeof record.inactive !== 'boolean') fail();
      const kind = oneOf(record.provenance.kind, ['public', 'staff_assisted', 'staff_entry']);
      return { id: record.id, name: text(record.fields.name, 120), organization: text(record.fields.organization, 300), city: text(record.fields.city, 160),
        kind, sourceContactId: kind === 'staff_assisted' ? identifier(record.provenance.sourceContactId) : null, inactive: record.inactive };
    });
    for (const person of list(admissions.people, 1000)) {
      if (!plain(person) || !REGISTRATION_ID.test(person.registrationId ?? '') || admissionMap.has(person.registrationId)) fail();
      admissionMap.set(person.registrationId, oneOf(person.status, ['confirmed', 'waitlisted', 'withdrawn', 'pending_review', 'rejected']));
    }
    if (applications.some(item => !admissionMap.has(item.id))) fail();
  }
  const applicationMap = new Map(applications.map(row => [row.id, row])), linked = new Set(), people = [], contactRows = new Map();
  const deliveryMap = new Map();
  if (permissions.registration && deliveries) {
    revisionValue(deliveries.revision);
    for (const item of list(deliveries.notices, 2000)) {
      if (!plain(item) || !REGISTRATION_ID.test(item.registrationId ?? '')) fail();
      const status = oneOf(item.status, ['provider_accepted', 'unknown', 'rejected']);
      if (deliveryMap.get(item.registrationId) !== 'unknown' || status === 'unknown') deliveryMap.set(item.registrationId, status);
    }
  }
  const admission = application => application ? application.inactive ? 'withdrawn' : admissionMap.get(application.id) : null;
  const email = id => !permissions.registration ? 'restricted' : !deliveries ? 'unavailable' : deliveryMap.get(id) ?? 'not_sent';
  const sessions = new Map((program?.content.sessions ?? []).filter(item => item.status !== 'cancelled').map(item => [item.id, item]));
  for (const raw of contacts) {
    const item = contactProjection(raw), conversion = outreach.conversions.find(row => row.sourceContactId === item.id);
    const application = permissions.registration && conversion ? applicationMap.get(conversion.registrationId) : null;
    if (permissions.registration && conversion && (!application || (application.kind !== 'staff_assisted' || application.sourceContactId !== item.id)&&personGroupFor(admissions,{contactId:item.id})?.primaryRegistrationId!==application.id)) fail();
    if (application) linked.add(application.id);
    const roles = new Set(item.operations.participationForms.map(role => role === 'booth' ? 'exhibitor' : role));
    for (const role of item.operations.sessionRoles) if (sessions.has(role.sessionId)) for (const value of role.roles) roles.add(value);
    const notices = outreach.invitations.filter(row => row.sourceContactId === item.id).sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt));
    const invited = notices.find(row => ['unknown', 'issuing'].includes(row.status))?.status ?? notices[0]?.status
      ?? (raw.invitation?.sentAt ? 'manually_sent' : raw.invitation?.generatedAt ? 'prepared' : 'not_started');
    const row = { key: 'contact:' + item.id, kind: 'person', source: application ? 'linked' : 'contact',
      name: item.profile.displayName, organization: item.profile.organization, city: item.profile.city,
      contactId: item.id, registrationId: application?.id ?? (conversion?.registrationId ?? null), profileId: null, roles: [...roles],
      responseStatus: item.operations.responseStatus, admissionStatus: admission(application),
      registrationState: application ? 'available' : conversion ? 'restricted' : 'unlinked',
      invitationStatus: invited, owner: item.operations.owner, followUpAt: item.operations.followUpAt,
      deliveryStatus: application ? email(application.id) : 'not_applicable' };
    contactRows.set(item.id, row); people.push(row);
  }
  for (const item of applications) if (!linked.has(item.id)) people.push({ key: 'registration:' + item.id, kind: 'person', source: item.kind,
    name: item.name, organization: item.organization, city: item.city, contactId: null, registrationId: item.id, profileId: null, roles: [],
    responseStatus: null, admissionStatus: admission(item), registrationState: 'available', invitationStatus: 'not_applicable',
    owner: '', followUpAt: '', deliveryStatus: email(item.id) });
  for (const profile of program ? records(program.content.guests ?? [], CONTACT_ID, 200) : []) {
    const roles = strings(profile.publicRoles, GUEST_PUBLIC_ROLES.length, 40, GUEST_PUBLIC_ROLES);
    const contactId = profile.contactId ? identifier(profile.contactId) : null, target = contactId ? contactRows.get(contactId) : null;
    if (target) {
      if (target.profileId) fail(); target.profileId = profile.id; target.roles = [...new Set([...target.roles, ...roles])];
    } else people.push({ key: 'profile:' + profile.id, kind: 'person', source: 'profile', name: text(profile.name, 120), organization: text(profile.company, 300), city: '',
      contactId: null, registrationId: null, profileId: profile.id, roles, responseStatus: null, admissionStatus: null, registrationState: 'unlinked',
      invitationStatus: 'not_applicable', owner: '', followUpAt: '', deliveryStatus: 'not_applicable' });
  }
  const booth = item => ({ id: identifier(item.id), code: text(item.code, 80), zone: text(item.zone, 10), status: oneOf(item.status, ['pending', 'confirmed', 'cancelled']) });
  const companies = organizations.filter(item => item.participation === 'exhibitor').map(item => {
    const members = contacts.filter(contact => organizationMemberships(contact.operations).some(member => member.organizationId === item.id))
      .map(contact => ({ id: contact.id, name: contactProjection(contact).profile.displayName,
        role: organizationMemberships(contact.operations).find(member => member.organizationId === item.id).role }));
    return { key: 'organization:' + item.id, kind: 'organization', organizationId: item.id, name: item.name, organization: item.name, status: item.status,
      booths: program.content.booths.filter(entry => entry.organizationId === item.id).map(booth), members: members.slice(0,20), memberTotal: members.length };
  });
  for (const item of program?.content.booths ?? []) if (!item.organizationId && item.organization && item.status !== 'cancelled') companies.push({
    key: 'booth:' + identifier(item.id), kind: 'unlinked_booth', organizationId: null, name: text(item.organization, 300), organization: text(item.organization, 300), status: 'unlinked', booths: [booth(item)], members: [], memberTotal:0 });
  const groups=admissions?.personGroups??(permissions.contact?intent?.personGroups:[])??[],identityContacts=new Map(),identityRegistrations=new Set();
  for(const group of list(groups,1000)){
    if(!plain(group)||!Array.isArray(group.contactIds)||!Array.isArray(group.registrationIds)||group.contactIds.length>100||group.registrationIds.length>100
      ||group.contactIds.some(id=>!CONTACT_ID.test(id)||identityContacts.has(id))||group.registrationIds.some(id=>!REGISTRATION_ID.test(id)||identityRegistrations.has(id))
      ||!(group.roles===null||Array.isArray(group.roles)&&group.roles.length<=4&&group.roles.every(role=>['attendee','speaker','guest','exhibitor'].includes(role)))
      ||(group.primaryRegistrationId!==null&&!group.registrationIds.includes(group.primaryRegistrationId))||(group.primaryContactId!==null&&!group.contactIds.includes(group.primaryContactId)))fail();
    group.contactIds.forEach(id=>identityContacts.set(id,group.primaryContactId));group.registrationIds.forEach(id=>identityRegistrations.add(id));
    const members=people.filter(row=>row.contactId&&group.contactIds.includes(row.contactId)||row.registrationId&&group.registrationIds.includes(row.registrationId));
    if(!members.length)continue;
    const chosen=group.primaryKey?.startsWith('registration:')?members.find(row=>row.registrationId===group.primaryRegistrationId):members.find(row=>row.contactId===group.primaryContactId);
    const base=chosen??members[0],source=group.primaryKey?.startsWith('registration:')?applicationMap.get(group.primaryRegistrationId):null;
    const contactId=permissions.contact?group.primaryContactId:null,registrationId=group.primaryRegistrationId;
    const originalRoles=[...new Set(members.flatMap(row=>row.roles))],basic=new Set(['attendee','speaker','guest','exhibitor']);
    const roles=group.roles===null?originalRoles:[...new Set([...originalRoles.filter(role=>!basic.has(role)),...group.roles])];
    // An explicit classification never erases a saved actual session/public duty.
    for(const profile of program?.content.guests??[])if(group.contactIds.includes(profile.contactId))for(const role of profile.publicRoles??[])if(!roles.includes(role))roles.push(role);
    for(const raw of contacts)if(group.contactIds.includes(raw.id))for(const session of raw.operations.sessionRoles??[])if(sessions.has(session.sessionId))for(const role of session.roles)if(!roles.includes(role))roles.push(role);
    const current=registrationId?applicationMap.get(registrationId):null;
    const consolidated={...base,key:contactId?'contact:'+contactId:'registration:'+registrationId,contactId,registrationId,
      name:source?.name??base.name,organization:source?.organization??base.organization,city:source?.city??base.city,
      roles:permissions.contact?roles:[],profileId:permissions.contact?(base.profileId??members.find(row=>row.profileId)?.profileId??null):null,admissionStatus:permissions.registration?admission(current):null,registrationState:registrationId?(permissions.registration?'available':'restricted'):'unlinked',
      source:contactId&&registrationId?'linked':base.source,deliveryStatus:members.some(row=>row.deliveryStatus==='unknown')?'unknown':registrationId?email(registrationId):'not_applicable',
      invitationStatus:members.some(row=>['unknown','issuing'].includes(row.invitationStatus))?'unknown':base.invitationStatus,
      sourceCount:group.contactIds.length+group.registrationIds.length,personKey:group.primaryKey,
      ...(members.some(row=>row.responseStatus==='declined')?{responseStatus:'declined'}:{})};
    for(const row of members)people.splice(people.indexOf(row),1);people.push(consolidated);
  }
  for(const row of people){if(permissions.contact&&!row.roles.some(role=>['attendee','speaker','guest','panelist','exhibitor','host','organizer','moderator','student_showcase'].includes(role))&&row.registrationId&&!groups.some(g=>g.primaryRegistrationId===row.registrationId&&g.roles!==null))row.roles.push('attendee');}
  for(const company of companies){const seen=new Map();for(const raw of contacts){const member=organizationMemberships(raw.operations).find(link=>link.organizationId===company.organizationId);if(!member)continue;const id=identityContacts.get(raw.id)??raw.id,current=seen.get(id),person=people.find(row=>row.contactId===id);if(!current)seen.set(id,{id,name:person?.name??contactProjection(raw).profile.displayName,role:member.role});else if(member.role==='lead')current.role='lead';}company.memberTotal=seen.size;company.members=[...seen.values()].slice(0,20);}
  const rows = people.sort((a,b) => Number(b.admissionStatus === 'pending_review') - Number(a.admissionStatus === 'pending_review') || a.name.localeCompare(b.name, 'zh-CN') || a.key.localeCompare(b.key));
  return { people: rows, companies, summary: { people: people.length,
    unassigned:permissions.contact?rows.filter(row=>(row.contactId||row.registrationId)&&!row.roles.some(role=>['attendee','speaker','guest','panelist','exhibitor','host','organizer','moderator','student_showcase'].includes(role))).length:null,
    attendees:permissions.contact?rows.filter(row=>row.roles.includes('attendee')).length:null,
    pendingIntegration:permissions.contact&&permissions.registration?rows.filter(row=>row.contactId&&row.responseStatus==='attending'&&!row.registrationId).length:null,
    confirmed: permissions.registration ? applications.filter(item => admission(item) === 'confirmed').length : null,
    pendingReview: permissions.registration ? applications.filter(item => admission(item) === 'pending_review').length : null,
    exhibitors: permissions.contact ? companies.filter(item => item.kind === 'organization').length : null,
    speakers: permissions.contact ? people.filter(item => item.roles.includes('speaker')).length : null,
    guests: permissions.contact ? people.filter(item => item.roles.includes('guest') || item.roles.includes('panelist')).length : null } };
}

/** Shared candidate calculation. A matching value is a review clue, never an identity link. */
export function peopleDuplicateCandidates(rows, canonical) {
  const norm = value => String(value ?? '').normalize('NFKC').trim().toLocaleLowerCase('zh-CN');
  const tokens = new Map(), pairs = new Map(); let truncated = false;
  for (const row of rows) {
    const owner = canonical(row), items = [];
    if (row.email) items.push(['email:' + norm(row.email), '相同邮箱']);
    if (row.wechat) items.push(['wechat:' + norm(row.wechat), '相同微信']);
    const phone = String(row.phone ?? '').replace(/[^0-9+]/gu, '');
    if (phone.replace(/\D/gu, '').length >= 7) items.push(['phone:' + phone, '相同电话']);
    if (norm(row.name) && norm(row.organization)) items.push(['name:' + norm(row.name) + '\0' + norm(row.organization), '姓名与机构相同']);
    for (const [token, reason] of items) {
      for (const other of tokens.get(token) ?? []) {
        if (other.owner === owner) continue;
        const pair = [owner, other.owner].sort().join('\0');
        if (!pairs.has(pair) && pairs.size >= 200) { truncated = true; continue; }
        const value = pairs.get(pair) ?? { keys: [other.row.key, row.key], rows: [other.row, row].map(item => ({key: item.key, name: item.name, organization: item.organization, source: item.source})), reasons: [] };
        if (!value.reasons.includes(reason)) value.reasons.push(reason);
        pairs.set(pair, value);
      }
      const entries = tokens.get(token) ?? [];
      if (!entries.some(item => item.owner === owner)) entries.push({owner, row});
      tokens.set(token, entries);
    }
  }
  return {candidates: [...pairs.values()], truncated};
}

const personHref = (contactId, registrationId) => contactId ? '/admin/person/#contact=' + encodeURIComponent(contactId)
  : '/admin/person/#registration=' + encodeURIComponent(registrationId);
function duplicateSources(roster, registrations, admissions) {
  const contacts = contactsSource(roster).contacts;
  const entries = records(registrations.registrations, REGISTRATION_ID, 1000);
  const rows = [...contacts.map(row => ({key: 'contact:' + row.id, id: row.id, kind: 'contact', name: row.profile.displayName || row.profile.name,
    organization: row.profile.organization, email: row.profile.email, wechat: row.profile.wechat, phone: row.profile.phone, source: '意向／联络资料'})),
    ...entries.map(row => ({key: 'registration:' + row.id, id: row.id, kind: 'registration', name: row.fields.name, organization: row.fields.organization ?? '',
      email: row.fields.email ?? '', wechat: row.fields.wechat ?? '', phone: '', source: row.provenance.kind === 'public' ? '网站申请' : '工作人员登记', provenance: row.provenance}))];
  const keys = new Set(rows.map(row => row.key));
  const canonical = row => {
    const group = personGroupFor(admissions, row.kind === 'contact' ? {contactId: row.id} : {registrationId: row.id});
    if (group) return group.id;
    if (row.kind === 'registration' && row.provenance.kind === 'staff_assisted' && keys.has('contact:' + row.provenance.sourceContactId)) return 'contact:' + row.provenance.sourceContactId;
    return row.key;
  };
  return {rows, canonical};
}

/** Decorates the minimal directory, without returning comparison emails or original answers. */
export function peopleDirectoryWork(result, {actor, roster, registrationDirectory, admissions, content, revisions} = {}) {
  const full = canManageEventOperations(actor), candidateKeys = new Set();
  if (full && roster && registrationDirectory && admissions) {
    if (registrationDirectory.applicationRevision !== admissions.revision) fail();
    const source = duplicateSources(roster, registrationDirectory, admissions);
    for (const candidate of peopleDuplicateCandidates(source.rows, source.canonical).candidates) for (const key of candidate.keys) candidateKeys.add(key);
  }
  for (const row of result.people) {
    const group = personGroupFor(admissions, {contactId: row.contactId, registrationId: row.registrationId});
    const keys = group ? [...group.contactIds.map(id => 'contact:' + id), ...group.registrationIds.map(id => 'registration:' + id)] : [row.key];
    let publicNeedsUpdate = Boolean(row.profileId && !row.contactId), sourceUnavailable = row.admissionStatus === 'confirmed' && row.deliveryStatus === 'unavailable';
    if (row.contactId && content) try {
      const profile = publicProfileProjection(row.contactId, contentSource(content), {responseStatus: row.responseStatus});
      publicNeedsUpdate = profile.profiles.some(item => item.published && !item.publishedMatchesDraft || !item.published && isContentVisible(item));
    } catch { sourceUnavailable = true; }
    const contact = roster?.contacts?.find(item => item.id === row.contactId);
    const work = personWorkRecommendation({...row, sourceUnavailable, duplicateCandidate: keys.some(key => candidateKeys.has(key)), publicNeedsUpdate,
      contactConsent: contact?.profile.contactConsent, canContact: Boolean(row.contactId), canReview: Boolean(actor?.roles?.some(role => ['reviewer', 'superadmin'].includes(role))),
      canIntegrate: full, canEdit: Boolean(actor?.roles?.some(role => ['editor', 'superadmin'].includes(role)))});
    Object.assign(row, work, {basisRevisions: {...revisions}});
  }
  return result;
}

/** Selected original answers only; callers must authorize outreach before loading the roster. */
export function personSourceProjection(contact, revision) {
  if (!validateStoredContact(contact)) fail();
  const source = contact.sourceProfile ?? contact.profile, fields = [];
  const labels = {name: '姓名', displayName: '称呼', city: '城市', organization: '机构', position: '职务', email: '邮箱', wechat: '微信', phone: '电话',
    siteName: '站点', siteRole: '站点职责', siteYears: '组织年份', topics: '分享主题', background: '背景与经历', needs: '需求', submittedAt: '原填报时间'};
  for (const [key, label] of Object.entries(labels)) if (source[key]) fields.push({label, value: text(source[key], key === 'background' ? 10000 : 4000)});
  for (const [key, label] of [['categories', '原填身份'], ['interests', '原填意向']]) if (source[key]?.length) fields.push({label, value: strings(source[key], 30, 100).join(' / ')});
  const choices = {attendanceIntent: ['原出席意向', {expected: '预计参加', uncertain: '尚不确定', unknown: '原问卷未填写'}],
    accommodationIntent: ['原住宿需求', {needed: '需要住宿', not_needed: '不需要住宿', uncertain: '尚不确定', unknown: '原问卷未填写'}],
    contactConsent: ['原联络许可', {consented: '同意联络', declined: '拒绝联络', unknown: '原问卷未填写'}],
    futureCooperation: ['后续合作', {interested: '有意愿', declined: '暂无意愿', unknown: '原问卷未填写'}]};
  for (const [key, [label, values]] of Object.entries(choices)) fields.push({label: contact.sourceProfile ? label : '旧记录' + label.replace(/^原/u, ''), value: text(source[key + 'Label'] || values[source[key]] || (contact.sourceProfile ? '原问卷未填写' : '旧记录未填写'), 4000)});
  return {schemaVersion: 1, contactId: identifier(contact.id), revision: revisionValue(revision), sourceKind: contact.source.key === 'manual' ? 'manual' : 'imported',
    snapshot: contact.sourceProfile ? 'preserved' : 'legacy', fields};
}

/** Bounded read-only checks. Missing sources affect only their dependent checks. */
export function peopleHealthProjection(sources, {kind = 'all', limit = 100} = {}) {
  const names = ['contacts', 'registrations', 'invitations', 'admissions', 'content'], availability = {}, data = {};
  const revisions = {contacts: null, registration: null, applications: null, admissions: null, invitations: null, content: null, publishedContent: null};
  for (const name of names) {
    const source = sources?.[name]; availability[name] = source?.state === 'available' ? 'available' : source?.state === 'restricted' ? 'restricted' : 'unavailable';
    if (availability[name] !== 'available') continue;
    try {
      const value = source.value; revisionValue(value.revision);
      if (name === 'contacts') for (const row of contactsSource(value).contacts) {
        contactProjection(row);
        const original = row.sourceProfile ?? row.profile;
        if (!plain(original) || !['needed','not_needed','uncertain','unknown'].includes(original.accommodationIntent)) fail();
      }
      if (name === 'registrations') {
        revisionValue(value.applicationRevision);
        for (const row of records(value.registrations, REGISTRATION_ID, 1000)) {
          if (!plain(row.fields) || !plain(row.provenance) || !plain(row.review) || typeof row.inactive !== 'boolean') fail();
          text(row.fields.name, 120); text(row.fields.email, 254); oneOf(row.provenance.kind, ['public','staff_assisted','staff_entry']);
          if (row.provenance.kind === 'staff_assisted') identifier(row.provenance.sourceContactId);
          oneOf(row.review.status, ['new','in_review','awaiting_maria','approved','discussion','not_this_time','withdrawn']);
          oneOf(row.review.accommodationStatus, ['not_requested','requested','pending','approved','declined']);
        }
      }
      if (name === 'invitations') intentSource(value);
      if (name === 'admissions') {
        for (const row of list(value.people, 1000)) {
          if (!plain(row) || !REGISTRATION_ID.test(row.registrationId ?? '')) fail();
          oneOf(row.status, ['confirmed','waitlisted','withdrawn','pending_review','rejected']);
        }
        for (const group of list(value.personGroups ?? [], 1000)) {
          if (!plain(group) || typeof group.id !== 'string' || !/^p_[a-f0-9]{32}$/u.test(group.id)
            || !Array.isArray(group.contactIds) || group.contactIds.length > 100 || group.contactIds.some(id => !CONTACT_ID.test(id))
            || !Array.isArray(group.registrationIds) || group.registrationIds.length > 100 || group.registrationIds.some(id => !REGISTRATION_ID.test(id))) fail();
        }
      }
      if (name === 'content') { contentSource(value); if (!Object.hasOwn(value, 'published')) fail(); }
      data[name] = value;
      revisions[name === 'registrations' ? 'registration' : name] = value.revision;
      if (name === 'registrations') revisions.applications = value.applicationRevision;
      if (name === 'content') revisions.publishedContent = value.published?.revision ?? null;
    } catch { availability[name] = 'unavailable'; }
  }
  if (data.registrations && data.admissions && data.registrations.applicationRevision !== data.admissions.revision) {
    availability.registrations = availability.admissions = 'unavailable'; delete data.registrations; delete data.admissions;
    revisions.registration = revisions.applications = revisions.admissions = null;
  }
  const needs = {unlinked_source: names, duplicate: ['contacts', 'registrations', 'admissions'], attending_unintegrated: ['contacts', 'invitations', 'admissions'],
    email_mismatch: ['contacts', 'registrations'], publication: ['contacts', 'content'], lodging: ['contacts', 'registrations', 'admissions'], legacy_work: ['content'], event_facts: ['content']};
  const counts = Object.fromEntries(PEOPLE_HEALTH_KINDS.map(key => [key, needs[key].every(name => availability[name] === 'available') ? 0 : null]));
  const issues = [];
  const add = (type, key, label, reasonCode, reason, href, personKey = null) => {
    if (counts[type] === null) return;
    counts[type]++; issues.push({id: type + ':' + key, kind: type, label, reasonCode, reason, href, personKey, sourceRevisions: {...revisions}});
  };
  const contacts = data.contacts?.contacts ?? [], registrations = data.registrations?.registrations ?? [], groups = data.admissions?.personGroups ?? [];
  const contactMap = new Map(contacts.map(row => [row.id, row])), registrationMap = new Map(registrations.map(row => [row.id, row]));
  if (counts.unlinked_source !== null) {
    for (const link of data.invitations.conversions) if (!contactMap.has(link.sourceContactId) || !registrationMap.has(link.registrationId)) add('unlinked_source', link.sourceContactId, contactMap.get(link.sourceContactId)?.profile.name || '来源关联待核对', 'BROKEN_CONVERSION', '原来源或报名关联无法找到。', personHref(link.sourceContactId, null), 'contact:' + link.sourceContactId);
    for (const guest of data.content.content.guests ?? []) if (guest.contactId && !contactMap.has(guest.contactId)) add('unlinked_source', 'guest-' + guest.id, guest.name || '嘉宾资料', 'BROKEN_GUEST_LINK', '关联人员已不存在。', '/admin/content/guests/#guest=' + encodeURIComponent(guest.id));
    for (const record of registrations) if (record.provenance.kind === 'staff_assisted' && !contactMap.has(record.provenance.sourceContactId)) add('unlinked_source', 'registration-' + record.id, record.fields.name, 'BROKEN_ORIGINAL_SOURCE', '原报名的联络来源无法找到。', personHref(null, record.id), 'registration:' + record.id);
    for (const group of groups) if (group.contactIds.some(id => !contactMap.has(id)) || group.registrationIds.some(id => !registrationMap.has(id))) add('unlinked_source', group.id, '人员来源', 'BROKEN_PERSON_GROUP', '已整合人员的来源需要核对。', '/admin/contacts/#people=all', group.primaryKey);
  }
  if (counts.duplicate !== null) {
    const source = duplicateSources(data.contacts, data.registrations, data.admissions), candidates = peopleDuplicateCandidates(source.rows, source.canonical);
    for (const group of groups) if (data.admissions.people.filter(person => group.registrationIds.includes(person.registrationId) && person.status === 'confirmed').length > 1) add('duplicate', group.id, '同一人员的名额', 'MULTIPLE_CONFIRMED', '已关联人员存在多个有效名额。', '/admin/contacts/#people=all', group.primaryKey);
    for (const pair of candidates.candidates) add('duplicate', pair.keys.join(':'), pair.rows.map(row => row.name).join(' / '), 'POSSIBLE_DUPLICATE', '资料相似，请人工核对身份。', '/admin/contacts/#people=all', pair.keys[0]);
    if (candidates.truncated) counts.duplicate = null;
  }
  if (counts.attending_unintegrated !== null) for (const contact of contacts) {
    const group = personGroupFor(data.admissions, {contactId: contact.id});
    if (contact.operations.responseStatus === 'attending' && !group?.registrationIds.length && !data.invitations.conversions.some(link => link.sourceContactId === contact.id)) add('attending_unintegrated', contact.id, contact.profile.displayName || contact.profile.name, 'ATTENDING_WITHOUT_REGISTRATION', '已答应出席，尚未关联报名。', personHref(contact.id, null), 'contact:' + contact.id);
  }
  if (counts.email_mismatch !== null) for (const record of registrations) if (record.provenance.kind === 'staff_assisted') {
    const original = contactMap.get(record.provenance.sourceContactId);
    if (!original) { counts.email_mismatch = null; continue; }
    if (original.profile.email !== record.fields.email) add('email_mismatch', record.id, record.fields.name, 'CONTACT_EMAIL_CHANGED', '联络邮箱与原报名不同。', personHref(original.id, record.id), 'contact:' + original.id);
  }
  if (counts.publication !== null) for (const contact of contacts) {
    try {
      const view = publicProfileProjection(contact.id, contentSource(data.content), {responseStatus: contact.operations.responseStatus});
      for (const profile of view.profiles) if (profile.published && !profile.publishedMatchesDraft || !profile.published && isContentVisible(profile) && contact.operations.responseStatus === 'attending') add('publication', profile.id, profile.name || contact.profile.name, 'PUBLIC_PROFILE_CHANGED', '出席或公开资料需更新前台。', '/admin/content/guests/#guest=' + encodeURIComponent(profile.id), 'contact:' + contact.id);
    } catch { counts.publication = null; }
  }
  if (counts.lodging !== null) {
    const checked = new Set();
    for (const contact of contacts) {
      const group = personGroupFor(data.admissions, {contactId: contact.id}), linked = registrations.filter(row => group?.registrationIds.includes(row.id) || row.provenance.sourceContactId === contact.id);
      if ((contact.sourceProfile ?? contact.profile).accommodationIntent === 'needed' && !linked.some(row => ['approved', 'declined'].includes(row.review?.accommodationStatus))) {
        const key = group?.primaryKey ?? 'contact:' + contact.id;
        if (!checked.has(key)) add('lodging', key, contact.profile.displayName || contact.profile.name, contact.sourceProfile ? 'ORIGINAL_LODGING_NEEDED' : 'LEGACY_LODGING_SOURCE', contact.sourceProfile ? '原问卷有住宿需求，待核对。' : '旧记录有住宿需求，原件待核对。', personHref(contact.id, null), key);
        checked.add(key);
      }
    }
    for (const record of registrations) if (record.fields.accommodationChoice === 'needed' && ['requested', 'pending'].includes(record.review?.accommodationStatus) && !contacts.some(contact => (contact.sourceProfile ?? contact.profile).accommodationIntent === 'needed' && (record.provenance.sourceContactId === contact.id || personGroupFor(data.admissions, {contactId: contact.id})?.registrationIds.includes(record.id)))) add('lodging', record.id, record.fields.name, 'LODGING_REQUEST_PENDING', '住宿需求待核对。', personHref(null, record.id), 'registration:' + record.id);
    if (contacts.some(contact => !contact.sourceProfile)) counts.lodging = null;
  }
  if (counts.legacy_work !== null) for (const work of data.content.content.showcases ?? []) if (work.kind === 'team') add('legacy_work', work.id, work.title || work.teamName || '旧作品', 'LEGACY_WORK_KIND', '旧作品分类待核对。', '/admin/content/showcases/#showcase=' + encodeURIComponent(work.id));
  if (counts.event_facts !== null) {
    const facts = assessPublishedEventFacts(data.content.published);
    if (!facts.ready) add('event_facts', 'event', '活动资料', facts.reason, '公开活动资料待核对。', '/admin/content/event/');
  }
  const selected = issues.filter(item => kind === 'all' || item.kind === kind), truncated = selected.length > limit || counts.duplicate === null && availability.contacts === 'available' && availability.registrations === 'available' && availability.admissions === 'available';
  return {schemaVersion: 1, availability, revisions, counts, issues: selected.slice(0, limit), total: Object.values(counts).some(value => value === null) ? null : selected.length, truncated};
}
