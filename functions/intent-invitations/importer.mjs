import { validateImportedContact, createEmptyContactOperations, CONTACT_SCHEMA_VERSION, MAX_IMPORT_ROWS } from '../../shared/contacts-schema.mjs';
import { failure, plainData, revision, identifier, iso } from './errors.mjs';
import { readContactSnapshot, validateSnapshotContact, contactHash } from './contact-snapshot.mjs';

const HASH = /^[a-f0-9]{64}$/u;
const sourceIdentity = contact => contact.source.key + '\0' + contact.source.rowId;
export function rowsSourceDigest(sourceKey, rows) { return contactHash(JSON.stringify({ sourceKey, rows })); }

/** Pure plan. Existing source identities keep subsequent staff edits; no merge,
 * overwrite, fabricated consent or process-local preview token. */
export function prepareIntentContactImport({ snapshot, existingContacts = [] } = {}) {
  const source = readContactSnapshot(snapshot);
  if (!Array.isArray(existingContacts)) throw failure();
  const target = new Map(), identities = new Map();
  for (const contact of existingContacts) {
    validateSnapshotContact(contact);
    if (target.has(contact.id) || identities.has(sourceIdentity(contact))) throw failure();
    target.set(contact.id, contact); identities.set(sourceIdentity(contact), contact);
  }
  const rows = []; let added = 0, unchanged = 0, conflicts = 0, possibleDuplicates = 0;
  for (const contact of source.contacts) {
    const current = target.get(contact.id) ?? identities.get(sourceIdentity(contact));
    const status = current ? current.id === contact.id && current.source.digest === contact.source.digest ? 'unchanged' : 'source_changed' : 'new';
    const duplicateContactIds = [...existingContacts, ...source.contacts].filter(other => other.id !== contact.id
      && (contact.profile.email && other.profile.email.toLowerCase() === contact.profile.email.toLowerCase()
        || contact.profile.wechat && other.profile.wechat.toLowerCase() === contact.profile.wechat.toLowerCase())).map(other => other.id);
    if (status === 'new') added++; else if (status === 'unchanged') unchanged++; else conflicts++;
    if (duplicateContactIds.length && status === 'new') possibleDuplicates++;
    rows.push({ contact, status, duplicateContactIds: [...new Set(duplicateContactIds)] });
  }
  return { digest: contactHash(snapshot), sourceRevision: source.revision, sourceAudit: source.audit,
    summary: { total: rows.length, new: added, added, unchanged, conflicts, invalid: 0, possibleDuplicates }, canCommit: conflicts === 0, rows };
}

function inputSnapshot(input, actorId, now, allowPossibleDuplicates = false) {
  if (!plainData(input) || !['snapshot', 'rows'].includes(input.kind) || !HASH.test(input.originalSha256 ?? '')) throw failure('INVALID_INPUT', 400);
  if (input.kind === 'snapshot') {
    if (typeof input.snapshot !== 'string' || contactHash(input.snapshot) !== input.originalSha256) throw failure('INVALID_INPUT', 400);
    readContactSnapshot(input.snapshot);
    return { snapshot: input.snapshot, sourceDigest: contactHash(input.snapshot), sourceKind: 'snapshot', sourceFileSha256: input.originalSha256 };
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/u.test(input.sourceKey ?? '') || !Array.isArray(input.rows) || !input.rows.length || input.rows.length > MAX_IMPORT_ROWS
    || typeof input.sourceFileBase64 !== 'string' || input.sourceFileBase64.length > Math.ceil(2 * 1024 * 1024 / 3) * 4
    || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(input.sourceFileBase64)) throw failure('INVALID_INPUT', 400);
  const file = Buffer.from(input.sourceFileBase64, 'base64');
  if (!file.length || file.length > 2 * 1024 * 1024 || file.toString('base64') !== input.sourceFileBase64 || contactHash(file) !== input.originalSha256) throw failure('INVALID_INPUT', 400);
  const seen = new Set(), normalized = [];
  for (const row of input.rows) {
    if (!plainData(row)) throw failure('INVALID_INPUT', 400);
    const result = validateImportedContact(row);
    if (!result.valid || seen.has(result.value.sourceRowId)) throw failure('INVALID_INPUT', 400);
    seen.add(result.value.sourceRowId); normalized.push(result.value);
  }
  let at; try { at = new Date(now()).toISOString(); } catch { throw failure(); }
  if (!iso(at)) throw failure();
  const contacts = normalized.map(({ sourceRowId, ...profile }) => ({ id: 'c_' + contactHash(input.sourceKey + '\0' + sourceRowId).slice(0, 32),
    source: { key: input.sourceKey, rowId: sourceRowId, digest: contactHash(JSON.stringify(profile)), importedAt: at },
    profile, operations: createEmptyContactOperations(), invitation: { settings: null, generatedAt: null, sentAt: null, sentGenerationAt: null, channel: null }, createdAt: at, updatedAt: at }));
  // The actual staff-reviewed normalization import is audited now; no fake
  // historic creation. Original XLSX bytes are hashed then discarded.
  const snapshot = JSON.stringify({ storageVersion: CONTACT_SCHEMA_VERSION, revision: 1, contacts,
    audit: [{ action: 'import_contacts', actorId, revision: 1, at, added: contacts.length, unchanged: 0, duplicateReviewAccepted: allowPossibleDuplicates }] });
  readContactSnapshot(snapshot);
  return { snapshot, sourceDigest: rowsSourceDigest(input.sourceKey, normalized), sourceKind: 'rows', sourceFileSha256: input.originalSha256 };
}
function staff(actor) {
  if (!plainData(actor) || !identifier(actor.id) || !Array.isArray(actor.roles) || !actor.roles.some(role => ['outreach', 'superadmin'].includes(role))) throw failure('FORBIDDEN', 403);
  return actor.id;
}
const token = (source, expectedRevision, actorId) => contactHash(JSON.stringify({ kind: source.sourceKind, payload: source.sourceDigest, file: source.sourceFileSha256, expectedRevision, actorId }));

