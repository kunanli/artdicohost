import {crc32} from 'node:zlib';
import {importHeaders} from '../../shared/contact-import.mjs';

const xml=value=>String(value).replace(/&/gu,'&amp;').replace(/</gu,'&lt;').replace(/>/gu,'&gt;').replace(/"/gu,'&quot;');
function column(value){let result='';while(value){const remainder=(value-1)%26;result=String.fromCharCode(65+remainder)+result;value=Math.floor((value-1)/26);}return result;}

/** A standard stored ZIP containing only generated synthetic questionnaire cells. */
export function syntheticWorkbookBytes(){
  const row=Array(39).fill(null);Object.assign(row,{0:1,1:'2026-10-20 10:00:00',6:'合成导入来宾',7:'合成城市',8:'合成机构',9:'合成角色',10:'synthetic@example.invalid',11:'synthetic_wechat',12:'https://example.invalid',13:1,22:1,32:'纯合成的导入测试资料',33:'https://example.invalid/project',34:1,35:1,36:'合成交流',37:1,38:1});
  const data=[[...importHeaders],row].map((values,index)=>'<row r="'+(index+1)+'">'+values.flatMap((value,offset)=>value===null?[]:['<c r="'+column(offset+1)+(index+1)+'"'+(typeof value==='number'?'><v>'+value+'</v>':' t="inlineStr"><is><t>'+xml(value)+'</t></is>')+'</c>']).join('')+'</row>').join('');
  const files={
    '[Content_Types].xml':'<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>',
    '_rels/.rels':'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
    'xl/workbook.xml':'<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="合成资料" sheetId="1" r:id="rId1"/></sheets></workbook>',
    'xl/_rels/workbook.xml.rels':'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>',
    'xl/worksheets/sheet1.xml':'<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>'+data+'</sheetData></worksheet>',
  };
  const locals=[],central=[];let offset=0;
  for(const[path,text]of Object.entries(files)){
    const name=Buffer.from(path),bytes=Buffer.from(text),checksum=crc32(bytes),local=Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50);local.writeUInt16LE(20,4);local.writeUInt16LE(0x800,6);local.writeUInt32LE(checksum,14);local.writeUInt32LE(bytes.length,18);local.writeUInt32LE(bytes.length,22);local.writeUInt16LE(name.length,26);
    const header=Buffer.alloc(46);header.writeUInt32LE(0x02014b50);header.writeUInt16LE(20,4);header.writeUInt16LE(20,6);header.writeUInt16LE(0x800,8);header.writeUInt32LE(checksum,16);header.writeUInt32LE(bytes.length,20);header.writeUInt32LE(bytes.length,24);header.writeUInt16LE(name.length,28);header.writeUInt32LE(offset,42);
    locals.push(local,name,bytes);central.push(header,name);offset+=local.length+name.length+bytes.length;
  }
  const directory=Buffer.concat(central),end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50);end.writeUInt16LE(Object.keys(files).length,8);end.writeUInt16LE(Object.keys(files).length,10);end.writeUInt32LE(directory.length,12);end.writeUInt32LE(offset,16);
  return Buffer.concat([...locals,directory,end]);
}
