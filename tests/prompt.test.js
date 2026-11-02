import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildPrompt } from '../extension/lib/prompt.js';

test('quotes the selection and adds the question', () => {
  const p = buildPrompt({
    selection: 'E = mc²\nis famous',
    question: 'What does c mean?',
    title: 'Physics  notes',
    url: 'https://x.y/a',
  });
  assert.equal(
    p,
    'About this text from "Physics notes" (https://x.y/a):\n\n> E = mc²\n> is famous\n\nWhat does c mean?'
  );
});

test('empty question defaults to Explain, prefix is appended', () => {
  const p = buildPrompt({ selection: 'x', question: '  ' }, { prefix: 'Answer briefly.' });
  assert.match(p, /^About this text:\n\n> x\n\nExplain this\.\n\nAnswer briefly\.$/);
});

test('very long selections are trimmed', () => {
  const p = buildPrompt({ selection: 'a'.repeat(10000), question: 'q' });
  assert.ok(p.length < 6200);
  assert.match(p, / …\n\nq$/);
});
