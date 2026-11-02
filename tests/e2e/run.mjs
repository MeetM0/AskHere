// End-to-end tests: load the unpacked extension in real Chromium and click
// through it. claude.ai / chatgpt.com are replaced by local fakes
// (fake-ai.html) that mimic their chat boxes, so no login is needed.
//
//   npm run test:e2e                 run everything
//   npm run test:e2e -- chatgpt      run scenarios whose name contains "chatgpt"
//
// Needs Playwright with its Chromium (`npx playwright install chromium`).

import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { readFile, mkdtemp, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

// Use require() so a globally installed Playwright is found too.
const { chromium } = createRequire(import.meta.url)('playwright');

const here = path.dirname(fileURLToPath(import.meta.url));
const extPath = path.resolve(here, '../../extension');
const shots = process.env.SHOTS_DIR || path.join(here, 'screenshots');
await mkdir(shots, { recursive: true });
const only = process.argv[2] || '';

// ---------- local pages ----------
const pages = {
  '/': await readFile(path.join(here, 'page.html')),
  '/inputs': await readFile(path.join(here, 'inputs.html')),
  '/hostile': await readFile(path.join(here, 'hostile.html')),
};
const fakeAI = await readFile(path.join(here, 'fake-ai.html'), 'utf8');
const server = createServer((req, res) => {
  res.setHeader('content-type', 'text/html; charset=utf-8');
  res.end(pages[req.url.split('?')[0]] || 'not found');
}).listen(0);
const base = `http://localhost:${server.address().port}`;

// ---------- browser ----------
const userDataDir = await mkdtemp(path.join(tmpdir(), 'askhere-e2e-'));
const context = await chromium.launchPersistentContext(userDataDir, {
  headless: true,
  channel: 'chromium', // the full Chromium build; extensions need it in headless mode
  args: [`--disable-extensions-except=${extPath}`, `--load-extension=${extPath}`],
  viewport: { width: 1100, height: 720 },
});

let fakeMode = 'normal';
const aiLoads = [];
await context.route(/^https:\/\/(claude\.ai|chatgpt\.com)\//, (route) => {
  const url = route.request().url();
  aiLoads.push(url);
  const site = url.includes('claude.ai') ? 'claude' : 'chatgpt';
  // A "reading" page on chatgpt.com, for the auto-target test.
  if (url.includes('/reading')) return route.fulfill({ contentType: 'text/html', body: pages['/'] });
  const body = fakeAI
    .replaceAll('__SITE__', site)
    .replaceAll('__MODE__', fakeMode)
    .replaceAll('__TITLE__', site === 'claude' ? 'Claude' : 'ChatGPT');
  return route.fulfill({ contentType: 'text/html', body });
});

let [sw] = context.serviceWorkers();
if (!sw) sw = await context.waitForEvent('serviceworker');
for (const p of context.pages()) if (p.url().startsWith('chrome-extension://')) await p.close();
sw.on('console', (m) => process.env.SW_LOG && console.log('[sw]', m.text()));
const { DEFAULTS } = await import('../../extension/lib/settings.js');

// ---------- helpers ----------
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function reset(settings = {}) {
  fakeMode = 'normal';
  await sw.evaluate(async (s) => {
    for (const w of await chrome.windows.getAll()) if (w.type === 'popup') await chrome.windows.remove(w.id);
    const [main] = await chrome.windows.getAll({ windowTypes: ['normal'] });
    if (main && main.state !== 'normal') await chrome.windows.update(main.id, { state: 'normal' });
    await chrome.storage.session.clear();
    await chrome.storage.local.clear();
    await chrome.storage.local.set(s);
  }, { ...DEFAULTS, ...settings });
  for (const p of context.pages()) if (p !== keepAlive) await p.close();
}

async function open(url = '/') {
  const page = await context.newPage();
  await page.goto(url.startsWith('http') ? url : base + url);
  await sleep(250); // let content script + settings load
  return page;
}

async function dragSelect(page, locator, opts = {}) {
  const b = await page.locator(locator).boundingBox();
  if (opts.alt) await page.keyboard.down('Alt');
  await page.mouse.move(b.x + 1, b.y + b.height / 2);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width - 1, b.y + b.height / 2, { steps: 6 });
  await page.mouse.up();
  if (opts.alt) await page.keyboard.up('Alt');
}

