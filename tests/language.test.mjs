import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveLanguage } from '../src/i18n/language.mjs';
import { translate } from '../src/i18n/translate.mjs';

test('manual language wins, then first supported browser preference, then English',()=>{
  assert.equal(resolveLanguage('zh-CN',['en-US']),'zh-CN');
  assert.equal(resolveLanguage('en',['zh-TW']),'en');
  assert.equal(resolveLanguage('corrupt',['fr-FR','zh-HK','en']),'zh-CN');
  assert.equal(resolveLanguage(null,['en-GB','zh-CN']),'en');
  assert.equal(resolveLanguage(null,['zh-TW','en-US']),'zh-CN');
  assert.equal(resolveLanguage(null,[]),'en');
  assert.equal(resolveLanguage(null,['ja-JP']),'en');
});
test('exact copy and bounded UI templates translate without guessing editorial facts',()=>{
  assert.equal(translate('讲者申请','en'),'Speaker application');
  assert.equal(translate('讲者申请','zh-CN'),'讲者申请');
  assert.equal(translate('请检查 3 项标记内容，当前没有提交申请。','en'),'Please check the 3 highlighted fields. No application has been submitted.');
  assert.equal(translate('A 区 · 阶梯展示厅','en'),'Zone A · Presentation hall');
  assert.equal(translate('09:30 开始签到 · ','en'),'09:30 Check-in · ');
  assert.equal(translate('未经翻译的公开主题与姓名','en'),'未经翻译的公开主题与姓名');
  assert.equal(translate('<img src=x onerror=alert(1)>','en'),'<img src=x onerror=alert(1)>');
});
