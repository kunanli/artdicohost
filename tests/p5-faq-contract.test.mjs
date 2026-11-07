import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createInitialContent } from '../src/config/content.mjs';
import { faqItems, PUBLIC_REGISTRATION_URL } from '../src/config/event.mjs';
import { validateContent, toPublicContent, preserveFaqItemIds, legacyFaqId } from '../shared/content-schema.mjs';
import { createFileContentStore } from '../functions/content-api/store.mjs';
import { createOssContentStore } from '../functions/cloud-content/store.mjs';
import { createObjectJournal } from '../functions/cloud-content/object-journal.mjs';
import { memoryObjects } from './helpers/cloud-memory-objects.mjs';
import { contentLocalDraftValue, faqItemsForSave } from '../src/lib/content-local-drafts.mjs';
import { contentSaveSnapshot } from '../src/lib/admin-save-state.mjs';
import { publicFaqItems, setPublicFaqs } from '../src/lib/public-faq.mjs';
import { publicContentEnvelope } from '../src/lib/public-content-refresh.mjs';

const housing = '本次活动提供少量外地来宾住宿支持。有需要的朋友，欢迎提前通过 kunan@globalgamejam.org 联系主办方了解安排；名额有限，住宿安排将另行确认。';
const clock = () => Date.parse('2026-11-01T07:00:00.000Z');
function legacyContent() {
  const content = createInitialContent();
  content.event.presentation.faqItems = faqItems.map(({ question, answer }) => ({ question, answer }));
  return content;
}

test('optional FAQ IDs preserve legacy own-property shape and project only stable IDs and approved text', () => {
  const legacy = legacyContent(), serialized = JSON.stringify(legacy);
  const checked = validateContent(legacy); assert.equal(checked.valid, true, JSON.stringify(checked.errors));
  assert.equal(JSON.stringify(checked.value.event.presentation.faqItems), JSON.stringify(legacy.event.presentation.faqItems));
  assert.equal(JSON.stringify(legacy), serialized);
  assert.ok(toPublicContent(legacy).event.presentation.faqItems.every(item => !Object.hasOwn(item, 'id')));
  legacy.event.presentation.faqItems = [{ id: 'synthetic-question', question: '合成问题', answer: '合成回答', privateNote: 'SYNTHETIC_PRIVATE' }];
  const published = toPublicContent(legacy);
  assert.deepEqual(published.event.presentation.faqItems, [{ id: 'synthetic-question', question: '合成问题', answer: '合成回答' }]);
  assert.doesNotMatch(JSON.stringify(published), /SYNTHETIC_PRIVATE/u);
  for (const id of [null, undefined, '', 'bad id', 'x'.repeat(81), 3]) {
    legacy.event.presentation.faqItems[0].id = id; assert.equal(validateContent(legacy).valid, false);
  }
  legacy.event.presentation.faqItems = [{ id: 'same', question: '合成甲', answer: '合成甲回答' }, { id: 'same', question: '合成乙', answer: '合成乙回答' }];
  assert.equal(validateContent(legacy).valid, false);
});

test('omitted IDs are restored only by an unambiguous exact question, never by index or prefix', () => {
  const previous = [{ id: 'saved-a', question: '合成问题甲', answer: '原回答' }, { id: 'saved-b', question: '合成问题乙', answer: '原回答' }];
  const next = [{ question: '合成问题乙', answer: '新回答乙' }, { question: '合成问题甲', answer: '新回答甲' }], untouched = structuredClone(next);
  assert.deepEqual(preserveFaqItemIds(next, previous).map(item => item.id), ['saved-b', 'saved-a']); assert.deepEqual(next, untouched);
  assert.equal(Object.hasOwn(preserveFaqItemIds([{ question: '合成问题乙（已改名）', answer: '原回答' }], previous)[0], 'id'), false);
  assert.ok(preserveFaqItemIds([{ question: '合成问题甲', answer: '回答一' }, { question: '合成问题甲', answer: '回答二' }], previous).every(item => !Object.hasOwn(item, 'id')));
  assert.equal(legacyFaqId('现在可以报名吗？'), 'registration-status'); assert.equal(legacyFaqId('现在可以报名吗？自订说明'), null);
});