const trigger = (page) => page.locator('askhere-root .ah-trigger');
const box = (page) => page.locator('askhere-root .ah-box');

async function openBox(page, selector = '#target b') {
  await dragSelect(page, selector);
  await trigger(page).waitFor({ state: 'visible', timeout: 3000 });
  await trigger(page).click();
  await box(page).waitFor({ state: 'visible' });
}

// Playwright can only intercept a window's requests once it is attached to it,
// so tests that check what gets *sent* pre-open AskHere's reusable window
// (blank) and let the extension navigate it, as it does for every question
// after the first.
async function prepAIWindow() {
  const known = new Set(context.pages());
  await sw.evaluate(async () => {
    const w = await chrome.windows.create({ url: 'about:blank', type: 'popup' });
    await chrome.storage.session.set({ askWindow: { windowId: w.id, tabId: w.tabs[0].id } });
  });
  for (let i = 0; i < 50; i++) {
    const p = context.pages().find((pg) => !known.has(pg));
    if (p) {
      await p.waitForLoadState();
      return p;
    }
    await sleep(100);
  }
  throw new Error('AI window did not open');
}

async function sentText(popup, timeout = 15000) {
  await popup.waitForFunction(() => document.body?.dataset.sent, null, { timeout });
  return popup.evaluate(() => document.body.dataset.sent);
}

async function aiWindow() {
  return sw.evaluate(async () => {
    const { askWindow } = await chrome.storage.session.get('askWindow');
    if (askWindow) return chrome.windows.get(askWindow.windowId).catch(() => null);
    const popups = (await chrome.windows.getAll()).filter((w) => w.type === 'popup');
    return popups[0] || null;
  });
}

async function waitForAIWindow() {
  for (let i = 0; i < 50; i++) {
    const w = await aiWindow();
    if (w) return w;
    await sleep(100);
  }
  throw new Error('AI window did not open');
}

async function popupCount() {
  return sw.evaluate(async () => (await chrome.windows.getAll()).filter((w) => w.type === 'popup').length);
}

// ---------- scenarios ----------
const scenarios = [];
const scenario = (name, fn) => scenarios.push({ name, fn });

scenario('basic: select, Explain, question typed and sent in a compact AskHere window', async () => {
  await reset();
  const page = await open('/');
  await dragSelect(page, '#target b');
  await trigger(page).waitFor({ state: 'visible', timeout: 3000 });
  await page.screenshot({ path: path.join(shots, '1-trigger.png'), animations: 'disabled' });
  await trigger(page).click();
  await box(page).waitFor({ state: 'visible' });
  assert.match(await box(page).locator('.ah-quote').innerText(), /mass and energy are equivalent/);
  assert.equal(await box(page).locator('.ah-ai-opt.ah-on').innerText(), 'Claude');
  await page.screenshot({ path: path.join(shots, '2-ask-box.png'), animations: 'disabled' });

  const popup = await prepAIWindow();
  await box(page).locator('.ah-chip', { hasText: 'Explain' }).click();
  await box(page).waitFor({ state: 'detached' });
  const sent = await sentText(popup);
  assert.match(sent, /^About this text from "AskHere test page"/);
  assert.match(sent, /> mass and energy are equivalent/);
  assert.match(sent, /Explain this\.$/);
  assert.equal(aiLoads.at(-1), 'https://claude.ai/new');

  assert.equal(await popup.locator('#side').isVisible(), false, 'sidebar hidden');
  assert.equal(await popup.locator('#top').isVisible(), false, 'header hidden');
  assert.equal(await popup.title(), 'AskHere · Claude');
  assert.equal(await popup.locator('askhere-bar').count(), 1);
  const icons = await popup.evaluate(() => [...document.querySelectorAll('link[rel~="icon"]')].map((l) => l.href.slice(0, 22)));
  assert.deepEqual(icons, ['data:image/png;base64,']);
  assert.equal((await aiWindow()).type, 'popup');
  await popup.setViewportSize({ width: 380, height: 520 });
  await popup.screenshot({ path: path.join(shots, '3-ai-window.png') });
});

