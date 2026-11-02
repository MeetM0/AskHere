// Window handling against a fake `chrome` that behaves like a real desktop:
// new windows copy the state of the window you're in (fullscreen/maximized),
// sometimes a moment *after* creation (macOS), and fullscreen/maximized can't
// be combined with explicit bounds.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { openAIWindow, settleWindow, getReusableWindow, openFull } from '../extension/lib/windows.js';

const SCREEN = { width: 1920, height: 1080 };
const BOUNDS = { left: 300, top: 250, width: 380, height: 520 };
const FAST = { checks: [0, 5, 20] };

function makeFakeChrome({ inherit = 'fullscreen', lateInherit = false, honorsState = true, rejectBounds = false } = {}) {
  let nextId = 100;
  const windows = new Map();
  const tabs = new Map();
  const session = new Map();
  const calls = [];

  const winObj = (w) => ({ ...w, tabs: [...tabs.values()].filter((t) => t.windowId === w.id) });

  function applyState(w, state) {
    w.state = state;
    if (state === 'fullscreen' || state === 'maximized') Object.assign(w, { left: 0, top: 0, ...SCREEN });
  }

  const api = {
    calls,
    windows: {
      async create(opts) {
        calls.push(['create', opts]);
        if (opts.state && opts.state !== 'normal' && (opts.width || opts.left != null)) {
          throw new Error(`Invalid value for state: '${opts.state}' cannot be combined with bounds`);
        }
        if (rejectBounds && opts.left != null) throw new Error('Invalid value for bounds. Bounds must be at least 50% within visible screen space.');
        const w = { id: nextId++, type: opts.type || 'normal', state: 'normal', left: opts.left ?? 50, top: opts.top ?? 50, width: opts.width ?? 1200, height: opts.height ?? 800 };
        windows.set(w.id, w);
        const t = { id: nextId++, windowId: w.id, url: opts.url };
        tabs.set(t.id, t);
        // Copy the current window's state unless an explicit state was requested
        // (or always, for platforms that ignore the request).
        const copy = inherit && (!opts.state || !honorsState);
        if (copy && !lateInherit) applyState(w, inherit);
        if (copy && lateInherit) setTimeout(() => applyState(w, inherit), 2);
        return winObj(w);
      },
      async get(id) {
        const w = windows.get(id);
        if (!w) throw new Error('No window with id: ' + id);
        return winObj(w);
      },
      async getAll({ windowTypes } = {}) {
        return [...windows.values()].filter((w) => !windowTypes || windowTypes.includes(w.type)).map(winObj);
      },
      async update(id, opts) {
        calls.push(['update', id, opts]);
        const w = windows.get(id);
        if (!w) throw new Error('No window with id: ' + id);
        if (opts.state && opts.state !== 'normal' && (opts.width || opts.left != null)) {
          throw new Error(`Invalid value for state: '${opts.state}' cannot be combined with bounds`);
        }
        if (opts.state) applyState(w, opts.state);
        if (w.state === 'normal') {
          for (const k of ['left', 'top', 'width', 'height']) if (opts[k] != null) w[k] = opts[k];
        }
        return winObj(w);
      },
      async remove(id) {
        windows.delete(id);
        for (const [tid, t] of tabs) if (t.windowId === id) tabs.delete(tid);
      },
    },
    tabs: {
      async get(id) {
        const t = tabs.get(id);
        if (!t) throw new Error('No tab with id: ' + id);
        return { ...t };
      },
      async update(id, opts) {
        Object.assign(tabs.get(id), opts);
      },
      async create(opts) {
        const t = { id: nextId++, windowId: opts.windowId, url: opts.url };
        tabs.set(t.id, t);
        return t;
      },
    },
    storage: {
      session: {
        async get(key) {
          if (key == null) return Object.fromEntries(session);
          const keys = Array.isArray(key) ? key : [key];
          return Object.fromEntries(keys.filter((k) => session.has(k)).map((k) => [k, session.get(k)]));
        },
        async set(obj) {
          for (const [k, v] of Object.entries(obj)) session.set(k, v);
        },
        async remove(key) {
          for (const k of [].concat(key)) session.delete(k);
        },
      },
    },
    _windows: windows,
  };
  // The user's main window, in fullscreen.
  windows.set(1, { id: 1, type: 'normal', state: inherit || 'normal', left: 0, top: 0, ...SCREEN });
  return api;
}

