import test from 'node:test';
import assert from 'node:assert/strict';
import {createPeopleNavigation,validPeopleNavigation,peopleSelectionHref,peopleReturnHref,peopleNextSelection} from '../src/lib/people-directory.mjs';
const user={id:'synthetic-owner',roles:['reviewer','outreach']};
const input=()=>({view:'speakers',query:'合成私有查询@example.invalid',work:'pending',cursor:'cursor_1',trail:[''],revision:'a'.repeat(64),ids:['contact:synthetic-a','registration:'+'r'.repeat(43)],selected:'contact:synthetic-a',focus:'contact:synthetic-a',scrollY:860});
test('next person uses the surviving original successor and never wraps after a removed row or stale cursor',()=>{
  const original=['contact:a','contact:b','contact:c','contact:d'];
  assert.equal(peopleNextSelection(original,'contact:b',['contact:a','contact:c','contact:d']),'contact:c');
  assert.equal(peopleNextSelection(original,'contact:b',['contact:a','contact:d']),'contact:d');
  assert.equal(peopleNextSelection(original,'contact:d',['contact:a','contact:b','contact:c']),null);
  assert.equal(peopleNextSelection(original,'contact:b',['contact:x','contact:y']),null);
  assert.equal(peopleNextSelection(original,'contact:b',original),'contact:c');
});
function fixture(){const values=new Map(),storage={getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value),removeItem:key=>values.delete(key)};let now=100000;return{values,storage,nav:createPeopleNavigation({storage,eventId:'synthetic-event',clock:()=>now}),advance:ms=>{now+=ms;}};}
test('same-tab context restores only exact actor, role set, event, view and selected stable ID',()=>{
  const f=fixture();assert.equal(f.nav.save(user,input()),true);const value=f.nav.read({...user,roles:[...user.roles].reverse()},{view:'speakers',selection:'contact:synthetic-a'});assert.ok(value);assert.equal(value.query,input().query);assert.equal(value.scrollY,860);
  assert.equal(validPeopleNavigation(value,{...user,id:'another'},{eventId:'synthetic-event',now:100000}),false);
  assert.equal(validPeopleNavigation(value,{...user,roles:['reviewer']},{eventId:'synthetic-event',now:100000}),false);
  assert.equal(validPeopleNavigation(value,user,{eventId:'other-event',now:100000}),false);
  assert.equal(f.nav.read(user,{view:'guests'}),null);assert.equal(f.values.size,0);
});
test('navigation is bounded, short-lived and cannot persist list previews or capabilities',()=>{
  const f=fixture();for(const bad of [{...input(),name:'PRIVATE'},{...input(),recipient:'private@example.invalid'},{...input(),ids:Array.from({length:51},(_,i)=>'contact:row-'+i)},{...input(),query:'https://artdico.host/registration/confirmation/#r=c1.private'},{...input(),query:'v1.'+'a'.repeat(100)},{...input(),cursor:'../private'},{...input(),scrollY:3000000}])assert.equal(f.nav.save(user,bad),false);
  assert.equal(f.nav.save(user,input()),true);assert.equal(f.values.size,1);const raw=[...f.values.values()][0];assert.equal(raw.includes('confirmationUrl'),false);assert.equal(raw.includes('recipient'),false);
  f.advance(30*60*1000+1);assert.equal(f.nav.read(user),null);assert.equal(f.values.size,0);
});
test('clear removes sensitive query and denied storage never claims successful retention',()=>{
  const f=fixture();f.nav.save(user,input());f.nav.clear();assert.equal(f.values.size,0);
  const unavailable=createPeopleNavigation({storage:{getItem(){throw Error();},setItem(){throw Error();},removeItem(){throw Error();}}});assert.equal(unavailable.save(user,input()),false);assert.equal(unavailable.read(user),null);
  assert.equal(peopleSelectionHref('contact:synthetic-a'),'/admin/person/#contact=synthetic-a');assert.equal(peopleSelectionHref('registration:'+'r'.repeat(43)),'/admin/person/#registration='+'r'.repeat(43));assert.equal(peopleSelectionHref('https://private.invalid'),null);
  assert.equal(peopleReturnHref('speakers'),'/admin/contacts/#people=speakers');assert.equal(peopleReturnHref('registrations'),'/admin/registrations/');assert.equal(peopleReturnHref('private'),null);
});
