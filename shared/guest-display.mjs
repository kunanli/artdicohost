/** Display projection of an already-published guest list; it does not grant publication permission. */
import { GUEST_PUBLIC_ROLES, isPublicWebsite } from './content-schema.mjs';
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value)
  && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const ownValue = (value, key) => Object.getOwnPropertyDescriptor(value, key)?.value;
const line = (value, limit, required = true) => typeof value === 'string'
  && [...value.trim()].length <= limit && (!required || value.trim().length > 0)
  && !/[\u0000-\u001f\u007f]/u.test(value) ? value.trim() : null;
const portrait = /^[a-f0-9]{64}\.(?:jpg|png|webp)$/u;

/** Returns safe display values and a same-origin image path. Unapproved and malformed entries stay hidden.
 * @param {unknown} input
 * @returns {{id:string,name:string,company:string,ggjRole:string,portraitId:string,portraitUrl:string}[]}
 */
export function publicGuestCards(input) {
  if (!Array.isArray(input) || input.length > 200) return [];
  const seen = new Set();
  return input.flatMap(value => {
    if (!record(value) || ownValue(value, 'status') !== 'confirmed' || ownValue(value, 'publicConsent') !== true) return [];
    const id = ownValue(value, 'id');
    const portraitId = ownValue(value, 'portraitId');
    const name = line(ownValue(value, 'name'), 120);
    const company = line(ownValue(value, 'company'), 160);
    const ggjRole = line(ownValue(value, 'ggjRole') ?? '', 160, false);
    if (typeof id !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/u.test(id) || seen.has(id)
      || typeof portraitId !== 'string' || portraitId !== '' && !portrait.test(portraitId) || name === null || company === null || ggjRole === null) return [];
    const extras = {};
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
    return [{ id, name, company, ggjRole, portraitId, portraitUrl: portraitId ? '/api/public/portraits/' + portraitId : '', ...extras }];
  });
}

/** Only actual scheduled, published associations are shown under a person's card. */
export function publicGuestSessions(sessions, guestId) {
  if (!Array.isArray(sessions) || sessions.length > 200 || typeof guestId !== 'string') return [];
  const seen = new Set();
  return sessions.flatMap(item => {
    if (!record(item) || ownValue(item,'status') !== 'scheduled' || ownValue(item,'guestId') !== guestId
      || ownValue(item,'speakerStatus') !== 'confirmed') return [];
    const id = ownValue(item,'id'), title = line(ownValue(item,'title'),200), start = ownValue(item,'start'), end = ownValue(item,'end'), zone = ownValue(item,'zone');
    if (typeof id !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/u.test(id) || seen.has(id) || !title
      || !/^(?:[01]\d|2[0-3]):[0-5]\d$/u.test(start) || !/^(?:[01]\d|2[0-3]):[0-5]\d$/u.test(end) || end <= start || !['A','B','C'].includes(zone)) return [];
    seen.add(id);return [{id,title,start,end,zone}];
  }).sort((a,b) => a.start.localeCompare(b.start) || a.zone.localeCompare(b.zone));
}
