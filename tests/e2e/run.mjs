// End-to-end check: loads the unpacked extension in Chromium, selects text on a
// test page, clicks "Ask AI" -> "Explain", and verifies that a popup window
// opens on claude.ai (served by a local fake that mimics Claude's chat box)
// and that the question is typed in and sent.
//
//   npm run test:e2e         (needs Playwright + Chromium installed)

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

const html = await readFile(path.join(here, 'page.html'));
const fakeClaude = await readFile(path.join(here, 'fake-claude.html'), 'utf8');
const server = createServer((_, res) => res.end(html)).listen(0);
const pageUrl = `http://localhost:${server.address().port}/`;

const userDataDir = await mkdtemp(path.join(tmpdir(), 'askhere-e2e-'));
const context = await chromium.launchPersistentContext(userDataDir, {
  headless: true,
  channel: 'chromium', // the full Chromium build; extensions need it in headless mode
  args: [`--disable-extensions-except=${extPath}`, `--load-extension=${extPath}`],
  viewport: { width: 1100, height: 720 },
});

async function waitForNewPage(known, timeout = 15000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    const p = context.pages().find((pg) => !known.has(pg));
    if (p) return p;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('AI window did not open');
}

let failed = false;
try {
  const claudeLoads = [];
  await context.route('https://claude.ai/**', (route) => {
    claudeLoads.push(route.request().url());
    return route.fulfill({ status: 200, contentType: 'text/html', body: fakeClaude });
  });

  let [sw] = context.serviceWorkers();
  if (!sw) sw = await context.waitForEvent('serviceworker');
  for (const p of context.pages()) if (p.url().startsWith('chrome-extension://')) await p.close();
  sw.on('console', (m) => console.log('[sw]', m.text()));

  const page = await context.newPage();
  page.on('console', (m) => console.log('[page]', m.text()));
  await page.goto(pageUrl);
  await page.waitForTimeout(300);

  // Drag-select "mass and energy are equivalent".
  const b = await page.locator('#target b').boundingBox();
  await page.mouse.move(b.x + 1, b.y + b.height / 2);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width - 1, b.y + b.height / 2, { steps: 8 });
  await page.mouse.up();

  const trigger = page.locator('askhere-root .ah-trigger');
  await trigger.waitFor({ state: 'visible', timeout: 3000 });
  await page.screenshot({ path: path.join(shots, '1-trigger.png'), animations: 'disabled' });
  await trigger.click();

  const box = page.locator('askhere-root .ah-box');
  await box.waitFor({ state: 'visible' });
  assert.match(await box.locator('.ah-quote').innerText(), /mass and energy are equivalent/);
  assert.equal(await box.locator('.ah-ai-opt.ah-on').innerText(), 'Claude');
  await page.screenshot({ path: path.join(shots, '2-ask-box.png'), animations: 'disabled' });

  // The box follows the text when an inner container scrolls.
  const before = await box.boundingBox();
  await page.locator('#scroller').evaluate((el) => el.scrollBy(0, 40));
  await page.waitForTimeout(100);
  const after = await box.boundingBox();
  assert.ok(Math.abs(before.y - after.y - 40) < 3, `box should move up 40px, moved ${before.y - after.y}`);

  // Playwright can only intercept a window's requests once it is attached to
  // it, so pre-open AskHere's reusable popup window (blank) and let the
  // extension navigate it, exactly as it does for every question after the first.
  const knownPages = new Set(context.pages());
  await sw.evaluate(async () => {
    const w = await chrome.windows.create({ url: 'about:blank', type: 'popup' });
    await chrome.storage.session.set({ askWindow: { windowId: w.id, tabId: w.tabs[0].id } });
  });
  const popup = await waitForNewPage(knownPages);
  await popup.waitForLoadState();

  await box.locator('.ah-chip', { hasText: 'Explain' }).click();
  await box.waitFor({ state: 'detached' });
  await popup.waitForFunction(() => document.body.dataset.sent, null, { timeout: 15000 });
  const sent = await popup.evaluate(() => document.body.dataset.sent);
  assert.match(sent, /^About this text from "AskHere test page"/);
  assert.match(sent, /> mass and energy are equivalent/);
  assert.match(sent, /Explain this\.$/);
  assert.equal(claudeLoads.at(-1), 'https://claude.ai/new');

  // It's a small popup window, not a tab.
  const aiWin = await sw.evaluate(async () => {
    const { askWindow } = await chrome.storage.session.get('askWindow');
    return chrome.windows.get(askWindow.windowId);
  });
  assert.equal(aiWin.type, 'popup');
  await popup.screenshot({ path: path.join(shots, '3-claude-window.png') });

  // Asking again reuses the same window.
  await page.bringToFront();
  await page.locator('#target').click({ clickCount: 3 });
  await page.keyboard.press('Alt+Shift+A').catch(() => {});
  // Shortcuts aren't delivered in headless mode, so use the button again.
  await page.mouse.up();
  await trigger.waitFor({ state: 'visible', timeout: 3000 });
  await trigger.click();
  await box.locator('.ah-input').fill('Who said it?');
  await box.locator('.ah-input').press('Enter');
  await popup.waitForFunction(() => /Who said it\?$/.test(document.body.dataset.sent || ''), null, { timeout: 15000 });
  const wins2 = await sw.evaluate(() => chrome.windows.getAll());
  assert.equal(wins2.filter((w) => w.type === 'popup').length, 1, 'should reuse one popup window');

  console.log('E2E passed ✓');
} catch (err) {
  failed = true;
  console.error('E2E failed:', err);
  for (const p of context.pages()) {
    await p.screenshot({ path: path.join(shots, `failure-${Math.random().toString(36).slice(2, 6)}.png`) }).catch(() => {});
  }
} finally {
  await context.close();
  server.close();
}
process.exit(failed ? 1 : 0);
