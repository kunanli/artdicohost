// Native form saves against the real isolated runtime. Every HTTP request is intercepted.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {resolve,extname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {peopleRuntimeFixture,PEOPLE_FIXTURE_API as SITE} from '../helpers/people-runtime-fixture.mjs';
const {chromium}=await import(process.env.ARTDICO_PLAYWRIGHT_MODULE||'playwright-core');
const project=fileURLToPath(new URL('../../',import.meta.url)),dist=resolve(process.env.ARTDICO_DIST_DIRECTORY||resolve(project,'dist'));
const sourceScripts=process.env.ARTDICO_SOURCE_SCRIPTS==='1',reports=[],errors=[];
const json=(value,status=200)=>({status,contentType:'application/json',body:JSON.stringify(value)});
const browser=await chromium.launch({executablePath:process.env.ARTDICO_CHROMIUM_BINARY||'/usr/bin/chromium',headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
async function fixture(width=1280){
  const runtime=await peopleRuntimeFixture({capacity:300,mail:false}),person=(await runtime.createContact({name:'合成保存对象'})).contact;
  const context=await browser.newContext({viewport:{width,height:950}}),page=await context.newPage(),writes=[];
  let fault=null,held=null,release=null;
  const auth=await runtime.login('owner'),[name,...parts]=auth.Cookie.split('=');
  await context.addCookies([{name,value:parts.join('='),domain:new URL(SITE).hostname,path:'/api/admin',secure:true,httpOnly:true,sameSite:'Strict'}]);
  page.setDefaultTimeout(7000);page.on('pageerror',error=>errors.push(error.message));page.on('dialog',dialog=>dialog.accept());
  await context.route('**/*',async route=>{
    const request=route.request(),url=new URL(request.url()),path=url.pathname;assert.equal(url.origin,SITE);
    if(path.startsWith('/api/')){
      if(request.method()!=='GET')writes.push({path,method:request.method(),raw:request.postData()});
      assert.equal(/(?:send|dispatch|publish)$/u.test(path),false,'save testing never sends or publishes');
      const mode=request.method()==='PUT'?fault:null;if(mode)fault=null;
      if(mode==='validation')return route.fulfill(json({error:{code:'INVALID_PROFILE',message:'请修改标示栏位。',fields:{name:'合成姓名栏位错误'}}},422));
      const result=await runtime.app.handle(new Request(request.url(),{method:request.method(),headers:await request.allHeaders(),...(request.method()==='GET'?{}:{body:request.postData()})}));
      const payload={status:result.status,headers:Object.fromEntries(result.headers),body:Buffer.from(await result.arrayBuffer())};
      if(mode==='hold'){held=true;await new Promise(done=>{release=done;});held=false;}
      if(mode==='committed503')return route.fulfill(json({error:{code:'STORAGE_UNAVAILABLE',message:'合成回执丢失。'}},503));
      if(mode==='wrong-profile'){const value=JSON.parse(payload.body);value.contact.profile.name='其他合成姓名';return route.fulfill(json(value));}
      return route.fulfill(payload);
    }
    if(sourceScripts&&/^\/(?:src|shared)\//u.test(path)){
      const file=resolve(project,'.'+path);assert.ok(file.startsWith(project));
      return route.fulfill({body:path.endsWith('.css')&&request.resourceType()==='script'?'':await readFile(file),contentType:request.resourceType()==='script'?'text/javascript':path.endsWith('.css')?'text/css':'text/javascript'});
    }
    const file=resolve(dist,'.'+(path.endsWith('/')?path+'index.html':path));assert.ok(file.startsWith(dist+'/'));
    let contents=await readFile(file);if(sourceScripts&&file.endsWith('.html'))contents=Buffer.from(contents.toString().replace(/<script\b[^>]*type="module"[^>]*>[\s\S]*?<\/script>/gu,'').replace('</body>','<link rel="stylesheet" href="/src/styles/admin-save-state.css"><script type="module" src="/src/scripts/contacts.mjs"></script></body>'));
    return route.fulfill({body:contents,contentType:({html:'text/html',js:'text/javascript',css:'text/css',png:'image/png',webp:'image/webp',woff2:'font/woff2'})[extname(file).slice(1)]||'application/octet-stream'});
  });
  await page.goto(SITE+'/admin/contacts/',{waitUntil:'networkidle'});await page.locator('[data-contacts-rows] tr').waitFor();
  return {runtime,person,context,page,writes,fault:next=>{fault=next;},async waitHeld(){for(let i=0;i<500&&!held;i++)await page.waitForTimeout(10);assert.ok(held);},release:()=>release()};
}
const state=(form,value)=>form.locator('.ah-form-save-state[data-save-state='+value+']');
async function edit(f,kind){const selector=kind==='profile'?'编辑资料':'详情与安排';await f.page.locator('[data-contacts-rows] tr').locator('button').filter({hasText:selector}).click();const form=f.page.locator('[data-'+kind+'-form]');await form.waitFor();await form.locator('.operations-local-draft:not([data-operations-draft-state=loading])').waitFor({state:'attached'});return form;}
async function close(f,kind){await f.page.locator('[data-'+kind+'-close]').first().click();await f.page.locator('[data-'+kind+'-dialog]').waitFor({state:'hidden'});}
try{
  for(const width of [320,390,1440]){
    const f=await fixture(width),form=await edit(f,'profile'),save=form.locator('[data-profile-save]');
    assert.equal(await save.textContent(),'保存');assert.equal(await save.isDisabled(),true);
    assert.equal(await form.locator('.operations-local-draft').isVisible(),false,'routine local recovery stays quiet');
    await form.locator('[name=name]').fill('合成已保存姓名');await state(form,'dirty').waitFor();
    f.fault('hold');await save.click();await f.waitHeld();await state(form,'saving').waitFor();assert.equal(await save.isDisabled(),true);
    f.release();await state(form,'saved').waitFor();assert.equal(await save.isDisabled(),true);assert.equal(await f.page.locator('[data-profile-dialog]').isVisible(),true);
    await form.locator('[name=organization]').fill('合成第二次保存机构');await state(form,'dirty').waitFor();await save.click();await state(form,'saved').waitFor();
    assert.equal((await f.runtime.app.contactsStore.read()).contacts.length,1,'a second save edits the same stable contact');
    assert.equal(f.writes.length,2);assert.equal(f.writes[0].path,f.writes[1].path);await close(f,'profile');
    const follow=await edit(f,'contact');await follow.locator('[name=notes]').fill('合成跟进一次保存');await state(follow,'dirty').waitFor();await follow.locator('[data-contact-save]').click();await state(follow,'saved').waitFor();
    assert.equal(await follow.locator('[data-contact-save]').isDisabled(),true);
    await follow.locator('[name=notes]').fill('合成未知结果保留');f.fault('committed503');await follow.locator('[data-contact-save]').click();await state(follow,'unknown').waitFor();
    assert.equal(await follow.locator('[name=notes]').inputValue(),'合成未知结果保留');assert.equal(await follow.locator('[data-contact-save]').isDisabled(),true);
    const count=f.writes.length;await f.page.waitForTimeout(100);assert.equal(f.writes.length,count,'unknown writes never retry automatically');
    await f.page.locator('[data-contact-check-save]').click();await state(follow,'saved').waitFor();assert.equal(f.writes.length,count,'verification only reads the original saved content');
    assert.equal(await f.page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true);
    assert.equal(f.runtime.messages.length,0);await f.context.close();reports.push({width,singleSaveAndInlineStates:true,exactAckKeepsFormAndStableId:true,unknownRetainsOriginalAndReadbackOnly:true});
  }
  const invalid=await fixture(),form=await edit(invalid,'profile');await form.locator('[name=name]').fill('合成错误后填写保留');invalid.fault('validation');await form.locator('[data-profile-save]').click();await state(form,'error').waitFor();
  assert.equal(await form.locator('[name=name]').inputValue(),'合成错误后填写保留');assert.equal(await form.locator('[name=name]').getAttribute('aria-invalid'),'true');assert.match(await form.locator('.ah-field-error').textContent(),/合成姓名栏位错误/u);
  await form.locator('[name=name]').fill('合成修正');assert.equal(await form.locator('[name=name]').getAttribute('aria-invalid'),null);await form.locator('[data-profile-save]').click();await state(form,'saved').waitFor();await invalid.context.close();reports.push({validationByFieldRetainsInputAndCanSaveAfterCorrection:true});
  const mismatched=await fixture(),wrong=await edit(mismatched,'profile');await wrong.locator('[name=name]').fill('合成原请求姓名');mismatched.fault('wrong-profile');await wrong.locator('[data-profile-save]').click();await state(wrong,'unknown').waitFor();assert.equal(await wrong.locator('[name=name]').inputValue(),'合成原请求姓名');assert.equal(await wrong.locator('[data-profile-save]').isDisabled(),true);assert.equal(mismatched.writes.length,1);await mismatched.page.waitForTimeout(100);assert.equal(mismatched.writes.length,1);await mismatched.context.close();reports.push({wrongSameIdProfileAckNeverClaimsSavedOrDropsInput:true});
  assert.deepEqual(errors,[]);console.log(JSON.stringify({reports,pageErrors:errors,syntheticOnly:true,sourceScripts},null,2));
}finally{await browser.close();}