scenario('ask box follows the text when an inner container scrolls', async () => {
  await reset();
  const page = await open('/');
  await openBox(page);
  await sleep(300); // let the box's opening animation finish
  const textY = () => page.locator('#target b').evaluate((el) => el.getBoundingClientRect().top);
  const before = await box(page).boundingBox();
  const textBefore = await textY();
  await page.locator('#scroller').evaluate((el) => el.scrollBy({ top: 40, behavior: 'instant' }));
  await sleep(150);
  const after = await box(page).boundingBox();
  const moved = textBefore - (await textY());
  assert.ok(moved > 20, `text should have moved, moved ${moved}`);
  assert.ok(Math.abs(before.y - after.y - moved) < 2, `box moved ${before.y - after.y}, text moved ${moved}`);
});

scenario('fullscreen Chrome: AI window opens small and normal, not fullscreen', async () => {
  await reset();
  const page = await open('/');
  await sw.evaluate(async () => {
    const [main] = await chrome.windows.getAll({ windowTypes: ['normal'] });
    await chrome.windows.update(main.id, { state: 'fullscreen' });
  });
  await openBox(page);
  await box(page).locator('.ah-chip', { hasText: 'Explain' }).click();
  await sleep(1000); // includes the delayed state checks
  const w = await waitForAIWindow();
  assert.equal(w.type, 'popup');
  assert.equal(w.state, 'normal');
  assert.ok(w.width <= 400 && w.height <= 560, `size ${w.width}x${w.height}`);
});

scenario('maximized Chrome: AI window opens small and normal', async () => {
  await reset();
  const page = await open('/');
  await sw.evaluate(async () => {
    const [main] = await chrome.windows.getAll({ windowTypes: ['normal'] });
    await chrome.windows.update(main.id, { state: 'maximized' });
  });
  await openBox(page);
  await box(page).locator('.ah-chip', { hasText: 'Explain' }).click();
  await sleep(1000);
  const w = await waitForAIWindow();
  assert.equal(w.state, 'normal');
  assert.ok(w.width <= 400, `width ${w.width}`);
});

scenario('AI window the user made fullscreen comes back small on the next question', async () => {
  await reset();
  const page = await open('/');
  const popup = await prepAIWindow();
  await sw.evaluate(async () => {
    const { askWindow } = await chrome.storage.session.get('askWindow');
    await chrome.windows.update(askWindow.windowId, { state: 'fullscreen' });
  });
  await openBox(page);
  await box(page).locator('.ah-chip', { hasText: 'Summarize' }).click();
  assert.match(await sentText(popup), /Summarize this/);
  await sleep(800);
  const w = await aiWindow();
  assert.equal(w.state, 'normal');
  assert.ok(w.width <= 400, `width ${w.width}`);
});

scenario('asking again reuses the one window', async () => {
  await reset();
  const page = await open('/');
  const popup = await prepAIWindow();
  await openBox(page);
  await box(page).locator('.ah-chip', { hasText: 'Explain' }).click();
  await sentText(popup);
  await page.bringToFront();
  await openBox(page, '#filler');
  await box(page).locator('.ah-input').fill('Who said it?');
  await box(page).locator('.ah-input').press('Enter');
  await popup.waitForFunction(() => /Who said it\?$/.test(document.body?.dataset.sent || ''), null, { timeout: 15000 });
  assert.equal(await popupCount(), 1);
});

scenario('user closed the AI window: next question opens a new one', async () => {
  await reset();
  const page = await open('/');
  await prepAIWindow();
  await sw.evaluate(async () => {
    const { askWindow } = await chrome.storage.session.get('askWindow');
    await chrome.windows.remove(askWindow.windowId);
  });
  await sleep(200);
  assert.equal(await popupCount(), 0);
  await openBox(page);
  await box(page).locator('.ah-chip', { hasText: 'Explain' }).click();
  const w = await waitForAIWindow();
  assert.equal(w.type, 'popup');
  assert.equal(await popupCount(), 1);
});

scenario('reuse off: each question gets its own window', async () => {
  await reset({ reuseWindow: false });
  const page = await open('/');
  await openBox(page);
  await box(page).locator('.ah-chip', { hasText: 'Explain' }).click();
  await waitForAIWindow();
  await page.bringToFront();
  await openBox(page, '#filler');
  await box(page).locator('.ah-chip', { hasText: 'Explain' }).click();
  for (let i = 0; i < 30 && (await popupCount()) < 2; i++) await sleep(100);
  assert.equal(await popupCount(), 2);
});

