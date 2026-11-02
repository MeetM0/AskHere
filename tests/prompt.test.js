import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildSystemPrompt, buildFirstTurn } from '../extension/lib/prompt.js';

test('system prompt includes custom instructions and length', () => {
  const p = buildSystemPrompt({ answerLength: 'detailed', customInstructions: 'Answer in Hindi.' });
  assert.match(p, /thorough/);
  assert.match(p, /Answer in Hindi\./);
});

test('first turn wraps the selection and context', () => {
  const t = buildFirstTurn(
    { selection: 'E = mc^2', context: 'Einstein said E = mc^2 in 1905.', title: 'Physs "notes"', url: 'https://x.y' },
    'What does c mean?'
  );
  assert.match(t, /<highlighted>\nE = mc\^2\n<\/highlighted>/);
  assert.match(t, /<surrounding_text>/);
  assert.match(t, /title="Physs &quot;notes&quot;"/);
  assert.match(t, /Question: What does c mean\?$/);
});

test('context identical to the selection is skipped', () => {
  const t = buildFirstTurn({ selection: 'same', context: 'same' }, 'q');
  assert.ok(!t.includes('surrounding_text'));
});
