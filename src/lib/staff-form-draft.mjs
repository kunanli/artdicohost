import { BrowserDraftError, copyBrowserDraftValue } from './browser-drafts.mjs';

/** Connects an authenticated form to local recovery. No cloud writes, retries or implicit restoration.
 * `saved` and `restored` describe local storage only, never a cloud ACK. A same-base
 * pending restore may recover surrounding edits; controllers must keep the original
 * request locked until explicit readback/retry proves its outcome. */
export function createStaffFormDraft({ store, scope, policy, baseRevision, isCurrent, capture, apply, onState = () => {}, delayMs = 450 } = {}) {
  if (!store || !['read', 'write', 'remove', 'subscribe'].every(key => typeof store[key] === 'function')
    || ![isCurrent, capture, apply, onState].every(value => typeof value === 'function')
    || !Number.isSafeInteger(delayMs) || delayMs < 0 || delayMs > 5000) throw new BrowserDraftError('INVALID');
  let current = null, loaded = false, loading = null, blocked = false, completionAllowed = false, closed = false, epoch = 0, timer = null, writing = false, conflictEpoch = 0;
  let changeVersion = 0, settledVersion = 0;
  let queue = Promise.resolve();
  const clone = value => structuredClone(value);
  const active = generation => !closed && generation === epoch && isCurrent() === true;
  function base() {
    const value = typeof baseRevision === 'function' ? baseRevision() : baseRevision;
    if (!Number.isSafeInteger(value) || value < 0) throw new BrowserDraftError('INVALID');
    return value;
  }
  function emit(status, error) {
    if (!closed && isCurrent() === true) {
      try { onState({ status, ...(current ? { snapshot: clone(current) } : {}), ...(error ? { error } : {}) }); } catch { /* UI observers cannot change durable storage. */ }
    }
  }
  function assertCurrent(generation) { if (!active(generation)) throw new BrowserDraftError('STALE_ACTOR'); }
  function problem(error) {
    const value = error instanceof BrowserDraftError ? error : new BrowserDraftError();
    if (['CONFLICT', 'STALE_ACTOR', 'PENDING_IMMUTABLE'].includes(value.code)) { conflictEpoch++; blocked = true; completionAllowed = false; clearTimeout(timer); timer = null; emit('conflict', value); }
    else emit('unavailable', value);
    return value;
  }
  const unsubscribe = store.subscribe(scope, event => {
    if (closed) return;
    if (event.type === 'actor_cleared' || current && event.actorEpoch !== current.actorEpoch) {
      epoch++; conflictEpoch++; blocked = true; completionAllowed = false; clearTimeout(timer); timer = null; current = null;
      emit('conflict', new BrowserDraftError('STALE_ACTOR')); closed = true; unsubscribe(); removeLifecycle(); return;
    }
    if (!loaded || !current) return;
    if (event.revision !== current.revision && !(writing && event.revision === current.revision + 1)) {
      conflictEpoch++; blocked = true; completionAllowed = false; clearTimeout(timer); timer = null; emit('conflict', new BrowserDraftError('CONFLICT'));
    }
  });
  async function load() {
    const generation = epoch; assertCurrent(generation);
    if (loaded) return clone(current);
    return loading ??= (async () => {
      try {
        const observed = await store.read(scope, policy); assertCurrent(generation);
        current = observed; loaded = true; blocked = Boolean(observed.record);
        emit(!observed.record ? 'empty' : observed.record.baseRevision !== base() ? 'stale' : observed.record.kind === 'pending_submission' ? 'pending' : 'available');
        return clone(current);
      } catch (error) { throw problem(error); }
      finally { loading = null; }
    })();
  }
  function enqueue(operation) {
    const generation = epoch;
    const result = queue.then(async () => { assertCurrent(generation); return operation(generation); });
    queue = result.catch(() => {});
    return result;
  }
  const binding = {
    get snapshot() { return current ? clone(current) : null; },
    get blocked() { return blocked || closed; },
    get unsettled() { return !closed && changeVersion > settledVersion; },
    load,
    restore({ pendingOnly = false } = {}) {
      return enqueue(async generation => {
        try {
          await load(); assertCurrent(generation);
          if (!current.record) return clone(current);
          if (typeof pendingOnly !== 'boolean' || pendingOnly && current.record.kind !== 'pending_submission') throw new BrowserDraftError('INVALID');
          // Re-read the local CAS cursor too; a second tab may have changed it
          // while the restore prompt was visible.
          const observed = await store.read(scope, policy); assertCurrent(generation);
          if (observed.actorEpoch !== current.actorEpoch || observed.revision !== current.revision) throw new BrowserDraftError('CONFLICT');
          current = observed;
          if (!current.record) { blocked = false; completionAllowed = false; emit('empty'); return clone(current); }
          if (!pendingOnly && current.record.baseRevision !== base()) throw new BrowserDraftError('CONFLICT');
          const restoreConflict = conflictEpoch;
          await apply(clone(current.record.value), { pendingOnly }); assertCurrent(generation);
          if (conflictEpoch !== restoreConflict) throw new BrowserDraftError('CONFLICT');
          blocked = pendingOnly; completionAllowed = pendingOnly; emit(pendingOnly ? 'pending' : 'restored');
          return clone(current);
        } catch (error) { throw problem(error); }
      });
    },
    schedule() {
      if (closed || !isCurrent() || blocked) return;
      changeVersion++; clearTimeout(timer); emit('saving');
      timer = setTimeout(() => { timer = null; binding.flush().catch(() => {}); }, delayMs);
    },
    flush(options = {}) {
      let explicitValue, explicitBase;
      try {
        if (Object.hasOwn(options, 'value')) { explicitValue = copyBrowserDraftValue(options.value); explicitBase = base(); }
      } catch (error) { return Promise.reject(problem(error)); }
      const queuedVersion = ++changeVersion; emit('saving');
      clearTimeout(timer); timer = null;
      return enqueue(async generation => {
        try {
          await load(); assertCurrent(generation);
          if (blocked) throw new BrowserDraftError('CONFLICT');
          const kind = options.kind ?? current.record?.kind ?? 'editing';
          const value = Object.hasOwn(options, 'value') ? explicitValue : capture();
          // A queued later request has its own durable obligation even when
          // this capture happens to include newer visible form fields.
          const capturedVersion = queuedVersion;
          const cloudRevision = base();
          if (explicitBase !== undefined && explicitBase !== cloudRevision) throw new BrowserDraftError('CONFLICT');
          if (current.record?.kind === 'pending_submission' && current.record.baseRevision !== cloudRevision) throw new BrowserDraftError('CONFLICT');
          const writeConflict = conflictEpoch;
          writing = true; emit('saving');
          const saved = await store.write(scope, { expectedRevision: current.revision, actorEpoch: current.actorEpoch, kind, baseRevision: cloudRevision, value }, policy);
          assertCurrent(generation);
          if (conflictEpoch !== writeConflict) throw new BrowserDraftError('CONFLICT');
          current = saved; settledVersion = Math.max(settledVersion, capturedVersion);
          emit(binding.unsettled ? 'saving' : 'saved'); return clone(current);
        } catch (error) { throw problem(error); }
        finally { writing = false; }
      });
    },
    markPending(value) { return binding.flush({ kind: 'pending_submission', value }); },
    /** Call only after a proven cloud ACK/readback, with the remaining editable
     * value and the already advanced cloud base. It never sends a request. */
    completePending(value) {
      let remaining,cloudBase;
      try{remaining=copyBrowserDraftValue(value);cloudBase=base();}catch(error){return Promise.reject(problem(error));}
      const completedVersion=++changeVersion;clearTimeout(timer);timer=null;emit('saving');
      return enqueue(async generation=>{
        try{
          await load();assertCurrent(generation);
          if(blocked&&!completionAllowed)throw new BrowserDraftError('CONFLICT');
          if(base()!==cloudBase)throw new BrowserDraftError('CONFLICT');
          if(typeof store.completePending!=='function')throw new BrowserDraftError('INVALID');
          const completeConflict=conflictEpoch;writing=true;
          const saved=await store.completePending(scope,{expectedRevision:current.revision,actorEpoch:current.actorEpoch,baseRevision:cloudBase,value:remaining},policy);
          assertCurrent(generation);if(conflictEpoch!==completeConflict||base()!==cloudBase)throw new BrowserDraftError('CONFLICT');
          current=saved;blocked=false;completionAllowed=false;settledVersion=Math.max(settledVersion,completedVersion);
          emit(binding.unsettled?'saving':'saved');return clone(current);
        }catch(error){throw problem(error);}finally{writing=false;}
      });
    },
    rejectPending() {
      clearTimeout(timer); timer = null;
      return enqueue(async generation => {
        try {
          await load(); assertCurrent(generation);
          // Restored or competing requests are unknown, even when an older
          // browser record did not yet persist its uncertainty flag.
          if (blocked) throw new BrowserDraftError('CONFLICT');
          if (typeof store.rejectPending !== 'function') throw new BrowserDraftError('INVALID');
          const rejectConflict = conflictEpoch, rejectedVersion = changeVersion; writing = true;
          const recovered = await store.rejectPending(scope, { expectedRevision: current.revision, actorEpoch: current.actorEpoch }, policy);
          assertCurrent(generation);
          if (conflictEpoch !== rejectConflict) throw new BrowserDraftError('CONFLICT');
          current = recovered; blocked = false; settledVersion = Math.max(settledVersion, rejectedVersion);
          emit(binding.unsettled ? 'saving' : 'saved'); return clone(current);
        } catch (error) { throw problem(error); }
        finally { writing = false; }
      });
    },
    discard({ allowPending = false } = {}) {
      clearTimeout(timer); timer = null;
      return enqueue(async generation => {
        try {
          await load(); assertCurrent(generation); const removeConflict = conflictEpoch, discardedVersion = changeVersion; writing = true;
          const removed = await store.remove(scope, { expectedRevision: current.revision, actorEpoch: current.actorEpoch, allowPending });
          assertCurrent(generation);
          if (conflictEpoch !== removeConflict) throw new BrowserDraftError('CONFLICT');
          current = removed; blocked = false; settledVersion = Math.max(settledVersion, discardedVersion);
          emit(binding.unsettled ? 'saving' : 'discarded'); return clone(current);
        } catch (error) { throw problem(error); }
        finally { writing = false; }
      });
    },
    close() {
      if (closed) return;
      emit('closed'); closed = true; epoch++; clearTimeout(timer); timer = null; unsubscribe(); current = null;
      removeLifecycle();
    },
  };
  // Snapshot synchronously while the form still exists; starting an IDB write
  // on pagehide remains best effort and is never reported saved before commit.
  function flushOnLeave() {
    if (timer !== null && !blocked && active(epoch)) {
      try { binding.flush({ value: capture() }).catch(() => {}); } catch { emit('unavailable', new BrowserDraftError()); }
    }
  }
  function removeLifecycle() {
    globalThis.window?.removeEventListener?.('pagehide', flushOnLeave);
    globalThis.window?.removeEventListener?.('beforeunload', guardUnsettled);
    globalThis.document?.removeEventListener?.('visibilitychange', flushOnHidden);
  }
  function flushOnHidden() { if (globalThis.document?.visibilityState === 'hidden') flushOnLeave(); }
  function guardUnsettled(event) {
    if (binding.unsettled && isCurrent() === true) { event.preventDefault(); event.returnValue = ''; }
  }
  globalThis.window?.addEventListener?.('pagehide', flushOnLeave);
  globalThis.window?.addEventListener?.('beforeunload', guardUnsettled);
  globalThis.document?.addEventListener?.('visibilitychange', flushOnHidden);
  return Object.freeze(binding);
}
