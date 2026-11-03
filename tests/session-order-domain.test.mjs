import test from 'node:test';
import assert from 'node:assert/strict';
import { createInitialContent } from '../src/config/content.mjs';
import { orderedSessions, toPublicContent, validateContent } from '../shared/content-schema.mjs';
import { contentSectionSnapshot, contentSaveSnapshot, confirmedContentSave, inspectContentSave, matchesSavedContent, sameContent, contentPublicationReadiness } from '../src/lib/admin-save-state.mjs';

function fixture() {
  const content = createInitialContent();
  const base = content.sessions[0];
  content.sessions = [
    { ...base, id: 'late-morning', zone: 'B', start: '10:30', end: '11:00' },
    { ...base, id: 'early-morning', zone: 'B', start: '09:30', end: '10:00' },
    { ...base, id: 'late-afternoon', zone: 'B', start: '14:00', end: '14:30' },
    { ...base, id: 'early-afternoon', zone: 'B', start: '12:00', end: '12:30' },
  ];
  assert.deepEqual(validateContent(content).errors, {});
  return content;
}
const ids = rows => rows.map(row => row.id);

test('legacy and time ordering use clock then zone with stable ties without mutating saved rows', () => {
  const rows = [
    { id: 'b-later', start: '10:30', zone: 'B' },
    { id: 'b-tie-first', start: '09:30', zone: 'B' },
    { id: 'a-tie', start: '09:30', zone: 'A' },
    { id: 'b-tie-second', start: '09:30', zone: 'B' },
  ];
  const original = structuredClone(rows), expected = ['a-tie', 'b-tie-first', 'b-tie-second', 'b-later'];
  assert.deepEqual(ids(orderedSessions(rows)), expected);
  assert.deepEqual(ids(orderedSessions(rows, 'time')), expected);
  assert.deepEqual(rows, original);
  assert.notEqual(orderedSessions(rows), rows);
  assert.equal(orderedSessions(rows)[0], rows[2], 'the view preserves the original row and all its identity fields');
});

test('manual ordering has one morning then afternoon group while preserving relative order at noon', () => {
  const rows = [
    { id: 'afternoon-late', start: '17:00', zone: 'A' },
    { id: 'morning-late', start: '11:59', zone: 'B' },
    { id: 'afternoon-noon', start: '12:00', zone: 'A' },
    { id: 'morning-early', start: '09:00', zone: 'B' },
  ];
  assert.deepEqual(ids(orderedSessions(rows, 'manual')), ['morning-late', 'morning-early', 'afternoon-late', 'afternoon-noon']);
  assert.deepEqual(ids(rows), ['afternoon-late', 'morning-late', 'afternoon-noon', 'morning-early']);
  assert.deepEqual(orderedSessions([], 'manual'), []);
  for (const mode of [null, '', 'MANUAL', ' manual ', false, {}, []]) assert.throws(() => orderedSessions(rows, mode), TypeError);
});

test('zone and public-state filters retain the selected manual relative order without moving hidden rows', () => {
  const rows = [
    { id: 'b-late', start: '11:00', zone: 'B', status: 'scheduled' },
    { id: 'draft', start: '10:30', zone: 'B', status: 'draft' },
    { id: 'other-zone', start: '09:00', zone: 'A', status: 'scheduled' },
    { id: 'b-early', start: '09:30', zone: 'B', status: 'cancelled' },
    { id: 'b-afternoon', start: '13:00', zone: 'B', status: 'scheduled' },
  ];
  const selected = rows.filter(row => row.zone === 'B' && row.status !== 'draft');
  assert.deepEqual(ids(orderedSessions(selected, 'manual')), ['b-late', 'b-early', 'b-afternoon']);
  assert.deepEqual(ids(orderedSessions(selected)), ['b-early', 'b-late', 'b-afternoon']);
  assert.deepEqual(ids(rows), ['b-late', 'draft', 'other-zone', 'b-early', 'b-afternoon']);
});