test('explicit save assigns IDs once while raw old drafts and exact pending content remain unchanged', () => {
  const raw = [{ question: '现在可以报名吗？', answer: '合成旧回答' }, { question: '合成自订问题', answer: '' }], before = structuredClone(raw);
  const saved = faqItemsForSave(raw, () => 'faq-synthetic-new');
  assert.deepEqual(saved.map(item => item.id), ['registration-status', 'faq-synthetic-new']); assert.deepEqual(raw, before);
  assert.deepEqual(faqItemsForSave(saved, () => assert.fail('saved IDs must not be regenerated')), saved);
  const content = validateContent(legacyContent()).value;
  const draft = { schemaVersion: 1, roleKey: 'editor', section: 'event', content, forms: { event: { fields: { title: '合成尚未保存' }, faqItems: before } }, pendingSave: null };
  assert.equal(contentLocalDraftValue(draft, { kind: 'editing' }), true);
  draft.forms.event.faqItems = saved;
  assert.equal(contentLocalDraftValue(draft, { kind: 'editing' }), true);
  draft.pendingSave = contentSaveSnapshot(4, content); const encoded = JSON.stringify(draft.pendingSave);
  assert.equal(contentLocalDraftValue(draft, { kind: 'pending_submission' }), true); assert.equal(JSON.stringify(draft.pendingSave), encoded);
  draft.forms.event.faqItems[1].id = saved[0].id; assert.equal(contentLocalDraftValue(draft, { kind: 'pending_submission' }), false);
  const oldRaw = [{ question: '合成自订问题', answer: '恢复后修改的答案' }], stored = [{ id: 'faq-already-saved', question: '合成自订问题', answer: '旧答案' }];
  assert.deepEqual(faqItemsForSave(preserveFaqItemIds(oldRaw, stored), () => assert.fail('old raw answer edits keep their saved ID')),
    [{ id: 'faq-already-saved', question: '合成自订问题', answer: '恢复后修改的答案' }]);
});

test('one public FAQ projection keeps external attendance separate from onsite availability, rights and exact lodging without losing custom entries', () => {
  const input = [{ id: 'registration-status', question: '申请状态更新了吗？', answer: '过期开放声明' },
    { question: '报名成功就有住宿吗？', answer: '过期住宿表单说明' }, { id: 'custom-experience', question: '合成自订问题', answer: '合成自订回答' },
    { question: '现在可以报名吗？自订说明', answer: '这是自订问题，保留原答覆' },
    { id: 'site-role', question: '合成旧站点问题', answer: '合成过期简短指南' }];
  const copy = structuredClone(input), rows = publicFaqItems(input, { availability: { message: '合成申请已关闭' },
    privacy: { rightsRequest: '合成申请更正及撤回方式', contactEmail: 'synthetic.privacy@example.invalid' } });
  assert.equal(rows.find(item => item.id === 'registration-status').answer, faqItems.find(item => item.id === 'registration-status').answer);
  assert.equal(rows.find(item => item.id === 'registration-status').registrationUrl, PUBLIC_REGISTRATION_URL);
  assert.equal(rows.find(item => item.id === 'data-rights').answer, '合成申请更正及撤回方式');
  assert.equal(rows.find(item => item.id === 'data-rights').contactEmail, 'kunan@globalgamejam.org', 'legacy policy and editorial contacts cannot replace the approved public support address');
  assert.equal(rows.find(item => item.id === 'lodging-support').question, '外地来宾有住宿支持吗？');
  assert.equal(rows.find(item => item.id === 'lodging-support').answer, housing); assert.equal(rows.find(item => item.id === 'lodging-support').contactEmail, 'kunan@globalgamejam.org');
  assert.equal(rows.find(item => item.id === 'site-role').question, faqItems.find(item => item.id === 'site-role').question);
  assert.equal(rows.find(item => item.id === 'site-role').registrationUrl, PUBLIC_REGISTRATION_URL);
  assert.doesNotMatch(rows.find(item => item.id === 'site-role').answer, /合成过期/u, 'old published guides use the current complete instructions without rewriting their saved bytes');
  assert.equal(rows.find(item => item.id === 'custom-experience').answer, '合成自订回答');
  assert.equal(rows.find(item => item.question === '现在可以报名吗？自订说明').answer, '这是自订问题，保留原答覆');
  assert.deepEqual(input, copy); assert.equal(new Set(rows.map(item => item.id)).size, rows.length);
  assert.doesNotThrow(() => setPublicFaqs(input), 'frontend helper is safe to import and call without a browser');
});

test('approved external attendance route cannot be replaced by editorial URLs or onsite proposal status', () => {
  assert.equal(PUBLIC_REGISTRATION_URL, 'https://9525102647817.huodongxing.com/event/8884819113200');
  for (const message of ['报名已开放，本站即刻出票', '讲者申请已关闭', '申请服务暂时无法核对']) {
    const rows = publicFaqItems([{ id: 'registration-status', question: '现在可以报名吗？', answer: message,
      registrationUrl: 'https://unapproved.example.invalid/registration' }], { availability: { message } });
    const entry = rows.find(item => item.id === 'registration-status');
    assert.equal(entry.registrationUrl, PUBLIC_REGISTRATION_URL);
    assert.match(entry.answer, /普通参会请前往活动行报名/u);
    assert.match(entry.answer, /讲者分享提案在本站提交/u);
    assert.doesNotMatch(entry.answer, /即刻出票|立即.*Wallet|本站即|服务暂时无法/u);
    assert.deepEqual(rows.filter(item => item.registrationUrl).map(item => item.id), ['registration-status', 'site-role']);
  }
});

