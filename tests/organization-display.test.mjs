import test from 'node:test';
import assert from 'node:assert/strict';
import {publicOrganizationCards,organizationParticipationLabel,organizationReferenceKey,orderOrganizationCards,organizationLogoVariant} from '../shared/organization-display.mjs';
import {createDefaultOrganizations,exhibitingPartners} from '../src/config/exhibiting-partners.mjs';

const logoId='a'.repeat(64)+'.png';
const card=(changes={})=>({id:'synthetic-organization',name:'合成组织',participation:'attendee',website:'https://example.invalid/team',logoUrl:'/api/public/portraits/'+logoId,status:'confirmed',publicConsent:true,...changes});

test('reference logo artwork binds to one reviewed public digest and respects replacement or removal',()=>{
  const original=card({id:'igda-shenzhen'}),before=JSON.stringify(original),variants={igda:{sourceDigest:'a'.repeat(64),url:'/_astro/organization-igda.synthetic.png'}};
  assert.equal(organizationLogoVariant(original,variants),variants.igda.url);
  assert.equal(organizationLogoVariant({...original,logoUrl:'/api/public/portraits/'+'b'.repeat(64)+'.png'},variants),null);
  assert.equal(organizationLogoVariant({...original,logoUrl:''},variants),null);
  assert.equal(organizationLogoVariant(card(),variants),null);
  assert.equal(JSON.stringify(original),before);
});
test('the reviewed public campus records keep their artwork keys without relying on edited names',()=>{
  for(const [id,key] of [['organization-030b43f23f33413c8f81ed1fcd1d282d','bu'],['organization-61fee7cdf16f439a85f071b0e553ed4e','teesside'],['organization-668f234fcd2640a1a35dab8f0fc63bf3','szdx']]){
    const input=card({id,name:'合成修改后的公开名称'}),before=JSON.stringify(input);
    assert.equal(organizationReferenceKey(input),key);assert.equal(JSON.stringify(input),before);
  }
});
test('reference logo mapping cannot select external or unsafe URLs or invoke supplied getters',()=>{
  const original=card({id:'igda-shenzhen'});
  for(const url of ['//other.invalid/image.png','https://other.invalid/image.png','/../private.png','/image\\private.png','/image\n.png'])assert.equal(organizationLogoVariant(original,{igda:{sourceDigest:'a'.repeat(64),url}}),null);
  const variants={};Object.defineProperty(variants,'igda',{get(){throw Error('must not invoke');}});
  assert.equal(organizationLogoVariant(original,variants),null);
});

test('organization ordering preserves the complete public array even when all seven known brands are shuffled',()=>{
  const input=Object.freeze([
    card({id:'g4c-hk',name:'G4C HK'}),card({id:'pengyou-gangwan',name:'鹏游港湾'}),
    card({id:'game-singularity',name:'游戏奇点'}),card({id:'igda-shenzhen',name:'IGDA 深圳'}),
    card({id:'synthetic-bu',name:'Bournemouth University'}),card({id:'synthetic-teesside',name:'英国提赛德大学'}),
    card({id:'synthetic-szdx',name:'深圳大学艺术学部'}),
  ].map(Object.freeze));
  const before=JSON.stringify(input),ordered=orderOrganizationCards(input);
  assert.deepEqual(ordered,input,'brand recognition never changes the published array order');
  assert.deepEqual(ordered.map(organizationReferenceKey),['g4c','pengyou','gamezone','igda','bu','teesside','szdx']);
  assert.equal(JSON.stringify(input),before);
  assert.notEqual(ordered,input);
  assert.ok(ordered.every((item,index)=>item===input[index]), 'ordering neither rewrites nor replaces any original card');
});

test('reference keys use explicit IDs or whole known aliases with only case and whitespace normalization',()=>{
  for(const [name,key]of[
    ['  GAMEZONE  ','gamezone'],['游戏奇点','gamezone'],['IGDA   深圳','igda'],['igda shenzhen','igda'],
    ['深圳大学艺术学部','szdx'],['bu','bu'],['  Bournemouth   University  ','bu'],['BournemouthUniversity','bu'],['伯恩茅斯大学','bu'],
    ['鹏游港湾','pengyou'],['g4c   hk','g4c'],['TEESSIDE UNIVERSITY','teesside'],['TeessideUniversity','teesside'],['提赛德大学','teesside'],['英国提赛德大学','teesside'],
  ])assert.equal(organizationReferenceKey({id:'synthetic-new-id',name}),key,name);
  for(const [id,key]of[['g4c-hk','g4c'],['pengyou-gangwan','pengyou'],['game-singularity','gamezone'],['igda-shenzhen','igda']]){
    assert.equal(organizationReferenceKey({id,name:'合成更新后的显示名称'}),key);
  }
  assert.equal(organizationReferenceKey({id:'g4c-hk',name:'GameZone'}),'g4c','a saved ID takes precedence without merging identities');
});

