import { validateContent, toPublicContent, GUEST_PUBLIC_ROLES, GUEST_PUBLIC_ROLE_LABELS } from '../../shared/content-schema.mjs';
import { showcaseSummary } from '../../shared/showcase-display.mjs';
import { createArrangementsView } from './arrangements-view.mjs';
import { createInitialPresentation } from '../config/content.mjs';
import { completeBoothSlots } from '../lib/booth-slots.mjs';
import { prepareBoothDraft } from '../lib/arrangement-planner.mjs';
import { createArrangementPlanner } from './arrangement-planner.mjs';
import { prepareProfileImage, processedImageSummary } from '../lib/profile-image.mjs';
import { editStaffImage } from '../lib/staff-image-editor.mjs';
import { createOrganizationsEditor } from './organizations.mjs';
import { createGuestContactPicker } from './guest-contact-picker.mjs';
import { organizationChoices, boothOrganizationField } from '../lib/content-relationships.mjs';
import { contentSaveSnapshot, contentSectionSnapshot, confirmedContentSave, inspectContentSave, sameContent, contentSaveUiState,contentPublicationReadiness,PUBLICATION_REASON_LABELS,PUBLICATION_CHANGE_LABELS,PUBLICATION_SUGGESTION_LABELS } from '../lib/admin-save-state.mjs';
import { createBrowserDraftStore } from '../lib/browser-drafts.mjs';
import { createStaffFormDraft } from '../lib/staff-form-draft.mjs';
import { CONTENT_DRAFT_POLICY,readContentForm,writeContentForm,contentDraftCopy,contentDraftLocation,showcaseOptionalFields } from '../lib/content-local-drafts.mjs';
import { CONTENT_PAGES,resolveContentPage,contentPageHref } from '../lib/admin-sections.mjs';

