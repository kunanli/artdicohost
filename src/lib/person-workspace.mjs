const CONTACT = /^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/u;
const REGISTRATION = /^[A-Za-z0-9_-]{43}$/u;
const STATES = new Set(['available', 'unlinked', 'restricted', 'unavailable']);
const VOLUNTEER_ISSUES = new Set(['SOURCE_UNAVAILABLE', 'SOURCE_INELIGIBLE', 'DUPLICATE_PERSON', 'VOLUNTEER_INACTIVE',
  'VOLUNTEER_NOT_CONFIRMED', 'ADMISSION_NOT_CONFIRMED', 'SHIFT_CANCELLED', 'POSITION_INACTIVE',
  'CONTENT_LINK_INVALID', 'OUTSIDE_AVAILABILITY', 'TIME_CONFLICT', 'SHIFT_OVER_CAPACITY']);
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
const wellFormed = value => { for (const character of value) { const point = character.codePointAt(0); if (point >= 0xd800 && point <= 0xdfff) return false; } return true; };
const text = (value, max = 4000) => typeof value === 'string' && value.length <= max * 2 && wellFormed(value) && [...value].length <= max && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value);
const list = (value, max = 200) => Array.isArray(value) && value.length <= max;
const strings = (value, max = 200) => list(value, max) && value.every(item => text(item, 300));
const integer = value => Number.isSafeInteger(value) && value >= 0;
const date = value => value === null || text(value, 80) && (value === '' || Number.isFinite(Date.parse(value)));
const id = value => text(value, 100) && /^[A-Za-z0-9][A-Za-z0-9_-]{0,99}$/u.test(value);
const nullableId = (value, rule) => value === null || typeof value === 'string' && rule.test(value);
const lines = (value, keys) => plain(value) && keys.every(key => text(value[key]));
const volunteerTime = value => typeof value === 'string' && /^(?:[01]\d|2[0-3]):[0-5]\d$/u.test(value);

function personOrganizations(value) {
  const section = Object.hasOwn(value, 'organizations'), state = Object.hasOwn(value.availability, 'organizations');
  if (!section && !state) return { state: 'unavailable', memberships: [] };
  if (!section || !state || !plain(value.organizations) || !STATES.has(value.organizations.state)
    || value.availability.organizations !== value.organizations.state || !list(value.organizations.memberships, 20)) return null;
  const source = value.organizations, seen = new Set(), memberships = [];
  if (source.state !== 'available' && source.memberships.length || source.state === 'available' && !source.memberships.length
    || source.state === 'available' && (!value.permissions.arrangements || value.availability.contact !== 'available')
    || source.state === 'restricted' && value.permissions.arrangements) return null;
  for (const item of source.memberships) {
    if (!plain(item) || !CONTACT.test(item.organizationId ?? '') || seen.has(item.organizationId) || !['lead', 'member'].includes(item.role)
      || !text(item.title, 120) || /[\r\n\t]/u.test(item.title) || !text(item.name, 160) || /[\r\n\t]/u.test(item.name) || typeof item.missing !== 'boolean'
      || item.missing && (item.name !== '' || item.organizationStatus !== 'missing' || item.participation !== '')
      || !item.missing && (!item.name.trim() || !['pending', 'confirmed', 'withdrawn'].includes(item.organizationStatus) || !['undecided', 'exhibitor', 'attendee'].includes(item.participation))) return null;
    seen.add(item.organizationId);
    memberships.push(Object.fromEntries(['organizationId', 'name', 'role', 'title', 'organizationStatus', 'participation', 'missing'].map(key => [key, item[key]])));
  }
  return { state: source.state, memberships };
}

