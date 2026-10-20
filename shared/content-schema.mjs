/** Local content-management contract. It grants no administrative or cloud access. */
export const CONTENT_SCHEMA_VERSION = 1;
export const MAX_CONTENT_ITEMS = 200;

export const contentSchema = Object.freeze({
  schemaVersion: CONTENT_SCHEMA_VERSION,
  maxSessions: MAX_CONTENT_ITEMS,
  maxBooths: MAX_CONTENT_ITEMS,
  maxGuests: MAX_CONTENT_ITEMS,
  zones: ['A', 'B', 'C'],
  sessionStatuses: ['draft', 'scheduled', 'cancelled'],
  speakerStatuses: ['pending', 'confirmed'],
  boothStatuses: ['pending', 'confirmed', 'cancelled'],
  eventStatuses: ['tentative', 'confirmed', 'cancelled'],
  factStatuses: ['tentative', 'confirmed'],
  guestStatuses: ['pending', 'confirmed'],
});

/** @typedef {{id:string,start:string,end:string,zone:string,title:string,guestId:string,speakerName:string,speakerStatus:string,status:string,internalNotes:string}} Session */
/** @typedef {{id:string,code:string,organization:string,project:string,zone:string,status:string,internalNotes:string}} Booth */
/** @typedef {{id:string,name:string,company:string,ggjRole:string,portraitId:string,status:string,publicConsent:boolean,internalNotes:string}} Guest */
/** @typedef {{schemaVersion:number,eventId:string,event:{title:string,date:string,timezone:string,venue:string,status:string,dateStatus:string,venueStatus:string},sessions:Session[],booths:Booth[],guests:Guest[]}} Content */

/** Only server-created content-addressed portraits are accepted; no external URLs. */
export const PORTRAIT_ID_PATTERN = /^[a-f0-9]{64}\.(?:jpg|png|webp)$/u;

/** @param {unknown} input @returns {Record<string,unknown>} */
function object(input) {
  return input !== null && typeof input === 'object' && !Array.isArray(input)
    ? /** @type {Record<string,unknown>} */ (input) : {};
}

/** @param {unknown} input */
function text(input) { return typeof input === 'string' ? input.normalize('NFC').trim() : ''; }

/** @param {unknown} input @returns {Session} */
function session(input) {
  const item = object(input);
  return {
    id: text(item.id), start: text(item.start), end: text(item.end), zone: text(item.zone), title: text(item.title),
    guestId: text(item.guestId), speakerName: text(item.speakerName), speakerStatus: text(item.speakerStatus), status: text(item.status), internalNotes: text(item.internalNotes),
  };
}

/** @param {unknown} input @returns {Guest} */
function guest(input) {
  const item = object(input);
  return {
    id: text(item.id), name: text(item.name), company: text(item.company), ggjRole: text(item.ggjRole),
    portraitId: text(item.portraitId), status: text(item.status), publicConsent: item.publicConsent === true,
    internalNotes: text(item.internalNotes),
  };
}

/** @param {unknown} input @returns {Booth} */
function booth(input) {
  const item = object(input);
  return {
    id: text(item.id), code: text(item.code).toUpperCase(), organization: text(item.organization), project: text(item.project),
    zone: text(item.zone), status: text(item.status), internalNotes: text(item.internalNotes),
  };
}

/** @param {string} value */
function validDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

/** @param {string} value */
function validTimezone(value) {
  if (!value || value.length > 100) return false;
  try { new Intl.DateTimeFormat('en', { timeZone: value }).format(); return true; }
  catch { return false; }
}

/** @param {string} value */
function validTime(value) { return /^(?:[01]\d|2[0-3]):[0-5]\d$/u.test(value); }

/**
 * Whitelists editable data and checks scheduling constraints. Unknown fields are
 * dropped, while malformed required shapes are rejected. Revision handling belongs
 * to the local API envelope, outside this contract.
 * @param {unknown} input
 * @returns {{valid:boolean,errors:Record<string,string>,value:Content}}
 */