async function popupOf(fake, tabId) {
  const t = await fake.tabs.get(tabId);
  return fake.windows.get(t.windowId);
}

beforeEach(() => {
  delete globalThis.chrome;
});

test('asking from a fullscreen window opens a small normal window', async () => {
  globalThis.chrome = makeFakeChrome({ inherit: 'fullscreen' });
  const tabId = await openAIWindow('https://claude.ai/new', BOUNDS, true, FAST);
  const w = await popupOf(chrome, tabId);
  assert.equal(w.state, 'normal');
  assert.equal(w.type, 'popup');
  assert.deepEqual([w.left, w.top, w.width, w.height], [300, 250, 380, 520]);
  // and it explicitly asked for a normal window
  assert.equal(chrome.calls[0][1].state, 'normal');
});

test('asking from a maximized window opens a small normal window', async () => {
  globalThis.chrome = makeFakeChrome({ inherit: 'maximized' });
  const w = await popupOf(chrome, await openAIWindow('https://claude.ai/new', BOUNDS, true, FAST));
  assert.equal(w.state, 'normal');
  assert.equal(w.width, 380);
});

test('platform that ignores the requested state (fullscreen applied anyway) gets fixed', async () => {
  globalThis.chrome = makeFakeChrome({ inherit: 'fullscreen', honorsState: false });
  const w = await popupOf(chrome, await openAIWindow('https://claude.ai/new', BOUNDS, true, FAST));
  assert.equal(w.state, 'normal');
  assert.deepEqual([w.width, w.height], [380, 520]);
});

test('fullscreen applied by the OS a moment after creation (macOS) gets fixed', async () => {
  globalThis.chrome = makeFakeChrome({ inherit: 'fullscreen', honorsState: false, lateInherit: true });
  const tabId = await openAIWindow('https://claude.ai/new', BOUNDS, true, FAST);
  await new Promise((r) => setTimeout(r, 40)); // well after the OS switched it
  const w = await popupOf(chrome, tabId);
  assert.equal(w.state, 'normal');
  assert.deepEqual([w.width, w.height], [380, 520]);
});

test('reused window that the user made fullscreen comes back small and moves to the new text', async () => {
  globalThis.chrome = makeFakeChrome({ inherit: null });
  const tabId = await openAIWindow('https://claude.ai/new', BOUNDS, true, FAST);
  const first = await popupOf(chrome, tabId);
  await chrome.windows.update(first.id, { state: 'fullscreen' });

  const next = { left: 900, top: 100, width: 380, height: 520 };
  const tabId2 = await openAIWindow('https://claude.ai/new', next, true, FAST);
  assert.equal(tabId2, tabId, 'same tab reused');
  const w = await popupOf(chrome, tabId2);
  assert.equal(w.state, 'normal');
  assert.deepEqual([w.left, w.top, w.width, w.height], [900, 100, 380, 520]);
});

test('reused window that was minimized is restored', async () => {
  globalThis.chrome = makeFakeChrome({ inherit: null });
  const tabId = await openAIWindow('https://claude.ai/new', BOUNDS, true, FAST);
  await chrome.windows.update((await popupOf(chrome, tabId)).id, { state: 'minimized' });
  await openAIWindow('https://claude.ai/new', BOUNDS, true, FAST);
  assert.equal((await popupOf(chrome, tabId)).state, 'normal');
});

