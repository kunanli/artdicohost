import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { CONTACT_SCHEMA_VERSION, MAX_CONTACTS, PROFILE_FIELDS, CONTACT_SOURCE_CHOICES, createEmptyContactOperations,
  validateImportedContact, validateStoredContact, validateContactOperations, validateInvitationSettings, INVITATION_CHANNELS } from '../../shared/contacts-schema.mjs';
import { failure, plainData, identifier, revision, iso } from './errors.mjs';

export const contactHash = value => createHash('sha256').update(value).digest('hex');
const HASH = /^[a-f0-9]{64}$/u;
const exact = (value, names) => plainData(value) && Object.keys(value).length === names.length && names.every(name => Object.hasOwn(value, name));
const profileFields = [...Object.keys(PROFILE_FIELDS), ...Object.keys(CONTACT_SOURCE_CHOICES), 'categories', 'interests'];

export function validateSnapshotContact(contact) {
  const optional = Object.hasOwn(contact ?? {}, 'sourceProfile') ? ['sourceProfile', 'sourceProfileDigest'] : [];
  const operationFields = Object.keys(createEmptyContactOperations());
  if (!exact(contact, ['id', 'source', 'profile', 'operations', 'invitation', 'createdAt', 'updatedAt', ...optional])
    || !exact(contact.source, ['key', 'rowId', 'digest', 'importedAt']) || !exact(contact.profile, profileFields)
    || !validateStoredContact(contact) || !identifier(contact.id) || contact.id !== 'c_' + contactHash(contact.source.key + '\0' + contact.source.rowId).slice(0, 32)
    || !iso(contact.createdAt) || !iso(contact.updatedAt) || !iso(contact.source.importedAt)
    || contact.createdAt !== contact.source.importedAt || contact.updatedAt < contact.createdAt
    || !exact(contact.operations, operationFields.filter(name => !['participationForms', 'sessionRoles', 'organizationMemberships'].includes(name) || Object.hasOwn(contact.operations, name)))
    || !exact(contact.invitation, ['settings', 'generatedAt', 'sentAt', 'sentGenerationAt', 'channel'])) throw failure('INVALID_INPUT', 400);
  const normalized = validateImportedContact({ ...contact.profile, sourceRowId: contact.source.rowId });
  const { sourceRowId: _, ...profile } = normalized.value;
  if (!normalized.valid || !isDeepStrictEqual(profile, contact.profile)) throw failure('INVALID_INPUT', 400);
  const original = contact.sourceProfile ?? contact.profile;
  if (contact.sourceProfile && (!exact(contact.sourceProfile, profileFields) || contact.sourceProfileDigest !== contactHash(JSON.stringify(contact.sourceProfile)))
    || contact.source.digest !== contactHash(JSON.stringify(original))) throw failure('INVALID_INPUT', 400);
  const operations = validateContactOperations(contact.operations);
  if (!operations.valid || !isDeepStrictEqual(operations.value, { ...contact.operations, participationForms: contact.operations.participationForms ?? [], sessionRoles: contact.operations.sessionRoles ?? [], organizationMemberships: contact.operations.organizationMemberships ?? [] })) throw failure('INVALID_INPUT', 400);
  const invitation = contact.invitation;
  if (invitation.settings !== null && !isDeepStrictEqual(validateInvitationSettings(invitation.settings).value, invitation.settings)) throw failure('INVALID_INPUT', 400);
  for (const name of ['generatedAt', 'sentAt', 'sentGenerationAt']) if (invitation[name] !== null
    && (!iso(invitation[name]) || invitation[name] < contact.createdAt || invitation[name] > contact.updatedAt)) throw failure('INVALID_INPUT', 400);
  return structuredClone(contact);
}

/** Validate the historical local schema and every archived audit entry. Unknown
 * actions/fields, invented creation, altered source hashes and stale invitation
 * histories fail closed; no arbitrary audit JSON becomes a trusted baseline. */
