import { createHash } from 'node:crypto';
import { IntentInvitationError, failure, identifier, plainData, revision } from './errors.mjs';
import { INVITATION_POSTER_RENDER_VERSION } from '../../shared/organizer-progress.mjs';

export const MAX_BATCH_INVITATIONS = 100;
export function validateBatchSelection(contactIds) {
  if (!Array.isArray(contactIds) || !contactIds.length || contactIds.length > MAX_BATCH_INVITATIONS
    || contactIds.some(id => !identifier(id)) || new Set(contactIds).size !== contactIds.length) throw failure('INVALID_INPUT', 400);
}
function token(snapshot, actor, renderVersion) {
  return 'b_' + createHash('sha256').update(JSON.stringify(['manual-invitation-batch-v1', actor.id,
    snapshot.contactRevision, snapshot.bindings, ...(renderVersion !== undefined ? [renderVersion] : [])])).digest('hex');
}
function previewValue(snapshot, actor, renderVersion) {
  return { contactRevision: snapshot.contactRevision, previewToken: token(snapshot, actor, renderVersion), entries: snapshot.entries,
    summary: { selected: snapshot.entries.length, eligible: snapshot.entries.filter(item => item.eligible).length,
      skipped: snapshot.entries.filter(item => !item.eligible).length } };
}

/** Stateless precheck followed by explicitly confirmed, individually durable
 * manual preparation. No process-local tokens, email, download or retry. */
export function createInvitationBatchOperations({ inspect, issueManual, authorize } = {}) {
  if (![inspect, issueManual, authorize].every(value => typeof value === 'function')) throw new TypeError('Explicit batch dependencies required.');
  async function checked(input) {
    const actor = authorize(input.actor);
    validateBatchSelection(input.contactIds);
    if (!revision(input.expectedContactRevision) || input.renderVersion !== undefined && input.renderVersion !== INVITATION_POSTER_RENDER_VERSION) throw failure('INVALID_INPUT', 400);
    const snapshot = await inspect({ contactIds: input.contactIds, expectedContactRevision: input.expectedContactRevision, actor, renderVersion: input.renderVersion });
    if (!plainData(snapshot) || snapshot.contactRevision !== input.expectedContactRevision
      || !Array.isArray(snapshot.entries) || !Array.isArray(snapshot.bindings) || snapshot.entries.length !== input.contactIds.length
      || snapshot.entries.some((entry, index) => entry.contactId !== input.contactIds[index])) throw failure();
    return { actor, snapshot };
  }
  return Object.freeze({
    async preview(input = {}) {
      const { actor, snapshot } = await checked(input);
      return previewValue(snapshot, actor, input.renderVersion);
    },
    async prepare(input = {}) {
      if (input.confirmPrepare !== true || typeof input.previewToken !== 'string' || !/^b_[a-f0-9]{64}$/u.test(input.previewToken)) throw failure('INVALID_INPUT', 400);
      const { actor, snapshot } = await checked(input);
      // The hash is a state binding, never an authorization token. Every call
      // authenticates and recomputes consent/source/admission/review checks.
      if (input.previewToken !== token(snapshot, actor, input.renderVersion)) throw failure('REVISION_CONFLICT', 409);
      const results = []; let stopped = false;
      for (const entry of snapshot.entries) {
        if (!entry.eligible) { results.push({ contactId: entry.contactId, status: 'skipped', code: entry.reason }); continue; }
        if (stopped) { results.push({ contactId: entry.contactId, status: 'failed', code: 'BATCH_NOT_ATTEMPTED' }); continue; }
        try {
          const result = await issueManual({ contactId: entry.contactId, expectedContactRevision: snapshot.contactRevision,
            expectedRegistrationId: entry.registrationId, channel: 'manual', actor, batchId: input.previewToken,
            ...(input.renderVersion !== undefined ? { renderVersion: input.renderVersion } : {}) });
          if (!plainData(result) || !plainData(result.invitation) || result.invitation.channel !== 'manual'
            || result.invitation.status !== 'prepared' || result.invitation.registrationId !== entry.registrationId
            || result.contactRevision !== snapshot.contactRevision || typeof result.replayed !== 'boolean') throw failure();
          results.push({ contactId: entry.contactId, status: result.replayed ? 'replayed' : 'prepared', invitation: result.invitation });
        } catch (error) {
          const code = error instanceof IntentInvitationError ? error.code : 'STORAGE_UNAVAILABLE';
          const unknown = code === 'STORAGE_UNAVAILABLE';
          results.push({ contactId: entry.contactId, status: unknown ? 'unknown' : 'failed', code });
          // No automatic write retry after an unknown ACK, conflict or lost
          // authorization. Explicit later preview can read a committed record.
          if (unknown || ['REVISION_CONFLICT', 'FORBIDDEN', 'CAPACITY_EXCEEDED'].includes(code)) stopped = true;
        }
      }
      const summary = { selected: results.length, prepared: 0, replayed: 0, skipped: 0, failed: 0, unknown: 0 };
      for (const item of results) summary[item.status]++;
      const successful = summary.prepared + summary.replayed;
      return { contactRevision: snapshot.contactRevision, status: summary.failed || summary.unknown ? successful ? 'partial' : 'unavailable' : 'completed', results, summary };
    },
  });
}
