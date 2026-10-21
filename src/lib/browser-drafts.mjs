/** Local recovery only. This module never performs an HTTP request or stores credentials. */
export const BROWSER_DRAFT_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const BROWSER_DRAFT_LIMITS = Object.freeze({ recordBytes: 1024 * 1024, totalBytes: 4 * 1024 * 1024, records: 64 });
const DATABASE = 'artdico-browser-drafts-v1';
const STORES = ['drafts', 'heads', 'actors'];
const MAX_HEADS = 4096, MAX_ACTORS = 64, TIMEOUT_MS = 5000;
const KINDS = ['editing', 'pending_submission'];
const forbidden = key => /password|passphrase|authorization|cookie|csrf|token|secret|privatekey|accesskey|apikey|emailjs(?:public|private)key/iu.test(key.replace(/[^a-z]/giu, ''));
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value)
  && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const ownData = value => plain(value) && Reflect.ownKeys(value).every(key => typeof key === 'string'
  && Object.getOwnPropertyDescriptor(value, key)?.enumerable && Object.hasOwn(Object.getOwnPropertyDescriptor(value, key), 'value'));
const clone = value => structuredClone(value);
const bytes = value => new TextEncoder().encode(JSON.stringify(value)).length;
const exact = (value, keys) => ownData(value) && Object.keys(value).sort().join('\0') === [...keys].sort().join('\0');
const revision = value => Number.isSafeInteger(value) && value >= 0;
export class BrowserDraftError extends Error {
  constructor(code = 'UNAVAILABLE') { super('本机草稿未能核实保存，请保留当前填写内容。'); this.name = 'BrowserDraftError'; this.code = code; }
}
const fail = code => { throw new BrowserDraftError(code); };

