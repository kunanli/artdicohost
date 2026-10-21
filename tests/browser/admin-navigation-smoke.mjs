// Real Chromium; every HTTP request is intercepted and all staff data is synthetic.
import assert from 'node:assert/strict';
import {readFile, mkdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {extname, resolve} from 'node:path';
import {createInitialContent} from '../../src/config/content.mjs';
import {buildArrangementOverview} from '../../shared/arrangement-overview.mjs';
import {createOrganizerTasksApi} from '../../functions/organizer-tasks/handler.mjs';
import {volunteerFixture} from '../volunteer-api-fixture.mjs';

const {chromium} = await import(process.env.ARTDICO_PLAYWRIGHT_MODULE || 'playwright-core');
const project = fileURLToPath(new URL('../../', import.meta.url));
const dist = resolve(process.env.ARTDICO_DIST_DIRECTORY || resolve(project, 'dist'));
const evidence = resolve(project, '.local-data/browser-evidence');
const SITE = 'https://api.artdico.host';
const staff = {id:'synthetic-navigation-editor', label:'合成导航工作人员', roles:['editor','publisher','outreach','reviewer','superadmin']};
const content = createInitialContent();
const json = (body, status = 200) => ({status, contentType:'application/json', body:JSON.stringify(body)});
const sections = ['workspace-title','event-editor-title','arrangements-title','guests-title','organizations-title','showcases-title','sessions-title','booths-title'];
const routes = [
  ['/admin/', 'admin'], ['/admin/tasks/', 'tasks'], ['/admin/contacts/', 'contacts'], ['/admin/registrations/', 'review'], ['/admin/settings/', 'settings'], ['/admin/volunteers/', 'volunteer'],
];
const errors = [], reports = [];
const browser = await chromium.launch({executablePath:process.env.ARTDICO_CHROMIUM_BINARY || '/usr/bin/chromium', headless:true, args:['--no-sandbox','--disable-dev-shm-usage']});

async function fixture(width) {
  const context = await browser.newContext({viewport:{width,height:900}});
  const page = await context.newPage();
  let authenticated = false;
  const writes = [];
  page.on('pageerror', error => errors.push(error.message));
  const volunteers=await volunteerFixture({authenticate:async()=>({user:staff,csrfToken:'s'.repeat(43)})});
  const tasks = createOrganizerTasksApi({authenticate:async()=>({user:staff}), getSources:async()=>({contacts:[],contactRevision:0,content,contentRevision:0,intent:null}), now:()=>Date.parse('2026-10-21T01:00:00Z')});
  await context.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url()), path = url.pathname;
    assert.equal(url.origin, SITE, 'requests must remain on the intercepted synthetic origin');
    if (path.startsWith('/api/')) {
      if (request.method() !== 'GET') {
        writes.push(path);
        assert.equal(path, '/api/admin/logout', 'navigation must never save, publish or send');
      }
      if(path.startsWith('/api/admin/volunteers')){const result=await volunteers.api(new Request(request.url()));return route.fulfill({status:result.status,headers:Object.fromEntries(result.headers),body:Buffer.from(await result.arrayBuffer())});}
      if (path === '/api/admin/session') return route.fulfill(authenticated ? json({user:staff,csrfToken:'s'.repeat(43)}) : json({},401));
      if (path === '/api/admin/logout') {authenticated=false;return route.fulfill(json({ok:true}));}
      if (path === '/api/admin/content') return route.fulfill(json({draft:{revision:0,content},published:null}));
      if (path === '/api/admin/arrangements') return route.fulfill(json(buildArrangementOverview({content,contacts:[],contentRevision:0,contactsRevision:0})));
      if(path==='/api/admin/people/relationships')return route.fulfill(json({schemaVersion:1,contentRevision:0,publishedRevision:null,organizations:[],profiles:[],boothOrganizations:[],publicationAttributionUnavailable:false}));
      if(path==='/api/admin/people/candidates')return route.fulfill(json({schemaVersion:1,contactsRevision:0,candidates:url.searchParams.get('id')==='synthetic-navigation-invitee'?[{id:'synthetic-navigation-invitee',name:'合成深链嘉宾',organization:'合成组织',eligible:true}]:[],total:url.searchParams.get('id')==='synthetic-navigation-invitee'?1:0,nextCursor:null}));
      if (path === '/api/admin/contacts') return route.fulfill(json({revision:0,contacts:[]}));
      if (path === '/api/admin/contacts/synthetic-navigation-invitee/guest-prefill') return route.fulfill(json({prefill:{name:'合成深链嘉宾',company:'合成组织',ggjRole:'',contactId:'synthetic-navigation-invitee'},responseStatus:'pending'}));
      if (path === '/api/admin/planning') return route.fulfill(json({content,features:{}}));
      if (path === '/api/admin/tasks') {const result=await tasks(new Request(request.url()));return route.fulfill({status:result.status,headers:Object.fromEntries(result.headers),body:await result.text()});}
      if (path === '/api/admin/registrations') return route.fulfill(json({revision:0,registrations:[],total:0,overallTotal:0,nextCursor:null,stats:{}}));
      if (path === '/api/admin/users') return route.fulfill(json({revision:0,users:[{...staff,username:'synthetic.navigation',active:true,protected:true}]}));
      if (path === '/api/admin/group-invite') return route.fulfill(json({revision:0,configured:false,expired:false,expiresAt:null}));
      if (path === '/api/admin/intent-invitations') return route.fulfill(json({revision:0,conversions:[],invitations:[],email:{ready:false,reason:'EMAIL_NOT_READY'}}));
      if (path === '/api/admin/maintenance') return route.fulfill(json({enabled:false,backup:{available:false}}));
      if (path === '/api/admin/registration-confirmation/settings') return route.fulfill(json({revision:0,automaticEnabled:false,email:{ready:false,missing:['EMAILJS_CONFIRMATION_TEMPLATE_ID']},wallet:{ready:false},counts:{total:0,providerAccepted:0,rejected:0,unknown:0}}));
      if (path === '/api/admin/admissions') return route.fulfill(json({revision:0,settings:{capacity:300,staffReserve:0,waitlistEnabled:true},summary:{capacity:300,staffReserve:0,waitlistEnabled:true,confirmedCount:0,attendeeConfirmedCount:0,crewConfirmedCount:0,waitlistCount:0,remainingPublic:300,remainingTotal:300},people:[],teams:[],auditCount:0}));
      throw new Error('Unimplemented synthetic API: '+path);
    }
    const file = resolve(dist, '.'+(path.endsWith('/') ? path+'index.html' : path));
    assert.ok(file.startsWith(dist+'/'));
    return route.fulfill({status:200,body:await readFile(file),contentType:({html:'text/html',js:'text/javascript',css:'text/css',png:'image/png',jpg:'image/jpeg',svg:'image/svg+xml',webp:'image/webp',woff2:'font/woff2'})[extname(file).slice(1)] || 'application/octet-stream'});
  });
  return {context,page,writes,setAuthenticated:value=>{authenticated=value;}};
}

