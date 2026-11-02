const ID=/^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/u;
export const DISPLAY_ORDER_COLLECTIONS=Object.freeze(['guests','organizations','showcases']);

/** Resolve a neighbour in the displayed subset without guessing by label. */
export function displayOrderTarget(records,visibleIds,id,direction){
  if(!Array.isArray(records)||records.length>200||!Array.isArray(visibleIds)||visibleIds.length>records.length
    ||!['up','down'].includes(direction)||typeof id!=='string'||!ID.test(id))return null;
  const ids=records.map(item=>item?.id);
  if(ids.some(value=>typeof value!=='string'||!ID.test(value))||new Set(ids).size!==ids.length
    ||visibleIds.some(value=>typeof value!=='string'||!ID.test(value))||new Set(visibleIds).size!==visibleIds.length)return null;
  const visible=new Set(visibleIds);
  if(JSON.stringify(ids.filter(value=>visible.has(value)))!==JSON.stringify(visibleIds))return null;
  const position=visibleIds.indexOf(id),target=position+(direction==='up'?-1:1);
  return position>=0&&target>=0&&target<visibleIds.length?visibleIds[target]:null;
}

/** Swap only the two displayed records. Hidden records retain their positions
 * and every record retains its stable ID, fields and associations. */
export function moveDisplayRecord(records,visibleIds,id,direction){
  const target=displayOrderTarget(records,visibleIds,id,direction);if(!target)return null;
  const result=[...records],from=result.findIndex(item=>item.id===id),to=result.findIndex(item=>item.id===target);
  [result[from],result[to]]=[result[to],result[from]];
  return result;
}