export function validateContent(input) {
  const source = object(input);
  const rawEvent = object(source.event);
  const rawSessions = Array.isArray(source.sessions) ? source.sessions : [];
  const rawBooths = Array.isArray(source.booths) ? source.booths : [];
  const rawGuests = Array.isArray(source.guests) ? source.guests : [];
  /** @type {Content} */
  const value = {
    schemaVersion: CONTENT_SCHEMA_VERSION,
    eventId: text(source.eventId),
    event: {
      title: text(rawEvent.title), date: text(rawEvent.date), timezone: text(rawEvent.timezone), venue: text(rawEvent.venue),
      status: text(rawEvent.status), dateStatus: text(rawEvent.dateStatus), venueStatus: text(rawEvent.venueStatus),
    },
    // At most one overflow item is needed to reject an oversized array.
    sessions: rawSessions.slice(0, MAX_CONTENT_ITEMS + 1).map(session),
    booths: rawBooths.slice(0, MAX_CONTENT_ITEMS + 1).map(booth),
    guests: rawGuests.slice(0, MAX_CONTENT_ITEMS + 1).map(guest),
  };
  /** @type {Record<string,string>} */
  const errors = {};
  /** @param {string} key @param {string} candidate @param {number} max @param {boolean} [required] */
  function stringField(key, candidate, max, required = true) {
    if (required && !candidate) errors[key] = '请填写此项。';
    else if ([...candidate].length > max) errors[key] = `请控制在 ${max} 字以内。`;
  }
  /** @param {string} key @param {string} candidate @param {string[]} allowed */
  function enumField(key, candidate, allowed) {
    if (!allowed.includes(candidate)) errors[key] = '请选择提供的选项。';
  }
  /** @param {string} key @param {string} candidate */
  function stableId(key, candidate) {
    if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/u.test(candidate)) errors[key] = 'ID 必须为 1–80 位字母、数字、短横线或下划线，且保持稳定。';
  }

  if (source.schemaVersion !== CONTENT_SCHEMA_VERSION) errors.schemaVersion = '不支持的内容版本。';
  stableId('eventId', value.eventId);
  stringField('event.title', value.event.title, 200);
  stringField('event.venue', value.event.venue, 300);
  if (!validDate(value.event.date)) errors['event.date'] = '请填写有效的 YYYY-MM-DD 日期。';
  if (!validTimezone(value.event.timezone)) errors['event.timezone'] = '请填写有效的时区，例如 Asia/Shanghai。';
  enumField('event.status', value.event.status, contentSchema.eventStatuses);
  enumField('event.dateStatus', value.event.dateStatus, contentSchema.factStatuses);
  enumField('event.venueStatus', value.event.venueStatus, contentSchema.factStatuses);
  if (!Array.isArray(source.sessions)) errors.sessions = '场次数组不可缺少。';
  else if (rawSessions.length > MAX_CONTENT_ITEMS) errors.sessions = `场次最多 ${MAX_CONTENT_ITEMS} 个。`;
  if (!Array.isArray(source.booths)) errors.booths = '展位数组不可缺少。';
  else if (rawBooths.length > MAX_CONTENT_ITEMS) errors.booths = `展位最多 ${MAX_CONTENT_ITEMS} 个。`;
  // Version-one drafts from before the guest editor remain valid. An explicitly
  // malformed new field cannot silently erase guest records.
  if (source.guests !== undefined && !Array.isArray(source.guests)) errors.guests = '嘉宾须为数组。';
  else if (rawGuests.length > MAX_CONTENT_ITEMS) errors.guests = `嘉宾最多 ${MAX_CONTENT_ITEMS} 位。`;

  const ids = new Set();
  const guestIds = new Set();
  for (const [index, item] of value.guests.entries()) {
    const key = `guests.${index}`;
    stableId(`${key}.id`, item.id);
    if (ids.has(item.id)) errors[`${key}.id`] = 'ID 重复，请保留每条内容独立的稳定 ID。';
    ids.add(item.id);
    guestIds.add(item.id);
    enumField(`${key}.status`, item.status, contentSchema.guestStatuses);
    stringField(`${key}.name`, item.name, 120, item.status === 'confirmed');
    stringField(`${key}.company`, item.company, 160, item.status === 'confirmed');
    stringField(`${key}.ggjRole`, item.ggjRole, 160, false);
    stringField(`${key}.internalNotes`, item.internalNotes, 4000, false);
    const raw = object(rawGuests[index]);
    for (const name of ['name', 'company', 'ggjRole']) {
      if (typeof raw[name] === 'string' && /[\u0000-\u001f\u007f]/u.test(raw[name])) errors[`${key}.${name}`] = '请填写不含换行或控制字符的单行内容。';
    }
    if (raw.publicConsent !== undefined && typeof raw.publicConsent !== 'boolean') errors[`${key}.publicConsent`] = '请明确勾选是否已获公开授权。';
    if (raw.portraitId !== undefined && typeof raw.portraitId !== 'string') errors[`${key}.portraitId`] = '请选择后台已上传的头像。';
    if (item.portraitId && !PORTRAIT_ID_PATTERN.test(item.portraitId)) errors[`${key}.portraitId`] = '请选择后台已上传的头像。';
    if (item.status === 'confirmed' && item.publicConsent && !item.portraitId) errors[`${key}.portraitId`] = '公开嘉宾前请先上传已获授权的头像。';
  }
  for (const [index, item] of value.sessions.entries()) {
    const key = `sessions.${index}`;
    stableId(`${key}.id`, item.id);
    if (ids.has(item.id)) errors[`${key}.id`] = 'ID 重复，请保留每条内容独立的稳定 ID。';
    ids.add(item.id);
    stringField(`${key}.title`, item.title, 200);
    stringField(`${key}.speakerName`, item.speakerName, 120, item.speakerStatus === 'confirmed' && !item.guestId);
    const raw = object(rawSessions[index]);
    if (raw.guestId !== undefined && typeof raw.guestId !== 'string') errors[`${key}.guestId`] = '请选择本活动已有的嘉宾，或留空使用原讲者资料。';
    if (item.guestId && !guestIds.has(item.guestId)) errors[`${key}.guestId`] = '请选择本活动已有的嘉宾，或留空使用原讲者资料。';
    stringField(`${key}.internalNotes`, item.internalNotes, 4000, false);
    enumField(`${key}.zone`, item.zone, contentSchema.zones);
    enumField(`${key}.status`, item.status, contentSchema.sessionStatuses);
    enumField(`${key}.speakerStatus`, item.speakerStatus, contentSchema.speakerStatuses);
    if (!validTime(item.start)) errors[`${key}.start`] = '请填写 00:00–23:59 格式的 HH:mm。';
    if (!validTime(item.end)) errors[`${key}.end`] = '请填写 00:00–23:59 格式的 HH:mm。';
    if (validTime(item.start) && validTime(item.end) && item.end <= item.start) errors[`${key}.end`] = '结束时间必须晚于开始时间；本次日程不跨日。';
  }

  const codes = new Set();
  for (const [index, item] of value.booths.entries()) {
    const key = `booths.${index}`;
    stableId(`${key}.id`, item.id);
    if (ids.has(item.id)) errors[`${key}.id`] = 'ID 重复，请保留每条内容独立的稳定 ID。';
    ids.add(item.id);
    if (!/^[A-Z0-9][A-Z0-9-]{0,15}$/u.test(item.code)) errors[`${key}.code`] = '展位编号须为 1–16 位字母、数字或短横线。';
    if (codes.has(item.code)) errors[`${key}.code`] = '展位编号重复（不区分大小写）。';
    codes.add(item.code);
    if (item.zone !== 'C') errors[`${key}.zone`] = '本阶段展位仅安排在 C 区。';
    enumField(`${key}.status`, item.status, contentSchema.boothStatuses);
    stringField(`${key}.organization`, item.organization, 160, item.status === 'confirmed');
    stringField(`${key}.project`, item.project, 200, item.status === 'confirmed');
    stringField(`${key}.internalNotes`, item.internalNotes, 4000, false);
  }

  // Equal endpoints are allowed: one session may begin when the preceding one ends.
  const scheduled = value.sessions.map((item, index) => ({ item, index })).filter(({ item }) => item.status === 'scheduled' && validTime(item.start) && validTime(item.end) && item.end > item.start);
  for (let left = 0; left < scheduled.length; left += 1) {
    for (let right = left + 1; right < scheduled.length; right += 1) {
      const a = scheduled[left];
      const b = scheduled[right];
      if (a.item.zone === b.item.zone && a.item.start < b.item.end && b.item.start < a.item.end) {
        errors[`sessions.${a.index}.start`] = '此场次与同区另一场次时间重叠。';
        errors[`sessions.${b.index}.start`] = '此场次与同区另一场次时间重叠。';
      }
    }
  }
  return { valid: Object.keys(errors).length === 0, errors, value };
}

