import test from 'node:test';
import assert from 'node:assert/strict';
import readWorkbook, {readSheet} from 'read-excel-file/node';
import {createXlsxWorkbook} from '../shared/xlsx-workbook.mjs';

test('genuine OOXML workbook reads back Chinese, leading-zero IDs and formula-shaped text without executing formulas',async()=>{
  const sheets=[{name:'合成人员',headers:['编号','姓名','备注'],rows:[['000001','=SUM(A1)','  \t@合成 & <内容> "测试"\n第二行  '],['2026-12-05','合成文字','</t><f>1+1</f>']]},{name:'说明',headers:['项目','说明'],rows:[['保留资料','状态变化不删除原件。']]}];
  const before=structuredClone(sheets),bytes=createXlsxWorkbook(sheets);
  assert.deepEqual([...bytes.subarray(0,4)],[80,75,3,4]);assert.deepEqual(sheets,before);
  const read=await readWorkbook(Buffer.from(bytes),{trim:false});assert.equal(read.length,2);assert.deepEqual(await readSheet(Buffer.from(bytes),'合成人员',{trim:false}),[sheets[0].headers,...sheets[0].rows]);
  assert.equal(Buffer.from(bytes).includes(Buffer.from('<f>')),false);assert.ok(Buffer.from(bytes).includes(Buffer.from('t="inlineStr"')));
});
test('invalid sheet names, unbounded cells and workbook size are rejected instead of silently truncating data',()=>{
  for(const sheet of [{name:'invalid/name',headers:['值'],rows:[]},{name:'合成',headers:['值'],rows:[['x'.repeat(32768)]]},{name:'合成',headers:['值'],rows:[['\u0000']]}])assert.throws(()=>createXlsxWorkbook([sheet]),RangeError);
  assert.throws(()=>createXlsxWorkbook([{name:'合成',headers:['值'],rows:[['x'.repeat(2000)]]}],{maxBytes:1024}),RangeError);
  assert.throws(()=>createXlsxWorkbook([{name:'重复',headers:['值'],rows:[]},{name:'重复',headers:['值'],rows:[]}]),RangeError);
});
