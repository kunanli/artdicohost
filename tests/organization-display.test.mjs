import test from 'node:test';
import assert from 'node:assert/strict';
import {publicOrganizationCards,organizationParticipationLabel} from '../shared/organization-display.mjs';
import {createDefaultOrganizations,exhibitingPartners} from '../src/config/exhibiting-partners.mjs';

const logoId='a'.repeat(64)+'.png';
const card=(changes={})=>({id:'synthetic-organization',name:'合成组织',participation:'attendee',website:'https://example.invalid/team',logoUrl:'/api/public/portraits/'+logoId,status:'confirmed',publicConsent:true,...changes});

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
  for(const change of [{id:'../other'},{name:''},{name:'bad\nname'},{name:'字'.repeat(161)},{participation:'sponsor'},{status:'withdrawn'},{publicConsent:false}])assert.deepEqual(publicOrganizationCards([card(change)]),[]);
  let read=false;const accessor=card();Object.defineProperty(accessor,'name',{get(){read=true;return 'PRIVATE';}});
  assert.deepEqual(publicOrganizationCards([accessor]),[]);assert.equal(read,false);
  assert.deepEqual(publicOrganizationCards(Array(201).fill(original)),[]);assert.deepEqual(publicOrganizationCards(null),[]);
});

test('legacy defaults are fresh name-only records and never infer exhibition or organization websites',()=>{
  const first=createDefaultOrganizations(),second=createDefaultOrganizations();
  assert.deepEqual(first.map(({id,name})=>({id,name})),exhibitingPartners);
  assert.ok(first.every(item=>item.logoId===''&&item.website===''&&item.participation==='undecided'));
  first[0].name='changed';assert.notEqual(first[0].name,second[0].name);assert.notEqual(first[0].name,exhibitingPartners[0].name);
});