scenario('switch to ChatGPT in the box: chatgpt.com gets the question', async () => {
  await reset();
  const page = await open('/');
  const popup = await prepAIWindow();
  await openBox(page);
  await box(page).locator('.ah-ai-opt', { hasText: 'ChatGPT' }).click();
  await box(page).locator('.ah-input').fill('What is c?');
  await box(page).locator('.ah-input').press('Enter');
  assert.match(await sentText(popup), /What is c\?$/);
  assert.equal(aiLoads.at(-1), 'https://chatgpt.com/');
  assert.equal(await popup.title(), 'AskHere · ChatGPT');
  assert.equal(await popup.locator('#stage-slideover-sidebar').isVisible(), false);
  assert.equal(await popup.locator('#page-header').isVisible(), false);
});

scenario('auto target: reading on chatgpt.com defaults to ChatGPT', async () => {
  await reset();
  const page = await open('https://chatgpt.com/reading');
  await openBox(page);
  assert.equal(await box(page).locator('.ah-ai-opt.ah-on').innerText(), 'ChatGPT');
});

scenario('default AI setting = ChatGPT is used on other sites', async () => {
  await reset({ defaultAI: 'chatgpt' });
  const page = await open('/');
  await openBox(page);
  assert.equal(await box(page).locator('.ah-ai-opt.ah-on').innerText(), 'ChatGPT');
});

scenario('normal claude.ai tabs are left alone (no compact look, no AskHere bar)', async () => {
  await reset();
  const page = await open('https://claude.ai/new');
  await page.locator('#side').waitFor({ timeout: 5000 });
  await sleep(800);
  assert.equal(await page.locator('askhere-bar').count(), 0);
  assert.equal(await page.title(), 'Claude');
  assert.equal(await page.locator('#side').isVisible(), true);
  assert.equal(await page.evaluate(() => document.body.dataset.sent), undefined);
});

scenario('compact look off: full site shown, question still sent', async () => {
  await reset({ compactWindow: false });
  const page = await open('/');
  const popup = await prepAIWindow();
  await openBox(page);
  await box(page).locator('.ah-chip', { hasText: 'Explain' }).click();
  await sentText(popup);
  assert.equal(await popup.locator('#side').isVisible(), true);
  assert.equal(await popup.locator('askhere-bar').count(), 0);
});

scenario('auto-send off: question is typed but not sent', async () => {
  await reset({ autoSend: false });
  const page = await open('/');
  const popup = await prepAIWindow();
  await openBox(page);
  await box(page).locator('.ah-chip', { hasText: 'Explain' }).click();
  await popup.waitForFunction(() => /Explain this\./.test(document.querySelector('[contenteditable]')?.innerText || ''), null, { timeout: 15000 });
  await sleep(1500);
  assert.equal(await popup.evaluate(() => document.body.dataset.sent), undefined);
});

scenario('chat box re-rendered by the site right after typing: still sent', async () => {
  await reset();
  fakeMode = 'rerender';
  const page = await open('/');
  const popup = await prepAIWindow();
  await openBox(page);
  await box(page).locator('.ah-chip', { hasText: 'Explain' }).click();
  assert.match(await sentText(popup), /Explain this\.$/);
});

scenario('no Send button found: falls back to pressing Enter', async () => {
  await reset();
  fakeMode = 'nobutton';
  const page = await open('/');
  const popup = await prepAIWindow();
  await openBox(page);
  await box(page).locator('.ah-chip', { hasText: 'Explain' }).click();
  assert.match(await sentText(popup), /Explain this\.$/);
});

scenario('logged out: full page shown so you can log in, question sent after login', async () => {
  await reset();
  fakeMode = 'login';
  const page = await open('/');
  const popup = await prepAIWindow();
  await openBox(page);
  await box(page).locator('.ah-input').fill('After login question');
  await box(page).locator('.ah-input').press('Enter');
  // AskHere waits up to 20s for the chat box, then gives up and un-hides the page.
  await popup.waitForFunction(() => !document.documentElement.classList.contains('askhere-compact'), null, { timeout: 30000 });
  assert.equal(await popup.locator('#login').isVisible(), true, 'login button must be visible');
  // "Log in" -> page reloads with the chat box -> question goes through.
  fakeMode = 'normal';
  await popup.reload();
  assert.match(await sentText(popup), /After login question$/);
});