const $ = selector => document.querySelector(selector);
const status = $('[data-admin-status]');
const errorBox = $('[data-admin-error]');
const loginPanel = $('[data-admin-login-panel]');
const workspace = $('[data-admin-workspace]');
let user = null;
let csrfToken = '';
let requestSessionGeneration = 0;
let draft = null;
let loadedContent=null;
let publicationCache=null,publicationUncertain=false;
let activePage=resolveContentPage(location.pathname,location.hash)??'overview';
let currentPageUrl=contentPageHref(activePage),navigationTarget=null;
let legacyWorkspaceReview=false,pendingHistorical=false,pendingUncertain=false,pendingForms=null;
let arrangementsRevision=null;
let arrangementsLoading=false;
const editorStableIds={};
const editorSaveStates=new Map();
let published = null;
let dirty = false;
let sessionFormDirty = false, boothFormDirty = false;
let saveOutcome = 'loaded', saveProblem = '', pendingSave = null, confirmedSaveRevision = null;
let savingContent = false, checkingContentSave = false, retryContentReady = false;
let eventFormDirty = false;
let busy = false;
let actionSequence=0;
let plannerBusy = false;
let planner = null;
let organizations = null;
let guestPeople = null;
let savedGuestContacts = new Map();
let pendingBooth = takeBoothLink();
let editingSession = null;
let editingBooth = null;
let editingGuest = null;
let editingShowcase = null;
let showcaseFormDirty = false;
let coverUploading = false;
let coverGeneration = 0;
let coverController = null;
let portraitUploading = false;
let portraitGeneration = 0;
let portraitPreviewGeneration = 0;
let portraitController = null;
let portraitPending = null;
let guestFormDirty = false;
let pendingInvitee = takeInvitee();
let pendingOrganization = takeOrganizationLink();
let pendingEntity=takeEntityLink();
const localDraftStore=createBrowserDraftStore({indexedDB:globalThis.indexedDB});
let localDraftBinding=null,localDraftReady=false,localRecovering=false,localRecovery=null,localPendingArchive=null,localDraftProblem='';
const requestControllers=new Set();
function takeEntityLink(){const match=/^#(guest|session|showcase)=([A-Za-z0-9][A-Za-z0-9_-]{0,79})$/u.exec(location.hash);if(!match)return null;history.replaceState(null,'',location.pathname+location.search);return{type:match[1],id:match[2]};}
function takeOrganizationLink() {
  const match = /^#organization=([A-Za-z0-9][A-Za-z0-9_-]{0,79})$/u.exec(location.hash);
  if (!match) return null;
  history.replaceState(null, '', location.pathname + location.search); return match[1];
}
function takeBoothLink() {
  const match = /^#booth=([A-Za-z0-9][A-Za-z0-9_-]{0,79})$/u.exec(location.hash);
  if (!match) return null;
  history.replaceState(null, '', location.pathname + location.search);
  return match[1];
}
function takeInvitee(){
  if(!location.hash.startsWith('#invitee='))return null;
  const raw=location.hash.slice(9);
  history.replaceState(null,'',location.pathname+location.search);
  return /^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/u.test(raw)?raw:null;
}
const portraitIdPattern = /^[a-f0-9]{64}\.(?:jpg|png|webp)$/u;
const contentKey = type => ({ session: 'sessions', booth: 'booths', guest: 'guests', showcase: 'showcases' })[type];
const typeLabel = type => ({ session: '活动场次', booth: '出席展位', guest: '嘉宾资料', showcase: '游戏与作品' })[type];
const showcaseKindLabels={student:'学生作品',indie:'独立游戏',team:'团队作品'};
const roleKey=()=>[...(user?.roles??[])].sort().join(',');
function captureLocalDraft(){
  const forms={};
  if(eventFormDirty)forms.event={fields:readContentForm($('[data-event-form]'),'event'),faqItems:[...$('[data-event-faq]').children].map(row=>({question:row.querySelector('[name=faqQuestion]').value,answer:row.querySelector('[name=faqAnswer]').value}))};
  for(const type of ['session','booth','guest','showcase'])if($('[data-'+type+'-dialog]').open)forms[type]={editingId:({session:editingSession,booth:editingBooth,guest:editingGuest,showcase:editingShowcase})[type],fields:readContentForm($('[data-'+type+'-form]'),type),imageNeedsReselect:type==='guest'?Boolean(portraitUploading||portraitPending):type==='showcase'?coverUploading:false};
  const organization=organizations?.localDraft(),plan=planner?.localDraft();if(organization)forms.organization=organization;if(plan)forms.planner=plan;
  const checked=validateContent(draft.content);if(!checked.valid)throw new Error('本页内容无法暂存，请先复制填写内容。');
  return{schemaVersion:1,roleKey:roleKey(),section:activePage,content:checked.value,forms,pendingSave:pendingSave?structuredClone(pendingSave):null,...(pendingSave?{uncertain:pendingHistorical||pendingUncertain}:{} )};
}
function localDraftState(event){
  if(!user||!draft)return;
  if(event.error?.code==='STALE_ACTOR'){showLogin();announce('此账号已在其他页面退出，本页填写已清空。',true);return;}
  const record=event.snapshot?.record;
  const labels={empty:'尚无本机暂存',saving:'正在暂存本机…',saved:'已暂存本机，尚未保存云端',restored:'已恢复本机编辑，尚未保存云端',discarded:'已清除本机暂存',pending:'上次云端保存结果待核对',stale:'云端已有更新，本机暂存仍保留',available:'发现上次未完成的编辑',conflict:'本机暂存已变化，本页填写仍保留',unavailable:'本机暂存未完成，请先复制填写内容'};
  $('[data-admin-local-status]').textContent=labels[event.status]??'';
  if(['available','stale'].includes(event.status)||event.status==='pending'&&!localRecovering&&!pendingSave)localRecovery=event.snapshot;
  if(event.status==='unavailable')localDraftProblem=labels.unavailable;
  if(event.status==='conflict')localDraftProblem=labels.conflict;
  if(['saved','empty','restored','discarded'].includes(event.status))localDraftProblem='';
  renderLocalRecovery();
}
function renderLocalRecovery(){
  const box=$('[data-admin-local-recovery]'),record=(localRecovery??(localPendingArchive?localDraftBinding?.snapshot:null))?.record;
  box.hidden=!record&&!localDraftProblem;
  if(!box.hidden)box.open=true;
  $('[data-admin-local-message]').textContent=record?(record.value.roleKey!==roleKey()?'当前工作权限已变化，不能恢复这份暂存。':record.baseRevision!==draft?.revision?(record.kind==='pending_submission'?'上次保存结果待核对。可恢复原提交，再明确核对云端；不会自动重送。':'云端版本已有更新。请复制暂存内容后逐项核对，不能直接覆盖。'):'发现上次未完成的编辑，可恢复后继续。'):localDraftProblem;
  if(record&&record.value.roleKey===roleKey()&&contentDraftLocation(record.value)?.requiresReview)$('[data-admin-local-message]').textContent+=' 这份工作区暂存可能包含多个页面，恢复后请逐页核对。';
  $('[data-admin-local-restore]').hidden=!localRecovery||!record||record.value.roleKey!==roleKey()||record.baseRevision!==draft?.revision&&record.kind!=='pending_submission';
  $('[data-admin-local-discard]').hidden=!record;
  for(const button of box.querySelectorAll('button'))button.disabled=localRecovering;
  if(record&&record.value.roleKey!==roleKey())$('[data-admin-local-copy]').disabled=true;
  lockControls();
}
function scheduleLocalDraft(){
  if(!localDraftBinding||!localDraftReady||localRecovering||localRecovery||!user||!draft||!canEdit())return;
  if(hasUnsavedChanges()){
    if(!localDraftBinding.blocked){$('[data-admin-local-status]').textContent='正在暂存本机…';localDraftBinding.schedule();}
  }
  else if(localDraftBinding.snapshot?.record?.kind==='editing'||localDraftBinding.unsettled&&!localDraftBinding.snapshot?.record) localDraftBinding.discard().catch(()=>{});
}
async function bindLocalDraft(){
  localDraftBinding?.close();localDraftReady=false;localRecovery=null;localPendingArchive=null;localDraftProblem='';
  if(!user||!draft||!canEdit())return;
  const stamp=requestSessionGeneration,actor=user.id,eventId=draft.content.eventId;
  const binding=createStaffFormDraft({store:localDraftStore,scope:{actorId:actor,eventId,page:'content',entityId:'workspace'},policy:CONTENT_DRAFT_POLICY,baseRevision:()=>draft?.revision,
    isCurrent:()=>stamp===requestSessionGeneration&&user?.id===actor&&draft?.content.eventId===eventId&&canEdit(),capture:captureLocalDraft,apply:restoreLocalDraft,onState:localDraftState});
  localDraftBinding=binding;
  try{await binding.load();if(localDraftBinding===binding&&stamp===requestSessionGeneration)localDraftReady=true;}catch{if(localDraftBinding===binding&&stamp===requestSessionGeneration){localDraftProblem='本机暂存不可用，请先复制填写内容。';renderLocalRecovery();}}
}
async function restoreLocalDraft(value,{pendingOnly=false}={}){
  const stamp=requestSessionGeneration;
  if(!user||!draft||value.content.eventId!==draft.content.eventId||value.roleKey!==roleKey())throw new Error('当前账号、权限或活动无法恢复这份暂存。');
  const place=contentDraftLocation(value);if(!place)throw new Error('暂存所属页面无法核对。');
  legacyWorkspaceReview=place.requiresReview;pendingHistorical=Boolean(value.pendingSave);pendingUncertain=Boolean(value.pendingSave);pendingForms=value.pendingSave?structuredClone(value.forms):null;
  activatePage(place.section??(place.sections.length>1?'overview':value.section??'overview'));
  if(pendingOnly){pendingSave=structuredClone(value.pendingSave);saveOutcome='unknown';saveProblem='已恢复原提交，请明确核对云端保存结果。';localPendingArchive=structuredClone(value);localRecovery=null;lockControls();return;}
  const previous=draft.content;draft={revision:draft.revision,content:structuredClone(value.content)};dirty=!sameContent(previous,draft.content);
  pendingSave=value.pendingSave?structuredClone(value.pendingSave):null;if(pendingSave){saveOutcome='unknown';saveProblem='上次保存结果待核对，请先核对云端，不自动重送。';}
  render();
  if(value.forms.event){const form=$('[data-event-form]');writeContentForm(form,'event',value.forms.event.fields);renderFaqFields(value.forms.event.faqItems);eventFormDirty=true;editorSaveState('event','dirty','已恢复填写，尚未保存。');}
  if(value.forms.planner){activatePage('arrangements');await planner.restoreLocalDraft(value.forms.planner);}
  if(stamp!==requestSessionGeneration||!user||!draft)return;
  for(const type of ['session','booth','guest','showcase'])if(value.forms[type]){
    const record=value.forms[type],item=record.editingId?draft.content[contentKey(type)].find(entry=>entry.id===record.editingId):null;
    if(record.editingId&&!item)throw new Error('原记录已不存在，暂存内容仍保留，请复制后核对。');
    openEditor(type,item,true);writeContentForm($('[data-'+type+'-form]'),type,record.fields);
    if(['guest','booth','showcase'].includes(type)&&!Object.hasOwn(record.fields,'visibility'))$('[data-'+type+'-form]').elements.namedItem('visibility').value=item?.visibility??'public';
    editorStableIds[type]=record.fields.id;
    if(type==='session'){editingSession=record.editingId;sessionFormDirty=true;syncSessionGuest();}
    if(type==='booth'){editingBooth=record.editingId;boothFormDirty=true;}
    if(type==='guest'){editingGuest=record.editingId;guestFormDirty=true;showPortrait(record.fields.portraitId);$('[data-guest-consent-note]').textContent='已恢复填写，公开授权请重新核对。';guestPeople?.open();}
    if(type==='showcase'){editingShowcase=record.editingId;showcaseFormDirty=true;showCover(record.fields.coverId);syncShowcaseForms();}
    editorSaveState(type,'dirty','已恢复填写，尚未保存。');
    if(record.imageNeedsReselect)$('[data-'+type+(type==='guest'?'-portrait-status':'-cover-status')+']').textContent='未上传的图片编辑无法恢复，请重新选择图片。';
  }
  if(value.forms.organization){activatePage('organizations');organizations.restoreLocalDraft(value.forms.organization);}
  localRecovery=null;lockControls();
}
async function finishLocalSubmission(){
  const binding=localDraftBinding,stamp=requestSessionGeneration;
  if(!binding)return;
  try{
    const archive=localPendingArchive;
    const remainingForms=archive?Object.fromEntries(Object.entries(archive.forms).filter(([type,record])=>!formAlreadySaved(type,record,loadedContent))):null;
    const hasArchiveEdits=archive&&(!sameContent(archive.content,draft.content)||Object.keys(remainingForms).length);
    const hasCurrentEdits=dirty||hasUnappliedInputs()||planner?.hasLocalChanges();
    if(hasArchiveEdits||hasCurrentEdits){
      let remaining=captureLocalDraft();
      if(hasArchiveEdits){const{uncertain,...editing}=archive;remaining={...editing,content:structuredClone(archive.content),forms:remainingForms,pendingSave:null};}
      // One IDB transaction keeps the proven original pending record until all
      // remaining input has been durably recorded against the accepted revision.
      const saved=await binding.completePending(remaining);
      if(stamp!==requestSessionGeneration||binding!==localDraftBinding||!user||!draft)return;
      localPendingArchive=null;if(hasArchiveEdits)localRecovery=saved;
    }else{
      await binding.discard({allowPending:true});
      if(stamp!==requestSessionGeneration||binding!==localDraftBinding||!user||!draft)return;
      localPendingArchive=null;
    }
    renderLocalRecovery();
  }catch{
    if(stamp===requestSessionGeneration&&user){localRecovery=binding.snapshot;localDraftProblem='云端结果已核对，本机恢复信息尚未整理完成。请先核对或复制暂存，再继续编辑。';renderLocalRecovery();}
  }
}
async function copyLocalContent(type){
  if(!user||!draft||!canEdit())return;
  const stamp=requestSessionGeneration;
  let text;
  if(type&&['event','guest','session','booth','showcase','organization'].includes(type)){
    const form=type==='organization'?$('[data-organization-form]'):$('[data-'+type+'-form]');text=JSON.stringify({type,fields:readContentForm(form,type),...(type==='event'?{faqItems:[...$('[data-event-faq]').children].map(row=>({question:row.querySelector('[name=faqQuestion]').value,answer:row.querySelector('[name=faqAnswer]').value}))}:{})},null,2);
  }else{const value=localRecovery?.record?.value??localPendingArchive??captureLocalDraft();if(value.roleKey!==roleKey())throw new Error('权限已变化，不能复制这份暂存。');text=contentDraftCopy(value);}
  try{await navigator.clipboard.writeText(text);if(stamp===requestSessionGeneration)announce('填写内容已复制。未保存云端，也未发布。');}
  catch{if(stamp!==requestSessionGeneration)return;const field=$('[data-admin-copy-fallback]');(document.querySelector('dialog[open]')??$('[data-admin-local-recovery]').parentElement).append(field);field.hidden=false;field.value=text;field.focus();field.select();announce('请复制已选中的填写内容。');}
}

function renderPageView(){
  const page=CONTENT_PAGES.find(item=>item.key===activePage);if(!page)return;
  $('#artdico-admin').dataset.contentPage=activePage;
  document.title=page.title+'｜内容管理｜ARTDiCO HOST';
  for(const panel of document.querySelectorAll('[data-content-panel]'))panel.hidden=panel.dataset.contentPanel!==activePage;
  for(const[selector,value]of[['[data-content-page-title]',page.title],['[data-content-page-description]',page.description],['[data-content-breadcrumb-current]',page.label]])if($(selector))$(selector).textContent=value;
  if($('[data-content-save-scope]'))$('[data-content-save-scope]').textContent='当前页：'+page.label;
  for(const link of document.querySelectorAll('[data-staff-section-link]')){
    const target=new URL(link.href,location.href),selected=resolveContentPage(target.pathname,target.hash)===activePage;
    if(selected)link.setAttribute('aria-current','page');else link.removeAttribute('aria-current');
  }
  const warning=$('[data-admin-legacy-warning]');if(warning){warning.hidden=!legacyWorkspaceReview;warning.textContent=legacyWorkspaceReview?'已恢复旧工作区暂存，可能包含其他页面的修改。请逐项核对；保存整份暂存前会再次确认。':'';}
}
function queueEntity(hash){
  const match=/^#(invitee|organization|booth|guest|session|showcase)=([A-Za-z0-9][A-Za-z0-9_-]{0,79})$/u.exec(hash);if(!match)return;
  if(match[1]==='invitee')pendingInvitee=match[2];else if(match[1]==='organization')pendingOrganization=match[2];else if(match[1]==='booth')pendingBooth=match[2];else pendingEntity={type:match[1],id:match[2]};
}
function activatePage(section,{mode='replace',hash=''}={}){
  if(!CONTENT_PAGES.some(item=>item.key===section))return;
  const changed=activePage!==section;activePage=section;queueEntity(hash);currentPageUrl=contentPageHref(section);
  if(mode!=='none')history[mode==='push'?'pushState':'replaceState'](null,'',currentPageUrl);
  renderPageView();if(user&&draft){render();if(changed&&section!=='arrangements'){arrangements.clear();arrangementsRevision=null;}lockControls();}
  if(!busy&&!plannerBusy){resumePendingLinks();void loadActivePageData();}
}
async function loadActivePageData(){
  if(!user||!draft||activePage!=='arrangements'||arrangementsLoading||localRecovery||localRecovering||localPendingArchive||pendingSave||arrangementsRevision===draft.revision)return;
  if(!canEdit()||!user.roles.includes('outreach'))return;
  const stamp=requestSessionGeneration,revision=draft.revision;arrangementsLoading=true;
  try{await arrangements.refresh();if(stamp===requestSessionGeneration&&activePage==='arrangements'&&$('[data-arrangements-error]').hidden)arrangementsRevision=revision;}
  finally{if(stamp===requestSessionGeneration)arrangementsLoading=false;}
}
function completeNavigation(target){
  navigationTarget=null;const dialog=$('[data-admin-navigation-dialog]');if(dialog?.open)dialog.close();
  const section=resolveContentPage(target.pathname,target.hash);
  if(target.origin===location.origin&&section){activatePage(section,{mode:'push',hash:target.hash});window.scrollTo({top:0,behavior:'auto'});}
  else location.assign(target.href);
}
function requestNavigation(target){
  if(busy||plannerBusy||savingContent||checkingContentSave||localRecovering||portraitUploading||coverUploading||organizations?.uploading){announce('正在处理当前操作，请完成后再切换页面。',true);return;}
  if(!hasUnsavedChanges()&&!localRecovery&&!localPendingArchive){completeNavigation(target);return;}
  navigationTarget=target;const dialog=$('[data-admin-navigation-dialog]');if(!dialog){announce('请先保存或明确放弃当前编辑，再前往其他页面。',true);return;}
  $('[data-admin-navigation-description]').textContent='当前填写尚未保存。'+(pendingSave?'上次保存结果仍待核对，不能开始另一份保存；明确放弃时会先读取最新云端。':'保存成功后才会前往所选页面；放弃只清除本机编辑，不会撤销已保存内容。');
  $('[data-admin-navigation-error]').textContent='';$('[data-admin-navigation-error]').hidden=true;if(!dialog.open)dialog.showModal();lockControls();
}
function clearPageInputs(){
  guestPeople?.clear();clearPortrait();clearCover();organizations?.clear();planner?.clear();
  for(const type of ['session','booth','guest','showcase']){const dialog=$('[data-'+type+'-dialog]');if(dialog.open)dialog.close();$('[data-'+type+'-form]').reset();delete editorStableIds[type];}
  eventFormDirty=false;sessionFormDirty=false;boothFormDirty=false;guestFormDirty=false;showcaseFormDirty=false;editingSession=null;editingBooth=null;editingGuest=null;editingShowcase=null;
}
async function discardPageEdits(){
  const stamp=requestSessionGeneration;let state=null;const record=localRecovery?.record??localDraftBinding?.snapshot?.record;
  if(pendingSave||record?.kind==='pending_submission'){
    state=await timedContentRequest();if(stamp!==requestSessionGeneration)return false;
    if(!contentSaveSnapshot(state.draft?.revision,state.draft?.content))throw new Error('最新云端资料无法核对，未放弃本机恢复信息。');
  }
  if(localDraftBinding?.snapshot?.record)await localDraftBinding.discard({allowPending:record?.kind==='pending_submission'});
  if(stamp!==requestSessionGeneration||!user||!draft)return false;
  localDraftBinding?.close();localDraftBinding=null;localDraftReady=false;
  clearPageInputs();if(state){loadedContent=structuredClone(state.draft.content);draft=state.draft;published=state.published;}else draft={revision:draft.revision,content:structuredClone(loadedContent)};
  localRecovery=null;localPendingArchive=null;pendingSave=null;pendingForms=null;pendingHistorical=false;pendingUncertain=false;legacyWorkspaceReview=false;saveOutcome='loaded';saveProblem='';retryContentReady=false;dirty=false;
  savedGuestContacts=new Map((loadedContent.guests??[]).map(item=>[item.id,item.contactId||'']));renderPageView();render();await bindLocalDraft();return stamp===requestSessionGeneration;
}

const arrangements = createArrangementsView({
  root: $('[data-arrangements]'),
  load: () => request('/api/admin/arrangements'),
  plan: (type, id, slotNumber) => planner?.open(type, id, slotNumber),
  edit: (type, id, slotNumber) => {
    if (!draft || busy || dirty || portraitUploading || coverUploading || organizations?.hasUnapplied()) return;
    const item = id ? draft.content[contentKey(type)]?.find(entry => entry.id === id) : null;
    if (id && !item) { announce('此记录已不在本页草稿中，请重新读取最新资料。', true); return; }
    openEditor(type, item);
    if (type === 'booth' && !item && slotNumber) $('[data-booth-form]').elements.namedItem('slotNumber').value = String(slotNumber);
  },
});
planner = createArrangementPlanner({
  root: $('[data-arrangement-planner]'), request,
  getContext: () => ({ content: draft?.content, revision: draft?.revision, dirty, busy: !localRecovering&&(busy||awaitingContentProof()||Boolean(localRecovery)||Boolean(localPendingArchive)) || portraitUploading || coverUploading || organizations?.hasUnapplied(),
    active:activePage==='arrangements',allowed: Boolean(canEdit() && user?.roles.includes('outreach')) }),
  onBusy: value => { plannerBusy = value; lockControls(); },
  onDraftChange: () => {lockControls();scheduleLocalDraft();},
  onBeforeAssignmentSave:async()=>{
    const stamp=requestSessionGeneration,actor=user?.id,binding=localDraftBinding;
    if(!binding||!localDraftReady||!actor||localRecovery||localPendingArchive)throw new Error('本机恢复记录尚未就绪，请保留填写后重试。');
    await binding.flush();
    if(stamp!==requestSessionGeneration||actor!==user?.id||binding!==localDraftBinding)throw new Error('会话已变化，未提交人员安排。');
  },
  refreshArrangements: () => arrangements.refresh(),
  applyBooth: async ({ expectedRevision, ...input }) => {
    if (!canEdit() || portraitUploading || coverUploading || organizations?.hasUnapplied() || !draft || expectedRevision !== draft.revision) throw new Error('内容版本已变化，请重新打开展位核对。');
    const result = prepareBoothDraft(draft.content, { ...input, newId: 'booth_' + crypto.randomUUID().replaceAll('-', '') });
    const saved=await saveSectionCandidate(result.content,'arrangements');
    return {...result,saved,error:saved?'':saveProblem};
  },
});
organizations = createOrganizationsEditor({
  root: $('[data-organizations]'), request,
  getContext: () => ({ content: draft?.content, revision: draft?.revision, user, dirty,savePending:awaitingContentProof(),publication:publicationReport(),active:activePage==='organizations', busy: !localRecovering&&(busy||awaitingContentProof()||Boolean(localRecovery)||Boolean(localPendingArchive)) || plannerBusy || portraitUploading || coverUploading }),
  onSave: async records=>{const saved=await saveSectionCandidate({...draft.content,organizations:records},'organizations');if(!saved)throw new Error(saveProblem||'保存尚未确认，组织资料仍保留。');return true;},
  onApply: records => {
    if (!canEdit() || busy || plannerBusy || !draft) throw new Error('请重新读取可编辑草稿后，再应用组织资料。');
    const candidate = { ...draft.content, organizations: records }, checked = validateContent(candidate);
    if (!checked.valid) throw new Error([...new Set(Object.values(checked.errors))].join(' '));
    draft.content = checked.value; setDirty(true);
  },
  onChange: () => { lockControls();scheduleLocalDraft();resumePendingLinks(); }, announce,
});
guestPeople = createGuestContactPicker({
  root: $('[data-guest-person-picker]'), request,
  getContext: () => ({ user, content: draft?.content, revision: draft?.revision, guestId: $('[data-guest-form]').elements.namedItem('id').value,
    publishedIdentity: Boolean(published?.content?.guests?.some(guest => guest.id === $('[data-guest-form]').elements.namedItem('id').value)),
    busy: busy || plannerBusy || awaitingContentProof() || portraitUploading || coverUploading || Boolean(portraitPending) || organizations?.uploading }),
  getValue: () => $('[data-guest-form]').elements.namedItem('contactId').value,
  setValue: id => { $('[data-guest-form]').elements.namedItem('contactId').value = id; },
  onChange: () => { revokeGuestConsent(); guestFormDirty = true;lockControls();scheduleLocalDraft(); },
});
function announce(message, error = false) {
  status.textContent = error ? '' : message;
  errorBox.textContent = error ? message : '';
  errorBox.hidden = !error;
}
function canEdit() { return user?.roles.includes('editor'); }
function canPublish() { return user?.roles.includes('publisher'); }
function awaitingContentProof(){return Boolean(pendingSave&&['saving','unknown','conflict'].includes(saveOutcome));}
function unappliedInputs() {
  return [[eventFormDirty, '活动基本资料'], [sessionFormDirty, '场次编辑'], [boothFormDirty, '展位编辑'],
    [guestFormDirty || portraitUploading || portraitPending, '嘉宾资料'], [showcaseFormDirty || coverUploading, '游戏与作品'],
    [planner?.hasUnapplied(), '总览展位编辑'], [organizations?.hasUnapplied(), '组织资料']].filter(([changed]) => changed).map(([, label]) => label);
}
function hasUnappliedInputs() { return unappliedInputs().length > 0; }
function hasUnsavedChanges() { return dirty || hasUnappliedInputs() || planner?.hasLocalChanges() || savingContent || ['unknown', 'conflict'].includes(saveOutcome); }
function renderSaveState() {
  const state = contentSaveUiState({ loaded: Boolean(user && draft), canEdit: canEdit(), dirty, unapplied: unappliedInputs(),
    busy: busy || plannerBusy || portraitUploading || coverUploading || organizations?.uploading || checkingContentSave || Boolean(localRecovery),
    saving: savingContent, outcome: saveOutcome, revision: draft?.revision, confirmedRevision: confirmedSaveRevision, problem: saveProblem, retryReady: retryContentReady,oneStep:true });
  for (const output of document.querySelectorAll('[data-admin-save-state],[data-admin-unsaved]')) if (output.textContent !== state.title) output.textContent = state.title;
  for (const output of document.querySelectorAll('[data-admin-save-description]')) if (output.textContent !== state.description) output.textContent = state.description;
  for (const output of document.querySelectorAll('[data-admin-savebar],[data-admin-save-feedback]')) output.dataset.saveState = state.state;
  $('[data-admin-savebar]').hidden = !user || !draft || state.state==='loaded' || (!hasUnsavedChanges()&&state.state==='saved');
  for (const button of document.querySelectorAll('[data-admin-save]')) button.disabled = !state.canSave;
  for (const button of document.querySelectorAll('[data-admin-check-save]')) { button.hidden = !pendingSave || !['unknown', 'conflict'].includes(saveOutcome); button.disabled = !state.canCheck; button.textContent = checkingContentSave ? '正在核对…' : '核对云端保存结果'; }
  for (const button of document.querySelectorAll('[data-admin-retry-save]')) { button.hidden = !pendingSave || !retryContentReady; button.disabled = !state.canRetry; }
  for(const proof of document.querySelectorAll('[data-admin-dialog-proof]'))proof.hidden=!pendingSave||!['unknown','conflict'].includes(saveOutcome);
  updateSavebarSpace();
}
function updateSavebarSpace() {
  $('#artdico-admin').style.setProperty('--admin-savebar-space','0px');
}
function editorSaveState(type,state='idle',message=''){
  const form=$('[data-'+type+'-form]');if(!form)return;
  let output=form.querySelector('[data-content-form-save-state]');
  if(!output){output=node('p',undefined,'ah-form-save-state');output.dataset.contentFormSaveState=type;output.setAttribute('role','status');output.setAttribute('aria-live','polite');(form.querySelector('.ah-admin-dialog-actions')??form.lastElementChild)?.before(output);}
  editorSaveStates.set(type,state);output.dataset.saveState=state;output.replaceChildren(node('strong',({idle:'未修改',dirty:'未保存',saving:'保存中…',saved:'已保存',unknown:'保存结果待核对',conflict:'版本已更新',error:'保存未完成'})[state]??'保存未完成'));
  if(message)output.append(document.createTextNode(' '+message));
  form.setAttribute('aria-busy',String(state==='saving'));
  const button=$('[data-'+(type==='event'?'event-submit':type+'-submit')+']');if(button)button.textContent=state==='saving'?'保存中…':'保存';
}
function lockControls() {
  const controlsBusy = busy || plannerBusy || savingContent || checkingContentSave || awaitingContentProof() || Boolean(localRecovery) || Boolean(localPendingArchive);
  const organizationBusy = organizations?.uploading === true;
  $('[data-event-submit]').disabled = controlsBusy || portraitUploading || coverUploading || organizationBusy || !canEdit() || !eventFormDirty;
  for (const field of $('[data-event-form]').querySelectorAll('input,select,textarea,[data-event-add-faq],[data-event-faq-remove]')) field.disabled = controlsBusy || organizationBusy || !canEdit();
  for(const type of ['session','booth','guest','showcase'])for(const field of $('[data-'+type+'-form]').querySelectorAll('input,select,textarea,[data-content-visibility-switch]'))if(!field.closest('[data-image-editor],[data-guest-person-picker]'))field.disabled=controlsBusy||portraitUploading||coverUploading||organizationBusy||!canEdit();
  for(const type of ['guest','booth','showcase'])syncVisibilitySwitch($('[data-'+type+'-form]'));
  $('[data-admin-login-submit]').disabled = controlsBusy || location.protocol === 'file:';
  $('[data-session-submit]').disabled = controlsBusy || portraitUploading || coverUploading || organizationBusy || !canEdit() || !sessionFormDirty;
  $('[data-showcase-submit]').disabled = controlsBusy || portraitUploading || coverUploading || organizationBusy || !canEdit() || !showcaseFormDirty;
  $('[data-showcase-cover-file]').disabled = controlsBusy || organizationBusy || !canEdit();
  $('[data-showcase-cover-remove]').disabled = controlsBusy || organizationBusy || !canEdit();
  $('[data-booth-submit]').disabled = controlsBusy || portraitUploading || coverUploading || organizationBusy || !canEdit() || !boothFormDirty;
  $('[data-guest-submit]').disabled = controlsBusy || portraitUploading || Boolean(portraitPending) || coverUploading || organizationBusy || !canEdit() || !guestFormDirty;
  if(pendingSave&&['unknown','conflict'].includes(saveOutcome))for(const type of ['guest','session','booth','showcase'])if($('[data-'+type+'-dialog]').open)editorSaveState(type,'unknown',saveProblem||'请先核对原保存结果。');
  const guestForm = $('[data-guest-form]'), pendingIdentity = $('[data-guest-dialog]').open && guestForm.elements.namedItem('contactId').value !== (savedGuestContacts.get(guestForm.elements.namedItem('id').value) ?? '');
  guestForm.elements.namedItem('publicConsent').disabled = controlsBusy || portraitUploading || coverUploading || organizationBusy || !canEdit() || pendingIdentity;
  if (pendingIdentity) { guestForm.elements.namedItem('publicConsent').checked = false; $('[data-guest-consent-note]').textContent = '人员关联已变更，原授权记录需要重新核对。公开开关仍按你的选择保留。'; }
  $('[data-guest-portrait-file]').disabled = controlsBusy || portraitUploading || Boolean(portraitPending) || organizationBusy || !canEdit();
  $('[data-guest-portrait-remove]').disabled = controlsBusy || organizationBusy || !canEdit();
  $('[data-guest-portrait-edit]').disabled = controlsBusy || portraitUploading || Boolean(portraitPending) || organizationBusy || !canEdit() || !portraitIdPattern.test($('[data-guest-form]').elements.namedItem('portraitId').value);
  for (const selector of ['[data-guest-portrait-retry]','[data-guest-portrait-discard]']) {
    $(selector).hidden = !portraitPending;
    $(selector).disabled = controlsBusy || portraitUploading || organizationBusy || !canEdit();
  }
  for (const node of document.querySelectorAll('[data-admin-save],[data-admin-add-session],[data-admin-add-booth],[data-admin-fill-booths],[data-admin-add-guest],[data-admin-add-showcase],[data-row-action]')) node.disabled = controlsBusy || portraitUploading || coverUploading || organizationBusy || !canEdit();
  for(const button of document.querySelectorAll('[data-admin-publish]')){
    button.disabled=!publicationReport()||controlsBusy||portraitUploading||coverUploading||organizationBusy||!canPublish()||savingContent||['unknown','conflict'].includes(saveOutcome);
    button.textContent=dirty||hasUnappliedInputs()?'保存并发布':'发布到前台';
    button.title='发布已保存的全部活动内容；本页修改会先保存并核对回执。';
  }
  $('[data-admin-preview]').disabled = controlsBusy || !draft;
  $('[data-admin-logout]').disabled = busy || plannerBusy || localRecovering || savingContent || checkingContentSave || portraitUploading || coverUploading || organizationBusy;
  for(const button of document.querySelectorAll('[data-admin-proof-logout]'))button.disabled=$('[data-admin-logout]').disabled;
  arrangements.configure({ allowed: Boolean(activePage==='arrangements'&&canEdit() && user?.roles.includes('outreach')), busy: controlsBusy || portraitUploading || coverUploading || organizationBusy, dirty, draftRevision: draft?.revision });
  planner?.configure();
  organizations?.configure();
  guestPeople?.configure();
  renderSaveState();
  for(const button of document.querySelectorAll('[data-admin-local-restore],[data-admin-local-discard],[data-admin-local-copy]'))button.disabled=busy||plannerBusy||localRecovering||button.hasAttribute('data-admin-local-copy')&&Boolean(localRecovery?.record&&localRecovery.record.value.roleKey!==roleKey());
  for(const button of document.querySelectorAll('[data-content-copy]'))button.disabled=busy||plannerBusy||localRecovering||!canEdit();
  for(const button of document.querySelectorAll('[data-admin-navigation-save],[data-admin-navigation-discard],[data-admin-navigation-cancel]'))button.disabled=busy||plannerBusy||savingContent||checkingContentSave||localRecovering||button.hasAttribute('data-admin-navigation-save')&&awaitingContentProof();
  if($('[data-admin-save]'))$('[data-admin-save]').hidden=['overview','publish'].includes(activePage)&&!legacyWorkspaceReview;
  syncShowcaseForms();
}
function setDirty(value) {
  dirty = value;
  if (value && !['unknown', 'conflict'].includes(saveOutcome)) saveProblem = '';
  lockControls();
  if(value)scheduleLocalDraft();
}
async function request(path, options = {}) {
  const sessionGeneration = requestSessionGeneration;
  const { binaryImage = false, isCurrent = () => true, ...fetchOptions } = options;
  const controller=new AbortController(),upstream=fetchOptions.signal,abort=()=>controller.abort();requestControllers.add(controller);
  if(upstream?.aborted)controller.abort();else upstream?.addEventListener('abort',abort,{once:true});
  try{
  const headers = { Accept: binaryImage ? 'image/png,image/jpeg,image/webp' : 'application/json', ...options.headers };
  if (options.body) headers['Content-Type'] = 'application/json';
  if (options.method && options.method !== 'GET' && csrfToken) headers['X-CSRF-Token'] = csrfToken;
  const response = await fetch(path, { ...fetchOptions, signal:controller.signal,headers, credentials: 'same-origin', cache: 'no-store', redirect: 'error' });
  if (sessionGeneration !== requestSessionGeneration) { await response.body?.cancel().catch(() => {}); throw new Error('会话已变化，请重新操作。'); }
  const expired = response.status === 401 && path !== '/api/admin/login';
  const restricted = response.status === 403 && path !== '/api/admin/login';
  if (expired || restricted) {
    await response.body?.cancel().catch(() => {});
    const message = expired ? '会话已结束，请重新登录。' : '工作区权限已变化，请重新登录核对当前权限。';
    showLogin(); announce(message, true);
    const failure = new Error(message); failure.status = response.status; throw failure;
  }
  if (!isCurrent()) { await response.body?.cancel().catch(() => {}); throw new Error('当前选择已变化，请重新操作。'); }
  const result = binaryImage && response.ok ? null : await response.json().catch(() => ({}));
  if (sessionGeneration !== requestSessionGeneration || !isCurrent()) throw new Error('会话或当前选择已变化，请重新操作。');
  if (!response.ok) {
    const message = response.status === 503 && result?.error?.code === 'CONTENT_NOT_READY' ? '后台服务暂不可用，可能正在更新。请稍后重试。' : response.status === 409 ? '草稿已被其他工作人员更新。你的修改仍保留在本页；请先复制需要保留的内容，再重新载入最新草稿。' : result?.error?.message || '操作暂未完成，请重试。';
    const failure = new Error(message); failure.status = response.status;
    failure.code = result?.error?.code === 'CONTENT_NOT_READY' ? 'CONTENT_NOT_READY' : '';
    throw failure;
  }
  if (binaryImage) {
    const id = path.split('/').at(-1), type = response.headers.get('content-type')?.split(';')[0].trim();
    const expectedType = id?.endsWith('.jpg') ? 'image/jpeg' : id?.endsWith('.png') ? 'image/png' : 'image/webp';
    if (!portraitIdPattern.test(id ?? '') || type !== expectedType) throw new Error('原图片格式未能核对，请重新选择图片。');
    const reader = response.body?.getReader(); if (!reader) throw new Error('原图片暂时无法读取，请稍后重试。');
    const parts = []; let length = 0;
    try {
      while (true) {
        const chunk = await reader.read(); if (chunk.done) break;
        length += chunk.value.byteLength;
        if (length > 512 * 1024) throw new Error('原图片超过安全读取范围，请重新选择图片。');
        parts.push(chunk.value);
      }
    } catch (failure) { await reader.cancel().catch(() => {}); throw failure; }
    finally { reader.releaseLock(); }
    if (!length) throw new Error('原图片暂时无法读取，请重新选择图片。');
    const file = new File(parts, id, { type });
    if (!globalThis.crypto?.subtle) throw new Error('当前浏览器无法校验原图片，请从本机重新选择图片。');
    const digest = [...new Uint8Array(await crypto.subtle.digest('SHA-256', await file.arrayBuffer()))].map(byte => byte.toString(16).padStart(2,'0')).join('');
    if (digest !== id.split('.')[0]) throw new Error('原图片内容未能核对，请重新选择图片。');
    if (sessionGeneration !== requestSessionGeneration) throw new Error('会话已变化，请在当前工作区重新操作。');
    return file;
  }
  return result;
  }finally{requestControllers.delete(controller);upstream?.removeEventListener('abort',abort);}
}
async function action(callback) {
  if (busy || plannerBusy || savingContent || checkingContentSave || organizations?.uploading) return;
  const sequence=++actionSequence;busy = true;
  lockControls();
  try { await callback(); } catch (error) { if(sequence===actionSequence||!user)announce(error.message || '操作未完成。', true); }
  finally { if(sequence===actionSequence){busy=false;lockControls();scheduleLocalDraft();resumePendingLinks();void loadActivePageData();} }
}
function resumePendingLinks() {
  if (!user || !draft || busy || plannerBusy || portraitUploading || portraitPending || hasUnappliedInputs() || localRecovery || localPendingArchive || localRecovering) return;
  if (pendingBooth) { const id = pendingBooth; pendingBooth = null;activatePage('booths');const item=draft.content.booths.find(item=>item.id===id);if(item)openEditor('booth',item);else announce('此展位已不存在，请核对最新记录。',true);return; }
  if (pendingOrganization) { const id = pendingOrganization; pendingOrganization = null;activatePage('organizations');organizations.openById(id);return; }
  if(pendingEntity){const{type,id}=pendingEntity;pendingEntity=null;const item=draft.content[contentKey(type)]?.find(item=>item.id===id);if(item)openEditor(type,item);else announce('此记录已不存在，请核对最新资料。',true);return;}
  if (pendingInvitee) queueMicrotask(() => action(prepareInvitedGuest));
}
function showLogin() {
  requestSessionGeneration += 1;
  actionSequence++;
  localDraftBinding?.close();localDraftBinding=null;localDraftReady=false;localRecovering=false;localRecovery=null;localPendingArchive=null;localDraftProblem='';
  for(const controller of requestControllers)controller.abort();requestControllers.clear();busy=false;
  clearPortrait();
  clearCover();
  organizations?.clear();
  guestPeople?.clear();
  arrangements.clear();
  planner?.clear();
  user = null;
  csrfToken = '';
  draft = null;
  loadedContent=null;publicationCache=null;publicationUncertain=false;pendingForms=null;pendingHistorical=false;pendingUncertain=false;legacyWorkspaceReview=false;arrangementsRevision=null;arrangementsLoading=false;navigationTarget=null;
  for(const key of Object.keys(editorStableIds))delete editorStableIds[key];renderPageView();
  savedGuestContacts.clear();
  published = null;
  dirty = false;
  eventFormDirty = false;
  sessionFormDirty = false; boothFormDirty = false;
  saveOutcome = 'loaded'; saveProblem = ''; pendingSave = null; confirmedSaveRevision = null;
  savingContent = false; checkingContentSave = false; retryContentReady = false;
  $('[data-event-form]').reset();
  workspace.hidden = true;
  loginPanel.hidden = false;
  $('[data-admin-sessions]').replaceChildren();
  $('[data-admin-booths]').replaceChildren();
  $('[data-admin-guests]').replaceChildren();
  $('[data-admin-showcases]').replaceChildren();
  for (const field of ['sessionId', 'boothId']) $('[data-showcase-form]').elements.namedItem(field).replaceChildren();
  $('[data-admin-public-preview]').replaceChildren();
  for(const selector of ['[data-admin-publication-summary]','[data-admin-publication-detail]','[data-admin-publication-source]'])$(selector)?.replaceChildren();
  $('[data-admin-preview-panel]').hidden = true;
  for (const dialog of document.querySelectorAll('dialog')) if (dialog.open) dialog.close();
  for (const type of ['session', 'booth', 'guest', 'showcase']) {
    $('[data-' + type + '-form]').reset();
    for (const field of $('[data-' + type + '-form]').querySelectorAll('input[type=hidden]')) field.value = '';
    const error = $('[data-' + type + '-error]');
    error.textContent = '';
    error.hidden = true;
  }
  const guestSelect=$('[data-session-form]').elements.namedItem('guestId');
  guestSelect.replaceChildren();
  const unlinked=node('option','手动维护讲者 · 未关联嘉宾');unlinked.value='';guestSelect.append(unlinked);
  fillBoothOrganizations('');
  editingSession = null;
  editingBooth = null;
  editingGuest = null;
  guestFormDirty = false;
  showcaseFormDirty = false;
  editingShowcase = null;
  for(const selector of ['[data-admin-user]','[data-admin-role]','[data-admin-event-title]','[data-admin-event-date]','[data-admin-event-venue]','[data-admin-revision]','[data-admin-guest-count]','[data-admin-session-count]','[data-admin-booth-count]','[data-admin-published-at]','[data-admin-local-status]','[data-admin-local-message]'])$(selector).textContent='';
  $('[data-admin-local-recovery]').hidden=true;$('[data-admin-copy-fallback]').value='';$('[data-admin-copy-fallback]').hidden=true;
  $('[data-admin-login]').reset();$('[data-event-faq]').replaceChildren();
  renderSaveState();
  lockControls();
}
function node(tag, value, className) {
  const result = document.createElement(tag);
  if (value !== undefined) result.textContent = value;
  if (className) result.className = className;
  return result;
}
function cell(row, label, value) {
  const td = node('td', value);
  td.dataset.label = label;
  row.append(td);
  return td;
}
function publicationReport(){
  if(!draft||!loadedContent||!user||publicationUncertain)return null;
  if(publicationCache?.content===loadedContent&&publicationCache.revision===draft.revision&&publicationCache.published===published)return publicationCache.report;
  let report=null;try{report=contentPublicationReadiness({draft:{revision:draft.revision,content:loadedContent},published});}catch{}
  publicationCache={content:loadedContent,revision:draft.revision,published,report};return report;
}
function publicationItem(collection,id){return publicationReport()?.items[collection]?.find(item=>item.id===id)??null;}
function syncVisibilitySwitch(form){
  const button=form?.querySelector('[data-content-visibility-switch]'),field=form?.elements.namedItem('visibility');
  if(!button||!field)return;
  const visible=field.value!=='private';button.dataset.visibility=visible?'public':'private';button.setAttribute('aria-checked',String(visible));
  const label=button.querySelector('[data-content-visibility-label]');if(label)label.textContent=visible?'公开':'未公开';
}
function appendVisibility(output,type,item){
  const visible=item.visibility!=='private',button=node('button',visible?'公开':'未公开','ah-visibility-switch');
  button.type='button';button.dataset.rowAction='visibility';button.dataset.visibility=visible?'public':'private';button.dataset.visibilityKind=contentKey(type);button.dataset.visibilityId=item.id;
  button.setAttribute('role','switch');button.setAttribute('aria-checked',String(visible));button.setAttribute('aria-label',({guest:'嘉宾 ',showcase:'作品 ',booth:'展位 '})[type]+(item.name||item.title||item.code||item.id)+' 公开');
  button.title=visible?'点击设为未公开，发布后从前台隐藏':'点击设为公开，发布后显示到前台';
  button.addEventListener('click',()=>action(()=>toggleRecordVisibility(type,item.id)));
  output.append(button);return button;
}
async function toggleRecordVisibility(type,id){
  if(!canEdit()||!draft)return false;
  const collection=contentKey(type),candidate=structuredClone(draft.content),item=candidate[collection]?.find(value=>value.id===id);if(!item)return false;
  item.visibility=item.visibility==='private'?'public':'private';
  const visible=item.visibility==='public',saved=await saveSectionCandidate(candidate,collection);
  if(saved){announce('已保存为「'+(visible?'公开':'未公开')+'」。点击「发布到前台」更新公开页面。');$('[data-visibility-kind="'+collection+'"][data-visibility-id="'+id+'"]')?.focus({preventScroll:true});}
  return saved;
}
function publicationMatches(item,filter,record){
  if(!filter)return true;
  if(filter==='public')return record?.visibility!=='private';
  if(filter==='private')return record?.visibility==='private';
  if(!item)return false;
  if(filter==='published')return item.published===true;
  if(filter==='unpublished')return item.published===false;
  if(filter==='ready')return item.ready===true;
  if(filter==='changed')return ['new','updated','removed'].includes(item.change);
  return filter==='blocked'&&item.change==='blocked';
}
function appendPublication(output,collection,id){
  const report=publicationReport(),item=report?.items[collection]?.find(value=>value.id===id),badge=node('span',!report?'发布状态待核对':!item?'待保存':item.change==='removed'?'待撤下':item.change==='updated'?'待更新':item.published?'已发布':item.visible===false?'未发布':'待发布','ah-status');
  badge.dataset.publicationRecord='';badge.dataset.publicationKind=collection;badge.dataset.publicationId=id;
  badge.dataset.publicationState=!report?'unknown':!item?'unsaved':item.published?'published':'unpublished';
  badge.dataset.statusTone='neutral';badge.dataset.publicationChange=item?.change??'';output.append(badge);
  if(item){
    const detail=node('small',PUBLICATION_CHANGE_LABELS[item.change]??'公开进度待核对');detail.dataset.publicationProgress='';output.append(detail);
    if(item.reasons.length){const reasons=node('small',item.reasons.map(code=>PUBLICATION_REASON_LABELS[code]??'请核对公开条件').join('；'));reasons.dataset.publicationReasons='';output.append(reasons);}
    if(item.suggestions.length)output.append(node('small','建议完善：'+item.suggestions.map(code=>PUBLICATION_SUGGESTION_LABELS[code]??'可选资料').join('、')));
  }
  return item;
}
function renderPublicationOverview(){
  const output=$('[data-admin-publication-summary]'),detail=$('[data-admin-publication-detail]'),source=$('[data-admin-publication-source]');if(!output||!detail||!source)return;
  output.replaceChildren();detail.replaceChildren();const report=publicationReport();
  if(!report){source.textContent='公开快照暂时无法核对。请重新读取后再决定发布。';return;}
  source.textContent='已保存草稿版本 '+report.draftRevision+' · '+(report.publishedRevision===null?'尚未发布':('已发布版本 '+report.publishedRevision+(report.publishedAt?' · '+new Date(report.publishedAt).toLocaleString('zh-CN'):'')))+(report.organizationSource==='initial'?'。前台组织仍使用初始内容，不能视为本名单已公开。':'');
  if(dirty||hasUnappliedInputs()||pendingSave||localRecovery)source.textContent+=' 当前还有尚未保存或待核对的填写，以下仅核对已保存内容。';
  for(const[key,label]of[['new','新增'],['updated','更新'],['removed','撤下'],['unchanged','已同步'],['blocked','未公开']]){const card=node('article');card.append(node('span',label));const count=node('strong',String(report.summary[key]??0));count.dataset.publicationCount=key;card.append(count);output.append(card);}
  if(report.eventChanged)detail.append(node('p','活动基本资料有变更，明确发布后才更新前台。'));
  for(const[collection,label]of[['guests','讲者与嘉宾'],['organizations','参与组织'],['showcases','游戏与作品'],['sessions','活动场次'],['booths','展位']]){
    const items=report.items[collection]??[];if(!items.length)continue;
    const section=node('section');section.append(node('h4',label+(report.orderChanged?.[collection]?' · 顺序变更待发布':'')));const list=node('ul');
    for(const item of items){const row=node('li');row.dataset.publicationDetailKind=collection;row.dataset.publicationDetailId=item.id;row.append(node('strong',item.label));appendPublication(row,collection,item.id);
      if(item.inDraft){const link=node('a','核对资料');const type={guests:'guest',organizations:'organization',showcases:'showcase',sessions:'session',booths:'booth'}[collection];link.href=contentPageHref(collection)+'#'+type+'='+encodeURIComponent(item.id);row.append(link);}list.append(row);}
    section.append(list);detail.append(section);
  }
  if(!report.hasPublicChanges)detail.append(node('p','已保存内容与当前公开快照一致。'));
}
function rowActions(row, type, item) {
  const td = cell(row, '操作', undefined);
  const actions = type === 'guest' ? [['编辑','edit']] : [['编辑','edit'],['删除','delete']];
  for (const [label, actionName] of actions) {
    const button = node('button', label);
    button.type = 'button';
    button.dataset.rowAction = actionName;
    button.setAttribute('aria-label', label + ({ session: '场次 ' + item.title, booth: '展位 ' + item.code, guest: '嘉宾 ' + item.name })[type]);
    button.addEventListener('click', () => {
      if (!canEdit() || busy) return;
      if (actionName === 'edit') openEditor(type, item);
      else {
        if (['session', 'booth'].includes(type) && (draft.content.showcases ?? []).some(showcase => showcase[type === 'session' ? 'sessionId' : 'boothId'] === item.id)) {
          announce('此记录仍关联游戏与作品，请先在作品安排中解除关联，再删除。', true);
          return;
        }
        const key = contentKey(type);
        if(!confirm('删除这条'+typeLabel(type)+'并保存？前台会在发布后更新。'))return;
        void action(async()=>{const candidate=structuredClone(draft.content);candidate[key]=candidate[key].filter(entry=>entry.id!==item.id);if(await saveSectionCandidate(candidate,key))announce('已删除并保存。发布后更新前台。');});
      }
    });
    td.append(button);
  }
}
function render() {
  if (!draft) return;
  if (!eventFormDirty) for (const [name,value] of Object.entries(draft.content.event)) {
    const field = $('[data-event-form]').elements.namedItem(name);
    if (field) field.value = value;
  }
  if (!eventFormDirty) {
    const presentation = draft.content.event.presentation ?? createInitialPresentation();
    for (const name of ['heroDescription','aboutTitle','aboutText','checkInTime','openingTime','endTime','contactEmail','mapUrl']) $('[data-event-form]').elements.namedItem(name).value = presentation[name] ?? '';
    renderFaqFields(presentation.faqItems ?? []);
  }
  $('[data-admin-user]').textContent = user.label || user.id;
  $('[data-admin-role]').textContent = canPublish() ? '可编辑与发布' : canEdit() ? '可编辑草稿' : '只读';
  if (canPublish() && !canEdit()) $('[data-admin-role]').textContent = '可预览与发布';
  $('[data-admin-event-title]').textContent = draft.content.event.title;
  $('[data-admin-event-date]').textContent = draft.content.event.date + (draft.content.event.dateStatus === 'confirmed' ? '' : '（暂定）');
  $('[data-admin-event-venue]').textContent = draft.content.event.venue + (draft.content.event.venueStatus === 'confirmed' ? '' : '（暂定）');
  $('[data-admin-revision]').textContent = String(draft.revision);
  $('[data-admin-published-at]').textContent = published?.publishedAt ? new Date(published.publishedAt).toLocaleString('zh-CN') : '尚未发布';
  $('[data-admin-session-count]').textContent = String(draft.content.sessions.length);
  $('[data-admin-guest-count]').textContent = String(draft.content.guests?.length ?? 0);
  $('[data-admin-booth-count]').textContent = String(draft.content.booths.length);
  const sessions = $('[data-admin-sessions]');
  sessions.replaceChildren();
  for (const item of [...draft.content.sessions].sort((a,b) => a.start.localeCompare(b.start) || a.zone.localeCompare(b.zone))) {
    const row = node('tr');
    cell(row, '时间', item.start + '–' + item.end);
    cell(row, '场地', item.zone + ' 区');
    const titleCell = cell(row, '场次', item.title);
    titleCell.append(node('small', ({talk:'演讲',workshop:'工作坊',roundtable:'圆桌',showcase:'作品分享',social:'交流活动',break:'休息 / 签到',other:'待分类 / 其他'})[item.format] || '待分类 / 其他', 'ah-admin-row-format'));
    const linkedGuest = item.guestId ? draft.content.guests?.find(guest => guest.id === item.guestId) : null;
    cell(row, '讲者', linkedGuest ? linkedGuest.name + (linkedGuest.status === 'confirmed' && linkedGuest.publicConsent ? '（已关联）' : '（待确认或授权）') : item.speakerStatus === 'confirmed' ? item.speakerName : '待确认' + (item.speakerName ? '（已记内部候选）' : ''));
    cell(row, '状态', { draft: '草稿', scheduled: '已安排', cancelled: '已取消' }[item.status]);
    rowActions(row, 'session', item);
    sessions.append(row);
  }
  $('[data-admin-sessions-empty]').hidden = draft.content.sessions.length > 0;
  const booths = $('[data-admin-booths]');
  booths.replaceChildren();
  for (const item of [...draft.content.booths].sort((a,b) => a.code.localeCompare(b.code))) {
    const row = node('tr');
    const codeCell = cell(row, '编号', item.code);
    codeCell.append(node('small', item.slotNumber ? String(item.slotNumber).padStart(2,'0')+' 号位置' : '未指定位置', 'ah-admin-row-format'));
    const organizationCell = cell(row, '出席单位', item.organization || '待确认');
    if (item.organizationId) { const organization = draft.content.organizations?.find(value => value.id === item.organizationId); organizationCell.append(node('small', organization ? '关联组织：' + organization.name : '关联组织暂不可核对')); }
    const projectCell=cell(row, '展示内容', item.project || '待确认');
    if(item.description)projectCell.append(node('small',item.description));
    const contactCell=cell(row,'负责人 / 联系方式',item.contactName||'负责人待填写');
    contactCell.append(node('small',item.contactMethods||'联系方式待填写 · 不公开'));
    cell(row, '场地', item.zone + ' 区');
    cell(row, '状态', { pending: '待确认', confirmed: '已确认', cancelled: '已取消' }[item.status]);
    const publicCell=cell(row,'公开',undefined);appendVisibility(publicCell,'booth',item);appendPublication(publicCell,'booths',item.id);
    rowActions(row, 'booth', item);
    booths.append(row);
  }
  $('[data-admin-booths-empty]').hidden = draft.content.booths.length > 0;
  const guests = $('[data-admin-guests]');
  guests.replaceChildren();
  const guestFilter=$('[data-admin-guest-publication-filter]')?.value??'';
  for (const item of draft.content.guests ?? []) {
    if(!publicationMatches(publicationItem('guests',item.id),guestFilter,item))continue;
    const row = node('tr');row.dataset.guestId=item.id;
    const photo = cell(row, '头像', undefined);
    if (portraitIdPattern.test(item.portraitId)) {
      const image = node('img', undefined, 'ah-admin-guest-avatar');
      image.src = '/api/admin/portraits/' + item.portraitId;
      image.alt = item.name + '的头像（内部预览）';
      image.width = 54; image.height = 54; image.loading = 'lazy';
      image.addEventListener('error', () => { image.remove(); photo.append(node('span', '预览不可用', 'ah-admin-guest-no-photo')); }, { once: true });
      photo.append(image);
    } else {const initial=node('span',[...(item.name||'嘉')][0],'ah-admin-guest-no-photo');initial.title='照片选填';photo.append(initial);}
    const identity=cell(row,'姓名 / 公开职责',item.name||'待填写');
    if(item.publicRoles?.length)identity.append(node('small',item.publicRoles.map(role=>GUEST_PUBLIC_ROLE_LABELS[role]).join(' · ')));
    if (item.contactId) { if (user?.roles.includes('outreach')) { const link = node('a', '个人工作页'); link.href = '/admin/person/#contact=' + encodeURIComponent(item.contactId); identity.append(link); } else identity.append(node('small', '已关联内部人员')); }
    const affiliation=cell(row,'机构 / 职称',item.company||'待填写');if(item.title)affiliation.append(node('small',item.title));
    cell(row,'GGJ 职务',item.ggjRole||'—');
    const publicCell=cell(row,'公开',undefined);appendVisibility(publicCell,'guest',item);appendPublication(publicCell,'guests',item.id);
    rowActions(row, 'guest', item);
    guests.append(row);
  }
  $('[data-admin-guests-empty]').hidden = guests.childElementCount>0;
  $('[data-admin-guests-empty]').textContent=(draft.content.guests?.length??0)?'此筛选下没有嘉宾资料。':'还没有嘉宾资料。新增后默认公开，发布后显示到前台。';
  renderShowcases();renderPublicationOverview();
  if(activePage==='organizations')organizations?.render();
  lockControls();
}
function openEditor(type, item = null, allowBusy = false) {
  if (!canEdit() || (busy && !allowBusy) || organizations?.hasUnapplied() || !draft) return;
  activatePage(({guest:'guests',session:'sessions',booth:'booths',showcase:'showcases'})[type]);
  if (type === 'showcase') { openShowcaseEditor(item); return; }
  const form = $('[data-' + type + '-form]');
  form.reset();
  const localError = $('[data-' + type + '-error]');
  localError.textContent = '';
  localError.hidden = true;
  if (type === 'guest') { clearPortrait(); guestFormDirty=false; $('[data-guest-consent-note]').textContent='确认与授权记录保留；公开设置由上方开关控制，发布后更新前台。'; }
  if (type === 'session') { sessionFormDirty = false; fillSessionGuests(); }
  if (type === 'booth') { boothFormDirty = false; fillBoothOrganizations(item?.organizationId ?? ''); }
  const id = type + '-' + [...crypto.getRandomValues(new Uint8Array(16))].map(value => value.toString(16).padStart(2, '0')).join('');
  const value = item || (type === 'session' ? { id, start: '09:30', end: '10:00', zone: 'A', title: '', format: 'other', speakerName: '', speakerStatus: 'pending', guestId: '', status: 'draft', internalNotes: '' } : type === 'booth' ? { id, code: '', organization: '', project: '', zone: 'C', slotNumber: 0, status: 'pending', internalNotes: '' } : { id, name: '', company: '', ggjRole: '', portraitId: '', contactId: '', status: 'pending', publicConsent: false, internalNotes: '' });
  editorStableIds[type]=value.id;
  for (const [key,valueText] of Object.entries(value)) {
    if(type==='guest'&&key==='publicRoles'){for(const option of form.querySelectorAll('[name=publicRoles]'))option.checked=valueText.includes(option.value);continue;}
    const field = form.elements.namedItem(key);
    if (field?.type === 'checkbox') field.checked = valueText === true;
    else if (field) field.value = valueText;
  }
  if (type === 'session' && !value.format) form.elements.namedItem('format').value = 'other';
  if (type === 'booth' && value.slotNumber === undefined) form.elements.namedItem('slotNumber').value = '0';
  if (type === 'session') { editingSession = item?.id ?? null; syncSessionGuest(); }
  else if (type === 'booth') editingBooth = item?.id ?? null;
  else { editingGuest = item?.id ?? null; showPortrait(value.portraitId); }
  $('[data-' + type + '-dialog-title]').textContent = (item ? '编辑' : '新增') + typeLabel(type);
  $('[data-' + type + '-dialog]').showModal();
  editorSaveState(type,'idle','修改后保存当前'+typeLabel(type)+'。');
  if (type === 'guest') guestPeople?.open();
  syncVisibilitySwitch(form);
  lockControls();
}
async function prepareInvitedGuest(){
  if(!pendingInvitee||organizations?.hasUnapplied()||localRecovery||localPendingArchive||localRecovering)return false;
  const id=pendingInvitee;pendingInvitee=null;
  if(guestFormDirty&&!confirm('准备新的嘉宾资料会放弃本次尚未保存的修改，继续吗？'))return false;
  if(!canEdit()||!user?.roles.includes('outreach'))throw new Error('准备邀约对象的嘉宾草稿需要同时具备人员邀约与活动编辑权限。');
  const result=await request('/api/admin/contacts/'+encodeURIComponent(id)+'/guest-prefill');
  const prefill=result.prefill;
  if(!prefill||!['name','company','ggjRole','contactId'].every(key=>typeof prefill[key]==='string')||Object.keys(prefill).some(key=>!['name','company','ggjRole','contactId','title','bio','website','publicRoles'].includes(key))||prefill.contactId!==id||['title','bio','website'].some(key=>prefill[key]!==undefined&&typeof prefill[key]!=='string')||prefill.publicRoles!==undefined&&(!Array.isArray(prefill.publicRoles)||prefill.publicRoles.length>4||prefill.publicRoles.some(role=>!GUEST_PUBLIC_ROLES.includes(role))||new Set(prefill.publicRoles).size!==prefill.publicRoles.length))throw new Error('嘉宾预填资料无效，请返回人员工作区重新核对。');
  const existing=(draft.content.guests??[]).find(guest=>guest.contactId===prefill.contactId);
  openEditor('guest',existing??null,true);
  const form=$('[data-guest-form]');
  if(existing){
    $('[data-guest-consent-note]').textContent='已打开该邀约对象关联的嘉宾资料。名单回复与嘉宾公开状态分别维护；请核实当前回复，再决定是否发布。';
    announce('已打开关联嘉宾，未重复新增。现有照片、资料与授权保持原记录。');
  }else{
    for(const key of ['name','company','ggjRole','contactId','title','bio','website'])if(prefill[key]!==undefined)form.elements.namedItem(key).value=prefill[key];
    for(const option of form.querySelectorAll('[name=publicRoles]'))option.checked=prefill.publicRoles?.includes(option.value)??false;
    form.elements.namedItem('status').value='pending';form.elements.namedItem('publicConsent').checked=false;
    form.elements.namedItem('portraitId').value='';showPortrait('');guestFormDirty=true;editorSaveState('guest','dirty','已准备填写，尚未保存。');
    $('[data-guest-consent-note]').textContent='已从邀约名单预填资料，实际回复：'+({pending:'待回复',attending:'确认参加',declined:'不参加'}[result.responseStatus]??'待核实')+'。请另行核实资料、出席与公开授权；尚未保存或公开。';
    if(Array.isArray(result.omittedFields)&&result.omittedFields.some(field=>['title','bio','website'].includes(field)))$('[data-guest-consent-note]').textContent+=' 部分原始资料超出公开栏位限制或网址格式无效，未自动带入；原始名单资料仍完整保留，请另行核对。';
    announce('已准备关联嘉宾资料表，尚未保存。请核实职务、照片与公开同意，再保存。');
    guestPeople?.open();
  }
  return true;
}
function closeGuestEditor(){
  if(busy)return;
  if((guestFormDirty||portraitUploading||portraitPending)&&!confirm('关闭将放弃本次尚未保存的嘉宾资料及图片编辑，继续吗？'))return;
  $('[data-guest-dialog]').close();
}
function closeSimpleEditor(type) {
  if (busy || plannerBusy) return;
  const changed = type === 'booth' ? boothFormDirty : sessionFormDirty;
  if (changed && !confirm('关闭将放弃本次尚未保存的' + typeLabel(type) + '修改，继续吗？')) return;
  $('[data-' + type + '-dialog]').close();
  if (type === 'booth') boothFormDirty = false; else sessionFormDirty = false;
  lockControls();
}
function invalidContent(result,type,quiet=false){
  if(result.valid)return result.value;
  if(!quiet){const message=[...new Set(Object.values(result.errors))].join(' '),box=$('[data-'+type+'-error]');if(box){box.textContent=message;box.hidden=false;box.focus();}else announce(message,true);}
  return null;
}
function eventCandidate(base=draft.content,record=null,quiet=false){
  const fields=record?.fields??readContentForm($('[data-event-form]'),'event'),candidate=structuredClone(base);
  if(!fields)return null;
  for(const name of ['title','date','timezone','venue','status','dateStatus','venueStatus'])candidate.event[name]=fields[name];
  candidate.event.presentation={};for(const name of ['heroDescription','aboutTitle','aboutText','checkInTime','openingTime','endTime','contactEmail','mapUrl'])candidate.event.presentation[name]=fields[name];
  candidate.event.presentation.faqItems=record?.faqItems??[...$('[data-event-faq]').children].map(row=>({question:row.querySelector('[name=faqQuestion]').value,answer:row.querySelector('[name=faqAnswer]').value}));
  return invalidContent(validateContent(candidate),'event',quiet);
}
function entityCandidate(type,base=draft.content,record=null,quiet=false){
  const form=$('[data-'+type+'-form]'),raw=record?.fields??readContentForm(form,type);if(!raw)return null;
  const candidate=structuredClone(base),key=contentKey(type),editingId=record?record.editingId:({session:editingSession,booth:editingBooth,guest:editingGuest,showcase:editingShowcase})[type],value=structuredClone(raw);
  value.id=editingId??(record?raw.id:editorStableIds[type]??raw.id);candidate[key]??=[];
  const previous=candidate[key].find(item=>item.id===value.id);
  if(editingId&&!previous){if(!quiet)announce('原记录已变化，请保留填写并重新核对。',true);return null;}
  if(['guest','booth','showcase'].includes(type)){
    if(!Object.hasOwn(raw,'visibility')){if(previous&&Object.hasOwn(previous,'visibility'))value.visibility=previous.visibility;}
    else if(raw.visibility==='public'&&previous&&!Object.hasOwn(previous,'visibility'))delete value.visibility;
  }
  if(type==='booth'){if(!Object.hasOwn(raw,'website')&&previous&&Object.hasOwn(previous,'website'))value.website=previous.website;value.slotNumber=Number(value.slotNumber);const relation=boothOrganizationField(previous,value.organizationId);delete value.organizationId;Object.assign(value,relation);}
  if(type==='showcase'){value.memberCount=Number(value.memberCount);delete value.kind;delete value.organizationId;Object.assign(value,showcaseOptionalFields(previous,raw,{isNew:!previous&&!editingId}));}
  if(type==='session'&&value.guestId){value.speakerName='';value.speakerStatus='pending';}
  const index=candidate[key].findIndex(item=>item.id===value.id);if(index<0)candidate[key].push(value);else candidate[key][index]=value;
  return invalidContent(validateContent(candidate),type,quiet);
}
function formAlreadySaved(type,record,content){
  try{
    if(type==='event'){const candidate=eventCandidate(content,record,true);return Boolean(candidate&&sameContent(candidate,content));}
    if(['guest','session','booth','showcase'].includes(type)){if(!content[contentKey(type)]?.some(item=>item.id===record.fields.id))return false;const candidate=entityCandidate(type,content,record,true);return Boolean(candidate&&sameContent(candidate,content));}
    if(type==='organization'){const rows=structuredClone(content.organizations??[]),index=rows.findIndex(item=>item.id===record.fields.id);if(index<0)return false;const item=structuredClone(record.fields);if(!Object.hasOwn(item,'visibility')&&Object.hasOwn(rows[index],'visibility'))item.visibility=rows[index].visibility;else if(item.visibility==='public'&&!Object.hasOwn(rows[index],'visibility'))delete item.visibility;rows[index]=item;const checked=validateContent({...content,organizations:rows});return checked.valid&&sameContent(checked.value,content);}
    if(type==='planner'){
      if(record.assignment||record.uncertain||record.selected.type!=='booth'||!record.booth)return false;
      const original=content.booths.find(item=>record.selected.id?item.id===record.selected.id:item.slotNumber===record.selected.slotNumber&&item.status!=='cancelled');if(!original)return false;
      return sameContent(prepareBoothDraft(content,{boothId:original.id,slotNumber:record.selected.slotNumber,original,changes:record.booth}).content,content);
    }
  }catch{}
  return false;
}
function finalizeAcknowledgedForms(content){
  const forms=captureLocalDraft().forms;
  if(forms.event&&formAlreadySaved('event',forms.event,content)){eventFormDirty=false;editorSaveState('event','saved','活动资料已保存。');}
  for(const type of ['session','booth','guest','showcase'])if(forms[type]&&formAlreadySaved(type,forms[type],content)){
    const id=forms[type].fields.id;editorStableIds[type]=id;
    if(type==='session'){editingSession=id;sessionFormDirty=false;}
    if(type==='booth'){editingBooth=id;boothFormDirty=false;}
    if(type==='guest'){editingGuest=id;guestFormDirty=false;}
    if(type==='showcase'){editingShowcase=id;showcaseFormDirty=false;}
    editorSaveState(type,'saved','当前'+typeLabel(type)+'已保存。');
  }
  if(forms.organization)organizations?.acknowledgeSaved(pendingForms?.organization??forms.organization,{keepOpen:!formAlreadySaved('organization',forms.organization,content)});
  planner?.acknowledgeSaved(forms.planner??null,{clearBooth:Boolean(forms.planner&&formAlreadySaved('planner',{...forms.planner,assignment:null,uncertain:false},content))});
  render();
}
async function saveEditor(type){
  if(!canEdit()||portraitUploading||coverUploading||!draft||type==='guest'&&portraitPending)return false;
  const form=$('[data-'+type+'-form]');if(!form.reportValidity()){editorSaveState(type,'error','请检查标出的字段。');return false;}
  const candidate=entityCandidate(type);if(!candidate){editorSaveState(type,'error','请检查填写，修改仍保留。');return false;}
  const box=$('[data-'+type+'-error]');box.textContent='';box.hidden=true;
  editorSaveState(type,'saving','正在保存当前'+typeLabel(type)+'…');
  let saved;try{saved=await saveSectionCandidate(candidate,({guest:'guests',session:'sessions',booth:'booths',showcase:'showcases'})[type]);}catch(error){editorSaveState(type,pendingSave?'unknown':'error',error.message);box.textContent=error.message;box.hidden=false;box.focus();throw error;}
  if(!saved&&user&&draft&&$('[data-'+type+'-dialog]').open){editorSaveState(type,pendingSave?'unknown':'error',saveProblem||'填写内容仍保留。');box.textContent=saveProblem||'尚未确认保存，填写内容仍保留。';box.hidden=false;box.focus();}
  return saved;
}
function submitEditor(type,event){event.preventDefault();void action(()=>saveEditor(type));}

function fillSessionGuests() {
  const select = $('[data-session-form]').elements.namedItem('guestId');
  select.replaceChildren();
  const manual = node('option', '手动维护讲者 · 未关联嘉宾'); manual.value = ''; select.append(manual);
  for (const guest of draft.content.guests ?? []) {
    const option = node('option', (guest.name || '未命名嘉宾') + (guest.status === 'confirmed' && guest.publicConsent ? ' · 已确认并授权' : ' · 待确认或授权'));
    option.value = guest.id; select.append(option);
  }
}
function syncSessionGuest() {
  const form = $('[data-session-form]');
  const linked = Boolean(form.elements.namedItem('guestId').value);
  for (const name of ['speakerName', 'speakerStatus']) form.elements.namedItem(name).disabled = linked;
  if (linked) { form.elements.namedItem('speakerName').value = ''; form.elements.namedItem('speakerStatus').value = 'pending'; }
}
function revokeGuestConsent() {
  $('[data-guest-form]').elements.namedItem('publicConsent').checked = false;
  $('[data-guest-consent-note]').textContent = '资料或照片已变更，请重新核对这份资料与照片的公开授权。保存草稿不会自动公开。';
}
function fillBoothOrganizations(selected) {
  const select = $('[data-booth-organization-id]'); select.replaceChildren();
  const blank = node('option', '未关联组织'); blank.value = ''; select.append(blank);
  for (const item of organizationChoices(draft?.content, selected)) {
    const option = node('option', item.name + (item.missing ? ' · 请核对原关联' : item.status === 'withdrawn' ? ' · 已退出' : item.status === 'pending' ? ' · 待确认' : ''));
    option.value = item.id; select.append(option);
  }
  select.value = selected;
}
function showPortrait(id) {
  const previous = $('[data-guest-portrait-preview]'), image = previous.cloneNode(false), stamp = ++portraitPreviewGeneration;
  previous.removeAttribute('src'); previous.replaceWith(image);
  const empty = $('[data-guest-portrait-empty]');
  image.hidden = true; image.removeAttribute('src');
  empty.hidden = false;
  if (typeof id !== 'string' || !portraitIdPattern.test(id)) return;
  const path = '/api/admin/portraits/' + id;
  image.addEventListener('error', () => {
    if (stamp !== portraitPreviewGeneration || !image.isConnected || $('[data-guest-portrait-preview]') !== image || !$('[data-guest-dialog]').open || $('[data-guest-form]').elements.namedItem('portraitId').value !== id || image.getAttribute('src') !== path) return;
    image.hidden = true; empty.hidden = false;
    $('[data-guest-portrait-status]').textContent = '照片预览暂不可用，原照片引用仍保留。服务恢复后可重新编辑或选择图片。';
  }, { once: true });
  image.src = path;
  image.hidden = false; empty.hidden = true;
}
function cancelPortraitWork() {
  portraitGeneration += 1;
  portraitController?.abort(); portraitController = null;
  portraitUploading = false;
  portraitPending = null;
  $('[data-guest-image-editor]').replaceChildren();
  $('[data-guest-image-editor]').hidden = true;
}
function clearPortrait() {
  cancelPortraitWork();
  const form = $('[data-guest-form]');
  form.elements.namedItem('portraitId').value = '';
  $('[data-guest-portrait-file]').value = '';
  $('[data-guest-portrait-status]').textContent = '';
  showPortrait('');
  lockControls();
}
function portraitContext() {
  return { content: draft?.content, revision: draft?.revision, account: user?.id + '|' + [...(user?.roles ?? [])].sort().join(','), id: $('[data-guest-form]').elements.namedItem('id').value };
}
function portraitContextMatches(context) {
  const current = portraitContext();
  return canEdit() && $('[data-guest-dialog]').open && current.content === context.content && current.revision === context.revision && current.account === context.account && current.id === context.id;
}
async function sendPortrait(pending, generation, controller) {
  const result = await request('/api/admin/portraits', { method: 'POST', body: JSON.stringify(pending.prepared.payload), signal: controller.signal });
  if (generation !== portraitGeneration || controller.signal.aborted || !portraitContextMatches(pending.context)) return;
  const payload = pending.prepared.payload;
  if (!portraitIdPattern.test(result.portrait?.id) || result.portrait.contentType !== payload.contentType || !Number.isSafeInteger(result.portrait.bytes) || result.portrait.bytes < 1 || result.portrait.bytes > 512 * 1024) throw new Error('照片上传结果无效，可重试同一份图片。');
  revokeGuestConsent(); guestFormDirty = true;
  $('[data-guest-form]').elements.namedItem('portraitId').value = result.portrait.id;
  showPortrait(result.portrait.id);
  portraitPending = null;
  $('[data-guest-portrait-status]').textContent = processedImageSummary(pending.prepared)+' 照片已上传；保存后才会关联，尚未公开。';
}
function portraitFailure(error) {
  const localError = $('[data-guest-error]');
  $('[data-guest-portrait-status]').textContent = portraitPending ? '已保留待上传图片及当前填写资料，原照片仍保留。请稍后重试上传，或取消本次图片。' : '图片编辑未完成，原有照片与填写资料仍保留。';
  localError.textContent = error.message || '照片上传未完成，请重试。'; localError.hidden = false;
}
async function editPortrait(fileOrLoader) {
  if (!canEdit() || busy || !draft || !$('[data-guest-dialog]').open) return;
  cancelPortraitWork();
  const localError = $('[data-guest-error]'); localError.textContent = ''; localError.hidden = true;
  const generation = portraitGeneration, context = portraitContext(), returnFocus = $(typeof fileOrLoader === 'function' ? '[data-guest-portrait-edit]' : '[data-guest-portrait-file]');
  const controller = new AbortController(); portraitController = controller;
  portraitUploading = true; lockControls();
  const active = () => generation === portraitGeneration && !controller.signal.aborted && portraitContextMatches(context);
  $('[data-guest-portrait-status]').textContent = '正在准备图片编辑…';
  try {
    const file = typeof fileOrLoader === 'function' ? await fileOrLoader(controller.signal) : fileOrLoader;
    if (!active()) return;
    $('[data-guest-image-editor]').hidden = false;
    const edited = await editStaffImage(file, { root: $('[data-guest-image-editor]'), kind: 'guest', signal: controller.signal });
    if (!active()) return;
    $('[data-guest-image-editor]').hidden = true;
    if (!edited) { $('[data-guest-portrait-status]').textContent = '已取消图片编辑，原有照片与资料保留。'; return; }
    guestFormDirty = true;
    $('[data-guest-portrait-status]').textContent = '正在处理并上传编辑后的照片…';
    const prepared = await prepareProfileImage(edited,{maxEdge:800,preserveTransparency:true,signal:controller.signal});
    if (!active()) return;
    portraitPending = { prepared, context };
    await sendPortrait(portraitPending, generation, controller);
  } catch (error) {
    if (active()) portraitFailure(error);
  } finally {
    if (generation === portraitGeneration) {
      portraitUploading = false; portraitController = null; $('[data-guest-image-editor]').hidden = true; $('[data-guest-portrait-file]').value = ''; lockControls();scheduleLocalDraft();
      if ($('[data-guest-dialog]').open && document.activeElement === document.body) (portraitPending ? $('[data-guest-portrait-retry]') : returnFocus).focus({ preventScroll: true });
    }
  }
}
function uploadPortrait(event) { const file = event.currentTarget.files?.[0]; if (file) return editPortrait(file); }
async function retryPortrait() {
  const pending = portraitPending;
  if (!pending || portraitUploading || busy || !portraitContextMatches(pending.context)) return;
  const generation = portraitGeneration, controller = new AbortController(); portraitController = controller;
  portraitUploading = true; lockControls();
  $('[data-guest-error]').hidden = true;
  $('[data-guest-portrait-status]').textContent = '正在重试上传同一份图片…';
  try { await sendPortrait(pending, generation, controller); }
  catch (error) { if (generation === portraitGeneration && !controller.signal.aborted && portraitContextMatches(pending.context)) portraitFailure(error); }
  finally { if (generation === portraitGeneration) { portraitUploading = false; portraitController = null; lockControls();scheduleLocalDraft(); if ($('[data-guest-dialog]').open && document.activeElement === document.body) (portraitPending ? $('[data-guest-portrait-retry]') : $('[data-guest-portrait-edit]')).focus({ preventScroll: true }); } }
}
function showcaseAssignment(item) {
  const parts=[];
  for (const [field,entries,label] of [['sessionId',draft.content.sessions,'分享'],['boothId',draft.content.booths,'展位']]) {
    if (!item[field]) continue;
    const entry=entries.find(candidate=>candidate.id===item[field]);
    parts.push(!entry ? label+'记录已失效' : entry.status==='cancelled' ? label+'已取消' : field==='sessionId' ? entry.start+'–'+entry.end+' / '+entry.zone+'区 · '+entry.title : entry.code+' / '+entry.zone+'区');
  }
  return parts.join('；') || '尚未分配场次或展位';
}
function renderShowcases() {
  if (!draft) return;
  const records=draft.content.showcases??[];
  const summary=showcaseSummary(records,draft.content);
  $('[data-showcase-confirmed-teams]').textContent=String(summary.confirmedTeams);
  $('[data-showcase-confirmed-students]').textContent=String(summary.confirmedStudents);
  $('[data-showcase-assigned-count]').textContent=summary.shareTeams+' / '+summary.boothTeams;
  $('[data-showcase-public-count]').textContent=String(summary.readyToPublishTeams);
  const filter=$('[data-showcase-filter]').value,kindFilter=$('[data-showcase-kind-filter]')?.value??'',publicationFilter=$('[data-showcase-publication-filter]')?.value??'';
  const filtered=records.filter(item=>(!filter||item.responseStatus===filter)&&(!kindFilter||(item.kind??'student')===kindFilter)&&publicationMatches(publicationItem('showcases',item.id),publicationFilter,item));
  $('[data-showcase-result-count]').textContent='显示 '+filtered.length+' / '+records.length+' 件作品';
  const output=$('[data-admin-showcases]');output.replaceChildren();
  for(const item of filtered){
    const card=node('article',undefined,'ah-admin-showcase-card');card.dataset.showcaseId=item.id;
    if(portraitIdPattern.test(item.coverId)){
      const image=node('img');image.src='/api/admin/portraits/'+item.coverId;image.alt=item.title+'作品图（内部预览）';image.width=320;image.height=180;image.loading='lazy';image.addEventListener('error',()=>image.remove(),{once:true});card.append(image);
    }
    const body=node('div',undefined,'ah-admin-showcase-body');
    body.append(node('h3',item.title||'未命名作品'),node('p',showcaseKindLabels[item.kind??'student']),node('p',item.teamName||'团队名称待填写','ah-admin-showcase-team'));
    appendVisibility(body,'showcase',item);appendPublication(body,'showcases',item.id);
    if(item.organizationId){const organization=draft.content.organizations?.find(value=>value.id===item.organizationId);body.append(node('p',organization?'创作者组织：'+organization.name:'原关联组织待核对'));}
    const badge=node('span',({pending:'未确认出席',attending:'已确认出席',declined:'不出席'})[item.responseStatus]??'未确认出席','ah-status');badge.dataset.status=item.responseStatus;badge.dataset.statusTone=item.responseStatus==='attending'?'positive':'negative';badge.dataset.attendanceState=item.responseStatus;body.append(badge);
    body.append(node('p',(item.school||'所属机构待填写')+' · '+(item.contactName||'负责人待填写')+' · '+item.memberCount+' 人（填报）'));
    const forms=(item.participationForms??[]).map(form=>({booth:'展位试玩',share:'上台分享'})[form]).join(' / ')||'参与形式待选';
    body.append(node('p',forms),node('p',showcaseAssignment(item),'ah-admin-showcase-arrangement'));
    const materials=(item.materialLinks??'').split(/\r?\n/u).filter(value=>value.trim()).length;
    body.append(node('p','材料链接 '+materials+' 条 · '+(item.status==='confirmed'?'资料已核准':'资料待核准')+' · '+(item.publicConsent?'已获公开授权':'未获公开授权'),'ah-admin-small'));
    const actions=node('div',undefined,'ah-admin-showcase-actions');
    for(const [label,actionName]of [['编辑作品与安排','edit'],['删除','delete']]){
      const button=node('button',label,'ah-admin-button');button.type='button';button.dataset.rowAction=actionName;button.setAttribute('aria-label',label+' '+item.title);
      button.addEventListener('click',()=>{if(!canEdit()||busy||portraitUploading||coverUploading)return;if(actionName==='edit')openEditor('showcase',item);else if(confirm('删除这件作品并保存？前台会在发布后更新。'))void action(async()=>{const candidate=structuredClone(draft.content);candidate.showcases=candidate.showcases.filter(entry=>entry.id!==item.id);if(await saveSectionCandidate(candidate,'showcases'))announce('作品已删除并保存。发布后更新前台。');});});actions.append(button);
    }
    body.append(actions);card.append(body);output.append(card);
  }
  $('[data-admin-showcases-empty]').hidden=filtered.length>0;
  $('[data-admin-showcases-empty]').textContent=records.length?'此筛选下没有作品记录。':'还没有游戏与作品记录。新增资料后，再确认出席、收齐材料并安排展示。';
  lockControls();
}
function fillShowcaseAssignments(selectedOrganization='') {
  const form=$('[data-showcase-form]');
  const organization=form.elements.namedItem('organizationId');if(organization){organization.replaceChildren();const empty=node('option','未关联组织');empty.value='';organization.append(empty);for(const choice of organizationChoices(draft.content,selectedOrganization)){const option=node('option',choice.name+(choice.missing?' · 原关联待核对':choice.status==='confirmed'?'':' · '+({pending:'待确认',withdrawn:'已退出'}[choice.status]??'待核对')));option.value=choice.id;organization.append(option);}organization.value=selectedOrganization;}
  for(const[field,entries,label]of[['sessionId',draft.content.sessions,'场次'],['boothId',draft.content.booths,'展位']]){
    const select=form.elements.namedItem(field);select.replaceChildren();const empty=node('option','尚未安排');empty.value='';select.append(empty);
    for(const item of entries){
      const title=field==='sessionId'?item.start+'–'+item.end+' · '+item.zone+'区 · '+item.title:item.code+' · '+(item.organization||'待确认团队');
      const option=node('option',title+(item.status==='cancelled'?'（已取消）':''));option.value=item.id;select.append(option);
    }
  }
}
function openShowcaseEditor(item=null) {
  const form=$('[data-showcase-form]');clearCover();form.reset();fillShowcaseAssignments(item?.organizationId??'');
  const localError=$('[data-showcase-error]');localError.textContent='';localError.hidden=true;
  const id='showcase-'+[...crypto.getRandomValues(new Uint8Array(16))].map(value=>value.toString(16).padStart(2,'0')).join('');
  const kind=form.elements.namedItem('kind');if(kind){const blank=kind.querySelector('option[value=""]');blank.textContent=item?'学生作品（原记录）':'请选择作品分类';blank.disabled=Boolean(item&&Object.hasOwn(item,'kind'));kind.required=!item;kind.value=item?(item.kind??''):'indie';}
  const value=item??{id,kind:'indie',title:'',teamName:'',school:'',contactName:'',email:'',wechat:'',memberCount:1,participationForms:[],responseStatus:'pending',materialLinks:'',summary:'',coverId:'',status:'pending',publicConsent:false,sessionId:'',boothId:'',internalNotes:''};
  for(const[key,valueText]of Object.entries(value)){
    if(key==='participationForms')continue;
    const field=form.elements.namedItem(key);
    if(field?.type==='checkbox')field.checked=valueText===true;
    else if(field){
      if(['sessionId','boothId'].includes(key)&&valueText&&!Array.from(field.options).some(option=>option.value===valueText)){const missing=node('option','原分配记录已失效，请重新安排');missing.value=valueText;field.append(missing);}
      field.value=valueText;
    }
  }
  for(const field of form.querySelectorAll('[name=participationForms]'))field.checked=value.participationForms?.includes(field.value)??false;
  editorStableIds.showcase=value.id;editingShowcase=item?.id??null;showcaseFormDirty=false;showCover(value.coverId);syncShowcaseForms();
  $('[data-showcase-consent-note]').textContent='公开授权与参加回复分别记录。基础资料、联系方式、材料链接及内部备注不进入公开作品页。';
  $('[data-showcase-dialog-title]').textContent=(item?'编辑':'新增')+'游戏与作品';$('[data-showcase-dialog]').showModal();
  editorSaveState('showcase','idle','修改后保存当前作品。');
  syncVisibilitySwitch(form);
}
function syncShowcaseForms() {
  const form=$('[data-showcase-form]');
  const locked=busy||plannerBusy||savingContent||checkingContentSave||awaitingContentProof()||Boolean(localRecovery)||Boolean(localPendingArchive)||!canEdit();
  for(const[field,type]of[['sessionId','share'],['boothId','booth']])form.elements.namedItem(field).disabled=locked||!form.querySelector('[name=participationForms][value='+type+']').checked;
}
function revokeShowcaseConsent() {
  $('[data-showcase-form]').elements.namedItem('publicConsent').checked=false;
  $('[data-showcase-consent-note]').textContent='作品介绍或图片已变更，请重新核实这份内容的公开授权。私人材料不会随作品图公开。';
}
function showCover(id) {
  const image=$('[data-showcase-cover-preview]');image.hidden=true;image.removeAttribute('src');
  if(typeof id!=='string'||!portraitIdPattern.test(id))return;
  image.src='/api/admin/portraits/'+id;image.hidden=false;
}
function clearCover() {
  coverGeneration+=1;coverController?.abort();coverController=null;coverUploading=false;
  $('[data-showcase-form]').elements.namedItem('coverId').value='';$('[data-showcase-cover-file]').value='';$('[data-showcase-cover-status]').textContent='';showCover('');lockControls();
}
function closeShowcaseEditor() {
  if(busy||coverUploading)return;
  if(showcaseFormDirty&&!confirm('关闭将放弃本次尚未保存的作品资料，继续吗？'))return;
  $('[data-showcase-dialog]').close();
}
async function uploadCover(event) {
  const file=event.currentTarget.files?.[0];clearCover();revokeShowcaseConsent();showcaseFormDirty=true;
  const localError=$('[data-showcase-error]');localError.textContent='';localError.hidden=true;
  if(!file||!canEdit()||busy||!draft||!$('[data-showcase-dialog]').open)return;
  const generation=coverGeneration;const controller=new AbortController();coverController=controller;coverUploading=true;lockControls();
  $('[data-showcase-cover-status]').textContent='正在处理并上传作品图…';
  try{
    const prepared=await prepareProfileImage(file,{maxEdge:1600,signal:controller.signal}),payload=prepared.payload;
    if(generation!==coverGeneration||controller.signal.aborted)return;
    const result=await request('/api/admin/portraits',{method:'POST',body:JSON.stringify(payload),signal:controller.signal});
    if(generation!==coverGeneration||controller.signal.aborted||!$('[data-showcase-dialog]').open)return;
    if(!portraitIdPattern.test(result.portrait?.id)||result.portrait.contentType!==payload.contentType||!Number.isSafeInteger(result.portrait.bytes)||result.portrait.bytes<1||result.portrait.bytes>512*1024)throw new Error('图片上传结果无效，请重试。');
    $('[data-showcase-form]').elements.namedItem('coverId').value=result.portrait.id;showCover(result.portrait.id);
    $('[data-showcase-cover-status]').textContent=processedImageSummary(prepared)+' 作品图已上传；保存后才会关联，尚未公开。';
  }catch(error){
    if(generation!==coverGeneration||controller.signal.aborted)return;
    $('[data-showcase-form]').elements.namedItem('coverId').value='';showCover('');$('[data-showcase-cover-status]').textContent='作品图上传未完成，未关联新图片。';localError.textContent=error.message||'图片上传失败。';localError.hidden=false;
  }finally{if(generation===coverGeneration){coverUploading=false;coverController=null;lockControls();scheduleLocalDraft();}}
}
$('[data-showcase-cover-file]').addEventListener('change',uploadCover);
$('[data-showcase-cover-remove]').addEventListener('click',()=>{clearCover();revokeShowcaseConsent();showcaseFormDirty=true;lockControls();});
$('[data-showcase-cover-preview]').addEventListener('error',event=>{
  const id=$('[data-showcase-form]').elements.namedItem('coverId').value;
  if(!$('[data-showcase-dialog]').open||!portraitIdPattern.test(id)||event.currentTarget.src!==location.origin+'/api/admin/portraits/'+id)return;
  showCover('');$('[data-showcase-form]').elements.namedItem('coverId').value='';revokeShowcaseConsent();$('[data-showcase-cover-status]').textContent='作品图预览不可用，请重新上传。';
});
$('[data-showcase-dialog]').addEventListener('close',()=>{clearCover();$('[data-showcase-form]').reset();editingShowcase=null;showcaseFormDirty=false;lockControls();});
$('[data-showcase-dialog]').addEventListener('cancel',event=>{event.preventDefault();closeShowcaseEditor();});
$('[data-showcase-form]').addEventListener('input',()=>{showcaseFormDirty=true;lockControls();});
$('[data-showcase-form]').addEventListener('change',()=>{showcaseFormDirty=true;lockControls();});
for(const name of ['title','teamName','summary'])$('[data-showcase-form]').elements.namedItem(name).addEventListener('input',revokeShowcaseConsent);
for(const name of ['kind','organizationId'])$('[data-showcase-form]').elements.namedItem(name)?.addEventListener('change',revokeShowcaseConsent);
for(const field of $('[data-showcase-form]').querySelectorAll('[name=participationForms]'))field.addEventListener('change',()=>{
  if(!field.checked)$('[data-showcase-form]').elements.namedItem(field.value==='share'?'sessionId':'boothId').value='';syncShowcaseForms();
});
function previewPublic() {
  if (!draft) return;
  const content = toPublicContent(loadedContent);
  const output = $('[data-admin-public-preview]');
  output.replaceChildren();
  output.append(node('h3', content.event.title), node('p', content.event.date + ' · ' + content.event.venue));
  const list = node('div');
  for (const item of [...content.sessions].sort((a,b) => a.start.localeCompare(b.start) || a.zone.localeCompare(b.zone))) {
    list.append(node('p', item.start + '–' + item.end + ' / ' + item.zone + ' 区 · ' + item.title + ' · ' + (item.status === 'cancelled' ? '已取消' : item.speakerStatus === 'confirmed' ? item.speakerName : '讲者待确认')));
  }
  output.append(list);
  organizations?.appendPublicPreview(content, output);
  output.append(node('h3', '公开嘉宾'));
  if (!content.guests?.length) output.append(node('p', '名单确认并获授权后将在这里公布。'));
  const guestGrid = node('div', undefined, 'ah-admin-guest-preview-grid');
  for (const item of content.guests ?? []) {
    const card = node('article');
    if (portraitIdPattern.test(item.portraitId)) {
      const portrait = node('img');
      portrait.src = '/api/admin/portraits/' + item.portraitId;
      portrait.alt = item.name + '的头像'; portrait.width = 92; portrait.height = 92;
      portrait.addEventListener('error', () => { portrait.remove(); }, { once: true });
      card.append(portrait);
    }else card.append(node('span',[...item.name][0]??'嘉','ah-admin-guest-initial'));
    card.append(node('h4',item.name),node('p',[item.title,item.company].filter(Boolean).join(' · ')));
    if(item.publicRoles?.length)card.append(node('p',item.publicRoles.map(role=>GUEST_PUBLIC_ROLE_LABELS[role]).join(' · ')));
    if(item.bio)card.append(node('p',item.bio));
    if(item.website){const link=node('a','个人 / 机构网站');link.href=item.website;link.target='_blank';link.rel='noopener noreferrer';card.append(link);}
    if (item.ggjRole) card.append(node('p', item.ggjRole));
    guestGrid.append(card);
  }
  output.append(guestGrid, node('h3', '公开游戏与作品'));
  if (!content.showcases?.length) output.append(node('p', '符合公开条件的游戏与作品将在这里展示。'));
  const showcaseGrid = node('div', undefined, 'ah-admin-showcase-preview-grid');
  for (const item of content.showcases ?? []) {
    const card = node('article');
    if(portraitIdPattern.test(item.coverId)){const image=node('img');image.src='/api/admin/portraits/'+item.coverId;image.alt=(item.title||'作品')+'作品图';image.width=320;image.height=180;card.append(image);}else card.append(node('p','封面待补'));
    card.append(node('h4',item.title||'作品名称待补'),node('p',showcaseKindLabels[item.kind??'student']),node('p',item.teamName),node('p',item.summary));const organization=content.organizations?.find(value=>value.id===item.organizationId);if(organization)card.append(node('p','创作者组织：'+organization.name));showcaseGrid.append(card);
  }
  output.append(showcaseGrid, node('h3', '出席展位'));
  if (!content.booths.length) output.append(node('p', '确认后的展位将在这里公布。'));
  for (const item of content.booths) output.append(node('p', item.code + ' · ' + item.organization + ' · ' + item.project));
  $('[data-admin-preview-panel]').hidden = false;
  $('[data-admin-preview-panel]').scrollIntoView({ behavior: 'smooth', block: 'start' });
  announce('正在预览已保存且开关设为公开的内容。私人联系方式、材料和内部备注不会公开。');
}

$('[data-admin-login]').addEventListener('submit', event => {
  event.preventDefault();
  const form = event.currentTarget;
  if (!form.reportValidity()) return;
  action(async () => {
    const body = Object.fromEntries(new FormData(form));
    let result;
    try { result = await request('/api/admin/login', { method: 'POST', body: JSON.stringify(body) }); }
    finally { form.elements.namedItem('password').value = ''; }
    requestSessionGeneration += 1;
    user = result.user;
    csrfToken = result.csrfToken;
    const state = await request('/api/admin/content');
    draft = state.draft;loadedContent=structuredClone(state.draft.content);
    savedGuestContacts = new Map((draft.content.guests ?? []).map(guest => [guest.id, guest.contactId || '']));
    published = state.published;
    loginPanel.hidden = true;
    workspace.hidden = false;
    setDirty(false);
    render();
    await bindLocalDraft();
    await loadActivePageData();
    if (!user || !draft) return;
    if(!await prepareInvitedGuest())announce('已登录。修改草稿后，需要发布才会显示到前台。');
  });
});
function renderFaqFields(items) {
  const output = $('[data-event-faq]'); output.replaceChildren();
  for (const item of items) addFaqFields(item);
}
function addFaqFields(item = {question:'',answer:''}) {
  const row = node('fieldset',undefined,'ah-admin-faq-row');
  row.append(node('legend','常见问题'));
  const questionLabel = node('label','问题');
  const question = node('input'); question.name = 'faqQuestion'; question.maxLength = 200; question.required = true; question.value = item.question; questionLabel.append(question);
  const answerLabel = node('label','回答');
  const answer = node('textarea'); answer.name = 'faqAnswer'; answer.maxLength = 1500; answer.required = true; answer.rows = 3; answer.value = item.answer; answerLabel.append(answer);
  const remove = node('button','移除此问题','ah-admin-text-button'); remove.type = 'button'; remove.dataset.eventFaqRemove = ''; remove.addEventListener('click',() => { row.remove();eventFormDirty = true;lockControls();scheduleLocalDraft(); });
  row.append(questionLabel,answerLabel,remove); $('[data-event-faq]').append(row);
}
$('[data-event-add-faq]').addEventListener('click',() => {
  if (!canEdit() || busy) return;
  if ($('[data-event-faq]').children.length >= 20) { announce('常见问题最多 20 条。',true);return; }
  addFaqFields();eventFormDirty = true;lockControls();scheduleLocalDraft();
});
$('[data-event-form]').addEventListener('input', () => { eventFormDirty = true;lockControls(); });
$('[data-event-form]').addEventListener('change', () => { eventFormDirty = true;lockControls(); });
$('[data-event-form]').addEventListener('submit',event=>{event.preventDefault();void action(saveContentDraft);});

async function timedContentRequest(options = {}) {
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 15_000);
  try { return await request('/api/admin/content', { ...options, signal: controller.signal }); }
  finally { clearTimeout(timer); }
}
function acceptSavedContent(saved,submitted){
  const unchanged=sameContent(draft.content,submitted.content),localContent=draft.content;
  loadedContent=structuredClone(saved.content);draft={revision:saved.revision,content:unchanged?saved.content:localContent};
  savedGuestContacts=new Map((saved.content.guests??[]).map(guest=>[guest.id,guest.contactId||'']));
  confirmedSaveRevision=saved.revision;saveOutcome='saved';saveProblem='';pendingSave=null;retryContentReady=false;pendingHistorical=false;pendingUncertain=false;arrangementsRevision=null;
  dirty=!unchanged;finalizeAcknowledgedForms(saved.content);pendingForms=null;
  const remaining=captureLocalDraft().forms;legacyWorkspaceReview=Object.keys(remaining).some(type=>({event:'event',guest:'guests',session:'sessions',booth:'booths',showcase:'showcases',organization:'organizations',planner:'arrangements'})[type]!==activePage);
  renderPageView();lockControls();return unchanged&&!hasUnappliedInputs()&&!planner?.hasLocalChanges();
}
function retainAcknowledgedSave(saved,submitted){
  // A proven write stays proven even if later DOM or local cleanup fails.
  // Keep its original recovery record and raw fields; never retry it blindly.
  const localContent=draft.content;
  loadedContent=structuredClone(saved.content);draft={revision:saved.revision,content:sameContent(localContent,submitted.content)?structuredClone(saved.content):localContent};
  dirty=!sameContent(draft.content,loadedContent);savedGuestContacts=new Map((saved.content.guests??[]).map(guest=>[guest.id,guest.contactId||'']));
  pendingSave=null;pendingHistorical=false;pendingUncertain=false;retryContentReady=false;confirmedSaveRevision=saved.revision;saveOutcome='saved';
  saveProblem='云端已确认保存，界面或本机恢复信息尚未整理完成。填写仍保留，请先复制或核对暂存后再继续。';
  const snapshot=localDraftBinding?.snapshot;if(snapshot?.record)localRecovery=snapshot;
  localDraftProblem=saveProblem;try{renderLocalRecovery();}catch{}announce(saveProblem,true);
  return false;
}
async function reportSavedContent({checked=false,unchanged=true,epoch}){
  if(activePage==='arrangements')await loadActivePageData();
  if(epoch!==requestSessionGeneration||!user||!draft)return;
  const overviewFailed=activePage==='arrangements'&&user.roles.includes('outreach')&&!$('[data-arrangements-error]').hidden;
  announce((checked?'已核对：当前云端与原提交一致。':'已保存到云端，公开页面尚未改变。')+(!unchanged?'其他未保存填写仍保留。':'')+(overviewFailed?'总览暂未刷新，可稍后重读。':''));
}
async function saveSectionCandidate(candidate,section){
  if(!draft||!loadedContent||!canEdit())throw new Error('此账号没有保存活动内容的权限。');
  if(savingContent||checkingContentSave)throw new Error('正在核对当前保存，请稍后再操作。');
  if(localRecovery||localPendingArchive)throw new Error('请先处理本机恢复信息，再保存。');
  if(pendingSave||['unknown','conflict'].includes(saveOutcome))throw new Error('请先核对原提交结果；不会混入新填写或开始另一份保存。');
  const checked=validateContent(candidate);if(!checked.valid)throw new Error([...new Set(Object.values(checked.errors))].join(' '));
  let submitted=contentSectionSnapshot(draft.revision,loadedContent,checked.value,section);
  if(!submitted&&!legacyWorkspaceReview)throw new Error('当前页面没有可提交的内容，请前往对应编辑页。');
  if(legacyWorkspaceReview||!submitted||!sameContent(checked.value,submitted.content)){
    legacyWorkspaceReview=true;renderPageView();
    if(!confirm('这份暂存可能含其他页面已修改的内容。确认保存当前填写及整份已修改内容？其他尚未保存的表单仍会保留；不会发布或发送通知。'))return false;
    submitted=contentSectionSnapshot(draft.revision,loadedContent,checked.value,section,{allowWholeWorkspace:true});
  }
  if(!submitted)throw new Error('填写内容未通过完整校验，尚未提交。');
  draft.content=structuredClone(submitted.content);dirty=!sameContent(loadedContent,draft.content);pendingForms=structuredClone(captureLocalDraft().forms);
  pendingHistorical=false;pendingUncertain=false;return persistContentSnapshot(submitted,{firstAttempt:true});
}
async function saveContentDraft(){
  if(!draft||!canEdit())throw new Error('请先读取可编辑内容。');
  if(pendingSave||['unknown','conflict'].includes(saveOutcome))throw new Error('请先核对原提交，不能保存另一份内容。');
  for(const type of ['guest','session','booth','showcase'])if($('[data-'+type+'-dialog]').open)return saveEditor(type);
  if(organizations?.localDraft())return organizations.save({allowBusy:true});
  if(activePage==='event'){
    const candidate=eventCandidate();if(!candidate)return false;
    editorSaveState('event','saving','正在保存活动资料…');
    const saved=await saveSectionCandidate(candidate,'event'),box=$('[data-event-error]');box.textContent=saved?'':saveProblem||'尚未确认保存，填写内容仍保留。';box.hidden=saved;if(!saved){editorSaveState('event',pendingSave?'unknown':'error',box.textContent);box.focus();}return saved;
  }
  if(activePage==='arrangements'&&planner?.hasUnapplied())return planner.saveBooth({allowBusy:true});
  if(activePage==='arrangements'&&planner?.hasLocalChanges())throw new Error('人员安排另行保存，请先保存或明确放弃人员选择。');
  if(!dirty)return false;
  return saveSectionCandidate(draft.content,activePage);
}
async function retryContentDraft(){
  if(!draft||!canEdit()||!pendingSave||!retryContentReady||!['unknown','conflict'].includes(saveOutcome))return false;
  pendingHistorical=true;pendingUncertain=true;return persistContentSnapshot(pendingSave);
}
async function persistContentSnapshot(submitted,{firstAttempt=false}={}){
  const epoch=requestSessionGeneration,previous={pendingSave,saveOutcome,saveProblem,retryContentReady,pendingHistorical,pendingUncertain},mayReject=firstAttempt&&!pendingSave&&!pendingHistorical&&!pendingUncertain;let requested=false,acknowledged=null;
  pendingSave=submitted;retryContentReady=false;savingContent=true;saveOutcome='saving';saveProblem='';lockControls();
  try{
    if(!localDraftBinding||!localDraftReady)throw new Error('本机暂存尚未就绪。');
    await localDraftBinding.markPending(captureLocalDraft());
    if(epoch!==requestSessionGeneration||!user||!draft)return false;
    requested=true;const result=await timedContentRequest({method:'PUT',body:JSON.stringify(submitted)});
    if(epoch!==requestSessionGeneration||!user||!draft)return false;
    const saved=confirmedContentSave(result,submitted);if(!saved)throw new Error('保存回执内容或版本无法核对。');
    acknowledged=saved;const unchanged=acceptSavedContent(saved,submitted);await finishLocalSubmission();await reportSavedContent({unchanged,epoch});return true;
  }catch(error){
    if(epoch!==requestSessionGeneration||!user||!draft)return false;
    if(acknowledged)return retainAcknowledgedSave(acknowledged,submitted);
    if(!requested){
      pendingSave=previous.pendingSave;saveOutcome=previous.saveOutcome;retryContentReady=previous.retryContentReady;pendingHistorical=previous.pendingHistorical;pendingUncertain=previous.pendingUncertain;
      saveProblem='本机原提交暂存未完成，尚未向云端发送。填写仍保留，请先复制内容并核对暂存状态。';
    }else if(mayReject&&[400,422].includes(error.status)){
      try{await localDraftBinding.rejectPending();if(epoch!==requestSessionGeneration)return false;pendingSave=null;pendingForms=null;pendingHistorical=false;pendingUncertain=false;saveOutcome='loaded';saveProblem='本次保存未通过验证，填写仍保留。'+(error.message||'请核对后重试。');}
      catch{pendingHistorical=true;pendingUncertain=true;saveOutcome='unknown';saveProblem='本次请求被拒绝，但原暂存状态未能核对。请保留填写并先核对原提交，不重复保存。';}
    }else{
      pendingUncertain=true;pendingHistorical=true;saveOutcome=error.status===409?'conflict':'unknown';
      saveProblem=error.status===409?'云端版本已变化，填写与原提交仍保留；不会自动合并或覆盖。':[400,422].includes(error.status)?'本次重试被拒绝，仍不能证明原提交未写入。原正文与版本已保留，请继续核对。':'保存结果未确认，填写与原提交仍保留。请先核对云端结果，不重复保存。';
      await localDraftBinding.flush({kind:'pending_submission',value:captureLocalDraft()}).catch(()=>{});
    }
    announce(saveProblem,true);return false;
  }finally{if(epoch===requestSessionGeneration){savingContent=false;lockControls();scheduleLocalDraft();}}
}

