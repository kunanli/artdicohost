/** Browser projection: retain only the fields this private workspace displays. */
const ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/u;
const REGISTRATION = /^[A-Za-z0-9_-]{43}$/u;
const OPERATION = /^[A-Za-z0-9_-]{16,100}$/u;
const CODE = /^[A-Za-z][A-Za-z0-9_-]{0,79}$/u;
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const fail = () => { throw new Error('云端资料格式无法核对，填写内容仍保留，请重新读取。'); };
const check = condition => { if (!condition) fail(); };
const formed = value => { for (const character of value) if (character.codePointAt(0) >= 0xd800 && character.codePointAt(0) <= 0xdfff) return false; return true; };
function text(value, maximum = 300, required = false) { check(typeof value === 'string' && value.length <= maximum * 2 && formed(value) && [...value].length <= maximum && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value) && (!required || Boolean(value.trim()))); return value; }
function id(value, optional = false) { check(typeof value === 'string' && (optional && value === '' || ID.test(value))); return value; }
function integer(value, maximum = Number.MAX_SAFE_INTEGER) { check(Number.isSafeInteger(value) && value >= 0 && value <= maximum); return value; }
function choice(value, choices) { check(choices.includes(value)); return value; }
function rows(value, maximum, project, unique = true) { check(Array.isArray(value) && value.length <= maximum); const result = value.map(project); if (unique) check(new Set(result.map(row => row.id)).size === result.length); return result; }
function issues(value) { check(Array.isArray(value) && value.length <= 100 && value.every(code => typeof code === 'string' && CODE.test(code))); return [...new Set(value)]; }
function time(value) { check(typeof value === 'string' && /^(?:[01]\d|2[0-3]):[0-5]\d$/u.test(value)); return value; }
function date(value, optional = true) { if (optional && value === '') return ''; check(typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/u.test(value)); const parsed = new Date(value + 'T00:00:00Z'); check(Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value); return value; }
export const workflowLabels = Object.freeze({ pending: '待联系', invited: '已记录邀约，待回复', confirmed: '本人已答应', declined: '本人婉拒', inactive: '已停止参与' });
export const admissionLabels = Object.freeze({ confirmed: '已确认参会名额', waitlisted: '已核准候补，名额未确认', pending_review: '申请待审核，尚无名额', rejected: '申请未通过，尚无名额', withdrawn: '已撤回', unlinked: '尚未关联正式报名', unavailable: '名额暂无法核对' });
export const assignmentLabels = Object.freeze({ proposed: '拟安排', confirmed: '已确认本班次', cancelled: '已取消' });
export const issueLabels = Object.freeze({ SOURCE_UNAVAILABLE: '人员来源暂时无法核对', SOURCE_INELIGIBLE: '来源许可或参与状态需核对', DUPLICATE_PERSON: '同一身份存在多笔有效名单', VOLUNTEER_INACTIVE: '本人已婉拒或停止参与', VOLUNTEER_NOT_CONFIRMED: '本人尚未答应协作', ADMISSION_NOT_CONFIRMED: '参会名额尚未确认', SHIFT_CANCELLED: '班次已取消', POSITION_INACTIVE: '岗位已停用', CONTENT_LINK_INVALID: '关联场次或展位已失效', OUTSIDE_AVAILABILITY: '超出已保存可服务时段', TIME_CONFLICT: '同一人员的班次时间重叠', SHIFT_OVER_CAPACITY: '安排超过本班需求', source_unavailable: '来源暂时无法核对', contact_declined: '本人不接受联络或不出席', contact_consent_unknown: '尚未核实联络许可', registration_withdrawn: '报名已撤回', registration_consent_unknown: '报名许可尚未核实', source_linkage_unavailable: '人员与报名关联待核对' });
export const issueLabel = code => issueLabels[code] ?? '资料或安排需核对';
export const canManageVolunteers = roles => Array.isArray(roles) && (roles.includes('superadmin') || roles.includes('outreach') && roles.includes('reviewer'));
export function sourceValue(value) { check(plain(value)); const kind = choice(value.kind, ['contact', 'registration']); check(typeof value.id === 'string' && (kind === 'contact' ? ID : REGISTRATION).test(value.id)); return { kind, id: value.id }; }
export const sourceToken = value => { const source = sourceValue(value); return source.kind + ':' + source.id; };
export function parseSourceToken(value) { if (typeof value !== 'string') return null; const match = /^(contact|registration):(.+)$/u.exec(value); if (!match) return null; try { return sourceValue({ kind: match[1], id: match[2] }); } catch { return null; } }
export function parseVolunteerSelection(hash) { if (typeof hash !== 'string' || hash.length > 200) return null; const match = /^#(contact|registration)=([^&#=]+)$/u.exec(hash); if (!match) return null; try { return sourceValue({ kind: match[1], id: decodeURIComponent(match[2]) }); } catch { return null; } }
export function personWorkspacePath(source) { const value = sourceValue(source); return '/admin/person/#' + value.kind + '=' + encodeURIComponent(value.id); }
function person(value, source) { check(plain(value)); const canonicalId = value.canonicalId === null ? null : text(value.canonicalId, 100, true); const contactId = value.contactId === null ? null : id(value.contactId); const registrationId = value.registrationId === null ? null : sourceValue({ kind: 'registration', id: value.registrationId }).id; check(typeof value.eligible === 'boolean');
  check((source.kind === 'contact' ? contactId : registrationId) === source.id && (canonicalId === null ? !value.eligible : canonicalId === (registrationId ? 'r:' + registrationId : contactId ? 'c:' + contactId : null)));
  const admissionStatus = choice(value.admissionStatus, Object.keys(admissionLabels)); check(canonicalId === null || admissionStatus !== 'unavailable');
  return { canonicalId, contactId, registrationId, name: text(value.name, 120, true), organization: text(value.organization, 300), email: text(value.email, 254), wechat: text(value.wechat, 150), phone: text(value.phone, 150), eligible: value.eligible, admissionStatus, issues: issues(value.issues) }; }
function volunteer(value) { check(plain(value)); const source = sourceValue(value.source); const availability = rows(value.availability, 12, row => { check(plain(row)); const result = { start: time(row.start), end: time(row.end) }; check(result.start < result.end); return result; }, false); for (let index = 1; index < availability.length; index++) check(availability[index - 1].end <= availability[index].start); return { id: id(value.id), source, workflowStatus: choice(value.workflowStatus, Object.keys(workflowLabels)), owner: text(value.owner, 120), followUpAt: date(value.followUpAt), lastContactAt: date(value.lastContactAt), notes: text(value.notes, 2000), availability, person: person(value.person, source), issues: issues(value.issues) }; }
function position(value) { check(plain(value)); return { id: id(value.id), name: text(value.name, 120, true), zone: choice(value.zone, ['A', 'B', 'C', 'other']), location: text(value.location, 160), lead: text(value.lead, 120), description: text(value.description, 1000), status: choice(value.status, ['active', 'inactive']) }; }
function shift(value) { check(plain(value)); const result = { id: id(value.id), positionId: id(value.positionId), start: time(value.start), end: time(value.end), required: integer(value.required, 300), status: choice(value.status, ['active', 'cancelled']), sessionId: id(value.sessionId, true), boothId: id(value.boothId, true), positionName: text(value.positionName, 120), proposedCount: integer(value.proposedCount, 1000), confirmedCount: integer(value.confirmedCount, 1000), gap: integer(value.gap, 300), issues: issues(value.issues) }; check(result.required >= 1 && result.start < result.end); return result; }
function assignment(value) { check(plain(value) && typeof value.valid === 'boolean'); return { id: id(value.id), volunteerId: id(value.volunteerId), shiftId: id(value.shiftId), status: choice(value.status, Object.keys(assignmentLabels)), valid: value.valid, issues: issues(value.issues) }; }
export function volunteerWorkspaceView(value) {
  check(plain(value) && value.schemaVersion === 1 && plain(value.event) && plain(value.revisions) && plain(value.summary) && plain(value.planning));
  const revision = integer(value.revision), revisions = {}; for (const key of ['volunteers', 'contacts', 'registrations', 'admissions', 'intent', 'content']) revisions[key] = integer(value.revisions[key]); check(revisions.volunteers === revision);
  const event = { id: id(value.event.id), title: text(value.event.title, 200, true), date: date(value.event.date, false), timezone: choice(value.event.timezone, ['Asia/Shanghai']) };
  const volunteers = rows(value.volunteers, 500, volunteer), positions = rows(value.positions, 100, position), shifts = rows(value.shifts, 300, shift), assignments = rows(value.assignments, 1000, assignment);
  const peopleIds = new Set(volunteers.map(row => row.id)), positionIds = new Set(positions.map(row => row.id)), shiftIds = new Set(shifts.map(row => row.id));
  check(shifts.every(row => positionIds.has(row.positionId)) && assignments.every(row => peopleIds.has(row.volunteerId) && shiftIds.has(row.shiftId)));
  check(new Set(volunteers.map(row => sourceToken(row.source))).size === volunteers.length && new Set(assignments.map(row => row.volunteerId + ':' + row.shiftId)).size === assignments.length);
  const summary = {}; for (const key of ['rosterCount', 'activePeopleCount', 'confirmedPeopleCount', 'admissionConfirmedPeopleCount', 'assignedPeopleCount', 'requiredSlots', 'confirmedSlots', 'proposedSlots', 'gapSlots', 'issueCount', 'unverifiableSources']) summary[key] = integer(value.summary[key], 1_000_000); check(summary.rosterCount === volunteers.length);
  const planning = { sessions: rows(value.planning.sessions, 200, row => { check(plain(row)); return { id: id(row.id), title: text(row.title, 200), start: text(row.start, 5), end: text(row.end, 5), zone: text(row.zone, 10), status: text(row.status, 20) }; }), booths: rows(value.planning.booths, 200, row => { check(plain(row)); return { id: id(row.id), code: text(row.code, 20), organization: text(row.organization, 300), status: text(row.status, 20), slotNumber: integer(row.slotNumber, 300) }; }) };
  validateCoverage({ volunteers, positions, shifts, assignments, summary, planning });
  return { schemaVersion: 1, event, revision, revisions, volunteers, positions, shifts, assignments, summary, planning };
}
function validateCoverage({ volunteers, positions, shifts, assignments, summary, planning }) {
  const active = row => ['pending', 'invited', 'confirmed'].includes(row.workflowStatus);
  const people = new Map(volunteers.map(row => [row.id, row])), positionById = new Map(positions.map(row => [row.id, row])), shiftById = new Map(shifts.map(row => [row.id, row]));
  const covered = (windows, shift) => { let cursor = shift.start; for (const window of windows) { if (window.end <= cursor) continue; if (window.start > cursor) return false; cursor = window.end; if (cursor >= shift.end) return true; } return false; };
  const assigned = new Set(), reservations = new Map();
  for (const entry of assignments) {
    check(entry.valid === (entry.status !== 'cancelled' && entry.issues.length === 0));
    if (!entry.valid) continue;
    const row = people.get(entry.volunteerId), shift = shiftById.get(entry.shiftId), position = positionById.get(shift.positionId);
    check(row.person.canonicalId !== null && row.person.eligible && active(row) && row.issues.length === 0 && shift.status === 'active' && position.status === 'active' && covered(row.availability, shift));
    check(!shift.sessionId || planning.sessions.some(item => item.id === shift.sessionId && item.status !== 'cancelled'));
    check(!shift.boothId || planning.booths.some(item => item.id === shift.boothId && item.status !== 'cancelled'));
    if (entry.status === 'confirmed') check(row.workflowStatus === 'confirmed' && row.person.admissionStatus === 'confirmed');
    const prior = reservations.get(row.person.canonicalId) || []; check(prior.every(other => other.end <= shift.start || shift.end <= other.start)); prior.push(shift); reservations.set(row.person.canonicalId, prior); assigned.add(row.person.canonicalId);
  }
  let requiredSlots = 0, proposedSlots = 0, confirmedSlots = 0, gapSlots = 0;
  for (const shift of shifts) {
    const allocations = assignments.filter(entry => entry.shiftId === shift.id && entry.valid), proposed = allocations.filter(entry => entry.status === 'proposed').length, confirmed = allocations.filter(entry => entry.status === 'confirmed').length;
    const inUse = shift.status === 'active' && positionById.get(shift.positionId).status === 'active', gap = inUse ? Math.max(0, shift.required - confirmed) : 0;
    check(shift.proposedCount === proposed && shift.confirmedCount === confirmed && shift.gap === gap);
    requiredSlots += inUse ? shift.required : 0; proposedSlots += proposed; confirmedSlots += confirmed; gapSlots += gap;
  }
  const known = volunteers.filter(row => row.person.canonicalId !== null && row.person.eligible && active(row));
  const count = rows => new Set(rows.map(row => row.person.canonicalId)).size;
  const expected = { activePeopleCount: count(known), confirmedPeopleCount: count(known.filter(row => row.workflowStatus === 'confirmed')), admissionConfirmedPeopleCount: count(known.filter(row => row.person.admissionStatus === 'confirmed')), assignedPeopleCount: assigned.size, requiredSlots, proposedSlots, confirmedSlots, gapSlots, unverifiableSources: volunteers.filter(row => row.person.canonicalId === null).length, issueCount: [...volunteers, ...shifts, ...assignments].reduce((total, row) => total + row.issues.length, 0) };
  for (const [key, value] of Object.entries(expected)) check(summary[key] === value);
}
export function volunteerSourceView(value) { check(plain(value) && value.schemaVersion === 1); const candidates = rows(value.candidates, 200, row => { check(plain(row)); const source = sourceValue(row.source); return { source, ...person(row, source) }; }, false); check(new Set(candidates.map(row => sourceToken(row.source))).size === candidates.length); const total = integer(value.total, 6000); check(total >= candidates.length && (value.nextCursor === null || typeof value.nextCursor === 'string' && /^[0-9]{1,5}$/u.test(value.nextCursor) && Number(value.nextCursor) < total)); return { candidates, total, nextCursor: value.nextCursor }; }
export function filterVolunteerRows(view, filters = {}) { const query = String(filters.query ?? '').trim().toLocaleLowerCase('zh-CN'); return view.volunteers.filter(row => { const allocations = view.assignments.filter(item => item.volunteerId === row.id && item.status !== 'cancelled'); return (!query || [row.person.name, row.person.organization, row.owner].some(text => text.toLocaleLowerCase('zh-CN').includes(query))) && (!filters.status || row.workflowStatus === filters.status) && (!filters.assignment || filters.assignment === 'assigned' && allocations.length > 0 || filters.assignment === 'unassigned' && allocations.length === 0 || filters.assignment === 'issues' && (row.issues.length > 0 || row.person.issues.length > 0 || allocations.some(item => !item.valid || item.issues.length))); }); }
export function operationReceipt(value, pending) { const view = volunteerWorkspaceView(value); check(['updated', 'replayed'].includes(value.outcome) && plain(value.operation) && value.operation.operationId === pending.operationId && value.operation.action === pending.action && Number.isSafeInteger(value.operation.revision) && value.operation.revision === pending.expectedRevision + 1 && value.operation.revision <= view.revision); return view; }
export function operationBody({ expectedRevision, operationId, action, payload }) { integer(expectedRevision); check(OPERATION.test(operationId) && ['volunteer_upsert', 'position_upsert', 'shift_upsert', 'assignment_upsert'].includes(action) && plain(payload)); return { expectedRevision, operationId, action, payload: structuredClone(payload) }; }