function safeCopy(input) {
  let nodes = 0;
  const seen = new Set();
  function visit(value, depth) {
    if (++nodes > 100_000 || depth > 24) fail('INVALID');
    if (value === null || typeof value === 'boolean') return value;
    if (typeof value === 'number') { if (!Number.isFinite(value)) fail('INVALID'); return value; }
    if (typeof value === 'string') {
      if (value.length > BROWSER_DRAFT_LIMITS.recordBytes || /^data:/iu.test(value)) fail('INVALID');
      return value;
    }
    if ((!plain(value) && !Array.isArray(value)) || seen.has(value)) fail('INVALID');
    if (Array.isArray(value) && Object.getPrototypeOf(value) !== Array.prototype) fail('INVALID');
    seen.add(value);
    const keys = Reflect.ownKeys(value).filter(key => !Array.isArray(value) || key !== 'length');
    if (Array.isArray(value) && (keys.length !== value.length || keys.some(key => typeof key !== 'string' || !/^(?:0|[1-9]\d*)$/u.test(key)))) fail('INVALID');
    const result = Array.isArray(value) ? [] : {};
    for (const key of keys) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (typeof key !== 'string' || !descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')
        || ['__proto__', 'constructor', 'prototype'].includes(key) || forbidden(key)) fail('INVALID');
      result[key] = visit(descriptor.value, depth + 1);
    }
    seen.delete(value);
    return result;
  }
  return visit(input, 0);
}
export function copyBrowserDraftValue(input) { return safeCopy(input); }
function scopeValue(input) {
  if (!exact(input, ['actorId', 'eventId', 'page', 'entityId'])) fail('INVALID');
  const result = {};
  for (const key of ['actorId', 'eventId', 'page', 'entityId']) {
    const value = input[key], max = ['actorId', 'eventId'].includes(key) ? 100 : 200;
    if (typeof value !== 'string' || !value || value !== value.trim() || [...value].length > max || /[\u0000-\u001f\u007f-\u009f]/u.test(value)) fail('INVALID');
    result[key] = value;
  }
  return result;
}
const scopeKey = scope => JSON.stringify([scope.actorId, scope.eventId, scope.page, scope.entityId]);
function policyValue(input) {
  if (!ownData(input) || Object.keys(input).some(key => !['fields', 'validate', 'pendingFields', 'jsonFields', 'rejectPending'].includes(key))
    || !Array.isArray(input.fields) || !input.fields.length || input.fields.length > 100 || typeof input.validate !== 'function') fail('INVALID');
  if (input.rejectPending !== undefined && typeof input.rejectPending !== 'function') fail('INVALID');
  if (['pendingFields', 'jsonFields'].some(key => input[key] !== undefined && !Array.isArray(input[key]))) fail('INVALID');
  const result = { fields: [...input.fields], validate: input.validate, pendingFields: [...(input.pendingFields ?? [])], jsonFields: [...(input.jsonFields ?? [])], rejectPending: input.rejectPending };
  for (const key of ['fields', 'pendingFields', 'jsonFields']) {
    if (result[key].some(value => typeof value !== 'string' || !/^[A-Za-z][A-Za-z0-9_]{0,79}$/u.test(value) || forbidden(value))
      || new Set(result[key]).size !== result[key].length || key !== 'fields' && result[key].some(value => !result.fields.includes(value))) fail('INVALID');
  }
  return result;
}
function checkedValue(input, kind, policy) {
  const value = safeCopy(input);
  if (!ownData(value) || Object.keys(value).some(key => !policy.fields.includes(key))) fail('INVALID');
  for (const key of policy.jsonFields) if (typeof value[key] === 'string') {
    try { safeCopy(JSON.parse(value[key])); } catch { fail('INVALID'); }
  }
  if (kind === 'pending_submission' && (!policy.pendingFields.length || policy.pendingFields.some(key => !Object.hasOwn(value, key) || value[key] === null))) fail('INVALID');
  try { if (policy.validate(clone(value), { kind }) !== true) fail('INVALID'); } catch { fail('INVALID'); }
  return value;
}
function checkedRecord(input, scope, policy) {
  if (!exact(input, ['key', 'scope', 'revision', 'actorEpoch', 'kind', 'baseRevision', 'value', 'updatedAt', 'expiresAt', 'pendingFields'])
    || input.key !== scopeKey(scope) || JSON.stringify(scopeValue(input.scope)) !== JSON.stringify(scope) || !revision(input.revision) || input.revision < 1
    || !revision(input.actorEpoch) || !KINDS.includes(input.kind) || !(input.baseRevision === null || revision(input.baseRevision))
    || !revision(input.updatedAt) || input.kind === 'editing' && input.expiresAt !== input.updatedAt + BROWSER_DRAFT_TTL_MS
    || input.kind === 'pending_submission' && input.expiresAt !== null
    || !Array.isArray(input.pendingFields) || JSON.stringify(input.pendingFields) !== JSON.stringify(policy.pendingFields)) fail('INVALID');
  checkedValue(input.value, input.kind, policy);
  if (bytes(input) > BROWSER_DRAFT_LIMITS.recordBytes) fail('LIMIT');
  return input;
}
const publicRecord = record => record ? Object.fromEntries(['kind', 'baseRevision', 'value', 'updatedAt', 'expiresAt'].map(key => [key, clone(record[key])])) : null;

