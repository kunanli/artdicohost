import { createHash } from 'node:crypto';
import { own, plainObject } from './policy.mjs';
import { registrationJson, RegistrationStorageError } from './repository.mjs';
import { validateStaffRegistrationFields } from './validation.mjs';
import { validAdmissionOperation, validAdmissionId } from './admissions.mjs';
import { canManageEventOperations } from '../../shared/staff-permissions.mjs';

const digest = value => createHash('sha256').update(value).digest('hex');
const trusted = (actor, admin = false) => typeof own(actor, 'id') === 'string' && /^[A-Za-z0-9_-]{1,80}$/u.test(own(actor, 'id'))
  && (admin ? canManageEventOperations(actor) : Array.isArray(own(actor, 'roles')) && own(actor, 'roles').some(role => ['reviewer', 'superadmin'].includes(role)));
const invalid = outcome => ({ outcome });

/** Admission writes share the registration index CAS. Review checks fail closed and are bounded to eight in flight. */
export function createAdmissionOperations({ repository, eventId, current, policyAt, isWithdrawn, getWithdrawnIds }) {
  async function bulkWithdrawn() {
    const inactive = await getWithdrawnIds();
    if (!Array.isArray(inactive) || inactive.length > 1000 || inactive.some(id => !validAdmissionId(id)) || new Set(inactive).size !== inactive.length) throw new RegistrationStorageError();
    return new Set(inactive);
  }
  async function withdrawn(id) {
    if (typeof isWithdrawn !== 'function') return typeof getWithdrawnIds === 'function' ? (await bulkWithdrawn()).has(id) : false;
    const value = await isWithdrawn(id);
    if (typeof value !== 'boolean') throw new RegistrationStorageError();
    return value;
  }
  function getExcluded(extra = []) {
    return async ids => {
      const candidates = [...new Set([...ids, ...extra])], excluded = [];
      if (typeof getWithdrawnIds === 'function' && candidates.length) {
        const denied = await bulkWithdrawn();
        return candidates.filter(id => denied.has(id));
      }
      let position = 0;
      await Promise.all(Array.from({ length: Math.min(8, candidates.length) }, async () => {
        while (position < candidates.length) {
          const id = candidates[position++];
          if (await withdrawn(id)) excluded.push(id);
        }
      }));
      return excluded;
    };
  }
  async function getAdmissionStatus(id, options) {
    try {
      const status = await repository.getAdmissionStatus(id, options);
      return await withdrawn(id) ? { ...status, status: 'withdrawn' } : status;
    } catch { throw new RegistrationStorageError(); }
  }
  async function currentReceipt(receipt) {
    const admission = await getAdmissionStatus(receipt.registrationId);
    return { ...receipt, admissionStatus: admission.status, admissionKind: admission.kind, admissionRevision: admission.revision };
  }
  async function mutate(action, supplied, value, admin = false) {
    try {
      const actor = own(supplied, 'actor');
      if (!trusted(actor, admin)) return invalid('forbidden');
      if (!plainObject(value)) return invalid('invalid');
      const requestHash = digest(registrationJson({ action, input: value, actorId: actor.id }));
      return await repository.mutateAdmission({ action, input: value, actorId: actor.id, operationId: own(supplied, 'operationId'),
        expectedRevision: own(supplied, 'expectedRevision'), requestHash, at: new Date(current()).toISOString(),
        getExcluded: getExcluded(value.registrationId ? [value.registrationId] : []),
        ...(['person_merge','person_roles'].includes(action)?{verifySources:own(supplied,'verifySources')}: {}) });
    } catch { return invalid('unavailable'); }
  }
  return Object.freeze({
    getExcluded, getAdmissionStatus,
    async getAdmissions(input) {
      if (!trusted(own(input, 'actor'))) return invalid('forbidden');
      try { const value=await repository.getAdmissions();const actor=own(input,'actor');if(!actor.roles.some(role=>['outreach','superadmin'].includes(role)))value.personGroups=value.personGroups?.filter(g=>g.primaryRegistrationId).map(g=>({...g,contactIds:[],primaryContactId:null,primaryKey:'registration:'+g.primaryRegistrationId}));if(value.personGroups===undefined)delete value.personGroups;return value; } catch { return invalid('unavailable'); }
    },
    async getPersonGroups({actor}={}) {
      if(typeof actor?.id!=='string'||!Array.isArray(actor.roles)||!actor.roles.some(role=>['outreach','superadmin'].includes(role)))return invalid('forbidden');
      try{const value=await repository.getAdmissions();return {revision:value.revision,groups:(value.personGroups??[]).filter(group=>actor.roles.some(role=>['reviewer','superadmin'].includes(role))||group.contactIds.length).map(group=>({...group,admissionStatus:group.primaryRegistrationId?value.people.find(p=>p.registrationId===group.primaryRegistrationId)?.status:null}))};}catch{return invalid('unavailable');}
    },
    managePerson: input => {
      const action=own(input,'action');if(!['person_merge','person_roles'].includes(action)||typeof own(input,'verifySources')!=='function')return invalid('invalid');
      return mutate(action,input,own(input,'input'),true);
    },
    setAdmissionSettings: input => mutate('settings', input, own(input, 'settings'), true),
    setAdmissionKind: input => mutate('kind', input, { registrationId: own(input, 'registrationId'), kind: own(input, 'kind') }, true),
    approveApplication: input => mutate('approve', input, { registrationId: own(input, 'registrationId') }),
    rejectApplication: input => mutate('reject', input, { registrationId: own(input, 'registrationId') }),
    withdrawAdmission: input => mutate('withdraw', input, { registrationId: own(input, 'registrationId') }),
    promoteAdmissions: input => mutate('promote', input, {}),
    saveAdmissionTeam: input => mutate('team_save', input, own(input, 'team')),
    removeAdmissionTeam: input => mutate('team_remove', input, { teamId: own(input, 'teamId') }),
    async addStaffMember(input) {
      try {
        const actor = own(input, 'actor'), supplied = own(input, 'input'), operationId = own(input, 'operationId');
        if (!trusted(actor, true)) return invalid('forbidden');
        const permissionReference = own(supplied, 'permissionReference'), kind = own(supplied, 'kind');
        if (!validAdmissionOperation(operationId) || !Number.isSafeInteger(own(input, 'expectedRevision')) || own(input, 'expectedRevision') < 0
          || !['attendee', 'crew'].includes(kind) || typeof permissionReference !== 'string' || !permissionReference.trim()
          || permissionReference.length > 1000 || /[\u0000-\u001f\u007f]/u.test(permissionReference)) return invalid('invalid');
        const fields = own(supplied, 'fields'), validation = validateStaffRegistrationFields(fields);
        if (!validation.valid) return { outcome: 'invalid', fieldErrors: Object.keys(validation.errors) };
        const requestHash = digest(registrationJson({ actorId: actor.id, fields, permissionReference: permissionReference.trim(), kind }));
        const keyHash = digest('staff-entry\0' + eventId + '\0' + operationId);
        const replay = await repository.find(keyHash, requestHash, { operationId });
        if (replay) {
          if (replay.outcome === 'conflict') return replay;
          return { outcome: 'replayed', ...await repository.getAdmissions(), registrationId: replay.receipt.registrationId, receipt: await currentReceipt(replay.receipt),
            promotedIds: replay.promotedIds ?? [], releasedIds: replay.releasedIds ?? [], operation: replay.operation };
        }
        const now = current();
        if (!policyAt(now).valid) return invalid('closed');
        const recordedAt = new Date(now).toISOString();
        const value = { eventId, submittedAt: recordedAt, fields: validation.value, consent: { accepted: false, version: null, acceptedAt: null },
          provenance: { kind: 'staff_entry', actorId: actor.id, recordedAt, permissionReference: permissionReference.trim(), operationId } };
        const saved = await repository.accept({ value, keyHash, payloadHash: requestHash, admissionKind: kind, actorId: actor.id,
          operationId, expectedRevision: own(input, 'expectedRevision'), requestHash, beforeCommit: () => policyAt(current()).valid, getExcluded: getExcluded() });
        if (!['created', 'replayed'].includes(saved.outcome)) return saved;
        return { outcome: saved.outcome === 'created' ? 'updated' : 'replayed', ...await repository.getAdmissions(),
          registrationId: saved.receipt.registrationId, receipt: await currentReceipt(saved.receipt), promotedIds: saved.promotedIds ?? [], releasedIds: saved.releasedIds ?? [], operation: saved.operation };
      } catch { return invalid('unavailable'); }
    },
  });
}
