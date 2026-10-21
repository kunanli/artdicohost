import test from 'node:test';
import assert from 'node:assert/strict';
import { crc32, createPrivateInvitationZip, privateInvitationFilename, privateZipEntryBytes, PRIVATE_INVITATION_ZIP_LIMIT } from '../src/lib/private-invitation-zip.mjs';
import { previewBatchInvitations, prepareBatchInvitations } from '../src/lib/invitation-batch.mjs';

const encoder = new TextEncoder(), decoder = new TextDecoder();
const PNG = new Uint8Array([137,80,78,71,13,10,26,10,0,0,0,0]);
const png = () => new Blob([PNG], { type: 'image/png' });
const invitation = (contactId = 'contact_1') => ({ id: 'i_' + contactId, channel: 'manual', status: 'prepared', registrationId: 'registration_' + contactId,
  referenceCode: 'reference_' + contactId, content: { settings: { recipientName: '合成示例 ' + contactId, date: '2026-12-05', time: '10:00–18:00', venue: '合成测试会场', confirmed: true } } });
const entry = (contactId, status = 'prepared') => ({ contactId, status, ...(['prepared','replayed'].includes(status) ? { invitation: invitation(contactId) } : { code: 'PRECHECK_FAILED' }) });
const prepare = (results, options = {}) => prepareBatchInvitations({ contactIds: results.map(result => result.contactId), expectedContactRevision: 7,
  previewToken: 'synthetic-token', request: async () => ({ contactRevision: 7, results }), renderInvitation: async () => png(), ...options });

/** Independently traverses both ZIP directories and checks sizes, offsets and checksums. */
async function readZip(blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer()), view = new DataView(bytes.buffer), files = new Map();
  const end = bytes.length - 22;
  assert.equal(view.getUint32(end, true), 0x06054b50);
  assert.equal(view.getUint16(end + 4, true), 0);
  assert.equal(view.getUint16(end + 6, true), 0);
  const count = view.getUint16(end + 10, true), centralSize = view.getUint32(end + 12, true), centralOffset = view.getUint32(end + 16, true);
  assert.equal(view.getUint16(end + 8, true), count);
  assert.equal(centralOffset + centralSize, end);
  let at = centralOffset;
  for (let index = 0; index < count; index++) {
    assert.equal(view.getUint32(at, true), 0x02014b50);
    assert.equal(view.getUint16(at + 8, true), 0x0800);
    assert.equal(view.getUint16(at + 10, true), 0); // Store; no compression dependency.
    const checksum = view.getUint32(at + 16, true), size = view.getUint32(at + 24, true), length = view.getUint16(at + 28, true);
    const name = decoder.decode(bytes.slice(at + 46, at + 46 + length)), localAt = view.getUint32(at + 42, true);
    assert.equal(view.getUint32(at + 20, true), size);
    assert.equal(view.getUint32(at + 38, true) >>> 16, 0o100600);
    assert.equal(view.getUint32(localAt, true), 0x04034b50);
    assert.equal(view.getUint16(localAt + 6, true), 0x0800);
    assert.equal(view.getUint16(localAt + 8, true), 0);
    assert.equal(view.getUint32(localAt + 14, true), checksum);
    assert.equal(view.getUint32(localAt + 18, true), size);
    assert.equal(view.getUint32(localAt + 22, true), size);
    assert.equal(view.getUint16(localAt + 26, true), length);
    assert.equal(decoder.decode(bytes.slice(localAt + 30, localAt + 30 + length)), name);
    const data = bytes.slice(localAt + 30 + length, localAt + 30 + length + size);
    assert.equal(crc32(data), checksum);
    assert.equal(files.has(name), false); files.set(name, data);
    at += 46 + length + view.getUint16(at + 30, true) + view.getUint16(at + 32, true);
  }
  assert.equal(at, end);
  return files;
}

test('CRC32 standard vector and UTF-8 store ZIP have exact valid local/central records and private permissions', async () => {
  assert.equal(crc32(encoder.encode('123456789')), 0xcbf43926);
  assert.equal(crc32(new Uint8Array()), 0);
  const first = new Uint8Array([0, 1, 255]), second = new Blob(['synthetic only']);
  const blob = await createPrivateInvitationZip([{ name: '中文邀请.png', data: first }, { name: 'results-private.json', data: second }]);
  const files = await readZip(blob);
  assert.deepEqual(files.get('中文邀请.png'), first);
  assert.equal(decoder.decode(files.get('results-private.json')), 'synthetic only');
  assert.equal(blob.type, 'application/zip');
  assert.equal(blob.size, 22 + privateZipEntryBytes('中文邀请.png', first.length) + privateZipEntryBytes('results-private.json', second.size));
});

