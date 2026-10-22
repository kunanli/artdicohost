// Standalone real-DOM races. Actual component/module sources, synthetic deferred requests only.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
const {chromium}=await import(process.env.ARTDICO_PLAYWRIGHT_MODULE||'playwright-core');
const project=fileURLToPath(new URL('../../',import.meta.url));
const component=await readFile(project+'src/components/StaffAdmissions.astro','utf8');
const paths=new Set(['/src/scripts/staff-admissions.mjs','/src/lib/admission-admin.mjs','/src/lib/admission-view.mjs']);
const browser=await chromium.launch({executablePath:process.env.ARTDICO_CHROMIUM_BINARY||'/usr/bin/chromium',headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
const A='a'.repeat(43),B='b'.repeat(43),errors=[],reports=[];
function state(id,revision=0){return {revision,settings:{capacity:2,staffReserve:0,waitlistEnabled:true},summary:{capacity:2,staffReserve:0,waitlistEnabled:true,confirmedCount:1,attendeeConfirmedCount:1,crewConfirmedCount:0,waitlistCount:0,remainingPublic:1,remainingTotal:1},people:[{registrationId:id,kind:'attendee',status:'confirmed',queueNumber:1,teamId:''}],teams:[],auditCount:revision};}
async function pageFor(){
  const context=await browser.newContext(),page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));page.on('dialog',dialog=>dialog.accept());
  await context.route('**/*',async route=>{const url=new URL(route.request().url());if(url.origin!=='https://api.artdico.host')return route.abort();if(url.pathname==='/race/')return route.fulfill({status:200,contentType:'text/html',body:'<!doctype html><html><body>'+component+'</body></html>'});if(/^\/(?:src|shared)\/[A-Za-z0-9_./-]+\.mjs$/u.test(url.pathname)){const source=await readFile(project+url.pathname.slice(1),'utf8');return route.fulfill({status:200,contentType:'text/javascript',body:source.replace(/^import\s+['"][^'"\n]+\.css['"];?\s*$/gmu,'')});}return route.abort();});
  await page.goto('https://api.artdico.host/race/');
  await page.evaluate(async()=>{
    const {createStaffAdmissions}=await import('/src/scripts/staff-admissions.mjs');
    const fixture=window.fixture={calls:[],configures:[],changes:0,changeResolvers:[],holdChange:false};
    fixture.api=createStaffAdmissions({root:document.querySelector('[data-staff-admissions]'),openRecord:()=>{},request:(path,options)=>new Promise((resolve,reject)=>fixture.calls.push({path,options,resolve,reject})),onChange:async()=>{fixture.changes++;if(fixture.holdChange)await new Promise(resolve=>fixture.changeResolvers.push(resolve));}});
    fixture.configure=(id,registrationId,label)=>{fixture.configures.push(fixture.api.configure({id,roles:['superadmin']},registrationId?[{id:registrationId,fields:{name:label}}]:[]));};
  });
  return {context,page};
}
async function settle(page){await page.evaluate(()=>new Promise(resolve=>setTimeout(resolve,0)));}
async function resolve(page,index,result){await page.waitForFunction(index=>window.fixture.calls.length>index,index);await page.evaluate(({index,result})=>{const call=window.fixture.calls[index];if(result.outcome&&call.options?.body){const body=JSON.parse(call.options.body);result.operation={operationId:body.operationId,action:'promote',registrationId:null,revision:body.expectedRevision+1};}call.resolve(result);},{index,result});await settle(page);}
async function configure(page,account,id,label){await page.evaluate(({account,id,label})=>{window.fixture.configure(account,id,label);},{account,id,label});}
async function snapshot(page){return page.evaluate(()=>({hidden:document.querySelector('[data-staff-admissions]').hidden,people:document.querySelector('[data-admissions-people]').textContent,teams:document.querySelector('[data-admissions-teams]').textContent,metrics:document.querySelector('[data-admissions-metrics]').textContent,options:document.querySelector('[name=memberIds]').textContent,status:document.querySelector('[data-admissions-status]').textContent,error:document.querySelector('[data-admissions-error]').textContent,pending:window.fixture.api.pending,disabled:document.querySelector('[data-admissions-promote]').disabled,changes:window.fixture.changes}));}
try{
  {
    const {context,page}=await pageFor();
    await configure(page,'account-a',A,'PRIVATE-OLD-LABEL');await page.evaluate(()=>window.fixture.api.clear());
    await resolve(page,0,state(A));await page.evaluate(()=>window.fixture.configures[0]);
    const cleared=await snapshot(page);assert.equal(cleared.hidden,true);for(const key of ['people','teams','metrics','options','status','error'])assert.equal(cleared[key],'');
    // Reusing an ID after a new login must not resurrect the old account's cached name.
    await configure(page,'account-b');await resolve(page,1,state(A));assert.doesNotMatch(JSON.stringify(await snapshot(page)),/PRIVATE-OLD-LABEL/u);
    await configure(page,'account-b',A,'PRIVATE-ACCOUNT-B');await resolve(page,2,state(A));assert.match((await snapshot(page)).people,/PRIVATE-ACCOUNT-B/u);
    await configure(page,'account-c');await resolve(page,3,state(A));assert.doesNotMatch(JSON.stringify(await snapshot(page)),/PRIVATE-ACCOUNT-B/u);
    const before=await page.evaluate(()=>window.fixture.calls.length);
    await page.evaluate(()=>window.fixture.api.configure({id:'editor-only',roles:['editor']},[{id:'a'.repeat(43),fields:{name:'PRIVATE-UNAUTHORIZED'}}]));
    assert.equal(await page.evaluate(()=>window.fixture.calls.length),before);const denied=await snapshot(page);assert.equal(denied.hidden,true);assert.equal(denied.people,'');assert.equal(denied.options,'');
    reports.push('clear/unauthorized configure discard private DOM and labels');await context.close();
  }
  for(const late of ['success','error']){
    const {context,page}=await pageFor();
    await configure(page,'account-a',A,'PRIVATE-OLD-LABEL');await page.evaluate(()=>window.fixture.api.clear());await configure(page,'account-b',B,'CURRENT-LABEL');await resolve(page,1,state(B,2));
    if(late==='success')await resolve(page,0,state(A));else{await page.evaluate(()=>window.fixture.calls[0].reject(new Error('PRIVATE-OLD-ERROR')));await settle(page);}
    await page.evaluate(()=>Promise.all(window.fixture.configures));const value=await snapshot(page);assert.equal(value.hidden,false);assert.match(value.people,/CURRENT-LABEL/u);assert.doesNotMatch(JSON.stringify(value),/PRIVATE-OLD|a{43}/u);assert.equal(value.error,'');assert.equal(value.disabled,false);
    // A newer configure in the same login also wins over an older GET.
    await configure(page,'account-b',A,'PRIVATE-STALE');await configure(page,'account-b',B,'CURRENT-LABEL');await resolve(page,3,state(B,4));await resolve(page,2,state(A,3));assert.doesNotMatch((await snapshot(page)).people,/PRIVATE-STALE|a{43}/u);
    reports.push('new session/latest read survives late '+late);await context.close();
  }
  {
    const {context,page}=await pageFor();await configure(page,'account-a',A,'PRIVATE-OLD-LABEL');await resolve(page,0,state(A));
    await page.locator('[data-admissions-promote]').click();await page.evaluate(()=>window.fixture.api.clear());await configure(page,'account-b',B,'CURRENT-LABEL');await resolve(page,2,state(B,2));
    await page.locator('[data-admissions-promote]').click();await resolve(page,1,{...state(A,1),outcome:'updated',promotedIds:[]});
    const during=await snapshot(page);assert.equal(during.changes,0);assert.equal(during.pending,true);assert.equal(during.disabled,true);assert.match(during.people,/CURRENT-LABEL/u);assert.doesNotMatch(JSON.stringify(during),/PRIVATE-OLD|a{43}/u);
    await resolve(page,3,{...state(B,3),outcome:'updated',promotedIds:[]});const finished=await snapshot(page);assert.equal(finished.changes,1);assert.equal(finished.pending,false);assert.equal(finished.disabled,false);
    reports.push('late mutation cannot render, call onChange, or unlock new operation');await context.close();
  }
  {
    const {context,page}=await pageFor();await configure(page,'account-a',A,'PRIVATE-OLD-LABEL');await resolve(page,0,state(A));await page.evaluate(()=>{window.fixture.holdChange=true;});
    await page.locator('[data-admissions-promote]').click();await resolve(page,1,{...state(A,1),outcome:'updated',promotedIds:[]});assert.equal((await snapshot(page)).changes,1);
    await page.evaluate(()=>window.fixture.api.clear());await configure(page,'account-b',B,'CURRENT-LABEL');await resolve(page,2,state(B,2));await page.locator('[data-admissions-promote]').click();
    await page.evaluate(()=>window.fixture.changeResolvers[0]());await settle(page);const during=await snapshot(page);assert.equal(during.disabled,true);assert.equal(during.pending,true);assert.match(during.people,/CURRENT-LABEL/u);assert.equal(during.status,'');
    await page.evaluate(()=>{window.fixture.holdChange=false;});await resolve(page,3,{...state(B,3),outcome:'updated',promotedIds:[]});assert.equal((await snapshot(page)).disabled,false);
    reports.push('late onChange completion cannot change new session controls');await context.close();
  }
  assert.deepEqual(errors,[]);console.log(JSON.stringify({reports,pageErrors:errors},null,2));
}finally{await browser.close();}
