import test from 'node:test';
import assert from 'node:assert/strict';
import { createInitialContent } from '../src/config/content.mjs';
import { validateContent } from '../shared/content-schema.mjs';
import { contentSaveSnapshot } from '../src/lib/admin-save-state.mjs';
import { showcaseOptionalFields,contentFormValue,readContentForm,writeContentForm,contentLocalDraftValue } from '../src/lib/content-local-drafts.mjs';

test('work metadata editing preserves old own-property absence and requires an explicit new classification',()=>{
  const legacy={id:'work-synthetic'},raw={id:'work-synthetic',kind:'',organizationId:''},before=structuredClone(raw);
  assert.deepEqual(showcaseOptionalFields(legacy,raw),{});
  assert.deepEqual(raw,before);assert.deepEqual(legacy,{id:'work-synthetic'});
  assert.throws(()=>showcaseOptionalFields(null,raw,{isNew:true}),/请选择作品分类/u);
  assert.throws(()=>showcaseOptionalFields(null,{organizationId:''},{isNew:true}),/请选择作品分类/u);
  for(const kind of ['student','indie'])assert.deepEqual(showcaseOptionalFields(null,{kind,organizationId:''},{isNew:true}),{kind});
  assert.throws(()=>showcaseOptionalFields(null,{kind:'team',organizationId:''},{isNew:true}),/请选择有效的作品分类/u);
  assert.throws(()=>showcaseOptionalFields(legacy,{kind:'team'}),/请选择有效的作品分类/u);
});

test('older raw forms preserve saved known metadata while explicit organization clear and typed kind win',()=>{
  const saved={id:'work-synthetic',kind:'indie',organizationId:'organization-synthetic'};
  assert.deepEqual(showcaseOptionalFields(saved,{id:saved.id}),{kind:'indie',organizationId:'organization-synthetic'});
  assert.throws(()=>showcaseOptionalFields(saved,{kind:'team',organizationId:''}),/请选择有效的作品分类/u);
  assert.deepEqual(showcaseOptionalFields(saved,{kind:'student',organizationId:'organization-other'}),{kind:'student',organizationId:'organization-other'});
  assert.throws(()=>showcaseOptionalFields(saved,{kind:''}),/请选择作品分类/u);
  for(const kind of [null,undefined,'other',[],{}])assert.throws(()=>showcaseOptionalFields(saved,{kind}));
  for(const organizationId of [null,undefined,'invalid id',[],{}])assert.throws(()=>showcaseOptionalFields(saved,{organizationId}));
  const accessor={};Object.defineProperty(accessor,'kind',{enumerable:true,get(){throw new Error('must not run');}});
  assert.throws(()=>showcaseOptionalFields(saved,accessor),/明确值/u);
});

test('legacy team metadata remains unchanged until the editor deliberately chooses a current category',()=>{
  const legacy={id:'work-synthetic',kind:'team',organizationId:'organization-synthetic'},original=structuredClone(legacy);
  assert.deepEqual(showcaseOptionalFields(legacy,{id:legacy.id}),{kind:'team',organizationId:'organization-synthetic'});
  assert.deepEqual(showcaseOptionalFields(legacy,{kind:'team',organizationId:''}),{kind:'team',organizationId:''});
  for(const kind of ['student','indie'])assert.deepEqual(showcaseOptionalFields(legacy,{kind}),{kind,organizationId:'organization-synthetic'});
  assert.throws(()=>showcaseOptionalFields(legacy,{kind:'team'},{isNew:true}),/请选择有效的作品分类/u);
  assert.deepEqual(legacy,original);
});

test('work raw metadata restores typed/cleared values and never inserts new fields into older unknown submissions',()=>{
  const fields={id:{type:'hidden',value:'work-synthetic'},kind:{type:'select-one',tagName:'SELECT',value:'team',options:[{value:''},{value:'student'},{value:'indie'},{value:'team'}]},organizationId:{type:'select-one',tagName:'SELECT',value:'organization-synthetic',options:[{value:''},{value:'organization-synthetic'}]}};
  const form={elements:{namedItem:name=>fields[name]??null},querySelectorAll:()=>[]};
  const legacy={id:'work-synthetic'},before=structuredClone(legacy);
  assert.deepEqual(contentFormValue('showcase',legacy),legacy);writeContentForm(form,'showcase',legacy);
  assert.equal(fields.kind.value,'team');assert.equal(fields.organizationId.value,'organization-synthetic');assert.deepEqual(legacy,before);
  for(const kind of ['student','indie','team','']){fields.kind.value=kind;fields.organizationId.value='';const raw=readContentForm(form,'showcase');assert.equal(raw.kind,kind);assert.equal(raw.organizationId,'');fields.kind.value='other';writeContentForm(form,'showcase',raw);assert.equal(fields.kind.value,kind);}
  const oldTeamOption=fields.kind.options.find(option=>option.value==='team');
  assert.equal(oldTeamOption.disabled,true);assert.equal(oldTeamOption.textContent,'待分类（原记录）');
  const content=validateContent(createInitialContent()).value;
  const value={schemaVersion:1,roleKey:'editor',section:'showcases',content,forms:{showcase:{editingId:null,fields:legacy,imageNeedsReselect:false}},pendingSave:contentSaveSnapshot(3,content),uncertain:true};
  const frozen=JSON.stringify(value);assert.equal(contentLocalDraftValue(value,{kind:'pending_submission'}),true);assert.equal(JSON.stringify(value),frozen);assert.equal(Object.hasOwn(value.forms.showcase.fields,'kind'),false);assert.equal(Object.hasOwn(value.forms.showcase.fields,'organizationId'),false);
});

test('an old unknown new-team request stays recoverable with its exact submitted category',()=>{
  const content=validateContent({...createInitialContent(),showcases:[{id:'old-new-team',kind:'team',title:'合成旧作品',teamName:'合成团队',memberCount:1,
    participationForms:[],responseStatus:'pending',status:'pending',publicConsent:false}]}).value;
  const pending=contentSaveSnapshot(7,content);
  assert.ok(pending);
  const value={schemaVersion:1,roleKey:'editor',section:'showcases',content,forms:{showcase:{editingId:null,fields:{id:'old-new-team',kind:'team'},imageNeedsReselect:false}},pendingSave:pending,uncertain:true};
  const frozen=JSON.stringify(value);
  assert.equal(contentLocalDraftValue(value,{kind:'pending_submission'}),true);
  assert.equal(value.pendingSave.content.showcases[0].kind,'team');
  assert.equal(JSON.stringify(value),frozen,'recovery does not convert the original unknown request into a new classification');
  assert.throws(()=>showcaseOptionalFields(null,value.forms.showcase.fields,{isNew:true}),/请选择有效的作品分类/u);
});
