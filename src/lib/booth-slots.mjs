/** Fill missing physical positions without inventing occupiers or changing existing records. */
export function completeBoothSlots(records,{idForSlot=slot=>'booth-slot-'+slot+'-'+Array.from(crypto.getRandomValues(new Uint8Array(12)),value=>value.toString(16).padStart(2,'0')).join('')}={}){
  if(!Array.isArray(records)||records.length>200||typeof idForSlot!=='function')throw new TypeError('展位资料无效。');
  const booths=structuredClone(records),occupied=new Set(records.filter(item=>['pending','confirmed'].includes(item.status)).map(item=>item.slotNumber));
  const codes=new Set(records.map(item=>item.code.toUpperCase())),ids=new Set(records.map(item=>item.id));
  let created=0;
  for(let slotNumber=1;slotNumber<=15;slotNumber++){
    if(occupied.has(slotNumber))continue;
    const base='C-'+String(slotNumber).padStart(2,'0');let code=base,sequence=2;
    while(codes.has(code))code=base+'-'+sequence++;
    const id=idForSlot(slotNumber);
    if(typeof id!=='string'||!/^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/u.test(id)||ids.has(id))throw new TypeError('展位标识无效，请重试。');
    ids.add(id);codes.add(code);
    booths.push({id,code,organization:'',project:'',zone:'C',status:'pending',internalNotes:'',slotNumber,contactName:'',contactMethods:'',description:''});created++;
  }
  if(booths.length>200)throw new TypeError('展位记录已达上限，请先核对历史记录。');
  return{booths,created};
}
