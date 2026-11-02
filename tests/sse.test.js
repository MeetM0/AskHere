import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readSSE, parseEvent } from '../extension/lib/sse.js';

function streamOf(chunks) {
  const enc = new TextEncoder();
  return new ReadableStream({
    start(c) {
      for (const ch of chunks) c.enqueue(enc.encode(ch));
      c.close();
    },
  });
}

test('parses events split across chunks', async () => {
  const body = streamOf([
    'event: content_block_delta\ndata: {"a":',
    '1}\n\nevent: message_stop\r\ndata: {"b":2}\r\n\r\n',
    ': keep-alive comment\n\ndata: [DONE]',
  ]);
  const events = [];
  for await (const e of readSSE(body)) events.push(e);
  assert.deepEqual(events, [
    { event: 'content_block_delta', data: '{"a":1}' },
    { event: 'message_stop', data: '{"b":2}' },
    { event: 'message', data: '[DONE]' },
  ]);
});

test('multi-line data is joined', () => {
  assert.deepEqual(parseEvent('data: one\ndata: two'), { event: 'message', data: 'one\ntwo' });
});
