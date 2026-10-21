import test from 'node:test';
import assert from 'node:assert/strict';
import { createInitialContent } from '../src/config/content.mjs';
import { toPublicContent, validateContent } from '../shared/content-schema.mjs';
import { contentPublicationReadiness, PUBLICATION_REASON_LABELS, PUBLICATION_CHANGE_LABELS, PUBLICATION_SUGGESTION_LABELS } from '../src/lib/admin-save-state.mjs';

const IMAGE='a'.repeat(64)+'.png',AT='2026-10-21T10:00:00.000Z';
function fixture(){
  const content=createInitialContent();
  content.guests=[{id:'guest-1',name:'合成嘉宾',company:'合成机构',ggjRole:'',portraitId:IMAGE,status:'confirmed',publicConsent:true,contactId:'contact-1',internalNotes:'PRIVATE-GUEST',publicRoles:[]}];
  content.organizations=[{id:'org-1',name:'合成机构',logoId:'',website:'',participation:'exhibitor',status:'confirmed',publicConsent:true,internalNotes:'PRIVATE-ORG'}];
  content.booths=[{id:'booth-1',code:'C-01',organization:'合成机构',project:'合成作品',zone:'C',status:'confirmed',slotNumber:1,contactName:'PRIVATE-CONTACT',contactMethods:'private@example.invalid',internalNotes:'PRIVATE-BOOTH'}];
  content.showcases=[{id:'work-1',title:'合成游戏',teamName:'合成团队',school:'',contactName:'PRIVATE-WORK',email:'private@example.invalid',wechat:'PRIVATE-WECHAT',memberCount:3,participationForms:['booth'],responseStatus:'attending',materialLinks:'https://example.invalid/PRIVATE-MATERIAL',summary:'公开简介',coverId:IMAGE,status:'confirmed',publicConsent:true,sessionId:'',boothId:'booth-1',internalNotes:'PRIVATE-WORK-NOTE'}];
  assert.deepEqual(validateContent(content).errors,{});
  return content;
}
function state(content=fixture()) { return {draft:{revision:8,content},published:{revision:5,publishedAt:AT,content:toPublicContent(content)}}; }
const row=(report,kind,id)=>report.items[kind].find(item=>item.id===id);

test('readiness compares public rows by stable ID, ignoring unrelated revisions and private edits',()=>{
  const source=state(),before=structuredClone(source),initial=contentPublicationReadiness(source);
  assert.equal(initial.hasPublicChanges,false);assert.equal(initial.eventChanged,false);assert.equal(initial.organizationSource,'published');
  for(const kind of ['guests','organizations','showcases','booths'])assert.equal(initial.items[kind][0].change,'unchanged');
  source.draft.revision=20;source.draft.content.guests[0].internalNotes='different private note';source.draft.content.booths[0].contactMethods='other@example.invalid';source.draft.content.showcases[0].memberCount=10;
  const report=contentPublicationReadiness(source);assert.equal(report.hasPublicChanges,false);assert.equal(report.items.guests[0].published,true);assert.equal(report.items.guests[0].ready,true);
  assert.doesNotMatch(JSON.stringify(report),/PRIVATE-|private@example|contact-1|memberCount|internalNotes|contactMethods/u);
  assert.deepEqual(before.published,source.published);
});

test('actual public record stays published while an edit or withdrawal awaits explicit publication',()=>{
  const source=state();source.draft.content.guests[0].name='合成新版姓名';source.draft.content.organizations[0].publicConsent=false;
  const report=contentPublicationReadiness(source),guest=row(report,'guests','guest-1'),organization=row(report,'organizations','org-1');
  assert.equal(guest.published,true);assert.equal(guest.ready,true);assert.equal(guest.change,'updated');
  assert.equal(organization.published,true);assert.equal(organization.ready,false);assert.equal(organization.change,'removed');assert.deepEqual(organization.reasons,['public_consent_required']);
  assert.equal(report.hasPublicChanges,true);assert.equal(report.eventChanged,false);
  source.draft.content.guests=[];
  const removed=row(contentPublicationReadiness(source),'guests','guest-1');assert.equal(removed.inDraft,false);assert.equal(removed.published,true);assert.equal(removed.change,'removed');assert.deepEqual(removed.reasons,['record_removed']);
});

