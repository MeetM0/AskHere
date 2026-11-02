// AskHere service worker.
// Opens the user's own Claude / ChatGPT (claude.ai, chatgpt.com) in a small
// popup window positioned right next to the highlighted text, and hands the
// question to inject.js running inside that window, which types and sends it.
// No API keys: it's just the website, with whatever account you're logged in to.

import { getSettings, resolveTarget, AI_SITES, WINDOW_SIZES } from './lib/settings.js';
import { buildPrompt } from './lib/prompt.js';
import { placeWindow } from './lib/placement.js';

const MENU_ID = 'askhere-ask';
const PENDING_TTL_MS = 10 * 60 * 1000;

chrome.runtime.onInstalled.addListener((details) => {
  chrome.contextMenus.create({ id: MENU_ID, title: 'Ask AI about "%s"', contexts: ['selection'] });
  if (details.reason === 'install') chrome.runtime.openOptionsPage();
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === MENU_ID && tab?.id != null) {
    sendToTab(tab.id, { type: 'askhere:open', text: info.selectionText || '' });
  }
});

chrome.commands.onCommand.addListener((command, tab) => {
  if (command === 'ask-selection' && tab?.id != null) sendToTab(tab.id, { type: 'askhere:open' });
});

chrome.action.onClicked.addListener(() => chrome.runtime.openOptionsPage());

function sendToTab(tabId, message) {
  chrome.tabs.sendMessage(tabId, message).catch(() => {
    /* no content script on this page (chrome://, Web Store, …) */
  });
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.type === 'askhere:ask') {
    ask(msg, sender).then(sendResponse, (err) => sendResponse({ ok: false, error: String(err?.message || err) }));
    return true; // async response
  }
  if (msg?.type === 'askhere:take-pending') {
    takePending(sender.tab?.id).then(sendResponse);
    return true;
  }
  if (msg?.type === 'askhere:put-pending' && sender.tab?.id != null) {
    setPending(sender.tab.id, msg.job).then(() => sendResponse({ ok: true }));
    return true;
  }
  if (msg?.type === 'askhere:open-options') {
    chrome.runtime.openOptionsPage();
  }
});

// ---------- asking ----------

async function ask(msg, sender) {
  const settings = await getSettings();
  const target = msg.target || resolveTarget(settings, msg.hostname);
  const site = AI_SITES[target] || AI_SITES.claude;
  const prompt = buildPrompt(msg, settings);
  const bounds = placeWindow(msg.anchor, msg.screen, WINDOW_SIZES[settings.windowSize] || WINDOW_SIZES.medium);

  const job = { prompt, target, autoSend: settings.autoSend, createdAt: Date.now() };
  const tabId = await openAIWindow(site.url, bounds, settings.reuseWindow);
  await setPending(tabId, job);
  return { ok: true, target };
}

// Chrome rejects bounds it thinks are off-screen (odd multi-monitor setups,
// zoomed pages). Fall back to just the size, then to Chrome's defaults.
async function withBounds(fn, bounds) {
  const attempts = [bounds, { width: bounds.width, height: bounds.height }, {}];
  let lastErr;
  for (const b of attempts) {
    try {
      return await fn(b);
    } catch (err) {
      lastErr = err;
      if (!/bounds/i.test(String(err?.message))) throw err;
    }
  }
  throw lastErr;
}

async function openAIWindow(url, bounds, reuse) {
  if (reuse) {
    const existing = await getReusableWindow();
    if (existing) {
      await chrome.windows.update(existing.windowId, { state: 'normal' });
      await withBounds((b) => chrome.windows.update(existing.windowId, { ...b, focused: true }), bounds);
      await chrome.tabs.update(existing.tabId, { url, active: true });
      return existing.tabId;
    }
  }
  const win = await withBounds((b) => chrome.windows.create({ url, type: 'popup', focused: true, ...b }), bounds);
  const tabId = win.tabs[0].id;
  await chrome.storage.session.set({ askWindow: { windowId: win.id, tabId } });
  return tabId;
}

async function getReusableWindow() {
  const { askWindow } = await chrome.storage.session.get('askWindow');
  if (!askWindow) return null;
  try {
    const tab = await chrome.tabs.get(askWindow.tabId);
    if (tab.windowId === askWindow.windowId) return askWindow;
  } catch {
    /* closed */
  }
  await chrome.storage.session.remove('askWindow');
  return null;
}

chrome.windows.onRemoved.addListener(async (windowId) => {
  const { askWindow } = await chrome.storage.session.get('askWindow');
  if (askWindow?.windowId === windowId) await chrome.storage.session.remove('askWindow');
});

// ---------- pending question per AI tab ----------
// Stored in session storage so it survives the service worker going to sleep
// while the AI site loads (or while the user logs in).

async function setPending(tabId, job) {
  await chrome.storage.session.set({ [`pending:${tabId}`]: job });
}

async function takePending(tabId) {
  if (tabId == null) return null;
  const key = `pending:${tabId}`;
  const { [key]: job } = await chrome.storage.session.get(key);
  if (!job) return null;
  await chrome.storage.session.remove(key);
  if (Date.now() - job.createdAt > PENDING_TTL_MS) return null;
  return job;
}

chrome.tabs.onRemoved.addListener((tabId) => chrome.storage.session.remove(`pending:${tabId}`));
