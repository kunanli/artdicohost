import test from 'node:test';
import assert from 'node:assert/strict';
import { renderRegistrationSuccess } from '../src/scripts/registration-success.mjs';

class Element {
  constructor(){this.hidden=false;this.textContent='';this.children=[];this.removed=[];}
  matches(value){return value==='[data-registration-success]';}
  querySelector(selector){return this.fields?.[selector]??null;}
  querySelectorAll(selector){return selector==='img'?this.children:[];}
  replaceChildren(...children){this.children=children;}
  append(...children){this.children.push(...children);}
  removeAttribute(name){this.removed.push(name);}
  addEventListener(){}
  get firstElementChild(){return this.children[0]??null;}
}
function fixture(){
  const container=new Element(),fields={};for(const suffix of ['heading','reference','group-status','group-image','group-help'])fields['[data-registration-'+(suffix==='heading'?'success-heading':suffix)+']']=new Element();
  let images=0;container.fields=fields;container.ownerDocument={createElement(tag){assert.equal(tag,'img');images++;return new Element();}};return{container,fields,get images(){return images;}};
}
const receipt=status=>({httpStatus:201,now:'2026-10-21T00:00:00Z',body:{status:status==='confirmed'?'registered':status,admissionStatus:status,reference_code:'r'.repeat(43),groupInvite:{platform:'wechat',qrImageUrl:'https://api.artdico.host/api/admin/registration/group-invite/synthetic',expiresAt:'2026-12-05T00:00:00Z'}}});

test('pending/rejected receipt renders its actual application result without constructing or exposing a group image',()=>{
  const original=globalThis.HTMLElement;globalThis.HTMLElement=Element;
  try{for(const status of ['pending_review','rejected']){const f=fixture();assert.equal(renderRegistrationSuccess(f.container,receipt(status)),true);assert.equal(f.container.hidden,false);assert.equal(f.fields['[data-registration-reference]'].textContent,'r'.repeat(43));assert.equal(f.fields['[data-registration-group-image]'].hidden,true);assert.equal(f.fields['[data-registration-group-help]'].hidden,true);assert.equal(f.images,0);assert.match(f.fields['[data-registration-success-heading]'].textContent,status==='pending_review'?/申请已收到.*待人工审核/u:/申请未通过审核/u);assert.doesNotMatch(f.fields['[data-registration-group-status]'].textContent,/报名成功|名额已确认/u);}}
  finally{if(original===undefined)delete globalThis.HTMLElement;else globalThis.HTMLElement=original;}
});
test('changing a previous confirmed result to pending removes its old group URL before displaying application receipt',()=>{
  const original=globalThis.HTMLElement;globalThis.HTMLElement=Element;
  try{const f=fixture();assert.equal(renderRegistrationSuccess(f.container,receipt('confirmed')),true);assert.equal(f.images,1);const previous=f.fields['[data-registration-group-image]'].firstElementChild;assert.ok(previous.src);assert.equal(renderRegistrationSuccess(f.container,receipt('pending_review')),true);assert.deepEqual(previous.removed,['src']);assert.equal(f.fields['[data-registration-group-image]'].children.length,0);assert.equal(f.images,1);}
  finally{if(original===undefined)delete globalThis.HTMLElement;else globalThis.HTMLElement=original;}
});
