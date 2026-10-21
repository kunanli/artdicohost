import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, writeFile, stat, mkdir, symlink, chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { deflateSync, inflateSync } from 'node:zlib';
import { createFilePortraitStore, MAX_PORTRAIT_BYTES } from '../functions/content-api/portrait-store.mjs';
import { createOssPortraitStore } from '../functions/cloud-content/portrait-store.mjs';
import { normalizePortraitBytes } from '../shared/portrait-codec.mjs';
import { memoryObjects } from './helpers/cloud-memory-objects.mjs';

// Generated once from a solid 2×3 RGB image. No portraits or external material.
const fixtures = {
  'image/png': 'iVBORw0KGgoAAAANSUhEUgAAAAIAAAADCAIAAAA2iEnWAAAAFElEQVR4nGN0KFjAwMDAxMDAgKAAGOQBVgs9CEsAAAAASUVORK5CYII=',
  'image/jpeg': '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAADAAIDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwDGooor3Dxj/9k=',
  'image/webp': 'UklGRjYAAABXRUJQVlA4ICoAAACwAQCdASoCAAMAAUAmJZgCdLoABDAAAP7tBy/8Q50OdDmYz/uOwN13iAA=',
};

async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'artdicohost-portrait-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return { directory, store: createFilePortraitStore({ directory }) };
}
async function fails(operation, code) { await assert.rejects(operation, error => error.code === code && !error.cause); }
const input = (contentType, data = Buffer.from(fixtures[contentType], 'base64')) => ({ contentType, dataBase64: data.toString('base64') });
function pngChunk(type, body) {
  let crc = 0xffffffff;
  for (const byte of Buffer.concat([Buffer.from(type), body])) { crc ^= byte; for (let i = 0; i < 8; i++) crc = crc & 1 ? 0xedb88320 ^ crc >>> 1 : crc >>> 1; }
  const result = Buffer.alloc(body.length + 12); result.writeUInt32BE(body.length); result.write(type, 4); body.copy(result, 8); result.writeUInt32BE((crc ^ 0xffffffff) >>> 0, result.length - 4); return result;
}

function transparentPng(indexed) {
  const header = Buffer.alloc(13); header.writeUInt32BE(3); header.writeUInt32BE(1, 4); header[8] = 8; header[9] = indexed ? 3 : 6;
  const pixels = indexed ? Buffer.from([0, 0, 1, 2]) : Buffer.from([0, 255, 0, 0, 0, 0, 255, 0, 127, 0, 0, 255, 255]);
  return Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), pngChunk('IHDR', header),
    ...(indexed ? [pngChunk('PLTE', Buffer.from([255, 0, 0, 0, 255, 0, 0, 0, 255])), pngChunk('tRNS', Buffer.from([0, 127, 255]))] : []),
    pngChunk('IDAT', deflateSync(pixels)), pngChunk('IEND', Buffer.alloc(0))]);
}

function transparentPixelAlphas(data) {
  const compressed = [];
  let transparency, colorType;
  for (let offset = 8; offset < data.length;) {
    const length = data.readUInt32BE(offset), type = data.toString('ascii', offset + 4, offset + 8), body = data.subarray(offset + 8, offset + 8 + length);
    if (type === 'IHDR') colorType = body[9];
    if (type === 'tRNS') transparency = body;
    if (type === 'IDAT') compressed.push(body);
    offset += length + 12;
  }
  const raw = inflateSync(Buffer.concat(compressed));
  assert.equal(raw[0], 0, 'the synthetic pixel row uses the unfiltered encoding');
  return colorType === 6 ? [raw[4], raw[8], raw[12]] : [...raw.subarray(1)].map(index => transparency[index]);
}

