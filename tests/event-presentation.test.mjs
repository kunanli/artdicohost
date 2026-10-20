import test from 'node:test';
import assert from 'node:assert/strict';
import { validateContent, toPublicContent } from '../shared/content-schema.mjs';
import { createInitialContent } from '../src/config/content.mjs';

const presentation = () => ({ heroDescription: '合成活动说明', aboutTitle: '合成介绍', aboutText: '第一行\n第二行',
  faqItems: [{ question: '合成问题', answer: '合成回答' }], contactEmail: 'Synthetic@Example.invalid',
  mapUrl: 'https://maps.example.invalid/location', checkInTime: '09:30', openingTime: '10:00', endTime: '18:00' });

test('page presentation is optional for legacy drafts and explicitly projected without private or unknown fields', () => {
  const draft = createInitialContent();
  delete draft.event.presentation;
  assert.equal(validateContent(draft).valid, true);
  draft.event.presentation = { ...presentation(), privateNote: 'PRIVATE-SYNTHETIC' };
  draft.event.presentation.faqItems[0].internalNotes = 'PRIVATE-SYNTHETIC';
  const checked = validateContent(draft);
  assert.equal(checked.valid, true, JSON.stringify(checked.errors));
  const published = toPublicContent(draft);
  assert.equal(published.event.presentation.contactEmail, 'synthetic@example.invalid');
  assert.equal(JSON.stringify(published).includes('PRIVATE-SYNTHETIC'), false);
  published.event.presentation.faqItems[0].answer = '改动';
  assert.equal(draft.event.presentation.faqItems[0].answer, '合成回答');
});

test('malformed presentation, executable links, implicit times, oversized FAQs and reversed hours are rejected', () => {
  for (const patch of [null, [], { mapUrl: 'javascript:alert(1)' }, { mapUrl: 'https://user:pass@example.invalid' },
    { mapUrl: 'https://example.invalid/\\x' }, { contactEmail: 'not-an-email' }, { checkInTime: '9:30' },
    { openingTime: '18:00', endTime: '10:00' }, { checkInTime: '11:00', openingTime: '10:00' },
    { faqItems: 'invalid' }, { faqItems: Array.from({ length: 21 }, () => ({ question: '问题', answer: '回答' })) },
    { faqItems: [{ question: '问题', answer: 3 }] }, { heroDescription: 3 }, { aboutText: 'x'.repeat(4001) }]) {
    const draft = createInitialContent();
    draft.event.presentation = patch === null || Array.isArray(patch) ? patch : { ...presentation(), ...patch };
    assert.equal(validateContent(draft).valid, false, JSON.stringify(patch));
  }
});
