import { contentSchema } from './content-schema.mjs';
import { PARTICIPATION_FORMS } from './contacts-schema.mjs';

const CAPACITY = 15;
const ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/u;
const PRESENTATIONS = new Set(['talk', 'workshop', 'roundtable', 'showcase']);
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value)
  && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const own = (value, key) => {
  if (!plain(value)) throw new TypeError('安排资料格式无效。');
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (!descriptor) return undefined;
  if (!('value' in descriptor)) throw new TypeError('安排资料不可含存取器。');
  return descriptor.value;
};
function list(value, max, optional = false) {
  if (optional && value === undefined) return [];
  if (!Array.isArray(value) || value.length > max) throw new TypeError('安排资料数组无效。');
  for (let index = 0; index < value.length; index++) {
    const field = Object.getOwnPropertyDescriptor(value, String(index));
    if (!field || !('value' in field) || !plain(field.value)) throw new TypeError('安排资料数组无效。');
  }
  return value;
}
function text(value, max = 300) {
  if (value === undefined) return '';
  if (typeof value !== 'string' || [...value].length > max) throw new TypeError('安排显示资料无效。');
  return value;
}
function id(value, optional = false) {
  if (optional && (value === undefined || value === '')) return '';
  if (typeof value !== 'string' || !ID.test(value)) throw new TypeError('安排关联标识无效。');
  return value;
}
function status(value, allowed, fallback) {
  if (value === undefined && fallback !== undefined) return fallback;
  if (!allowed.includes(value)) throw new TypeError('安排状态无效。');
  return value;
}
function identifiers(value) {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 50 || Array.from(value).some(item => typeof item !== 'string' || !ID.test(item))) throw new TypeError('人员安排关联无效。');
  return [...new Set(value)];
}
function forms(value, allowed = PARTICIPATION_FORMS) {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > allowed.length || Array.from(value).some(item => !allowed.includes(item)) || new Set(value).size !== value.length) throw new TypeError('参与形式无效。');
  return [...value];
}
function indexed(items) {
  const result = new Map();
  for (const item of items) { if (result.has(item.id)) throw new TypeError('安排记录标识重复。'); result.set(item.id, item); }
  return result;
}
const byId = (a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
const bySession = (a, b) => a.start.localeCompare(b.start) || a.end.localeCompare(b.end) || a.zone.localeCompare(b.zone) || byId(a, b);
function timeRange(item) {
  if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/u.test(item.start) || !/^(?:[01]\d|2[0-3]):[0-5]\d$/u.test(item.end) || item.end <= item.start) return null;
  return [Number(item.start.slice(0, 2)) * 60 + Number(item.start.slice(3)), Number(item.end.slice(0, 2)) * 60 + Number(item.end.slice(3))];
}

/** Private saved-record projection only. The API owns editor+outreach authorization.
 * Revisions describe two independently read stores; this is not an atomic snapshot,
 * a public projection, attendance registration, or a deduplicated student check-in.
 */
