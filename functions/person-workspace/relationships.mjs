import { guestPrefillFromContact } from '../../shared/contact-editor.mjs';
import { CONTACT_ID, contactsSource, contentSource, publicProfileProjection, organizationLookupProjection, organizationMemberships, revisionValue, timestamp } from './projection.mjs';
import { createHash } from 'node:crypto';
import { equalToken } from '../content-api/auth.mjs';
import { readIntentBody } from '../intent-invitations/handler.mjs';
import { canManageEventOperations } from '../../shared/staff-permissions.mjs';
import { admissionView, expandPersonKeys, personGroupFor, validPersonKey, validPersonRoles } from '../registration-api/admissions.mjs';

const ORIGIN = 'https://api.artdico.host', ROOT = '/api/admin/people/';
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value)
  && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const headers = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer', vary: 'Cookie, Origin' };
const errors = new WeakSet();
function fail(code = 'RELATIONSHIPS_UNAVAILABLE', status = 503) { const error = new Error(code); error.code = code; error.status = status; errors.add(error); throw error; }
const messages = { RELATIONSHIPS_UNAVAILABLE: '人员关联资料暂时无法核对，请稍后重新读取。', AUTH_REQUIRED: '会话已结束，请重新登录。',
  FORBIDDEN: '此账号没有读取这部分人员关联资料的权限。', NOT_FOUND: '未找到这项关联资料。', INVALID_REQUEST: '人员关联请求格式无效。',
  METHOD_NOT_ALLOWED: '人员关联接口只读取已保存记录。' };
function json(value, status = 200, extra = {}) {
  const body = JSON.stringify(value); if (Buffer.byteLength(body) > 2 * 1024 * 1024) fail();
  return new Response(body, { status, headers: { ...headers, ...extra } });
}
function text(value, maximum, required = false) {
  if (typeof value !== 'string' || !value.isWellFormed() || [...value].length > maximum || /[\u0000-\u001f\u007f]/u.test(value) || required && !value.trim()) fail();
  return value;
}
function records(value, maximum = 200) {
  if (!Array.isArray(value) || value.length > maximum) fail();
  const ids = new Set();
  for (const row of value) { if (!plain(row) || typeof row.id !== 'string' || !CONTACT_ID.test(row.id) || ids.has(row.id)) fail(); ids.add(row.id); }
  return value;
}

/** This lookup contains no profile text, contact details or private roster data. */
export function personRelationshipsProjection(value) {
  if (plain(value?.content) && Object.hasOwn(value.content, 'guests') && !Array.isArray(value.content.guests)) fail();
  const source = contentSource(value), organizations = organizationLookupProjection(source), guests = records(source.content.guests ?? []),
    booths = source.content.booths, seenIds = new Set(), seenContacts = new Set();
  for (const row of [...source.content.sessions, ...booths, ...guests, ...organizations]) {
    if (seenIds.has(row.id)) fail(); seenIds.add(row.id);
  }
  if (!source.hasPublished || source.published !== null && (!plain(source.published) || !plain(source.published.content))) fail();
  const saved = source.published === null ? [] : records(source.published.content.guests);
  const publishedRevision = source.published === null ? null : revisionValue(source.published.revision);
  if (publishedRevision !== null && publishedRevision > source.revision) fail();
  if (source.published !== null) timestamp(source.published.publishedAt, false);
  const profiles = [];
  for (const guest of guests) {
    if (guest.contactId !== undefined && (typeof guest.contactId !== 'string' || guest.contactId && !CONTACT_ID.test(guest.contactId))) fail();
    if (!guest.contactId) continue;
    if (seenContacts.has(guest.contactId)) fail(); seenContacts.add(guest.contactId);
    const result = publicProfileProjection(guest.contactId, source), profile = result.profiles.find(item => item.id === guest.id);
    if (!profile) fail();
    profiles.push({ id: profile.id, contactId: guest.contactId, publicRoles: profile.publicRoles, status: profile.status,
      publicConsent: profile.publicConsent, ...(Object.hasOwn(profile, 'visibility') ? { visibility: profile.visibility } : {}), hasPortrait: profile.hasPortrait, published: profile.published, publishedMatchesDraft: profile.publishedMatchesDraft });
  }
  const boothOrganizations = booths.flatMap(booth => {
    if (!Object.hasOwn(booth, 'organizationId')) return [];
    if (typeof booth.organizationId !== 'string' || booth.organizationId && !CONTACT_ID.test(booth.organizationId)) fail();
    return booth.organizationId ? [{ boothId: booth.id, organizationId: booth.organizationId }] : [];
  });
  return { schemaVersion: 1, contentRevision: source.revision, publishedRevision, organizations, profiles, boothOrganizations,
    publicationAttributionUnavailable: saved.some(item => !guests.some(guest => guest.id === item.id && Boolean(guest.contactId))) };
}

