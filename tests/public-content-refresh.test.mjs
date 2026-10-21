import test from 'node:test';
import assert from 'node:assert/strict';
import {createInitialContent} from '../src/config/content.mjs';
import {toPublicContent} from '../shared/content-schema.mjs';
import {createPublicContentRefresh,publicContentEnvelope} from '../src/lib/public-content-refresh.mjs';

const snapshot=(revision=1,changes={})=>({revision,publishedAt:'2026-10-21T10:00:00.000Z',content:{...toPublicContent(createInitialContent()),...changes}});
const response=value=>new Response(JSON.stringify(value),{headers:{'content-type':'application/json'}});
const missing=()=>new Response(JSON.stringify({error:{code:'NOT_PUBLISHED'}}),{status:404});
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
function fixture({fetchFn,...options}={}){
  const doc=new EventTarget(),win=new EventTarget();doc.visibilityState='visible';
  const requests=[],contents=[],states=[],waiting=[];
  const controller=createPublicContentRefresh({url:'https://synthetic.invalid/api/public/content',document:doc,window:win,minIntervalMs:0,
    fetchFn:(url,init)=>{requests.push({url,init});if(fetchFn)return fetchFn(url,init);const next=deferred();waiting.push(next);return next.promise;},
    onContent:value=>contents.push(value),onState:state=>states.push(state),...options});
  return {controller,doc,win,requests,contents,states,waiting};
}
function timers(){let now=1000,sequence=0;const pending=new Map();return {clock:()=>now,setTimer:(run,delay)=>{const id=++sequence;pending.set(id,{run,at:now+delay});return id;},clearTimer:id=>pending.delete(id),advance(ms){now+=ms;for(const [id,item]of [...pending])if(item.at<=now){pending.delete(id);item.run();}},get size(){return pending.size;}};}

test('published envelope requires real metadata and bounded readable public collections before rendering',()=>{
  const valid=snapshot();assert.deepEqual(publicContentEnvelope(valid).content,valid.content);
  for(const changed of [{revision:-1},{revision:1.5},{revision:'1'},{publishedAt:'today'},{publishedAt:'2026-02-31T10:00:00Z'},
    {content:{...valid.content,sessions:[null]}},{content:{...valid.content,organizations:{}}},{content:{...valid.content,showcases:new Array(201).fill({})}}])assert.equal(publicContentEnvelope({...valid,...changed}),null);
  const missing={...valid};delete missing.publishedAt;assert.equal(publicContentEnvelope(missing),null);
  for(const changed of [{...valid.content,eventId:'another-event'},{...valid.content,internalNotes:'PRIVATE'},
    {...valid.content,guests:[{id:'private-person',status:'pending'}]},({...valid.content,showcases:undefined})])assert.equal(publicContentEnvelope({...valid,content:changed}),null);
  let reads=0;const getter={...valid};Object.defineProperty(getter,'content',{enumerable:true,get(){reads++;return valid.content;}});
  assert.equal(publicContentEnvelope(getter),null);assert.equal(reads,0);
});

test('public reads omit cookies and deduplicate an in-flight request; duplicate revision does not repaint',async()=>{
  const f=fixture(),first=f.controller.refresh(),same=f.controller.refresh();assert.equal(first,same);assert.equal(f.requests.length,1);
  assert.equal(f.requests[0].init.credentials,'omit');assert.equal(f.requests[0].init.cache,'no-store');assert.deepEqual(f.requests[0].init.headers,{Accept:'application/json'});
  f.waiting[0].resolve(response(snapshot()));assert.equal(await first,true);assert.equal(f.contents.length,1);
  const again=f.controller.refresh();f.waiting[1].resolve(response(snapshot()));assert.equal(await again,true);assert.equal(f.contents.length,1);
  assert.equal(f.states.at(-1).status,'published');f.controller.close();
});

test('unknown or malformed 404 is unavailable rather than a verified initial configuration',async()=>{
  for(const body of ['',JSON.stringify({error:{code:'NOT_FOUND'}}),JSON.stringify(snapshot())]){
    const f=fixture({fetchFn:async()=>new Response(body,{status:404})});assert.equal(await f.controller.refresh(),false);
    assert.equal(f.states.at(-1).status,'unavailable');assert.equal(f.controller.current,null);f.controller.close();
  }
});

test('older revisions, conflicting same revision bodies and backwards publication time cannot replace last verified data',async()=>{
  const f=fixture();let pending=f.controller.refresh();f.waiting.at(-1).resolve(response(snapshot(4)));await pending;
  for(const value of [snapshot(3),snapshot(4,{booths:[]}),{...snapshot(5),publishedAt:'2026-10-20T10:00:00.000Z'}]){
    // Change an actual public field for the same-revision conflict case.
    if(value.revision===4)value.content.event={...value.content.event,venue:'合成另一场地'};
    pending=f.controller.refresh();f.waiting.at(-1).resolve(response(value));assert.equal(await pending,false);
    assert.equal(f.controller.current.revision,4);assert.equal(f.contents.length,1);assert.equal(f.states.at(-1).status,'unavailable');
  }
  pending=f.controller.refresh();f.waiting.at(-1).resolve(response({...snapshot(4),publishedAt:'2026-10-21T11:00:00.000Z'}));assert.equal(await pending,true);
  assert.equal(f.contents.length,1);assert.equal(f.controller.current.publishedAt,'2026-10-21T11:00:00.000Z');f.controller.close();
});

