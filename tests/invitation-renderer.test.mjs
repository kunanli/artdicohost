import test from 'node:test';
import assert from 'node:assert/strict';
import {
  validateInvitationData, fitText, wrapText, fitTextBlock, invitationFilename, renderInvitation,
} from '../src/lib/invitation-renderer.mjs';

function contextFixture() {
  const operations = [];
  return {
    operations,
    font: '',
    measureText(text) {
      const size = Number(this.font.match(/(\d+)px/)?.[1] || 20);
      return { width: Array.from(text).reduce((width, char) => width + (/[^\x00-\xff]/u.test(char) ? size : size * 0.6), 0) };
    },
    fillText(...args) { operations.push(['text', ...args]); },
    drawImage(...args) { operations.push(['image', ...args]); },
    clearRect() {}, fillRect() {}, save() {}, restore() {}, translate() {}, rotate() {},
  };
}

test('formal output requires explicit confirmation and complete factual information', () => {
  assert.equal(validateInvitationData({ recipientName: '示例称呼', confirmed: 'true' }).value.confirmed, false);
  assert.equal(validateInvitationData({ recipientName: '示例称呼', confirmed: true }).valid, false);
  assert.equal(validateInvitationData({ recipientName: '示例称呼', date: '2026/12/05', time: '10:00–18:00', venue: '待确认', confirmed: true }).valid, false);
  assert.equal(validateInvitationData({ recipientName: '示例称呼', date: '2026/12/05', time: '10:00–18:00', venue: '测试会场', confirmed: true }).valid, true);
});

test('unconfirmed data may be blank; recipient and bounded fields are required', () => {
  assert.equal(validateInvitationData({ recipientName: '示例称呼' }).valid, true);
  assert.equal(validateInvitationData({ recipientName: '' }).valid, false);
  assert.equal(validateInvitationData({ recipientName: '称'.repeat(81) }).valid, false);
  assert.equal(validateInvitationData({ recipientName: '  示例\n称呼  ' }).value.recipientName, '示例 称呼');
});

test('single-line fitting decreases font size to available width', () => {
  const context = contextFixture();
  const size = fitText(context, '很长的中文称呼', { maxWidth: 300, maxFontSize: 100, minFontSize: 20 });
  assert.ok(size < 100);
  assert.ok(context.measureText('很长的中文称呼').width <= 300);
});

test('mixed Chinese and long Latin names wrap without dropping characters', () => {
  const context = contextFixture();
  context.font = '500 40px sans-serif';
  const input = '示例NameWithoutSpaces以及更多称呼';
  const lines = wrapText(context, input, 160);
  assert.ok(lines.length > 1);
  assert.equal(lines.join(''), input);
  assert.ok(lines.every((line) => context.measureText(line).width <= 160));
});

test('long names and venues fit bounded blocks completely; impossible blocks fail clearly', () => {
  const context = contextFixture();
  const input = '中文称呼'.repeat(10);
  const layout = fitTextBlock(context, input, { maxWidth: 900, maxHeight: 102, maxFontSize: 100, minFontSize: 28 });
  assert.equal(layout.lines.join(''), input);
  assert.ok(layout.height <= 102);
  assert.throws(() => fitTextBlock(context, '称呼'.repeat(100), { maxWidth: 50, maxHeight: 20, maxFontSize: 40, minFontSize: 28 }), RangeError);
});

test('filenames remove path syntax and only use strict boolean for confirmed label', () => {
  assert.equal(invitationFilename('../测试/称呼', true), 'GGJ邀请函-.._测试_称呼-已确认.png');
  assert.match(invitationFilename('示例称呼', 'true'), /暂定\.png$/u);
});

test('renderer draws template, fills missing tentative fields and adds visible draft marks', async () => {
  const context = contextFixture();
  const canvas = { getContext: () => context };
  const metadata = await renderInvitation(canvas, { recipientName: '示例称呼' }, { loadImage: async () => ({ fake: true }) });
  assert.deepEqual([canvas.width, canvas.height], [1080, 1920]);
  assert.equal(metadata.confirmed, false);
  assert.equal(metadata.deliveryStatus, 'not_sent');
  const text = context.operations.filter((operation) => operation[0] === 'text').map((operation) => operation[1]);
  assert.ok(text.includes('日期待确认'));
  assert.ok(text.includes('地点待确认'));
  assert.ok(text.includes('暂定 · 信息待确认'));
  assert.ok(text.includes('暂定'));
});

test('only explicit staff confirmation removes draft marks; generating never means sent', async () => {
  const context = contextFixture();
  const metadata = await renderInvitation({ getContext: () => context }, {
    recipientName: '示例称呼', date: '2026/12/05', time: '10:00–18:00', venue: '测试会场', confirmed: true,
  }, { loadImage: async () => ({ fake: true }) });
  assert.equal(metadata.confirmed, true);
  assert.equal(metadata.deliveryStatus, 'not_sent');
  assert.ok(!context.operations.some((operation) => operation[0] === 'text' && operation[1].includes('暂定')));
});

