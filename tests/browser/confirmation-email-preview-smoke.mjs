// Render the actual hosted-template source with synthetic server-generated
// variables. All badge/QR requests are fulfilled locally; no SMTP or API calls.
import assert from 'node:assert/strict';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {confirmationEmailPresentation} from '../../functions/registration-confirmation/presentation.mjs';
import {encodeQrPng} from '../../functions/entry-ticket/qr.mjs';
const project=fileURLToPath(new URL('../../',import.meta.url)),dist=resolve(process.env.ARTDICO_DIST_DIRECTORY||resolve(project,'dist'));
const evidence=resolve(process.env.ARTDICO_EMAIL_PREVIEW_EVIDENCE_DIRECTORY||resolve(project,'.local-data/browser-evidence/confirmation-email-preview'));
const {chromium}=await import(process.env.ARTDICO_PLAYWRIGHT_MODULE||'playwright-core');
const template=await readFile(resolve(project,'docs/templates/emailjs-registration-confirmation.html'),'utf8');
const sha=value=>createHash('sha256').update(value).digest('hex'),escape=value=>String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;');
const sourceCommit=execFileSync('git',['-C',project,'rev-parse','HEAD'],{encoding:'utf8'}).trim();assert.match(sourceCommit,/^[a-f0-9]{40}$/u);
const token='s'.repeat(22),short='https://artdico.host/r/#'+token,entry='https://api.artdico.host/api/admin/registration/entry-links/'+token+'/entry.png',group='https://api.artdico.host/api/admin/registration/entry-links/'+token+'/group.png';
const qr=encodeQrPng('https://api.artdico.host/admin/checkin/#ticket='+'e'.repeat(22));
const browser=await chromium.launch({executablePath:process.env.ARTDICO_CHROMIUM_BINARY||'/usr/bin/chromium',headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
const reports=[],pageErrors=[],assetHashes=new Map();await mkdir(evidence,{recursive:true});
try{
  for(const scenario of [{width:320,locale:'zh-CN',group:'current'},{width:600,locale:'zh-CN',group:'current'},{width:320,locale:'en',group:'current'},{width:600,locale:'en',group:'current'},{width:320,locale:'zh-CN',group:'missing'},{width:600,locale:'en',group:'expired'}]){
    const context=await browser.newContext({viewport:{width:scenario.width,height:1000}}),requests=[];
    const ticket={confirmationUrl:short,admissionQrImageUrl:entry,...(scenario.group==='current'?{groupQrImageUrl:group,groupExpiresAt:'2026-11-05T04:00:00.000Z'}:{})};
    const variables={event_title:'ARTDiCO HOST · Synthetic Event',invitation_text:scenario.locale==='en'?'Synthetic attendee,\n\nYour attendance is confirmed.\nDate: 2026-12-05\nTime: 10:00–18:00 (UTC+8)\nYour private attendance page:\n'+short:'合成参会者，你好：\n\n你的参会名额已确认。\n日期：2026-12-05\n时间：10:00–18:00（UTC+8）\n私人参会页：\n'+short,...confirmationEmailPresentation({locale:scenario.locale,kind:'registration',subject:'Synthetic attendance confirmation',confirmationUrl:short,ticket,walletReady:true})};
    const rendered=template.replaceAll('{{{confirmation_actions}}}',variables.confirmation_actions).replace(/\{\{([a-z_]+)\}\}/gu,(_,key)=>escape(variables[key]??''));
    assert.doesNotMatch(rendered,/\{\{[a-z_]+\}\}/u);
    await context.route('**/*',async route=>{
      const request=route.request(),url=new URL(request.url());assert.equal(request.method(),'GET');requests.push({origin:url.origin,path:url.pathname});
      if(url.origin==='https://artdico.host'&&/^\/wallet\/add-to-apple-wallet-(?:cn|en)\.png$/u.test(url.pathname)){
        const bytes=await readFile(resolve(dist,'.'+url.pathname));assetHashes.set(url.pathname,sha(bytes));return route.fulfill({status:200,contentType:'image/png',body:bytes});
      }
      assert.equal(url.origin,'https://api.artdico.host');assert.ok([entry,group].includes(url.href));return route.fulfill({status:200,contentType:'image/png',headers:{'cache-control':'private, no-store'},body:qr});
    });
    const page=await context.newPage();page.on('pageerror',error=>pageErrors.push(error.message));
    try{
      await page.setContent(rendered,{waitUntil:'networkidle'});await page.locator('img').evaluateAll(async images=>Promise.all(images.map(image=>image.decode())));
      const images=await page.locator('img').evaluateAll(elements=>elements.map(image=>{const rect=image.getBoundingClientRect();return{alt:image.alt,src:image.getAttribute('src'),x:rect.x,right:rect.right,width:rect.width,height:rect.height,naturalWidth:image.naturalWidth,naturalHeight:image.naturalHeight};}));
      assert.equal(await page.locator('div[lang]').first().getAttribute('lang'),scenario.locale);assert.equal(images.length,scenario.group==='current'?3:2);const badge=images[0];assert.ok(badge.src.endsWith('wallet-'+(scenario.locale==='en'?'en':'cn')+'.png'));assert.equal(badge.height,44);assert.ok(Math.abs(badge.width/badge.height-badge.naturalWidth/badge.naturalHeight)<0.01);
      for(const image of images){assert.ok(image.x>=0&&image.right<=scenario.width+1);assert.ok(image.naturalWidth>0&&image.naturalHeight>0);}
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true);
      assert.equal(await page.locator('a[href="'+short+'"]').count(),2);assert.equal(await page.locator('img[src="'+group+'"]').count(),scenario.group==='current'?1:0);
      assert.equal(requests.filter(request=>request.origin==='https://api.artdico.host').length,scenario.group==='current'?2:1);
      if(scenario.group!=='current')assert.doesNotMatch(await page.locator('body').innerText(),/加入活动微信群|Join the event WeChat group/u);
      const screenshot=resolve(evidence,'mail-'+scenario.locale+'-'+scenario.width+'-'+scenario.group+'.png');await page.screenshot({path:screenshot,fullPage:true});
      reports.push({...scenario,imageCount:images.length,officialBadgeRatio:true,privateQrRequests:scenario.group==='current'?2:1,groupOmitted:scenario.group!=='current',horizontalOverflow:false,smtpRequests:0,businessWrites:0,renderedSha256:sha(rendered),screenshot});
    }finally{await context.close();}
  }
  assert.deepEqual(pageErrors,[]);const result={ok:true,cases:reports.length,sourceCommit,publicHtmlSha256:sha(await readFile(resolve(dist,'index.html'))),templateSha256:sha(template),scriptSha256:sha(await readFile(fileURLToPath(import.meta.url))),assets:[...assetHashes].map(([path,sha256])=>({path,sha256})),reports,pageErrors:0,smtpRequests:0,businessWrites:0,allRequestsIntercepted:true,qrImagesSynthetic:true,liveWechatJoinVerified:false};await writeFile(resolve(evidence,'report.json'),JSON.stringify(result,null,2)+'\n');process.stdout.write('Confirmation email preview browser verified: '+JSON.stringify({...result,reports:undefined})+'\n');
}finally{await browser.close();}
