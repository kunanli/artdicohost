import { validateContent } from '../../shared/content-schema.mjs';

const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
const revision = value => Number.isSafeInteger(value) && value >= 0;
function canonicalContent(value) {
  try { const checked = validateContent(value); return checked.valid ? checked.value : null; } catch { return null; }
}
export function sameContent(left, right) {
  const a = canonicalContent(left), b = canonicalContent(right);
  return Boolean(a && b && JSON.stringify(a) === JSON.stringify(b));
}
export function contentSaveSnapshot(expectedRevision, content) {
  const checked = canonicalContent(content);
  return revision(expectedRevision) && expectedRevision < Number.MAX_SAFE_INTEGER && checked ? { expectedRevision, content: structuredClone(checked) } : null;
}
function cloudDraft(value) {
  if (!plain(value) || !plain(value.draft) || !revision(value.draft.revision)) return null;
  const content = canonicalContent(value.draft.content);
  return content ? { revision: value.draft.revision, content } : null;
}
/** A 2xx response alone is not a save acknowledgement. Compare the exact normalized submitted fields. */
export function confirmedContentSave(value, submitted) {
  const draft = cloudDraft(value);
  return draft && submitted && draft.revision === submitted.expectedRevision + 1 && sameContent(draft.content, submitted.content) ? draft : null;
}
/** Read-only reconciliation never adopts a different server draft or treats an old revision as proof. */
export function inspectContentSave(value, submitted) {
  const draft = cloudDraft(value);
  if (!draft || !submitted || draft.revision < submitted.expectedRevision) return { state: 'unconfirmed', draft: null };
  if (draft.revision > submitted.expectedRevision && sameContent(draft.content, submitted.content)) return { state: 'confirmed', draft };
  return { state: draft.revision > submitted.expectedRevision ? 'conflict' : 'retryable', draft: null };
}
export function contentSaveUiState({ loaded, canEdit, dirty, unapplied = [], busy, saving, outcome, revision: currentRevision, confirmedRevision, problem = '', retryReady = false }) {
  let state = 'loaded', title = '已载入云端草稿', description = '应用修改后，再点击「保存到云端」。公开发布另外执行。';
  if (!loaded) { title = '尚未载入草稿'; description = '登录并读取草稿后，才能编辑和保存。'; }
  else if (saving) { state = 'saving'; title = '正在保存到云端…'; description = '请保留此页，等待可核对的保存回执。'; }
  else if (outcome === 'unknown') { state = 'unknown'; title = '云端保存结果未确认'; description = problem || '本页修改仍保留。请先核对云端保存结果，勿重复保存或刷新。'; }
  else if (outcome === 'conflict') { state = 'conflict'; title = '云端版本已变化，本页修改仍保留'; description = problem || '请先保留本页修改，再核对最新云端草稿；不会自动覆盖其他工作人员的更新。'; }
  else if (unapplied.length) { state = 'unapplied'; title = '还有未应用的输入，尚未保存到云端'; description = '请先在「' + unapplied.join('、') + '」应用修改，或明确取消本次编辑，再保存到云端。'; }
  else if (dirty) { state = 'dirty'; title = '本页修改尚未保存到云端'; description = problem || '应用修改只更新当前页面，刷新会丢失。点击「保存到云端」保存全部活动内容。'; }
  else if (confirmedRevision === currentRevision) { state = 'saved'; title = '已确认保存到云端'; description = '草稿版本 ' + currentRevision + ' 已保存，刷新后可继续编辑；公开页面尚未自动更新。'; }
  return { state, title, description, canSave: Boolean(loaded && canEdit && dirty && !unapplied.length && !busy && !saving && !['unknown', 'conflict'].includes(outcome)),
    canCheck: Boolean(loaded && canEdit && !busy && !saving && ['unknown', 'conflict'].includes(outcome)),
    canRetry: Boolean(loaded && canEdit && retryReady && !unapplied.length && !busy && !saving && ['unknown', 'conflict'].includes(outcome)) };
}