export function buildArrangementOverview({ content, contacts, contentRevision, contactsRevision } = {}) {
  if (!plain(content) || ![contentRevision, contactsRevision].every(value => Number.isSafeInteger(value) && value >= 0)) throw new TypeError('请提供已保存资料及各自修订号。');
  const warningIndex = new Map();
  function warn(target, code, recordId, message) {
    const warning = { code, recordId, message };
    const key = code + '\0' + recordId + '\0' + message;
    if (!warningIndex.has(key)) warningIndex.set(key, warning);
    if (target && !target.some(item => item.code === code && item.recordId === recordId && item.message === message)) target.push(warning);
  }
  const sessions = list(own(content, 'sessions'), 200).map(item => ({
    id: id(own(item, 'id')), start: text(own(item, 'start'), 30), end: text(own(item, 'end'), 30),
    zone: status(own(item, 'zone'), contentSchema.zones), title: text(own(item, 'title'), 200),
    format: status(own(item, 'format'), contentSchema.sessionFormats, 'other'),
    status: status(own(item, 'status'), contentSchema.sessionStatuses), guestId: id(own(item, 'guestId'), true),
    speakerName: text(own(item, 'speakerName'), 120), speakerStatus: status(own(item, 'speakerStatus'), contentSchema.speakerStatuses, 'pending'),
  }));
  const booths = list(own(content, 'booths'), 200).map(item => {
    const suppliedSlot = own(item, 'slotNumber'), slotNumber = suppliedSlot === undefined ? 0 : suppliedSlot;
    if (!Number.isInteger(slotNumber) || slotNumber < 0 || slotNumber > CAPACITY) throw new TypeError('展位位置无效。');
    const projection = { id: id(own(item, 'id')), code: text(own(item, 'code'), 16), zone: status(own(item, 'zone'), ['C']),
      organization: text(own(item, 'organization'), 160), project: text(own(item, 'project'), 200),
      status: status(own(item, 'status'), contentSchema.boothStatuses), slotNumber };
    for (const [name, maximum] of Object.entries({ contactName: 120, contactMethods: 500, description: 2000 })) {
      if (!Object.hasOwn(item, name)) continue;
      const value = own(item, name);
      const controls = name === 'contactName' ? /[\u0000-\u001f\u007f]/u : /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u;
      if (typeof value !== 'string' || controls.test(value)) throw new TypeError('展位负责人与内容资料无效。');
      projection[name] = text(value, maximum);
    }
    return projection;
  });
  const guests = list(own(content, 'guests'), 200, true).map(item => ({ id: id(own(item, 'id')), name: text(own(item, 'name'), 120),
    company: text(own(item, 'company'), 160), status: status(own(item, 'status'), contentSchema.guestStatuses, 'pending'), contactId: id(own(item, 'contactId'), true) }));
  const teams = list(own(content, 'showcases'), 200, true).map(item => {
    const memberCount = own(item, 'memberCount') ?? 1;
    if (!Number.isInteger(memberCount) || memberCount < 1 || memberCount > 50) throw new TypeError('团队填报人数无效。');
    return { id: id(own(item, 'id')), title: text(own(item, 'title'), 200), teamName: text(own(item, 'teamName'), 160), memberCount,
      responseStatus: status(own(item, 'responseStatus'), contentSchema.responseStatuses, 'pending'), status: status(own(item, 'status'), contentSchema.showcaseStatuses, 'pending'),
      participationForms: forms(own(item, 'participationForms'), ['booth', 'share']), sessionId: id(own(item, 'sessionId'), true), boothId: id(own(item, 'boothId'), true) };
  });
  const people = list(contacts, 5000).map(item => {
    const profile = own(item, 'profile'), operations = own(item, 'operations');
    if (!plain(profile) || !plain(operations)) throw new TypeError('人员显示资料无效。');
    return { id: id(own(item, 'id')), name: text(own(profile, 'displayName'), 120) || text(own(profile, 'name'), 120), organization: text(own(profile, 'organization'), 300),
      responseStatus: status(own(operations, 'responseStatus'), ['pending', 'attending', 'declined']), participationForms: forms(own(operations, 'participationForms')),
      sessionIds: identifiers(own(operations, 'sessionIds')), boothIds: identifiers(own(operations, 'boothIds')) };
  });
  const sessionById = indexed(sessions), boothById = indexed(booths), guestById = indexed(guests), contactById = indexed(people);
  indexed(teams);
  const guestByContact = new Map();
  for (const guest of guests) if (guest.contactId) {
    if (guestByContact.has(guest.contactId)) throw new TypeError('同一人员的嘉宾关联重复。');
    guestByContact.set(guest.contactId, guest);
    if (!contactById.has(guest.contactId)) warn(null, 'MISSING_CONTACT_REFERENCE', guest.id, (guest.name || guest.id) + '：关联人员记录已不存在，回复状态不可推定。');
  }
  const projectedPeople = new Map();
  function contactPerson(contact) {
    const stable = 'contact:' + contact.id;
    if (!projectedPeople.has(stable)) {
      const guest = guestByContact.get(contact.id);
      projectedPeople.set(stable, { id: stable, name: guest?.name || contact.name, organization: guest?.company || contact.organization,
        contactId: contact.id, guestId: guest?.id ?? '', responseStatus: contact.responseStatus, guestStatus: guest?.status ?? null,
        participationForms: [...contact.participationForms] });
    }
    return projectedPeople.get(stable);
  }
  function guestPerson(guest) {
    const linked = guest.contactId && contactById.get(guest.contactId);
    if (linked) return contactPerson(linked);
    const stable = 'guest:' + guest.id;
    if (!projectedPeople.has(stable)) projectedPeople.set(stable, { id: stable, name: guest.name, organization: guest.company,
      contactId: guest.contactId, guestId: guest.id, responseStatus: null, guestStatus: guest.status, participationForms: [] });
    return projectedPeople.get(stable);
  }
  const sessionRows = new Map(sessions.map(item => [item.id, { id: item.id, start: item.start, end: item.end, zone: item.zone, title: item.title,
    format: item.format, status: item.status, primarySpeaker: null, people: [], teams: [], warnings: [] }]));
  const boothRowsById = new Map(booths.map(booth => [booth.id, { slotNumber: booth.slotNumber,
    label: booth.status === 'cancelled' ? '已取消' + (booth.slotNumber ? ' · 原' + String(booth.slotNumber).padStart(2, '0') + '号位置' : '')
      : booth.slotNumber ? String(booth.slotNumber).padStart(2, '0') + '号位置' : '尚未指定位置',
    booth: { ...booth }, people: [], teams: [], warnings: [] }]));
  const activePeople = new Map(), activeTeams = new Map();
  function addPerson(row, person, active) {
    if (!row.people.some(item => item.id === person.id)) row.people.push(person);
    if (active) activePeople.set(person.id, person);
    if (person.responseStatus === 'declined') warn(row.warnings, 'PERSON_DECLINED', person.id, (person.name || person.id) + '：已回复不出席，仍有安排需要核对。');
    if (person.responseStatus === 'pending') warn(row.warnings, 'PERSON_REPLY_PENDING', person.id, (person.name || person.id) + '：尚待实际出席回复，不代表已确认参加。');
    if (!person.contactId) warn(row.warnings, 'GUEST_REPLY_UNTRACKED', person.id, (person.name || person.id) + '：没有人员回复关联；嘉宾确认状态不等于实际出席回复。');
    else if (!contactById.has(person.contactId)) warn(row.warnings, 'MISSING_CONTACT_REFERENCE', person.guestId, (person.name || person.guestId) + '：关联人员记录已不存在，回复状态不可推定。');
  }
  function addTeam(row, team, active) {
    const { sessionId, boothId, ...projection } = team;
    if (!row.teams.some(item => item.id === team.id)) row.teams.push(projection);
    if (active) activeTeams.set(team.id, projection);
    if (team.responseStatus === 'declined') warn(row.warnings, 'TEAM_DECLINED', team.id, (team.teamName || team.id) + '：已回复不出席，仍有安排需要核对。');
    if (team.responseStatus === 'pending') warn(row.warnings, 'TEAM_REPLY_PENDING', team.id, (team.teamName || team.id) + '：尚待实际出席回复；填报人数不是签到人数。');
  }
  for (const contact of people) {
    for (const [kind, references, records, rows] of [['SESSION', contact.sessionIds, sessionById, sessionRows], ['BOOTH', contact.boothIds, boothById, boothRowsById]]) {
      for (const reference of references) {
        const record = records.get(reference), row = rows.get(reference);
        if (!record) { warn(null, 'MISSING_' + kind + '_REFERENCE', contact.id, (guestByContact.get(contact.id)?.name || contact.name || contact.id) + '：关联的' + (kind === 'SESSION' ? '场次' : '展位') + '已不存在，请重新核对。'); continue; }
        addPerson(row, contactPerson(contact), record.status !== 'cancelled');
        if (record.status === 'cancelled') warn(row.warnings, 'CANCELLED_' + kind + '_ASSIGNMENT', contact.id, '人员仍关联已取消的安排；不计入有效安排人数。');
      }
    }
  }
  for (const session of sessions) {
    const row = sessionRows.get(session.id), primary = session.guestId && guestById.get(session.guestId);
    if (!timeRange(session)) warn(row.warnings, 'INVALID_SESSION_TIME', session.id, (session.title || session.id) + '：时间无效，无法核对人员时段重叠。');
    if (session.format === 'other') warn(row.warnings, 'UNCLASSIFIED_SESSION', session.id, (session.title || session.id) + '：尚未标记明确形式，不按标题猜测分类。');
    if (session.guestId && !primary) warn(row.warnings, 'MISSING_GUEST_REFERENCE', session.id, (session.title || session.id) + '：主要嘉宾记录已不存在，请重新关联。');
    if (primary) {
      const person = guestPerson(primary);
      addPerson(row, person, session.status !== 'cancelled');
      row.primarySpeaker = { personId: person.id, name: person.name, status: primary.status, source: 'guest' };
    } else if (!session.guestId && session.speakerName) {
      // Saved legacy speaker text is displayed, never synthesized into a person
      // identity or included in deduplicated participant counts.
      row.primarySpeaker = { personId: null, name: session.speakerName, status: session.speakerStatus, source: 'legacy' };
      warn(row.warnings, 'LEGACY_SPEAKER_UNLINKED', session.id, '主要讲者仍是文字记录，未计入可去重人员数。');
    }
    if (row.primarySpeaker?.status === 'pending') warn(row.warnings, 'PRIMARY_SPEAKER_PENDING', session.id, '主要讲者资料尚待确认；人员实际回复另列。');
  }
  for (const team of teams) for (const [kind, reference, form, records, rows] of [
    ['SESSION', team.sessionId, 'share', sessionById, sessionRows], ['BOOTH', team.boothId, 'booth', boothById, boothRowsById],
  ]) {
    if (!reference) continue;
    if (!team.participationForms.includes(form)) { warn(null, 'TEAM_FORM_MISMATCH', team.id, '团队关联安排与已选择参与形式不一致，请核对。'); continue; }
    const record = records.get(reference), row = rows.get(reference);
    if (!record) { warn(null, 'MISSING_TEAM_' + kind + '_REFERENCE', team.id, (team.teamName || team.id) + '：关联的' + (kind === 'SESSION' ? '分享场次' : '展位') + '已不存在，请重新核对。'); continue; }
    addTeam(row, team, record.status !== 'cancelled');
    if (record.status === 'cancelled') warn(row.warnings, 'CANCELLED_TEAM_' + kind + '_ASSIGNMENT', team.id, '团队仍关联已取消的安排；不计入有效安排团队数。');
  }
  for (const row of sessionRows.values()) if (row.status !== 'cancelled' && PRESENTATIONS.has(row.format) && !row.primarySpeaker
    && !(row.format === 'showcase' && row.teams.length)) warn(row.warnings, 'MISSING_PRIMARY_SPEAKER', row.id, (row.title || row.id) + '：尚未关联主要讲者／分享人员。');
  // Contacts and direct guest assignments share the same stable person identity.
  // Only scheduled, valid intervals take part; adjacent sessions do not overlap.
  const intervals = new Map();
  for (const row of sessionRows.values()) {
    const range = row.status === 'scheduled' && timeRange(row);
    if (!range) continue;
    for (const person of row.people) {
      const entries = intervals.get(person.id) ?? [];
      for (const prior of entries) if (range[0] < prior.range[1] && prior.range[0] < range[1]) {
        const message = (person.name || '同一人员') + '有重叠的已安排时段，请核对。';
        warn(row.warnings, 'PERSON_SCHEDULE_OVERLAP', person.id, message);
        warn(prior.row.warnings, 'PERSON_SCHEDULE_OVERLAP', person.id, message);
      }
      entries.push({ range, row }); intervals.set(person.id, entries);
    }
  }
  for (const row of [...sessionRows.values(), ...boothRowsById.values()]) { row.people.sort(byId); row.teams.sort(byId); }
  const positions = Array.from({ length: CAPACITY }, (_, index) => ({ slotNumber: index + 1, label: String(index + 1).padStart(2, '0') + '号位置', booth: null, people: [], teams: [], warnings: [] }));
  const unplacedBooths = [], cancelledBooths = [];
  for (const row of boothRowsById.values()) {
    if (row.booth.status === 'cancelled') { cancelledBooths.push(row); continue; }
    if (!row.slotNumber) { unplacedBooths.push(row); warn(row.warnings, 'BOOTH_POSITION_UNASSIGNED', row.booth.id, '此有效展位尚未指定十五个固定位置之一。'); continue; }
    if (positions[row.slotNumber - 1].booth) throw new TypeError('有效展位位置重复，不能选择其中一笔作为安排。');
    positions[row.slotNumber - 1] = row;
  }
  const allSessions = [...sessionRows.values()].sort(bySession);
  const counts = Object.fromEntries(contentSchema.sessionFormats.map(format => [format, { total: 0, draft: 0, scheduled: 0, cancelled: 0, withPrimarySpeaker: 0, missingPrimarySpeaker: 0 }]));
  for (const session of sessions) {
    counts[session.format].total++; counts[session.format][session.status]++;
    if (session.status === 'scheduled') {
      const row = sessionRows.get(session.id);
      if (row.primarySpeaker) counts[session.format].withPrimarySpeaker++;
      else if (row.warnings.some(warning => warning.code === 'MISSING_PRIMARY_SPEAKER')) counts[session.format].missingPrimarySpeaker++;
    }
  }
  const assignedContacts = [...activePeople.values()].filter(person => person.contactId && contactById.has(person.contactId));
  const attendingTeams = [...activeTeams.values()].filter(team => team.responseStatus === 'attending');
  const confirmedTeams = attendingTeams.filter(team => team.status === 'confirmed');
  return {
    schemaVersion: 1, revisions: { content: contentRevision, contacts: contactsRevision },
    summary: {
      booths: { capacity: CAPACITY, activePlaced: positions.filter(row => row.booth).length, confirmedPlaced: positions.filter(row => row.booth?.status === 'confirmed').length,
        pendingPlaced: positions.filter(row => row.booth?.status === 'pending').length, unassignedPositions: positions.filter(row => !row.booth).length, unplacedRecords: unplacedBooths.length },
      sessions: { total: sessions.length, active: sessions.filter(session => session.status !== 'cancelled').length, byFormat: counts,
        missingPrimarySpeaker: allSessions.filter(row => row.warnings.some(warning => warning.code === 'MISSING_PRIMARY_SPEAKER')).length },
      people: { assignedContacts: assignedContacts.length, attendingContacts: assignedContacts.filter(person => person.responseStatus === 'attending').length,
        pendingContacts: assignedContacts.filter(person => person.responseStatus === 'pending').length, declinedContacts: assignedContacts.filter(person => person.responseStatus === 'declined').length,
        unlinkedConfirmedGuests: [...activePeople.values()].filter(person => !contactById.has(person.contactId) && person.guestStatus === 'confirmed').length },
      studentTeams: { assignedTeams: activeTeams.size, attendingTeams: attendingTeams.length, confirmedAttendingTeams: confirmedTeams.length,
        reportedAttendingMembers: attendingTeams.reduce((sum, team) => sum + team.memberCount, 0), reportedConfirmedAttendingMembers: confirmedTeams.reduce((sum, team) => sum + team.memberCount, 0) },
    },
    boothRows: positions, unplacedBooths: unplacedBooths.sort((a, b) => byId(a.booth, b.booth)), cancelledBooths: cancelledBooths.sort((a, b) => byId(a.booth, b.booth)),
    sessions: { A: allSessions.filter(row => row.zone === 'A'), B: allSessions.filter(row => row.zone === 'B'), workshops: allSessions.filter(row => row.format === 'workshop'), other: allSessions.filter(row => !['A', 'B'].includes(row.zone)) },
    warnings: [...warningIndex.values()],
  };
}
