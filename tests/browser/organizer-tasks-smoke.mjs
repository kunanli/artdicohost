// Optional Chromium regression. All HTTP routes are intercepted synthetic data.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { extname, resolve } from 'node:path';
import { createOrganizerTasksApi } from '../../functions/organizer-tasks/handler.mjs';
import { eventConfig as event } from '../../src/config/event.mjs';
import { buildPosterInvitationSettings, INVITATION_POSTER_FACTS } from '../../shared/organizer-progress.mjs';
const { chromium } = await import(process.env.ARTDICO_PLAYWRIGHT_MODULE || 'playwright-core');
const dist = resolve(process.env.ARTDICO_DIST_DIRECTORY || resolve(fileURLToPath(new URL('../../', import.meta.url)), 'dist'));
const browser = await chromium.launch({ executablePath: process.env.ARTDICO_CHROMIUM_BINARY || '/usr/bin/chromium', headless: true, args: ['--no-sandbox','--disable-dev-shm-usage'] });
const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
const page = await context.newPage(), errors = [], requests = [];
page.on('pageerror', error => errors.push(error.message));page.on('dialog', dialog => dialog.accept());
const staff = { id: 'synthetic-staff', label: '合成工作人员', roles: ['outreach','reviewer'] };
const make = (id, name, consent = 'consented') => ({ id, profile: { name, displayName: name, city: '合成城市', organization: '合成机构', position: '', email: 'synthetic@example.invalid', wechat: '', phone: '', website: '', background: '', siteName: '', siteRole: '', categories: [], interests: [], contactConsent: consent },
  source: { key: 'manual', rowId: id }, operations: { owner: id === 'synthetic-unknown' ? '合成乙' : '合成甲', priority: 'normal', responseStatus: 'pending', followUpAt: '', notes: '', participationForms: [], sessionIds: [], boothIds: [] }, invitation: { generatedAt: null, sentAt: null, settings: null } });
const contacts = [make('synthetic-manual','合成人工对象'),make('synthetic-provider','合成邮件对象'),make('synthetic-unknown','合成未知对象'),make('synthetic-new','合成待邀对象'),make('synthetic-declined','合成拒绝对象','declined')];
const settings = person => ({ recipientName: person.profile.name, date: event.date.value, time: event.time.start + '–' + event.time.end, venue: event.venue.address, confirmed: true });
const conversion = person => ({ sourceContactId: person.id, registrationId: 'r-' + person.id, referenceCode: 'ref-' + person.id, admissionStatus: 'confirmed' });
const invitation = (person, status) => ({ id: 'i-' + person.id, sourceContactId: person.id, registrationId: 'r-' + person.id, referenceCode: 'ref-' + person.id,
  channel: status === 'provider_accepted' || status === 'unknown' ? 'email' : 'manual', status, createdAt: '2026-10-19T01:00:00.000Z', updatedAt: '2026-10-19T02:00:00.000Z',
  content: { eventId: event.id, title: status === 'provider_accepted' || status === 'unknown' ? event.title : INVITATION_POSTER_FACTS.title,
    registrationId: 'r-' + person.id, referenceCode: 'ref-' + person.id,
    settings: status === 'provider_accepted' || status === 'unknown' ? settings(person) : buildPosterInvitationSettings(person.profile.name, event) } });
