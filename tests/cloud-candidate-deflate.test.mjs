import test from 'node:test';
import assert from 'node:assert/strict';
import { crc32, deflateRawSync } from 'node:zlib';
import { candidateSha256, candidateZipEntries } from '../scripts/cloud-content-package.mjs';
import { MAX_FC_ZIP_BYTES, MAX_FC_REQUEST_BYTES, assertFcCodeRequestFits } from '../scripts/fc-upload-limits.mjs';

const MiB = 1024 * 1024;
const text = Buffer.from('Synthetic bounded source text.\n'.repeat(100));
function fixture(specs = [{}]) {
  const locals = [], directories = [], records = [], offsets = []; let cursor = 0;
  for (const spec of specs) {
    const path = spec.path ?? 'release.json', raw = spec.raw ?? text, method = spec.method ?? 8;
    const body = spec.body ?? (method === 8 ? deflateRawSync(raw, { level: 6 }) : raw);
    const record = { path, bytes: spec.bytes ?? raw.length, sha256: spec.sha256 ?? candidateSha256(raw), mode: spec.mode ?? '0644' };
    const name = Buffer.from(path), local = Buffer.alloc(30 + name.length), central = Buffer.alloc(46 + name.length);
    local.writeUInt32LE(0x04034b50); local.writeUInt16LE(20, 4); local.writeUInt16LE(method, 8);
    local.writeUInt32LE(spec.crc ?? crc32(raw), 14); local.writeUInt32LE(body.length, 18); local.writeUInt32LE(record.bytes, 22); local.writeUInt16LE(name.length, 26); name.copy(local, 30);
    central.writeUInt32LE(0x02014b50); central.writeUInt16LE(0x031e, 4); central.writeUInt16LE(20, 6); central.writeUInt16LE(method, 10);
    local.subarray(14, 26).copy(central, 16); central.writeUInt16LE(name.length, 28); central.writeUInt32LE((0o100000 | parseInt(record.mode, 8)) * 65536, 38); central.writeUInt32LE(cursor, 42); name.copy(central, 46);
    offsets.push({ local: cursor, central: 0, start: cursor + local.length }); locals.push(local, body); directories.push(central); records.push(record); cursor += local.length + body.length;
  }
  let centralOffset = cursor;
  directories.forEach((entry, index) => { offsets[index].central = centralOffset; centralOffset += entry.length; });
  const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50); end.writeUInt16LE(records.length, 8); end.writeUInt16LE(records.length, 10); end.writeUInt32LE(centralOffset - cursor, 12); end.writeUInt32LE(cursor, 16);
  return { bytes: Buffer.concat([...locals, ...directories, end]), records, offsets };
}
function inspect(value) { return candidateZipEntries(value.bytes, value.records); }

test('bounded text deflate and legacy stored entries return identical authenticated bytes', () => {
  for (const method of [0, 8]) {
    const value = fixture([{ method }, { path: 'bootstrap', raw: Buffer.from('#!/bin/sh\nexit 0\n'), mode: '0755', method }, { path: 'admin-assets/_astro/example.hash.js', method }]);
    assert.deepEqual(inspect(value).get('release.json'), text);
    assert.deepEqual(inspect(value).get('admin-assets/_astro/example.hash.js'), text);
  }
});

test('deflate is denied for runtime, fonts, images, unlisted paths and unknown compression', () => {
  for (const path of ['runtime/node/bin/node.xz', 'admin-assets/_astro/font.hash.woff', 'admin-assets/_astro/font.hash.woff2', 'admin-assets/invitations/template-blank.png', 'admin-assets/invitations/ggj2026-poster-v2.webp', 'admin-assets/_astro/unknown.hash.json', 'shared/unlisted.mjs']) {
    assert.throws(() => inspect(fixture([{ path }])), /metadata|Unexpected|Invalid/);
  }
  assert.throws(() => inspect(fixture([{ method: 9 }])), /metadata/);
});

