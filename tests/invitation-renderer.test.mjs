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