test('unpublished eligible records are pending publication while all actual work requirements remain explanatory',()=>{
  const source=state();source.published=null;
  source.draft.content.showcases[0].status='pending';source.draft.content.showcases[0].publicConsent=false;source.draft.content.showcases[0].responseStatus='declined';source.draft.content.showcases[0].coverId='';source.draft.content.booths[0].status='pending';
  const report=contentPublicationReadiness(source),guest=row(report,'guests','guest-1'),work=row(report,'showcases','work-1');
  assert.equal(guest.published,false);assert.equal(guest.change,'new');assert.equal(guest.ready,true);
  assert.equal(work.published,false);assert.equal(work.ready,false);assert.equal(work.change,'blocked');
  assert.deepEqual(work.reasons,['confirmation_required','public_consent_required','attendance_declined','cover_required','allocation_required']);
  source.draft.content.showcases[0].responseStatus='pending';assert.ok(row(contentPublicationReadiness(source),'showcases','work-1').reasons.includes('attendance_required'));
  assert.equal(report.publishedRevision,null);assert.equal(report.organizationSource,'initial');
});

test('legacy initial organizations differ from explicit empty published organizations',()=>{
  const content=fixture();delete content.organizations;const source=state(content);
  assert.equal(contentPublicationReadiness(source).organizationSource,'initial');
  source.draft.content.organizations=[];
  let report=contentPublicationReadiness(source);assert.equal(report.organizationSource,'initial');assert.equal(report.hasPublicChanges,true);
  source.published.content=toPublicContent(source.draft.content);
  report=contentPublicationReadiness(source);assert.equal(report.organizationSource,'published');assert.equal(report.hasPublicChanges,false);
});

test('order and event changes are tracked without claiming unchanged rows changed',()=>{
  const content=fixture();content.guests.push({...content.guests[0],id:'guest-2',contactId:'contact-2',name:'另一合成嘉宾'});const source=state(content);
  source.draft.content.guests.reverse();let report=contentPublicationReadiness(source);
  assert.equal(report.hasPublicChanges,true);assert.equal(report.orderChanged.guests,true);assert.equal(report.eventChanged,false);assert.ok(report.items.guests.every(item=>item.change==='unchanged'));
  source.draft.content.event.venue='合成新场地';report=contentPublicationReadiness(source);assert.equal(report.eventChanged,true);
  const reordered=structuredClone(source.published.content);reordered.event=Object.fromEntries(Object.entries(reordered.event).reverse());source.published.content=reordered;
  assert.ok(contentPublicationReadiness(source),'JSON object key order is not malformed metadata');
});

test('unavailable or malformed source never becomes an empty publication or a ready record',()=>{
  for(const change of [s=>delete s.published,s=>s.published=undefined,s=>s.draft.revision=-1,s=>s.published.revision=9,s=>s.published.publishedAt='bad',s=>s.published.publishedAt='2026-02-30T10:00:00Z',s=>s.published.content.eventId='other-event',s=>delete s.published.content.guests,s=>s.published.content.guests.push({...s.published.content.guests[0]}),s=>s.published.content.guests[0].privateNotes='must not be published',s=>s.draft.content.guests[0].portraitId='https://example.invalid/photo']){
    const source=state();change(source);assert.equal(contentPublicationReadiness(source),null);
  }
  for(const value of [null,undefined,{},[],{draft:null,published:null}])assert.equal(contentPublicationReadiness(value),null);
});

test('report reason, change, and optional suggestion codes have stable display labels',()=>{
  const source=state();source.published=null;source.draft.content.guests[0].status='pending';source.draft.content.guests[0].publicConsent=false;source.draft.content.guests[0].portraitId='';
  const report=contentPublicationReadiness(source);for(const list of Object.values(report.items))for(const item of list){assert.ok(PUBLICATION_CHANGE_LABELS[item.change]);for(const reason of item.reasons)assert.ok(PUBLICATION_REASON_LABELS[reason]);for(const suggestion of item.suggestions)assert.ok(PUBLICATION_SUGGESTION_LABELS[suggestion]);}
  assert.deepEqual(report.items.guests[0].suggestions,['portrait_optional','public_roles_optional']);
});