function pagination(url, { candidates = false } = {}) {
  const allowed = candidates ? ['query', 'id', 'cursor', 'limit'] : ['cursor', 'limit'];
  for (const key of url.searchParams.keys()) if (!allowed.includes(key) || url.searchParams.getAll(key).length !== 1) fail('INVALID_REQUEST', 400);
  const integer = (key, fallback, maximum) => {
    if (!url.searchParams.has(key)) return fallback;
    const input = url.searchParams.get(key);
    if (!/^(?:0|[1-9]\d*)$/u.test(input) || !Number.isSafeInteger(Number(input)) || Number(input) > maximum) fail('INVALID_REQUEST', 400);
    return Number(input);
  };
  const cursor = integer('cursor', 0, 5000), limit = integer('limit', 100, 200);
  if (limit < 1) fail('INVALID_REQUEST', 400);
  const id = url.searchParams.get('id') ?? '', query = url.searchParams.get('query') ?? '';
  if (candidates && (url.searchParams.has('id') && (!CONTACT_ID.test(id) || url.searchParams.has('query') || url.searchParams.has('cursor'))
    || !query.isWellFormed() || [...query].length > 200 || /[\u0000-\u001f\u007f]/u.test(query))) fail('INVALID_REQUEST', 400);
  return { cursor, limit, id, query: query.trim().toLocaleLowerCase('zh-CN') };
}
function page(rows, { cursor, limit }) { return { total: rows.length, nextCursor: cursor + limit < rows.length ? String(cursor + limit) : null }; }
function minimalContact(row) {
  if (!plain(row.profile) || !plain(row.operations)) fail();
  return { id: row.id, name: text(row.profile.displayName || row.profile.name, 120, true), organization: text(row.profile.organization, 300) };
}

export function isPersonRelationshipsPath(path) { return typeof path === 'string' &&
  (path === ROOT + 'relationships' || path === ROOT + 'candidates' || path.startsWith(ROOT + 'organizations/')); }

/** Gates precede content/roster reads. Every response is a bounded private projection. */
export function createPersonRelationshipsApi({ authenticate, loadContent, loadContacts } = {}) {
  if (typeof authenticate !== 'function' || [loadContent, loadContacts].some(loader => loader !== undefined && typeof loader !== 'function')) throw new TypeError('Trusted relationship dependencies required.');
  return async request => {
    let allow;
    try {
      const url = new URL(request.url), origin = request.headers.get('origin');
      if (url.origin !== ORIGIN || url.username || url.password || url.hash) fail('NOT_FOUND', 404);
      const catalog = url.pathname === ROOT + 'relationships', candidates = url.pathname === ROOT + 'candidates',
        member = url.pathname.match(/^\/api\/admin\/people\/organizations\/([^/]+)\/members$/u);
      if (!catalog && !candidates && !member) fail('NOT_FOUND', 404);
      if (origin !== null && origin !== ORIGIN) fail('FORBIDDEN', 403);
      if (request.method !== 'GET') { allow = 'GET'; fail('METHOD_NOT_ALLOWED', 405); }
      const aborted = () => { if (request.signal.aborted) fail(); }; aborted();
      const session = await authenticate(request), actor = session?.user; aborted();
      if (typeof actor?.id !== 'string' || !/^[A-Za-z0-9_-]{1,80}$/u.test(actor.id) || !Array.isArray(actor.roles)) fail('AUTH_REQUIRED', 401);
      if (!actor.roles.includes('outreach') || candidates && !actor.roles.includes('editor')) fail('FORBIDDEN', 403);
      if (catalog && url.search) fail('INVALID_REQUEST', 400);
      const paging = catalog ? null : pagination(url, { candidates });
      if (member && !CONTACT_ID.test(member[1])) fail('INVALID_REQUEST', 400);
      async function load(loader) { if (!loader) fail(); const value = await loader(actor); aborted(); return value; }
      let body;
      if (catalog) body = personRelationshipsProjection(await load(loadContent));
      else if (candidates) {
        const snapshot = contactsSource(await load(loadContacts)), rows = snapshot.contacts.map(row => ({ ...minimalContact(row), eligible: guestPrefillFromContact(row).valid }))
          .filter(row => (!paging.id || row.id === paging.id) && (!paging.query || [row.name, row.organization, row.id].some(value => value.toLocaleLowerCase('zh-CN').includes(paging.query))));
        body = { schemaVersion: 1, contactsRevision: snapshot.revision, candidates: rows.slice(paging.cursor, paging.cursor + paging.limit), ...page(rows, paging) };
      } else {
        const source = contentSource(await load(loadContent));
        if (!organizationLookupProjection(source).some(row => row.id === member[1])) fail('NOT_FOUND', 404);
        const snapshot = contactsSource(await load(loadContacts)), rows = snapshot.contacts.flatMap(row => {
          const membership = organizationMemberships(row.operations).find(item => item.organizationId === member[1]);
          return membership ? [{ contactId: row.id, name: minimalContact(row).name, role: membership.role, title: membership.title }] : [];
        });
        body = { schemaVersion: 1, organizationId: member[1], contentRevision: source.revision, contactsRevision: snapshot.revision,
          members: rows.slice(paging.cursor, paging.cursor + paging.limit), ...page(rows, paging) };
      }
      aborted(); return json(body);
    } catch (failure) {
      const trusted = errors.has(failure), auth = failure?.status === 401 || failure?.code === 'AUTH_REQUIRED',
        code = auth ? 'AUTH_REQUIRED' : trusted ? failure.code : 'RELATIONSHIPS_UNAVAILABLE', status = auth ? 401 : trusted ? failure.status : 503;
      return json({ error: { code, message: messages[code] } }, status, allow ? { allow } : {});
    }
  };
}

