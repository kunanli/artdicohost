import { validObjectKey } from './oss-client.mjs';

export const ACCEPTANCE_RUN_PATTERN = /^r[1-9][0-9]{0,19}-a[1-9][0-9]{0,9}-[a-f0-9]{16}-[a-f0-9]{40}$/u;
const INSTANCE = /^[a-f0-9]{32}$/u;
const LOGICAL = /^cms\/v1\/(?:content|contacts|portraits|sessions|limits|probes|registrations|registration-reviews|intent-invitations|group-invites|users|maintenance|restores)\//u;
const invalid = () => new TypeError('Acceptance object scope is invalid.');

/** Application-level isolation inside the existing private role prefix.
 * The adapter accepts logical production-shaped keys, never an already scoped
 * key. Every operation, including session and login-budget objects, is mapped.
 * This is not a new IAM boundary and does not grant list or delete capability.
 */
export function createAcceptanceObjects({ objects, runId, instanceId, onOperation = () => {} } = {}) {
  if (!objects || !['get', 'putImmutable', 'append'].every(name => typeof objects[name] === 'function')
    || typeof runId !== 'string' || !ACCEPTANCE_RUN_PATTERN.test(runId)
    || typeof instanceId !== 'string' || !INSTANCE.test(instanceId) || typeof onOperation !== 'function') throw invalid();
  const prefix = `cms/v1/acceptance/${runId}/${instanceId}/`;
  function key(value) {
    if (!validObjectKey(value) || !LOGICAL.test(value)) throw invalid();
    const mapped = prefix + value.slice('cms/v1/'.length);
    if (!validObjectKey(mapped)) throw invalid();
    return mapped;
  }
  return Object.freeze({
    get(value, options) { const mapped = key(value); onOperation('get', mapped); return objects.get(mapped, options); },
    putImmutable(value, bytes, options) { const mapped = key(value); onOperation('putImmutable', mapped); return objects.putImmutable(mapped, bytes, options); },
    append(value, position, bytes) { const mapped = key(value); onOperation('append', mapped); return objects.append(mapped, position, bytes); },
  });
}