scenario('selection inside a textarea works', async () => {
  await reset();
  const page = await open('/inputs');
  await page.locator('#ta').evaluate((el) => {
    el.focus();
    el.setSelectionRange(4, 16); // "mitochondria"
  });
  await page.locator('#ta').dispatchEvent('mouseup');
  await page.mouse.move(5, 5);
  await page.mouse.up();
  await trigger(page).waitFor({ state: 'visible', timeout: 3000 });
  await trigger(page).click();
  assert.equal(await box(page).locator('.ah-quote').innerText(), 'mitochondria');
});

scenario('keyboard selection (Ctrl+A) shows the button', async () => {
  await reset();
  const page = await open('/inputs');
  await page.locator('#para').click();
  await page.keyboard.press('Control+a');
  await trigger(page).waitFor({ state: 'visible', timeout: 3000 });
});

scenario('keyboard selection inside a textarea (Shift+End) shows the button', async () => {
  await reset();
  const page = await open('/inputs');
  await page.locator('#ta').evaluate((el) => {
    el.focus();
    el.setSelectionRange(0, 0);
  });
  await page.keyboard.press('Shift+End');
  await trigger(page).waitFor({ state: 'visible', timeout: 3000 });
});

scenario('button setting "off": no button, shortcut/menu path still opens the box', async () => {
  await reset({ triggerMode: 'off' });
  const page = await open('/');
  await dragSelect(page, '#target b');
  await sleep(400);
  assert.equal(await trigger(page).isVisible(), false);
  // Simulate the keyboard shortcut / right-click menu (headless Chrome can't press real shortcuts).
  await sw.evaluate(async () => {
    const [tab] = await chrome.tabs.query({ active: true, windowType: 'normal' });
    await chrome.tabs.sendMessage(tab.id, { type: 'askhere:open' });
  });
  await box(page).waitFor({ state: 'visible', timeout: 3000 });
  assert.match(await box(page).locator('.ah-quote').innerText(), /mass and energy are equivalent/);
});

scenario('right-click menu with no live selection uses the menu text', async () => {
  await reset();
  const page = await open('/');
  await sw.evaluate(async () => {
    const [tab] = await chrome.tabs.query({ active: true, windowType: 'normal' });
    await chrome.tabs.sendMessage(tab.id, { type: 'askhere:open', text: 'text from the menu' });
  });
  await box(page).waitFor({ state: 'visible', timeout: 3000 });
  assert.equal(await box(page).locator('.ah-quote').innerText(), 'text from the menu');
});

scenario('button setting "alt": only shows while holding Alt', async () => {
  await reset({ triggerMode: 'alt' });
  const page = await open('/');
  await dragSelect(page, '#target b');
  await sleep(300);
  assert.equal(await trigger(page).isVisible(), false);
  await page.mouse.click(5, 5);
  await dragSelect(page, '#target b', { alt: true });
  await trigger(page).waitFor({ state: 'visible', timeout: 3000 });
});

scenario('disabled site: no button', async () => {
  await reset({ disabledSites: 'example.org\nlocalhost' });
  const page = await open('/');
  await dragSelect(page, '#target b');
  await sleep(400);
  assert.equal(await trigger(page).isVisible(), false);
});

scenario('Esc and clicking outside close the box; clearing the selection hides the button', async () => {
  await reset();
  const page = await open('/');
  await openBox(page);
  await page.keyboard.press('Escape');
  await box(page).waitFor({ state: 'detached' });
  await openBox(page);
  await page.mouse.click(900, 650);
  await box(page).waitFor({ state: 'detached' });
  await dragSelect(page, '#target b');
  await trigger(page).waitFor({ state: 'visible' });
  await page.evaluate(() => getSelection().removeAllRanges());
  await trigger(page).waitFor({ state: 'hidden', timeout: 2000 });
});

scenario('empty question + Enter asks "Explain this."', async () => {
  await reset();
  const page = await open('/');
  const popup = await prepAIWindow();
  await openBox(page);
  await box(page).locator('.ah-input').press('Enter');
  assert.match(await sentText(popup), /Explain this\.$/);
});

