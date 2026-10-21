import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { brotliDecompressSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { INVITATION_MEDIUM_PARTS, INVITATION_REGULAR_PART } from '../src/lib/invitation-font-data.mjs';

const manifest = JSON.parse(await readFile(new URL('../docs/invitation-font-manifest.json', import.meta.url), 'utf8'));
const sha256 = value => createHash('sha256').update(value).digest('hex');
const MiB = 1024 * 1024;
// Frozen coverage of the supplied Medium font, independently measured before
// subsetting. CI verifies the actual binary cmap without the private source TTF.
const MEDIUM_CMAP_SHA256 = '9f3bd0dadf3bf8fa8b8af72d1e5dcbfe5a1b975022b336736f1096330505b4d5';
const WOFF_TAGS = ('cmap,head,hhea,hmtx,maxp,name,OS/2,post,cvt ,fpgm,glyf,loca,prep,CFF ,VORG,EBDT,EBLC,gasp,hdmx,kern,LTSH,PCLT,VDMX,vhea,vmtx,BASE,GDEF,GPOS,GSUB,EBSC,JSTF,MATH,CBDT,CBLC,COLR,CPAL,SVG ,sbix,acnt,avar,bdat,bloc,bsln,cvar,fdsc,feat,fmtx,fvar,gvar,hsty,just,lcar,mort,morx,opbd,prop,trak,Zapf,Silf,Glat,Gloc,Feat,Sill').split(',');

/** Read untransformed cmap/name/OS2 tables from the WOFF2 Brotli stream.
 * No glyph reconstruction, fontTools, browser, source TTF or dependency needed. */
function fontTables(bytes) {
  assert.equal(bytes.toString('ascii', 0, 4), 'wOF2');
  assert.equal(bytes.readUInt32BE(8), bytes.length);
  assert.equal(bytes.readUInt16BE(14), 0);
  assert.ok(bytes.readUInt32BE(16) < 16 * MiB);
  const count = bytes.readUInt16BE(12); assert.ok(count > 0 && count < 64);
  assert.notEqual(bytes.toString('ascii', 4, 8), 'ttcf');
  let offset = 48, streamLength = 0;
  function base128() {
    let value = 0;
    for (let i = 0; i < 5; i++) {
      const next = bytes[offset++]; assert.notEqual(next, undefined);
      assert.ok(!(i === 0 && next === 0x80));
      value = value * 128 + (next & 0x7f); assert.ok(value <= 0xffffffff);
      if (!(next & 0x80)) return value;
    }
    assert.fail('Malformed WOFF2 table length');
  }
  const directory = [];
  for (let i = 0; i < count; i++) {
    const flags = bytes[offset++], index = flags & 0x3f;
    const tag = index === 63 ? bytes.toString('ascii', offset, offset += 4) : WOFF_TAGS[index];
    const originalLength = base128(), version = flags >>> 6;
    const transformed = ['glyf', 'loca'].includes(tag) ? version !== 3 : version !== 0;
    const length = transformed ? base128() : originalLength;
    assert.ok(length <= 16 * MiB && streamLength + length <= 16 * MiB);
    directory.push({ tag, originalLength, transformed, offset: streamLength, length }); streamLength += length;
  }
  const compressedLength = bytes.readUInt32BE(20);
  assert.ok(offset + compressedLength <= bytes.length);
  const stream = brotliDecompressSync(bytes.subarray(offset, offset + compressedLength), { maxOutputLength: 16 * MiB });
  assert.equal(stream.length, streamLength);
  const tables = new Map(directory.map(item => [item.tag, stream.subarray(item.offset, item.offset + item.length)]));
  for (const tag of ['cmap', 'name', 'OS/2', 'maxp']) {
    assert.equal(directory.find(item => item.tag === tag)?.transformed, false, tag + ' must be directly readable');
    assert.ok(tables.get(tag)?.length > 0);
  }
  return tables;
}

function actualCodePoints(tables) {
  const cmap = tables.get('cmap'), count = cmap.readUInt16BE(2), records = [];
  for (let i = 0; i < count; i++) {
    const at = 4 + i * 8;
    records.push({ platform: cmap.readUInt16BE(at), encoding: cmap.readUInt16BE(at + 2), at: cmap.readUInt32BE(at + 4) });
  }
  const preferences = [[3, 10], [0, 6], [0, 4], [3, 1], [0, 3], [0, 2], [0, 1], [0, 0]];
  const record = preferences.flatMap(([platform, encoding]) => records.filter(item => item.platform === platform && item.encoding === encoding))[0];
  assert.ok(record, 'A Unicode cmap is required');
  const table = cmap.subarray(record.at), format = table.readUInt16BE(0), points = [];
  const glyphs = tables.get('maxp').readUInt16BE(4);
  const add = (cp, glyph) => { assert.ok(glyph < glyphs); if (glyph) points.push(cp); };
  if (format === 12) {
    const groups = table.readUInt32BE(12); assert.ok(groups < 65536);
    for (let i = 0; i < groups; i++) {
      const at = 16 + i * 12, start = table.readUInt32BE(at), end = table.readUInt32BE(at + 4), glyph = table.readUInt32BE(at + 8);
      assert.ok(start <= end && end <= 0x10ffff && end - start < 65536);
      for (let cp = start; cp <= end; cp++) add(cp, glyph + cp - start);
    }
  } else {
    assert.equal(format, 4);
    const segments = table.readUInt16BE(6) / 2, ends = 14, starts = ends + segments * 2 + 2;
    const deltas = starts + segments * 2, offsets = deltas + segments * 2;
    for (let i = 0; i < segments; i++) {
      const start = table.readUInt16BE(starts + i * 2), end = table.readUInt16BE(ends + i * 2);
      const delta = table.readInt16BE(deltas + i * 2), range = table.readUInt16BE(offsets + i * 2);
      assert.ok(start <= end);
      for (let cp = start; cp <= end && cp !== 0xffff; cp++) {
        let glyph = range ? table.readUInt16BE(offsets + i * 2 + range + 2 * (cp - start)) : cp;
        if (!range || glyph) glyph = (glyph + delta) & 0xffff;
        add(cp, glyph);
      }
    }
  }
  assert.deepEqual(points, [...new Set(points)].sort((a, b) => a - b));
  return points;
}

function codePoints(ranges) {
  let previous = -1;
  return ranges.flatMap(pair => {
    assert.ok(Array.isArray(pair) && pair.length === 2);
    const [start, end] = pair;
    assert.ok(Number.isInteger(start) && Number.isInteger(end) && start > previous && end >= start && end <= 0x10ffff);
    assert.ok(end < 0xd800 || start > 0xdfff); previous = end;
    return Array.from({ length: end - start + 1 }, (_, i) => start + i);
  });
}

function fontNames(table) {
  const count = table.readUInt16BE(2), strings = table.readUInt16BE(4), result = [];
  for (let i = 0; i < count; i++) {
    const at = 6 + i * 12, platform = table.readUInt16BE(at), id = table.readUInt16BE(at + 6);
    const length = table.readUInt16BE(at + 8), offset = strings + table.readUInt16BE(at + 10), raw = table.subarray(offset, offset + length);
    assert.equal(raw.length, length);
    const text = [0, 3].includes(platform) ? Buffer.from(raw).swap16().toString('utf16le') : raw.toString('latin1');
    result.push({ id, text });
  }
  return result;
}

const fonts = await Promise.all([...manifest.parts, manifest.regular].map(async record => {
  assert.match(record.file, /^invitation-(?:medium-part[1-3]|regular)\.woff2$/u);
  const bytes = await readFile(new URL('../src/assets/fonts/' + record.file, import.meta.url));
  return { record, bytes, tables: fontTables(bytes) };
}));

test('four licensed font assets retain exact binary hashes, valid WOFF2 tables and existing per-asset budgets', () => {
  assert.equal(manifest.schemaVersion, 1); assert.equal(manifest.derivedFamily, 'ARTDiCO Invitation SC');
  assert.equal(manifest.license, 'SIL Open Font License 1.1'); assert.equal(fonts.length, 4);
  assert.equal(manifest.sources.medium.sha256, 'b30853d205f3ecdde938b1488c735ee15a2e870d31331b992fdc53971e23ec4a');
  assert.equal(manifest.sources.regular.sha256, 'd45f67f0a7c0ca3f256950777ce6a61cc7ce5f9696d02900cbbaac25f8aa7d16');
  let total = 0;
  for (const { record, bytes, tables } of fonts) {
    assert.equal(bytes.length, record.bytes); assert.equal(sha256(bytes), record.sha256);
    assert.ok(bytes.length > 0 && bytes.length <= 2 * MiB); total += bytes.length;
    assert.equal(tables.get('OS/2').readUInt16BE(4), record.weight);
    assert.equal(record.weight, record.id === 'regular' ? 400 : 500);
  }
  assert.ok(total < 5 * MiB && total < 8 * MiB, 'fonts retain room within the unchanged aggregate asset budget');
});

test('actual font cmaps match manifest and client ranges; Medium partitions cover all 30890 source characters once', () => {
  const client = [...INVITATION_MEDIUM_PARTS, INVITATION_REGULAR_PART], union = new Set();
  assert.equal(client.length, 4); assert.equal(manifest.mediumSourceCodePoints, 30890);
  for (const { record, tables } of fonts) {
    const points = actualCodePoints(tables), declared = codePoints(record.codePointRanges), data = client.find(item => item.id === record.id);
    assert.deepEqual(points, declared); assert.equal(points.length, record.codePointCount);
    assert.deepEqual(data.codePointRanges, record.codePointRanges); assert.equal(data.unicodeRange, record.unicodeRange);
    assert.equal(fileURLToPath(data.url), fileURLToPath(new URL('../src/assets/fonts/' + record.file, import.meta.url)));
    const cssRanges = record.codePointRanges.map(([a, b]) => 'U+' + a.toString(16).toUpperCase() + (a === b ? '' : '-' + b.toString(16).toUpperCase())).join(',');
    assert.equal(data.unicodeRange, cssRanges);
    if (record.weight === 500) for (const cp of points) { assert.equal(union.has(cp), false); union.add(cp); }
  }
  assert.equal(union.size, 30890); assert.equal(sha256([...union].sort((a, b) => a - b).join(',')), MEDIUM_CMAP_SHA256);
  assert.ok(union.has(0x3106c), 'supplementary-plane characters survive the split');
  const regular = new Set(actualCodePoints(fonts.find(font => font.record.id === 'regular').tables));
  for (const char of '2026/12/05 10:00–18:00年月日星期深圳前海5号楼3F') assert.ok(regular.has(char.codePointAt(0)), 'fixed date/place character is available: ' + char);
});

test('every binary embeds the original copyright and OFL while primary family names use the renamed derivative', async () => {
  const license = await readFile(new URL('../docs/licenses/invitation-fonts-OFL.txt', import.meta.url), 'utf8');
  assert.match(license, /SIL OPEN FONT LICENSE Version 1\.1/u); assert.match(license, /Reserved Font Name 'Source'/u);
  assert.match(license, /ARTDiCO Invitation SC/u); assert.match(license, /PERMISSION & CONDITIONS/u);
  const fullLicense = license.slice(license.indexOf('SIL OPEN FONT LICENSE Version 1.1')).trim();
  for (const { record, tables } of fonts) {
    const names = fontNames(tables.get('name'));
    for (const id of [1, 3, 4, 6]) {
      const values = names.filter(item => item.id === id); assert.ok(values.length);
      for (const value of values) { assert.match(value.text, /ARTDiCO\s*Invitation\s*SC/u); assert.doesNotMatch(value.text, /Noto|Source/u); }
    }
    for (const name of names.filter(item => [1, 16].includes(item.id))) assert.equal(name.text, manifest.derivedFamily);
    for (const name of names.filter(item => item.id === 6)) assert.ok(name.text.endsWith('-' + record.id), 'subset PostScript names are distinct');
    assert.match(names.filter(item => item.id === 0).map(item => item.text).join('\n'), /2014-2021 Adobe.*Reserved Font Name 'Source'/u);
    const notices = names.filter(item => item.id === 13); assert.ok(notices.length);
    for (const notice of notices) {
      assert.ok(notice.text.includes(fullLicense), 'every distributed font must include the full license, not only its URL');
      assert.match(notice.text, /PERMISSION & CONDITIONS[\s\S]*TERMINATION[\s\S]*DISCLAIMER/u);
    }
    assert.match(names.filter(item => item.id === 14).map(item => item.text).join('\n'), /scripts\.sil\.org\/OFL/u);
  }
});
