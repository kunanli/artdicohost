// Real browser image codecs with fully intercepted synthetic files and no API.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';

const {chromium}=await import(process.env.ARTDICO_PLAYWRIGHT_MODULE||'playwright-core');
const origin='https://api.artdico.host';
const source=await readFile(fileURLToPath(new URL('../../src/lib/profile-image.mjs',import.meta.url)),'utf8');
const browser=await chromium.launch({executablePath:process.env.ARTDICO_CHROMIUM_BINARY||'/usr/bin/chromium',headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
const context=await browser.newContext(),page=await context.newPage(),errors=[];
page.on('pageerror',error=>errors.push(error.message));
await context.route('**/*',route=>{
  const url=new URL(route.request().url());
  assert.equal(url.origin,origin,'all requests must stay inside the intercepted fixture');
  if(url.pathname==='/__fixture/profile-image.mjs')return route.fulfill({status:200,contentType:'text/javascript',body:source});
  assert.equal(url.pathname,'/__fixture/');
  return route.fulfill({status:200,contentType:'text/html',body:'<!doctype html><html lang="zh"><title>Synthetic image codec fixture</title><body></body></html>'});
});

try{
  await page.goto(origin+'/__fixture/',{waitUntil:'networkidle'});
  const result=await page.evaluate(async()=>{
    const {prepareProfileImage,processedImageSummary}=await import('/__fixture/profile-image.mjs');
    const canvas=document.createElement('canvas'),drawing=canvas.getContext('2d');
    const makeBlob=(type='image/png',quality)=>new Promise(resolve=>canvas.toBlob(resolve,type,quality));
    const bytesOf=payload=>Uint8Array.from(atob(payload.dataBase64),character=>character.charCodeAt(0));
    const fileOf=(blob,name='synthetic-image.png')=>new File([blob],name,{type:blob.type});
    async function pixelsOf(prepared,points){
      const bitmap=await createImageBitmap(new Blob([bytesOf(prepared.payload)],{type:prepared.payload.contentType}));
      const target=document.createElement('canvas');target.width=bitmap.width;target.height=bitmap.height;
      const targetContext=target.getContext('2d');targetContext.drawImage(bitmap,0,0);bitmap.close();
      return points.map(([x,y])=>[...targetContext.getImageData(x,y,1,1).data]);
    }
    function taggedPng(bytes){
      const text=new TextEncoder().encode('note\0PRIVATE_SYNTHETIC_PHOTO_METADATA');
      const chunk=new Uint8Array(12+text.length),view=new DataView(chunk.buffer);
      view.setUint32(0,text.length);chunk.set([116,69,88,116],4);chunk.set(text,8);
      let crc=0xffffffff;
      for(const value of chunk.subarray(4,-4)){crc^=value;for(let bit=0;bit<8;bit++)crc=crc&1?0xedb88320^(crc>>>1):crc>>>1;}
      view.setUint32(chunk.length-4,(crc^0xffffffff)>>>0);
      const tagged=new Uint8Array(bytes.length+chunk.length);tagged.set(bytes.subarray(0,33));tagged.set(chunk,33);tagged.set(bytes.subarray(33),33+chunk.length);return tagged;
    }
    canvas.width=400;canvas.height=200;
    drawing.clearRect(0,0,400,200);drawing.fillStyle='rgba(240,20,10,.5)';drawing.fillRect(100,0,200,200);drawing.fillStyle='#1234ee';drawing.fillRect(300,0,100,200);
    const original=fileOf(new Blob([taggedPng(new Uint8Array(await(await makeBlob()).arrayBuffer()))],{type:'image/png'}));
    const transparent=await prepareProfileImage(original,{preserveTransparency:true});
    const transparencyPixels=await pixelsOf(transparent,[[0,100],[150,100],[350,100]]);
    const originalDefault=await prepareProfileImage(original);
    const defaultPixels=await pixelsOf(originalDefault,[[0,100],[150,100],[350,100]]);

    const originalBitmap=window.createImageBitmap,originalCreate=URL.createObjectURL,originalRevoke=URL.revokeObjectURL;
    let created=0,revoked=0,fallback;
    URL.createObjectURL=function(value){created++;return originalCreate.call(this,value);};
    URL.revokeObjectURL=function(value){revoked++;return originalRevoke.call(this,value);};
    window.createImageBitmap=undefined;
    try{fallback=await prepareProfileImage(original,{preserveTransparency:true});}
    finally{window.createImageBitmap=originalBitmap;URL.createObjectURL=originalCreate;URL.revokeObjectURL=originalRevoke;}
    const fallbackPixels=await pixelsOf(fallback,[[0,100],[150,100],[350,100]]);

    canvas.width=160;canvas.height=90;drawing.fillStyle='#224466';drawing.fillRect(0,0,160,90);
    const opaque=await prepareProfileImage(fileOf(await makeBlob()),{preserveTransparency:true});

    canvas.width=1600;canvas.height=1600;
    const noise=drawing.createImageData(1600,1600);let seed=8192;
    for(let index=0;index<noise.data.length;index+=4){seed=(seed*1664525+1013904223)>>>0;noise.data[index]=seed&255;noise.data[index+1]=seed>>>8&255;noise.data[index+2]=seed>>>16&255;noise.data[index+3]=64+(seed>>>24)%192;}
    drawing.putImageData(noise,0,0);
    const largeOriginal=fileOf(await makeBlob()),large=await prepareProfileImage(largeOriginal,{maxEdge:800,preserveTransparency:true});
    const largePixels=await pixelsOf(large,[[Math.floor(large.processed.width/2),Math.floor(large.processed.height/2)]]);

    canvas.width=80;canvas.height=40;drawing.fillStyle='#f00';drawing.fillRect(0,0,40,40);drawing.fillStyle='#00f';drawing.fillRect(40,0,40,40);
    const jpeg=new Uint8Array(await(await makeBlob('image/jpeg',1)).arrayBuffer());
    const exif=new Uint8Array([255,225,0,34,69,120,105,102,0,0,73,73,42,0,8,0,0,0,1,0,18,1,3,0,1,0,0,0,6,0,0,0,0,0,0,0]);
    const orientedBytes=new Uint8Array(jpeg.length+exif.length);orientedBytes.set(jpeg.subarray(0,2));orientedBytes.set(exif,2);orientedBytes.set(jpeg.subarray(2),2+exif.length);
    const oriented=await prepareProfileImage(fileOf(new Blob([orientedBytes],{type:'image/jpeg'}),'synthetic-oriented.jpg'),{preserveTransparency:true});
    const orientationPixels=await pixelsOf(oriented,[[20,10],[20,70]]);
    const metadataRemoved=![transparent,originalDefault,oriented].some(value=>new TextDecoder('latin1').decode(bytesOf(value.payload)).includes('PRIVATE_SYNTHETIC')||new TextDecoder('latin1').decode(bytesOf(value.payload)).includes('Exif'));
    return {transparent:{type:transparent.payload.contentType,...transparent.processed,pixels:transparencyPixels,summary:processedImageSummary(transparent)},default:{type:originalDefault.payload.contentType,pixels:defaultPixels},fallback:{type:fallback.payload.contentType,pixels:fallbackPixels,created,revoked},opaque:{type:opaque.payload.contentType,...opaque.processed},large:{originalBytes:largeOriginal.size,type:large.payload.contentType,...large.processed,pixels:largePixels},oriented:{type:oriented.payload.contentType,...oriented.processed,pixels:orientationPixels},metadataRemoved};
  });
  assert.equal(result.transparent.type,'image/png');assert.equal(result.transparent.transparencyPreserved,true);
  assert.deepEqual(result.transparent.pixels.map(pixel=>pixel[3]),[0,128,255]);assert.match(result.transparent.summary,/透明背景已保留/u);
  assert.equal(result.default.type,'image/jpeg');assert.ok(result.default.pixels.every(pixel=>pixel[3]===255));assert.ok(result.default.pixels[0].slice(0,3).every(channel=>channel>=250));
  assert.equal(result.fallback.type,'image/png');assert.deepEqual(result.fallback.pixels.map(pixel=>pixel[3]),[0,128,255]);assert.equal(result.fallback.created,1);assert.equal(result.fallback.revoked,1);
  assert.equal(result.opaque.type,'image/jpeg');assert.equal(result.opaque.transparencyPreserved,false);
  assert.ok(result.large.originalBytes<=12*1024*1024);assert.equal(result.large.type,'image/png');assert.equal(result.large.transparencyPreserved,true);assert.ok(result.large.width<800&&result.large.height<800);assert.ok(result.large.bytes>0&&result.large.bytes<=512*1024);assert.ok(result.large.pixels[0][3]>0&&result.large.pixels[0][3]<255);
  assert.equal(result.oriented.type,'image/jpeg');assert.equal(result.oriented.width,40);assert.equal(result.oriented.height,80);assert.ok(result.oriented.pixels[0][0]>result.oriented.pixels[0][2]);assert.ok(result.oriented.pixels[1][2]>result.oriented.pixels[1][0]);
  assert.equal(result.metadataRemoved,true);assert.deepEqual(errors,[]);
  console.log(JSON.stringify({transparentPng:true,alpha:[0,128,255],legacyWhiteJpeg:true,opaqueRemainsJpeg:true,fallbackReleasesObjectUrl:true,largeTransparent:{originalBytes:result.large.originalBytes,processedBytes:result.large.bytes,width:result.large.width,height:result.large.height},orientationPreserved:true,metadataRemoved:true,pageErrors:errors,syntheticOnly:true},null,2));
}finally{await context.close();await browser.close();}
