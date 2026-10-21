import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {canManageEventOperations,canManageAccounts} from '../shared/staff-permissions.mjs';
import {SETTINGS_PAGES,resolveSettingsPage,settingsPageHref} from '../src/lib/admin-sections.mjs';

const source=(await readFile(new URL('../src/scripts/settings.mjs',import.meta.url),'utf8')).replace(/^import[^\n]*\n/gmu,'');
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function fixture({path='/admin/settings/',hash='',roles=['superadmin']}={}){
  const nodes=new Map(),listeners=new Map(),calls=[],configured=[],replaced=[];
  const node=selector=>{
    if(!nodes.has(selector))nodes.set(selector,{hidden:true,textContent:'',disabled:false,dataset:{},listeners:new Map(),
      addEventListener(type,callback){this.listeners.set(type,callback);},querySelectorAll(){return[];},reset(){},focus(){},scrollIntoView(){}});
    return nodes.get(selector);
  };
  const panels=['overview','delivery','group','invitations','accounts'].map(key=>({...node('panel-'+key),dataset:{settingsPanel:key}}));
  const accountsLink=node('accounts-link');
  const root={dataset:{settingsSection:'overview'},querySelector:node,addEventListener(type,callback){listeners.set(type,callback);},querySelectorAll(selector){return selector==='[data-settings-panel]'?panels:selector.includes('data-staff-admin-link')?[accountsLink]:[];}};
  const user={id:'synthetic',label:'合成工作人员',roles};let sessionEvents;
  const controllers={};
  const controller=(name,options)=>controllers[name]={pending:false,dirty:false,clears:0,lock(){},wipeSecrets(){this.wiped=true;},clear(){this.clears++;this.pending=false;this.dirty=false;},async configure(account){configured.push({name,account,section:options.section});}};
  const dependencies={
    createStaffSettings:options=>controller('staff',options),createDeliverySettings:options=>controller('delivery',options),
    createSettingsSession:events=>{sessionEvents=events;return{clear(){},setSession:value=>value.user,async request(requestPath){calls.push(requestPath);if(requestPath==='/api/admin/session')return{user,csrfToken:'synthetic'};throw new Error('Unexpected request');}};},
    canManageEventOperations,canManageAccounts,createBrowserDraftStore:()=>({}),eventConfig:{id:'synthetic-event'},SETTINGS_PAGES,resolveSettingsPage,settingsPageHref,
    document:{querySelector:()=>root,getElementById:id=>node('#'+id),title:''},location:{protocol:'https:',hostname:'api.example.invalid',pathname:path,hash},history:{replaceState(_a,_b,url){replaced.push(url);}},
    window:{addEventListener(type,callback){listeners.set(type,callback);}},setInterval(){},requestAnimationFrame:callback=>callback(),confirm:()=>false,
  };
  new Function(...Object.keys(dependencies),source)(...Object.values(dependencies));
  return{root,node,panels,accountsLink,calls,configured,replaced,controllers,listeners,expire:()=>sessionEvents.onExpired('/api/admin/session')};
}

test('each settings real path selects only its panel and initializes only its controller',async()=>{
  for(const key of ['overview','delivery','group','invitations','accounts']){
    const f=fixture({path:settingsPageHref(key)});await tick();
    assert.equal(f.root.dataset.settingsSection,key);
    assert.deepEqual(f.panels.filter(panel=>!panel.hidden).map(panel=>panel.dataset.settingsPanel),[key]);
    assert.deepEqual(f.configured.map(item=>item.name),key==='delivery'?['delivery']:['group','accounts'].includes(key)?['staff']:[]);
    if(key==='group'||key==='accounts')assert.equal(f.configured[0].section,key);
    assert.deepEqual(f.calls,['/api/admin/session']);
  }
});

test('four-role collaborators cannot enter accounts or initialize private account services',async()=>{
  const f=fixture({path:'/admin/settings/accounts/',roles:['editor','publisher','outreach','reviewer']});await tick();
  assert.deepEqual(f.configured,[]);assert.equal(f.node('[data-settings-authorized]').hidden,true);assert.equal(f.node('[data-settings-access-denied]').hidden,false);assert.equal(f.accountsLink.hidden,true);
  assert.deepEqual(f.calls,['/api/admin/session']);
});

test('legacy root anchors become the canonical subpage before settings reads',async()=>{
  for(const[hash,key]of [['#group-settings-title','group'],['#staff-settings-title','group'],['#wallet-settings-title','delivery'],['#staff-accounts-title','accounts']]){
    const f=fixture({hash});await tick();assert.equal(f.root.dataset.settingsSection,key);assert.deepEqual(f.replaced,[settingsPageHref(key)+hash]);
  }
});

test('auth expiry clears every mounted controller and private account label',async()=>{
  const f=fixture({path:'/admin/settings/accounts/'});await tick();f.expire();
  assert.equal(f.node('[data-settings-workspace]').hidden,true);assert.equal(f.node('[data-settings-authorized]').hidden,true);assert.equal(f.node('[data-settings-user]').textContent,'');
  assert.ok(f.controllers.staff.clears>=2);assert.ok(f.controllers.delivery.clears>=2);assert.equal(f.accountsLink.hidden,true);
});

test('the original beforeunload protects dirty or unknown settings without automatic writes',async()=>{
  const f=fixture({path:'/admin/settings/group/'});await tick();
  for(const kind of ['dirty','pending']){
    f.controllers.staff[kind]=true;let prevented=false;const event={preventDefault(){prevented=true;}};f.listeners.get('beforeunload')(event);assert.equal(prevented,true);assert.equal(event.returnValue,'');f.controllers.staff[kind]=false;
  }
  assert.deepEqual(f.calls,['/api/admin/session']);
});

test('all four paths share mounted settings hooks and keep account permission inside routing wrapper',async()=>{
  const workspace=await readFile(new URL('../src/components/SettingsWorkspace.astro',import.meta.url),'utf8');
  const staff=await readFile(new URL('../src/components/StaffSettings.astro',import.meta.url),'utf8');
  const route=await readFile(new URL('../src/pages/admin/settings/[section].astro',import.meta.url),'utf8');
  assert.match(workspace,/<StaffDeliverySettings\s*\/>/u);assert.match(workspace,/<StaffSettings\s*\/>/u);assert.match(route,/SETTINGS_PAGES\.map/u);
  assert.match(staff,/<div data-settings-panel="accounts" hidden>[\s\S]*data-settings-accounts hidden[\s\S]*data-settings-recovery hidden/u);
  for(const name of ['zhouyufei','wangying'])assert.match(staff,new RegExp('data-user-prefill="'+name+'"','u'));
});
