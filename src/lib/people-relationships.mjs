/** Explicit private relationships. Display strings never become identity keys. */
import { validateStoredContact } from '../../shared/contacts-schema.mjs';
const ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/u, REGISTRATION = /^[A-Za-z0-9_-]{43}$/u;
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const check = value => { if (!value) throw new Error('关系或保存回执暂时无法核对，请重新读取。'); };
const id = value => { check(typeof value === 'string' && ID.test(value)); return value; };
const integer = value => { check(Number.isSafeInteger(value) && value >= 0); return value; };
const text = (value, max) => { check(typeof value === 'string' && value.length <= max * 2 && [...value].length <= max && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\ud800-\udfff]/u.test(value)); return value; };
const choice = (value, values) => { check(values.includes(value)); return value; };
function rows(value, max, map, key = 'id') { check(Array.isArray(value) && value.length <= max); const result = value.map(row => { check(plain(row)); return map(row); }); check(new Set(result.map(row => row[key])).size === result.length); return result; }
const boolean = value => { check(typeof value === 'boolean'); return value; };
export const PUBLIC_ROLE_LABELS = Object.freeze({ speaker: '讲者', guest: '嘉宾', organizer: '研讨会组织者', moderator: '主持人' });
export function peopleRelationships(value) {
  check(plain(value) && value.schemaVersion === 1);
  const contentRevision = integer(value.contentRevision), publishedRevision = value.publishedRevision === null ? null : integer(value.publishedRevision);
  const organizations = rows(value.organizations, 200, row => ({ id: id(row.id), name: text(row.name, 160), status: choice(row.status, ['pending', 'confirmed', 'withdrawn']), participation: choice(row.participation, ['undecided', 'exhibitor', 'attendee']) }));
  const profiles = rows(value.profiles, 200, row => { check(Array.isArray(row.publicRoles) && row.publicRoles.length <= 4 && new Set(row.publicRoles).size === row.publicRoles.length); return { id: id(row.id), contactId: id(row.contactId), publicRoles: row.publicRoles.map(role => choice(role, Object.keys(PUBLIC_ROLE_LABELS))), status: choice(row.status, ['pending', 'confirmed']), publicConsent: boolean(row.publicConsent), hasPortrait: boolean(row.hasPortrait), published: boolean(row.published), publishedMatchesDraft: boolean(row.publishedMatchesDraft) }; });
  const boothOrganizations = rows(value.boothOrganizations, 200, row => ({ boothId: id(row.boothId), organizationId: id(row.organizationId) }), 'boothId');
  check(organizations.every(row=>row.name.trim())&&new Set(profiles.map(row=>row.contactId)).size===profiles.length&&profiles.every(row=>!row.publishedMatchesDraft||row.published)&&(!profiles.some(row=>row.published)||publishedRevision!==null));
  return { schemaVersion: 1, contentRevision, publishedRevision, organizations, profiles, boothOrganizations, publicationAttributionUnavailable: boolean(value.publicationAttributionUnavailable) };
}
export function organizationMemberships(value = []) {
  check(Array.isArray(value) && value.length <= 20); const result = value.map(row => { check(plain(row)); const title=text(row.title,120);check(!/[\r\n\t]/u.test(title));return { organizationId: id(row.organizationId), role: choice(row.role, ['lead', 'member']), title }; }); check(new Set(result.map(row => row.organizationId)).size === result.length); return result;
}
export function relationshipForContact(contact, catalog) {
  const memberships = organizationMemberships(contact.operations.organizationMemberships);
  if (!catalog) return { available: false, memberships: memberships.map(row => ({ ...row, name: '', state: 'unavailable' })), profiles: [], publicationKnown: false };
  return { available: true, memberships: memberships.map(row => { const organization = catalog.organizations.find(item => item.id === row.organizationId); return { ...row, name: organization?.name || row.organizationId, state: !organization ? 'missing' : organization.status === 'withdrawn' ? 'withdrawn' : 'available' }; }), profiles: catalog.profiles.filter(row => row.contactId === contact.id), publicationKnown: !catalog.publicationAttributionUnavailable };
}
export function matchesPeopleRelationships(contact, catalog, { organization = '', publicRole = '', publicState = '' } = {}) {
  if (!catalog) return true;
  const related = relationshipForContact(contact, catalog), profiles = related.profiles;
  if (organization && (organization === '__none' ? related.memberships.length !== 0 : !related.memberships.some(row => row.organizationId === organization))) return false;
  if (publicRole && !profiles.some(row => row.publicRoles.includes(publicRole))) return false;
  if (!publicState) return true;
  return ({ linked: profiles.length > 0, unlinked: profiles.length === 0, published: profiles.some(row => row.published), unpublished: !related.publicationKnown || profiles.length > 0 && profiles.every(row => !row.published), changed: profiles.some(row => row.published && !row.publishedMatchesDraft), no_consent: profiles.some(row => !row.publicConsent), no_portrait: profiles.some(row => !row.hasPortrait) })[publicState] === true;
}
export function parseOrganizationSelection(hash) { if (typeof hash !== 'string' || hash.length > 150) return null; const match = /^#organization=([^&#=]+)$/u.exec(hash); if (!match) return null; try { return id(decodeURIComponent(match[1])); } catch { return null; } }
export function admissionForContact(contact, intent, receipts = new Map()) {
  const linked = intent?.conversions?.find(row => row.sourceContactId === contact.id);
  if (linked) return { status: ['confirmed', 'waitlisted', 'withdrawn'].includes(linked.admissionStatus) ? linked.admissionStatus : 'unavailable', registrationId: linked.registrationId };
  return receipts.get(contact.id) || { status: intent ? 'unlinked' : 'unavailable' };
}
export const ADMISSION_LABELS = Object.freeze({ confirmed: '正式名额已确认', waitlisted: '已登记候补，尚无确认名额', withdrawn: '关联报名已撤回，需审核人员处理', requiresReviewer: '回复已保存，名额待审核同事同步', unavailable: '名额暂时无法核对', unlinked: '尚未关联正式报名' });
export function savedContactReceipt(value, { contactId, expectedRevision, operations } = {}) {
  check(plain(value) && value.replySaved === true && integer(value.revision) === expectedRevision + 1 && validateStoredContact(value.contact) && value.contact.id === contactId && plain(value.contact.operations));
  for (const [key, expected] of Object.entries(operations)) check(JSON.stringify(value.contact.operations[key]) === JSON.stringify(expected));
  let admission = null;
  if (value.contact.operations.responseStatus === 'attending') {
    check(plain(value.admission)); const status = choice(value.admission.status, ['confirmed', 'waitlisted', 'requiresReviewer', 'unavailable']); admission = { status };
    if (['confirmed', 'waitlisted'].includes(status)) { check(typeof value.admission.registrationId === 'string' && REGISTRATION.test(value.admission.registrationId)&&typeof value.admission.referenceCode==='string'&&REGISTRATION.test(value.admission.referenceCode)); admission.registrationId = value.admission.registrationId; admission.revision = integer(value.admission.revision); admission.referenceCode = value.admission.referenceCode; }
  }
  return { revision: value.revision, contact: value.contact, admission };
}
export function conversionPreview(value, contactIds, expectedRevision) {
  check(plain(value) && value.contactRevision === expectedRevision && Array.isArray(value.entries) && value.entries.length === contactIds.length && plain(value.summary));
  const expected = new Set(contactIds); check(expected.size > 0 && expected.size <= 100 && expected.size === contactIds.length);
  const entries = value.entries.map(row => { check(plain(row) && expected.has(row.contactId) && typeof row.eligible === 'boolean'); return { contactId: id(row.contactId), eligible: row.eligible, reason: typeof row.reason === 'string' && /^[A-Z][A-Z0-9_]{0,79}$/u.test(row.reason) ? row.reason : '', warningCount: Array.isArray(row.warnings) ? row.warnings.length : 0 }; }); check(new Set(entries.map(row => row.contactId)).size === entries.length);
  check(value.summary.selected === entries.length && value.summary.eligible === entries.filter(row => row.eligible).length);
  return { entries, eligibleIds: entries.filter(row => row.eligible).map(row => row.contactId), contactRevision: expectedRevision };
}
export function conversionReceipt(value, draft) {
  check(plain(value)&&value.contactRevision===draft.contactRevision&&['completed','partial','unavailable'].includes(value.status));
  const seen=new Set(),known=new Set(draft.eligibleIds);
  for(const key of ['registrations','failures','skipped']){check(Array.isArray(value[key])&&value[key].length<=100);for(const row of value[key]){check(plain(row)&&known.has(row.contactId)&&!seen.has(row.contactId));seen.add(row.contactId);if(key==='registrations')check(REGISTRATION.test(row.registrationId??'')&&REGISTRATION.test(row.referenceCode??''));}}
  check(seen.size===known.size&&value.status===(value.failures.length?value.registrations.length?'partial':'unavailable':'completed'));
  return {status:value.status,registrations:value.registrations.map(row=>({contactId:row.contactId,registrationId:row.registrationId})),failureCount:value.failures.length,skippedCount:value.skipped.length};
}