const V2='ggj2026-poster-v2';
const poster=(extra={})=>({recipientName:'合成嘉宾',date:'2026-12-05',time:'10:00–18:00',venue:'深圳前海5号楼3F',confirmed:true,renderVersion:V2,...extra});
const fonts=async()=>({mediumFamily:'"SyntheticMedium"',regularFamily:'"SyntheticRegular"',regularWeight:400});
const image=async()=>({width:941,height:1672});
test('only exact V2 admits the complete 120-character name and 300-character venue',()=>{assert.equal(validateInvitationData(poster({recipientName:'称'.repeat(120),venue:'地'.repeat(300)})).valid,true);for(const extra of[{recipientName:'称'.repeat(121)},{venue:'地'.repeat(301)},{renderVersion:2},{renderVersion:undefined},{renderVersion:null},{date:'2026-02-30'},{time:'18:00–10:00'},{recipientName:'\n称呼'},{venue:'地点\t'}])assert.equal(validateInvitationData(poster(extra)).valid,false);assert.equal(validateInvitationData(poster({recipientName:'合成  Guest  来宾'})).value.recipientName,'合成  Guest  来宾');});
test('legacy rendering keeps its original template/system font and never requests new fonts',async()=>{const context=contextFixture();let url;await renderInvitation({getContext:()=>context},{recipientName:'合成来宾',confirmed:false},{loadImage:async value=>{url=value;return{};},loadFonts:()=>assert.fail('legacy fonts stay unchanged')});assert.equal(url,'/invitations/template-blank.png');assert.ok(context.font.includes('Microsoft YaHei'));});
test('V2 fixes the template URL and paints only the exact stored facts with slash date display',async()=>{const context=contextFixture();let url;const result=await renderInvitation({getContext:()=>context},poster({templateUrl:'https://untrusted.invalid/other.png',venue:'已保存自订  场地'}),{loadImage:async value=>{url=value;return image();},loadFonts:fonts});assert.equal(url,'/invitations/ggj2026-poster-v2.webp');assert.equal(result.renderVersion,V2);assert.equal(result.layouts.date.lines.join(''),'2026/12/05');assert.equal(result.layouts.time.lines.join(''),'10:00–18:00');assert.equal(result.layouts.venue.lines.join(''),'已保存自订  场地');assert.equal(result.deliveryStatus,'not_sent');});
test('font loading must finish before measuring or painting personal text',async()=>{const context=contextFixture();let release,started;const entered=new Promise(resolve=>{started=resolve;});const gate=new Promise(resolve=>{release=resolve;});let measured=0;const measure=context.measureText.bind(context);context.measureText=text=>{measured++;return measure(text);};const rendering=renderInvitation({getContext:()=>context},poster(),{loadImage:image,loadFonts:async()=>{started();await gate;return fonts();}});await entered;assert.equal(measured,0);assert.deepEqual(context.operations,[]);release();await rendering;assert.ok(measured>0);});
test('V2 complete Chinese and mixed names wrap without trimming internal spaces or exceeding the name zone',async()=>{for(const name of['称'.repeat(120),('A中  B文').repeat(20)]){const context=contextFixture(),result=await renderInvitation({getContext:()=>context},poster({recipientName:name}),{loadImage:image,loadFonts:fonts});assert.equal(result.layouts.recipientName.lines.join(''),name);assert.ok(result.layouts.recipientName.lines.length<=4);assert.ok(result.layouts.recipientName.fontSize>=24);assert.ok(result.layouts.recipientName.height<=138);}});
test('V2 preserves all 300 venue characters within eight lines before the globe',async()=>{const context=contextFixture(),venue='地'.repeat(300),result=await renderInvitation({getContext:()=>context},poster({venue}),{loadImage:image,loadFonts:fonts});assert.equal(result.layouts.venue.lines.join(''),venue);assert.ok(result.layouts.venue.lines.length<=8);assert.ok(result.layouts.venue.fontSize>=12);assert.ok(result.layouts.venue.height<=140);});
test('font, template and impossible layout failures clear a stale canvas without painting a partial invitation',async()=>{for(const failure of['font','template','layout','unknown']){const context=contextFixture();let clears=0;context.clearRect=()=>{clears++;};if(failure==='layout')context.measureText=()=>({width:1000000});const canvas={getContext:()=>context,width:1080,height:1920,dataset:{ready:'true'}};await assert.rejects(renderInvitation(canvas,poster(failure==='unknown'?{renderVersion:'unknown'}:{}),{loadImage:failure==='template'?async()=>{throw new Error('template failed');}:image,loadFonts:failure==='font'?async()=>{throw new Error('font failed');}:fonts}));assert.equal(clears,1);assert.equal(Object.hasOwn(canvas.dataset,'ready'),false);assert.deepEqual(context.operations,[]);}});
test('actual font ink metrics contribute to vertical fitting and safe line baselines',async()=>{const context=contextFixture(),measure=context.measureText.bind(context);context.measureText=text=>{const size=Number(context.font.match(/(\d+)px/u)?.[1]||20);return{...measure(text),actualBoundingBoxLeft:1,actualBoundingBoxRight:measure(text).width+1,actualBoundingBoxAscent:size*.9,actualBoundingBoxDescent:size*.3};};const result=await renderInvitation({getContext:()=>context},poster({recipientName:'称'.repeat(120)}),{loadImage:image,loadFonts:fonts});assert.ok(result.layouts.recipientName.height<=138);assert.ok(result.layouts.recipientName.ascent>0);assert.ok(result.layouts.recipientName.descent>0);});
