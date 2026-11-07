import test from 'node:test';
import assert from 'node:assert/strict';
import { organizationLayout } from '../src/config/exhibiting-partners.mjs';

test('all organization page counts form a centred, nonoverlapping composition inside the full sphere', () => {
  for(const mobile of [false,true])for(let count=1;count<=8;count++)for(const diameter of mobile?[260,272,342,780]:[602,984,1056,1408]){
    const layout=organizationLayout(count,{mobile});assert.equal(layout.length,count);
    const boxes=layout.map(({x,y,width,height})=>({x:(x-width/2)*diameter/100,y:y*diameter/100-Math.max(44,height*diameter/100)/2,width:width*diameter/100,height:Math.max(44,height*diameter/100)}));
    assert.ok(Math.abs(layout.reduce((sum,p)=>sum+p.x,0)/count-50)<1e-8,'horizontal centre follows the sphere');
    assert.ok(Math.abs(layout.reduce((sum,p)=>sum+p.y,0)/count-50)<1e-8,'vertical centre follows the sphere');
    const left=Math.min(...boxes.map(b=>b.x)),right=Math.max(...boxes.map(b=>b.x+b.width));
    const top=Math.min(...boxes.map(b=>b.y)),bottom=Math.max(...boxes.map(b=>b.y+b.height));
    assert.ok(Math.abs((left+right)/2-diameter/2)<1e-8);assert.ok(Math.abs((top+bottom)/2-diameter/2)<1e-8);
    for(const box of boxes){assert.ok(box.width>=44&&box.height>=44);for(const x of [box.x,box.x+box.width])for(const y of [box.y,box.y+box.height])assert.ok(Math.hypot(x-diameter/2,y-diameter/2)<=diameter/2-4,'the complete slot stays inside the sphere with an inset');}
    for(let i=0;i<boxes.length;i++)for(let j=i+1;j<boxes.length;j++){
      const a=boxes[i],b=boxes[j];assert.ok(Math.min(a.x+a.width,b.x+b.width)-Math.max(a.x,b.x)<=0||Math.min(a.y+a.height,b.y+b.height)-Math.max(a.y,b.y)<=0,'independent slot rectangles never overlap');
    }
  }
});

test('the eight-logo desktop composition has centred 2/4/2 rows and the last mobile page stays centred', () => {
  const desktop=organizationLayout(8),rows=[...new Set(desktop.map(p=>p.y))].map(y=>desktop.filter(p=>p.y===y));
  assert.deepEqual(rows.map(row=>row.length),[2,4,2]);
  for(const row of rows)assert.equal(row.reduce((sum,p)=>sum+p.x,0)/row.length,50);
  for(const count of [1,2,3]){
    const page=organizationLayout(count,{mobile:true});assert.equal(page.reduce((sum,p)=>sum+p.x,0)/count,50);assert.equal(page.reduce((sum,p)=>sum+p.y,0)/count,50);
  }
});

test('layout does not mutate caller state or leak a mutable shared pattern', () => {
  const first=organizationLayout(8);first[0].x=0;first.push({x:0});
  assert.equal(organizationLayout(8).length,8);assert.notEqual(organizationLayout(8)[0].x,0);
  assert.deepEqual(organizationLayout(0),[]);
  for(const count of [-1,201,1.5,'8',null,NaN])assert.throws(()=>organizationLayout(count),TypeError);
  assert.throws(()=>organizationLayout(1,{mobile:'yes'}),TypeError);
});


test('more than eight organizations fit in one centred sphere without pagination or overlapping slots', () => {
 for (const count of [9,10,13,16,30,100,200]) {
  const slots=organizationLayout(count);assert.equal(slots.length,count);
  for (const axis of ['x','y']) assert.ok(Math.abs(slots.reduce((sum,p)=>sum+p[axis],0)/count-50)<1e-8);
  for(const slot of slots)for(const x of [slot.x-slot.width/2,slot.x+slot.width/2])for(const y of [slot.y-slot.height/2,slot.y+slot.height/2])assert.ok(Math.hypot(x-50,y-50)<50);
  for(let i=0;i<slots.length;i++)for(let j=i+1;j<slots.length;j++){
   const a=slots[i],b=slots[j];assert.ok(Math.abs(a.x-b.x)>=(a.width+b.width)/2||Math.abs(a.y-b.y)>=(a.height+b.height)/2);
  }
 }
});
