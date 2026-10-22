import test from 'node:test';
import assert from 'node:assert/strict';
import {createInitialContent} from '../src/config/content.mjs';
import {validateContent,toPublicContent} from '../shared/content-schema.mjs';
import {publicGuestCards,publicGuestSessions} from '../shared/guest-display.mjs';
const profile={title:'合成策展人',bio:'合成人物简介。\n仅用于测试。',website:'https://example.invalid/people',publicRoles:['speaker','organizer']};
const person=()=>({id:'synthetic-person',name:'合成嘉宾',company:'合成机构',ggjRole:'',portraitId:'a'.repeat(64)+'.jpg',status:'confirmed',publicConsent:true,contactId:'PRIVATE-CONTACT-ID',internalNotes:'PRIVATE-NOTES'});
function fixture(){const content=createInitialContent();content.guests=[person()];return content;}

test('optional public profile fields leave historical normalized and published shapes unchanged',()=>{
 const content=fixture(),normalized=validateContent(content).value,published=toPublicContent(content);
 for(const key of Object.keys(profile)){assert.equal(Object.hasOwn(normalized.guests[0],key),false);assert.equal(Object.hasOwn(published.guests[0],key),false);}
 assert.deepEqual(toPublicContent(published),published);
 assert.deepEqual(publicGuestCards(published.guests)[0],{id:'synthetic-person',name:'合成嘉宾',company:'合成机构',ggjRole:'',portraitId:'a'.repeat(64)+'.jpg',portraitUrl:'/api/public/portraits/'+'a'.repeat(64)+'.jpg'});
});
test('profile fields follow public visibility while preserving confirmation and consent facts',()=>{
 const content=fixture();Object.assign(content.guests[0],profile);
 const published=toPublicContent(content),card=publicGuestCards(published.guests)[0];
 for(const[key,value]of Object.entries(profile))assert.deepEqual(card[key],value);
 assert.doesNotMatch(JSON.stringify(published),/PRIVATE-/u);assert.deepEqual(toPublicContent(published),published);
 for(const changes of [{publicConsent:false},{status:'pending'},{portraitId:'',publicConsent:false}]){const copy=structuredClone(content);Object.assign(copy.guests[0],changes);const visible=toPublicContent(copy).guests[0];assert.ok(visible);assert.equal(visible.status,copy.guests[0].status);assert.equal(visible.publicConsent,copy.guests[0].publicConsent);copy.guests[0].visibility='private';assert.deepEqual(toPublicContent(copy).guests,[]);}
 assert.equal(content.guests[0].contactId,'PRIVATE-CONTACT-ID');
});
test('malformed role lists, oversized descriptions and active or credential-bearing sites cannot enter publication',()=>{
 const bad=[{publicRoles:['speaker','speaker']},{publicRoles:['sponsor']},{publicRoles:'speaker'},{publicRoles:[1]},{title:'bad\nline'},{bio:'bad\u0000text'},{bio:'字'.repeat(4001)},{website:'javascript:alert(1)'},{website:'https://user:password@example.invalid'},{website:'https://example.invalid/\ntrack'}];
 for(const supplied of bad){const content=fixture();Object.assign(content.guests[0],supplied);assert.equal(validateContent(content).valid,false,JSON.stringify(supplied));assert.throws(()=>toPublicContent(content));assert.deepEqual(publicGuestCards(content.guests),[]);}
 const accessor=person();Object.defineProperty(accessor,'bio',{enumerable:true,get(){assert.fail('profile display must not execute getters');}});assert.deepEqual(publicGuestCards([accessor]),[]);
});
test('published session associations show only real scheduled links and no private scheduling fields',()=>{
 const content=fixture();const session=content.sessions.find(item=>item.status==='scheduled');
 Object.assign(session,{guestId:'synthetic-person',internalNotes:'PRIVATE-SESSION'});
 const published=toPublicContent(content),cards=publicGuestSessions(published.sessions,'synthetic-person');assert.equal(cards.length,1);assert.equal(cards[0].id,session.id);assert.doesNotMatch(JSON.stringify(cards),/PRIVATE-|guestId|speakerStatus/u);
 assert.deepEqual(publicGuestSessions([{...published.sessions.find(item=>item.id===session.id),status:'cancelled'}],'synthetic-person'),[]);
 assert.deepEqual(publicGuestSessions([{...published.sessions.find(item=>item.id===session.id),speakerStatus:'pending'}],'synthetic-person'),[]);
 assert.deepEqual(publicGuestSessions(published.sessions,'another-person'),[]);
});
test('confirmed organization website is optional, validated and never includes private booth contact fields',()=>{
 const content=fixture();content.booths=[{id:'synthetic-booth',code:'C01',zone:'C',slotNumber:1,organization:'合成组织',project:'合成项目',description:'公开展示内容',website:'https://example.invalid/org',contactName:'PRIVATE-PERSON',contactMethods:'PRIVATE-CONTACT',status:'confirmed',internalNotes:'PRIVATE-BOOTH'}];
 const published=toPublicContent(content);assert.equal(published.booths[0].website,'https://example.invalid/org');assert.doesNotMatch(JSON.stringify(published),/PRIVATE-/u);assert.deepEqual(toPublicContent(published),published);
 for(const website of ['javascript:alert(1)','https://user@example.invalid',42]){content.booths[0].website=website;assert.equal(validateContent(content).valid,false);}
});