/**
 * Produces the only permitted public projection. Callers must render text safely.
 * Does not persist, publish, authorize a speaker, or approve a booth by itself.
 * @param {unknown} input
 */
export function toPublicContent(input) {
  const result = validateContent(input);
  if (!result.valid) throw new TypeError('内容校验未通过，不能生成公开内容。');
  const { value } = result;
  const publicGuests = value.guests.filter(item => item.status === 'confirmed' && item.publicConsent && PORTRAIT_ID_PATTERN.test(item.portraitId));
  const guestsById = new Map(publicGuests.map(item => [item.id, item]));
  return {
    schemaVersion: value.schemaVersion,
    eventId: value.eventId,
    event: { ...value.event },
    sessions: value.sessions.filter((item) => item.status !== 'draft').map((item) => {
      const linked = item.guestId ? guestsById.get(item.guestId) : undefined;
      return {
        id: item.id, start: item.start, end: item.end, zone: item.zone, title: item.title,
        guestId: linked?.id ?? '',
        speakerName: item.guestId ? linked?.name ?? '' : item.speakerStatus === 'confirmed' ? item.speakerName : '',
        speakerStatus: item.guestId ? linked ? 'confirmed' : 'pending' : item.speakerStatus, status: item.status,
      };
    }),
    booths: value.booths.filter((item) => item.status === 'confirmed').map((item) => ({
      id: item.id, code: item.code, organization: item.organization, project: item.project, zone: item.zone, status: item.status,
    })),
    guests: publicGuests.map(item => ({
      id: item.id, name: item.name, company: item.company, ggjRole: item.ggjRole, portraitId: item.portraitId,
      portraitUrl: '/api/public/portraits/' + item.portraitId,
      // These affirmative publication fields keep the public snapshot idempotent
      // when it is validated again on restart; consent history stays private.
      status: 'confirmed', publicConsent: true,
    })),
  };
}