function personVolunteers(value) {
  const supplied = [Object.hasOwn(value, 'volunteers'), Object.hasOwn(value.permissions, 'volunteers'),
    Object.hasOwn(value.availability, 'volunteers'), Object.hasOwn(value.revisions, 'volunteers')];
  // Older saved/browser fixtures remain readable; no missing source is called empty.
  if (supplied.every(present => !present)) return { permission: false, state: 'unavailable', revision: null, value: { revision: null, entries: [] } };
  if (supplied.some(present => !present)) return null;
  const permission = value.permissions.volunteers, state = value.availability.volunteers, revision = value.revisions.volunteers, source = value.volunteers;
  if (typeof permission !== 'boolean' || !STATES.has(state) || !plain(source) || !list(source.entries, 500)
    || !(revision === null || integer(revision)) || source.revision !== revision
    || !permission && state !== 'restricted' || permission && state === 'restricted'
    || ['restricted', 'unavailable'].includes(state) && (revision !== null || source.entries.length)
    || ['available', 'unlinked'].includes(state) && !integer(revision)
    || state === 'available' && !source.entries.length || state === 'unlinked' && source.entries.length) return null;
  const entryIds = new Set(), assignmentIds = new Set(), entries = [];
  for (const entry of source.entries) {
    if (!plain(entry) || !CONTACT.test(entry.id ?? '') || entryIds.has(entry.id)
      || !['pending', 'invited', 'confirmed', 'declined', 'inactive'].includes(entry.workflowStatus)
      || !list(entry.availability, 12) || !entry.availability.every(window => plain(window) && volunteerTime(window.start) && volunteerTime(window.end) && window.end > window.start)
      || !list(entry.assignments, 1000)) return null;
    entryIds.add(entry.id);
    const assignments = [];
    for (const item of entry.assignments) {
      if (!plain(item) || !CONTACT.test(item.id ?? '') || assignmentIds.has(item.id) || assignmentIds.size >= 1000
        || !['proposed', 'confirmed', 'cancelled'].includes(item.status) || !CONTACT.test(item.shiftId ?? '') || !CONTACT.test(item.positionId ?? '')
        || !text(item.positionName, 200) || !['A', 'B', 'C', 'other'].includes(item.zone) || !text(item.location, 300)
        || !volunteerTime(item.start) || !volunteerTime(item.end) || item.end <= item.start || !['active', 'cancelled'].includes(item.shiftStatus)
        || typeof item.eligible !== 'boolean' || !list(item.issues, VOLUNTEER_ISSUES.size)
        || !item.issues.every(issue => VOLUNTEER_ISSUES.has(issue)) || new Set(item.issues).size !== item.issues.length) return null;
      assignmentIds.add(item.id);
      assignments.push(Object.fromEntries(['id', 'status', 'shiftId', 'positionId', 'positionName', 'zone', 'location', 'start', 'end', 'shiftStatus', 'eligible'].map(key => [key, item[key]])));
      assignments.at(-1).issues = [...item.issues];
    }
    entries.push({ id: entry.id, workflowStatus: entry.workflowStatus, availability: entry.availability.map(window => ({ start: window.start, end: window.end })), assignments });
  }
  return { permission, state, revision, value: { revision, entries } };
}

