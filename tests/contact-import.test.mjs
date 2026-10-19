import test from 'node:test';
import assert from 'node:assert/strict';
import { WORKBOOK_SOURCE_KEY, importHeaders, importTextHeaders, sourceLabels, parseContactImport } from '../shared/contact-import.mjs';

function fixture(overrides = {}) {
  const row = Array(39).fill(null);
  Object.assign(row, {
    0: 1, 1: '2026-10-19 10:00:00', 2: '90秒', 3: 'private-source', 4: 'private-device', 5: '192.0.2.8',
    6: '合成来宾', 7: '深圳', 8: '合成工作室', 9: '开发者', 10: 'synthetic@example.test', 11: 'synthetic_wechat',
    12: 'https://example.test', 13: 1, 14: 0, 15: 1, 17: 1, 22: 1, 23: 1, 27: 1,
    28: 1, 30: 1, 32: '合成活动经历', 33: 'https://example.test/project', 34: 1, 35: 2,
    36: '站点交流与展示', 37: 2, 38: 1,
  }, overrides);
  return [[...importHeaders], row];
}

test('strict questionnaire import retains independent multi-select identities and original answer codes', () => {
  const { rows, warnings } = parseContactImport(fixture());
  assert.equal(WORKBOOK_SOURCE_KEY, 'wjx-388636468');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].sourceRowId, '1');
  assert.deepEqual(rows[0].categories, ['so', 'prospective_site', 'developer']);
  assert.deepEqual(rows[0].interests, ['site_experience', 'talk', 'exhibition', 'product_demo', 'sponsorship_partnership']);
  assert.equal(rows[0].contactConsentCode, '2');
  assert.equal(rows[0].accommodationIntentCode, '2');
  assert.equal(rows[0].caseLinks, 'https://example.test/project');
  assert.equal(rows[0].website, 'https://example.test');
  assert.equal(rows[0].displayName, '合成来宾');
  assert.equal(sourceLabels.categories.length, 9);
  assert.equal(sourceLabels.interests.length, 10);
  assert.ok(warnings.some((warning) => warning.code === 'verified_answer_legend'));
  assert.equal(rows[0].attendanceIntent, 'expected');
  assert.equal(rows[0].attendanceIntentLabel, '有意参加，预计可以到场');
  assert.equal(rows[0].accommodationIntent, 'not_needed');
  assert.equal(rows[0].contactConsent, 'declined');
  assert.equal(rows[0].contactConsentLabel, '不同意');
  assert.equal(rows[0].futureCooperation, 'interested');
  assert.ok(warnings.some((warning) => warning.code === 'declined_contact_consent'));
  assert.equal(rows[0].rsvpStatus, undefined);
  assert.equal(rows[0].consentAccepted, undefined);
  assert.equal(rows[0].attendanceRegistration, undefined);
});

test('drops irrelevant source metadata and ignores extra columns without copying their contents to diagnostics', () => {
  const matrix = fixture();
  matrix[0].push('unrecognized-column');
  matrix[1].push('private-unrecognized-value');
  const result = parseContactImport(matrix);
  const serialized = JSON.stringify(result);
  assert.ok(!serialized.includes('192.0.2.8'));
  assert.ok(!serialized.includes('private-source'));
  assert.ok(!serialized.includes('private-device'));
  assert.ok(!serialized.includes('private-unrecognized-value'));
  assert.ok(result.warnings.some((warning) => warning.code === 'unknown_columns_ignored'));
});

test('exact headers can be reordered and BOM/outer whitespace is tolerated', () => {
  const matrix = fixture();
  const reordered = matrix.map((line) => [...line].reverse());
  reordered[0][38] = '\uFEFF  序号  ';
  const result = parseContactImport(reordered);
  assert.equal(result.rows[0].sourceRowId, '1');
  assert.equal(result.rows[0].email, 'synthetic@example.test');
});

test('rejects missing or duplicate required headers instead of guessing field positions', () => {
  const missing = fixture();
  missing[0][10] = 'unknown-email-header';
  assert.throws(() => parseContactImport(missing), (error) => error.code === 'missing_header');
  const duplicate = fixture();
  duplicate[0].push(importHeaders[10]);
  assert.throws(() => parseContactImport(duplicate), (error) => error.code === 'duplicate_header');
});

test('numeric WeChat becomes text with a warning and never becomes a phone number', () => {
  const result = parseContactImport(fixture({ 11: 123456789 }));
  assert.equal(result.rows[0].wechat, '123456789');
  assert.equal(result.rows[0].phone, '');
  assert.ok(result.warnings.some((warning) => warning.code === 'numeric_wechat' && warning.count === 1));
});

test('source IDs normalize leading zeros and reject duplicates within one import', () => {
  const matrix = fixture({ 0: '001' });
  matrix.push([...matrix[1]]);
  matrix[2][0] = 1;
  assert.throws(() => parseContactImport(matrix), (error) => error.code === 'duplicate_source_id' && error.row === 3);
  assert.throws(() => parseContactImport(fixture({ 0: '=1+1' })), (error) => error.code === 'invalid_source_id');
});

test('selection flags are strict, blank is false, and source errors never echo cell values', () => {
  const matrix = fixture({ 13: 'sensitive-invalid-value' });
  assert.throws(() => parseContactImport(matrix), (error) => error.code === 'invalid_selection_code' && error.row === 2 && error.column === 14 && !error.message.includes('sensitive-invalid-value'));
  const result = parseContactImport(fixture({ 13: null, 15: 0, 17: false, 23: '1' }));
  assert.deepEqual(result.rows[0].categories, []);
  assert.ok(result.warnings.some((warning) => warning.code === 'no_category'));
});

