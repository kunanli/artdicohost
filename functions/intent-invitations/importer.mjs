import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { CONTACT_SCHEMA_VERSION, MAX_CONTACTS, validateStoredContact } from '../../shared/contacts-schema.mjs';
import { failure, plainData, revision, identifier } from './errors.mjs';

const hash = value => createHash('sha256').update(value).digest('hex');

/** Pure migration plan for an explicitly selected original contacts.json.
 * No filesystem discovery, defaults, invented rows, identity merges or writes. */
export function prepareIntentContactImport({ snapshot, existingContacts = [] } = {}) {
  let source;
  try {
    if (typeof snapshot !== 'string' || Buffer.byteLength(snapshot) > 2 * 1024 * 1024) throw failure('INVALID_INPUT', 400);
    source = JSON.parse(snapshot);
  } catch { throw failure('INVALID_INPUT', 400); }
  if (!plainData(source) || source.storageVersion !== CONTACT_SCHEMA_VERSION || !revision(source.revision)
    || !Array.isArray(source.contacts) || source.contacts.length > MAX_CONTACTS || !Array.isArray(source.audit)
    || !Array.isArray(existingContacts) || existingContacts.length > MAX_CONTACTS) throw failure('INVALID_INPUT', 400);
  const seen = new Set(), sourceIdentities = new Set(), target = new Map();
  for (const contact of existingContacts) {
    if (!validateStoredContact(contact) || target.has(contact.id)) throw failure();
    target.set(contact.id, contact);
  }
  const rows = []; let added = 0, unchanged = 0, conflicts = 0, possibleDuplicates = 0;
  for (const item of source.contacts) {
    if (!validateStoredContact(item) || !plainData(item.source) || !identifier(item.source.key)
      || typeof item.source.rowId !== 'string' || item.id !== 'c_' + hash(item.source.key + '\0' + item.source.rowId).slice(0, 32)
      || item.sourceProfile && hash(JSON.stringify(item.sourceProfile)) !== item.sourceProfileDigest
      || seen.has(item.id) || sourceIdentities.has(item.source.key + '\0' + item.source.rowId)) throw failure('INVALID_INPUT', 400);
    seen.add(item.id); sourceIdentities.add(item.source.key + '\0' + item.source.rowId);
    const current = target.get(item.id);
    let status = current ? isDeepStrictEqual(current, item) ? 'unchanged' : 'source_changed' : 'new';
    const duplicates = [...existingContacts, ...source.contacts.filter(other => other.id !== item.id)].filter(other => other.id !== item.id
      && (item.profile.email && other.profile.email?.toLowerCase() === item.profile.email.toLowerCase()
        || item.profile.wechat && other.profile.wechat?.toLowerCase() === item.profile.wechat.toLowerCase())).map(other => other.id);
    if (status === 'new') added++; else if (status === 'unchanged') unchanged++; else conflicts++;
    if (duplicates.length && status === 'new') possibleDuplicates++;
    rows.push({ contact: structuredClone(item), status, duplicateContactIds: [...new Set(duplicates)] });
  }
  if (existingContacts.length + added > MAX_CONTACTS) throw failure('CAPACITY_EXCEEDED');
  return { digest: hash(snapshot), sourceRevision: source.revision, sourceAudit: structuredClone(source.audit),
    summary: { total: rows.length, added, unchanged, conflicts, possibleDuplicates }, canCommit: conflicts === 0, rows };
}

/** A production importer must atomically preserve source records and migration
 * audit in its own persistent repository. Manual createContact is not a fallback. */
export function createIntentContactImporter({ contactsStore } = {}) {
  if (!contactsStore || typeof contactsStore.read !== 'function') throw new TypeError('Explicit contacts repository required.');
  return Object.freeze({
    async preview({ snapshot, actor } = {}) {
      if (!plainData(actor) || !identifier(actor.id) || !actor.roles?.some(role => ['outreach', 'superadmin'].includes(role))) throw failure('FORBIDDEN', 403);
      const roster = await contactsStore.read(), plan = prepareIntentContactImport({ snapshot, existingContacts: roster.contacts });
      return { ...plan, expectedContactRevision: roster.revision };
    },
    async commit({ snapshot, expectedDigest, expectedContactRevision, allowPossibleDuplicates = false, actor } = {}) {
      if (!plainData(actor) || !identifier(actor.id) || !actor.roles?.some(role => ['outreach', 'superadmin'].includes(role))) throw failure('FORBIDDEN', 403);
      if (typeof contactsStore.importContacts !== 'function') throw failure('STORAGE_UNAVAILABLE');
      const roster = await contactsStore.read();
      if (roster.revision !== expectedContactRevision) throw failure('REVISION_CONFLICT', 409);
      const plan = prepareIntentContactImport({ snapshot, existingContacts: roster.contacts });
      if (expectedDigest !== plan.digest || !plan.canCommit || plan.summary.possibleDuplicates && allowPossibleDuplicates !== true) throw failure('REVISION_CONFLICT', 409);
      if (!plan.summary.added) return { revision: roster.revision, summary: plan.summary, imported: false };
      // The store must acknowledge one atomic migration preserving identities,
      // original dates, operations, invitation history and original audit.
      let result;
      try { result = await contactsStore.importContacts({ expectedRevision: expectedContactRevision, contacts: plan.rows.filter(row => row.status === 'new').map(row => row.contact),
        sourceAudit: plan.sourceAudit, sourceDigest: plan.digest, actorId: actor.id }); } catch { throw failure(); }
      if (result?.committed !== true || result?.revision !== expectedContactRevision + 1 || result?.sourceDigest !== plan.digest) throw failure();
      return { revision: result.revision, summary: plan.summary, imported: true };
    },
  });
}
