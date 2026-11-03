const ID=/^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/u;
export const DISPLAY_ORDER_COLLECTIONS=Object.freeze(['guests','organizations','showcases','sessions']);

function displayIds(records,visibleIds){
  if(!Array.isArray(records)||records.length>200||!Array.isArray(visibleIds)||visibleIds.length>records.length)return null;
  const ids=records.map(item=>item?.id);
  if(ids.some(value=>typeof value!=='string'||!ID.test(value))||new Set(ids).size!==ids.length
    ||visibleIds.some(value=>typeof value!=='string'||!ID.test(value))||new Set(visibleIds).size!==visibleIds.length)return null;
  const visible=new Set(visibleIds);
  return JSON.stringify(ids.filter(value=>visible.has(value)))===JSON.stringify(visibleIds)?ids:null;
}
/** Resolve a neighbour in the displayed subset without guessing by label. */
export function displayOrderTarget(records,visibleIds,id,direction){
  if(!['up','down'].includes(direction)||typeof id!=='string'||!ID.test(id)||!displayIds(records,visibleIds))return null;
  const position=visibleIds.indexOf(id),target=position+(direction==='up'?-1:1);
  return position>=0&&target>=0&&target<visibleIds.length?visibleIds[target]:null;
}
function swapped(records,id,target){if(!target)return null;const result=[...records],from=result.findIndex(item=>item.id===id),to=result.findIndex(item=>item.id===target);[result[from],result[to]]=[result[to],result[from]];return result;}
/** Hidden records retain their slots; every record keeps its ID and fields. */
export function moveDisplayRecord(records,visibleIds,id,direction){return swapped(records,id,displayOrderTarget(records,visibleIds,id,direction));}
const sessionPeriod=item=>typeof item?.start==='string'&&/^(?:[01]\d|2[0-3]):[0-5]\d$/u.test(item.start)?item.start<'12:00'?'morning':'afternoon':null;
/** A front agenda move is limited to published-state rows in the same zone and
 * half-day. The caller supplies the current effective display order first. */
export function sessionDisplayOrderTarget(records,visibleIds,id,direction){
  if(!displayIds(records,visibleIds))return null;
  const current=records.find(item=>item.id===id),period=sessionPeriod(current);
  if(!current||!period||!['A','B','C'].includes(current.zone)||!['scheduled','cancelled'].includes(current.status))return null;
  const byId=new Map(records.map(item=>[item.id,item]));
  const sameGroup=visibleIds.filter(key=>{const item=byId.get(key);return item.zone===current.zone&&sessionPeriod(item)===period&&['scheduled','cancelled'].includes(item.status);});
  return displayOrderTarget(records,sameGroup,id,direction);
}
export function moveSessionDisplayRecord(records,visibleIds,id,direction){return swapped(records,id,sessionDisplayOrderTarget(records,visibleIds,id,direction));}