for (const indexed of [false, true]) test(`${indexed ? 'palette tRNS' : 'RGBA'} PNG transparency survives normalization, metadata stripping and rebuilt local/cloud stores`, async t => {
  const clean = transparentPng(indexed), privateText = Buffer.from('synthetic-source\0PRIVATE-SYNTHETIC-PHOTO-LOCATION');
  const tagged = Buffer.concat([clean.subarray(0, 33), pngChunk('tEXt', privateText), clean.subarray(33)]);
  assert.deepEqual(normalizePortraitBytes(tagged, 'image/png'), clean);
  assert.deepEqual(transparentPixelAlphas(clean), [0, 127, 255]);
  const { directory, store: local } = await fixture(t), objects = memoryObjects(), cloud = createOssPortraitStore({ objects });
  for (const [store, rebuild] of [[local, () => createFilePortraitStore({ directory })], [cloud, () => createOssPortraitStore({ objects })]]) {
    const portrait = await store.upload(input('image/png', tagged));
    assert.equal(portrait.contentType, 'image/png');
    assert.equal(portrait.id, createHash('sha256').update(clean).digest('hex') + '.png');
    assert.deepEqual(await store.upload(input('image/png', clean)), portrait, 'metadata never changes the canonical rendering identifier');
    const restored = await rebuild().read(portrait.id);
    assert.deepEqual(restored.data, clean);
    assert.equal(restored.data.includes(privateText), false);
    assert.deepEqual(transparentPixelAlphas(restored.data), [0, 127, 255], 'fully and partially transparent pixels are not flattened onto a background');
    assert.deepEqual(await rebuild().verify(portrait.id), portrait);
  }
});

test('actual PNG, JPEG and WebP uploads survive restart with private modes, canonical IDs and verified bytes', async t => {
  const { directory, store } = await fixture(t);
  for (const contentType of Object.keys(fixtures)) {
    const portrait = await store.upload(input(contentType));
    assert.match(portrait.id, /^[a-f0-9]{64}\.(jpg|png|webp)$/u);
    assert.equal(portrait.contentType, contentType);
    const path = join(directory, 'portraits', portrait.id);
    const file = await readFile(path);
    assert.equal(createHash('sha256').update(file).digest('hex'), portrait.id.slice(0, 64));
    assert.equal((await stat(path)).mode & 0o777, 0o600);
    assert.equal((await stat(join(directory, 'portraits'))).mode & 0o777, 0o700);
    assert.deepEqual(await createFilePortraitStore({ directory }).read(portrait.id), { data: file, contentType, bytes: file.length });
    assert.deepEqual(await store.verify(portrait.id), portrait);
    assert.deepEqual(await store.upload(input(contentType)), portrait);
  }
});

test('invalid MIME, noncanonical Base64, image confusion, truncation, corruption and oversized input are rejected', async t => {
  const { store } = await fixture(t);
  for (const contentType of ['image/svg+xml','image/gif','text/html','image/PNG','image/png; charset=utf-8',null,{}]) await fails(() => store.upload({ contentType, dataBase64: fixtures['image/png'] }), 'INVALID_PORTRAIT');
  for (const value of ['', fixtures['image/png'] + '\n', fixtures['image/png'].replace(/=$/u, ''), '-___', 'AB==']) await fails(() => store.upload({ contentType: 'image/png', dataBase64: value }), 'INVALID_PORTRAIT');
  await fails(() => store.upload(input('image/jpeg', Buffer.from(fixtures['image/png'], 'base64'))), 'INVALID_PORTRAIT');
  for (const [contentType, encoded] of Object.entries(fixtures)) {
    const data = Buffer.from(encoded, 'base64');
    await fails(() => store.upload(input(contentType, data.subarray(0, data.length - 2))), 'INVALID_PORTRAIT');
    await fails(() => store.upload(input(contentType, Buffer.concat([data, Buffer.from('trailing')]))), 'INVALID_PORTRAIT');
  }
  const corrupt = Buffer.from(fixtures['image/png'], 'base64'); corrupt[50] ^= 1;
  await fails(() => store.upload(input('image/png', corrupt)), 'INVALID_PORTRAIT');
  await fails(() => store.upload(input('image/png', Buffer.alloc(MAX_PORTRAIT_BYTES + 1))), 'PORTRAIT_TOO_LARGE');
});