async function load(f, path, prefix) {
  f.setAuthenticated(false);
  await f.page.goto(SITE+path,{waitUntil:'networkidle'});
  assert.equal(await f.page.locator('[data-staff-navigation]').isVisible(),false,'navigation stays inside the hidden workspace before login');
  f.setAuthenticated(true);
  await f.page.reload({waitUntil:'networkidle'});
  await f.page.locator(`[data-${prefix}-workspace]:visible`).waitFor();
  await f.page.locator('[data-staff-navigation]:visible').waitFor();
}
async function noOverflow(page) {
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true,'navigation must not cause page overflow');
}
async function sectionLink(page, id) {
  const menu=page.locator('[data-staff-navigation-menu]');
  if (!(await menu.evaluate(node=>node.open))) await menu.locator('summary').click();
  await page.locator(`[data-staff-section-link][href="#${id}"]`).click();
  await page.waitForFunction(id=>document.activeElement?.id===id,id);
  try {
    await page.waitForFunction(id=>document.querySelector(`[data-staff-section-link][href="#${id}"]`)?.getAttribute('aria-current')==='location',id,{timeout:2000});
  } catch {
    const state=await page.evaluate(id=>({
      id,width:innerWidth,scrollY,
      current:document.querySelector('[data-staff-section-link][aria-current="location"]')?.hash,
      headings:[...document.querySelectorAll('[data-staff-section-link]')].map(link=>({id:link.hash,top:document.getElementById(link.hash.slice(1))?.getBoundingClientRect().top})),
    }),id);
    throw new Error('Current-section mismatch: '+JSON.stringify(state));
  }
  assert.equal(await page.locator(`[data-staff-section-link][href="#${id}"]`).getAttribute('aria-current'),'location','selected section '+id+' stays current');
  assert.equal(await page.locator('[data-staff-section-link][aria-current="location"]').count(),1);
  assert.equal(await page.locator('#'+id).evaluate(node=>{const bounds=node.getBoundingClientRect();return bounds.top>=0 && bounds.top<innerHeight;}),true,'selected heading is visible');
}