test('unknown and repeated brands remain in the full public input order without deduplication',()=>{
  const unknownA=card({id:'unknown-a'}),knownA=card({id:'known-a',name:'BU'}),unknownB=card({id:'unknown-b'}),knownB=card({id:'known-b',name:'伯恩茅斯大学'});
  const input=[unknownA,knownA,unknownB,knownB],before=JSON.stringify(input);
  assert.deepEqual(orderOrganizationCards(input),input);
  assert.equal(JSON.stringify(input),before);
  assert.deepEqual(orderOrganizationCards([knownA,unknownA,knownA]),[knownA,unknownA,knownA],'the ordering helper does not merge repeated entries');
  assert.deepEqual(orderOrganizationCards([unknownA,unknownB]),[unknownA,unknownB]);
  assert.deepEqual(orderOrganizationCards(null),[]);
});

test('near names and supplied getters never impersonate a known reference organization',()=>{
  for(const name of['Official GameZone','GameZone Partner','IGDA 深圳赞助方','深圳大学艺术学部合作方','深圳大学艺术学部（未核实）','BU Partner','Bournemouth University Alumni','Teesside University Sponsor','提赛德大学合作方','ＢＵ','Game\u200bZone']){
    assert.equal(organizationReferenceKey({id:'unknown',name}),null,name);
  }
  for(const value of[null,undefined,[],{}, {id:'__proto__',name:'unknown'}])assert.equal(organizationReferenceKey(value),null);
  const accessor={};for(const key of['id','name'])Object.defineProperty(accessor,key,{get(){assert.fail('visual ordering must not invoke field getters');}});
  assert.equal(organizationReferenceKey(accessor),null);
});

test('organization display keeps public order and distinct participation without copying private data',()=>{
  const input=[card({status:'confirmed',publicConsent:true,logoId,internalNotes:'PRIVATE',contactName:'PRIVATE'}),card({id:'synthetic-exhibitor',participation:'exhibitor',website:'',logoUrl:''})];
  const projected=publicOrganizationCards(input);
  assert.deepEqual(projected,input.map(({id,name,participation,website,logoUrl})=>({id,name,participation,website,logoUrl})));
  assert.doesNotMatch(JSON.stringify(projected),/PRIVATE|internalNotes|contactName|publicConsent|status/u);
  assert.equal(organizationParticipationLabel(projected[0].participation),'一般参与');assert.equal(organizationParticipationLabel(projected[1].participation),'参展');
  assert.equal(organizationParticipationLabel('undecided'),'');assert.equal(organizationParticipationLabel('__proto__'),'');
});

test('unsafe links and foreign or mismatched logo URLs are omitted while the authorized name stays readable',()=>{
  for(const website of ['javascript:alert(1)','data:text/html,hello','https://staff:password@example.invalid/','https://example.invalid/a\nb','https:\\example.invalid/']){
    assert.equal(publicOrganizationCards([card({website})])[0].website,'');
  }
  for(const logoUrl of ['https://example.invalid/logo.png','//example.invalid/logo.png','/api/admin/portraits/'+logoId,'/api/public/portraits/'+logoId+'?secret=value','/api/public/portraits/../private.png']){
    assert.equal(publicOrganizationCards([card({logoUrl})])[0].logoUrl,'');
  }
  assert.equal(publicOrganizationCards([card({logoId:'b'.repeat(64)+'.png'})])[0].logoUrl,'');
  assert.equal(publicOrganizationCards([card({website:'http://example.invalid/team'})])[0].website,'http://example.invalid/team');
});

test('invalid, duplicate and explicitly nonpublic organizations never become display entries',()=>{
  const original=card();
  assert.equal(publicOrganizationCards([original,original]).length,1);
  for(const change of [{id:'../other'},{name:''},{name:'bad\nname'},{name:'字'.repeat(161)},{participation:'sponsor'},{status:'invalid'},{visibility:'private'},{visibility:undefined}])assert.deepEqual(publicOrganizationCards([card(change)]),[]);
  let read=false;const accessor=card();Object.defineProperty(accessor,'name',{get(){read=true;return 'PRIVATE';}});
  assert.deepEqual(publicOrganizationCards([accessor]),[]);assert.equal(read,false);
  assert.deepEqual(publicOrganizationCards(Array(201).fill(original)),[]);assert.deepEqual(publicOrganizationCards(null),[]);
});

test('pending and withdrawn organizations retain public names until manually hidden without implying confirmation',()=>{
  for(const status of ['pending','withdrawn']){
    const value=card({status,publicConsent:false,logoUrl:'',website:''});
    const result=publicOrganizationCards([value]);assert.equal(result.length,1);assert.equal(result[0].status,status);
    assert.deepEqual(publicOrganizationCards([{...value,visibility:'private'}]),[]);
    assert.equal(publicOrganizationCards([{...value,visibility:'public'}]).length,1);
  }
  const accessor=card();Object.defineProperty(accessor,'visibility',{get(){assert.fail('visibility getter must not execute');}});
  assert.deepEqual(publicOrganizationCards([accessor]),[]);
});

test('legacy defaults are fresh name-only records and never infer exhibition or organization websites',()=>{
  const first=createDefaultOrganizations(),second=createDefaultOrganizations();
  assert.deepEqual(first.map(({id,name})=>({id,name})),exhibitingPartners);
  assert.ok(first.every(item=>item.logoId===''&&item.website===''&&item.participation==='undecided'));
  first[0].name='changed';assert.notEqual(first[0].name,second[0].name);assert.notEqual(first[0].name,exhibitingPartners[0].name);
});