/** Explicit identity resolution. All raw sources survive; the registration CAS owns seats and aliases. */
export function createPeopleResolutionApi({authenticate,registrationService,contactsStore,contentStore}={}){
 const path='/api/admin/people/resolve',candidatesPath='/api/admin/people/duplicates';
 const reply=(value,status=200)=>new Response(JSON.stringify(value),{status,headers});
 const stop=(code='INVALID_REQUEST',status=400)=>{const e=new Error(code);e.resolutionCode=code;e.status=status;throw e;};
 const norm=value=>String(value??'').normalize('NFKC').trim().toLocaleLowerCase('zh-CN');
 async function sources(){
  const [roster,listed,admissions,planning]=await Promise.all([contactsStore.read(),registrationService.repository.list(),registrationService.repository.getAdmissions(),contentStore.read()]);
  if(roster?.contacts?.some(contact=>!contact?.id)||listed.revision!==admissions.revision)stop('SOURCE_CHANGED',409);
  const index=admissionView((await registrationService.repository.readIndex()).value,admissions.settings);
  if(index.revision!==admissions.revision)stop('SOURCE_CHANGED',409);
  const status=new Map(admissions.people.map(row=>[row.registrationId,row.status])),kinds=new Map(admissions.people.map(row=>[row.registrationId,row.kind]));
  const rows=[...roster.contacts.map(row=>({key:'contact:'+row.id,id:row.id,kind:'contact',name:row.profile.displayName||row.profile.name,organization:row.profile.organization,email:row.profile.email,wechat:row.profile.wechat,phone:row.profile.phone,source:'意向／联络资料',status:null,responseStatus:row.operations.responseStatus,contactConsent:row.profile.contactConsent,submittedAt:row.createdAt,raw:row})),
   ...listed.registrations.map(row=>({key:'registration:'+row.id,id:row.id,kind:'registration',name:row.fields.name,organization:row.fields.organization??'',email:row.fields.email??'',wechat:row.fields.wechat??'',phone:'',source:row.provenance.kind==='public'?'网站申请':'工作人员登记',status:status.get(row.id),admissionKind:kinds.get(row.id),submittedAt:row.submittedAt,raw:row}))];
  const map=new Map(rows.map(row=>[row.key,row])),canonical=row=>{const group=personGroupFor(index,row.kind==='contact'?{contactId:row.id}:{registrationId:row.id});if(group)return group.id;if(row.kind==='registration'&&row.raw.provenance.kind==='staff_assisted'&&map.has('contact:'+row.raw.provenance.sourceContactId))return 'contact:'+row.raw.provenance.sourceContactId;return row.key;};
  return {roster,listed,admissions,index,rows,map,canonical,content:planning.draft.content};
 }
 function preview(data,keys){
  keys=[...new Set(keys.map(key=>{const row=data.map.get(key);return row?.kind==='registration'&&row.raw.provenance.kind==='staff_assisted'&&data.map.has('contact:'+row.raw.provenance.sourceContactId)?'contact:'+row.raw.provenance.sourceContactId:key;}))];
  let expanded;try{expanded=expandPersonKeys(data.index,keys);}catch{stop();}
  if(expanded.contactIds.some(id=>!data.map.has('contact:'+id)))stop('PERSON_NOT_FOUND',404);
  const rows=[...expanded.contactIds.map(id=>data.map.get('contact:'+id)),...expanded.registrationIds.map(id=>data.map.get('registration:'+id))];
  if(rows.some(row=>!row))stop('PERSON_NOT_FOUND',404);
  const rank=row=>({confirmed:0,waitlisted:1,pending_review:2,rejected:3,withdrawn:4})[row.status]??5;
  const old=personGroupFor(data.index,keys[0].startsWith('contact:')?{contactId:keys[0].slice(8)}:{registrationId:keys[0].slice(13)});
  const primaryKey=keys.length===1?(old?.primaryKey??keys[0]):rows.toSorted((a,b)=>rank(a)-rank(b)||a.key.localeCompare(b.key))[0].key;
  const inherited=[...new Set(rows.filter(row=>row.kind==='contact').flatMap(row=>row.raw.operations.participationForms.map(role=>role==='booth'?'exhibitor':role)).filter(role=>['attendee','speaker','guest','exhibitor'].includes(role)))];
  const groups=(data.index.admissions.personGroups??[]).filter(g=>g.contactIds.some(id=>expanded.contactIds.includes(id))||g.registrationIds.some(id=>expanded.registrationIds.includes(id)));
  const configured=groups.filter(g=>g.roles!==null),roles=configured.length?[...new Set(configured.flatMap(g=>g.roles))]:inherited.length?inherited:expanded.registrationIds.length?['attendee']:[];
  const locked=new Set();for(const guest of data.content.guests??[])if(expanded.contactIds.includes(guest.contactId))for(const role of guest.publicRoles??[])if(['speaker','guest'].includes(role))locked.add(role);
  for(const row of rows)if(row.kind==='contact')for(const session of row.raw.operations.sessionRoles??[])if(data.content.sessions.some(s=>s.id===session.sessionId&&s.status!=='cancelled'))for(const role of session.roles)if(role==='speaker'||role==='guest'||role==='panelist')locked.add(role==='panelist'?'guest':role);
  return {keys,expectedRevision:data.index.revision,expectedContactRevision:data.roster.revision,primaryKey,roles:[...new Set([...roles,...locked])],lockedRoles:[...locked],
   rows:rows.map(({raw,...row})=>row),confirmedCount:rows.filter(row=>row.status==='confirmed').length,sourceCount:rows.length};
 }
 return async request=>{
  const url=new URL(request.url);if(![path,candidatesPath].includes(url.pathname))return reply({error:{code:'NOT_FOUND'}},404);
  try{
   if(url.origin!==ORIGIN||url.username||url.password||url.hash||url.search)stop('INVALID_REQUEST',400);
   const origin=request.headers.get('origin');if(origin!==null&&origin!==ORIGIN||request.method!=='GET'&&origin!==ORIGIN)stop('FORBIDDEN',403);
   if(candidatesPath===url.pathname&&request.method!=='GET'||path===url.pathname&&request.method!=='POST')stop('METHOD_NOT_ALLOWED',405);
   const session=await authenticate(request),actor=session?.user;
   if(!actor)stop('AUTH_REQUIRED',401);if(!canManageEventOperations(actor))stop('FORBIDDEN',403);
   if(request.method!=='GET'&&!equalToken(request.headers.get('x-csrf-token'),session.csrfToken))stop('CSRF_REJECTED',403);
   if(!registrationService?.managePerson)stop('NOT_CONFIGURED',503);
   if(url.pathname===candidatesPath){
    const data=await sources(),tokens=new Map(),pairs=new Map();let truncated=false;
    for(const row of data.rows){const owner=data.canonical(row),items=[];
     if(row.email)items.push(['email:'+norm(row.email),'相同邮箱']);if(row.wechat)items.push(['wechat:'+norm(row.wechat),'相同微信']);
     const phone=String(row.phone??'').replace(/[^0-9+]/gu,'');if(phone.replace(/\D/gu,'').length>=7)items.push(['phone:'+phone,'相同电话']);
     if(norm(row.name)&&norm(row.organization))items.push(['name:'+norm(row.name)+'\0'+norm(row.organization),'姓名与机构相同']);
     for(const[token,reason]of items){for(const other of tokens.get(token)??[]){if(other.owner===owner)continue;const pair=[owner,other.owner].sort().join('\0');if(!pairs.has(pair)&&pairs.size>=200){truncated=true;continue;}
       const value=pairs.get(pair)??{keys:[other.row.key,row.key],rows:[other.row,row].map(r=>({key:r.key,name:r.name,organization:r.organization,source:r.source})),reasons:[]};if(!value.reasons.includes(reason))value.reasons.push(reason);pairs.set(pair,value);}
      const entries=tokens.get(token)??[];if(!entries.some(item=>item.owner===owner))entries.push({owner,row});tokens.set(token,entries);
     }
    }
    return reply({revision:data.index.revision,contactRevision:data.roster.revision,candidates:[...pairs.values()],truncated});
   }
   let input;try{input=await readIntentBody(request,16*1024);}catch{stop();}
   if(!plain(input)||Object.keys(input).some(key=>!['action','keys','primaryKey','roles','expectedRevision','expectedContactRevision','operationId','confirmSamePerson'].includes(key))||!['preview','merge','roles'].includes(input.action))stop();
   if(!Array.isArray(input.keys)||!input.keys.length||input.keys.length>20||input.keys.some(key=>!validPersonKey(key))||new Set(input.keys).size!==input.keys.length)stop();
   if(input.action==='preview')return reply(preview(await sources(),input.keys));
   if(!validPersonKey(input.primaryKey)||!validPersonRoles(input.roles)||typeof input.operationId!=='string'||!/^[A-Za-z0-9_-]{32,128}$/u.test(input.operationId)
    ||!Number.isSafeInteger(input.expectedRevision)||!Number.isSafeInteger(input.expectedContactRevision)||input.expectedRevision<0||input.expectedContactRevision<0
    ||input.action==='merge'&&(input.confirmSamePerson!==true||input.keys.length<2)||input.action==='roles'&&input.keys.length!==1)stop();
   const result=await registrationService.managePerson({actor,action:input.action==='merge'?'person_merge':'person_roles',expectedRevision:input.expectedRevision,operationId:input.operationId,
    input:{keys:input.keys,primaryKey:input.primaryKey,roles:input.roles,contactRevision:input.expectedContactRevision},
    verifySources:async index=>{const roster=await contactsStore.read();if(roster.revision!==input.expectedContactRevision)return false;const refs=expandPersonKeys(index,input.keys);if(!refs.contactIds.every(id=>roster.contacts.some(row=>row.id===id)))return false;for(const id of refs.registrationIds){if((await registrationService.getAdmissionStatus(id)).status!==index.admissions.people[id].status)return false;const record=await registrationService.repository.readRecord(index.entries.find(entry=>entry.id===id));if(record.provenance.kind==='staff_assisted'&&!refs.contactIds.includes(record.provenance.sourceContactId))return false;}return true;}});
   if(!['updated','replayed'].includes(result?.outcome))stop(result?.outcome==='conflict'?'SOURCE_CHANGED':result?.outcome==='forbidden'?'FORBIDDEN':result?.outcome==='invalid'?'INVALID_REQUEST':'RESOLUTION_UNAVAILABLE',result?.outcome==='conflict'?409:result?.outcome==='forbidden'?403:result?.outcome==='invalid'?400:503);
   return reply({outcome:result.outcome,operationId:input.operationId,revision:result.revision,releasedCount:result.releasedIds.length,registrationId:result.registrationId,
    person:result.personGroups?.find(g=>input.primaryKey.startsWith('contact:')?g.contactIds.includes(input.primaryKey.slice(8)):g.registrationIds.includes(input.primaryKey.slice(13)))??null});
  }catch(e){const code=e.resolutionCode??'RESOLUTION_UNAVAILABLE',status=e.resolutionCode?e.status:503;
   return reply({error:{code,message:({AUTH_REQUIRED:'请先登录后台。',FORBIDDEN:'此操作需要完整活动管理权限。',CSRF_REJECTED:'请重新载入后台后操作。',SOURCE_CHANGED:'资料已更新，或主报名不适合保留。请重新预览并优先保留已确认名额的报名。',INVALID_REQUEST:'请核对身份选择与合并资料。',PERSON_NOT_FOUND:'原来源已经变化，请重新读取。'})[code]??'本次操作未能确认，请保留原操作再次核对。'}},status);
  }
 };
}
