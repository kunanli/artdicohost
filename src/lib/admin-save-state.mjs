import { validateContent, toPublicContent, showcaseAllocations, PORTRAIT_ID_PATTERN } from '../../shared/content-schema.mjs';

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
const sectionFields = Object.freeze({overview:[],event:['event'],arrangements:['booths'],guests:['guests'],organizations:['organizations'],showcases:['showcases'],sessions:['sessions'],booths:['booths'],publish:[]});
/** Scope one page to the loaded full cloud base. This is not a rebase onto a newer revision. */
export function contentSectionSnapshot(expectedRevision, loadedContent, candidateContent, section, options = {}) {
  if(!plain(options)||Object.keys(options).some(key=>key!=='allowWholeWorkspace')
    || Object.hasOwn(options,'allowWholeWorkspace')&&typeof options.allowWholeWorkspace!=='boolean'
    || typeof section!=='string'||!Object.hasOwn(sectionFields,section))return null;
  const base=canonicalContent(loadedContent),candidate=canonicalContent(candidateContent);
  if(!base||!candidate||base.eventId!==candidate.eventId)return null;
  if(options.allowWholeWorkspace===true)return contentSaveSnapshot(expectedRevision,candidate);
  const fields=sectionFields[section];if(!fields.length)return null;
  const content=structuredClone(base);
  for(const key of fields){
    if(!Object.hasOwn(candidate,key))return null;
    content[key]=structuredClone(candidate[key]);
  }
  return contentSaveSnapshot(expectedRevision,content);
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
export function contentSaveUiState({ loaded, canEdit, dirty, unapplied = [], busy, saving, outcome, revision: currentRevision, confirmedRevision, problem = '', retryReady = false, oneStep = false }) {
  const direct=oneStep===true;
  let state = 'loaded', title = '已载入云端草稿', description = direct?'修改后点击「保存」。公开发布另外执行。':'应用修改后，再点击「保存到云端」。公开发布另外执行。';
  if (!loaded) { title = '尚未载入草稿'; description = '登录并读取草稿后，才能编辑和保存。'; }
  else if (saving) { state = 'saving'; title = '正在保存到云端…'; description = '请保留此页，等待可核对的保存回执。'; }
  else if (outcome === 'unknown') { state = 'unknown'; title = '云端保存结果未确认'; description = problem || '本页修改仍保留。请先核对云端保存结果，勿重复保存或刷新。'; }
  else if (outcome === 'conflict') { state = 'conflict'; title = '云端版本已变化，本页修改仍保留'; description = problem || '请先保留本页修改，再核对最新云端草稿；不会自动覆盖其他工作人员的更新。'; }
  else if (unapplied.length) { state = 'unapplied'; title = direct?'尚未保存':'还有未应用的输入，尚未保存到云端'; description = direct?(problem||'点击「保存」提交本页填写。公开发布另外执行。'):'请先在「' + unapplied.join('、') + '」应用修改，或明确取消本次编辑，再保存到云端。'; }
  else if (dirty) { state = 'dirty'; title = direct?'尚未保存':'本页修改尚未保存到云端'; description = problem || (direct?'点击「保存」提交本页修改。公开发布另外执行。':'点击「保存到云端」提交全部已应用内容；公开发布另行操作。'); }
  else if (confirmedRevision === currentRevision) { state = 'saved'; title = direct?'已保存':'已确认保存到云端'; description = '草稿版本 ' + currentRevision + ' 已保存，刷新后可继续编辑；公开页面尚未自动更新。'; }
  return { state, title, description, canSave: Boolean(loaded && canEdit && (direct?(dirty||unapplied.length):dirty&&!unapplied.length) && !busy && !saving && !['unknown', 'conflict'].includes(outcome)),
    canCheck: Boolean(loaded && canEdit && !busy && !saving && ['unknown', 'conflict'].includes(outcome)),
    canRetry: Boolean(loaded && canEdit && retryReady && (direct||!unapplied.length) && !busy && !saving && ['unknown', 'conflict'].includes(outcome)) };
}


export const PUBLICATION_REASON_LABELS = Object.freeze({
  confirmation_required: '待确认', public_consent_required: '待核实公开授权',
  attendance_required: '未确认参加', attendance_declined: '已回复不参加',
  cover_required: '作品封面待补', allocation_required: '展位或分享场次待安排',
  session_draft: '场次尚未安排', booth_cancelled:'展位已取消', organization_withdrawn:'组织已退出', record_removed: '草稿已移除',
  not_in_public_projection: '公开条件待核对',
});
export const PUBLICATION_CHANGE_LABELS = Object.freeze({new:'待发布',updated:'变更待发布',removed:'待撤下',unchanged:'已同步',blocked:'待补充'});
export const PUBLICATION_SUGGESTION_LABELS = Object.freeze({portrait_optional:'照片可稍后补充',public_roles_optional:'公开职责可稍后补充'});
const publicationCollections = Object.freeze(['guests','organizations','showcases','sessions','booths']);
// Property order is not a public change; list order and optional-field presence are.
function publicFingerprint(value) {
  if (Array.isArray(value)) return '[' + value.map(publicFingerprint).join(',') + ']';
  if (plain(value)) return '{' + Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+publicFingerprint(value[key])).join(',') + '}';
  return JSON.stringify(value);
}
const samePublic = (left,right) => publicFingerprint(left) === publicFingerprint(right);
function publicationReasons(kind,item,content,ready) {
  if (!item) return ['record_removed'];
  if (ready) return [];
  const reasons=[];
  if (kind==='sessions') {
    if(item.status==='draft')reasons.push('session_draft');
  } else {
    if(item.status!=='confirmed')reasons.push(kind==='booths'&&item.status==='cancelled'?'booth_cancelled':kind==='organizations'&&item.status==='withdrawn'?'organization_withdrawn':'confirmation_required');
    if(['guests','organizations','showcases'].includes(kind)&&item.publicConsent!==true)reasons.push('public_consent_required');
    if(kind==='showcases') {
      if(item.responseStatus!=='attending')reasons.push(item.responseStatus==='declined'?'attendance_declined':'attendance_required');
      if(!PORTRAIT_ID_PATTERN.test(item.coverId))reasons.push('cover_required');
      const allocated=showcaseAllocations(item,content);
      if(!allocated.sessionId&&!allocated.boothId)reasons.push('allocation_required');
    }
  }
  return reasons.length?reasons:['not_in_public_projection'];
}
/** A read-only view of one acknowledged draft and its actual publication snapshot.
 * Missing/invalid publication metadata is unavailable, never an empty publication.
 * Readiness derives from the same sanitized public projection used by publish.
 */