test('blank lines are skipped, bounded input and missing contact are rejected', () => {
  const matrix = fixture();
  matrix.push([]);
  const result = parseContactImport(matrix);
  assert.equal(result.rows.length, 1);
  assert.ok(result.warnings.some((warning) => warning.code === 'blank_rows_skipped'));
  assert.throws(() => parseContactImport(matrix, { maxRows: 1 }), (error) => error.code === 'too_many_rows');
  assert.throws(() => parseContactImport(fixture({ 10: '', 11: null })), (error) => error.code === 'missing_contact');
  assert.throws(() => parseContactImport([importHeaders]), (error) => error.code === 'no_data_rows');
});

test('untrusted cells stay plain data and never become status or privileged fields', () => {
  const matrix = fixture({ 6: '<img src=x onerror=alert(1)>', 32: '=HYPERLINK("https://example.test", "literal data")', 34: 999, 37: 999 });
  const { rows } = parseContactImport(matrix);
  assert.equal(rows[0].name, '<img src=x onerror=alert(1)>');
  assert.ok(rows[0].background.startsWith('='));
  assert.equal(rows[0].contactConsentCode, '999');
  assert.equal(rows[0].isAdmin, undefined);
  assert.equal(rows[0].published, undefined);
});

test('known optional export blank markers become empty but arbitrary source text is retained', () => {
  const empty = parseContactImport(fixture({ 12: '(空)', 33: '（跳过）' })).rows[0];
  assert.equal(empty.website, '');
  assert.equal(empty.caseLinks, '');
  const retained = parseContactImport(fixture({ 12: '无', 33: '可联系后提供' })).rows[0];
  assert.equal(retained.website, '无');
  assert.equal(retained.caseLinks, '可联系后提供');
});

function textFixture() {
  const row = fixture()[1];
  return [[...importTextHeaders], [
    ...row.slice(0, 13),
    'GGJ 站点组织者 (SO，现任或曾任）┋有意筹建GGJ新站点┋游戏开发者',
    'GGJ站点经验交流┋主题演讲┋展示展位┋产品体验┋赞助或生态合作',
    '合成活动经历', 'https://example.test/project',
    '有意参加，预计可以到场', '不需要，我将自行安排住宿',
    '站点交流与展示', '不同意', '同意',
  ]];
}

test('verified numeric and text exports produce identical canonical profiles and stable identity', () => {
  const numeric = parseContactImport(fixture());
  const text = parseContactImport(textFixture());
  assert.deepEqual(text.rows, numeric.rows);
  assert.equal(text.rows[0].contactConsent, 'declined');
  assert.equal(text.rows[0].contactConsentCode, '2');
  assert.equal(text.rows[0].attendanceIntent, 'expected');
  assert.equal(text.rows[0].responseStatus, undefined);
  assert.equal(text.rows[0].invitationStatus, undefined);
});

test('text format supports reordered headers and does not copy irrelevant source metadata', () => {
  const matrix = textFixture().map((line) => [...line].reverse());
  const parsed = parseContactImport(matrix);
  assert.deepEqual(parsed.rows, parseContactImport(fixture()).rows);
  assert.ok(!JSON.stringify(parsed).includes('192.0.2.8'));
});

test('text choices reject unverified labels and duplicate multiselect options without guessing', () => {
  const unknown = textFixture();
  unknown[1][20] = 'synthetic-unverified-consent';
  assert.throws(() => parseContactImport(unknown), (error) => error.code === 'unknown_answer_label' && error.column === 21 && !error.message.includes('synthetic-unverified-consent'));
  const duplicate = textFixture();
  duplicate[1][13] = '游戏开发者┋游戏开发者';
  assert.throws(() => parseContactImport(duplicate), (error) => error.code === 'unknown_selection_label');
  const missing = textFixture();
  missing[0][13] = 'unknown-role-header';
  assert.throws(() => parseContactImport(missing), (error) => error.code === 'missing_header');
});

test('unknown numeric choice codes remain unknown and cannot establish consent', () => {
  const parsed = parseContactImport(fixture({ 34: 999, 37: 999 }));
  assert.equal(parsed.rows[0].attendanceIntentCode, '999');
  assert.equal(parsed.rows[0].attendanceIntent, 'unknown');
  assert.equal(parsed.rows[0].attendanceIntentLabel, '');
  assert.equal(parsed.rows[0].contactConsent, 'unknown');
  assert.ok(parsed.warnings.some((warning) => warning.code === 'unknown_contact_consent'));
  assert.throws(() => parseContactImport(fixture({ 37: '__proto__' })), (error) => error.code === 'invalid_answer_code');
});

test('blank text consent remains unknown; verified yes is scoped historical consent only', () => {
  const matrix = textFixture();
  matrix[1][20] = '';
  const blank = parseContactImport(matrix);
  assert.equal(blank.rows[0].contactConsent, 'unknown');
  assert.equal(blank.rows[0].contactConsentCode, '');
  matrix[1][20] = '同意';
  const yes = parseContactImport(matrix);
  assert.equal(yes.rows[0].contactConsent, 'consented');
  assert.equal(yes.rows[0].contactConsentCode, '1');
  assert.equal(yes.rows[0].responseStatus, undefined);
});