test('session-only save scopes mode and rows together without leaking unrelated changes or synthesizing a default', () => {
  const base = fixture(), candidate = structuredClone(base);
  candidate.sessionOrder = 'manual'; candidate.sessions.reverse(); candidate.event.title = 'unrelated unsaved title';
  const submitted = contentSectionSnapshot(3, base, candidate, 'sessions');
  assert.equal(submitted.content.sessionOrder, 'manual');
  assert.deepEqual(submitted.content.sessions, validateContent(candidate).value.sessions);
  assert.deepEqual(submitted.content.event, base.event);
  assert.equal(Object.hasOwn(base, 'sessionOrder'), false);
  assert.equal(Object.hasOwn(contentSectionSnapshot(3, base, base, 'sessions').content, 'sessionOrder'), false);
  const existing = { ...base, sessionOrder: 'manual' };
  assert.equal(contentSectionSnapshot(3, existing, base, 'sessions').content.sessionOrder, 'manual', 'legacy omission cannot clear the saved mode');
  assert.equal(contentSectionSnapshot(3, existing, { ...candidate, sessionOrder: 'time' }, 'sessions').content.sessionOrder, 'time');
  assert.equal(contentSectionSnapshot(3, base, candidate, 'event').content.event.title, 'unrelated unsaved title');
  assert.equal(Object.hasOwn(contentSectionSnapshot(3, base, candidate, 'event').content, 'sessionOrder'), false, 'another section cannot apply session order');
});

test('old pending mode omission reconciles exact save/readback without rewriting original bytes or accepting other changes', () => {
  const content = fixture(); delete content.event.presentation;
  const submitted = contentSaveSnapshot(3, content), original = JSON.stringify(submitted), saved = { ...structuredClone(submitted.content), sessionOrder: 'manual' };
  assert.equal(sameContent(saved, submitted.content), false);
  assert.equal(matchesSavedContent(saved, submitted.content), true);
  assert.equal(confirmedContentSave({ draft: { revision: 4, content: saved } }, submitted).content.sessionOrder, 'manual');
  assert.equal(inspectContentSave({ draft: { revision: 5, content: saved } }, submitted).state, 'confirmed');
  assert.equal(inspectContentSave({ draft: { revision: 3, content: saved } }, submitted).state, 'retryable');
  assert.equal(confirmedContentSave({ draft: { revision: 5, content: saved } }, submitted), null);
  const different = structuredClone(saved); different.sessions.reverse();
  assert.equal(matchesSavedContent(different, submitted.content), false);
  const explicit = { ...structuredClone(submitted.content), sessionOrder: 'time' };
  assert.equal(matchesSavedContent(saved, explicit), false);
  assert.equal(JSON.stringify(submitted), original);
  assert.equal(Object.hasOwn(submitted.content, 'sessionOrder'), false);
});

test('publication readiness exposes mode-only changes and actual manual display order while preserving the frozen publication', () => {
  const content = fixture(), published = { revision: 3, publishedAt: '2026-11-03T10:00:00.000Z', content: toPublicContent(content) };
  const source = { draft: { revision: 4, content }, published }, original = JSON.stringify(published);
  assert.equal(contentPublicationReadiness(source).orderChanged.sessions, false);
  assert.equal(contentPublicationReadiness(source).hasPublicChanges, false);
  content.sessionOrder = 'manual';
  let report = contentPublicationReadiness(source);
  assert.equal(report.orderChanged.sessions, true); assert.equal(report.hasPublicChanges, true);
  assert.equal(report.eventChanged, false);
  assert.equal(report.items.sessions.every(row => row.change === 'unchanged'), true, 'mode does not invent field edits to individual sessions');
  published.content = toPublicContent(content); const saved = JSON.stringify(published);
  report = contentPublicationReadiness(source); assert.equal(report.hasPublicChanges, false); assert.equal(report.orderChanged.sessions, false);
  [content.sessions[0], content.sessions[1]] = [content.sessions[1], content.sessions[0]];
  report = contentPublicationReadiness(source); assert.equal(report.orderChanged.sessions, true); assert.equal(report.hasPublicChanges, true);
  assert.equal(JSON.stringify(published), saved, 'readiness never patches the actual publication');
  assert.notEqual(saved, original); assert.equal(Object.hasOwn(JSON.parse(original).content, 'sessionOrder'), false);
});
