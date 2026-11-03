import test from 'node:test';
import assert from 'node:assert/strict';
import { crc32 } from 'node:zlib';
import readWorkbook, { readSheet } from 'read-excel-file/universal';
import { createXlsxWorkbook } from '../shared/xlsx-workbook.mjs';
import { HUODONGXING_IMPORT_HEADERS as HEADERS, huodongxingReadOptions, parseHuodongxingImport } from '../shared/contact-import.mjs';
import { HUODONGXING_TICKET_FIELDS, validateHuodongxingTicketRow } from '../shared/contacts-schema.mjs';

function matrix(patch = {}) {
  const row = ['0000000000000000000001', '000101', '000202', '合成免费票', '0', '2026-12-05', '合成报名者',
    ' SYNTHETIC@EXAMPLE.INVALID ', '00123456789', '2026-11-03 09:15:00', '', '报名成功', 'PRIVATE_METHOD',
    'PRIVATE_REMARK_1\n下一行', 'PRIVATE_REMARK_2', 'PRIVATE_REMARK_3', 'PRIVATE_ALERT', 'PRIVATE_INTEREST', '000_synthetic_wechat'];
  Object.assign(row, patch); return [[...HEADERS], row];
}
const code = expected => error => error?.name === 'ContactImportError' && error.code === expected && !/PRIVATE_|EXAMPLE|000101/u.test(error.message);

test('ticket parser preserves exact text identities and emits only the eleven necessary shared contract fields', () => {
  const input = matrix(), before = structuredClone(input), result = parseHuodongxingImport(input), row = result.rows[0];
  assert.deepEqual(input, before); assert.deepEqual(Object.keys(row).sort(), [...HUODONGXING_TICKET_FIELDS].sort());
  assert.equal(row.tid, input[1][0]); assert.equal(row.registrationNumber, '000101'); assert.equal(row.orderNumber, '000202');
  assert.equal(row.phone, '00123456789'); assert.equal(row.wechat, '000_synthetic_wechat'); assert.equal(row.email, 'synthetic@example.invalid');
  assert.equal(row.registeredAt, '2026-11-03 09:15:00'); assert.equal(row.sourceRow, 2); assert.equal(validateHuodongxingTicketRow(row).valid, true);
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE_|票价|票种|场次日期/u);
  assert.deepEqual(result.warnings.map(item => item.code), ['staff_normalized_source']);
  assert.equal(row.contactConsent, undefined); assert.equal(row.admissionStatus, undefined); assert.equal(row.checkedInAt, undefined);
});

test('exact nineteen headers can be reordered and use a BOM or outer whitespace without guessing aliases', () => {
  const original = matrix(), input = original.map(row => [...row].reverse()); input[0][18] = '\uFEFF  TID  ';
  assert.deepEqual(parseHuodongxingImport(input).rows, parseHuodongxingImport(original).rows);
  const wrong = matrix(); wrong[0][7] = '邮箱'; assert.throws(() => parseHuodongxingImport(wrong), code('unknown_header'));
});

test('missing, duplicate, non-text and extra headers fail before interpreting identities', () => {
  const missing = matrix(); missing[0].pop(); assert.throws(() => parseHuodongxingImport(missing), code('missing_header'));
  const duplicate = matrix(); duplicate[0][1] = 'TID'; assert.throws(() => parseHuodongxingImport(duplicate), code('duplicate_header'));
  const numeric = matrix(); numeric[0][0] = 123; assert.throws(() => parseHuodongxingImport(numeric), code('invalid_header'));
  const extra = matrix(); extra[0].push('private-extra'); assert.throws(() => parseHuodongxingImport(extra), code('invalid_row'));
});

test('numeric ticket, registration, order, phone and WeChat identifiers are rejected without precision or prefix reconstruction', () => {
  for (const column of [0, 1, 2, 8, 18]) for (const numeric of [123, 9007199254740992, huodongxingReadOptions.parseNumber('000123456789123456789')]) {
    const input = matrix({ [column]: numeric });
    assert.throws(() => parseHuodongxingImport(input), error => code('numeric_ticket_identity')(error) && error.row === 2 && error.column === column + 1);
  }
  const reordered = matrix().map(row => [...row].reverse()); reordered[1][18] = 123;
  assert.throws(() => parseHuodongxingImport(reordered), error => code('numeric_ticket_identity')(error) && error.column === 19);
});