const legacy = contacts[0];legacy.invitation = { generatedAt: '2026-10-19T01:00:00.000Z', sentAt: '2026-10-19T02:00:00.000Z', sentGenerationAt: '2026-10-19T01:00:00.000Z', settings: settings(legacy) };
const ledger = { revision: 1, conversions: contacts.slice(0,4).map(conversion), invitations: [invitation(contacts[0],'manually_sent'),invitation(contacts[1],'provider_accepted'),invitation(contacts[2],'unknown')], email: { ready: false } };
const waitlisted = make('synthetic-waitlisted','合成候补对象'), admissionUnknown = make('synthetic-admission-unknown','合成名额待核对象');
contacts.push(waitlisted,admissionUnknown);ledger.conversions.push({...conversion(waitlisted),admissionStatus:'waitlisted'},{...conversion(admissionUnknown),admissionStatus:'unknown'});
const content = { sessions: [], booths: Array.from({length:15}, (_,index)=>({ id:'synthetic-booth-'+index, code:'C'+String(index+1).padStart(2,'0'), slotNumber:index+1, status:'pending', organization:'合成机构', project:'合成项目', description:'合成展示内容', contactName:'合成展位负责人', contactMethods:'private-synthetic-method' })), guests: [] };
let actor = staff, sourceReads = 0, prepareCalls = 0, sentWrites = 0, ledgerUnavailable = false;
const tasks = createOrganizerTasksApi({ authenticate: async()=>({ user:actor }), getSources: async()=>{sourceReads++;return {contacts,contactRevision:2,content,contentRevision:1,intent:ledger};}, now:()=>Date.parse('2026-10-22T02:00:00.000Z') });
const json = body=>({ status:200,contentType:'application/json',body:JSON.stringify(body) });
await context.route('**/*',async route=>{
  const request=route.request(),url=new URL(request.url()),path=url.pathname;
  if(url.origin!=='https://api.artdico.host')return route.abort();
  if(path.startsWith('/api/')){
    requests.push(path);if(path.includes('manual-sent')||path.endsWith('/sent'))sentWrites++;
    if(path==='/api/admin/session')return route.fulfill(json({user:actor,csrfToken:'s'.repeat(43)}));
    if(path==='/api/admin/logout')return route.fulfill(json({ok:true}));
    if(path==='/api/admin/tasks'){const response=await tasks(new Request(request.url()));return route.fulfill({status:response.status,headers:Object.fromEntries(response.headers),body:await response.text()});}
    if(path==='/api/admin/contacts')return route.fulfill(json({revision:2,contacts}));
    if(path==='/api/admin/planning')return route.fulfill(json({content,features:{intentInvitations:true,batchInvitations:true}}));
    if(path==='/api/admin/intent-invitations')return route.fulfill(ledgerUnavailable?{status:503,contentType:'application/json',body:'{}'}:json(ledger));
    if(path==='/api/admin/contacts/invitations/preview'){assert.deepEqual(request.postDataJSON().contactIds,['synthetic-new']);return route.fulfill(json({contactRevision:2,previewToken:'synthetic-preview-token',entries:[{contactId:'synthetic-new',eligible:true,registrationId:'r-synthetic-new',referenceCode:'ref-synthetic-new'}],summary:{selected:1,eligible:1,skipped:0}}));}
    if(path==='/api/admin/contacts/invitations/prepare-batch'){prepareCalls++;assert.equal(request.postDataJSON().confirmPrepare,true);const prepared=invitation(contacts[3],'prepared');ledger.invitations.push(prepared);return route.fulfill(json({contactRevision:2,results:[{contactId:'synthetic-new',status:'prepared',invitation:prepared}]}));}
    return route.fulfill({status:404,contentType:'application/json',body:'{}'});
  }
  const file=resolve(dist,'.'+(path.endsWith('/')?path+'index.html':path));
  if(!file.startsWith(dist+'/'))return route.abort();
  try{return route.fulfill({status:200,body:await readFile(file),contentType:({html:'text/html',js:'text/javascript',css:'text/css',png:'image/png',webp:'image/webp',woff2:'font/woff2'})[extname(file).slice(1)]||'application/octet-stream'});}catch{return route.fulfill({status:404,body:''});}
});
try{
  await page.goto('https://api.artdico.host/admin/tasks/',{waitUntil:'networkidle'});
  try{await page.locator('[data-tasks-workspace]:visible').waitFor({timeout:10000});}catch{throw new Error(JSON.stringify({stage:'tasks-load',pageErrors:errors,error:await page.locator('[data-tasks-error]').textContent(),requests}));}
  assert.equal(await page.locator('[data-tasks-metrics] article').filter({hasText:'人工已发出'}).locator('strong').textContent(),'1');
  assert.equal(await page.locator('[data-tasks-metrics] article').filter({hasText:'服务商已接受'}).locator('strong').textContent(),'1');
  assert.equal(await page.locator('[data-tasks-metrics] article').filter({hasText:'候补 · 名额尚未确认'}).locator('strong').textContent(),'1');
  const waitlistedTask=page.locator('[data-tasks-list] li').filter({hasText:'合成候补对象'});assert.equal(await waitlistedTask.count(),1);assert.equal(await waitlistedTask.getAttribute('data-kind'),'admission_pending');assert.doesNotMatch(await waitlistedTask.textContent(),/已停用/u);
  assert.equal(await page.locator('[data-tasks-list]').getByText('合成拒绝对象').count(),0);
  await page.locator('[data-tasks-owner]').selectOption('合成乙');await page.locator('[data-tasks-kind]').selectOption('invitation_unknown');await page.locator('[data-tasks-filters]').getByRole('button',{name:'应用筛选'}).click();
  await page.locator('[data-tasks-result]').filter({hasText:'当前筛选 1 项'}).waitFor();assert.equal(await page.locator('[data-tasks-list] li').count(),1);
  assert.equal(await page.locator('[data-tasks-list] a').first().getAttribute('href'),'/admin/person/#contact=synthetic-unknown');
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),true);
  await page.locator('[data-tasks-logout]').click();await page.locator('[data-tasks-login-panel]:visible').waitFor();assert.equal(await page.locator('[data-tasks-list]').textContent(),'');
  actor={id:'synthetic-editor',roles:['editor']};const before=sourceReads;
  await page.reload({waitUntil:'networkidle'});await page.locator('[data-tasks-error]:visible').waitFor();assert.equal(sourceReads,before);assert.equal(await page.locator('[data-tasks-metrics]').textContent(),'');
  actor=staff;await page.goto('https://api.artdico.host/admin/contacts/',{waitUntil:'networkidle'});
  const progressNote=await page.locator('[data-contacts-progress-note]').textContent();
  assert.match(progressNote,/当前版人工发出 1 位/u);
  assert.match(progressNote,/服务商接受 1 位/u);
  assert.equal(await page.locator('[data-contact-selection="synthetic-declined"]').isDisabled(),true);
  const waitingRow=page.locator('[data-contacts-rows] tr').filter({hasText:'合成候补对象'});assert.equal(await waitingRow.getByRole('button',{name:'名额待确认 · 暂不准备正式邀请',exact:true}).isDisabled(),true);assert.equal(await waitingRow.getByRole('button',{name:'名额待确认',exact:true}).isDisabled(),true);
  await page.locator('[data-contacts-progress]').selectOption('waitlisted');assert.equal(await page.locator('[data-contacts-rows] tr').count(),1);
  await page.locator('[data-contacts-progress]').selectOption('unsent');assert.equal(await page.locator('[data-contacts-rows] tr').count(),1);assert.match(await page.locator('[data-contacts-rows] tr').textContent(),/合成待邀对象/u);
  await page.locator('[data-contacts-progress]').selectOption('');
  await page.locator('[data-contact-selection="synthetic-new"]').check();await page.locator('[data-contacts-batch-invite]').click();
  await page.locator('[data-batch-download]:visible').waitFor({timeout:30000});assert.equal(prepareCalls,1);assert.equal(sentWrites,0);
  assert.match(await page.locator('[data-batch-summary]').textContent(),/实际生成 1 张图片/u);
  assert.match(await page.locator('[data-batch-download]').getAttribute('download'),/\.zip$/u);
  await page.locator('[data-contacts-logout]').click();await page.locator('[data-contacts-login-panel]:visible').waitFor();assert.equal(await page.locator('[data-batch-download]').getAttribute('href'),null);assert.equal(await page.locator('[data-batch-results]').textContent(),'');
  ledgerUnavailable=true;await page.goto('https://api.artdico.host/admin/contacts/',{waitUntil:'networkidle'});await page.locator('[data-contacts-workspace]:visible').waitFor();assert.equal(await page.locator('[data-contacts-rows] tr').filter({hasText:'合成人工对象'}).getByRole('button',{name:'名额暂无法核对',exact:true}).isDisabled(),true);
  assert.deepEqual(errors,[]);console.log(JSON.stringify({mobileTasks:true,ownerAndKindFilters:true,declinedExcluded:true,roleGateBeforeSourceRead:true,manualAndProviderSeparate:true,legacyAndLedgerDeduplicated:true,waitlistDistinctFromWithdrawal:true,waitlistNotOfferedFormalInvites:true,unavailableLedgerBlocksInvitationPreparation:true,privateBatchZipPrepared:true,noSentWrites:true,logoutClearsPrivateDownload:true,pageErrors:errors,requests},null,2));
}finally{await context.close();await browser.close();}
