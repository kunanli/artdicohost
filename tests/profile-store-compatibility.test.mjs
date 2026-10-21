import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {createFileContentStore} from '../functions/content-api/store.mjs';
import {createOssContentStore} from '../functions/cloud-content/store.mjs';
import {CloudContentError} from '../functions/cloud-content/errors.mjs';
const now=()=>Date.parse('2026-10-21T00:00:00Z'),actor='synthetic-editor';
const extras={title:'合成职称',bio:'合成人物简介',website:'https://example.invalid/person',publicRoles:['speaker','organizer']};
const portraitId='a'.repeat(64)+'.jpg',portraitStore={verify:async id=>({id,contentType:'image/jpeg',bytes:100})};
for(const kind of ['local','cloud'])test(`${kind} legacy saves retain optional profile and organization fields; explicit clears and stale revisions remain distinct`,async t=>{
 let make;
 if(kind==='local'){
  const directory=await mkdtemp(join(tmpdir(),'artdico-profile-fields-'));t.after(()=>rm(directory,{recursive:true,force:true}));
  make=()=>createFileContentStore({directory,now,portraitStore});
 }else{
  let value=null,cursor={position:0,version:0,hash:null};
  make=()=>createOssContentStore({now,portraitStore,journal:{
   read:async()=>structuredClone({value,cursor}),
   async commit(expected,next){if(JSON.stringify(expected)!==JSON.stringify(cursor))throw new CloudContentError('WRITE_CONFLICT','conflict',409);value=structuredClone(next);cursor={position:cursor.position+1,version:cursor.version+1,hash:createHash('sha256').update(JSON.stringify(value)).digest('hex')};return structuredClone({value,cursor});},
  }});
 }
 const first=make(),initial=await first.read(),content=initial.draft.content;
 content.guests=[{id:'synthetic-person',name:'合成嘉宾',company:'合成机构',ggjRole:'',portraitId,status:'confirmed',publicConsent:true,internalNotes:'PRIVATE-ORIGINAL',contactId:'PRIVATE-ID',...extras}];
 content.booths=[{id:'synthetic-booth',code:'C01',zone:'C',slotNumber:1,organization:'合成组织',project:'合成展示',status:'confirmed',internalNotes:'PRIVATE-BOOTH',website:'https://example.invalid/org'}];
 const saved=await first.save(initial.draft.revision,content,actor);await first.publish(saved.revision,actor);
 const legacy=structuredClone(saved.content);for(const key of Object.keys(extras))delete legacy.guests[0][key];delete legacy.booths[0].website;
 legacy.guests[0].ggjRole='旧客户端合法修改';
 const preserved=await make().save(saved.revision,legacy,actor);
 for(const[key,value]of Object.entries(extras))assert.deepEqual(preserved.content.guests[0][key],value);
 assert.equal(preserved.content.guests[0].internalNotes,'PRIVATE-ORIGINAL');assert.equal(preserved.content.booths[0].website,'https://example.invalid/org');
 await assert.rejects(first.save(saved.revision,legacy,actor),error=>error.code==='REVISION_CONFLICT');
 const reloaded=await make().read();assert.deepEqual(reloaded.published.content.guests[0].publicRoles,['speaker','organizer']);assert.equal(reloaded.published.content.guests[0].website,extras.website);
 const clearing=structuredClone(preserved.content);for(const key of ['title','bio','website'])clearing.guests[0][key]='';clearing.guests[0].publicRoles=[];clearing.booths[0].website='';
 const cleared=await make().save(preserved.revision,clearing,actor);
 assert.deepEqual(cleared.content.guests[0].publicRoles,[]);assert.equal(cleared.content.guests[0].bio,'');assert.equal(cleared.content.booths[0].website,'');
 assert.deepEqual((await make().read()).published.content.guests[0].publicRoles,['speaker','organizer'],'saving a draft does not change the live profile');
});