async function checkContentSave() {
  if (!canEdit() || !draft || !pendingSave || !['unknown', 'conflict'].includes(saveOutcome)) return;
  const submitted = pendingSave, epoch = requestSessionGeneration;let acknowledged=null;
  checkingContentSave = true; retryContentReady = false; lockControls();
  try {
    const result = await timedContentRequest();
    if (epoch !== requestSessionGeneration || pendingSave !== submitted || !user || !draft) return;
    const proof = inspectContentSave(result, submitted);
    if (proof.state === 'confirmed') {
      acknowledged=proof.draft;const unchanged = acceptSavedContent(proof.draft, submitted);
      await finishLocalSubmission();
      await reportSavedContent({ checked: true, unchanged, epoch });
    } else {
      if (proof.state === 'conflict') saveOutcome = 'conflict';
      retryContentReady = proof.state === 'retryable';
      saveProblem = proof.state === 'conflict' ? '云端已有不同的内容，本页修改仍保留。请先保留这份编辑，再重新载入核对；不会自动合并或覆盖。'
        : proof.state === 'retryable' ? '云端仍为原版本，尚未证实本次保存。可明确重试同一份提交；后续本页编辑另行保存，不会混入重试。'
          : '目前尚未证实本次修改已保存。本页内容保留，请稍后再次核对，不要重复保存或刷新。';
      announce(saveProblem, true);
    }
  } catch (error) {
    if (epoch !== requestSessionGeneration || !user || !draft) return;
    if(acknowledged){retainAcknowledgedSave(acknowledged,submitted);return;}
    saveProblem = '暂时无法核对云端保存结果。本页修改仍保留，请稍后再次核对，不要刷新。'; announce(saveProblem, true);
  } finally { if (epoch === requestSessionGeneration) { checkingContentSave = false; lockControls(); } }
}
for(const dialog of document.querySelectorAll('[data-guest-dialog],[data-session-dialog],[data-booth-dialog],[data-showcase-dialog],[data-organization-dialog],[data-admin-navigation-dialog]')){
  const proof=node('div',undefined,'ah-admin-inline-proof');proof.dataset.adminDialogProof='';proof.hidden=true;
  const state=node('p');state.dataset.adminSaveDescription='';
  const check=node('button','核对云端保存结果','ah-admin-secondary');check.type='button';check.dataset.adminCheckSave='';
  const retry=node('button','重试原提交','ah-admin-secondary');retry.type='button';retry.dataset.adminRetrySave='';
  const copy=node('button','复制填写','ah-admin-text-button');copy.type='button';copy.addEventListener('click',()=>copyLocalContent().catch(error=>announce(error.message,true)));
  const logout=node('button','退出登录','ah-admin-text-button');logout.type='button';logout.dataset.adminProofLogout='';logout.addEventListener('click',()=>action(logoutContent));
  proof.append(state,check,retry,copy,logout);dialog.append(proof);
}
for (const button of document.querySelectorAll('[data-admin-save]')) button.addEventListener('click', () => action(saveContentDraft));
for (const button of document.querySelectorAll('[data-admin-check-save]')) button.addEventListener('click', () => action(checkContentSave));
for (const button of document.querySelectorAll('[data-admin-retry-save]')) button.addEventListener('click', () => action(retryContentDraft));
for(const button of document.querySelectorAll('[data-content-visibility-switch]'))button.addEventListener('click',()=>{
  if(button.disabled||!canEdit())return;
  const form=button.closest('form'),field=form?.elements.namedItem('visibility');if(!field)return;
  field.value=field.value==='private'?'public':'private';syncVisibilitySwitch(form);field.dispatchEvent(new Event('change',{bubbles:true}));
});
async function publishContent(){
  if(!canPublish()||!draft||pendingSave||['unknown','conflict'].includes(saveOutcome))throw new Error('请先核对原保存结果，再发布。');
  if(dirty||hasUnappliedInputs()||organizations?.hasUnapplied()||planner?.hasUnapplied()){
    if(!await saveContentDraft())return false;
  }
  if(dirty||hasUnappliedInputs()||pendingSave||localRecovery||localPendingArchive)throw new Error('还有尚未保存或待核对的填写，请先完成核对。');
  // A legacy publication can legitimately differ under the new visibility policy.
  // Advance the saved revision through the existing CAS before changing its public bytes.
  let report=publicationReport();if(!report)throw new Error('发布状态暂时无法核对，请重新读取页面。');
  if(report.hasPublicChanges&&published?.revision===draft.revision){
    if(!canEdit())throw new Error('公开规则已更新，请由有编辑权限的工作人员保存当前内容后再发布。');
    const submitted=contentSaveSnapshot(draft.revision,loadedContent);if(!submitted)throw new Error('当前内容无法核对，请重新读取。');
    pendingForms=structuredClone(captureLocalDraft().forms);pendingHistorical=false;pendingUncertain=false;
    if(!await persistContentSnapshot(submitted,{firstAttempt:true}))return false;
    report=publicationReport();if(!report||pendingSave||localRecovery||localPendingArchive)throw new Error('保存结果仍待核对，尚未发布。');
  }
  const stamp=requestSessionGeneration;
  try{
    const result=await request('/api/admin/content/publish',{method:'POST',body:JSON.stringify({expectedRevision:draft.revision})});
    if(stamp!==requestSessionGeneration||!user||!draft)return;
    const proof=contentPublicationReadiness({draft:{revision:draft.revision,content:loadedContent},published:result.published});
    if(!proof||proof.publishedRevision!==draft.revision||proof.hasPublicChanges)throw new Error('发布回执暂时无法核对。');
    published=result.published;publicationUncertain=false;render();
    announce('已发布到前台。公开开关为绿色的内容会显示，手动设为未公开的内容已隐藏。');
  }catch(error){
    if(stamp!==requestSessionGeneration||!user||!draft)return;
    publicationUncertain=true;publicationCache=null;render();
    throw new Error('发布结果暂时无法核对。请重新读取页面核对实际发布状态，不重复发布。');
  }
}
for(const button of document.querySelectorAll('[data-admin-publish]'))button.addEventListener('click',()=>action(publishContent));
for(const type of ['event','session','booth','guest','showcase']){
  const form=$('[data-'+type+'-form]');
  for(const eventName of ['input','change'])form.addEventListener(eventName,event=>{
    if(!event.target.name||!canEdit()||busy||savingContent)return;
    editorSaveState(type,'dirty','当前填写尚未保存。');
    const error=$('[data-'+type+'-error]');if(error)error.hidden=true;
    lockControls();
  });
  form.addEventListener('invalid',()=>editorSaveState(type,'error','请检查标出的字段，填写内容仍保留。'),true);
}
$('[data-arrangements-refresh]').addEventListener('click', () => action(() => arrangements.refresh()));
$('[data-admin-preview]').addEventListener('click', () => { try { previewPublic(); } catch (error) { announce(error.message, true); } });
$('[data-admin-preview-close]').addEventListener('click', () => { $('[data-admin-preview-panel]').hidden = true; });
$('[data-admin-add-session]').addEventListener('click', () => openEditor('session'));
$('[data-admin-add-booth]').addEventListener('click', () => openEditor('booth'));
$('[data-admin-fill-booths]').addEventListener('click',()=>{
  if(!canEdit()||busy||portraitUploading||coverUploading||!draft)return;
  try{
    const result=completeBoothSlots(draft.content.booths);
    if(!result.created){announce('十五个位置已有待确认或已确认展位，未新增重复记录。');return;}
    const candidate={...draft.content,booths:result.booths};const validation=validateContent(candidate);
    if(!validation.valid)throw new Error([...new Set(Object.values(validation.errors))].join(' '));
    void action(async()=>{if(await saveSectionCandidate(validation.value,'booths'))announce('已补齐并保存 '+result.created+' 个展位位置。机构、负责人和展示内容可继续编辑。');});
  }catch(error){announce(error.message||'展位位置未补齐，请核对资料。',true);}
});
$('[data-admin-add-guest]').addEventListener('click', () => openEditor('guest'));
$('[data-admin-add-showcase]').addEventListener('click', () => openEditor('showcase'));
$('[data-showcase-form]').addEventListener('submit', event => submitEditor('showcase', event));
$('[data-showcase-filter]').addEventListener('change',renderShowcases);
for(const selector of ['[data-showcase-kind-filter]','[data-showcase-publication-filter]'])$(selector)?.addEventListener('change',renderShowcases);
$('[data-admin-guest-publication-filter]')?.addEventListener('change',render);
$('[data-session-form]').addEventListener('submit', event => submitEditor('session', event));
$('[data-booth-form]').addEventListener('submit', event => submitEditor('booth', event));
for (const type of ['session', 'booth']) {
  const form = $('[data-' + type + '-form]'), dialog = $('[data-' + type + '-dialog]');
  for (const eventName of ['input', 'change']) form.addEventListener(eventName, () => {
    if (!canEdit() || busy || !dialog.open) return;
    if (type === 'booth') boothFormDirty = true; else sessionFormDirty = true;
    lockControls();
  });
  dialog.addEventListener('cancel', event => { event.preventDefault(); closeSimpleEditor(type); });
  dialog.addEventListener('close', () => {
    if (dialog.open) return;
    if (type === 'booth') { boothFormDirty = false; editingBooth = null; } else { sessionFormDirty = false; editingSession = null; }
    form.reset(); lockControls();
  });
}
$('[data-guest-form]').addEventListener('submit', event => submitEditor('guest', event));
$('[name=guestId]').addEventListener('change', syncSessionGuest);
$('[data-guest-portrait-file]').addEventListener('change', uploadPortrait);
$('[data-guest-portrait-edit]').addEventListener('click', () => {
  const id = $('[data-guest-form]').elements.namedItem('portraitId').value;
  if (portraitIdPattern.test(id) && !portraitPending && !portraitUploading) return editPortrait(signal => request('/api/admin/portraits/' + id, { binaryImage: true, signal }));
});
$('[data-guest-portrait-retry]').addEventListener('click', retryPortrait);
$('[data-guest-portrait-discard]').addEventListener('click', () => {
  cancelPortraitWork();
  $('[data-guest-portrait-status]').textContent = '已取消待上传图片，原有照片与填写资料保留。';
  $('[data-guest-error]').hidden = true;
  showPortrait($('[data-guest-form]').elements.namedItem('portraitId').value); lockControls();
  $('[data-guest-portrait-file]').focus({ preventScroll: true });
});
$('[data-guest-portrait-remove]').addEventListener('click', () => { clearPortrait(); revokeGuestConsent(); guestFormDirty=true; lockControls(); });
$('[data-guest-dialog]').addEventListener('close',()=>{guestPeople?.clear();clearPortrait();$('[data-guest-form]').reset();editingGuest=null;guestFormDirty=false;lockControls();});
$('[data-guest-dialog]').addEventListener('cancel',event=>{event.preventDefault();closeGuestEditor();});
for (const type of ['input','change']) $('[data-guest-form]').addEventListener(type,event=>{if (!event.target.closest('[data-image-editor],[data-guest-person-picker]') && event.target !== $('[data-guest-portrait-file]')) {guestFormDirty=true;lockControls();}});
for (const name of ['name','company','ggjRole','title','bio','website']) $('[data-guest-form]').elements.namedItem(name).addEventListener('input', revokeGuestConsent);
for(const option of $('[data-guest-form]').querySelectorAll('[name=publicRoles]'))option.addEventListener('change',revokeGuestConsent);
for (const button of document.querySelectorAll('[data-close-dialog]')) button.addEventListener('click', () => {if(button.dataset.closeDialog==='guest')closeGuestEditor();else if(button.dataset.closeDialog==='showcase')closeShowcaseEditor();else closeSimpleEditor(button.dataset.closeDialog);});
async function logoutContent(){
  if(localRecovering||savingContent||checkingContentSave||portraitUploading||coverUploading)return;
  const recoveryRecord=localRecovery?.record??localDraftBinding?.snapshot?.record;
  if ((hasUnsavedChanges()||recoveryRecord||localPendingArchive) && !confirm(recoveryRecord?.kind==='pending_submission'||pendingSave?'仍有保存结果待核对。退出会清除本机恢复信息，不撤销可能已保存的云端内容。确定退出？':'还有未保存到云端的修改，确定退出并放弃本机填写及暂存吗？')) return;
  const actor=user?.id,binding=localDraftBinding;binding?.close();
  let cleared=true,loggedOut=false;try{if(actor)await localDraftStore.clearActor(actor);}catch{cleared=false;}
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),15_000);
  try{await request('/api/admin/logout',{method:'POST',signal:controller.signal});loggedOut=true;}catch{}finally{clearTimeout(timer);}
  pendingInvitee=null;showLogin();
  announce(!cleared?'本机暂存清除未完成，请在此浏览器清除网站资料。':loggedOut?'已退出，本机暂存已清除。':'本机填写与暂存已清除；云端退出结果待核对，请重新登录。',!cleared||!loggedOut);
}
$('[data-admin-logout]').addEventListener('click',()=>action(logoutContent));
for(const type of ['event','session','booth','guest','showcase'])for(const event of ['input','change'])$('[data-'+type+'-form]').addEventListener(event,input=>{if(!input.target.closest('[data-image-editor],[data-guest-person-picker]'))scheduleLocalDraft();});
for(const type of ['session','booth','guest','showcase'])$('[data-'+type+'-dialog]').addEventListener('close',()=>{const field=$('[data-admin-copy-fallback]');field.value='';field.hidden=true;scheduleLocalDraft();});
for(const button of document.querySelectorAll('[data-content-copy]'))button.addEventListener('click',()=>{copyLocalContent(button.dataset.contentCopy).catch(error=>announce(error.message,true));});
$('[data-admin-local-copy]').addEventListener('click',()=>{copyLocalContent().catch(error=>announce(error.message,true));});
$('[data-admin-local-restore]').addEventListener('click',async()=>{
  if(busy||plannerBusy||localRecovering||!localDraftBinding||!localRecovery)return;
  const binding=localDraftBinding,stamp=requestSessionGeneration;
  if(contentDraftLocation(localRecovery.record.value)?.requiresReview&&!confirm('这份旧工作区暂存可能包含多个页面的修改。确认恢复后逐页核对？不会自动保存或发布。'))return;
  localRecovering=true;renderLocalRecovery();
  try{const record=localRecovery.record;await binding.restore({pendingOnly:record.kind==='pending_submission'&&record.baseRevision!==draft.revision});if(stamp===requestSessionGeneration)announce(record.kind==='pending_submission'?'已恢复原保存信息，请先核对云端结果。':'已恢复本机填写；公开授权请重新核对，尚未保存云端。');}
  catch(error){if(stamp===requestSessionGeneration)announce(error.message||'暂存恢复未完成，内容仍保留。',true);}
  finally{if(stamp===requestSessionGeneration){localRecovering=false;renderLocalRecovery();}}
});
$('[data-admin-local-discard]').addEventListener('click',async()=>{
  if(busy||plannerBusy||localRecovering||!localDraftBinding)return;
  const binding=localDraftBinding,stamp=requestSessionGeneration,record=binding.snapshot?.record;if(!record)return;
  if(!confirm(record.kind==='pending_submission'?'只舍弃本机恢复信息，不撤销可能已写入的云端内容。将先读取最新云端，且不会重送原提交。确定舍弃？':'舍弃这份本机暂存？已保存的云端内容保留。'))return;
  localRecovering=true;renderLocalRecovery();
  try{
    if(await discardPageEdits())announce('本机暂存已舍弃；未发送保存或发布请求。');
  }catch(error){if(stamp===requestSessionGeneration)announce(error.message||'暂存未能清除，请保留内容。',true);}
  finally{if(stamp===requestSessionGeneration){localRecovering=false;renderLocalRecovery();}}
});
function navigationError(text){const box=$('[data-admin-navigation-error]');box.textContent=text;box.hidden=!text;}
function cancelNavigation(){navigationTarget=null;const dialog=$('[data-admin-navigation-dialog]');if(dialog.open)dialog.close();navigationError('');}
$('[data-admin-navigation-cancel]').addEventListener('click',cancelNavigation);
$('[data-admin-navigation-dialog]').addEventListener('cancel',event=>{event.preventDefault();cancelNavigation();});
$('[data-admin-navigation-save]').addEventListener('click',()=>action(async()=>{
  const target=navigationTarget;if(!target)return;
  if(!hasUnsavedChanges()&&!localRecovery&&!localPendingArchive){completeNavigation(target);return;}
  try{const saved=await saveContentDraft();if(!user||!draft)return;
    if(saved&&!hasUnsavedChanges()&&!localRecovery&&!localPendingArchive)completeNavigation(target);
    else navigationError(pendingSave?'保存结果仍待核对，请核对原提交后再前往。':'仍有未保存的填写，请完成或明确放弃后再前往。');
  }catch(error){if(user)navigationError(error.message||'尚未确认保存，仍留在当前页面。');}
}));
$('[data-admin-navigation-discard]').addEventListener('click',()=>action(async()=>{
  const target=navigationTarget;if(!target)return;
  try{if(await discardPageEdits())completeNavigation(target);}catch(error){if(user)navigationError(error.message||'本机编辑尚未放弃，仍留在当前页面。');}
}));
document.addEventListener('click',event=>{
  if(event.defaultPrevented||event.button!==0||event.metaKey||event.ctrlKey||event.shiftKey||event.altKey)return;
  const link=event.target.closest('a[href]');if(!link||link.hasAttribute('download')||link.target&&link.target!=='_self')return;
  const target=new URL(link.href,location.href);if(target.origin!==location.origin||!/^\/admin(?:\/|$)/u.test(target.pathname))return;
  const section=resolveContentPage(target.pathname,target.hash);
  if(!section&&!hasUnsavedChanges()&&!localRecovery&&!localPendingArchive)return;
  event.preventDefault();requestNavigation(target);
});
function navigateFromHistory(){
  const target=new URL(location.href),section=resolveContentPage(target.pathname,target.hash);if(!section)return;
  if(hasUnsavedChanges()||localRecovery||localPendingArchive){history.replaceState(null,'',currentPageUrl);requestNavigation(target);}
  else activatePage(section,{hash:target.hash});
}
window.addEventListener('hashchange',navigateFromHistory);
window.addEventListener('popstate',navigateFromHistory);
renderPageView();history.replaceState(null,'',currentPageUrl);
window.addEventListener('beforeunload', event => { if (hasUnsavedChanges()||localDraftBinding?.unsettled) { event.preventDefault(); event.returnValue = ''; } });
function flushLocalOnHide(){if(localDraftBinding&&localDraftReady&&!localRecovery&&!localRecovering&&user&&draft&&hasUnsavedChanges())localDraftBinding.flush().catch(()=>{});}
window.addEventListener('pagehide',flushLocalOnHide);
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='hidden')flushLocalOnHide();});
if (typeof ResizeObserver === 'function') new ResizeObserver(updateSavebarSpace).observe($('[data-admin-savebar]'));
window.addEventListener('resize', updateSavebarSpace);
if (location.protocol === 'file:') {
  announce('这是离线界面预览。请启动本地内容服务并配置工作人员账号后登录。');
  $('[data-admin-login] button[type="submit"]').disabled = true;
} else {
  action(async () => {
    const response = await fetch('/api/admin/session', { credentials: 'same-origin', cache: 'no-store', headers: { Accept: 'application/json' } });
    if (response.status === 401) return;
    if (!response.ok) throw new Error('请确认本地内容服务已启动并完成账号配置。');
    const result = await response.json();
    requestSessionGeneration += 1;
    user = result.user;
    csrfToken = result.csrfToken;
    const state = await request('/api/admin/content');
    draft = state.draft;loadedContent=structuredClone(state.draft.content);
    savedGuestContacts = new Map((draft.content.guests ?? []).map(guest => [guest.id, guest.contactId || '']));
    published = state.published;
    loginPanel.hidden = true;
    workspace.hidden = false;
    setDirty(false);
    render();
    await bindLocalDraft();
    await loadActivePageData();
    if (!user || !draft) return;
    if(!await prepareInvitedGuest())announce('已恢复工作人员会话。');
  });
}
