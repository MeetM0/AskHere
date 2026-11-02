// AskHere service worker: owns API keys and network calls.
// Content scripts never see the keys; they talk to us over a Port and get
// streamed text back.

import { getSettings } from './lib/settings.js';
import { streamCompletion } from './lib/providers.js';
import { buildSystemPrompt, buildFirstTurn } from './lib/prompt.js';

const MENU_ID = 'askhere-ask';

chrome.runtime.onInstalled.addListener((details) => {
  chrome.contextMenus.create({
    id: MENU_ID,
    title: 'Ask AI about "%s"',
    contexts: ['selection'],
  });
  if (details.reason === 'install') chrome.runtime.openOptionsPage();
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === MENU_ID && tab?.id != null) {
    sendToTab(tab.id, { type: 'askhere:open', text: info.selectionText || '' });
  }
});

chrome.commands.onCommand.addListener((command, tab) => {
  if (command === 'ask-selection' && tab?.id != null) {
    sendToTab(tab.id, { type: 'askhere:open' });
  }
});

chrome.action.onClicked.addListener(() => chrome.runtime.openOptionsPage());

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === 'askhere:open-options') {
    chrome.runtime.openOptionsPage();
    sendResponse({ ok: true });
  }
});

function sendToTab(tabId, message) {
  chrome.tabs.sendMessage(tabId, message).catch(() => {
    // Content script isn't on this page (e.g. chrome:// pages or the Web Store).
  });
}

// One Port per question. The panel sends { source, turns } where turns is the
// full conversation so far (first user turn is the raw question; we expand it).
chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== 'askhere:ask') return;
  const controller = new AbortController();
  port.onDisconnect.addListener(() => controller.abort());

  port.onMessage.addListener(async (msg) => {
    if (msg?.type !== 'ask') return;
    try {
      const settings = await getSettings();
      const messages = msg.turns.map((t, i) => ({
        role: t.role,
        content: i === 0 ? buildFirstTurn(msg.source, t.content) : t.content,
      }));
      const result = await streamCompletion({
        settings,
        system: buildSystemPrompt(settings),
        messages,
        signal: controller.signal,
        onText: (text) => safePost(port, { type: 'delta', text }),
      });
      safePost(port, { type: 'done', ...result });
    } catch (err) {
      if (controller.signal.aborted) return;
      safePost(port, {
        type: 'error',
        message: err?.message || String(err),
        needsKey: err?.status === 401,
      });
    }
  });
});

function safePost(port, message) {
  try {
    port.postMessage(message);
  } catch {
    // Panel was closed mid-stream.
  }
}
