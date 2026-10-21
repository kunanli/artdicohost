/** Existing roles stay independent. The complete preset adds event operations only. */
export const COLLABORATOR_ROLES = Object.freeze(['editor', 'publisher', 'outreach', 'reviewer']);
const KNOWN_ROLES = Object.freeze([...COLLABORATOR_ROLES, 'superadmin']);

function rolesOf(user) {
  if (!user || typeof user !== 'object' || Array.isArray(user)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(user))) return [];
  const field = Object.getOwnPropertyDescriptor(user, 'roles');
  const roles = field && Object.hasOwn(field, 'value') ? field.value : null;
  if (!Array.isArray(roles) || Object.getPrototypeOf(roles) !== Array.prototype || roles.length < 1 || roles.length > KNOWN_ROLES.length) return [];
  const result = [];
  for (let index = 0; index < roles.length; index++) {
    const entry = Object.getOwnPropertyDescriptor(roles, String(index));
    if (!entry || !Object.hasOwn(entry, 'value') || !KNOWN_ROLES.includes(entry.value) || result.includes(entry.value)) return [];
    result.push(entry.value);
  }
  return result;
}

export function canManageAccounts(user) { return rolesOf(user).includes('superadmin'); }
export function canRecoverSystem(user) { return rolesOf(user).includes('superadmin'); }
export function canManageEventOperations(user) {
  const roles = rolesOf(user);
  return roles.includes('superadmin') || COLLABORATOR_ROLES.every(role => roles.includes(role));
}
