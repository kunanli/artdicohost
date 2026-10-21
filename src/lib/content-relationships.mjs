const ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/u;
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const check = value => { if (!value) throw new Error('关联资料未能核对，请重新读取。'); };
const integer = value => Number.isSafeInteger(value) && value >= 0;
function text(value, maximum, required = false) {
  check(typeof value === 'string' && value.isWellFormed() && [...value].length <= maximum && !/[\u0000-\u001f\u007f]/u.test(value) && (!required || value.trim()));
  return value;
}
function identifier(value) { check(typeof value === 'string' && ID.test(value)); return value; }
function pagination(value, count) {
  check(integer(value.total) && value.total <= 5000 && value.total >= count && (value.nextCursor === null || typeof value.nextCursor === 'string' && /^(?:0|[1-9][0-9]{0,4})$/u.test(value.nextCursor) && Number(value.nextCursor) > 0 && Number(value.nextCursor) < value.total));
  check(value.nextCursor === null || count > 0);
  return { total: value.total, nextCursor: value.nextCursor };
}
export const canLinkContentPeople = user => Array.isArray(user?.roles) && user.roles.includes('editor') && user.roles.includes('outreach');
export function contactCandidatePage(value) {
  check(plain(value) && value.schemaVersion === 1 && integer(value.contactsRevision) && Array.isArray(value.candidates) && value.candidates.length <= 200);
  const ids = new Set(), candidates = value.candidates.map(item => {
    check(plain(item) && !ids.has(item.id) && typeof item.eligible === 'boolean'); ids.add(identifier(item.id));
    return { id: item.id, name: text(item.name, 120, true), organization: text(item.organization, 300), eligible: item.eligible };
  });
  return { contactsRevision: value.contactsRevision, candidates, ...pagination(value, candidates.length) };
}
export function organizationMemberPage(value, organizationId) {
  identifier(organizationId);
  check(plain(value) && value.schemaVersion === 1 && value.organizationId === organizationId && integer(value.contentRevision) && integer(value.contactsRevision)
    && Array.isArray(value.members) && value.members.length <= 200);
  const ids = new Set(), members = value.members.map(item => {
    check(plain(item) && !ids.has(item.contactId) && ['lead', 'member'].includes(item.role)); ids.add(identifier(item.contactId));
    return { contactId: item.contactId, name: text(item.name, 120, true), role: item.role, title: text(item.title, 120) };
  });
  return { organizationId, contentRevision: value.contentRevision, contactsRevision: value.contactsRevision, members, ...pagination(value, members.length) };
}
/** Choices come only from the explicitly saved content field, never static names. */
export function organizationChoices(content, selected = '') {
  check(selected === '' || ID.test(selected));
  const rows = Object.hasOwn(content ?? {}, 'organizations') && Array.isArray(content.organizations) ? content.organizations : [];
  check(rows.length <= 200);
  const ids = new Set(), choices = rows.map(item => {
    check(plain(item) && !ids.has(item.id) && ['pending', 'confirmed', 'withdrawn'].includes(item.status)); ids.add(identifier(item.id));
    return { id: item.id, name: text(item.name, 160, true), status: item.status, missing: false };
  });
  if (selected && !ids.has(selected)) choices.unshift({ id: selected, name: '原关联组织暂不可用', status: 'missing', missing: true });
  return choices;
}
/** Opening an older booth and applying unrelated fields must not invent a new key. */
export function boothOrganizationField(previous, selected) {
  check(typeof selected === 'string' && (selected === '' || ID.test(selected)));
  return Object.hasOwn(previous ?? {}, 'organizationId') || selected ? { organizationId: selected } : {};
}
export function personContactPath(id) { return '/admin/person/#contact=' + encodeURIComponent(identifier(id)); }
