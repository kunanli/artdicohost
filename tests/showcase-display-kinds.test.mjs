import test from 'node:test';
import assert from 'node:assert/strict';
import {publicShowcaseCards,SHOWCASE_KIND_LABELS} from '../shared/showcase-display.mjs';
const work=(id='synthetic-work',extra={})=>({id,title:'合成游戏',teamName:'合成创作者',summary:'合成介绍',coverId:'a'.repeat(64)+'.png',status:'confirmed',responseStatus:'attending',publicConsent:true,participationForms:['booth'],boothId:'synthetic-shared-booth',sessionId:'',...extra});

test('legacy kind is a display-only student default; explicit kinds and links never mutate public source',()=>{
  const legacy=work(),copy=JSON.stringify(legacy);assert.equal(publicShowcaseCards([legacy])[0].kind,'student');assert.equal(JSON.stringify(legacy),copy);assert.equal(Object.hasOwn(legacy,'kind'),false);
  for(const kind of ['student','indie','team'])assert.equal(publicShowcaseCards([work(kind,{kind,organizationId:'synthetic-org'})])[0].kind,kind);
  assert.deepEqual(Object.keys(SHOWCASE_KIND_LABELS),['student','indie','team']);
  assert.equal(publicShowcaseCards([work('linked',{organizationId:'synthetic-org'})])[0].organizationId,'synthetic-org');
  assert.equal(Object.hasOwn(publicShowcaseCards([work('unlinked',{organizationId:''})])[0],'organizationId'),false);
});

test('malformed own metadata cannot become legacy defaults or execute getters',()=>{
  for(const kind of [null,undefined,'','other',1,[],{}])assert.deepEqual(publicShowcaseCards([work('invalid',{kind})]),[]);
  for(const organizationId of [null,undefined,'../private',1,[],{}])assert.deepEqual(publicShowcaseCards([work('invalid',{organizationId})]),[]);
  let reads=0;for(const field of ['kind','organizationId']){const value=work();Object.defineProperty(value,field,{enumerable:true,get(){reads++;return 'student';}});assert.deepEqual(publicShowcaseCards([value]),[]);}assert.equal(reads,0);
});

test('stable work IDs deduplicate independently of many works sharing a booth and strip private material',()=>{
  const result=publicShowcaseCards([work('one',{kind:'student',email:'PRIVATE_EMAIL',materialLinks:'https://private.invalid'}),work('two',{kind:'indie'}),work('three',{kind:'team'}),work('two',{title:'Duplicate'})]);
  assert.deepEqual(result.map(item=>item.id),['one','two','three']);assert.equal(new Set(result.map(item=>item.boothId)).size,1);assert.doesNotMatch(JSON.stringify(result),/PRIVATE|private\.invalid|materialLinks|email/u);
});

test('default public works remain visible without attendance, cover or assigned display, with factual status',()=>{
  const value=work('unfinished',{status:'pending',responseStatus:'pending',publicConsent:false,title:'',teamName:'',coverId:'',boothId:'',participationForms:[]});
  const original=JSON.stringify(value),cards=publicShowcaseCards([value]);
  assert.equal(cards.length,1);assert.equal(cards[0].title,'作品名称待补');assert.equal(cards[0].coverUrl,'');
  assert.equal(cards[0].boothId,'');assert.equal(cards[0].sessionId,'');assert.equal(cards[0].status,'pending');assert.equal(cards[0].responseStatus,'pending');
  assert.equal(JSON.stringify(value),original);assert.deepEqual(publicShowcaseCards([{...value,visibility:'private'}]),[]);
  assert.equal(publicShowcaseCards([{...value,visibility:'public'}]).length,1);
  assert.equal(publicShowcaseCards([work('declined',{responseStatus:'declined'})])[0].responseStatus,'declined');
  for(const visibility of [undefined,null,'',false,'PRIVATE'])assert.deepEqual(publicShowcaseCards([{...value,visibility}]),[]);
  const accessor=work();Object.defineProperty(accessor,'visibility',{get(){assert.fail('visibility getter must not execute');}});assert.deepEqual(publicShowcaseCards([accessor]),[]);
});