test('if the user closed the window, a new one is opened', async () => {
  globalThis.chrome = makeFakeChrome({ inherit: null });
  const tabId = await openAIWindow('https://claude.ai/new', BOUNDS, true, FAST);
  await chrome.windows.remove((await popupOf(chrome, tabId)).id);
  assert.equal(await getReusableWindow(), null);
  const tabId2 = await openAIWindow('https://claude.ai/new', BOUNDS, true, FAST);
  assert.notEqual(tabId2, tabId);
  assert.equal((await popupOf(chrome, tabId2)).state, 'normal');
});

test('reuse off opens a new window each time', async () => {
  globalThis.chrome = makeFakeChrome({ inherit: null });
  const a = await openAIWindow('https://claude.ai/new', BOUNDS, false, FAST);
  const b = await openAIWindow('https://claude.ai/new', BOUNDS, false, FAST);
  assert.notEqual((await popupOf(chrome, a)).id, (await popupOf(chrome, b)).id);
});

test('bounds rejected by Chrome still opens a small window', async () => {
  globalThis.chrome = makeFakeChrome({ inherit: 'fullscreen', rejectBounds: true });
  const w = await popupOf(chrome, await openAIWindow('https://claude.ai/new', BOUNDS, true, FAST));
  assert.equal(w.state, 'normal');
  assert.deepEqual([w.width, w.height], [380, 520]);
});

test('the question is handed over before the slower size checks', async () => {
  globalThis.chrome = makeFakeChrome({ inherit: 'fullscreen' });
  const order = [];
  const realGet = chrome.windows.get;
  chrome.windows.get = async (id) => {
    order.push('check');
    return realGet(id);
  };
  await openAIWindow('https://claude.ai/new', BOUNDS, true, { ...FAST, onTab: async () => order.push('onTab') });
  assert.equal(order[0], 'onTab');
});

test('settleWindow leaves a correct window alone', async () => {
  globalThis.chrome = makeFakeChrome({ inherit: null });
  const tabId = await openAIWindow('https://claude.ai/new', BOUNDS, true, FAST);
  const id = (await popupOf(chrome, tabId)).id;
  const before = chrome.calls.length;
  await settleWindow(id, BOUNDS, FAST);
  assert.equal(chrome.calls.length, before);
});

test('settleWindow copes with the window being closed meanwhile', async () => {
  globalThis.chrome = makeFakeChrome({ inherit: null });
  await settleWindow(424242, BOUNDS, FAST); // no throw
});

test('open in full tab moves the chat to the main window and closes the popup', async () => {
  globalThis.chrome = makeFakeChrome({ inherit: null });
  const tabId = await openAIWindow('https://claude.ai/new', BOUNDS, true, FAST);
  const popup = await popupOf(chrome, tabId);
  await openFull({ id: tabId, windowId: popup.id, url: 'https://claude.ai/chat/abc' }, 'https://claude.ai/chat/abc');
  await assert.rejects(chrome.windows.get(popup.id));
  const main = await chrome.windows.get(1);
  assert.ok(main.tabs.some((t) => t.url === 'https://claude.ai/chat/abc'));
});

test('open in full tab works when there is no normal window left', async () => {
  globalThis.chrome = makeFakeChrome({ inherit: null });
  const tabId = await openAIWindow('https://claude.ai/new', BOUNDS, true, FAST);
  const popup = await popupOf(chrome, tabId);
  await chrome.windows.remove(1);
  await openFull({ id: tabId, windowId: popup.id }, 'https://claude.ai/chat/xyz');
  const all = await chrome.windows.getAll();
  assert.equal(all.length, 1);
  assert.equal(all[0].type, 'normal');
  assert.equal(all[0].tabs[0].url, 'https://claude.ai/chat/xyz');
});

test('open in full tab refuses for windows AskHere did not open', async () => {
  globalThis.chrome = makeFakeChrome({ inherit: null });
  await openFull({ id: 9999, windowId: 1 }, 'https://evil.example');
  assert.ok(await chrome.windows.get(1));
});
