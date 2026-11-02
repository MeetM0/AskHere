// AskHere service worker.
// Opens the user's own Claude / ChatGPT (claude.ai, chatgpt.com) in a small
// popup window positioned right next to the highlighted text, and hands the
// question to inject.js running inside that window, which types and sends it.
// No API keys: it's just the website, with whatever account you're logged in to.

import { getSettings, resolveTarget, AI_SITES, WINDOW_SIZES } from './lib/settings.js';
import { buildPrompt } from './lib/prompt.js';
import { placeWindow } from './lib/placement.js';
import { openAIWindow, isAskTab, markAskTab, openFull } from './lib/windows.js';
import './lib/mode.js'; // classic script: sets globalThis.AskHereMode

const { chooseOpenIn } = globalThis.AskHereMode;

const MENU_ID = 'askhere-ask';
const PENDING_TTL_MS = 10 * 60 * 1000;

// Claude/ChatGPT refuse to be shown inside other pages. Allow it only for
// frames in AskHere's side panel: side-panel requests have no tab (tabId -1),
// so normal browsing is unaffected. Session rules are cleared when Chrome
// restarts, so this runs every time the service worker starts.
const FRAME_RULE_ID = 1;
async function allowSidePanelFrames() {
  try {
    await chrome.declarativeNetRequest.updateSessionRules({
      removeRuleIds: [FRAME_RULE_ID],
      addRules: [
        {
          id: FRAME_RULE_ID,
          priority: 1,
          action: {
            type: 'modifyHeaders',
            responseHeaders: [
              { header: 'x-frame-options', operation: 'remove' },
              { header: 'content-security-policy', operation: 'remove' },
            ],
          },
          condition: {
            requestDomains: ['claude.ai', 'chatgpt.com', 'chat.openai.com'],
            resourceTypes: ['sub_frame'],
            tabIds: [chrome.tabs.TAB_ID_NONE],
          },
        },
      ],
    });
  } catch (err) {
    console.warn('AskHere: could not set side panel frame rule', err);
  }
}
allowSidePanelFrames();

// The toolbar icon opens settings, not the side panel.
chrome.sidePanel?.setPanelBehavior?.({ openPanelOnActionClick: false }).catch(() => {});

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
    // sidePanel.open() only works while the click that asked is still "fresh",
    // so it must be called right now, before any await.
    let panelOpening = null;
    if (msg.openIn === 'sidepanel' && sender.tab?.windowId != null && chrome.sidePanel?.open) {
      panelOpening = chrome.sidePanel.open({ windowId: sender.tab.windowId }).then(
        () => true,
        (err) => {
          console.warn('AskHere: side panel did not open, using a tab instead.', err);
          return false;
        }
      );
    }
    ask(msg, sender, panelOpening).then(sendResponse, (err) =>
      sendResponse({ ok: false, error: String(err?.message || err) })
    );
    return true; // async response
  }
  if (msg?.type === 'askhere:where') {
    whereToOpen(msg, sender).then(sendResponse);
    return true;
  }
  if (msg?.type === 'askhere:mirror' && sender.tab) {
    relayMirror(sender.tab.id, msg);
  }
  if (msg?.type === 'askhere:followup' && sender.tab) {
    followup(sender.tab.id, msg.text).then(sendResponse);
    return true;
  }
  if (msg?.type === 'askhere:show-ai' && sender.tab) {
    showMirrorTab(sender.tab.id);
  }
  if (msg?.type === 'askhere:pip-closed' && sender.tab) {
    closeMirrorTab(sender.tab.id);
  }
  if (msg?.type === 'askhere:take-pending') {
    takePending(sender.tab?.id).then(sendResponse);
    return true;
  }
  if (msg?.type === 'askhere:put-pending' && sender.tab?.id != null) {
    setPending(sender.tab.id, msg.job).then(() => sendResponse({ ok: true }));
    return true;
  }
  if (msg?.type === 'askhere:window-info') {
    windowInfo(sender.tab?.id).then(sendResponse);
    return true;
  }
  if (msg?.type === 'askhere:close-window' && sender.tab) {
    closeAskTab(sender.tab);
  }
  if (msg?.type === 'askhere:open-full' && sender.tab) {
    openFull(sender.tab, msg.url);
  }
  if (msg?.type === 'askhere:open-options') {
    chrome.runtime.openOptionsPage();
  }
});

// The AskHere bar's ✕: close the small window, or just the tab if AskHere
// opened a tab inside your normal (e.g. fullscreen) window.
async function closeAskTab(tab) {
  if (!(await isAskTab(tab.id))) return;
  const win = await chrome.windows.get(tab.windowId, { populate: true }).catch(() => null);
  if (win?.type === 'popup') await chrome.windows.remove(win.id);
  else await chrome.tabs.remove(tab.id);
}

async function windowInfo(tabId) {
  if (!(await isAskTab(tabId))) return { isAskWindow: false };
  const settings = await getSettings();
  return { isAskWindow: true, compact: settings.compactWindow };
}

// ---------- where to show the AI ----------
// Asked when the Ask box opens. Uses what Chrome itself knows (is this window
// fullscreen? is this a Mac?) rather than guessing from screen sizes, which
// fails e.g. on MacBooks with a notch.
async function whereToOpen(msg, sender) {
  const settings = await getSettings();
  let isMac = false;
  let isFullscreen = !!msg.pageFullscreen;
  try {
    // debugPlatform lets the automated tests pretend to be a Mac.
    const { debugPlatform } = await chrome.storage.local.get('debugPlatform');
    isMac = (debugPlatform || (await chrome.runtime.getPlatformInfo()).os) === 'mac';
  } catch {
    /* ignore */
  }
  try {
    if ((await chrome.windows.get(sender.tab.windowId)).state === 'fullscreen') isFullscreen = true;
  } catch {
    /* ignore */
  }
  return { openIn: chooseOpenIn(settings.openIn, { isMac, isFullscreen }), isMac, isFullscreen };
}

