import test from 'node:test';
import assert from 'node:assert/strict';
import { MAX_FC_REQUEST_BYTES, MAX_FC_ZIP_BYTES, fcCodeRequestBytes, assertFcCodeRequestFits } from '../scripts/fc-upload-limits.mjs';

test('code-only request length matches real JSON UTF-8 bytes at each Base64 triplet boundary', () => {
  for (const length of [0, 1, 2, 3, 4, 5, 6, 7, 11, 12, 13, 1023, 1024, 1025]) {
    const body = JSON.stringify({ code: { zipFile: Buffer.alloc(length, 255).toString('base64') } });
    assert.equal(fcCodeRequestBytes(length), Buffer.byteLength(body, 'utf8'));
    assert.equal(assertFcCodeRequestFits(length), Buffer.byteLength(body, 'utf8'));
  }
  assert.deepEqual([0, 1, 2, 3, 4, 5, 6].map(fcCodeRequestBytes), [23, 27, 27, 27, 31, 31, 31]);
});

test('the largest ZIP is derived from the fixed engineering budget and its next byte is refused without allocating it', () => {
  assert.equal(MAX_FC_REQUEST_BYTES, 48_000_000);
  assert.equal(MAX_FC_ZIP_BYTES, 35_999_982);
  assert.equal(assertFcCodeRequestFits(MAX_FC_ZIP_BYTES), 47_999_999);
  assert.equal(fcCodeRequestBytes(MAX_FC_ZIP_BYTES + 1), 48_000_003);
  assert.throws(() => assertFcCodeRequestFits(MAX_FC_ZIP_BYTES + 1), /fixed request budget/u);
  assert.ok(fcCodeRequestBytes(MAX_FC_ZIP_BYTES - 1) <= MAX_FC_REQUEST_BYTES);
});

test('invalid inputs and safe-integer result overflow throw only the fixed error without coercing or allocating data', () => {
  const hostile = { valueOf() { assert.fail('ZIP lengths must not be coerced'); }, toString() { assert.fail('ZIP lengths must not be logged'); } };
  const invalid = [undefined, null, true, false, '', '1', 'PRIVATE-SYNTHETIC-LENGTH', 1n, hostile, [], -1, 0.5, NaN, Infinity, -Infinity, Number.MAX_SAFE_INTEGER + 1, Number.MAX_SAFE_INTEGER];
  for (const operation of [fcCodeRequestBytes, assertFcCodeRequestFits]) for (const value of invalid) {
    assert.throws(() => operation(value), error => {
      assert.equal(error.message, 'FC code upload exceeds its fixed request budget or has an invalid ZIP length');
      assert.equal(Object.hasOwn(error, 'cause'), false);
      return true;
    });
  }
  // Exact arithmetic remains correct near the largest safe request-size result.
  const length = Number(((BigInt(Number.MAX_SAFE_INTEGER) - 23n) / 4n) * 3n);
  assert.equal(fcCodeRequestBytes(length), Number.MAX_SAFE_INTEGER);
  assert.throws(() => fcCodeRequestBytes(length + 1), /fixed request budget/u);
  assert.throws(() => assertFcCodeRequestFits(length), /fixed request budget/u);
});
