import { createBrowserDraftStore } from './browser-drafts.mjs';
import { createStaffFormDraft } from './staff-form-draft.mjs';
import { eventConfig } from '../config/event.mjs';
import '../styles/operations-drafts.css';

let store;
export const operationsDraftStore = () => store ??= createBrowserDraftStore({ indexedDB: globalThis.indexedDB });
import {validDraftFields,captureDraftFields,applyDraftFields,operationsDraftPage} from './operations-draft-fields.mjs';
export {validDraftFields,captureDraftFields,applyDraftFields,operationsDraftPage} from './operations-draft-fields.mjs';
const plain=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const draftPolicy=(validate=()=>true)=>({fields:['fields','path','method','payloadJson'],pendingFields:['path','method','payloadJson'],jsonFields:['payloadJson'],validate(value,{kind}){return plain(value)&&validDraftFields(value.fields)&&validate(value.fields)&&(kind==='editing'?Object.keys(value).every(key=>key==='fields'):typeof value.path==='string'&&/^\/api\/admin\/[A-Za-z0-9_/?=&%-]+$/u.test(value.path)&&['POST','PUT','PATCH'].includes(value.method)&&typeof value.payloadJson==='string'&&value.payloadJson.length<=500000);}});
export async function removeOperationsDraft({actorId,roles,page,entity,isCurrent,expectedRevision}){
  const scope={actorId,eventId:eventConfig.id,page:operationsDraftPage(page,roles),entityId:entity},storage=operationsDraftStore(),snapshot=await storage.read(scope,draftPolicy());
  if(!isCurrent())throw new Error('会话已改变，本机草稿未被清除。');
  if(expectedRevision!==undefined&&snapshot.revision!==expectedRevision)return false;
  if(snapshot.record)await storage.remove(scope,{expectedRevision:snapshot.revision,actorEpoch:snapshot.actorEpoch,allowPending:false});
}
/** Small shared view for daily-operation forms. Loading a draft never submits or applies it. */
export function createOperationsFormDraft({ actorId, roles, page, entity, form, baseRevision, isCurrent, capture, apply, validate = () => true, onPending = () => {}, onChange = () => {}, onDiscard = () => {}, onEdit = () => {}, autoSave = true, manualPending = false }) {
  const panel = document.createElement('section'); panel.className = 'operations-local-draft'; panel.dataset.operationsLocalDraft = entity;panel.dataset.operationsDraftState='loading';
  const message = document.createElement('p'); message.setAttribute('role', 'status'); message.setAttribute('aria-live', 'polite');
  const restore = document.createElement('button'), discard = document.createElement('button'), copy = document.createElement('button');
  for (const button of [restore, discard, copy]) { button.type = 'button'; button.className = 'ah-admin-button'; }
  restore.textContent = '恢复本机填写'; discard.textContent = '清除本机草稿'; copy.textContent = '查看本机内容';
  const preview = document.createElement('textarea'); preview.readOnly = true; preview.hidden = true; preview.setAttribute('aria-label', '本机草稿，供手动核对');
  for(const button of [restore,discard,copy])button.hidden=true;message.textContent='正在核对本机草稿…';panel.append(message, restore, discard, copy, preview); form.prepend(panel); form.classList.add('operations-draft-form');
  let alive = true, status = 'empty', binder;
  const current = () => alive && isCurrent();
  function update(event) {
    if (!current()) return;
    status = event.status;panel.dataset.operationsDraftState=status;
    const record = event.snapshot?.record ?? binder?.snapshot?.record;
    const pending = record?.kind === 'pending_submission';
    message.textContent = ({ empty: '填写内容会自动保存在本机；云端需点保存。', available: '发现本机草稿，请恢复或清除后继续。', stale: pending ? '上次提交结果待核对。可恢复原操作；不会自动发送。' : '云端版本已改变。本机内容保留，请查看后手动核对。', pending: manualPending ? '上次提交结果待核对，已锁定重复提交。请先核对云端。' : '原操作已保存在本机；请明确确认同一操作。', saving: '正在保存到本机…', saved: '已保存在本机，尚未保存到云端。', restored: '已恢复本机内容，尚未保存到云端。', discarded: '本机草稿已清除。', conflict: '另一页已修改本机草稿，请重新打开后核对。', unavailable: '本机保存暂不可用。请保留页面并保存到云端。' })[status] || '';
    restore.hidden = !record || !['available','stale','pending'].includes(status) || status === 'stale' && !pending;
    restore.textContent = pending ? '恢复待核对操作' : '恢复本机填写';
    discard.hidden = !record; copy.hidden = !record;
    discard.textContent = pending ? '已手动核对，解除本机锁定' : '清除本机草稿';
    preview.hidden = true; preview.value = '';
    onChange(event);
  }
  binder = createStaffFormDraft({ store: operationsDraftStore(), scope: { actorId, eventId: eventConfig.id, page:operationsDraftPage(page,roles), entityId:entity },
    policy: draftPolicy(validate),
    baseRevision, isCurrent: current, capture: () => ({ fields: capture() }),
    apply(value, context = {}) { if (value.payloadJson) { onPending({ path: value.path, method: value.method, body: value.payloadJson, fields: value.fields }); } if (!context.pendingOnly && !value.payloadJson) apply(value.fields); }, onState: update });
  const save = () => {if(autoSave){onEdit();binder.schedule();}}; if(autoSave){form.addEventListener('input', save);form.addEventListener('change', save);}
  restore.addEventListener('click', async () => { try { const pending = binder.snapshot?.record?.kind === 'pending_submission'; await binder.restore(pending ? { pendingOnly: true } : undefined); } catch (error) { if (current()) { message.textContent = error.message || '本机草稿无法恢复，请手动核对。'; onChange({ status: 'conflict' }); } } });
  discard.addEventListener('click', async () => { const pending = binder.snapshot?.record?.kind === 'pending_submission'; if (!confirm(pending ? '确认已手动核对云端，了解原操作可能已经完成？解除本机锁定不会撤销云端结果。' : '清除本机草稿？云端记录不受影响。')) return; try { await binder.discard({ allowPending: pending }); onDiscard(); } catch (error) { if (current()) message.textContent = error.message; } });
  copy.addEventListener('click', () => { if (!current()) return; preview.value = JSON.stringify(binder.snapshot?.record?.value?.fields ?? {}, null, 2); preview.hidden = false; preview.focus(); preview.select(); });
  return Object.freeze({ load: () => binder.load().catch(() => null), schedule: save, flush: () => binder.flush(), get blocked() { return binder.blocked; }, get snapshot() { return binder.snapshot; },
    markPending(request) { return binder.markPending({ fields: capture(), path: request.path, method: request.method, payloadJson: request.body }); },
    acknowledge: () => binder.discard({ allowPending: true }),
    close() { alive = false; binder.close(); form.removeEventListener('input', save); form.removeEventListener('change', save); preview.value = ''; panel.remove(); },
  });
}
