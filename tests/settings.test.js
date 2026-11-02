import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveTarget } from '../extension/lib/settings.js';

test('auto picks the AI whose site you are on', () => {
  const s = { target: 'auto', defaultAI: 'claude' };
  assert.equal(resolveTarget(s, 'chatgpt.com'), 'chatgpt');
  assert.equal(resolveTarget(s, 'chat.openai.com'), 'chatgpt');
  assert.equal(resolveTarget(s, 'claude.ai'), 'claude');
  assert.equal(resolveTarget(s, 'en.wikipedia.org'), 'claude');
  assert.equal(resolveTarget({ target: 'auto', defaultAI: 'chatgpt' }, 'github.com'), 'chatgpt');
});

test('explicit choice wins', () => {
  assert.equal(resolveTarget({ target: 'chatgpt', defaultAI: 'claude' }, 'claude.ai'), 'chatgpt');
});
