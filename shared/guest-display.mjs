/** Display projection of an already-published guest list; it does not grant publication permission. */
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
      || typeof portraitId !== 'string' || !portrait.test(portraitId) || name === null || company === null || ggjRole === null) return [];
    seen.add(id);
    return [{ id, name, company, ggjRole, portraitId, portraitUrl: '/api/public/portraits/' + portraitId }];
  });
}