test('Date cells retain local wall-clock calendar fields while dates in identity fields and unstyled date numbers fail', () => {
  const date = new Date('2026-11-03T09:15:22.000Z'), rows = parseHuodongxingImport(matrix({ 9: date, 10: date })).rows;
  assert.equal(rows[0].registeredAt, '2026-11-03 09:15:22'); assert.equal(rows[0].lastVerifiedAt, '2026-11-03 09:15:22');
  assert.doesNotMatch(rows[0].registeredAt, /Z|[+-]08:00/u);
  assert.throws(() => parseHuodongxingImport(matrix({ 9: new Date(NaN) })), code('invalid_date'));
  assert.throws(() => parseHuodongxingImport(matrix({ 0: date })), code('invalid_cell_type'));
  assert.throws(() => parseHuodongxingImport(matrix({ 9: huodongxingReadOptions.parseNumber('45678') })), code('invalid_cell_type'));
});

test('missing reviewable fields and unknown, cancelled or checked platform states remain source facts, never a fabricated admission', () => {
  for (const status of ['', '已取消', '已退票', '合成未知状态']) {
    const row = parseHuodongxingImport(matrix({ 6: '', 7: '', 9: '', 10: '2026-11-03 10:00:00', 11: status, 18: null })).rows[0];
    assert.equal(row.name, ''); assert.equal(row.email, ''); assert.equal(row.registeredAt, ''); assert.equal(row.wechat, '');
    assert.equal(row.status, status); assert.equal(row.lastVerifiedAt, '2026-11-03 10:00:00'); assert.equal(Object.hasOwn(row, 'checkedInAt'), false);
  }
});

test('duplicate TIDs, missing TIDs and malformed retained values fail with source coordinates but no private values in errors', () => {
  const duplicate = matrix(); duplicate.push([...duplicate[1]]); assert.throws(() => parseHuodongxingImport(duplicate), error => code('duplicate_ticket_id')(error) && error.row === 3);
  for (const patch of [{ 0: '' }, { 0: 'two ids' }, { 6: 'x'.repeat(81) }, { 7: 'PRIVATE_BAD_EMAIL' }, { 8: 'PRIVATE_\u0000_PHONE' }, { 11: 'bad\nstate' }]) {
    assert.throws(() => parseHuodongxingImport(matrix(patch)), error => error?.name === 'ContactImportError' && error.row === 2 && !/PRIVATE_|BAD_EMAIL/u.test(error.message));
  }
});

test('formula and unknown object wrappers, booleans in retained cells and accessors cannot be coerced into accepted text', () => {
  for (const value of [{ formula: '1+1', value: 'cached' }, { f: '1+1', v: 'cached' }, ['nested'], true, Infinity, { type: 'number', value: 'not numeric' }]) {
    assert.throws(() => parseHuodongxingImport(matrix({ 0: value })), code('invalid_cell_type'));
  }
  assert.throws(() => parseHuodongxingImport(matrix({ 13: { formula: '1+1', value: 'cached' } })), code('invalid_cell_type'));
  let invoked = 0; const input = matrix(); Object.defineProperty(input[1], '0', { enumerable: true, get() { invoked++; return 'unsafe'; } });
  assert.throws(() => parseHuodongxingImport(input), code('invalid_row')); assert.equal(invoked, 0);
  const wrapper = { type: 'number' }; Object.defineProperty(wrapper, 'value', { enumerable: true, get() { invoked++; return 'unsafe'; } });
  assert.throws(() => parseHuodongxingImport(matrix({ 0: wrapper })), code('invalid_cell_type')); assert.equal(invoked, 0);
});

test('trailing blank rows are skipped without renumbering real source rows, and unsupported table size or shape fails', () => {
  const input = matrix(); input.splice(1, 0, Array(19).fill(null)); input.push(...Array.from({ length: 4000 }, () => Array(19).fill(null)));
  const result = parseHuodongxingImport(input); assert.equal(result.rows[0].sourceRow, 3); assert.equal(result.warnings.find(item => item.code === 'blank_rows_skipped').count, 4001);
  for (const invalid of [[], [[]], [[...HEADERS]], [[...HEADERS], Array(19).fill(null)], [[...HEADERS], {}]]) assert.throws(() => parseHuodongxingImport(invalid));
  const overflow = matrix(); overflow[1].push('unused extra'); assert.throws(() => parseHuodongxingImport(overflow), code('invalid_row'));
  assert.throws(() => parseHuodongxingImport(Array(10002).fill([])), code('invalid_row'));
});