test('declared per-file and aggregate text limits are checked before expansion', () => {
  for (const spec of [{ bytes: 64 * 1024 + 1 }, { path: 'shared/content-schema.mjs', bytes: MiB + 1 }, { path: 'admin-assets/_astro/large.hash.js', bytes: 2 * MiB + 1 }]) {
    assert.throws(() => inspect(fixture([spec])), /file record/);
  }
  const paths = ['shared/content-schema.mjs', 'shared/contacts-schema.mjs', 'shared/contact-editor.mjs', 'shared/arrangement-overview.mjs', 'shared/portrait-codec.mjs'];
  for (const method of [0, 8]) assert.throws(() => inspect(fixture(paths.map(path => ({ path, method, bytes: 900 * 1024 })))), /text output budget/);
  assert.throws(() => inspect(fixture([{ bytes: text.length - 1 }])), /compressed content/);
  assert.throws(() => inspect(fixture([{ bytes: text.length + 1 }])), /hash mismatch/);
});

test('deflate must consume its entire exact input and reject truncation', () => {
  const packed = deflateRawSync(text);
  for (const body of [Buffer.concat([packed, Buffer.from('unlisted')]), Buffer.concat([packed, packed]), packed.subarray(0, -1)]) {
    assert.throws(() => inspect(fixture([{ body }])), /compressed content/);
  }
});

test('both stored and deflated files validate actual CRC, SHA and exact payload size', () => {
  for (const method of [0, 8]) {
    assert.throws(() => inspect(fixture([{ method, crc: 1 }])), /CRC mismatch/);
    assert.throws(() => inspect(fixture([{ method, sha256: '0'.repeat(64) }])), /hash mismatch/);
  }
  assert.throws(() => inspect(fixture([{ method: 0, body: Buffer.concat([text, Buffer.from('extra')]) }])), /hash mismatch/);
});

test('deflate preserves strict local and central metadata, modes, flags, order and no-gap checks', () => {
  for (const mutate of [
    (b, o) => b.writeUInt16LE(1, o.local + 6),
    (b, o) => { b.writeUInt16LE(8, o.local + 6); b.writeUInt16LE(8, o.central + 8); },
    (b, o) => b.writeUInt16LE(0, o.local + 8),
    (b, o) => b.writeUInt32LE(1, o.local + 14),
    (b, o) => b.writeUInt32LE(1, o.local + 18),
    (b, o) => b.writeUInt32LE(1, o.local + 22),
    (b, o) => b.writeUInt32LE(0o120644 * 65536, o.central + 38),
    (b, o) => b.writeUInt32LE(1, o.central + 42),
  ]) {
    const value = fixture(); mutate(value.bytes, value.offsets[0]); assert.throws(() => inspect(value), /metadata|directory/);
  }
  const value = fixture([{ path: 'shared/content-schema.mjs' }, { path: 'release.json' }]);
  assert.throws(() => candidateZipEntries(value.bytes, [...value.records].reverse()), /metadata/);
  assert.throws(() => inspect({ ...value, bytes: Buffer.concat([value.bytes, Buffer.from('gap')]) }));
  assert.throws(() => candidateZipEntries(value.bytes, [value.records[0], value.records[0]]), /file record/);
  const gap = fixture(), central = gap.offsets[0].central;
  const withGap = Buffer.concat([gap.bytes.subarray(0, central), Buffer.from([0]), gap.bytes.subarray(central)]);
  withGap.writeUInt32LE(central + 1, withGap.length - 22 + 16);
  assert.throws(() => candidateZipEntries(withGap, gap.records), /unlisted bytes/);
});

test('original FC ZIP and JSON request budgets remain fixed', () => {
  assert.equal(MAX_FC_ZIP_BYTES, 35_999_982); assert.equal(MAX_FC_REQUEST_BYTES, 48_000_000);
  assert.ok(assertFcCodeRequestFits(MAX_FC_ZIP_BYTES) <= MAX_FC_REQUEST_BYTES);
  assert.throws(() => assertFcCodeRequestFits(MAX_FC_ZIP_BYTES + 1));
});
