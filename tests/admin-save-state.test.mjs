import test from 'node:test';
import assert from 'node:assert/strict';
import { createInitialContent } from '../src/config/content.mjs';
import { validateContent } from '../shared/content-schema.mjs';
import { contentSaveSnapshot, confirmedContentSave, inspectContentSave, sameContent, contentSaveUiState } from '../src/lib/admin-save-state.mjs';

function fixture() {
  const content = createInitialContent();
  content.booths.push({ id: 'synthetic-booth', code: 'C-01', zone: 'C', slotNumber: 1, organization: '合成机构', project: '合成作品', status: 'confirmed',
    description: '合成互动展示', website: 'https://example.invalid/', contactName: '合成负责人', contactMethods: 'synthetic@example.invalid', internalNotes: '合成内部备注' });
  content.guests.push({ id: 'synthetic-guest', name: '合成人员', company: '合成机构', ggjRole: '', portraitId: '', contactId: '', status: 'pending', publicConsent: false,
    title: '合成职务', bio: '合成简介', website: 'https://example.invalid/guest', publicRoles: ['speaker'], internalNotes: '合成人物备注' });
  assert.equal(validateContent(content).valid, true);
  return content;
}
const state = extra => contentSaveUiState({ loaded: true, canEdit: true, dirty: true, busy: false, saving: false, outcome: 'loaded', revision: 3, confirmedRevision: null, ...extra });

test('save snapshot captures full normalized content without sharing subsequent local edits', () => {
  const content = fixture(); content.booths[0].organization = '  合成机构  ';
  const submitted = contentSaveSnapshot(3, content);
  assert.equal(submitted.content.booths[0].organization, '合成机构');
  content.booths[0].contactMethods = 'changed@example.invalid';
  assert.equal(submitted.content.booths[0].contactMethods, 'synthetic@example.invalid');
  assert.deepEqual(Object.keys(submitted), ['expectedRevision', 'content']);
  for (const revision of [-1, 0.5, Number.MAX_SAFE_INTEGER, '3']) assert.equal(contentSaveSnapshot(revision, content), null);
  assert.equal(contentSaveSnapshot(3, {}), null);
});

test('only exact next-revision, fully validated ACK confirms saving; published is not required', () => {
  const submitted = contentSaveSnapshot(3, fixture()), response = { draft: { revision: 4, content: structuredClone(submitted.content) } };
  assert.equal(confirmedContentSave(response, submitted).revision, 4);
  response.draft.content.booths[0].organization = '  合成机构  ';
  assert.ok(confirmedContentSave(response, submitted), 'normalization follows the same contract as the store');
  for (const invalid of [{}, { draft: null }, { draft: { revision: 3, content: submitted.content } }, { draft: { revision: 5, content: submitted.content } }, { draft: { revision: 4, content: {} } }]) assert.equal(confirmedContentSave(invalid, submitted), null);
});

test('partial successful bodies cannot silently lose private booth contacts or optional guest fields', () => {
  const submitted = contentSaveSnapshot(3, fixture());
  for (const change of [content => delete content.booths[0].contactMethods, content => delete content.booths[0].description, content => delete content.guests[0].bio, content => content.guests[0].publicRoles = [], content => content.eventId = 'different-event']) {
    const content = structuredClone(submitted.content); change(content);
    assert.equal(confirmedContentSave({ draft: { revision: 4, content } }, submitted), null);
  }
});

test('readback confirms current matching cloud content, never a changed or stale revision', () => {
  const submitted = contentSaveSnapshot(3, fixture());
  for (const revision of [4, 6]) { const proof = inspectContentSave({ draft: { revision, content: submitted.content } }, submitted); assert.equal(proof.state, 'confirmed'); assert.equal(proof.draft.revision, revision); }
  assert.deepEqual(inspectContentSave({ draft: { revision: 3, content: submitted.content } }, submitted), { state: 'retryable', draft: null });
  assert.deepEqual(inspectContentSave({ draft: { revision: 2, content: submitted.content } }, submitted), { state: 'unconfirmed', draft: null });
  const different = structuredClone(submitted.content); different.booths[0].project = '其他工作人员更新';
  assert.deepEqual(inspectContentSave({ draft: { revision: 4, content: different } }, submitted), { state: 'conflict', draft: null });
  assert.deepEqual(inspectContentSave({}, submitted), { state: 'unconfirmed', draft: null });
});

test('content comparison retains full known fields and distinguishes later local edits', () => {
  const content = fixture(), later = structuredClone(content);
  assert.equal(sameContent(content, later), true);
  later.booths[0].contactName = '另一位合成负责人'; assert.equal(sameContent(content, later), false);
  assert.equal(sameContent(content, {}), false);
});

test('unapplied input cannot be saved even if the applied content is already dirty', () => {
  for (const name of ['活动基本资料', '展位编辑', '场次编辑', '嘉宾资料', '学生作品', '组织资料', '总览展位编辑']) {
    const view = state({ unapplied: [name] }); assert.equal(view.state, 'unapplied'); assert.equal(view.canSave, false); assert.match(view.description, new RegExp(name, 'u'));
  }
  assert.equal(state({}).state, 'dirty'); assert.equal(state({}).canSave, true);
});

test('unknown and conflict retain recovery controls without permitting a new save or unauthorized retry', () => {
  for (const outcome of ['unknown', 'conflict']) {
    const view = state({ outcome }); assert.equal(view.state, outcome); assert.equal(view.canSave, false); assert.equal(view.canCheck, true); assert.equal(view.canRetry, false);
    assert.equal(state({ outcome, retryReady: true }).canRetry, true);
    for (const blocked of [{ canEdit: false }, { loaded: false }, { busy: true }, { saving: true }, { unapplied: ['展位编辑'] }]) assert.equal(state({ outcome, retryReady: true, ...blocked }).canRetry, false);
  }
  assert.equal(state({ canEdit: false }).canSave, false); assert.equal(state({ dirty: false }).canSave, false);
});

test('saved is shown only for a confirmed current revision, while newer local changes remain dirty', () => {
  assert.equal(state({ dirty: false }).state, 'loaded');
  assert.equal(state({ dirty: false, outcome: 'saved', confirmedRevision: 3 }).state, 'saved');
  assert.equal(state({ dirty: true, outcome: 'saved', confirmedRevision: 3 }).state, 'dirty');
  assert.equal(state({ saving: true, outcome: 'saving' }).state, 'saving');
  assert.equal(state({ dirty: false, confirmedRevision: 2 }).state, 'loaded');
});
