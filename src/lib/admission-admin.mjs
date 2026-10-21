import { admissionSummary } from './admission-view.mjs';

const ID = /^[A-Za-z0-9_-]{43}$/u;
const TEAM = /^t_[A-Za-z0-9_-]{22}$/u;
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
/** Reject contradictory capacity data before presenting controls or seat counts. */
export function admissionAdminState(value) {
  if (!plain(value) || !Number.isSafeInteger(value.revision) || value.revision < 0 || !plain(value.settings)
    || !Array.isArray(value.people) || value.people.length > 1000 || !Array.isArray(value.teams) || value.teams.length > 1000) return null;
  const summary = admissionSummary(value.summary);
  if (!summary || ['capacity','staffReserve','waitlistEnabled'].some(key => summary[key] !== value.settings[key])) return null;
  const ids = new Set(), queues = new Set(), teams = new Set(), membership = new Map();
  for (const person of value.people) {
    if (!plain(person) || !ID.test(person.registrationId ?? '') || ids.has(person.registrationId)
      || !['attendee','crew'].includes(person.kind) || !['pending_review','confirmed','waitlisted','withdrawn','rejected'].includes(person.status)
      || !Number.isSafeInteger(person.queueNumber) || person.queueNumber < 1 || person.queueNumber > value.people.length || queues.has(person.queueNumber)
      || person.teamId !== '' && !TEAM.test(person.teamId ?? '')) return null;
    ids.add(person.registrationId);queues.add(person.queueNumber);
  }
  for (const team of value.teams) {
    if (!plain(team) || !TEAM.test(team.id ?? '') || teams.has(team.id) || typeof team.name !== 'string' || !team.name.trim() || [...team.name].length > 160
      || !Array.isArray(team.memberIds) || team.memberIds.length < 1 || team.memberIds.length > 50) return null;
    teams.add(team.id);
    for (const id of team.memberIds) { if (!ids.has(id) || membership.has(id)) return null; membership.set(id, team.id); }
  }
  if (value.people.some(person => person.teamId !== (membership.get(person.registrationId) ?? ''))
    || value.people.filter(person => person.status === 'confirmed').length !== summary.confirmedCount
    || value.people.filter(person => person.status === 'confirmed' && person.kind === 'crew').length !== summary.crewConfirmedCount
    || value.people.filter(person => person.status === 'waitlisted').length !== summary.waitlistCount
    || value.people.filter(person => person.status === 'pending_review').length !== (summary.pendingReviewCount ?? 0)
    || value.people.filter(person => person.status === 'rejected').length !== (summary.rejectedCount ?? 0)) return null;
  return { ...value, summary };
}

/** An uncertain write can only be retried with its original body and operation ID. */
export function savedAdmissionOperation(value) {
  if (!plain(value) || Object.keys(value).some(key=>!['path','method','body'].includes(key)) || typeof value.body !== 'string' || value.body.length > 100000) return null;
  const action=value.path?.match(/^\/api\/admin\/admissions\/(settings|teams|teams\/remove|staff|withdraw|kind|promote|approve|reject)$/u)?.[1];
  if (!action || value.method !== (action==='settings'?'PUT':'POST')) return null;
  let body;try{body=JSON.parse(value.body);}catch{return null;}
  const fields={settings:['settings'],teams:['team'],'teams/remove':['teamId'],staff:['input'],withdraw:['registrationId'],kind:['registrationId','kind'],promote:[],approve:['registrationId'],reject:['registrationId']}[action];
  if (!plain(body) || !/^[A-Za-z0-9_-]{32,128}$/u.test(body.operationId??'') || !Number.isSafeInteger(body.expectedRevision) || body.expectedRevision<0 || Object.keys(body).some(key=>!['operationId','expectedRevision',...fields].includes(key)) || fields.some(key=>!Object.hasOwn(body,key))) return null;
  return {path:value.path,method:value.method,body:value.body};
}

export function createAdmissionOperations({ request, revision, savePending, clearPending, operationId = () => {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/gu,'-').replace(/\//gu,'_').replace(/=+$/u,'');
} }) {
  let pending = null, busy = false, generation = 0, uncertain = false;
  async function send() {
    if (busy || !pending) throw new Error('请先核对当前操作结果。');
    const started = generation, operation = pending;
    busy = true;
    try {
      const result = await request(operation.path, { method: operation.method, body: operation.body });
      if (started !== generation) throw new Error('会话已改变，原操作结果已丢弃。');
      const state = admissionAdminState(result);
      if (!state || !['updated','replayed'].includes(result.outcome)) throw new Error('名额结果尚未通过核对，请保留本页并再次确认同一操作。');
      const action = operation.path.match(/^\/api\/admin\/admissions\/(approve|reject)$/u)?.[1];
      if (action) {
        const body = JSON.parse(operation.body), receipt = result.operation;
        if (!plain(receipt) || receipt.operationId !== body.operationId || receipt.action !== action
          || receipt.registrationId !== body.registrationId || result.registrationId !== body.registrationId
          || !Number.isSafeInteger(receipt.revision) || receipt.revision <= body.expectedRevision || receipt.revision > state.revision
          || !state.people.some(person => person.registrationId === body.registrationId)) {
          throw new Error('审核回执尚未通过核对，请保留本页并再次确认同一操作。');
        }
      }
      if(clearPending)await clearPending({acknowledged:true,operation:{...operation}});
      if (started !== generation) throw new Error('会话已改变，原操作结果已丢弃。');
      pending = null; return state;
    } catch (error) {
      // Only a first definite rejection proves no commit. After an unknown attempt or refresh,
      // a later 4xx cannot disprove the original outcome, so keep the original operation.
      if (started === generation && !uncertain && Number.isInteger(error.status) && error.status >= 400 && error.status < 500) { if(clearPending)await clearPending({acknowledged:false,operation:{...operation}}); if(started===generation)pending = null; }
      if(started===generation&&pending)uncertain=true;
      throw error;
    } finally { if (started === generation) busy = false; }
  }
  return Object.freeze({
    get pending() { return pending !== null; },
    get pendingRequest() { return pending ? {...pending} : null; },
    restore(value) { if(pending||busy)throw new Error('请先核对当前操作。');const restored=savedAdmissionOperation(value);if(!restored)throw new Error('原名额操作无法核对。');pending=restored;uncertain=true; },
    async run(path, data, method = 'POST') {
      if (pending || busy) throw new Error('上次操作结果尚未确认，请先再次确认同一操作。');
      const id = operationId(), expectedRevision = revision();
      if (!/^[A-Za-z0-9_-]{32,128}$/u.test(id) || !Number.isSafeInteger(expectedRevision) || expectedRevision < 0) throw new Error('名额版本尚未载入，请先刷新。');
      uncertain=false;pending = { path, method, body: JSON.stringify({ ...data, expectedRevision, operationId: id }) };
      if(savePending){const started=generation;busy=true;try{await savePending({...pending});if(started!==generation)throw new Error('会话已改变，未发送原操作。');}catch(error){if(started===generation)pending=null;throw error;}finally{if(started===generation)busy=false;}}
      return send();
    },
    retry: send,
    clear() { generation++; pending = null; busy = false; uncertain=false; },
  });
}