test('first 404 identifies initial configuration; later 404 and failures preserve verified publication; explicit empty 200 withdraws',async()=>{
  const f=fixture();let pending=f.controller.refresh();f.waiting.at(-1).resolve(missing());assert.equal(await pending,false);
  assert.deepEqual(f.states.at(-1),{status:'missing',current:null,reason:'not-published'});
  pending=f.controller.refresh();f.waiting.at(-1).resolve(response(snapshot(1)));await pending;
  for(const result of [missing(),new Response('',{status:503}),response({content:snapshot().content}),new Response('{bad')]){
    pending=f.controller.refresh();f.waiting.at(-1).resolve(result);assert.equal(await pending,false);
    assert.equal(f.contents.length,1);assert.equal(f.states.at(-1).status,'unavailable');assert.equal(f.states.at(-1).current.revision,1);
  }
  pending=f.controller.refresh();f.waiting.at(-1).resolve(response(snapshot(2,{organizations:[],guests:[],showcases:[],booths:[]})));assert.equal(await pending,true);
  assert.equal(f.contents.length,2);assert.deepEqual(f.contents[1].content.guests,[]);f.controller.close();
});

test('ignored aborts, late old 404 and late failures cannot touch a newer successful page epoch',async()=>{
  for(const late of ['success','404','failure']){
    const f=fixture(),old=f.controller.refresh();f.controller.suspend();assert.equal(f.requests[0].init.signal.aborted,true);
    const fresh=f.controller.refresh();f.waiting[1].resolve(response(snapshot(2)));assert.equal(await fresh,true);
    if(late==='failure')f.waiting[0].reject(new Error('synthetic late failure'));
    else f.waiting[0].resolve(late==='404'?missing():response(snapshot(1)));
    assert.equal(await old,false);assert.equal(f.controller.current.revision,2);assert.equal(f.contents.length,1);assert.equal(f.states.at(-1).status,'published');f.controller.close();
  }
});

test('visibility, restored pageshow and focus coalesce, throttle, abort while hidden and never poll periodically',async()=>{
  const clock=timers(),f=fixture({...clock,minIntervalMs:1000,debounceMs:100});f.controller.start();
  const first=f.controller.refresh();f.waiting[0].resolve(response(snapshot()));await first;
  for(let i=0;i<10;i++)f.win.dispatchEvent(new Event('focus'));
  clock.advance(999);assert.equal(f.requests.length,1);clock.advance(1);assert.equal(f.requests.length,2);
  f.doc.visibilityState='hidden';f.doc.dispatchEvent(new Event('visibilitychange'));assert.equal(f.requests[1].init.signal.aborted,true);
  for(let i=0;i<3;i++)f.win.dispatchEvent(new Event('focus'));clock.advance(5000);assert.equal(f.requests.length,2);
  f.doc.visibilityState='visible';f.doc.dispatchEvent(new Event('visibilitychange'));const pageshow=new Event('pageshow');Object.defineProperty(pageshow,'persisted',{value:true});f.win.dispatchEvent(pageshow);f.win.dispatchEvent(new Event('focus'));
  clock.advance(100);assert.equal(f.requests.length,3);const current=f.controller.refresh();f.waiting[2].resolve(response(snapshot(2)));await current;
  f.waiting[1].resolve(missing());await Promise.resolve();
  clock.advance(60000);assert.equal(f.requests.length,3);assert.equal(f.controller.current.revision,2);assert.equal(clock.size,0);
  f.controller.close();f.win.dispatchEvent(new Event('focus'));clock.advance(5000);assert.equal(f.requests.length,3);
});

test('timeout bounds fetch and JSON body work even when transport ignores abort',async()=>{
  const clock=timers(),f=fixture({...clock,timeoutMs:500});const pending=f.controller.refresh();clock.advance(500);
  assert.equal(await pending,false);assert.equal(f.requests[0].init.signal.aborted,true);assert.equal(f.states.at(-1).status,'unavailable');
  f.waiting[0].resolve(response(snapshot()));await Promise.resolve();assert.equal(f.contents.length,0);f.controller.close();
  const body=deferred(),g=fixture({...timers(),fetchFn:async()=>({ok:true,status:200,headers:new Headers(),text:()=>body.promise})});
  const waiting=g.controller.refresh();await Promise.resolve();g.controller.close();body.resolve(JSON.stringify(snapshot()));assert.equal(await waiting,false);assert.deepEqual(g.contents,[]);
});

test('oversized responses never render or replace known publication',async()=>{
  const f=fixture({fetchFn:async()=>new Response('{}',{headers:{'content-length':String(2*1024*1024+1)}})});
  assert.equal(await f.controller.refresh(),false);assert.deepEqual(f.contents,[]);assert.equal(f.states.at(-1).status,'unavailable');f.controller.close();
});