test('empty or twenty custom FAQs keep all custom questions plus bounded required service entries', () => {
  assert.deepEqual(publicFaqItems([]).map(item => item.id), ['registration-status', 'data-rights', 'lodging-support', 'site-role']);
  const custom = Array.from({ length: 20 }, (_, index) => ({ id: 'custom-' + index, question: '合成问题' + index, answer: '合成回答' }));
  const rows = publicFaqItems(custom); assert.equal(rows.length, 24); assert.equal(rows.filter(item => item.id.startsWith('custom-')).length, 20);
  const legacy = [{ question: '合成同题', answer: '合成回答' }, { question: '合成同题', answer: '合成回答' }];
  assert.equal(new Set(publicFaqItems(legacy).map(item => item.id)).size, 6);
});

async function fixture(mode, t, initialContent) {
  if (mode === 'file') {
    const directory = await mkdtemp(join(tmpdir(), 'artdico-p5-faq-synthetic-')); t.after(() => rm(directory, { recursive: true, force: true }));
    return { build: () => createFileContentStore({ directory, initialContent, now: clock }), bytes: () => readFile(join(directory, 'content.json'), 'utf8') };
  }
  const objects = memoryObjects();
  return { build: () => createOssContentStore({ journal: createObjectJournal({ objects, prefix: 'cms/v1/content' }), initialContent, now: clock }),
    bytes: async () => JSON.stringify([...objects.files].map(([key, value]) => [key, value.data.toString('base64')])) };
}
for (const mode of ['file', 'cloud']) {
  test(`${mode} old frozen FAQ bytes stay readable and an explicit save adds stable IDs without republishing history`, async t => {
    const f = await fixture(mode, t, legacyContent()), store = f.build(), published = await store.publish(0, 'synthetic-editor'), before = await f.bytes();
    assert.ok(publicContentEnvelope(published)); assert.ok(published.content.event.presentation.faqItems.every(item => !Object.hasOwn(item, 'id')));
    assert.deepEqual((await f.build().read()).published, published); assert.equal(await f.bytes(), before);
    const draft = (await store.read()).draft.content; draft.event.presentation.faqItems = faqItemsForSave(draft.event.presentation.faqItems, () => assert.fail('all old fixed names have stable IDs'));
    const saved = await store.save(0, draft, 'synthetic-editor'); assert.ok(saved.content.event.presentation.faqItems.every(item => item.id));
    assert.deepEqual((await f.build().read()).published, published); assert.equal(saved.content.schemaVersion, 1);
  });

  test(`${mode} legacy FAQ omission and reorder preserve only uniquely matched IDs; rename stays legacy and explicit clearing works`, async t => {
    const content = createInitialContent(); content.event.presentation.faqItems = [{ id: 'custom-a', question: '合成甲', answer: '合成回答甲' }, { id: 'custom-b', question: '合成乙', answer: '合成回答乙' }];
    const f = await fixture(mode, t, content), store = f.build(), draft = (await store.read()).draft.content;
    draft.event.presentation.faqItems = draft.event.presentation.faqItems.toReversed().map(({ question, answer }) => ({ question, answer: answer + '更新' }));
    const saved = await store.save(0, draft, 'synthetic-editor'); assert.deepEqual(saved.content.event.presentation.faqItems.map(item => item.id), ['custom-b', 'custom-a']);
    const rename = structuredClone(saved.content); rename.event.presentation.faqItems[0] = { question: '合成改名', answer: '合成回答' };
    const renamed = await store.save(1, rename, 'synthetic-editor'); assert.equal(Object.hasOwn(renamed.content.event.presentation.faqItems[0], 'id'), false);
    assert.equal(renamed.content.event.presentation.faqItems[1].id, 'custom-a');
    const omission = structuredClone(renamed.content); delete omission.event.presentation.faqItems;
    const preserved = await store.save(2, omission, 'synthetic-editor'); assert.deepEqual(preserved.content.event.presentation.faqItems, renamed.content.event.presentation.faqItems);
    const clear = structuredClone(preserved.content); clear.event.presentation.faqItems = [];
    assert.deepEqual((await store.save(3, clear, 'synthetic-editor')).content.event.presentation.faqItems, []);
  });
}


test('old published on-site guidance uses the organizer-confirmed review copy without changing saved FAQ bytes',()=>{
 const old={id:'site-official',question:'新站点现场咨询代表已通过申请吗？',answer:'合成旧咨询说明'};
 const before=JSON.stringify(old),row=publicFaqItems([old]).find(item=>item.id==='site-official');
 assert.equal(row.question,'现场可以进行 GGJ 站点审核吗？');assert.match(row.answer,/现场可进行 GGJ 站点审核/u);
 assert.equal(JSON.stringify(old),before);
});