scenario('"add to every question" text is appended', async () => {
  await reset({ prefix: 'Answer in Hindi.' });
  const page = await open('/');
  const popup = await prepAIWindow();
  await openBox(page);
  await box(page).locator('.ah-chip', { hasText: 'Explain' }).click();
  // (the fake chat box's innerText shows blank lines as extra newlines)
  const sent = (await sentText(popup)).replace(/\n{3,}/g, '\n\n');
  assert.match(sent, /Explain this\.\n\nAnswer in Hindi\.$/);
});

scenario('typing in the box does not trigger the page\'s keyboard shortcuts', async () => {
  await reset();
  const page = await open('/');
  await page.evaluate(() => {
    window.__keys = 0;
    document.addEventListener('keydown', () => window.__keys++);
  });
  await openBox(page);
  await box(page).locator('.ah-input').type('hello');
  assert.equal(await page.evaluate(() => window.__keys), 0);
});

scenario('page removes the highlighted text before asking: still works', async () => {
  await reset();
  const page = await open('/');
  const popup = await prepAIWindow();
  await openBox(page);
  await page.evaluate(() => document.getElementById('target').remove());
  await page.locator('#scroller').evaluate((el) => el.scrollBy(0, 10)); // forces a reposition
  await sleep(100);
  await box(page).locator('.ah-chip', { hasText: 'Explain' }).click();
  assert.match(await sentText(popup), /> mass and energy are equivalent/);
});

scenario('very long selection is trimmed', async () => {
  await reset();
  const page = await open('/');
  await page.evaluate(() => {
    const p = document.createElement('p');
    p.id = 'long';
    p.textContent = 'word '.repeat(3000);
    document.getElementById('scroller').prepend(p);
  });
  const popup = await prepAIWindow();
  await page.locator('#long').click();
  await page.keyboard.press('Control+a');
  await trigger(page).waitFor({ state: 'visible', timeout: 3000 });
  await trigger(page).click();
  await box(page).locator('.ah-chip', { hasText: 'Explain' }).click();
  const sent = (await sentText(popup)).replace(/\n{3,}/g, '\n\n');
  assert.ok(sent.length < 6400, `length ${sent.length}`);
  assert.match(sent, / …\n\nExplain this\.$/);
});

scenario('hostile page CSS cannot hide or restyle AskHere', async () => {
  await reset();
  const page = await open('/hostile');
  await dragSelect(page, '#target');
  await trigger(page).waitFor({ state: 'visible', timeout: 3000 });
  await trigger(page).click();
  await box(page).waitFor({ state: 'visible' });
  const input = box(page).locator('.ah-input');
  assert.equal(await input.isVisible(), true);
  const color = await box(page).locator('.ah-title').evaluate((el) => getComputedStyle(el).color);
  assert.notEqual(color, 'rgb(255, 0, 0)');
  await page.screenshot({ path: path.join(shots, 'hostile.png'), animations: 'disabled' });
});

scenario('selecting text inside the AskHere box does not open another box', async () => {
  await reset();
  const page = await open('/');
  await openBox(page);
  const q = await box(page).locator('.ah-quote').boundingBox();
  await page.mouse.move(q.x + 2, q.y + q.height / 2);
  await page.mouse.down();
  await page.mouse.move(q.x + q.width - 2, q.y + q.height / 2, { steps: 5 });
  await page.mouse.up();
  await sleep(300);
  assert.equal(await trigger(page).isVisible(), false);
  assert.equal(await box(page).count(), 1);
});

async function sidePanelPage(timeout = 8000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    const p = context.pages().find((pg) => pg.url().includes('/sidepanel.html'));
    if (p) return p;
    await sleep(100);
  }
  return null;
}

const EXT_ID = new URL(sw.url()).host;

async function sidePanelCount() {
  return sw.evaluate(async () => (await chrome.runtime.getContexts({ contextTypes: ['SIDE_PANEL'] })).length);
}

async function frameIn(page, prefix, timeout = 10000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    const f = page.frames().find((fr) => fr.url().startsWith(prefix));
    if (f) return f;
    await sleep(100);
  }
  throw new Error('no frame ' + prefix);
}

