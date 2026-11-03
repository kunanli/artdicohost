import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveEntryLink } from '../src/lib/entry-link.mjs';
import { encodeQrPng } from '../functions/entry-ticket/qr.mjs';
import { crc32, inflateSync } from 'node:zlib';

const code = 'a'.repeat(22), apiOrigin = 'https://api.artdico.host';
test('short link reads once without cookies/writes and only opens exact private first-party page', async () => {
  let calls = 0;
  const target = 'https://artdico.host/registration/confirmation/#r=c1.synthetic.signature';
  assert.equal(await resolveEntryLink({code,apiOrigin,fetch:async(url,options)=>{
    calls++; assert.equal(url,apiOrigin+'/api/admin/registration/entry-links/'+code);
    assert.equal(options.method,'GET');assert.equal(options.credentials,'omit');assert.equal(options.cache,'no-store');assert.equal(options.redirect,'error');assert.equal(options.referrerPolicy,'no-referrer');
    return Response.json({confirmationUrl:target});
  }}),target); assert.equal(calls,1);
});
test('short link rejects tampered, cross-origin, query, oversized and failed responses', async () => {
  const forbidden=()=>{throw new Error('No request permitted');};
  await assert.rejects(resolveEntryLink({code:'x',apiOrigin,fetch:forbidden}));
  await assert.rejects(resolveEntryLink({code,apiOrigin:'https://other.invalid',fetch:forbidden}));
  for(const confirmationUrl of ['https://other.invalid/registration/confirmation/#r=c1.a.b','https://artdico.host/other/#r=c1.a.b','https://artdico.host/registration/confirmation/?r=secret#r=c1.a.b','https://artdico.host/registration/confirmation/#r=not-signed','https://user:password@artdico.host/registration/confirmation/#r=c1.a.b']) {
    await assert.rejects(resolveEntryLink({code,apiOrigin,fetch:async()=>Response.json({confirmationUrl})}));
  }
  await assert.rejects(resolveEntryLink({code,apiOrigin,fetch:async()=>Response.json({error:{}},{status:404})}));
});
test('local QR emits bounded grayscale PNG with checked CRC and four-module quiet zone',()=>{
  const png=encodeQrPng('https://api.artdico.host/admin/checkin/#ticket='+code);
  assert.ok(png.length<30_000);assert.deepEqual([...png.subarray(0,8)],[137,80,78,71,13,10,26,10]);
  const data=[];let width=0;
  for(let offset=8;offset<png.length;){const size=png.readUInt32BE(offset),kind=png.toString('ascii',offset+4,offset+8),bytes=png.subarray(offset+8,offset+8+size);assert.equal(crc32(png.subarray(offset+4,offset+8+size))>>>0,png.readUInt32BE(offset+8+size));if(kind==='IHDR'){width=bytes.readUInt32BE(0);assert.equal(bytes.readUInt32BE(4),width);assert.equal(bytes[8],8);assert.equal(bytes[9],0);}if(kind==='IDAT')data.push(bytes);offset+=size+12;}
  assert.ok(width<=800);const pixels=inflateSync(Buffer.concat(data));assert.equal(pixels.length,(width+1)*width);
  for(let y=0;y<32;y++)assert.ok(pixels.subarray(y*(width+1)+1,(y+1)*(width+1)).every(v=>v===255));
  assert.ok(pixels.includes(0));
  for(const invalid of ['http://artdico.host/r/#a','https://external.invalid/r/#a','https://artdico.host/r/#\n','https://artdico.host/'+ 'x'.repeat(256)])assert.throws(()=>encodeQrPng(invalid));
});
