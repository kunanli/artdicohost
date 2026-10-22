// Native Chromium over the actual isolated application. Every HTTP request is intercepted.
// No real people, accounts, publication, mail, or external storage are used.
import assert from 'node:assert/strict';
import { readFile, mkdir, stat } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';

const project = fileURLToPath(new URL('../../', import.meta.url));
const source = resolve(process.env.ARTDICO_SOURCE_DIRECTORY || project);
const dist = resolve(process.env.ARTDICO_DIST_DIRECTORY || resolve(source, 'dist'));
const evidence = resolve(project, '.local-data/browser-evidence/admin-save-visibility');
const { peopleRuntimeFixture, PEOPLE_FIXTURE_API: API, PEOPLE_FIXTURE_PUBLIC: SITE } = await import(pathToFileURL(resolve(source, 'tests/helpers/people-runtime-fixture.mjs')));
const { createObjectJournal } = await import(pathToFileURL(resolve(source, 'functions/cloud-content/object-journal.mjs')));
const { validateContent, toPublicContent } = await import(pathToFileURL(resolve(source, 'shared/content-schema.mjs')));
const { CLOUD_ADMIN_PAGE_ALIASES } = await import(pathToFileURL(resolve(source, 'functions/cloud-content/http-server.mjs')));
const aliases = new Map(CLOUD_ADMIN_PAGE_ALIASES);
const { chromium } = await import(process.env.ARTDICO_PLAYWRIGHT_MODULE || 'playwright-core');
const PRIVATE = 'SYNTHETIC_PRIVATE_GAME_INFORMATION_NEVER_PUBLIC';
const IDS = { guest: 'synthetic-visibility-guest', creator: 'synthetic-visibility-organization', booth: 'synthetic-visibility-booth', indie: 'synthetic-visibility-work' };
const AT = '2026-10-21T09:00:00.000Z';
const clone = value => structuredClone(value);
const mime = file => ({ html: 'text/html', mjs: 'text/javascript', js: 'text/javascript', css: 'text/css', png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp', svg: 'image/svg+xml', woff2: 'font/woff2' })[extname(file).slice(1)] || 'application/octet-stream';
const json = (value, status = 200) => ({ status, contentType: 'application/json', body: JSON.stringify(value), headers: { 'access-control-allow-origin': SITE } });
const routeFor = key => '/admin/content/' + key + '/';
const publication = (page, kind, id) => page.locator('[data-content-panel]:visible [data-publication-record][data-publication-kind="' + kind + '"][data-publication-id="' + id + '"]');

async function seed(runtime) {
  const actor = runtime.users[0], original = (await runtime.app.store.read()).draft.content;
  await runtime.app.store.save(0, original, actor.id);
  await runtime.app.store.publish(1, actor.id);
  const content = clone(original);
  content.organizations = [{ id: IDS.creator, name: '合成默认公开组织', logoId: '', website: '', participation: 'undecided', status: 'pending', publicConsent: false, internalNotes: PRIVATE }];
  content.guests = [{ id: IDS.guest, name: '合成默认公开嘉宾', company: '合成创作机构', ggjRole: '', title: '', bio: '', portraitId: '', publicRoles: [], status: 'pending', publicConsent: false, internalNotes: PRIVATE }];
  content.booths = [{ id: IDS.booth, code: 'C-01', slotNumber: 1, zone: 'C', organization: '合成默认公开组织', project: '合成默认公开展位', description: '合成展位说明', contactName: PRIVATE, contactMethods: 'synthetic.private@example.invalid', status: 'pending', internalNotes: PRIVATE }];
  content.showcases = [{ id: IDS.indie, kind: 'indie', title: '合成默认公开作品', teamName: '合成创作者署名', school: PRIVATE, contactName: PRIVATE, email: 'synthetic.private@example.invalid', wechat: PRIVATE, memberCount: 7, participationForms: [], responseStatus: 'pending', materialLinks: 'https://example.invalid/' + PRIVATE, summary: '', coverId: '', status: 'pending', publicConsent: false, sessionId: '', boothId: '', internalNotes: PRIVATE }];
  const checked = validateContent(content); assert.equal(checked.valid, true, JSON.stringify(checked.errors));
  for (const kind of ['guests','organizations','showcases','booths']) assert.equal(Object.hasOwn(checked.value[kind][0], 'visibility'), false);
  await runtime.app.store.save(1, checked.value, actor.id);
  return { content: clone(checked.value) };
}

async function fixture(browser, errors, { width = 1440, legacy = false } = {}) {
  const runtime = await peopleRuntimeFixture({ capacity: 300, mail: false }), initial = await seed(runtime);
  if(legacy){const journal=createObjectJournal({objects:runtime.objects,prefix:'cms/v1/content'}),head=await journal.read();head.value.published={revision:2,publishedAt:AT,content:toPublicContent(head.value.draft.content,{legacyVisibility:true})};head.value.audit.push({action:'publish',actorId:runtime.users[0].id,revision:2,at:AT});await journal.commit(head.cursor,head.value);}
  const context = await browser.newContext({ viewport: { width, height: 940 }, acceptDownloads: true });
  const calls = [], dialogs=[];
  let publicationBudget = 0, nextSaveFault = null;
  const auth = await runtime.login('owner'), [cookieName, ...cookieValue] = auth.Cookie.split('=');
  await context.addCookies([
    { domain: new URL(API).hostname, path: '/api/admin', name: cookieName, value: cookieValue.join('='), httpOnly: true, secure: true, sameSite: 'Strict' },
    { domain: new URL(API).hostname, path: '/', name: 'synthetic_staff', value: 'SYNTHETIC_STAFF_COOKIE_NEVER_PUBLIC', httpOnly: true, secure: true, sameSite: 'Strict' },
  ]);
  await context.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url()), path = url.pathname;
    assert.ok([SITE, API].includes(url.origin), 'every network origin stays intercepted');
    if (path.startsWith('/api/')) {
      assert.equal(url.origin, API, 'the static frontend uses the independent API origin');
      const headers = await request.allHeaders(), body = request.postData() ? JSON.parse(request.postData()) : null;
      const entry = { path, method: request.method(), body, rawBody: request.postData(), headers }; calls.push(entry);
      assert.equal(/\/(?:dispatch|send|sent|manual-sent|users)(?:\/|$)/u.test(path), false, 'this acceptance never sends or manages accounts');
      if (path === '/api/admin/content/publish') { assert.ok(publicationBudget > 0, 'publication requires an explicit synthetic test action'); publicationBudget--; }
      if (path === '/api/admin/content' && request.method() === 'PUT' && nextSaveFault === 'uncommitted') { nextSaveFault = null; entry.status = 503; return route.fulfill(json({ error: { code: 'STORAGE_UNAVAILABLE' } }, 503)); }
      if (path.startsWith('/api/public/')) {
        assert.equal(headers.cookie, undefined, 'anonymous content and image reads omit every staff cookie');
        assert.equal(headers.authorization, undefined); assert.equal(headers.origin, SITE);
        if (path.startsWith('/api/public/portraits/')) assert.equal(headers.referer, undefined);
      }
      const response = await runtime.app.handle(new Request(request.url(), { method: request.method(), headers, ...(['GET', 'HEAD'].includes(request.method()) ? {} : { body: request.postData() }) }));
      const responseHeaders = Object.fromEntries(response.headers); delete responseHeaders['content-length'];
      const payload = { status: response.status, headers: responseHeaders, body: Buffer.from(await response.arrayBuffer()) };
      entry.status = payload.status;
      if (path === '/api/public/content') {
        assert.equal(response.headers.get('access-control-allow-origin'), SITE, 'actual runtime CORS grants only the public site');
      }
      await route.fulfill(payload); entry.delivered = true; return;
    }
    const fromSource = url.origin === API && path.startsWith('/__test_source__/'), base = fromSource ? source : dist;
    const served = fromSource ? path.slice('/__test_source__'.length) : url.origin === API ? aliases.get(path) || path : path;
    const file = resolve(base, '.' + (served.endsWith('/') ? served + 'index.html' : served)); assert.ok(file.startsWith(base + '/'));
    try { return route.fulfill({ status: 200, body: await readFile(file), contentType: mime(file) }); }
    catch { return route.fulfill({ status: 404, body: '' }); }
  });
  async function page() { const result = await context.newPage(); result.setDefaultTimeout(12000); await result.clock.setSystemTime(new Date(AT)); result.on('pageerror', error => errors.push(error.message)); result.on('dialog', dialog => { dialogs.push(dialog.message()); return dialog.accept(); }); return result; }
  const admin = await page(), front = await page();
  return { runtime, initial, context, admin, front, calls, dialogs,
    allowPublish: () => { publicationBudget++; }, failNextSave: () => { nextSaveFault = 'uncommitted'; },
    async close() { await context.close(); },
  };
}

