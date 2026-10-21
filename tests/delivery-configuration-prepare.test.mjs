import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,stat,chmod,symlink,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve,dirname,basename} from 'node:path';
import {prepareConfirmationMailConfiguration} from '../scripts/prepare-confirmation-mail.mjs';
import {decodeConfirmationMailBundle} from '../functions/registration-confirmation/config-bundle.mjs';

const secret='SYNTHETIC_PROTECTED_CONFIGURATION_MASTER_12345678901234567890',eventId='synthetic-delivery-2026';
const config={EMAILJS_SERVICE_ID:'synthetic_service',EMAILJS_CONFIRMATION_TEMPLATE_ID:'synthetic_confirmation',EMAILJS_PUBLIC_KEY:'SYNTHETIC_PUBLIC',
  EMAILJS_PRIVATE_KEY:'SYNTHETIC_PRIVATE_CONFIGURATION_KEY',EMAIL_FROM_ADDRESS:'synthetic@artdico.co',EMAIL_FROM_NAME:'合成团队'};
async function fixture(t){
  const directory=await mkdtemp(resolve(tmpdir(),'artdico-delivery-config-'));
  t.after(async()=>{assert.equal(dirname(directory),resolve(tmpdir()));assert.ok(basename(directory).startsWith('artdico-delivery-config-'));await rm(directory,{recursive:true,force:true});});
  const configurationFile=resolve(directory,'provider.json'),secretFile=resolve(directory,'master.txt'),outputFile=resolve(directory,'encrypted.json');
  await writeFile(configurationFile,JSON.stringify(config),{mode:0o600});await writeFile(secretFile,secret+'\n',{mode:0o600});
  return {directory,configurationFile,secretFile,outputFile,eventId};
}
async function rejected(promise){await assert.rejects(promise,error=>error.message==='Confirmation mail configuration was not prepared; no credential details are included.'&&!error.cause&&!error.stack.includes(config.EMAILJS_PRIVATE_KEY));}
test('explicit protected input files produce only a private encrypted bundle and non-secret locator',async t=>{
  const f=await fixture(t),result=await prepareConfirmationMailConfiguration(f),data=await readFile(f.outputFile);
  assert.equal((await stat(f.outputFile)).mode&0o777,0o600);
  assert.deepEqual(decodeConfirmationMailBundle({data,bundleId:result.bundleId,secret,eventId}),config);
  assert.match(result.objectKey,/^cms\/v1\/confirmation-mail\//u);assert.equal(result.bytes,data.length);
  assert.equal(JSON.stringify(result).includes(config.EMAILJS_PRIVATE_KEY),false);assert.equal(data.includes(Buffer.from(config.EMAILJS_PRIVATE_KEY)),false);
  await rejected(prepareConfirmationMailConfiguration(f));assert.deepEqual(await readFile(f.outputFile),data,'existing encrypted output is never overwritten');
});
test('public-readable and symlinked secret inputs are rejected without output or credential diagnostics',async t=>{
  const f=await fixture(t);await chmod(f.secretFile,0o644);await rejected(prepareConfirmationMailConfiguration(f));
  await assert.rejects(stat(f.outputFile));await chmod(f.secretFile,0o600);
  const link=resolve(f.directory,'linked.txt');await symlink(f.secretFile,link);await rejected(prepareConfirmationMailConfiguration({...f,secretFile:link}));
  await assert.rejects(stat(f.outputFile));
});
