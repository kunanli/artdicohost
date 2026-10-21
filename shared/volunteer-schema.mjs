/** Private volunteer operations. This schema never enters public event content. */
export const VOLUNTEER_SCHEMA_VERSION = 1;
export const VOLUNTEER_LIMITS = Object.freeze({ volunteers: 500, positions: 100, shifts: 300, assignments: 1000, audit: 1000, availability: 12, bytes: 1024 * 1024 });
export const VOLUNTEER_WORKFLOW_STATUSES = Object.freeze(['pending', 'invited', 'confirmed', 'declined', 'inactive']);
export const VOLUNTEER_POSITION_STATUSES = Object.freeze(['active', 'inactive']);
export const VOLUNTEER_SHIFT_STATUSES = Object.freeze(['active', 'cancelled']);
export const VOLUNTEER_ASSIGNMENT_STATUSES = Object.freeze(['proposed', 'confirmed', 'cancelled']);
export const VOLUNTEER_ACTIONS = Object.freeze(['volunteer_upsert', 'position_upsert', 'shift_upsert', 'assignment_upsert', 'export']);
export const VOLUNTEER_ISSUE_LABELS = Object.freeze({ SOURCE_UNAVAILABLE: '人员来源暂时无法核对', SOURCE_INELIGIBLE: '来源许可或参与状态不适合新增安排', DUPLICATE_PERSON: '同一明确身份关联多笔有效志愿者记录，请先核对',
  VOLUNTEER_INACTIVE: '志愿者已婉拒或停止参与', VOLUNTEER_NOT_CONFIRMED: '志愿者本人尚未确认协作', ADMISSION_NOT_CONFIRMED: '参会名额尚未确认',
  SHIFT_CANCELLED: '班次已取消', POSITION_INACTIVE: '岗位已停用', CONTENT_LINK_INVALID: '关联场次或展位已失效', OUTSIDE_AVAILABILITY: '班次不在已保存可服务时段内', TIME_CONFLICT: '同一人员的班次时间重叠', SHIFT_OVER_CAPACITY: '本班安排超过需求人数' });
export const VOLUNTEER_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/u;
export const VOLUNTEER_OPERATION_ID = /^[A-Za-z0-9_-]{16,100}$/u;
const REGISTRATION = /^[A-Za-z0-9_-]{43}$/u, ACTOR = /^[A-Za-z0-9_-]{1,80}$/u, HASH = /^[a-f0-9]{64}$/u;
const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u;
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value));
export const isVolunteerPlainObject = plain;
export const volunteerExactKeys = (value, names) => plain(value) && Reflect.ownKeys(value).length === names.length
  && names.every(name => { const property = Object.getOwnPropertyDescriptor(value, name); return property && 'value' in property; });
const formed = value => { for (const character of value) { const point = character.codePointAt(0); if (point >= 0xd800 && point <= 0xdfff) return false; } return true; };
const boundedText = (value, max, multiline = false) => typeof value === 'string' && value.length <= max * 2 && formed(value)
  && [...value].length <= max && !CONTROL.test(value) && (multiline || !/[\r\n\t]/u.test(value));
export const volunteerRevision = value => Number.isSafeInteger(value) && value >= 0;
export function volunteerDate(value) {
  if (value === '') return true;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/u.test(value)) return false;
  const date = new Date(value + 'T00:00:00.000Z');
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
export function volunteerMinutes(value) {
  if (typeof value !== 'string' || !/^(?:[01]\d|2[0-3]):[0-5]\d$/u.test(value)) return null;
  return Number(value.slice(0, 2)) * 60 + Number(value.slice(3));
}
export function volunteerWindowsOverlap(left, right) { return left.start < right.end && right.start < left.end; }
const iso = value => typeof value === 'string' && value.length === 24 && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
function result(value, errors) { return { valid: !Object.keys(errors).length, errors, value }; }
function fields(input, names, errors) {
  if (!plain(input) || Reflect.ownKeys(input).some(name => typeof name !== 'string' || !names.includes(name))
    || Reflect.ownKeys(input).some(name => !('value' in Object.getOwnPropertyDescriptor(input, name)))) {
    errors.form = '资料字段无效，请重新核对。'; return {};
  }
  return input;
}
function text(input, key, errors, maximum, { required = false, multiline = false } = {}) {
  const raw = input[key] === undefined ? '' : input[key];
  const value = typeof raw === 'string' ? raw.normalize('NFC').trim() : '';
  if (!boundedText(raw, maximum, multiline) || required && !value) errors[key] = required ? '请填写有效且长度适当的内容。' : '文字过长或包含无效内容。';
  return value;
}
function identifier(input, key, errors, optional = false) {
  const value = input[key] === undefined ? '' : input[key];
  if (typeof value !== 'string' || (!optional || value !== '') && !VOLUNTEER_ID.test(value)) errors[key] = '内部编号无效。';
  return typeof value === 'string' ? value : '';
}
function choice(input, key, allowed, fallback, errors) {
  const value = input[key] === undefined ? fallback : input[key];
  if (!allowed.includes(value)) errors[key] = '请选择有效状态。';
  return typeof value === 'string' ? value : fallback;
}
function interval(input, errors, prefix = '') {
  const value = { start: typeof input?.start === 'string' ? input.start : '', end: typeof input?.end === 'string' ? input.end : '' };
  const start = volunteerMinutes(value.start), end = volunteerMinutes(value.end);
  if (start === null || end === null || end <= start) errors[prefix + 'time'] = '请填写同一天内有效的开始与结束时间；结束须晚于开始。';
  return value;
}