export function contentPublicationReadiness(input) {
  try {
    if(!plain(input)||!Object.hasOwn(input,'published')||!plain(input.draft)||!revision(input.draft.revision))return null;
    const content=canonicalContent(input.draft.content);
    if(!content||!['guests','showcases','sessions','booths'].every(key=>Array.isArray(input.draft.content[key])))return null;
    const next=toPublicContent(content),publication=input.published;
    let saved=null,publishedRevision=null,publishedAt=null;
    if(publication!==null) {
      if(!plain(publication)||!revision(publication.revision)||publication.revision>input.draft.revision
        ||typeof publication.publishedAt!=='string'||publication.publishedAt.length>40
        ||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/u.test(publication.publishedAt)
        ||!Number.isFinite(Date.parse(publication.publishedAt))
        ||new Date(publication.publishedAt).toISOString().slice(0,19)!==publication.publishedAt.slice(0,19)||!plain(publication.content)
        ||!['guests','showcases','sessions','booths'].every(key=>Array.isArray(publication.content[key])))return null;
      saved=toPublicContent(publication.content);
      if(saved.eventId!==content.eventId||!samePublic(saved,publication.content))return null;
      publishedRevision=publication.revision;publishedAt=publication.publishedAt;
    }
    const items={},summary={new:0,updated:0,removed:0,unchanged:0,blocked:0},orderChanged={};
    for(const kind of publicationCollections) {
      const draftRows=content[kind]??[],nextRows=next[kind]??[],savedRows=saved?.[kind]??[];
      const draftById=new Map(draftRows.map(row=>[row.id,row])),nextById=new Map(nextRows.map(row=>[row.id,row])),savedById=new Map(savedRows.map(row=>[row.id,row]));
      items[kind]=[...new Set([...draftById.keys(),...savedById.keys()])].map(id=>{
        const draft=draftById.get(id),current=nextById.get(id),previous=savedById.get(id),published=Boolean(previous),ready=Boolean(current);
        const change=published?ready?samePublic(current,previous)?'unchanged':'updated':'removed':ready?'new':'blocked';
        const suggestions=[];
        if(kind==='guests'&&draft) {
          if(!draft.portraitId)suggestions.push('portrait_optional');
          if(!draft.publicRoles?.length)suggestions.push('public_roles_optional');
        }
        summary[change]++;
        return {kind,id,label:draft?.name||draft?.title||draft?.code||previous?.name||previous?.title||previous?.code||id,
          inDraft:Boolean(draft),published,ready,change,reasons:publicationReasons(kind,draft,content,ready),suggestions};
      });
      orderChanged[kind]=!samePublic(nextRows.map(row=>row.id),savedRows.map(row=>row.id));
    }
    return {draftRevision:input.draft.revision,publishedRevision,publishedAt,
      organizationSource:saved&&Object.hasOwn(saved,'organizations')?'published':'initial',
      hasPublicChanges:!saved||!samePublic(next,saved),eventChanged:!saved||!samePublic(next.event,saved.event),items,summary,orderChanged};
  } catch { return null; }
}