// Playwright can't look inside Chrome's real side panel, so the panel page is
// also loaded in a normal tab (same code, same messages) to check what it does.
async function openPanelInTab() {
  const panel = await context.newPage();
  await panel.goto(`chrome-extension://${EXT_ID}/sidepanel.html`);
  return panel;
}

async function queuePanelJob(job) {
  await sw.evaluate((j) => chrome.storage.session.set({ sidepanelJob: { autoSend: true, createdAt: Date.now(), ...j } }), job);
}

scenario('side panel mode: Chrome opens the side panel, no window, no tab', async () => {
  await reset({ openIn: 'sidepanel' });
  const page = await open('/');
  const tabsBefore = await sw.evaluate(async () => (await chrome.tabs.query({})).length);
  await openBox(page);
  await box(page).locator('.ah-chip', { hasText: 'Explain' }).click();
  for (let i = 0; i < 50 && (await sidePanelCount()) === 0; i++) await sleep(100);
  assert.equal(await sidePanelCount(), 1, 'side panel should be open');
  assert.equal(await popupCount(), 0, 'no separate window');
  assert.equal(await sw.evaluate(async () => (await chrome.tabs.query({})).length), tabsBefore, 'no new tab');
  await sw.evaluate(async () => {
    // close it again for the next tests
    const [main] = await chrome.windows.getAll({ windowTypes: ['normal'] });
    await chrome.sidePanel.setOptions({ enabled: false });
    await chrome.sidePanel.setOptions({ enabled: true, path: 'sidepanel.html' });
    void main;
  });
});

scenario('side panel page: types and sends the question in embedded Claude, sidebar hidden', async () => {
  await reset();
  const panel = await openPanelInTab();
  await queuePanelJob({ target: 'claude', prompt: 'About this text:\n\n> E = mc²\n\nExplain this.' });
  const frame = await frameIn(panel, 'https://claude.ai/');
  await frame.waitForFunction(() => document.body?.dataset.sent, null, { timeout: 15000 });
  assert.match(await frame.evaluate(() => document.body.dataset.sent), /> E = mc²\n+Explain this\.$/);
  assert.equal(await frame.locator('#side').isVisible(), false);
  assert.equal(await frame.locator('#top').isVisible(), false);
  assert.equal(await frame.locator('askhere-bar').count(), 0, 'no floating bar inside the panel');
  assert.match(await panel.locator('#ai').innerText(), /Claude/);
  await panel.setViewportSize({ width: 400, height: 640 });
  await panel.screenshot({ path: path.join(shots, '4-side-panel.png') });
});

scenario('side panel page: ChatGPT works too', async () => {
  await reset();
  const panel = await openPanelInTab();
  await queuePanelJob({ target: 'chatgpt', prompt: 'Explain this please' });
  const frame = await frameIn(panel, 'https://chatgpt.com/');
  await frame.waitForFunction(() => document.body?.dataset.sent, null, { timeout: 15000 });
  assert.match(await frame.evaluate(() => document.body.dataset.sent), /Explain this please$/);
  assert.equal(await frame.locator('#stage-slideover-sidebar').isVisible(), false);
});

scenario('side panel page: a second question starts a fresh chat', async () => {
  await reset();
  const panel = await openPanelInTab();
  await queuePanelJob({ target: 'claude', prompt: 'First question' });
  let frame = await frameIn(panel, 'https://claude.ai/');
  await frame.waitForFunction(() => document.body?.dataset.sent, null, { timeout: 15000 });
  await queuePanelJob({ target: 'claude', prompt: 'Second question' });
  for (let i = 0; i < 100; i++) {
    frame = await frameIn(panel, 'https://claude.ai/');
    const sent = await frame.evaluate(() => document.body?.dataset.sent).catch(() => null);
    if (sent === 'Second question') return;
    await sleep(150);
  }
  throw new Error('second question never sent');
});