export function validateVolunteer(input) {
  const errors = {}, source = fields(input, ['id', 'source', 'workflowStatus', 'owner', 'followUpAt', 'lastContactAt', 'notes', 'availability'], errors);
  const link = volunteerExactKeys(source.source, ['kind', 'id']) ? source.source : {};
  const value = { id: identifier(source, 'id', errors), source: { kind: link.kind, id: link.id },
    workflowStatus: choice(source, 'workflowStatus', VOLUNTEER_WORKFLOW_STATUSES, 'pending', errors),
    owner: text(source, 'owner', errors, 120), followUpAt: source.followUpAt ?? '', lastContactAt: source.lastContactAt ?? '',
    notes: text(source, 'notes', errors, 2000, { multiline: true }), availability: [] };
  if (!volunteerExactKeys(source.source, ['kind', 'id']) || !['contact', 'registration'].includes(value.source.kind)
    || !(value.source.kind === 'contact' ? VOLUNTEER_ID : REGISTRATION).test(typeof value.source.id === 'string' ? value.source.id : '')) errors.source = '请选择现有人员或报名的明确编号。';
  for (const key of ['followUpAt', 'lastContactAt']) if (!volunteerDate(value[key])) errors[key] = '日期格式无效。';
  const windows = source.availability === undefined ? [] : source.availability;
  if (!Array.isArray(windows) || windows.length > VOLUNTEER_LIMITS.availability) errors.availability = '可服务时段最多十二段。';
  else {
    value.availability = windows.map((item, index) => {
      if (!volunteerExactKeys(item, ['start', 'end'])) errors['availability.' + index] = '可服务时段字段无效。';
      return interval(item, errors, 'availability.' + index + '.');
    }).sort((a, b) => a.start.localeCompare(b.start));
    for (let index = 1; index < value.availability.length; index++) if (volunteerWindowsOverlap(value.availability[index - 1], value.availability[index])) errors.availability = '可服务时段不能重叠。';
  }
  return result(value, errors);
}

export function validateVolunteerPosition(input) {
  const errors = {}, source = fields(input, ['id', 'name', 'zone', 'location', 'lead', 'description', 'status'], errors);
  const value = { id: identifier(source, 'id', errors), name: text(source, 'name', errors, 120, { required: true }),
    zone: choice(source, 'zone', ['A', 'B', 'C', 'other'], 'other', errors), location: text(source, 'location', errors, 160),
    lead: text(source, 'lead', errors, 120), description: text(source, 'description', errors, 1000, { multiline: true }),
    status: choice(source, 'status', VOLUNTEER_POSITION_STATUSES, 'active', errors) };
  return result(value, errors);
}

export function validateVolunteerShift(input) {
  const errors = {}, source = fields(input, ['id', 'positionId', 'start', 'end', 'required', 'status', 'sessionId', 'boothId'], errors);
  const value = { id: identifier(source, 'id', errors), positionId: identifier(source, 'positionId', errors), ...interval(source, errors),
    required: source.required, status: choice(source, 'status', VOLUNTEER_SHIFT_STATUSES, 'active', errors),
    sessionId: identifier(source, 'sessionId', errors, true), boothId: identifier(source, 'boothId', errors, true) };
  if (!Number.isSafeInteger(value.required) || value.required < 1 || value.required > 300) errors.required = '每班需求须为 1 至 300 的整数人数。';
  return result(value, errors);
}

export function validateVolunteerAssignment(input) {
  const errors = {}, source = fields(input, ['id', 'volunteerId', 'shiftId', 'status'], errors);
  const value = { id: identifier(source, 'id', errors), volunteerId: identifier(source, 'volunteerId', errors), shiftId: identifier(source, 'shiftId', errors),
    status: choice(source, 'status', VOLUNTEER_ASSIGNMENT_STATUSES, 'proposed', errors) };
  return result(value, errors);
}

