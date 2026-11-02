/** Display projection of an already-published guest list; it does not grant publication permission. */
import { GUEST_PUBLIC_ROLES, SESSION_PARTICIPANT_ROLES, isPublicWebsite, normalizeGuestAttendance } from './content-schema.mjs';
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value)
  && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const ownValue = (value, key) => Object.getOwnPropertyDescriptor(value, key)?.value;
const line = (value, limit, required = true) => typeof value === 'string'
  && [...value.trim()].length <= limit && (!required || value.trim().length > 0)
  && !/[\u0000-\u001f\u007f]/u.test(value) ? value.trim() : null;
const portrait = /^[a-f0-9]{64}\.(?:jpg|png|webp)$/u;

/** Returns safe display values and a same-origin image path. Only an explicit private setting hides a valid entry.
 * @param {unknown} input
 * @returns {{id:string,name:string,company:string,ggjRole:string,portraitId:string,portraitUrl:string}[]}
 */
function safeGuestProfiles(input) {
  if (!Array.isArray(input) || input.length > 200) return [];
  const seen = new Set();
  return input.flatMap(value => {
    if (!record(value) || Object.hasOwn(value, 'visibility') && ownValue(value, 'visibility') !== 'public'
      || !['pending','confirmed'].includes(ownValue(value, 'status'))) return [];
    const id = ownValue(value, 'id');
    const portraitId = ownValue(value, 'portraitId');
    const name = line(ownValue(value, 'name'), 120, ownValue(value, 'status') === 'confirmed');
    const company = line(ownValue(value, 'company'), 160, ownValue(value, 'status') === 'confirmed');
    const ggjRole = line(ownValue(value, 'ggjRole') ?? '', 160, false);
    if (typeof id !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/u.test(id) || seen.has(id)
      || typeof portraitId !== 'string' || portraitId !== '' && !portrait.test(portraitId) || name === null || company === null || ggjRole === null) return [];
    const extras = ownValue(value, 'status') === 'pending' ? { status: 'pending' } : {};
    for (const [key,limit] of [['title',200],['bio',4000],['website',500]]) {
      if (!Object.hasOwn(value,key)) continue;
      const supplied = ownValue(value,key);
      const checked = key === 'bio' ? typeof supplied === 'string' && [...supplied.trim()].length <= limit
        && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(supplied) ? supplied.trim() : null : line(supplied,limit,false);
      if (checked === null || key === 'website' && !isPublicWebsite(checked)) return [];
      extras[key] = checked;
    }
    if (Object.hasOwn(value,'publicRoles')) {
      const roles = ownValue(value,'publicRoles');
      if (!Array.isArray(roles) || roles.length > 4 || roles.some(role => !GUEST_PUBLIC_ROLES.includes(role)) || new Set(roles).size !== roles.length) return [];
      extras.publicRoles = [...roles];
    }
    seen.add(id);
    return [{ id, name: name || '嘉宾姓名待补', company, ggjRole, portraitId, portraitUrl: portraitId ? '/api/public/portraits/' + portraitId : '', ...extras }];
  });
}

/** Public visibility controls the cards; verified attendance remains a separate
 * fact. Invalid proofs fail closed rather than inventing or discarding replies. */
export function publicGuestCards(input, guestAttendance) {
  const profiles = safeGuestProfiles(input);
  if (guestAttendance === undefined) return profiles.map(item => ({ ...item, attendance: 'pending' }));
  let confirmed;
  try { confirmed = new Set(normalizeGuestAttendance(guestAttendance, profiles.map(item => item.id)).confirmedGuestIds); }
  catch { return []; }
  return profiles.map(item => ({ ...item, attendance: confirmed.has(item.id) ? 'attending' : 'pending' }));
}

/** Show the affiliation separately so it never substitutes for a position. */
export function publicGuestAffiliation(guest) {
  return record(guest) ? line(ownValue(guest,'company')??'',160,false)||'' : '';
}

/** Use only a position or role already present in the safe public profile. */
export function publicGuestSubtitle(guest) {
  if(!record(guest))return {text:'',kind:'none'};
  for(const [key,limit,kind] of [['title',200,'title'],['ggjRole',160,'role']]){
    const value=line(ownValue(guest,key)??'',limit,false);
    if(value)return {text:value,kind};
  }
  return {text:'',kind:'none'};
}

/** Timetable roles are editorial associations, separate from guest-card eligibility.
 * Only saved public profile values supply names; private contact duties never do. */
export function publicSessionParticipants(session, guests, guestAttendance) {
  if (!record(session) || ownValue(session, 'status') !== 'scheduled') return [];
  const profiles = safeGuestProfiles(guests), byId = new Map(profiles.map(item => [item.id, item]));
  let confirmed = new Set();
  try { confirmed = new Set(normalizeGuestAttendance(guestAttendance, profiles.map(item => item.id)).confirmedGuestIds); }
  catch { /* No proof means the editorial arrangement is still unconfirmed. */ }
  const result = [], seen = new Set();
  const add = (guestId, roles) => {
    const profile = byId.get(guestId);
    if (!profile || seen.has(guestId) || !Array.isArray(roles) || !roles.length
      || roles.length > SESSION_PARTICIPANT_ROLES.length || new Set(roles).size !== roles.length
      || roles.some(role => !SESSION_PARTICIPANT_ROLES.includes(role))) return;
    seen.add(guestId);
    result.push({guestId, name: profile.name, roles: [...roles], attendance: confirmed.has(guestId) ? 'attending' : 'pending'});
  };
  const primary = ownValue(session, 'guestId');
  if (primary) add(primary, ['speaker']);
  else if (ownValue(session, 'speakerStatus') === 'confirmed') {
    const name = line(ownValue(session, 'speakerName'), 120);
    if (name) result.push({guestId: '', name, roles: ['speaker'], attendance: 'pending'});
  }
  const participants = ownValue(session, 'participants');
  if (Array.isArray(participants) && participants.length <= 20) for (const participant of participants) {
    if (record(participant)) add(ownValue(participant, 'guestId'), ownValue(participant, 'roles'));
  }
  return result;
}

/** Only actual scheduled, published associations are shown under a person's card. */
export function publicGuestSessions(sessions, guestId) {
  if (!Array.isArray(sessions) || sessions.length > 200 || typeof guestId !== 'string') return [];
  const seen = new Set();
  return sessions.flatMap(item => {
    if (!record(item) || ownValue(item,'status') !== 'scheduled') return [];
    const participants = ownValue(item, 'participants');
    const additional = Array.isArray(participants) && participants.length <= 20 && participants.some(entry => record(entry)
      && ownValue(entry, 'guestId') === guestId && Array.isArray(ownValue(entry, 'roles')) && ownValue(entry, 'roles').length
      && ownValue(entry, 'roles').every(role => SESSION_PARTICIPANT_ROLES.includes(role)));
    if (ownValue(item,'guestId') !== guestId && !additional) return [];
    const id = ownValue(item,'id'), title = line(ownValue(item,'title'),200), start = ownValue(item,'start'), end = ownValue(item,'end'), zone = ownValue(item,'zone');
    if (typeof id !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/u.test(id) || seen.has(id) || !title
      || !/^(?:[01]\d|2[0-3]):[0-5]\d$/u.test(start) || !/^(?:[01]\d|2[0-3]):[0-5]\d$/u.test(end) || end <= start || !['A','B','C'].includes(zone)) return [];
    seen.add(id);return [{id,title,start,end,zone}];
  }).sort((a,b) => a.start.localeCompare(b.start) || a.zone.localeCompare(b.zone));
}
