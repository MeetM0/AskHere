// Opening, reusing and sizing the small AskHere window.
// Uses globalThis.chrome so tests can pass in a fake browser.

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Chrome rejects bounds it thinks are off-screen (odd multi-monitor setups,
// zoomed pages). Fall back to just the size, then to Chrome's defaults.
export async function withBounds(fn, bounds) {
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

/**
 * Make sure the window is a small, normal window at `bounds`.
 *
 * If you ask from a fullscreen or maximized Chrome window, Chrome (and macOS /
 * Windows) can make the new window fullscreen/maximized too, sometimes a moment
 * after it was created. So we check a few times and put it back to normal.
 */
export async function settleWindow(windowId, bounds, { checks = [0, 150, 500] } = {}) {
  for (const delay of checks) {
    if (delay) await sleep(delay);
    let win;
    try {
      win = await chrome.windows.get(windowId);
    } catch {
      return; // closed
    }
    const wrongState = win.state !== 'normal';
    const wrongSize =
      bounds.width && bounds.height &&
      (Math.abs(win.width - bounds.width) > 40 || Math.abs(win.height - bounds.height) > 40);
    if (!wrongState && !wrongSize) continue;
    // State must be changed on its own: Chrome refuses 'fullscreen'/'maximized'
    // combined with bounds, and some platforms ignore bounds until it's normal.
    if (wrongState) await chrome.windows.update(windowId, { state: 'normal' });
    await withBounds((b) => chrome.windows.update(windowId, { ...b, focused: true }), bounds);
  }
}

/**
 * @param {(tabId:number)=>Promise<void>} [onTab] runs as soon as the tab exists,
 *   before the size/state checks (used to hand over the question).
 */
export async function openAIWindow(url, bounds, reuse, { onTab, ...opts } = {}) {
  if (reuse) {
    const existing = await getReusableWindow();
    if (existing) {
      await chrome.windows.update(existing.windowId, { state: 'normal' });
      await withBounds((b) => chrome.windows.update(existing.windowId, { ...b, focused: true }), bounds);
      await chrome.tabs.update(existing.tabId, { url, active: true });
      await markAskTab(existing.tabId);
      await onTab?.(existing.tabId);
      await settleWindow(existing.windowId, bounds, opts);
      return existing.tabId;
    }
  }
  // Always say state: 'normal'. Without it Chrome copies the state of the
  // window you're in, so asking from fullscreen gave a fullscreen window.
  const win = await withBounds(
    (b) => chrome.windows.create({ url, type: 'popup', state: 'normal', focused: true, ...b }),
    bounds
  );
  const tabId = win.tabs[0].id;
  await markAskTab(tabId);
  if (reuse) await chrome.storage.session.set({ askWindow: { windowId: win.id, tabId } });
  await onTab?.(tabId);
  await settleWindow(win.id, bounds, opts);
  return tabId;
}

// Tabs AskHere opened get the compact, AskHere-branded look (see inject.js).
export async function markAskTab(tabId) {
  await chrome.storage.session.set({ [`askTab:${tabId}`]: true });
}

export async function isAskTab(tabId) {
  if (tabId == null) return false;
  const key = `askTab:${tabId}`;
  const { [key]: yes } = await chrome.storage.session.get(key);
  return !!yes;
}

export async function getReusableWindow() {
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

// Move the side chat into a normal browser tab (full claude.ai / chatgpt.com).
export async function openFull(tab, url) {
  if (!(await isAskTab(tab.id))) return;
  const current = await chrome.windows.get(tab.windowId).catch(() => null);
  if (current && current.type !== 'popup') {
    // Already a normal tab (side-panel fallback): just stop treating it as AskHere's.
    await chrome.storage.session.remove(`askTab:${tab.id}`);
    await chrome.tabs.reload?.(tab.id);
    return;
  }
  const target = url || tab.url;
  const [normal] = await chrome.windows.getAll({ windowTypes: ['normal'] });
  if (normal) {
    await chrome.tabs.create({ url: target, windowId: normal.id, active: true });
    await chrome.windows.update(normal.id, { focused: true });
  } else {
    await chrome.windows.create({ url: target, type: 'normal', focused: true });
  }
  await chrome.windows.remove(tab.windowId);
}