export function emptyVolunteerState(eventId) {
  if (typeof eventId !== 'string' || !VOLUNTEER_ID.test(eventId)) throw new TypeError('Volunteer event ID required.');
  return { schemaVersion: VOLUNTEER_SCHEMA_VERSION, eventId, revision: 0, volunteers: [], positions: [], shifts: [], assignments: [], audit: [] };
}
function storageError() { const error = new Error('志愿者资料暂时无法核对。'); error.code = 'STORAGE_UNAVAILABLE'; error.status = 503; return error; }
function checkedEntities(items, validator, limit) {
  if (!Array.isArray(items) || items.length > limit) throw storageError();
  const ids = new Set();
  for (const item of items) {
    const checked = validator(item);
    if (!checked.valid || JSON.stringify(checked.value) !== JSON.stringify(item) || ids.has(item.id)) throw storageError();
    ids.add(item.id);
  }
  return ids;
}
/** Strict snapshots reject extra data and malformed audits instead of resetting a journal. */
export function validateVolunteerState(value, { eventId } = {}) {
  try {
    if (!volunteerExactKeys(value, ['schemaVersion', 'eventId', 'revision', 'volunteers', 'positions', 'shifts', 'assignments', 'audit'])
      || value.schemaVersion !== 1 || typeof value.eventId !== 'string' || !VOLUNTEER_ID.test(value.eventId) || eventId !== undefined && value.eventId !== eventId
      || !volunteerRevision(value.revision) || !Array.isArray(value.audit) || value.audit.length !== value.revision || value.audit.length > VOLUNTEER_LIMITS.audit
      || new TextEncoder().encode(JSON.stringify(value)).byteLength > VOLUNTEER_LIMITS.bytes) throw storageError();
    const people = checkedEntities(value.volunteers, validateVolunteer, VOLUNTEER_LIMITS.volunteers);
    const positions = checkedEntities(value.positions, validateVolunteerPosition, VOLUNTEER_LIMITS.positions);
    const shifts = checkedEntities(value.shifts, validateVolunteerShift, VOLUNTEER_LIMITS.shifts);
    checkedEntities(value.assignments, validateVolunteerAssignment, VOLUNTEER_LIMITS.assignments);
    const sources = new Set(), pairs = new Set();
    for (const volunteer of value.volunteers) { const key = volunteer.source.kind + ':' + volunteer.source.id; if (sources.has(key)) throw storageError(); sources.add(key); }
    for (const shift of value.shifts) if (!positions.has(shift.positionId)) throw storageError();
    for (const assignment of value.assignments) { const key = assignment.volunteerId + ':' + assignment.shiftId; if (!people.has(assignment.volunteerId) || !shifts.has(assignment.shiftId) || pairs.has(key)) throw storageError(); pairs.add(key); }
    const operations = new Set(); let previous = '';
    for (const [index, entry] of value.audit.entries()) {
      const names = ['revision', 'operationId', 'action', 'actorId', 'fingerprint', 'at', ...(Object.hasOwn(entry ?? {}, 'details') ? ['details'] : [])];
      if (!volunteerExactKeys(entry, names) || entry.revision !== index + 1 || typeof entry.operationId !== 'string' || !VOLUNTEER_OPERATION_ID.test(entry.operationId) || operations.has(entry.operationId)
        || !VOLUNTEER_ACTIONS.includes(entry.action) || typeof entry.actorId !== 'string' || !ACTOR.test(entry.actorId) || typeof entry.fingerprint !== 'string' || !HASH.test(entry.fingerprint) || !iso(entry.at) || entry.at < previous) throw storageError();
      if (Object.hasOwn(entry, 'details')) {
        const detail = entry.details;
        if (entry.action !== 'export' || !volunteerExactKeys(detail, ['volunteerIds', 'includeContact', 'sha256'])
          || !Array.isArray(detail.volunteerIds) || detail.volunteerIds.length > 500 || detail.volunteerIds.some(id => typeof id !== 'string' || !VOLUNTEER_ID.test(id) || !people.has(id))
          || new Set(detail.volunteerIds).size !== detail.volunteerIds.length || typeof detail.includeContact !== 'boolean' || typeof detail.sha256 !== 'string' || !HASH.test(detail.sha256)) throw storageError();
      }
      operations.add(entry.operationId); previous = entry.at;
    }
    return structuredClone(value);
  } catch (error) { if (error?.code === 'STORAGE_UNAVAILABLE') throw error; throw storageError(); }
}
