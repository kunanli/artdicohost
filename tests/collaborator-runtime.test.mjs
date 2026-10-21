import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { peopleRuntimeFixture } from './helpers/people-runtime-fixture.mjs';

const roles = ['editor', 'publisher', 'outreach', 'reviewer'];
const password = 'synthetic-collaborator-password-only';
const operationId = () => randomBytes(32).toString('base64url');

test('two private collaborator accounts can run the event across instances while only the administrator manages accounts', async () => {
  const f = await peopleRuntimeFixture();
  const owner = await f.login();
  const secondInstance = f.make();
  await f.seedPublic({intake:'general-v2', name:'合成协作者导出验证'});
  const accounts = [];
  for (const username of ['synthetic-collaborator-one', 'synthetic-collaborator-two']) {
    const before = await f.app.userStore.list();
    const response = await f.app.handle(f.request('/api/admin/users', {method:'POST', headers:owner, body:{
      expectedRevision:before.revision, username, label:username, roles, password, active:true,
    }}));
    assert.equal(response.status, 200);
    const directory = await response.json();
    assert.equal(directory.revision, before.revision + 1);
    const matching = directory.users.filter(user => user.username === username);
    assert.equal(matching.length, 1);
    assert.deepEqual(matching[0].roles, roles);
    assert.equal(matching[0].protected, false);
    assert.equal(matching[0].active, true);
    assert.equal(JSON.stringify(directory).includes(password), false);
    assert.equal(JSON.stringify(directory).includes('passwordHash'), false);
    const loggedIn = await secondInstance.handle(f.request('/api/admin/login', {method:'POST', body:{username, password}}));
    assert.equal(loggedIn.status, 200);
    const session = await loggedIn.json();
    const headers = {Cookie:loggedIn.headers.get('set-cookie').split(';')[0], 'X-CSRF-Token':session.csrfToken};
    accounts.push({...matching[0], headers});

    for (const path of ['/api/admin/content', '/api/admin/contacts', '/api/admin/registrations',
      '/api/admin/volunteers', '/api/admin/admissions', '/api/admin/group-invite', '/api/admin/registration-confirmation/settings']) {
      const read = await secondInstance.handle(f.request(path, {headers}));
      assert.equal(read.status, 200, username + ' reads ' + path);
    }
    for (const path of ['/api/admin/users', '/api/admin/maintenance']) {
      const read = await secondInstance.handle(f.request(path, {headers}));
      assert.equal(read.status, 403, 'event access does not grant account or recovery access');
    }
    const denied = await secondInstance.handle(f.request('/api/admin/users', {method:'POST', headers, body:{
      expectedRevision:directory.revision, id:accounts[0].id, active:false,
    }}));
    assert.equal(denied.status, 403);

    const contentResponse = await secondInstance.handle(f.request('/api/admin/content', {headers}));
    const {draft} = await contentResponse.json();
    draft.content.event.presentation.heroDescription = '合成协作者独立编辑 ' + username;
    const saved = await secondInstance.handle(f.request('/api/admin/content', {method:'PUT', headers, body:{
      expectedRevision:draft.revision, content:draft.content,
    }}));
    assert.equal(saved.status, 200);
    const savedContent = await saved.json();
    const published = await secondInstance.handle(f.request('/api/admin/content/publish', {method:'POST', headers, body:{expectedRevision:savedContent.draft.revision}}));
    assert.equal(published.status, 200);

    const admissionResponse = await secondInstance.handle(f.request('/api/admin/admissions', {headers}));
    const admission = await admissionResponse.json();
    const settings = await secondInstance.handle(f.request('/api/admin/admissions/settings', {method:'PUT', headers, body:{
      expectedRevision:admission.revision, operationId:operationId(), settings:{staffReserve:0, waitlistEnabled:true},
    }}));
    assert.equal(settings.status, 200);
    const mailResponse = await secondInstance.handle(f.request('/api/admin/registration-confirmation/settings', {headers}));
    const mail = await mailResponse.json();
    const mailSaved = await secondInstance.handle(f.request('/api/admin/registration-confirmation/settings', {method:'PUT', headers, body:{
      expectedRevision:mail.revision, operationId:operationId(), enabled:false,
    }}));
    assert.equal(mailSaved.status, 200);
    const list = await secondInstance.handle(f.request('/api/admin/registrations', {headers}));
    const review = await list.json();
    const workbook = await secondInstance.handle(f.request('/api/admin/registrations/export.xlsx', {method:'POST', headers, body:{
      expectedRevision:review.revision, filters:{}, includeContact:true, includeAnswers:true, includeArrangements:true,
    }}));
    assert.equal(workbook.status, 200, 'full event collaborators can export the authorized registration workbook');
    assert.match(workbook.headers.get('content-type'), /spreadsheetml/u);
    assert.equal(Buffer.from(await workbook.arrayBuffer()).subarray(0,2).toString(), 'PK');
  }
  assert.notEqual(accounts[0].id, accounts[1].id);
  const beforeDeactivation = await f.app.userStore.list();
  const deactivated = await f.app.handle(f.request('/api/admin/users', {method:'POST', headers:owner, body:{
    expectedRevision:beforeDeactivation.revision, id:accounts[0].id, active:false,
  }}));
  assert.equal(deactivated.status, 200);
  assert.equal((await secondInstance.handle(f.request('/api/admin/session', {headers:accounts[0].headers}))).status, 401);
  assert.equal((await secondInstance.handle(f.request('/api/admin/session', {headers:accounts[1].headers}))).status, 200);
  const current = await f.app.store.read();
  assert.equal(current.draft.content.event.presentation.heroDescription, '合成协作者独立编辑 synthetic-collaborator-two');
  assert.equal(current.published.content.event.presentation.heroDescription, current.draft.content.event.presentation.heroDescription);
  assert.equal((await f.app.userStore.list()).users.some(user => user.id === accounts[0].id && user.active === false), true);
  assert.equal(f.messages.length, 0);
});