scenario('side panel page: logged out, then logs in inside the panel: question is sent', async () => {
  await reset();
  fakeMode = 'login';
  const panel = await openPanelInTab();
  await queuePanelJob({ target: 'claude', prompt: 'Panel login question' });
  let frame = await frameIn(panel, 'https://claude.ai/');
  await frame.waitForFunction(() => !document.documentElement.classList.contains('askhere-compact') && document.getElementById('login'), null, { timeout: 30000 });
  assert.equal(await frame.locator('#login').isVisible(), true, 'login visible');
  fakeMode = 'normal';
  await frame.evaluate(() => location.reload());
  await sleep(500);
  frame = await frameIn(panel, 'https://claude.ai/');
  await frame.waitForFunction(() => document.body?.dataset.sent, null, { timeout: 15000 });
  assert.match(await frame.evaluate(() => document.body.dataset.sent), /Panel login question$/);
});

scenario('side panel page: "open in tab" opens the chat in a normal tab', async () => {
  await reset();
  const panel = await openPanelInTab();
  await queuePanelJob({ target: 'claude', prompt: 'Q' });
  const frame = await frameIn(panel, 'https://claude.ai/');
  await frame.waitForFunction(() => document.body?.dataset.sent, null, { timeout: 15000 });
  await frame.evaluate(() => history.pushState({}, '', '/chat/abc123'));
  await sleep(1300); // inject.js reports URL changes every second
  const before = new Set(context.pages());
  await panel.locator('#full').click();
  let opened = null;
  for (let i = 0; i < 50 && !opened; i++) {
    opened = context.pages().find((p) => !before.has(p) && p.url().startsWith('https://claude.ai/'));
    await sleep(100);
  }
  assert.ok(opened, 'tab opened');
  assert.equal(opened.url(), 'https://claude.ai/chat/abc123');
});

scenario('claude.ai embedded by some other page is ignored', async () => {
  await reset();
  const page = await open('/');
  await page.evaluate(() => {
    const f = document.createElement('iframe');
    f.src = 'https://claude.ai/new';
    f.id = 'embed';
    document.body.append(f);
  });
  const frame = await frameIn(page, 'https://claude.ai/');
  await frame.waitForSelector('#side', { timeout: 5000 });
  await sleep(800);
  assert.equal(await frame.locator('#side').isVisible(), true, 'not compacted');
});

scenario('AskHere ✕ in a tab (side panel fallback) closes only that tab, not your window', async () => {
  await reset();
  const page = await open('/');
  const ai = await open('https://claude.ai/new');
  // Mark it as an AskHere tab, as the side-panel fallback does, then reload so inject.js sees it.
  await sw.evaluate(async () => {
    const tabs = await chrome.tabs.query({ active: true, windowType: 'normal' });
    await chrome.storage.session.set({ [`askTab:${tabs[0].id}`]: true });
  });
  await ai.reload();
  await ai.locator('askhere-bar').waitFor({ state: 'attached', timeout: 5000 });
  const windowsBefore = await sw.evaluate(async () => (await chrome.windows.getAll()).length);
  // Click the ✕ inside the closed shadow root by coordinates.
  const bar = await ai.locator('askhere-bar').boundingBox();
  await ai.mouse.click(bar.x + bar.width - 12, bar.y + bar.height / 2);
  for (let i = 0; i < 30 && !ai.isClosed(); i++) await sleep(100);
  assert.equal(ai.isClosed(), true, 'AI tab closed');
  assert.equal(page.isClosed(), false, 'your page is still open');
  assert.equal(await sw.evaluate(async () => (await chrome.windows.getAll()).length), windowsBefore);
});

// ---------- run ----------
const keepAlive = await context.newPage(); // keeps the browser window open between scenarios
let passed = 0;
const failures = [];
for (const s of scenarios) {
  if (only && !s.name.toLowerCase().includes(only.toLowerCase())) continue;
  const t0 = Date.now();
  try {
    await s.fn();
    passed++;
    console.log(`  ✓ ${s.name} (${Date.now() - t0}ms)`);
  } catch (err) {
    failures.push(s.name);
    console.log(`  ✗ ${s.name}\n      ${String(err?.stack || err).split('\n').slice(0, 3).join('\n      ')}`);
    const slug = s.name.replace(/\W+/g, '-').slice(0, 40);
    let i = 0;
    for (const p of context.pages()) {
      await p.screenshot({ path: path.join(shots, `fail-${slug}-${i++}.png`) }).catch(() => {});
    }
  }
}
console.log(`\n${passed} passed, ${failures.length} failed`);
await context.close();
server.close();
process.exit(failures.length ? 1 : 0);