async function openAdmin(f, key) { await f.admin.bringToFront(); await f.admin.goto(API + routeFor(key), { waitUntil: 'networkidle' }); await f.admin.locator('[data-admin-workspace]:visible').waitFor(); await f.admin.locator('[data-content-panel="' + key + '"]:visible').waitFor(); }
async function openFront(f) { await f.front.bringToFront(); await f.front.goto(SITE + '/', { waitUntil: 'networkidle' }); assert.equal(await f.front.locator('meta[name=artdico-content-api]').getAttribute('content'), API + '/api/public/content'); }
async function anonymous(f) { const response = await f.runtime.app.handle(f.runtime.request('/api/public/content', { origin: SITE })); assert.equal(response.headers.get('access-control-allow-origin'), SITE); return { status: response.status, value: await response.json() }; }
async function editWork(f, id) { await openAdmin(f, 'showcases'); await f.admin.locator('[data-showcase-id="' + id + '"] [data-row-action=edit]').click(); return f.admin.locator('[data-showcase-form]'); }
async function until(page, predicate, message) { for (let i = 0; i < 500; i++) { if (await predicate()) return; await page.waitForTimeout(20); } assert.fail(message); }
async function noOverflow(page) { assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true, 'no horizontal viewport overflow'); }
async function visibleHit(locator) { await locator.evaluate(node => node.scrollIntoView({ behavior: 'instant', block: 'center', inline: 'center' })); await locator.page().evaluate(() => new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done)))); const result = await locator.evaluate(node => { const box = node.getBoundingClientRect(), hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2); return { hit: box.width > 0 && box.height > 0 && box.top >= 0 && box.bottom <= innerHeight && (hit === node || node.contains(hit)), rect: box.toJSON(), covering: hit?.outerHTML.slice(0, 900), savebar: document.querySelector('[data-admin-savebar]')?.getBoundingClientRect().toJSON(), wrap: node.closest('.ah-admin-table-wrap')?.getBoundingClientRect().toJSON(), scrollY, viewport: { width: innerWidth, height: innerHeight } }; }); if (!result.hit) { process.stderr.write('visibility diagnostic ' + JSON.stringify(result) + '\n'); await locator.page().screenshot({ path: resolve(evidence, 'failed-hit-' + result.viewport.width + '.png') }); } assert.equal(result.hit, true, 'the visible status/action is not obscured by the save bar'); }
async function assertPrivate(f) { const envelope = await anonymous(f); assert.equal(envelope.status, 200); const value = JSON.stringify(envelope.value); assert.doesNotMatch(value, new RegExp(PRIVATE + '|synthetic.private|contactId|contactName|materialLinks|internalNotes|wechat|memberCount')); assert.equal(f.runtime.messages.length, 0); }
async function unchangedAdmissions(f, before) { const after = await f.runtime.app.registrationService.getAdmissions({ actor: f.runtime.users[0] }); assert.deepEqual(after, before, 'game/organization/publication changes do not allocate attendance places'); assert.equal(after.summary.capacity, 300); }
async function draftRecords(page) { return page.evaluate(() => new Promise((resolve, reject) => { const request = indexedDB.open('artdico-browser-drafts-v1', 1); request.onerror = () => reject(request.error); request.onsuccess = () => { const db = request.result, tx = db.transaction('drafts', 'readonly'), read = tx.objectStore('drafts').getAll(); read.onsuccess = () => resolve(read.result); read.onerror = () => reject(read.error); tx.oncomplete = () => db.close(); }; })); }
async function proofControl(page, name) { const open = page.locator('dialog[open] [data-admin-' + name + ']'); return await open.count() ? open.last() : page.locator('[data-admin-savebar] [data-admin-' + name + ']'); }


