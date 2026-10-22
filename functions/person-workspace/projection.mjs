import { PARTICIPATION_FORMS, SESSION_ROLES } from '../../shared/contacts-schema.mjs';
import { GUEST_PUBLIC_ROLES, PORTRAIT_ID_PATTERN, isContentVisible } from '../../shared/content-schema.mjs';
import { parseTimestamp } from '../registration-api/policy.mjs';

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
      || seen.has(item.sourceContactId) || registrations.has(item.registrationId)) fail();
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
  return { revision: value.revision, conversions, invitations };
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
export function publicProfileProjection(contactId, source) {
  if (!source.hasPublished) fail();
  const guests = records(source.content.guests ?? [], CONTACT_ID, 200), published = source.published;
  if (published !== null && (!plain(published) || !plain(published.content))) fail();
  const savedGuests = published === null ? [] : records(published.content.guests, CONTACT_ID, 200);
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
      publishedMatchesDraft: Boolean(draftPublic && savedPublic && JSON.stringify(draftPublic) === JSON.stringify(savedPublic)) };
  });
  const orphanedPublication = !profiles.length && savedGuests.some(saved => !guests.some(item => item.id === saved.id));
  return { state: orphanedPublication ? 'unavailable' : profiles.length ? 'available' : 'unlinked', profiles, publishedRevision, publishedAt };
}
export function arrangementsProjection(contact, source) {
  const linkedGuestIds = records(source.content.guests ?? [], CONTACT_ID, 200).filter(item => item.contactId === contact.id).map(item => item.id);
  const sessionIds = [...new Set([...contact.operations.sessionIds,
    ...source.content.sessions.filter(item => linkedGuestIds.includes(item.guestId)).map(item => item.id)])];
  const sessions = sessionIds.map(id => {
    const item = source.content.sessions.find(entry => entry.id === id), roles = contact.operations.sessionRoles.find(entry => entry.sessionId === id)?.roles ?? [];
    return { id, title: text(item?.title, 200), start: text(item?.start, 5), end: text(item?.end, 5), zone: text(item?.zone, 1),
      status: item ? oneOf(item.status, ['draft', 'scheduled', 'cancelled']) : 'missing', roles, missing: !item };
  });
  const booths = contact.operations.boothIds.map(id => {
    const item = source.content.booths.find(entry => entry.id === id);
    if (item?.slotNumber !== undefined && (!Number.isSafeInteger(item.slotNumber) || item.slotNumber < 0 || item.slotNumber > 15)) fail();
    return { id, code: text(item?.code, 20), organization: text(item?.organization, 200), project: text(item?.project, 200),
      position: item?.slotNumber ? String(item.slotNumber) : '', status: item ? oneOf(item.status, ['pending', 'confirmed', 'cancelled']) : 'missing', missing: !item };
  });
  return { sessions, booths };
}
export function confirmationsSource(value) {
  if (!plain(value)) fail();
  const notices = records(value.notices, CONTACT_ID, 2000).map(item => ({ id: item.id,
    kind: oneOf(item.kind, ['registration', 'promotion']), status: oneOf(item.status, ['reserved', 'provider_accepted', 'rejected', 'unknown']) === 'reserved' ? 'unknown' : item.status,
    admissionStatus: oneOf(item.admissionStatus, ['confirmed', 'waitlisted']), attempt: revisionValue(item.attempt),
    createdAt: timestamp(item.createdAt, false), updatedAt: timestamp(item.updatedAt, false) }));
  return { revision: revisionValue(value.revision), notices };
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
  const invitations = (intent?.invitations ?? []).filter(item => item.sourceContactId === contactId && item.registrationId === registrationId)
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
    historyTruncated: invitations.length > HISTORY_LIMIT || notices.length > HISTORY_LIMIT || timeline.length > HISTORY_LIMIT,
    invitations: invitations.slice(0, HISTORY_LIMIT), confirmations: notices.slice(0, HISTORY_LIMIT), timeline: timeline.slice(0, HISTORY_LIMIT) };
}

export function personPermissions(actor) {
  const roles = Array.isArray(actor?.roles) ? actor.roles : [];
  const contact = roles.includes('superadmin') || roles.includes('outreach'), registration = roles.includes('superadmin') || roles.includes('reviewer');
  return { contact, registration, invitations: contact, confirmations: registration, arrangements: contact,
    volunteers: roles.includes('superadmin') || roles.includes('outreach') && roles.includes('reviewer') };
}