/** Fragment links contain only an explicit stable record ID, never search/name matching. */
export function parsePersonSelection(hash) {
  if (typeof hash !== 'string') return null;
  const match = hash.match(/^#(contact|registration)=([^&?#]+)$/u);
  if (!match) return null;
  try {
    const value = decodeURIComponent(match[2]);
    return (match[1] === 'contact' ? CONTACT : REGISTRATION).test(value) ? { kind: match[1], id: value } : null;
  } catch { return null; }
}

export function personWorkspacePath(selection) {
  if (!selection || !(selection.kind === 'contact' ? CONTACT : selection.kind === 'registration' ? REGISTRATION : /$a/u).test(selection.id ?? '')) return null;
  return '/api/admin/people/' + (selection.kind === 'contact' ? 'contacts/' : 'registrations/') + encodeURIComponent(selection.id);
}

/** Reject an unrelated/partial response rather than showing another person's last successful view. */
export function personWorkspaceView(value, selection) {
  try {
    if (!plain(value) || value.schemaVersion !== 1 || !plain(value.selected) || !personWorkspacePath(selection)
      || value.selected.kind !== selection.kind || value.selected.id !== selection.id
      || !lines(value.person, ['name', 'displayName', 'organization', 'position', 'city'])
      || !plain(value.linkage) || !['linked', 'unlinked', 'restricted', 'unavailable'].includes(value.linkage.state)
      || !nullableId(value.linkage.contactId, CONTACT) || !nullableId(value.linkage.registrationId, REGISTRATION)
      || !plain(value.permissions) || !['contact', 'registration', 'invitations', 'confirmations', 'arrangements'].every(key => typeof value.permissions[key] === 'boolean')
      || !plain(value.availability) || !['contact', 'registration', 'admission', 'arrangements', 'invitations', 'confirmations', 'publicProfile'].every(key => STATES.has(value.availability[key]))
      || !plain(value.revisions) || !['contacts', 'content', 'invitations', 'registration', 'admission', 'confirmations'].every(key => value.revisions[key] === null || integer(value.revisions[key]))) return null;
    const { contact, registration, admission, arrangements, communications, publicProfile } = value;
    if (value.availability.contact === 'available') {
      if (!plain(contact) || !CONTACT.test(contact.id ?? '') || !lines(contact.profile, ['name', 'displayName', 'organization', 'position', 'city', 'email', 'wechat', 'phone', 'contactConsent'])
        || !strings(contact.profile.categories) || !strings(contact.profile.interests)
        || !lines(contact.operations, ['owner', 'priority', 'followUpAt', 'responseStatus']) || !text(contact.operations.notes, 6000)
        || !strings(contact.operations.participationForms) || !strings(contact.operations.sessionIds) || !strings(contact.operations.boothIds)
        || !list(contact.operations.sessionRoles) || !contact.operations.sessionRoles.every(item => plain(item) && id(item.sessionId) && strings(item.roles, 10))
        || value.linkage.contactId !== contact.id) return null;
    } else if (contact !== null) return null;
    if (value.availability.registration === 'available') {
      if (!plain(registration) || !REGISTRATION.test(registration.id ?? '') || !text(registration.referenceCode, 128) || !date(registration.submittedAt)
        || !lines(registration.provenance, ['kind']) || !lines(registration.fields, ['name', 'organization', 'position', 'city', 'email', 'wechat', 'phone', 'attendance', 'accommodationChoice'])
        || !strings(registration.fields.categories) || !strings(registration.fields.participationInterests)
        || !lines(registration.review, ['status', 'accommodationStatus', 'assignedTo', 'nextStep', 'invitationStatus']) || typeof registration.review.deletionRequested !== 'boolean'
        || value.linkage.registrationId !== registration.id) return null;
    } else if (registration !== null) return null;
    if (selection.kind === 'contact' ? contact?.id !== selection.id : registration?.id !== selection.id) return null;
    for (const key of ['contact', 'registration', 'arrangements', 'invitations', 'confirmations']) if (value.availability[key] === 'available' && !value.permissions[key]) return null;
    if (value.availability.admission === 'available') {
      if (!plain(admission) || !['confirmed', 'waitlisted', 'withdrawn'].includes(admission.status) || !['attendee', 'crew'].includes(admission.kind) || !integer(admission.revision)) return null;
    } else if (admission !== null) return null;
    if (!plain(arrangements) || !list(arrangements.sessions, 250) || !list(arrangements.booths)
      || !arrangements.sessions.every(item => lines(item, ['id', 'title', 'start', 'end', 'zone', 'status']) && id(item.id) && strings(item.roles, 10) && typeof item.missing === 'boolean')
      || !arrangements.booths.every(item => lines(item, ['id', 'code', 'organization', 'project', 'status', 'position']) && id(item.id) && typeof item.missing === 'boolean')) return null;
    if (value.availability.arrangements !== 'available' && (arrangements.sessions.length || arrangements.booths.length)) return null;
    if (!plain(communications) || communications.historyLimit !== 200 || !['invitationTotal', 'confirmationTotal', 'timelineTotal'].every(key => integer(communications[key])) || typeof communications.historyTruncated !== 'boolean'
      || !list(communications.invitations) || !list(communications.confirmations) || !list(communications.timeline)
      || !communications.invitations.every(item => lines(item, ['id', 'channel', 'status']) && (item.sentChannel === null || text(item.sentChannel, 100)) && date(item.createdAt) && date(item.updatedAt))
      || !communications.confirmations.every(item => lines(item, ['id', 'kind', 'status', 'admissionStatus']) && integer(item.attempt) && date(item.createdAt) && date(item.updatedAt))
      || !communications.timeline.every(item => lines(item, ['source', 'id', 'status', 'channel']) && ['invitation', 'confirmation', 'legacy_invitation'].includes(item.source) && (item.kind === null || text(item.kind, 100)) && date(item.at))) return null;
    if ((value.availability.invitations !== 'available' && communications.invitations.length) || (value.availability.confirmations !== 'available' && communications.confirmations.length)) return null;
    if (communications.invitationTotal < communications.invitations.length || communications.confirmationTotal < communications.confirmations.length || communications.timelineTotal < communications.timeline.length) return null;
    // Historical manual invitation entries belong to the contact journal, which
    // may be available even when the separate invitation service cannot be read.
    if (communications.timeline.some(item => value.availability[item.source === 'legacy_invitation' ? 'contact' : item.source === 'confirmation' ? 'confirmations' : 'invitations'] !== 'available')) return null;
    if (!plain(publicProfile) || publicProfile.state !== value.availability.publicProfile || !list(publicProfile.profiles)
      || !publicProfile.profiles.every(item => lines(item, ['id', 'name', 'company', 'title']) && id(item.id) && ['pending', 'confirmed'].includes(item.status)
        && typeof item.publicConsent === 'boolean' && typeof item.hasPortrait === 'boolean' && typeof item.published === 'boolean' && typeof item.publishedMatchesDraft === 'boolean' && strings(item.publicRoles, 10))
      || !(publicProfile.publishedRevision === null || integer(publicProfile.publishedRevision)) || !date(publicProfile.publishedAt)
      || publicProfile.state !== 'available' && publicProfile.profiles.length) return null;
    const volunteering = personVolunteers(value);
    const organizations = personOrganizations(value);
    if (!volunteering || !organizations) return null;
    // Only the fields below reach the DOM. API additions cannot silently become UI/private links.
    return { schemaVersion: 1, selected: { ...value.selected }, person: { ...value.person }, linkage: { ...value.linkage }, permissions: { ...value.permissions, volunteers: volunteering.permission },
      availability: { ...value.availability, volunteers: volunteering.state, organizations: organizations.state }, revisions: { ...value.revisions, volunteers: volunteering.revision },
      contact, registration, admission, arrangements, communications, publicProfile, organizations, volunteers: volunteering.value };
  } catch { return null; }
}

export const personAvailabilityText = state => ({ restricted: '此账号没有读取这部分资料的权限。', unavailable: '这部分已保存资料暂时无法核对，请稍后重新读取。', unlinked: '尚未关联这部分记录。' })[state] ?? '';

export function personWorkspaceActions(view, roles = []) {
  const actions = [];
  const contactId = view?.availability?.contact === 'available' && view.contact?.id;
  const registrationId = view?.availability?.registration === 'available' && view.registration?.id;
  if (contactId && view.permissions.contact && roles.includes('outreach')) {
    actions.push({ key: 'profile', label: '编辑联络资料', href: '/admin/contacts/#profile=' + encodeURIComponent(contactId) });
    actions.push({ key: 'arrangements', label: '跟进与活动安排', href: '/admin/contacts/#contact=' + encodeURIComponent(contactId) });
    if (view.contact.profile.contactConsent === 'consented' && view.contact.operations.responseStatus !== 'declined'
      && (view.linkage.state === 'unlinked' || view.admission?.status === 'confirmed')) actions.push({ key: 'invitation', label: '准备邀请函', href: '/admin/contacts/#invitation=' + encodeURIComponent(contactId) });
    if (roles.includes('editor') && view.contact.profile.contactConsent === 'consented' && view.contact.operations.responseStatus !== 'declined') actions.push({ key: 'guest', label: '管理公开嘉宾资料', href: '/admin/#invitee=' + encodeURIComponent(contactId) });
  }
  if (registrationId && view.permissions.registration) actions.push({ key: 'review', label: '核查报名与住宿', href: '/admin/registrations/#registration=' + encodeURIComponent(registrationId) });
  if (view.permissions.volunteers && (roles.includes('superadmin') || roles.includes('outreach') && roles.includes('reviewer'))) {
    const source = view.selected.kind === 'registration' && registrationId ? { kind: 'registration', id: registrationId }
      : contactId ? { kind: 'contact', id: contactId } : null;
    if (source) actions.push({ key: 'volunteers', label: '志愿者与分工', href: '/admin/volunteers/#' + source.kind + '=' + encodeURIComponent(source.id) });
  }
  if (roles.includes('superadmin')) actions.push({ key: 'settings', label: '设置与通知', href: '/admin/settings/' });
  return actions;
}

/** A guide from saved facts, never a workflow transition or inferred attendee reply. */
export function personWorkspaceSteps(view, roles = []) {
  const actions = new Map(personWorkspaceActions(view, roles).map(action => [action.key, action]));
  const step = (key, label, state, detail, action) => ({ key, label, state, detail, action: actions.get(action) ?? null });
  const unavailable = key => view.availability[key] === 'restricted' ? 'restricted' : 'review';
  const contact = view.contact, operations = contact?.operations, forms = operations?.participationForms ?? [];
  const consent = contact?.profile.contactConsent;
  const steps = [contact
    ? step('intent', '核对原始意向', ['consented', 'declined'].includes(consent) ? 'complete' : 'pending', consent === 'consented' ? '已记录联络许可；原始身份与意向继续保留，不替代当前安排。' : consent === 'declined' ? '已记录不同意联络，请停止邀约。' : '先查看原始身份、参与意向与联络许可，不按同名自动合并。', 'arrangements')
    : step('intent', '核对原始意向', unavailable('contact'), personAvailabilityText(view.availability.contact), 'review')];
  if (contact) {
    const response = operations.responseStatus;
    const unknownSend = view.communications.timeline.some(entry => ['unknown', 'reserved'].includes(entry.status));
    const contacted = view.communications.timeline.some(entry => ['manually_sent', 'sent', 'provider_accepted'].includes(entry.status));
    steps.push(step('reply', '联络与本人回复', response === 'attending' || response === 'declined' || consent === 'declined' ? 'complete' : unknownSend ? 'review' : 'pending',
      response === 'attending' ? '已保存本人答应出席；参会名额仍单独核对。' : response === 'declined' || consent === 'declined' ? '已记录拒绝联络或出席，请停止邀约。' : unknownSend ? '存在发送结果待核对的记录，请先核对，再继续跟进。' : contacted ? '已有发出或服务商接受记录，仍待本人回复；不代表邮件已送达。' : '先核实联络许可并发出邀请，再保存实际回复；名额已确认也不代表本人答应。', 'arrangements'));
    steps.push(step('roles', '确认参与身份', forms.length ? 'complete' : 'pending', forms.length ? '已保存内部活动职责；讲者、组织者等可在「详情与安排」调整。' : '按本人协商结果选择一般参与、嘉宾、讲者、组织者等职责，可多选。', 'arrangements'));
  } else {
    for (const [key, label] of [['reply', '联络与本人回复'], ['roles', '确认参与身份']]) steps.push(step(key, label, unavailable('contact'), personAvailabilityText(view.availability.contact), 'review'));
  }
  if (!contact || view.availability.arrangements !== 'available') steps.push(step('arrangements', '安排场次／展位', unavailable(contact ? 'arrangements' : 'contact'), personAvailabilityText(view.availability[contact ? 'arrangements' : 'contact']), 'arrangements'));
  else {
    const needsSession = forms.some(value => ['speaker', 'panelist', 'host', 'organizer'].includes(value));
    const needsBooth = forms.includes('booth'), needsShowcase = forms.includes('student_showcase');
    const sessions = view.arrangements.sessions.filter(item => !item.missing && item.status === 'scheduled');
    const booths = view.arrangements.booths.filter(item => !item.missing && item.status !== 'cancelled');
    const missing = view.arrangements.sessions.some(item => item.missing || item.status === 'cancelled') || view.arrangements.booths.some(item => item.missing || item.status === 'cancelled');
    const scheduledRoleMissing = forms.filter(value => ['speaker', 'panelist', 'host', 'organizer'].includes(value)).some(role => !sessions.some(item => item.roles.includes(role)));
    const pending = !forms.length || needsSession && (!sessions.length || scheduledRoleMissing) || needsBooth && !booths.length || needsShowcase && !sessions.length && !booths.length;
    const detail = missing ? '已关联的场次或展位有取消／缺失记录，请核对保留的关联。' : !forms.length ? '先确认参与身份，再按需要安排场次或展位。' : !needsSession && !needsBooth && !needsShowcase ? '当前职责不要求讲者场次或展位；一般参与者可直接参加公开活动。' : pending ? '按已选职责关联对应场次、该场职责或展位，确认草稿安排已排期。' : '已关联对应场次职责／展位；可继续核对内容与时段。';
    steps.push(step('arrangements', '安排场次／展位', missing ? 'review' : pending ? 'pending' : 'complete', detail, 'arrangements'));
  }
  const needsPublic = forms.some(value => ['guest', 'speaker', 'panelist', 'host', 'organizer'].includes(value));
  const publicState = view.availability.publicProfile, profiles = view.publicProfile.profiles;
  const published = profiles.filter(item => item.published), currentEligible = profiles.filter(item => item.status === 'confirmed' && item.publicConsent && item.hasPortrait && item.publicRoles.length);
  const unpublished = currentEligible.some(item => !item.published), liveOldDraft = published.some(item => !item.publishedMatchesDraft);
  steps.push(!contact ? step('public', '核对公开资料', unavailable('contact'), personAvailabilityText(view.availability.contact), 'review')
    : publicState === 'restricted' ? step('public', '核对公开资料', 'restricted', personAvailabilityText(publicState))
          : publicState === 'unavailable' ? step('public', '核对公开资料', 'review', '公开资料或已发布快照暂时无法完整核对，请重新读取后确认。', 'guest')
            : liveOldDraft ? step('public', '核对公开资料', 'review', '资料有历史公开版本，当前人员关联及内容待核对；请核对照片、文字、职责及授权，再发布更新。', 'guest')
              : !forms.length ? step('public', '核对公开资料', 'pending', '先确认参与身份，再决定是否需要公开人物资料。', 'arrangements')
                : !needsPublic ? step('public', '核对公开资料', 'complete', '当前内部职责不要求公开人物页；组织展示资料另在活动与内容维护。', 'arrangements')
              : publicState === 'unlinked' || !profiles.length ? step('public', '核对公开资料', 'pending', '尚未通过此人员的固定编号关联公开嘉宾资料；按需要创建并核对公开授权。', 'guest')
                : unpublished || !currentEligible.length ? step('public', '核对公开资料', 'pending', '已有公开资料草稿，仍需核对照片、公开职责、确认状态与授权，并发布活动内容。', 'guest')
                  : step('public', '核对公开资料', 'complete', '已有已发布版本；本次草稿的照片、简介或职责变更仍需核对并发布，不代表最新草稿已同步。', 'guest'));
  return steps;
}