const items = [
  ['guests', IDS.guest, 'guest'], ['organizations', IDS.creator, 'organization'],
  ['showcases', IDS.indie, 'showcase'], ['booths', IDS.booth, 'booth'],
];
const toggle = (page, kind, id) => kind==='organizations'
  ? page.locator('[data-organization-id="'+id+'"] [data-organization-action=visibility]')
  : page.locator('[data-visibility-kind="'+kind+'"][data-visibility-id="'+id+'"]');
async function setting(page, kind, id, visible) {
  const button = toggle(page,kind,id); await button.waitFor();
  assert.equal(await button.getAttribute('role'),'switch');
  assert.equal(await button.getAttribute('aria-checked'),String(visible));
  assert.equal((await button.textContent()).trim(),visible?'公开':'未公开');
  assert.equal(await button.isEnabled(),true);
  return button;
}
async function publishHere(f) {
  const before = (await f.runtime.app.store.read()).draft.revision;
  f.allowPublish(); const button=f.admin.locator('[data-content-panel]:visible [data-admin-publish]').first();
  const publishButton = await button.count()?button:f.admin.locator('[data-admin-publish]:visible').first();
  assert.match(await publishButton.textContent(),/发布到前台|保存并发布/u);
  await visibleHit(publishButton); await publishButton.click();
  await until(f.admin,async()=>{const h=await f.runtime.app.store.read(); return h.published?.revision>=before;},'explicit visible page publish');
  await f.admin.locator('[data-admin-logout]:enabled').waitFor();
  return (await f.runtime.app.store.read()).published;
}
const groups=new Set((process.env.ARTDICO_SAVE_VISIBILITY_GROUPS||'visibility,save,recovery').split(','));
assert.ok([...groups].every(group=>['visibility','save','recovery'].includes(group)),'known focused acceptance groups');
const browser=await chromium.launch({executablePath:process.env.ARTDICO_CHROMIUM_BINARY||'/usr/bin/chromium',args:['--no-sandbox','--disable-dev-shm-usage']});
const errors=[],reports=[]; await mkdir(evidence,{recursive:true});
try {
if(groups.has('visibility')) for (const width of [320,390,1440]) {
 const f=await fixture(browser,errors,{width});
 try {
  const admissions=await f.runtime.app.registrationService.getAdmissions({actor:f.runtime.users[0]});
  const baseline=(await anonymous(f)).value; assert.equal(baseline.revision,1);
  for(const [kind,id,formKind]of items) {
    await openAdmin(f,kind); assert.equal(await f.admin.locator('[data-admin-savebar]').isVisible(),false,'initial cloud draft load does not display a saved floating panel');assert.equal(await f.admin.locator('[data-admin-savebar]').evaluate(node=>['fixed','sticky'].includes(getComputedStyle(node).position)),false);const control=await setting(f.admin,kind,id,true); await visibleHit(control);
    assert.equal(await control.getAttribute('data-visibility'),'public');
    const edit=kind==='organizations'?f.admin.locator('[data-organization-id="'+id+'"] [data-organization-action=edit]'):kind==='booths'?control.locator('xpath=ancestor::tr').locator('[data-row-action=edit]'):f.admin.locator('[data-'+formKind+'-id="'+id+'"] [data-row-action=edit]');
    await edit.click(); const form=f.admin.locator('[data-'+formKind+'-form]'); await form.waitFor();
    assert.equal(await form.locator('[name=visibility]').inputValue(),'public');
    const formSwitch=form.locator(kind==='organizations'?'[data-organization-visibility]':'[data-content-visibility-switch]');assert.equal(await formSwitch.getAttribute('aria-checked'),'true');
    await f.admin.locator(formKind==='organization'?'[data-organization-close]':'[data-'+formKind+'-dialog] [data-close-dialog='+formKind+']').first().click();
    const badges=publication(f.admin,kind,id); assert.equal(await badges.getAttribute('data-publication-state'),'unpublished');
    assert.match(await badges.textContent(),/待发布/u);
    await noOverflow(f.admin);
    await f.admin.screenshot({path:resolve(evidence,kind+'-default-'+width+'.png'),fullPage:true});
  }
  assert.deepEqual((await anonymous(f)).value,baseline,'default settings and navigation do not publish');
  assert.equal(f.calls.filter(call=>call.path.endsWith('/publish')).length,0);
  await publishHere(f);
  const publicAfter=(await anonymous(f)).value;
  for(const [kind,id]of items) assert.equal(publicAfter.content[kind].some(row=>row.id===id),true,kind+' default appears after publish despite missing confirmations/images/arrangements');
  await openFront(f);
  await f.front.locator('[data-public-guests] [data-guest-id="'+IDS.guest+'"]').waitFor();
  assert.equal(await f.front.locator('[data-public-guests] [data-guest-id="'+IDS.guest+'"] img').count(),0);
  await f.front.locator('[data-public-showcases] [data-showcase-id="'+IDS.indie+'"]').waitFor();
  await noOverflow(f.front); await assertPrivate(f);
  for(const [kind,id]of items) {
    await openAdmin(f,kind); let control=await setting(f.admin,kind,id,true);
    const before=(await f.runtime.app.store.read()).draft.revision; await visibleHit(control); await control.click();
    await until(f.admin,async()=>{const h=await f.runtime.app.store.read();return h.draft.revision>before&&h.draft.content[kind].find(row=>row.id===id).visibility==='private';},'manual private setting saved');
    await setting(f.admin,kind,id,false);
    const record=(await f.runtime.app.store.read()).draft.content[kind].find(row=>row.id===id);
    assert.equal(record.status,'pending'); if(kind!=='booths')assert.equal(record.publicConsent,false);
    assert.equal((await anonymous(f)).value.content[kind].some(row=>row.id===id),true,'save does not publish private withdrawal');
    await publishHere(f); assert.equal((await anonymous(f)).value.content[kind].some(row=>row.id===id),false,'explicit publish removes opted-out record');
    await openAdmin(f,kind); await setting(f.admin,kind,id,false);
    const prior=(await f.runtime.app.store.read()).draft.revision; await toggle(f.admin,kind,id).click();
    await until(f.admin,async()=>{const h=await f.runtime.app.store.read();return h.draft.revision>prior&&h.draft.content[kind].find(row=>row.id===id).visibility==='public';},'manual public setting saved');
    await setting(f.admin,kind,id,true); await publishHere(f);
    assert.equal((await anonymous(f)).value.content[kind].some(row=>row.id===id),true);
    await f.admin.screenshot({path:resolve(evidence,kind+'-republished-'+width+'.png'),fullPage:true});
  }
  await assertPrivate(f); await unchangedAdmissions(f,admissions);
  reports.push({group:'visibility',width,fourDefaultGreen:true,obviousPagePublish:true,defaultIncompletePublicProjection:true,manualPrivateRoundTrip:true,saveVersusPublish:true,noPrivateLeak:true,capacity300:true});
 }finally{await f.close();}
}
if(groups.has('save')) for (const width of [320,390,1440]) {
 const f=await fixture(browser,errors,{width});
 try {
  await openAdmin(f,'event'); const title=f.admin.locator('[data-event-form] [name=title]'),save=f.admin.locator('[data-admin-save-location=footer]');
  const before=(await f.runtime.app.store.read()).draft;await title.fill('');await visibleHit(save);await save.click();
  assert.equal(f.calls.filter(call=>call.path==='/api/admin/content'&&call.method==='PUT').length,0,'invalid current form cannot save old values');
  assert.equal(await title.evaluate(node=>node.validity.valueMissing),true);
  const newTitle='合成页面直接保存 '+width;await title.fill(newTitle);await visibleHit(save);await save.click();
  await f.admin.locator('[data-admin-savebar][data-save-state=saved]').waitFor({state:'attached'});
  let head=await f.runtime.app.store.read();assert.equal(head.draft.content.event.title,newTitle);assert.equal(head.draft.revision,before.revision+1);assert.deepEqual(head.draft.content.guests,before.content.guests);assert.equal(head.published.revision,1);
  await f.admin.reload({waitUntil:'networkidle'});await f.admin.locator('[data-admin-workspace]:visible').waitFor();assert.equal(await title.inputValue(),newTitle);
  await title.fill(newTitle+' 发布');await publishHere(f);head=await f.runtime.app.store.read();assert.equal(head.published.content.event.title,newTitle+' 发布');assert.equal(head.draft.revision,before.revision+2);
  const form=await editWork(f,IDS.indie);await form.locator('[name=title]').fill('合成编辑器就近保存 '+width);await f.admin.locator('[data-showcase-submit]').click();await form.locator('.ah-form-save-state[data-save-state=saved]').waitFor();assert.equal(await f.admin.locator('[data-showcase-submit]').isDisabled(),true);assert.equal(await f.admin.locator('[data-showcase-dialog]').isVisible(),true);await f.admin.locator('[data-close-dialog=showcase]').first().click();await f.admin.locator('[data-showcase-dialog]').waitFor({state:'hidden'});
  head=await f.runtime.app.store.read();assert.equal(head.draft.content.showcases[0].title,'合成编辑器就近保存 '+width);assert.equal(head.published.content.showcases[0].title,'合成默认公开作品');
  for(const [collection,type,field,add]of[
   ['guests','guest','name','[data-admin-add-guest]'],['organizations','organization','name','[data-organization-add]'],
   ['showcases','showcase','title','[data-admin-add-showcase]'],['booths','booth','project','[data-admin-add-booth]']]) {
   await openAdmin(f,collection);await f.admin.locator(add).click();const editor=f.admin.locator('[data-'+type+'-form]');await editor.waitFor();
   const stableId=await editor.locator('[name=id]').inputValue(),label='合成新建后继续编辑 '+type+' '+width;
   assert.ok(stableId);assert.equal(await editor.locator('[name=visibility]').inputValue(),'public');
   await editor.locator('[name='+field+']').fill(label);
   if(type==='guest')await editor.locator('[name=company]').fill('合成机构');
   if(type==='showcase')await editor.locator('[name=teamName]').fill('合成团队');
   if(type==='booth')await editor.locator('[name=code]').fill('X-'+width);
   const beforeNew=(await f.runtime.app.store.read()).draft,submit=editor.locator('button[type=submit]');await visibleHit(submit);await submit.click();
   await until(f.admin,async()=>(await f.runtime.app.store.read()).draft.revision===beforeNew.revision+1,'new entity exact save ACK');
   await editor.locator('.ah-form-save-state[data-save-state=saved]').waitFor();assert.equal(await submit.isDisabled(),true);assert.equal(await f.admin.locator('[data-'+type+'-dialog]').isVisible(),true);
   let created=(await f.runtime.app.store.read()).draft.content[collection];assert.equal(created.length,beforeNew.content[collection].length+1);assert.equal(created.find(row=>row.id===stableId)[field],label);
   await editor.locator('[name='+field+']').fill(label+' 更新');await submit.click();
   await until(f.admin,async()=>(await f.runtime.app.store.read()).draft.revision===beforeNew.revision+2,'same stable new entity second save');
   await editor.locator('.ah-form-save-state[data-save-state=saved]').waitFor();assert.equal(await submit.isDisabled(),true);
   created=(await f.runtime.app.store.read()).draft.content[collection];assert.equal(created.length,beforeNew.content[collection].length+1);assert.equal(created.find(row=>row.id===stableId)[field],label+' 更新');
   const dialogueCount=f.dialogs.length;await f.admin.locator(type==='organization'?'[data-organization-close]':'[data-close-dialog='+type+']').first().click();await f.admin.locator('[data-'+type+'-dialog]').waitFor({state:'hidden'});assert.equal(f.dialogs.length,dialogueCount,'clean saved editor closes without a discard prompt');
  }
  await f.admin.screenshot({path:resolve(evidence,'direct-save-'+width+'.png'),fullPage:true});await noOverflow(f.admin);
  reports.push({group:'save',width,invalidSaveDoesNotSubmitOldData:true,currentPageInputSingleClickExactSave:true,unrelatedSectionsUnchanged:true,reloadVerifiesCloudValue:true,dirtySaveAndPublish:true,dialogNearbySave:true,newEntitySecondSaveKeepsSameId:true,allFourCleanEditorClosesWithoutDiscard:true});
 }finally{await f.close();}
}
if(groups.has('recovery')) {
{
 const f=await fixture(browser,errors,{legacy:true});
 try{
  const before=(await anonymous(f)).value;assert.equal(before.revision,2);for(const[kind]of items)assert.equal(before.content[kind].length,0);
  await openAdmin(f,'guests');await setting(f.admin,'guests',IDS.guest,true);await publishHere(f);
  const after=(await anonymous(f)).value;assert.equal(after.revision,3);for(const[kind,id]of items)assert.equal(after.content[kind].some(row=>row.id===id),true);
  const puts=f.calls.filter(call=>call.path==='/api/admin/content'&&call.method==='PUT');assert.equal(puts.length,1);assert.equal(puts[0].body.expectedRevision,2);
  assert.deepEqual(puts[0].body.content,f.initial.content,'policy upgrade saves exact old draft before publishing a new revision');
  reports.push({group:'recovery',legacySameRevisionFrozen:true,explicitPagePublishSavesNewRevision:true,noImplicitPublication:true});
 }finally{await f.close();}
}
{
 const f=await fixture(browser,errors);
 try{
  await openAdmin(f,'showcases');f.failNextSave();await toggle(f.admin,'showcases',IDS.indie).click();
  await f.admin.locator('[data-admin-savebar][data-save-state=unknown]').waitFor({state:'attached'});
  const original=f.calls.find(call=>call.path==='/api/admin/content'&&call.method==='PUT');assert.equal(original.body.content.showcases[0].visibility,'private');
  const pending=(await draftRecords(f.admin)).find(row=>row.kind==='pending_submission');assert.deepEqual(pending.value.pendingSave,original.body,'native IndexedDB retains the exact original visibility request');
  assert.equal((await f.runtime.app.store.read()).draft.revision,2);assert.equal(f.calls.filter(call=>call.path.endsWith('/publish')).length,0);
  await (await proofControl(f.admin,'check-save')).click();await (await proofControl(f.admin,'retry-save')).click();
  await f.admin.locator('[data-admin-savebar][data-save-state=saved]').waitFor({state:'attached'});
  const puts=f.calls.filter(call=>call.path==='/api/admin/content'&&call.method==='PUT');assert.equal(puts.length,2);assert.equal(puts[1].rawBody,original.rawBody);
  await setting(f.admin,'showcases',IDS.indie,false);assert.equal((await f.runtime.app.store.read()).draft.content.showcases[0].visibility,'private');
  reports.push({group:'recovery',visibilitySaveUnknownPreserved:true,explicitReadbackThenExactRetry:true,noAutomaticPublish:true});
 }finally{await f.close();}
}
}
assert.deepEqual(errors,[]);
console.log(JSON.stringify({source,dist,distMtime:(await stat(resolve(dist,'index.html'))).mtime.toISOString(),htmlSha256:createHash('sha256').update(await readFile(resolve(dist,'index.html'))).digest('hex'),reports,pageErrors:errors},null,2));
}finally{await browser.close();}
