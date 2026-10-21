import { constants } from 'node:fs';
import { lstat,open,mkdir,writeFile } from 'node:fs/promises';
import { dirname,parse,resolve,sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { encodeConfirmationMailBundle,confirmationMailObjectKey } from '../functions/registration-confirmation/config-bundle.mjs';

const ROOT=fileURLToPath(new URL('../',import.meta.url));
const fail=()=>{throw new Error('Confirmation mail configuration was not prepared; no credential details are included.');};
async function checkedPath(path,missing=false){
  const absolute=resolve(path),root=parse(absolute).root;let current=root;
  for(const name of ['public','dist','.git'])if(absolute===resolve(ROOT,name)||absolute.startsWith(resolve(ROOT,name)+sep))fail();
  for(const part of absolute.slice(root.length).split(sep).filter(Boolean)){
    current=resolve(current,part);let info;
    try{info=await lstat(current);}catch(error){if(missing&&error.code==='ENOENT')return absolute;throw error;}
    if(info.isSymbolicLink())fail();
  }
  return absolute;
}
async function protectedBytes(path,maxBytes){
  const file=await open(await checkedPath(path),constants.O_RDONLY|constants.O_NOFOLLOW);
  try{
    const info=await file.stat();
    if(!info.isFile()||info.mode&0o077||typeof process.getuid==='function'&&info.uid!==process.getuid()||!info.size||info.size>maxBytes)fail();
    const bytes=await file.readFile();if(bytes.length!==info.size||(await file.stat()).size!==info.size)fail();return bytes;
  }finally{await file.close();}
}

/** Explicit protected file inputs only; never accept an API key as a CLI argument. */
export async function prepareConfirmationMailConfiguration({configurationFile,secretFile,eventId,outputFile}={}){
  let secretBytes,configBytes;
  try{
    if([configurationFile,secretFile,outputFile].some(value=>typeof value!=='string'||!value))fail();
    configBytes=await protectedBytes(configurationFile,32*1024);secretBytes=await protectedBytes(secretFile,512);
    const config=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(configBytes)),secret=new TextDecoder('utf-8',{fatal:true}).decode(secretBytes).trim();
    const prepared=encodeConfirmationMailBundle({config,secret,eventId}),objectKey=confirmationMailObjectKey({eventId,bundleId:prepared.bundleId});
    const destination=await checkedPath(outputFile,true);await mkdir(dirname(destination),{recursive:true,mode:0o700});
    await checkedPath(dirname(destination));await writeFile(destination,prepared.data,{flag:'wx',mode:0o600});
    return {bundleId:prepared.bundleId,objectKey,bytes:prepared.data.length};
  }catch{fail();}finally{secretBytes?.fill(0);configBytes?.fill(0);}
}
function argumentsFor(args){
  const names={'--config-file':'configurationFile','--secret-file':'secretFile','--event':'eventId','--out':'outputFile'},result={};
  if(!Array.isArray(args)||args.length!==8)fail();
  for(let i=0;i<args.length;i+=2){const name=names[args[i]];if(!name||Object.hasOwn(result,name)||typeof args[i+1]!=='string'||args[i+1].startsWith('--'))fail();result[name]=args[i+1];}
  return result;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{
    const result=await prepareConfirmationMailConfiguration(argumentsFor(process.argv.slice(2)));
    console.log('Encrypted confirmation-mail bundle prepared.');
    console.log('Private object key: '+result.objectKey);
    console.log('ARTDICO_CONFIRMATION_EMAIL_BUNDLE_ID='+result.bundleId);
  }catch{console.error('Confirmation mail configuration was not prepared; check protected files and arguments.');process.exitCode=1;}
}
