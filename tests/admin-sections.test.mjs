import test from 'node:test';
import assert from 'node:assert/strict';
import {CLOUD_ADMIN_PAGE_ALIASES} from '../functions/cloud-content/http-server.mjs';
import {PUBLIC_ADMIN_PAGE_ALIASES} from '../scripts/prepare-oss-site.mjs';
import {CONTENT_PAGES,SETTINGS_PAGES,resolveContentPage,resolveSettingsPage,contentPageHref,settingsPageHref} from '../src/lib/admin-sections.mjs';

test('independent content and settings routes round-trip through one pure route contract',()=>{
  assert.deepEqual(CONTENT_PAGES.map(page=>page.key),['overview','event','arrangements','guests','organizations','showcases','sessions','booths','publish']);
  assert.deepEqual(SETTINGS_PAGES.map(page=>page.key),['delivery','group','invitations','accounts']);
  for(const page of CONTENT_PAGES){assert.equal(contentPageHref(page.key),page.href);assert.equal(resolveContentPage(page.href),page.key);assert.equal(resolveContentPage(page.href.slice(0,-1)),page.key);}
  for(const page of SETTINGS_PAGES){assert.equal(settingsPageHref(page.key),page.href);assert.equal(resolveSettingsPage(page.href),page.key);}
  assert.equal(resolveContentPage('/admin/'),'overview');assert.equal(resolveSettingsPage('/admin/settings'),'overview');assert.equal(settingsPageHref('overview'),'/admin/settings/');
});
test('legacy content headings and stable entity fragments resolve to their owning page',()=>{
  for(const page of CONTENT_PAGES)assert.equal(resolveContentPage('/admin/','#'+page.headingId),page.key);
  for(const[fragment,key]of[['invitee=contact_1','guests'],['guest=guest_1','guests'],['organization=org_1','organizations'],['booth=booth_1','booths'],['session=session_1','sessions'],['showcase=showcase_1','showcases']])assert.equal(resolveContentPage('/admin/content/event/','#'+fragment),key);
  assert.equal(resolveContentPage('/admin/content/booths/','#booth='),'booths');
  assert.equal(resolveContentPage('/admin/','#organization='+ 'x'.repeat(101)),'overview');
});
test('legacy Wallet and group anchors stay compatible with independent settings pages',()=>{
  for(const[hash,key]of[['#wallet-settings-title','delivery'],['#delivery-settings-heading','delivery'],['#staff-settings-title','group'],['#group-settings-title','group'],['#invitation-settings-title','invitations'],['#staff-accounts-title','accounts'],['#settings-workspace-title','overview']])assert.equal(resolveSettingsPage('/admin/settings/',hash),key);
  assert.equal(resolveSettingsPage('/admin/settings/group/','#unknown'),'group');
});
test('unrecognized or cross-workspace paths cannot become a content/settings route through a fragment',()=>{
  for(const path of['/admin/content/unknown/','/admin/content/guests/?token=x','/admin/content/../guests/','//admin/','/admin/contacts/','https://untrusted.invalid/admin/'])assert.equal(resolveContentPage(path,'#guests-title'),null);
  assert.equal(resolveSettingsPage('/admin/content/event/','#staff-accounts-title'),null);assert.equal(resolveContentPage('/admin/settings/','#event-editor-title'),null);
  for(const key of['unknown','../guests',' guests ',null,{}]){assert.throws(()=>contentPageHref(key),TypeError);assert.throws(()=>settingsPageHref(key),TypeError);}
});

test('client pages, verified cloud HTML aliases and public entrance notices have identical route coverage',()=>{
  const client=[...CONTENT_PAGES,...SETTINGS_PAGES].map(page=>page.href).sort();
  assert.equal(new Set(client).size,13);
  assert.deepEqual(CLOUD_ADMIN_PAGE_ALIASES.map(([path])=>path).sort(),client);
  assert.deepEqual([...PUBLIC_ADMIN_PAGE_ALIASES].sort(),client);
  for(const[path,target]of CLOUD_ADMIN_PAGE_ALIASES)assert.equal(target,path.startsWith('/admin/content/')?'/admin/':'/admin/settings/');
});
