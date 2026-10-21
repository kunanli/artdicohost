import test from 'node:test';
import assert from 'node:assert/strict';
import {profileImageDimensions,prepareProfileImage,MAX_ORIGINAL_IMAGE_BYTES} from '../src/lib/profile-image.mjs';
function png(width,height){const bytes=Buffer.alloc(33);Buffer.from('89504e470d0a1a0a','hex').copy(bytes);bytes.writeUInt32BE(13,8);bytes.write('IHDR',12);bytes.writeUInt32BE(width,16);bytes.writeUInt32BE(height,20);return bytes;}
function jpeg(width,height){const bytes=Buffer.from('ffd8ffe000044142ffc00008080000000003ffd9','hex');bytes.writeUInt16BE(height,13);bytes.writeUInt16BE(width,15);return bytes;}
function webp(width,height){const bytes=Buffer.alloc(30);bytes.write('RIFF');bytes.writeUInt32LE(22,4);bytes.write('WEBPVP8X',8);bytes.writeUInt32LE(10,16);bytes.writeUIntLE(width-1,24,3);bytes.writeUIntLE(height-1,27,3);return bytes;}
test('pixel limits are inspected from supported image headers before decoding and include a cumulative pixel bound',()=>{
 for(const[contentType,make]of [['image/png',png],['image/jpeg',jpeg],['image/webp',webp]]){
  assert.deepEqual(profileImageDimensions(make(4000,3000),contentType),{width:4000,height:3000});
  assert.throws(()=>profileImageDimensions(make(10000,5000),contentType),/像素/u);
  assert.throws(()=>profileImageDimensions(make(0,1),contentType));
 }
 assert.throws(()=>profileImageDimensions(png(1,1),'image/jpeg'));
 assert.throws(()=>profileImageDimensions(Buffer.from('<svg>invalid</svg>'),'image/png'));
 const animated=webp(100,100);animated[20]=2;assert.throws(()=>profileImageDimensions(animated,'image/webp'),/动画/u);
 const animationChunk=Buffer.alloc(12);animationChunk.write('acTL',4);assert.throws(()=>profileImageDimensions(Buffer.concat([png(100,100),animationChunk]),'image/png'),/动画/u);
});
test('oversized originals, unsafe headers and cancellation fail before any browser bitmap or canvas work',async()=>{
 let reads=0;
 await assert.rejects(prepareProfileImage({type:'image/jpeg',size:MAX_ORIGINAL_IMAGE_BYTES+1,arrayBuffer(){reads++;}}),/12 MiB/u);assert.equal(reads,0);
 const bytes=png(10000,10000);await assert.rejects(prepareProfileImage({type:'image/png',size:bytes.length,arrayBuffer:async()=>bytes}),/像素/u);
 const controller=new AbortController();controller.abort();await assert.rejects(prepareProfileImage({type:'image/png',size:33,arrayBuffer(){assert.fail('cancelled file must not be read');}},{signal:controller.signal}),error=>error.name==='AbortError');
});