test('oversized dimensions and unsupported animated images fail before a file is accepted', async t => {
  const { store } = await fixture(t);
  const png = Buffer.from(fixtures['image/png'], 'base64'), header = Buffer.from(png.subarray(16, 29)); header.writeUInt32BE(2049);
  await fails(() => store.upload(input('image/png', Buffer.concat([png.subarray(0,8), pngChunk('IHDR',header), png.subarray(33)]))), 'INVALID_PORTRAIT');
  const jpeg = Buffer.from(fixtures['image/jpeg'], 'base64'), sof = jpeg.indexOf(Buffer.from([255,192])); jpeg.writeUInt16BE(2049, sof + 7);
  await fails(() => store.upload(input('image/jpeg', jpeg)), 'INVALID_PORTRAIT');
  const webp = Buffer.from(fixtures['image/webp'], 'base64'); webp.writeUInt16LE(2049, 26);
  await fails(() => store.upload(input('image/webp', webp)), 'INVALID_PORTRAIT');
  await fails(() => store.upload(input('image/png', Buffer.concat([png.subarray(0,33), pngChunk('acTL',Buffer.alloc(8)), png.subarray(33)]))), 'INVALID_PORTRAIT');
});

test('metadata is removed before hashing and storage instead of being exposed with the portrait', async t => {
  const { store } = await fixture(t);
  const privateText = Buffer.from('SYNTHETIC-PRIVATE-EXIF-LOCATION');
  const png = Buffer.from(fixtures['image/png'], 'base64');
  const cleanPng = await store.upload(input('image/png'));
  const taggedPng = await store.upload(input('image/png', Buffer.concat([png.subarray(0,33), pngChunk('tEXt',privateText), png.subarray(33)])));
  assert.deepEqual(taggedPng, cleanPng);
  const jpeg = Buffer.from(fixtures['image/jpeg'], 'base64'), app = Buffer.alloc(4); app[0] = 255; app[1] = 225; app.writeUInt16BE(privateText.length + 2, 2);
  const cleanJpeg = await store.upload(input('image/jpeg'));
  const taggedJpeg = await store.upload(input('image/jpeg', Buffer.concat([jpeg.subarray(0,2), app, privateText, jpeg.subarray(2)])));
  assert.deepEqual(taggedJpeg, cleanJpeg);
  const webp = Buffer.from(fixtures['image/webp'], 'base64'), extra = Buffer.alloc(8); extra.write('EXIF'); extra.writeUInt32LE(privateText.length,4);
  const tagged = Buffer.concat([webp, extra, privateText, ...(privateText.length & 1 ? [Buffer.from([0])] : [])]); tagged.writeUInt32LE(tagged.length - 8, 4);
  const taggedWebp = await store.upload(input('image/webp', tagged));
  assert.equal((await store.read(taggedWebp.id)).data.includes(privateText), false);
  assert.equal(taggedWebp.id, (await store.upload(input('image/webp'))).id);
});

test('invalid IDs, root or file symlinks, changed bytes and permissive modes fail closed', async t => {
  const { directory, store } = await fixture(t);
  for (const id of ['../portrait.png', 'a'.repeat(64) + '.svg', 'A'.repeat(64) + '.png', '/', null, {}]) await fails(() => store.read(id), 'INVALID_PORTRAIT_ID');
  await assert.rejects(() => store.read('b'.repeat(64) + '.png'), error => error.code === 'NOT_FOUND' && error.status === 404 && !error.cause);
  const uploaded = await store.upload(input('image/png'));
  const path = join(directory, 'portraits', uploaded.id);
  await writeFile(path, Buffer.alloc(80));
  await fails(() => store.read(uploaded.id), 'PORTRAIT_UNAVAILABLE');
  await rm(path); await symlink(join(directory,'missing'), path);
  await fails(() => store.upload(input('image/png')), 'PORTRAIT_UNAVAILABLE');
  await rm(path); await store.upload(input('image/png')); await chmod(path, 0o644);
  await fails(() => store.read(uploaded.id), 'PORTRAIT_UNAVAILABLE');
  const linked = join(directory, 'linked'); await mkdir(linked); await symlink(join(directory,'portraits'), join(linked,'portraits'));
  await fails(() => createFilePortraitStore({ directory: linked }).upload(input('image/png')), 'PORTRAIT_UNAVAILABLE');
});
