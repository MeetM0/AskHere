// Streaming calls to Claude (Anthropic Messages API) and OpenAI (Chat Completions).
// Both take the same input and call onText(chunk) for every streamed text piece.
//
// We call the HTTP APIs with fetch() directly rather than through an SDK so the
// extension stays build-free: load the folder in Chrome and it runs.

import { readSSE } from './sse.js';

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2026-10-21';
// Models that support server-side refusal fallbacks ("fallbacks": "default").
const FALLBACK_MODELS = new Set([
  'claude-fable-5-1',
  'claude-opus-5-5',
  'claude-opus-5',
  'claude-sonnet-5-5',
]);

const OPENAI_URL = 'https://api.openai.com/v1/chat/completions';

export class ProviderError extends Error {
  constructor(message, { status, retryable } = {}) {
    super(message);
    this.status = status;
    this.retryable = !!retryable;
  }
}

/**
 * @param {object} opts
 * @param {object} opts.settings   values from chrome.storage (see settings.js)
 * @param {string} opts.system     system prompt
 * @param {{role:'user'|'assistant', content:string}[]} opts.messages
 * @param {(text:string)=>void} opts.onText
 * @param {AbortSignal} opts.signal
 * @returns {Promise<{stopReason:string|null, model:string}>}
 */
export async function streamCompletion(opts) {
  if (opts.settings.provider === 'openai') return streamOpenAI(opts);
  return streamAnthropic(opts);
}

async function streamAnthropic({ settings, system, messages, onText, signal }) {
  const key = settings.anthropicKey.trim();
  if (!key) throw new ProviderError('Add your Claude API key in AskHere settings.', { status: 401 });

  const model = settings.anthropicModel.trim() || 'claude-opus-5-5';
  const headers = {
    'content-type': 'application/json',
    'x-api-key': key,
    'anthropic-version': ANTHROPIC_VERSION,
    // Required for requests that come from a browser context (our extension).
    'anthropic-dangerous-direct-browser-access': 'true',
  };
  const body = {
    model,
    max_tokens: 16000,
    stream: true,
    system,
    messages,
    output_config: { effort: settings.effort || 'low' },
  };
  if (FALLBACK_MODELS.has(model)) {
    // If a safety classifier declines, the API retries on a fallback model
    // inside the same stream instead of just stopping.
    headers['anthropic-beta'] = 'server-side-fallback-2026-07-01';
    body.fallbacks = 'default';
  }

  const res = await fetch(ANTHROPIC_URL, { method: 'POST', headers, body: JSON.stringify(body), signal });
  if (!res.ok) throw await httpError(res, 'Claude');

  let stopReason = null;
  let servedModel = model;
  for await (const { data } of readSSE(res.body)) {
    let evt;
    try {
      evt = JSON.parse(data);
    } catch {
      continue;
    }
    switch (evt.type) {
      case 'message_start':
        servedModel = evt.message?.model || servedModel;
        break;
      case 'content_block_delta':
        if (evt.delta?.type === 'text_delta') onText(evt.delta.text);
        break;
      case 'message_delta':
        if (evt.delta?.stop_reason) stopReason = evt.delta.stop_reason;
        break;
      case 'error':
        throw new ProviderError(evt.error?.message || 'Claude returned an error.', {
          retryable: evt.error?.type === 'overloaded_error',
        });
    }
  }
  return { stopReason, model: servedModel };
}

async function streamOpenAI({ settings, system, messages, onText, signal }) {
  const key = settings.openaiKey.trim();
  if (!key) throw new ProviderError('Add your OpenAI API key in AskHere settings.', { status: 401 });

  const model = settings.openaiModel.trim() || 'gpt-5';
  const res = await fetch(OPENAI_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model,
      stream: true,
      messages: [{ role: 'system', content: system }, ...messages],
    }),
    signal,
  });
  if (!res.ok) throw await httpError(res, 'OpenAI');

  let stopReason = null;
  for await (const { data } of readSSE(res.body)) {
    if (data === '[DONE]') break;
    let evt;
    try {
      evt = JSON.parse(data);
    } catch {
      continue;
    }
    const choice = evt.choices?.[0];
    const text = choice?.delta?.content;
    if (text) onText(text);
    if (choice?.finish_reason) stopReason = choice.finish_reason;
  }
  return { stopReason, model };
}

async function httpError(res, name) {
  let detail = '';
  try {
    const json = await res.json();
    detail = json?.error?.message || '';
  } catch {
    /* body was not JSON */
  }
  const hints = {
    401: `Your ${name} API key was rejected. Check it in AskHere settings.`,
    403: `Your ${name} API key doesn't have access to this model.`,
    404: `Model not found. Check the model name in AskHere settings.`,
    429: `${name} rate limit reached. Wait a moment and try again.`,
  };
  const msg = hints[res.status] || `${name} request failed (HTTP ${res.status}).`;
  return new ProviderError(detail ? `${msg}\n${detail}` : msg, {
    status: res.status,
    retryable: res.status === 429 || res.status >= 500,
  });
}
