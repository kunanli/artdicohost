/** Safe rendering of an already-public organization projection; publication is authorized by the server. */
import {isPublicWebsite} from './content-schema.mjs';

const record=value=>value!==null&&typeof value==='object'&&!Array.isArray(value)
  &&[Object.prototype,null].includes(Object.getPrototypeOf(value));
const own=(value,key)=>Object.getOwnPropertyDescriptor(value,key)?.value;
const idPattern=/^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/u;
const logoPattern=/^\/api\/public\/portraits\/[a-f0-9]{64}\.(?:jpg|png|webp)$/u;
const labels=Object.freeze({undecided:'',exhibitor:'参展',attendee:'一般参与'});
const referenceOrder=['gamezone','igda','szdx','bu','pengyou','g4c','teesside'];
const referenceIds=Object.freeze({'game-singularity':'gamezone','igda-shenzhen':'igda','pengyou-gangwan':'pengyou','g4c-hk':'g4c',
  'organization-030b43f23f33413c8f81ed1fcd1d282d':'bu',
  'organization-61fee7cdf16f439a85f071b0e553ed4e':'teesside',
  'organization-668f234fcd2640a1a35dab8f0fc63bf3':'szdx'});
const referenceName=value=>typeof value==='string'?value.trim().replace(/\s+/gu,' ').toLowerCase():'';
const referenceNames=new Map([
  ['gamezone',['GameZone','游戏奇点']],
  ['igda',['IGDA 深圳','IGDA Shenzhen']],
  ['szdx',['深圳大学艺术学部']],
  ['bu',['BU','Bournemouth University','BournemouthUniversity','伯恩茅斯大学']],
  ['pengyou',['鹏游港湾']],
  ['g4c',['G4C HK']],
  ['teesside',['Teesside University','TeessideUniversity','提赛德大学','英国提赛德大学']],
].flatMap(([key,names])=>names.map(name=>[referenceName(name),key])));

/** A visual reference key only; exact known IDs take precedence over name aliases. */
export function organizationReferenceKey(card) {
  if(!record(card))return null;
  const id=own(card,'id');
  if(typeof id==='string'&&Object.hasOwn(referenceIds,id))return referenceIds[id];
  return referenceNames.get(referenceName(own(card,'name')))??null;
}

/** Sort a copy for the artwork. Equal brands and unknown entries retain input
 * order, and every original card remains distinct and untouched. */
export function orderOrganizationCards(cards) {
  if(!Array.isArray(cards))return[];
  return cards.map((card,index)=>({card,index,rank:referenceOrder.indexOf(organizationReferenceKey(card))}))
    .sort((a,b)=>(a.rank<0?referenceOrder.length:a.rank)-(b.rank<0?referenceOrder.length:b.rank)||a.index-b.index)
    .map(item=>item.card);
}

/** A design variant may replace only the exact published source it was reviewed
 * against. A new upload or an explicit removal always uses the live source. */
export function organizationLogoVariant(card,variants) {
  const key=organizationReferenceKey(card),variant=key&&record(variants)?own(variants,key):null;
  const source=record(card)?own(card,'logoUrl'):null;
  const match=typeof source==='string'?logoPattern.exec(source):null;
  if(!match||!record(variant)||own(variant,'sourceDigest')!==source.split('/').at(-1)?.split('.')[0])return null;
  const url=own(variant,'url');
  return typeof url==='string'&&url.startsWith('/')&&!url.startsWith('//')&&!url.includes('\\')&&!url.includes('..')&&!/[\u0000-\u0020\u007f]/u.test(url)?url:null;
}

export function organizationParticipationLabel(participation) {
  return typeof participation==='string'&&Object.hasOwn(labels,participation)?labels[participation]:'';
}

/** Invalid links/images are omitted while a valid public name remains readable. */
export function publicOrganizationCards(input) {
  if(!Array.isArray(input)||input.length>200)return[];
  const seen=new Set();
  return input.flatMap(value=>{
    if(!record(value))return[];
    if(Object.hasOwn(value,'visibility')&&own(value,'visibility')!=='public'
      ||!['pending','confirmed','withdrawn'].includes(own(value,'status')))return[];
    const id=own(value,'id'),name=own(value,'name'),participation=own(value,'participation');
    if(typeof id!=='string'||!idPattern.test(id)||seen.has(id)||typeof name!=='string'||!name.trim()
      ||[...name.trim()].length>160||/[\u0000-\u001f\u007f]/u.test(name)||typeof participation!=='string'||!Object.hasOwn(labels,participation))return[];
    const website=own(value,'website'),logoUrl=own(value,'logoUrl'),logoId=own(value,'logoId');
    const safeLogo=typeof logoUrl==='string'&&logoPattern.test(logoUrl)
      &&(!Object.hasOwn(value,'logoId')||typeof logoId==='string'&&logoUrl==='/api/public/portraits/'+logoId);
    seen.add(id);
    return[{id,name:name.normalize('NFC').trim(),participation,
      website:typeof website==='string'&&isPublicWebsite(website)?website:'',
      logoUrl:safeLogo?logoUrl:'',
      ...(own(value,'status')!=='confirmed'?{status:own(value,'status')}:{})}];
  });
}