// ---------- floating window (picture-in-picture) mode ----------
// Your Claude/ChatGPT runs in a background tab of the same window (so you stay
// logged in and never leave fullscreen). inject.js there reads the answer and
// sends it here; we pass it on to the page that shows the floating window.

async function getSession(key) {
  return (await chrome.storage.session.get(key))[key];
}

async function mirrorTabFor(sourceTabId) {
  const tabId = await getSession(`mirrorFor:${sourceTabId}`);
  if (tabId == null) return null;
  try {
    await chrome.tabs.get(tabId);
    return tabId;
  } catch {
    await chrome.storage.session.remove(`mirrorFor:${sourceTabId}`);
    return null;
  }
}

async function openMirrorTab(sourceTab, url) {
  const existing = await mirrorTabFor(sourceTab.id);
  if (existing != null) {
    await chrome.tabs.update(existing, { url });
    await markAskTab(existing);
    return existing;
  }
  const tab = await chrome.tabs.create({
    windowId: sourceTab.windowId,
    index: sourceTab.index + 1,
    url,
    active: false, // stays in the background: no Space switch, no tab switch
  });
  await chrome.storage.session.set({ [`mirrorFor:${sourceTab.id}`]: tab.id, [`mirrorSource:${tab.id}`]: sourceTab.id });
  await markAskTab(tab.id);
  return tab.id;
}

async function relayMirror(aiTabId, msg) {
  const source = await getSession(`mirrorSource:${aiTabId}`);
  if (source == null) return;
  const { type, ...payload } = msg;
  chrome.tabs.sendMessage(source, { type: 'askhere:mirror', ...payload }).catch(() => {});
}

async function followup(sourceTabId, text) {
  const aiTab = await mirrorTabFor(sourceTabId);
  if (aiTab == null) return { ok: false };
  try {
    await chrome.tabs.sendMessage(aiTab, { type: 'askhere:followup', text: String(text || '') });
    return { ok: true };
  } catch {
    return { ok: false };
  }
}

async function showMirrorTab(sourceTabId) {
  const aiTab = await mirrorTabFor(sourceTabId);
  if (aiTab != null) await chrome.tabs.update(aiTab, { active: true });
}

async function closeMirrorTab(sourceTabId) {
  const aiTab = await mirrorTabFor(sourceTabId);
  await chrome.storage.session.remove(`mirrorFor:${sourceTabId}`);
  if (aiTab != null) {
    await chrome.storage.session.remove(`mirrorSource:${aiTab}`);
    await chrome.tabs.remove(aiTab).catch(() => {});
  }
}

chrome.tabs.onRemoved.addListener(async (tabId) => {
  // The chat tab was closed: tell the floating window.
  const source = await getSession(`mirrorSource:${tabId}`);
  if (source != null) {
    await chrome.storage.session.remove([`mirrorSource:${tabId}`, `mirrorFor:${source}`]);
    chrome.tabs.sendMessage(source, { type: 'askhere:mirror', status: 'closed' }).catch(() => {});
  }
  // The page with the floating window was closed: close its chat tab too.
  const aiTab = await getSession(`mirrorFor:${tabId}`);
  if (aiTab != null) {
    await chrome.storage.session.remove([`mirrorFor:${tabId}`, `mirrorSource:${aiTab}`]);
    chrome.tabs.remove(aiTab).catch(() => {});
  }
});

// ---------- asking ----------

// Questions are handled one at a time, so two quick clicks can't open two
// windows or mix up which question goes where.
let queue = Promise.resolve();
function ask(msg, sender, panelOpening) {
  const run = queue.then(() => askNow(msg, sender, panelOpening));
  queue = run.catch(() => {});
  return run;
}

async function askNow(msg, sender, panelOpening) {
  const settings = await getSettings();
  const target = msg.target || resolveTarget(settings, msg.hostname);
  const site = AI_SITES[target] || AI_SITES.claude;
  const prompt = buildPrompt(msg, settings);
  const bounds = placeWindow(msg.anchor, msg.screen, WINDOW_SIZES[settings.windowSize] || WINDOW_SIZES.medium);

  const job = { prompt, target, autoSend: settings.autoSend, createdAt: Date.now() };

  if (msg.openIn === 'pip' && sender.tab) {
    const tabId = await openMirrorTab(sender.tab, site.url);
    await setPending(tabId, { ...job, autoSend: true, mirror: true });
    return { ok: true, target, where: 'pip' };
  }

  if (panelOpening) {
    if (await panelOpening) {
      await chrome.storage.session.set({ sidepanelJob: job });
      return { ok: true, target, where: 'sidepanel' };
    }
    // Side panel unavailable: open a tab right next to this one, in the same
    // (fullscreen) window, so you stay where you are.
    const tab = await chrome.tabs.create({
      url: site.url,
      windowId: sender.tab.windowId,
      index: sender.tab.index + 1,
      openerTabId: sender.tab.id,
      active: true,
    });
    await markAskTab(tab.id);
    await setPending(tab.id, job);
    return { ok: true, target, where: 'tab' };
  }
  await openAIWindow(site.url, bounds, settings.reuseWindow, { onTab: (tabId) => setPending(tabId, job) });
  return { ok: true, target };
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

chrome.tabs.onRemoved.addListener((tabId) =>
  chrome.storage.session.remove([`pending:${tabId}`, `askTab:${tabId}`])
);