/** Atomic local CAS. Explicit logout advances a durable actor epoch before removing any private drafts. */
export function createBrowserDraftStore({ indexedDB = globalThis.indexedDB, clock = Date.now, databaseName = DATABASE,
  BroadcastChannel: Channel = globalThis.BroadcastChannel } = {}) {
  if (typeof clock !== 'function' || typeof databaseName !== 'string' || !/^[A-Za-z0-9_-]{1,100}$/u.test(databaseName)) fail('INVALID');
  let opening = null, closed = false;
  const listeners = new Set();
  let channel = null;
  try { if (typeof Channel === 'function') channel = new Channel(databaseName + '-changes'); } catch { /* Native CAS works when change hints are unavailable. */ }
  channel?.unref?.();
  function notify(event, remote = false) {
    if (closed || !ownData(event) || !['change', 'actor_cleared'].includes(event.type)) return;
    for (const listener of listeners) {
      if (event.type === 'actor_cleared' ? event.actorId === listener.scope.actorId : event.key === listener.key) {
        try { listener.callback(clone(event)); } catch { /* Observers cannot change a completed transaction. */ }
      }
    }
    if (!remote) { try { channel?.postMessage(event); } catch { /* CAS remains authoritative without hints. */ } }
  }
  if (channel) channel.onmessage = event => notify(event.data, true);
  function database() {
    if (closed || typeof indexedDB?.open !== 'function') return Promise.reject(new BrowserDraftError());
    return opening ??= new Promise((resolve, reject) => {
      let finished = false, request;
      const timer = setTimeout(() => { finished = true; reject(new BrowserDraftError()); }, TIMEOUT_MS);
      try { request = indexedDB.open(databaseName, 1); } catch { clearTimeout(timer); reject(new BrowserDraftError()); return; }
      request.onupgradeneeded = () => {
        for (const name of STORES) if (!request.result.objectStoreNames.contains(name)) request.result.createObjectStore(name, { keyPath: name === 'actors' ? 'actorId' : 'key' });
      };
      request.onerror = request.onblocked = () => { if (!finished) { finished = true; clearTimeout(timer); reject(new BrowserDraftError()); } };
      request.onsuccess = () => {
        clearTimeout(timer);
        if (finished || closed) { request.result.close(); if (!finished) reject(new BrowserDraftError()); return; }
        finished = true;
        request.result.onversionchange = () => { request.result.close(); opening = null; };
        resolve(request.result);
      };
    }).catch(error => { opening = null; throw error; });
  }
  async function transaction(mode, operation) {
    const db = await database();
    if (closed) fail('UNAVAILABLE');
    return new Promise((resolve, reject) => {
      let tx, output, problem = null, completed = false;
      try { tx = db.transaction(STORES, mode, { durability: 'strict' }); }
      catch { try { tx = db.transaction(STORES, mode); } catch { reject(new BrowserDraftError()); return; } }
      const timer = setTimeout(() => { problem = new BrowserDraftError(); try { tx.abort(); } catch { reject(problem); } }, TIMEOUT_MS);
      const stop = error => { problem = error instanceof BrowserDraftError ? error : new BrowserDraftError(); try { tx.abort(); } catch { clearTimeout(timer); reject(problem); } };
      tx.oncomplete = () => { completed = true; clearTimeout(timer); if (closed) reject(new BrowserDraftError()); else resolve(clone(output)); };
      tx.onerror = tx.onabort = () => { if (!completed) { clearTimeout(timer); reject(problem ?? new BrowserDraftError()); } };
      const values = {}, names = [['drafts', 'getAll'], ['heads', 'getAll'], ['actors', 'getAll']];
      for (const [name, method] of names) {
        const request = tx.objectStore(name)[method]();
        request.onsuccess = () => {
          values[name] = request.result;
          if (Object.keys(values).length === names.length) {
            try { output = operation(values, tx); } catch (error) { stop(error); }
          }
        };
        request.onerror = () => stop(new BrowserDraftError());
      }
    });
  }
  function cursor(values, scope) {
    if (values.drafts.length > BROWSER_DRAFT_LIMITS.records || values.heads.length > MAX_HEADS || values.actors.length > MAX_ACTORS) fail('LIMIT');
    const key = scopeKey(scope), actor = values.actors.find(value => value.actorId === scope.actorId), head = values.heads.find(value => value.key === key);
    if (actor && (!exact(actor, ['actorId', 'epoch']) || !revision(actor.epoch))
      || head && (!exact(head, ['key', 'actorId', 'revision']) || head.actorId !== scope.actorId || !revision(head.revision) || head.revision < 1)) fail('INVALID');
    const record = values.drafts.find(value => value.key === key) ?? null;
    if (record && (!head || record.revision !== head.revision || record.actorEpoch !== (actor?.epoch ?? 0))) fail('INVALID');
    return { key, revision: head?.revision ?? 0, actorEpoch: actor?.epoch ?? 0, record };
  }
  function snapshot(current, record = current.record) {
    const now = clock(); if (!revision(now)) fail('UNAVAILABLE');
    return { revision: current.revision, actorEpoch: current.actorEpoch,
      record: record?.kind === 'editing' && record.expiresAt <= now ? null : publicRecord(record) };
  }
  function expected(current, input) {
    if (!revision(input?.expectedRevision) || !revision(input?.actorEpoch)) fail('INVALID');
    if (input.actorEpoch !== current.actorEpoch) fail('STALE_ACTOR');
    if (input.expectedRevision !== current.revision) fail('CONFLICT');
  }
  function saveRecord(values, tx, current, scope, policy, { kind, baseRevision, value }, now) {
    const record = { key: current.key, scope, revision: current.revision + 1, actorEpoch: current.actorEpoch, kind,
      baseRevision, value, updatedAt: now, expiresAt: kind === 'editing' ? now + BROWSER_DRAFT_TTL_MS : null, pendingFields: policy.pendingFields };
    checkedRecord(record, scope, policy);
    const drafts = values.drafts.filter(item => item.key !== current.key && !(item.kind === 'editing' && item.expiresAt <= now));
    const heads = values.heads.filter(item => item.key !== current.key), head = { key: current.key, actorId: scope.actorId, revision: record.revision };
    const actors = values.actors.filter(item => item.actorId !== scope.actorId), actor = { actorId: scope.actorId, epoch: current.actorEpoch };
    if (drafts.length + 1 > BROWSER_DRAFT_LIMITS.records || heads.length + 1 > MAX_HEADS || actors.length + 1 > MAX_ACTORS
      || bytes([...drafts, record, ...heads, head, ...actors, actor]) > BROWSER_DRAFT_LIMITS.totalBytes) fail('LIMIT');
    for (const expired of values.drafts) if (expired.key !== current.key && expired.kind === 'editing' && expired.expiresAt <= now) tx.objectStore('drafts').delete(expired.key);
    tx.objectStore('drafts').put(record); tx.objectStore('heads').put(head); tx.objectStore('actors').put(actor);
    return snapshot({ ...current, revision: record.revision }, record);
  }
  function changed(scope, result) {
    notify({ type: 'change', key: scopeKey(scope), actorId: scope.actorId, revision: result.revision, actorEpoch: result.actorEpoch });
    return result;
  }
  const store = {
    async read(input, suppliedPolicy) {
      const scope = scopeValue(input), policy = policyValue(suppliedPolicy);
      return transaction('readonly', values => { const current = cursor(values, scope); if (current.record) checkedRecord(current.record, scope, policy); return snapshot(current); });
    },
    async write(input, update, suppliedPolicy) {
      const scope = scopeValue(input), policy = policyValue(suppliedPolicy);
      if (!exact(update, ['expectedRevision', 'actorEpoch', 'kind', 'baseRevision', 'value']) || !KINDS.includes(update.kind)
        || !(update.baseRevision === null || revision(update.baseRevision))) fail('INVALID');
      const value = checkedValue(update.value, update.kind, policy), now = clock(); if (!revision(now)) fail('UNAVAILABLE');
      const result = await transaction('readwrite', (values, tx) => {
        const current = cursor(values, scope); expected(current, update);
        if (current.record) {
          checkedRecord(current.record, scope, policy);
          if (current.record.kind === 'pending_submission' && (update.kind !== 'pending_submission' || update.baseRevision !== current.record.baseRevision
            || policy.pendingFields.some(key => JSON.stringify(value[key]) !== JSON.stringify(current.record.value[key])))) fail('PENDING_IMMUTABLE');
          if (current.record.kind === 'pending_submission' && typeof policy.rejectPending === 'function'
            && ['attempted', 'uncertain'].some(key => current.record.value[key] === true && value[key] !== true)) fail('PENDING_IMMUTABLE');
        }
        return saveRecord(values, tx, current, scope, policy, { ...update, value }, now);
      });
      return changed(scope, result);
    },
    // Only the public controller receiving its first definitive rejection may
    // request this transition. A policy derives editable fields from the exact
    // durable request; unknown outcomes never become ordinary expiring drafts.
    async rejectPending(input, update, suppliedPolicy) {
      const scope = scopeValue(input), policy = policyValue(suppliedPolicy);
      if (!exact(update, ['expectedRevision', 'actorEpoch']) || typeof policy.rejectPending !== 'function') fail('INVALID');
      const now = clock(); if (!revision(now)) fail('UNAVAILABLE');
      const result = await transaction('readwrite', (values, tx) => {
        const current = cursor(values, scope); expected(current, update);
        if (!current.record || current.record.kind !== 'pending_submission') fail('PENDING_IMMUTABLE');
        checkedRecord(current.record, scope, policy);
        if (current.record.value.uncertain !== false) fail('PENDING_IMMUTABLE');
        let derived;
        try { derived = policy.rejectPending(clone(current.record.value)); } catch { fail('INVALID'); }
        if (derived === false || derived === null || derived === undefined) fail('PENDING_IMMUTABLE');
        const value = checkedValue(derived, 'editing', policy);
        return saveRecord(values, tx, current, scope, policy, { kind: 'editing', baseRevision: current.record.baseRevision, value }, now);
      });
      return changed(scope, result);
    },
    async remove(input, update) {
      const scope = scopeValue(input);
      if (!ownData(update) || Object.keys(update).some(key => !['expectedRevision', 'actorEpoch', 'allowPending'].includes(key))
        || update.allowPending !== undefined && typeof update.allowPending !== 'boolean') fail('INVALID');
      const result = await transaction('readwrite', (values, tx) => {
        const current = cursor(values, scope); expected(current, update);
        if (current.record?.kind === 'pending_submission' && update.allowPending !== true) fail('PENDING_IMMUTABLE');
        if (!values.heads.some(item => item.key === current.key) && values.heads.length >= MAX_HEADS) fail('LIMIT');
        const next = { ...current, revision: current.revision + 1 };
        tx.objectStore('drafts').delete(current.key);
        tx.objectStore('heads').put({ key: current.key, actorId: scope.actorId, revision: next.revision });
        return snapshot(next, null);
      });
      notify({ type: 'change', key: scopeKey(scope), actorId: scope.actorId, revision: result.revision, actorEpoch: result.actorEpoch });
      return result;
    },
    async clearActor(actorId) {
      scopeValue({ actorId, eventId: 'all', page: 'all', entityId: 'all' });
      const result = await transaction('readwrite', (values, tx) => {
        const old = values.actors.find(value => value.actorId === actorId);
        if (old && (!exact(old, ['actorId', 'epoch']) || !revision(old.epoch))) fail('INVALID');
        if (!old && values.actors.length >= MAX_ACTORS) fail('LIMIT');
        const actorEpoch = (old?.epoch ?? 0) + 1;
        for (const item of values.drafts) if (item.scope?.actorId === actorId) tx.objectStore('drafts').delete(item.key);
        for (const item of values.heads) if (item.actorId === actorId) tx.objectStore('heads').delete(item.key);
        tx.objectStore('actors').put({ actorId, epoch: actorEpoch });
        return { actorEpoch };
      });
      notify({ type: 'actor_cleared', actorId, actorEpoch: result.actorEpoch });
      return result;
    },
    subscribe(input, callback) {
      const scope = scopeValue(input); if (typeof callback !== 'function') fail('INVALID');
      const listener = { scope, key: scopeKey(scope), callback }; listeners.add(listener); return () => listeners.delete(listener);
    },
    close() { closed = true; listeners.clear(); channel?.close(); opening?.then(db => db.close()).catch(() => {}); },
  };
  return Object.freeze(store);
}