/** Stateless, revision- and digest-bound preview, with one journal commit. */
export function createIntentContactImporter({ contactsStore, now = () => Date.now() } = {}) {
  if (!contactsStore || typeof contactsStore.read !== 'function' || typeof now !== 'function') throw new TypeError('Explicit contacts repository required.');
  async function load() { try { const roster = await contactsStore.read(); if (!revision(roster?.revision) || !Array.isArray(roster.contacts)) throw failure(); return roster; } catch { throw failure(); } }
  return Object.freeze({
    async preview({ actor, ...input } = {}) {
      const actorId = staff(actor), source = inputSnapshot(input, actorId, now), roster = await load();
      const plan = prepareIntentContactImport({ snapshot: source.snapshot, existingContacts: roster.contacts });
      return { previewToken: token(source, roster.revision, actorId), expectedRevision: roster.revision,
        summary: plan.summary, rows: [], canCommit: plan.canCommit, sourceDigest: source.sourceDigest };
    },
    async commit({ expectedRevision, previewToken, allowPossibleDuplicates = false, confirmSource = false, actor, ...input } = {}) {
      const actorId = staff(actor);
      if (!revision(expectedRevision) || typeof allowPossibleDuplicates !== 'boolean' || confirmSource !== true || typeof contactsStore.importContacts !== 'function') throw failure('INVALID_INPUT', 400);
      const source = inputSnapshot(input, actorId, now, allowPossibleDuplicates);
      if (previewToken !== token(source, expectedRevision, actorId)) throw failure('REVISION_CONFLICT', 409);
      const roster = await load(), plan = prepareIntentContactImport({ snapshot: source.snapshot, existingContacts: roster.contacts });
      if (!plan.canCommit || plan.summary.possibleDuplicates && !allowPossibleDuplicates) throw failure('REVISION_CONFLICT', 409);
      let result;
      try { result = await contactsStore.importContacts({ expectedRevision, ...source, actorId, allowPossibleDuplicates }); }
      catch (error) { if (error?.status === 409) throw failure('REVISION_CONFLICT', 409); if (error?.status === 422) throw failure('INVALID_INPUT', 422); throw failure(); }
      if (result?.committed !== true || result?.sourceDigest !== source.sourceDigest || !revision(result.revision)
        || typeof result.imported !== 'boolean' || result.imported && result.revision !== expectedRevision + 1 || !result.imported && result.revision < expectedRevision) throw failure();
      const confirmed = await load();
      if (confirmed.revision < result.revision) throw failure();
      return { revision: confirmed.revision, contacts: confirmed.contacts, summary: plan.summary, imported: result.imported };
    },
  });
}