export function readContactSnapshot(snapshot) {
  if (typeof snapshot !== 'string' || Buffer.byteLength(snapshot) > 2 * 1024 * 1024) throw failure('INVALID_INPUT', 400);
  let value; try { value = JSON.parse(snapshot); } catch { throw failure('INVALID_INPUT', 400); }
  if (!exact(value, ['storageVersion', 'revision', 'contacts', 'audit']) || value.storageVersion !== CONTACT_SCHEMA_VERSION
    || !revision(value.revision) || !Array.isArray(value.contacts) || value.contacts.length > MAX_CONTACTS
    || !Array.isArray(value.audit) || value.audit.length !== value.revision || value.audit.length > 1000) throw failure('INVALID_INPUT', 400);
  const contacts = value.contacts.map(validateSnapshotContact), byId = new Map(), identities = new Set();
  for (const contact of contacts) {
    const identity = contact.source.key + '\0' + contact.source.rowId;
    if (byId.has(contact.id) || identities.has(identity)) throw failure('INVALID_INPUT', 400);
    byId.set(contact.id, contact); identities.add(identity);
  }
  const created = new Set(), last = new Map(), generated = new Map(), sent = new Map();
  const importedAt = new Map(); let previous = '', importedCount = 0;
  for (const [index, entry] of value.audit.entries()) {
    const names = ['action', 'actorId', 'revision', 'at'];
    const optionalSource = Object.hasOwn(entry ?? {}, 'sourceDigest') ? ['sourceDigest'] : [];
    const optionalSettings = Object.hasOwn(entry ?? {}, 'settingsDigest') ? ['settingsDigest'] : [];
    const extras = entry?.action === 'import_contacts' ? ['added', 'unchanged', 'duplicateReviewAccepted']
      : entry?.action === 'export_contacts' ? ['count', 'includeContact', 'includeAnswers', 'workbookSha256']
      : entry?.action === 'create_contact' ? ['contactId', 'consentSource', 'contactConsent', ...optionalSource]
        : entry?.action === 'record_invitation_generated' ? ['contactId', ...optionalSettings]
          : entry?.action === 'record_invitation_manually_sent' ? ['contactId', 'channel']
            : ['save_contact_profile', 'save_contact_operations'].includes(entry?.action) ? ['contactId'] : null;
    if (!extras || !exact(entry, [...names, ...extras]) || !identifier(entry.actorId) || entry.revision !== index + 1
      || !iso(entry.at) || entry.at < previous) throw failure('INVALID_INPUT', 400);
    previous = entry.at;
    if (entry.action === 'export_contacts') {
      if (entry.count !== created.size || typeof entry.includeContact !== 'boolean' || typeof entry.includeAnswers !== 'boolean'
        || !HASH.test(entry.workbookSha256 ?? '')) throw failure('INVALID_INPUT', 400);
      continue;
    }
    if (entry.action === 'import_contacts') {
      if (!Number.isSafeInteger(entry.added) || entry.added < 1 || entry.added > MAX_CONTACTS
        || !revision(entry.unchanged) || typeof entry.duplicateReviewAccepted !== 'boolean') throw failure('INVALID_INPUT', 400);
      importedCount += entry.added;
      importedAt.set(entry.at, (importedAt.get(entry.at) ?? 0) + entry.added);
      for (const contact of contacts.filter(item => item.source.key !== 'manual' && item.createdAt === entry.at && !created.has(item.id))) {
        created.add(contact.id); last.set(contact.id, entry.at);
      }
      continue;
    }
    const contact = byId.get(entry.contactId);
    if (!contact) throw failure('INVALID_INPUT', 400);
    if (entry.action === 'create_contact') {
      if (created.has(contact.id) || contact.source.key !== 'manual' || entry.at !== contact.createdAt
        || entry.consentSource !== 'staff_assertion' || entry.contactConsent !== (contact.sourceProfile ?? contact.profile).contactConsent
        || optionalSource.length && entry.sourceDigest !== contact.source.digest) throw failure('INVALID_INPUT', 400);
      created.add(contact.id);
    } else if (!created.has(contact.id)) throw failure('INVALID_INPUT', 400);
    if (entry.action === 'record_invitation_generated') {
      if (contact.profile.contactConsent !== 'consented' || optionalSettings.length && !HASH.test(entry.settingsDigest)) throw failure('INVALID_INPUT', 400);
      generated.set(contact.id, { at: entry.at, digest: entry.settingsDigest });
    }
    if (entry.action === 'record_invitation_manually_sent') {
      if (!generated.has(contact.id) || contact.profile.contactConsent !== 'consented' || !INVITATION_CHANNELS.includes(entry.channel)) throw failure('INVALID_INPUT', 400);
      sent.set(contact.id, { at: entry.at, generatedAt: generated.get(contact.id).at, channel: entry.channel });
    }
    last.set(contact.id, entry.at);
  }
  if (created.size !== contacts.length || importedCount !== contacts.filter(contact => contact.source.key !== 'manual').length) throw failure('INVALID_INPUT', 400);
  for (const [at, count] of importedAt) if (contacts.filter(contact => contact.source.key !== 'manual' && contact.createdAt === at).length !== count) throw failure('INVALID_INPUT', 400);
  for (const contact of contacts) {
    const invitation = contact.invitation, generation = generated.get(contact.id), delivery = sent.get(contact.id);
    if (last.get(contact.id) !== contact.updatedAt || invitation.generatedAt !== (generation?.at ?? null)
      || generation?.digest && generation.digest !== contactHash(JSON.stringify(invitation.settings))
      || invitation.sentAt !== (delivery?.at ?? null) || invitation.sentGenerationAt !== (delivery?.generatedAt ?? null)
      || invitation.channel !== (delivery?.channel ?? null)) throw failure('INVALID_INPUT', 400);
  }
  return { ...value, contacts };
}

export function readMigrationSource(snapshot, kind, fileHash, payloadHash) {
  if (!HASH.test(fileHash ?? '') || !HASH.test(payloadHash ?? '') || !['snapshot', 'rows'].includes(kind)) throw failure('INVALID_INPUT', 400);
  const value = readContactSnapshot(snapshot);
  if (kind === 'snapshot') {
    if (contactHash(snapshot) !== fileHash || fileHash !== payloadHash) throw failure('INVALID_INPUT', 400);
  } else {
    const sourceKey = value.contacts[0]?.source.key;
    if (!sourceKey || value.contacts.some(contact => contact.source.key !== sourceKey)) throw failure('INVALID_INPUT', 400);
    const rows = value.contacts.map(contact => validateImportedContact({ ...contact.profile, sourceRowId: contact.source.rowId }).value);
    if (contactHash(JSON.stringify({ sourceKey, rows })) !== payloadHash) throw failure('INVALID_INPUT', 400);
  }
  return value;
}