try {
  await mkdir(evidence,{recursive:true});
  const desktop=await fixture(1440);
  await load(desktop,'/admin/','admin');
  const nav=desktop.page.locator('[data-staff-navigation]');
  const menu=desktop.page.locator('[data-staff-navigation-menu]');
  assert.equal(await menu.evaluate(node=>node.open),true);
  const navBounds=await nav.boundingBox(), contentBounds=await desktop.page.locator('#workspace-title').boundingBox();
  assert.ok(navBounds.x+navBounds.width<=contentBounds.x,'desktop navigation occupies the left column');
  for (const id of sections) await sectionLink(desktop.page,id);
  const scrolled=await nav.boundingBox();
  assert.ok(scrolled.y>=0 && scrolled.y<100,'desktop navigation remains visible after long-page section navigation');
  await noOverflow(desktop.page);
  await desktop.page.screenshot({path:resolve(evidence,'admin-navigation-desktop.png')});
  assert.deepEqual(desktop.writes,[]);
  await desktop.page.goto(SITE+'/admin/#organizations-title',{waitUntil:'networkidle'});
  await desktop.page.waitForFunction(()=>document.activeElement?.id==='organizations-title');
  await desktop.page.waitForFunction(()=>document.querySelector('[href="#organizations-title"]')?.getAttribute('aria-current')==='location');
  assert.equal(await desktop.page.locator('[href="#organizations-title"]').getAttribute('aria-current'),'location');
  assert.deepEqual(desktop.writes,[]);
  await desktop.page.locator('[data-admin-logout]').click();
  await desktop.page.locator('[data-admin-login-panel]:visible').waitFor();
  assert.equal(await nav.isVisible(),false);
  await desktop.context.close();
  reports.push({desktopLeftColumn:true,stickyAfterScroll:true,allEightSections:true,headingsReceiveFocus:true,directSectionUrlRestored:true,logoutHidesNavigation:true,noNavigationWrites:true});

  for (const width of [320,390,768,1099]) {
    const f=await fixture(width);await load(f,'/admin/','admin');
    const mobileMenu=f.page.locator('[data-staff-navigation-menu]'),summary=mobileMenu.locator('summary');
    assert.equal(await mobileMenu.evaluate(node=>node.open),false,'mobile starts with a collapsed menu');
    await summary.focus();await f.page.keyboard.press('Enter');
    assert.equal(await mobileMenu.evaluate(node=>node.open),true,'keyboard opens the navigation');
    await f.page.keyboard.press('Escape');
    assert.equal(await mobileMenu.evaluate(node=>node.open),false,'Escape closes the mobile navigation');
    assert.equal(await summary.evaluate(node=>document.activeElement===node),true,'Escape restores focus to the summary');
    await f.page.keyboard.press('Enter');
    await sectionLink(f.page,'organizations-title');
    assert.equal(await mobileMenu.evaluate(node=>node.open),false,'selection closes the mobile navigation');
    const compactBounds=await f.page.locator('[data-staff-navigation]').boundingBox();
    assert.ok(compactBounds.y>=0 && compactBounds.y<100,'compact mobile navigation remains reachable after a section jump');
    await noOverflow(f.page);
    await sectionLink(f.page,'sessions-title');
    const table=f.page.locator('[data-admin-sessions]').locator('..').locator('..');
    if (width<1000) assert.equal(await table.evaluate(node=>node.scrollWidth>node.clientWidth),true,'wide tables keep their own scroll area');
    await noOverflow(f.page);
    if (width===390) {await f.page.evaluate(()=>scrollTo(0,0));await summary.click();await f.page.screenshot({path:resolve(evidence,'admin-navigation-mobile.png')});}
    assert.deepEqual(f.writes,[]);
    await f.context.close();reports.push({width,collapsedByDefault:true,keyboardOpenAndEscape:true,selectionClosesMenu:true,mobileNavigationReachable:true,noPageOverflow:true,tableScrollChecked:width<1000});
  }

  const pages=await fixture(1280);
  for (const [path,prefix] of routes) {
    await load(pages,path,prefix);
    const current=pages.page.locator('[data-staff-navigation] a[aria-current="page"]');
    assert.equal(await current.count(),1);assert.equal(await current.getAttribute('href'),path);
    for (const [destination] of routes) assert.equal(await pages.page.locator(`[data-staff-navigation] a[href="${destination}"]`).count(),1);
    await noOverflow(pages.page);
    await pages.page.locator(`[data-${prefix}-logout]`).click();
    await pages.page.locator(`[data-${prefix}-login-panel]:visible`).waitFor();
    assert.equal(await pages.page.locator('[data-staff-navigation]').isVisible(),false);
  }
  assert.deepEqual(pages.writes,Array(6).fill('/api/admin/logout'));
  await pages.context.close();reports.push({sixWorkspacesLinked:true,currentPageMarked:true,allWorkspacesHideNavigationAtLogout:true});

  const legacy=await fixture(390);legacy.setAuthenticated(true);
  for(const [id,target] of [['delivery-settings-heading','delivery-settings-heading'],['staff-settings-title','group-settings-title']]){
    await legacy.page.goto(SITE+'/admin/registrations/?legacy='+id+'#'+id,{waitUntil:'networkidle'});await legacy.page.locator('[data-review-workspace]:visible').waitFor();
    await legacy.page.waitForFunction(id=>document.activeElement?.id===id,id);assert.equal(await legacy.page.locator('#'+id).count(),1);assert.equal(await legacy.page.locator('a[href="/admin/settings/#'+target+'"]').count(),1);assert.equal(await legacy.page.locator('[data-delivery-settings]').count(),0);assert.equal(await legacy.page.locator('[data-staff-settings]').count(),0);
  }
  assert.deepEqual(legacy.writes,[]);await legacy.context.close();reports.push({legacySettingsAnchorsRemainUseful:true,reviewDoesNotMountSettingsWidgets:true});

  const dirty=await fixture(1280);await load(dirty,'/admin/','admin');
  let dialogCount=0;
  dirty.page.on('dialog',async dialog=>{dialogCount++;assert.equal(dialog.type(),'beforeunload');await dialog.dismiss();});
  await dirty.page.locator('[data-event-form] [name=title]').fill('合成未应用活动名称');
  await sectionLink(dirty.page,'guests-title');
  assert.equal(await dirty.page.locator('[data-event-form] [name=title]').inputValue(),'合成未应用活动名称');
  assert.equal(dialogCount,0,'same-page anchors preserve the dirty form without a leave-page prompt');
  await dirty.page.locator('[data-staff-navigation] a[href="/admin/contacts/"]').click();
  assert.equal(dialogCount,1,'leaving through navigation retains the original unsaved-change guard');
  assert.equal(new URL(dirty.page.url()).pathname,'/admin/');
  assert.deepEqual(dirty.writes,[]);
  await dirty.context.close();reports.push({anchorPreservesUnappliedForm:true,crossPageUnsavedGuardPreserved:true});

  const invitee=await fixture(390);invitee.setAuthenticated(true);
  await invitee.page.goto(SITE+'/admin/#invitee=synthetic-navigation-invitee',{waitUntil:'networkidle'});
  await invitee.page.locator('[data-guest-dialog][open]').waitFor();
  assert.equal(await invitee.page.locator('[data-guest-form] [name=name]').inputValue(),'合成深链嘉宾');
  assert.equal(await invitee.page.locator('[data-guest-dialog]').evaluate(node=>node.contains(document.activeElement)),true,'navigation must not steal focus from the pending private editor');
  assert.equal(await invitee.page.locator('[data-guest-form] [name=publicConsent]').isChecked(),false);
  assert.deepEqual(invitee.writes,[]);
  await invitee.context.close();reports.push({inviteeDeepLinkPreserved:true,privateEditorKeepsFocus:true,noAutomaticSaveOrPublication:true});
  assert.deepEqual(errors,[]);
  console.log(JSON.stringify({reports,pageErrors:errors,syntheticOnly:true},null,2));
} finally {await browser.close();}
