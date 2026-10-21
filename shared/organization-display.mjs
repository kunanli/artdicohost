/** Safe rendering of an already-public organization projection; publication is authorized by the server. */
import {isPublicWebsite} from './content-schema.mjs';

const record=value=>value!==null&&typeof value==='object'&&!Array.isArray(value)
  &&[Object.prototype,null].includes(Object.getPrototypeOf(value));
const own=(value,key)=>Object.getOwnPropertyDescriptor(value,key)?.value;
const idPattern=/^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/u;
const logoPattern=/^\/api\/public\/portraits\/[a-f0-9]{64}\.(?:jpg|png|webp)$/u;
const labels=Object.freeze({undecided:'',exhibitor:'参展',attendee:'一般参与'});

export function organizationParticipationLabel(participation) {
  return typeof participation==='string'&&Object.hasOwn(labels,participation)?labels[participation]:'';
}

/** Invalid links/images are omitted while a valid public name remains readable. */
export function publicOrganizationCards(input) {
  if(!Array.isArray(input)||input.length>200)return[];
  const seen=new Set();
  return input.flatMap(value=>{
    if(!record(value))return[];
    if(own(value,'status')!=='confirmed'||own(value,'publicConsent')!==true)return[];
    const id=own(value,'id'),name=own(value,'name'),participation=own(value,'participation');
    if(typeof id!=='string'||!idPattern.test(id)||seen.has(id)||typeof name!=='string'||!name.trim()
      ||[...name.trim()].length>160||/[\u0000-\u001f\u007f]/u.test(name)||typeof participation!=='string'||!Object.hasOwn(labels,participation))return[];
    const website=own(value,'website'),logoUrl=own(value,'logoUrl'),logoId=own(value,'logoId');
    const safeLogo=typeof logoUrl==='string'&&logoPattern.test(logoUrl)
      &&(!Object.hasOwn(value,'logoId')||typeof logoId==='string'&&logoUrl==='/api/public/portraits/'+logoId);
    seen.add(id);
    return[{id,name:name.normalize('NFC').trim(),participation,
      website:typeof website==='string'&&isPublicWebsite(website)?website:'',
      logoUrl:safeLogo?logoUrl:''}];
  });
}
