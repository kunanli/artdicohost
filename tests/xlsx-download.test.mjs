import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { downloadPrivateXlsx } from '../src/lib/xlsx-download.mjs';
import { createXlsxWorkbook, XLSX_MIME } from '../shared/xlsx-workbook.mjs';

const data=createXlsxWorkbook([{name:'合成表',headers:['编号','姓名'],rows:[['001','合成人员']]}]);
function response({body=data,mime=XLSX_MIME,hash=createHash('sha256').update(data).digest('hex'),status=200}={}){
  return new Response(body,{status,headers:{'content-type':mime,'content-length':String(body.length),'x-review-revision':'2','x-export-count':'1','x-export-sha256':hash}});
}
const input={path:'/api/admin/registrations/export.xlsx',body:{expectedRevision:1,includeContact:false},csrfToken:'synthetic-csrf',filename:'artdico-registration-attendance.xlsx'};
function page(t){
  const original=globalThis.document,create=URL.createObjectURL,revoke=URL.revokeObjectURL,timeout=globalThis.setTimeout;
  const clicks=[],urls=[],revoked=[];
  globalThis.document={body:{append(){}},createElement(){return {click(){clicks.push({href:this.href,download:this.download});},remove(){}};}};
  URL.createObjectURL=blob=>{assert.equal(blob.type,XLSX_MIME);urls.push(blob);return 'blob:synthetic-private';};URL.revokeObjectURL=url=>revoked.push(url);
  // Preserve the transport timeout while allowing the URL expiry timer to finish immediately.
  globalThis.setTimeout=(callback,delay)=>timeout(callback,delay===10_000?0:delay);
  t.after(()=>{globalThis.document=original;URL.createObjectURL=create;URL.revokeObjectURL=revoke;globalThis.setTimeout=timeout;});
  return {clicks,urls,revoked};
}
test('private XLSX download validates actual bytes and headers before the only browser download',async t=>{
  const dom=page(t),calls=[],privateUrls=[];
  const result=await downloadPrivateXlsx({...input,onPrivateUrl:url=>privateUrls.push(url),fetchFn:async(path,options)=>{calls.push({path,options});return response();}});
  assert.deepEqual(result,{revision:2,count:1});assert.equal(calls.length,1);assert.equal(calls[0].path,input.path);assert.equal(calls[0].options.credentials,'same-origin');assert.equal(calls[0].options.headers['X-CSRF-Token'],'synthetic-csrf');assert.equal(calls[0].options.redirect,'error');
  assert.deepEqual(JSON.parse(calls[0].options.body),input.body);assert.equal(dom.clicks.length,1);assert.deepEqual(privateUrls,['blob:synthetic-private']);assert.equal(dom.clicks[0].download,input.filename);
});
test('unknown audit acknowledgement is not retried and never exposes a workbook',async t=>{
  const dom=page(t);let calls=0;
  await assert.rejects(downloadPrivateXlsx({...input,fetchFn:async()=>{calls++;return response({status:503});}}),error=>error.status===503);
  assert.equal(calls,1);assert.equal(dom.clicks.length,0);assert.equal(dom.urls.length,0);
});
test('wrong MIME, digest or incomplete bytes cannot produce a private download',async t=>{
  const dom=page(t);
  for(const options of [{mime:'text/csv'},{hash:'0'.repeat(64)},{body:data.slice(0,-1)}])await assert.rejects(downloadPrivateXlsx({...input,fetchFn:async()=>response(options)}));
  assert.equal(dom.clicks.length,0);assert.equal(dom.urls.length,0);
});
test('a late response after logout discards the old private bytes',async t=>{
  const dom=page(t);let active=true,release;
  const pending=downloadPrivateXlsx({...input,isCurrent:()=>active,fetchFn:()=>new Promise(resolve=>{release=resolve;})});
  active=false;release(response());await assert.rejects(pending,/会话已改变/u);assert.equal(dom.urls.length,0);assert.equal(dom.clicks.length,0);
});