test('ZIP rejects traversal, bidi, control, Windows reserved and duplicate names', async () => {
  for (const name of ['../name.png','/name.png','a\\b.png','.hidden','name.',' name','NUL.png','lpt1.csv','a\u202ename.png','a\0.png','name?.png']) {
    await assert.rejects(createPrivateInvitationZip([{ name, data: png() }]), /filename/u);
  }
  await assert.rejects(createPrivateInvitationZip([{ name: 'Name.png', data: png() }, { name: 'name.PNG', data: png() }]), /Duplicate/u);
  await assert.rejects(createPrivateInvitationZip(Array.from({length:103},(_,i)=>({name:'a'+i+'.png',data:png()}))), /Too many/u);
});

test('malicious and colliding recipient names become bounded unique basenames retaining strict stable IDs', () => {
  const name = privateInvitationFilename(' ../CON/\u202e称呼:名字<>?*"|\\' + '长'.repeat(200), 'contact_1', 0);
  assert.match(name, /^001-/u); assert.match(name, /-contact_1\.png$/u);
  assert.doesNotMatch(name, /[.][.]|[<>:"/\\|?*\u202e]/u);
  assert.ok(name.length < 160);
  assert.notEqual(privateInvitationFilename('same', 'contact_1', 0), privateInvitationFilename('same', 'contact_2', 1));
  assert.throws(()=>privateInvitationFilename('name','../id',0), /Invalid/u);
});

test('long CJK recipient names retain an 80-character stable ID within a 240-byte filesystem component', async () => {
  const contactId = 'c'.repeat(80);
  const name = privateInvitationFilename('长'.repeat(80), contactId, 99);
  assert.ok(encoder.encode(name).length <= 240);
  assert.ok(name.startsWith('100-'));
  assert.ok(name.endsWith('-' + contactId + '.png'));
  assert.ok(name.includes('长'));
  const files = await readZip(await createPrivateInvitationZip([{ name, data: png() }]));
  assert.ok(files.has(name));
  await assert.rejects(createPrivateInvitationZip([{ name: '长'.repeat(90) + '.png', data: png() }]), /too long/u);
});

test('archive size is bounded including directories before any Blob bytes are read', async () => {
  let reads = 0;
  class ObservedBlob extends Blob { async arrayBuffer() { reads++; return super.arrayBuffer(); } }
  const data = new ObservedBlob(['123']);
  const exact = 22 + privateZipEntryBytes('a.png', data.size);
  await assert.rejects(createPrivateInvitationZip([{ name:'a.png',data }],{maxBytes:exact-1}), /size limit/u);
  assert.equal(reads,0);
  assert.equal((await createPrivateInvitationZip([{name:'a.png',data}],{maxBytes:exact})).size,exact);
  assert.equal(reads,1);
  await assert.rejects(createPrivateInvitationZip([],{maxBytes:PRIVATE_INVITATION_ZIP_LIMIT+1}), /limit/u);
});

test('preview checks one selected list and returns fixed eligibility without mutating or retrying', async () => {
  const calls=[];
  const result=await previewBatchInvitations({contactIds:['contact_1','contact_2'],expectedContactRevision:7,request:async(path,options)=>{
    calls.push([path,options]); return {contactRevision:7,previewToken:'synthetic-token',entries:[{contactId:'contact_2',eligible:false,reason:'CONTACT_DECLINED'},
      {contactId:'contact_1',eligible:true,registrationId:'registration_1',referenceCode:'reference_1'}]};
  }});
  assert.deepEqual(result.summary,{selected:2,eligible:1,skipped:1});
  assert.equal(result.entries[0].contactId,'contact_1');
  assert.equal(calls.length,1); assert.equal(calls[0][0],'/api/admin/contacts/invitations/preview');
  assert.deepEqual(JSON.parse(calls[0][1].body),{contactIds:['contact_1','contact_2'],expectedContactRevision:7});
});

test('selection bounds and incomplete/stale server results fail before preparation/rendering', async () => {
  let calls=0;
  const request=async()=>{calls++;return {};};
  for(const contactIds of [[],['contact_1','contact_1'],Array.from({length:101},(_,i)=>'contact_'+i),['../a']]) {
    await assert.rejects(previewBatchInvitations({contactIds,expectedContactRevision:7,request}), /名单或版本/u);
  }
  assert.equal(calls,0);
  await assert.rejects(prepare([entry('contact_1')],{request:async()=>({contactRevision:6,results:[entry('contact_1')]})}), /响应不完整/u);
  await assert.rejects(prepare([entry('contact_1')],{request:async()=>({contactRevision:7,results:[]})}), /响应不完整/u);
  await assert.rejects(prepare([entry('contact_1')],{request:async()=>({contactRevision:7,results:[{...entry('contact_1'),status:'delivered'}]})}), /状态不明/u);
});

test('explicit manual prepare renders sequentially, includes each result and private formula-safe dispatch checklist without send writes', async () => {
  let active=0,peak=0;const calls=[],renders=[],progress=[];
  const results=[entry('contact_1'),entry('contact_2','replayed'),entry('contact_3','skipped'),entry('contact_4','failed'),entry('contact_5','unknown')];
  results[0].invitation.content.settings.recipientName='=synthetic formula';
  results[1].invitation.status='manually_sent';
  const result=await prepare(results,{request:async(path,options)=>{calls.push([path,JSON.parse(options.body)]);return{contactRevision:7,results};},
    renderInvitation:async(inv)=>{active++;peak=Math.max(peak,active);renders.push(inv.id);await Promise.resolve();active--;return png();},onProgress:value=>progress.push(value)});
  assert.equal(peak,1);assert.equal(calls.length,1);assert.equal(calls[0][0],'/api/admin/contacts/invitations/prepare-batch');
  assert.equal(calls[0][1].confirmPrepare,true);assert.equal(calls[0][1].previewToken,'synthetic-token');
  assert.equal(renders.length,2);assert.deepEqual(result.results.map(item=>item.pngStatus),['created','created','skipped','skipped','skipped']);
  assert.equal(result.summary.pngCreated,2);assert.equal(result.summary.unknown,1);assert.equal(result.results[1].invitation.status,'manually_sent');
  const files=await readZip(result.blob);assert.equal(files.size,4);
  const metadata=JSON.parse(decoder.decode(files.get('results-private.json')));
  assert.equal(metadata.batchPerformedSending,false);assert.equal(metadata.downloadMarksSent,false);assert.equal(metadata.results.length,5);
  const checklist=decoder.decode(files.get('dispatch-checklist-private.csv'));
  assert.ok(checklist.includes('actualDispatchChannel'));assert.ok(checklist.includes("'=synthetic formula"));
  assert.equal(progress.at(-1).phase,'complete');
});

test('renderer failures are private per-person failures and do not discard successful PNGs', async () => {
  const result=await prepare([entry('contact_1'),entry('contact_2'),entry('contact_3')],{renderInvitation:async(inv)=>{
    if(inv.id==='i_contact_1')throw new Error('PRIVATE raw renderer diagnostic');
    if(inv.id==='i_contact_2')return new Blob(['not a PNG'],{type:'image/png'});
    return png();
  }});
  assert.equal(result.summary.pngFailed,2);assert.equal(result.summary.pngCreated,1);
  const files=await readZip(result.blob);assert.equal(files.size,3);
  const metadata=decoder.decode(files.get('results-private.json'));
  assert.doesNotMatch(metadata,/PRIVATE raw renderer diagnostic/u);assert.match(metadata,/PNG_RENDER_FAILED/u);
});

test('PNG budget exhaustion stops later rendering and never allocates oversized PNG data', async () => {
  let calls=0,reads=0;
  class LargePng extends Blob { get size(){return PRIVATE_INVITATION_ZIP_LIMIT+1;} async arrayBuffer(){reads++;throw new Error('must not allocate');} }
  const result=await prepare([entry('contact_1'),entry('contact_2')],{renderInvitation:async()=>{calls++;return new LargePng([PNG],{type:'image/png'});}});
  assert.equal(calls,1);assert.equal(reads,0);assert.equal(result.summary.pngCreated,0);assert.equal(result.summary.pngFailed,2);
  assert.ok(result.results.every(item=>item.pngError==='ZIP_SIZE_LIMIT'));
  assert.equal((await readZip(result.blob)).size,2);
});

test('email/unknown invitations are never rendered and unknown HTTP acknowledgements are never automatically retried', async () => {
  let calls=0,renders=0;
  await assert.rejects(prepare([entry('contact_1')],{request:async()=>{calls++;throw new Error('unknown ACK');},renderInvitation:async()=>{renders++;return png();}}),/unknown ACK/u);
  assert.equal(calls,1);assert.equal(renders,0);
  const email=entry('contact_1');email.invitation.channel='email';email.invitation.status='provider_accepted';
  await assert.rejects(prepare([email],{renderInvitation:async()=>{renders++;return png();}}),/内容无效/u);
  assert.equal(renders,0);
  const result=await prepare([entry('contact_1','unknown')],{renderInvitation:async()=>{renders++;return png();}});
  assert.equal(renders,0);assert.equal(result.summary.unknown,1);
  assert.equal((await readZip(result.blob)).size,2);
});

test('explicit poster version is bound to both batch requests and retained in private records', async () => {
  const renderVersion='ggj2026-poster-v2',calls=[];
  const preview=await previewBatchInvitations({contactIds:['contact_1'],expectedContactRevision:7,renderVersion,request:async(path,options)=>{
    calls.push([path,JSON.parse(options.body)]);return{contactRevision:7,previewToken:'synthetic-version-token',entries:[{contactId:'contact_1',eligible:true,registrationId:'registration_1',referenceCode:'reference_1'}]};
  }});
  assert.equal(preview.renderVersion,renderVersion);
  assert.deepEqual(calls[0][1],{contactIds:['contact_1'],expectedContactRevision:7,renderVersion});
  const resultEntry=entry('contact_1');resultEntry.invitation.content.settings.renderVersion=renderVersion;
  const result=await prepare([resultEntry],{renderVersion:preview.renderVersion,previewToken:preview.previewToken,request:async(path,options)=>{
    calls.push([path,JSON.parse(options.body)]);return{contactRevision:7,results:[resultEntry]};
  },renderInvitation:async value=>{assert.equal(value.content.settings.renderVersion,renderVersion);return png();}});
  assert.deepEqual(calls[1][1],{contactIds:['contact_1'],expectedContactRevision:7,previewToken:'synthetic-version-token',confirmPrepare:true,renderVersion});
  const files=await readZip(result.blob),metadata=JSON.parse(decoder.decode(files.get('results-private.json')));
  assert.equal(metadata.results[0].renderVersion,renderVersion);assert.match(decoder.decode(files.get('dispatch-checklist-private.csv')),/ggj2026-poster-v2/u);
  assert.equal(metadata.batchPerformedSending,false);assert.equal(metadata.downloadMarksSent,false);
});

test('unknown versions fail before I/O and mismatched saved image versions fail before rendering', async () => {
  let calls=0,renders=0;const request=async()=>{calls++;return{};};
  for(const renderVersion of [null,'legacy','unknown',{},42]){
    await assert.rejects(previewBatchInvitations({contactIds:['contact_1'],expectedContactRevision:7,renderVersion,request}),/版本无效/u);
    await assert.rejects(prepare([entry('contact_1')],{renderVersion,request}),/版本无效/u);
  }
  assert.equal(calls,0);
  await assert.rejects(prepare([entry('contact_1')],{renderVersion:'ggj2026-poster-v2',renderInvitation:async()=>{renders++;return png();}}),/内容无效/u);
  const changed=entry('contact_1');changed.invitation.content.settings.renderVersion='ggj2026-poster-v2';
  await assert.rejects(prepare([changed],{renderInvitation:async()=>{renders++;return png();}}),/内容无效/u);
  assert.equal(renders,0);
});

test('leading underscore and dash registration tokens survive preview, preparation and private manifest without relaxing contact IDs', async () => {
  const registrationId='_'+'A'.repeat(42),referenceCode='-'+'b'.repeat(42),renderVersion='ggj2026-poster-v2';
  const preview=await previewBatchInvitations({contactIds:['contact_1'],expectedContactRevision:7,renderVersion,request:async()=>({contactRevision:7,previewToken:'synthetic-token',entries:[{contactId:'contact_1',eligible:true,registrationId,referenceCode}]})});
  assert.equal(preview.entries[0].registrationId,registrationId);assert.equal(preview.entries[0].referenceCode,referenceCode);
  const resultEntry=entry('contact_1');Object.assign(resultEntry.invitation,{registrationId,referenceCode});resultEntry.invitation.content.settings.renderVersion=renderVersion;
  const result=await prepare([resultEntry],{renderVersion});const files=await readZip(result.blob),metadata=JSON.parse(decoder.decode(files.get('results-private.json')));
  assert.equal(result.summary.pngCreated,1);assert.equal(metadata.results[0].registrationId,registrationId);assert.equal(metadata.results[0].referenceCode,referenceCode);
  let calls=0;await assert.rejects(previewBatchInvitations({contactIds:['_contact'],expectedContactRevision:7,request:async()=>{calls++;}}),/名单或版本/u);assert.equal(calls,0);
  for(const token of ['../bad','~bad','A'.repeat(101)])await assert.rejects(previewBatchInvitations({contactIds:['contact_1'],expectedContactRevision:7,request:async()=>({contactRevision:7,previewToken:'synthetic-token',entries:[{contactId:'contact_1',eligible:true,registrationId:token,referenceCode}]})}),/预检无效/u);
});