test('exact physical-row boundary accepts 500 original data rows and rejects a later source coordinate', () => {
  const input = [[...HEADERS], ...Array.from({ length: 500 }, (_, index) => { const row = matrix()[1]; row[0] += String(index); return row; })];
  const result = parseHuodongxingImport(input); assert.equal(result.rows.length, 500); assert.equal(result.rows.at(-1).sourceRow, 501);
  input.push(matrix({ 0: 'another-synthetic-ticket' })[1]); assert.throws(() => parseHuodongxingImport(input), code('too_many_rows'));
});

function storedFiles(input) {
  const data = Buffer.from(input), files = []; let offset = 0;
  while (data.readUInt32LE(offset) === 0x04034b50) {
    assert.equal(data.readUInt16LE(offset + 8), 0); const length = data.readUInt32LE(offset + 18), names = data.readUInt16LE(offset + 26), extra = data.readUInt16LE(offset + 28);
    const start = offset + 30 + names + extra; files.push([data.subarray(offset + 30, offset + 30 + names).toString(), data.subarray(start, start + length).toString()]); offset = start + length;
  }
  return files;
}
function zip(files) {
  const local = [], central = []; let offset = 0;
  for (const [path, text] of files) {
    const name = Buffer.from(path), data = Buffer.from(text), hash = crc32(data), header = Buffer.alloc(30), directory = Buffer.alloc(46);
    header.writeUInt32LE(0x04034b50); header.writeUInt16LE(20, 4); header.writeUInt16LE(0x800, 6); header.writeUInt32LE(hash, 14); header.writeUInt32LE(data.length, 18); header.writeUInt32LE(data.length, 22); header.writeUInt16LE(name.length, 26);
    directory.writeUInt32LE(0x02014b50); directory.writeUInt16LE(20, 4); directory.writeUInt16LE(20, 6); directory.writeUInt16LE(0x800, 8); directory.writeUInt32LE(hash, 16); directory.writeUInt32LE(data.length, 20); directory.writeUInt32LE(data.length, 24); directory.writeUInt16LE(name.length, 28); directory.writeUInt32LE(offset, 42);
    local.push(header, name, data); central.push(directory, name); offset += header.length + name.length + data.length;
  }
  const c = Buffer.concat(central), end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10); end.writeUInt32LE(c.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, c, end]);
}
const workbook = () => createXlsxWorkbook([{ name: 'Synthetic tickets', headers: [...HEADERS], rows: [matrix()[1]] }]);

test('real readSheet universal API round-trips genuine synthetic XLSX and preserves leading zeros with the exported options', async () => {
  const bytes = workbook(), input = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  const sheets = await readWorkbook(input, huodongxingReadOptions); assert.equal(sheets.length, 1); assert.equal(sheets[0].sheet, 'Synthetic tickets');
  const values = await readSheet(input, huodongxingReadOptions); assert.deepEqual(parseHuodongxingImport(values).rows, parseHuodongxingImport(matrix()).rows);
  const numeric = zip(storedFiles(bytes).map(([path, text]) => [path, path === 'xl/worksheets/sheet1.xml' ? text.replace(/<c r="A2"[^>]*>.*?<\/c>/u, '<c r="A2"><v>123456789012345678901</v></c>') : text]));
  const read = await readSheet(numeric.buffer.slice(numeric.byteOffset, numeric.byteOffset + numeric.byteLength), huodongxingReadOptions);
  assert.deepEqual(read[1][0], { type: 'number', value: '123456789012345678901' }); assert.throws(() => parseHuodongxingImport(read), code('numeric_ticket_identity'));
});

test('real cached-formula results demonstrate the controlled staff-review limitation without claiming formula provenance is verified', async () => {
  const bytes = zip(storedFiles(workbook()).map(([path, text]) => [path, path === 'xl/worksheets/sheet1.xml' ? text.replace(/<c r="G2"[^>]*>.*?<\/c>/u, '<c r="G2" t="str"><f>CONCAT(&quot;Synthetic&quot;,&quot; cached name&quot;)</f><v>Synthetic cached name</v></c>') : text]));
  const read = await readSheet(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), huodongxingReadOptions); assert.equal(read[1][6], 'Synthetic cached name');
  const result = parseHuodongxingImport(read); assert.equal(result.rows[0].name, 'Synthetic cached name'); assert.ok(result.warnings.some(item => item.code === 'staff_normalized_source'));
  assert.equal(result.formulaVerified, undefined); assert.equal(result.platformVerified, undefined);
});
