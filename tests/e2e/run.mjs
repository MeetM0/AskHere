// End-to-end check: loads the unpacked extension in Chromium, mocks the Claude
// API, selects text, clicks "Ask AI", and verifies the answer streams into the
// panel and that the panel follows the text when an inner container scrolls.
//
//   npm run test:e2e         (needs Playwright + Chromium installed)

process.env.PW_EXPERIMENTAL_SERVICE_WORKER_NETWORK_EVENTS = '1';

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
const server = createServer((_, res) => res.end(html)).listen(0);
const pageUrl = `http://localhost:${server.address().port}/`;

function sse(text) {
  const ev = (type, obj) => `event: ${type}\ndata: ${JSON.stringify({ type, ...obj })}\n\n`;
  let out = ev('message_start', { message: { id: 'msg_1', model: 'claude-opus-5-5', content: [] } });
  out += ev('content_block_start', { index: 0, content_block: { type: 'text', text: '' } });
  for (const piece of text.match(/.{1,12}/gs)) {
    out += ev('content_block_delta', { index: 0, delta: { type: 'text_delta', text: piece } });
  }
  out += ev('content_block_stop', { index: 0 });
  out += ev('message_delta', { delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 20 } });
  out += ev('message_stop', {});
  return out;
}

const requests = [];
const userDataDir = await mkdtemp(path.join(tmpdir(), 'askhere-e2e-'));
const context = await chromium.launchPersistentContext(userDataDir, {
  headless: true,
  channel: 'chromium', // the full Chromium build; extensions need it in headless mode
  args: [`--disable-extensions-except=${extPath}`, `--load-extension=${extPath}`],
  viewport: { width: 1100, height: 720 },
});

let failed = false;
try {
  await context.route('https://api.anthropic.com/**', async (route) => {
    const req = route.request();
    requests.push({ headers: req.headers(), body: JSON.parse(req.postData()) });
    const n = requests.length;
    const answer =
      n === 1
        ? '**c** is the *speed of light*: about `299,792 km/s`.\n\n- Because c is huge, a tiny mass holds a lot of energy.'
        : 'Squaring c makes the number enormous, which is why the energy is so large.';
    await route.fulfill({ status: 200, headers: { 'content-type': 'text/event-stream' }, body: sse(answer) });
  });

  let [sw] = context.serviceWorkers();
  if (!sw) sw = await context.waitForEvent('serviceworker');
  await sw.evaluate(() => chrome.storage.local.set({ anthropicKey: 'sk-ant-test' }));

  // Close the welcome/options tab opened on install.
  for (const p of context.pages()) if (p.url().startsWith('chrome-extension://')) await p.close();

  const page = await context.newPage();
  await page.goto(pageUrl);
  await page.waitForTimeout(300);

  // Drag-select "mass and energy are equivalent".
  const box = await page.locator('#target b').boundingBox();
  await page.mouse.move(box.x + 1, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width - 1, box.y + box.height / 2, { steps: 8 });
  await page.mouse.up();

  const trigger = page.locator('askhere-root .ah-trigger');
  await trigger.waitFor({ state: 'visible', timeout: 3000 });
  await page.screenshot({ path: path.join(shots, '1-trigger.png') });
  await trigger.click();

  const panel = page.locator('askhere-root .ah-panel');
  await panel.waitFor({ state: 'visible' });
  assert.match(await panel.locator('.ah-quote').innerText(), /mass and energy are equivalent/);

  await panel.locator('.ah-chip', { hasText: 'Explain' }).click();
  await panel.locator('.ah-ai ul li').waitFor({ timeout: 5000 });
  const answer = await panel.locator('.ah-ai').first().innerText();
  assert.match(answer, /speed of light/);
  await page.screenshot({ path: path.join(shots, '2-answer.png') });

  // Request shape
  const first = requests[0];
  assert.equal(first.headers['x-api-key'], 'sk-ant-test');
  assert.equal(first.headers['anthropic-version'], '2026-10-21');
  assert.equal(first.body.model, 'claude-opus-5-5');
  assert.equal(first.body.stream, true);
  assert.equal(first.body.messages.length, 1);
  assert.match(first.body.messages[0].content, /<highlighted>\nmass and energy are equivalent\n<\/highlighted>/);
  assert.match(first.body.messages[0].content, /Question: Explain this\./);

  // The panel should follow the text when the inner container scrolls.
  const before = await panel.boundingBox();
  await page.locator('#scroller').evaluate((el) => el.scrollBy(0, 120));
  await page.waitForTimeout(150);
  const after = await panel.boundingBox();
  assert.ok(Math.abs(before.y - after.y - 120) < 3, `panel should move up 120px, moved ${before.y - after.y}`);

  // Follow-up question keeps the conversation.
  await panel.locator('.ah-input').fill('Why is it squared?');
  await panel.locator('.ah-input').press('Enter');
  await panel.locator('.ah-ai').nth(1).getByText('enormous').waitFor({ timeout: 5000 });
  const second = requests[1].body.messages;
  assert.equal(second.length, 3);
  assert.equal(second[1].role, 'assistant');
  assert.equal(second[2].content, 'Why is it squared?');
  await page.screenshot({ path: path.join(shots, '3-followup.png') });

  // Esc closes it.
  await panel.locator('.ah-input').press('Escape');
  await panel.waitFor({ state: 'detached' });

  console.log('E2E passed ✓');
} catch (err) {
  failed = true;
  console.error('E2E failed:', err);
  for (const p of context.pages()) await p.screenshot({ path: path.join(shots, 'failure.png') }).catch(() => {});
} finally {
  await context.close();
  server.close();
}
process.exit(failed ? 1 : 0);
