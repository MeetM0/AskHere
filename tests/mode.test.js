import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../extension/lib/mode.js';

const { chooseOpenIn, detectEnv } = globalThis.AskHereMode;

function fakeWindow({ platform, uaPlatform, outer, screen, fullscreenElement = null }) {
  return {
    navigator: { platform, userAgentData: uaPlatform ? { platform: uaPlatform } : undefined },
    outerWidth: outer[0],
    outerHeight: outer[1],
    screen: { width: screen[0], height: screen[1] },
    document: { fullscreenElement },
  };
}

test('Mac, Chrome fullscreen (green button) -> floating window', () => {
  const env = detectEnv(fakeWindow({ uaPlatform: 'macOS', outer: [1512, 982], screen: [1512, 982] }));
  assert.deepEqual(env, { isMac: true, isFullscreen: true });
  assert.equal(chooseOpenIn('auto', env), 'pip');
});

test('Mac, older Chrome without userAgentData -> still detected', () => {
  const env = detectEnv(fakeWindow({ platform: 'MacIntel', outer: [1440, 900], screen: [1440, 900] }));
  assert.equal(chooseOpenIn('auto', env), 'pip');
});

test('Mac, a video/page element in fullscreen -> floating window', () => {
  const env = detectEnv(fakeWindow({ uaPlatform: 'macOS', outer: [1200, 800], screen: [1512, 982], fullscreenElement: {} }));
  assert.equal(chooseOpenIn('auto', env), 'pip');
});

test('Mac, normal or "zoomed" window (not fullscreen) -> small window', () => {
  // A zoomed Mac window fills the screen minus the menu bar: not fullscreen.
  const env = detectEnv(fakeWindow({ uaPlatform: 'macOS', outer: [1512, 949], screen: [1512, 982] }));
  assert.equal(env.isFullscreen, false);
  assert.equal(chooseOpenIn('auto', env), 'window');
});

test('Windows fullscreen (F11) -> small window (it can float above fullscreen there)', () => {
  const env = detectEnv(fakeWindow({ uaPlatform: 'Windows', outer: [1920, 1080], screen: [1920, 1080] }));
  assert.deepEqual(env, { isMac: false, isFullscreen: true });
  assert.equal(chooseOpenIn('auto', env), 'window');
});

test('Windows maximized -> small window', () => {
  const env = detectEnv(fakeWindow({ uaPlatform: 'Windows', outer: [1936, 1056], screen: [1920, 1080] }));
  assert.equal(chooseOpenIn('auto', env), 'window');
});

test('Linux / ChromeOS fullscreen -> small window', () => {
  assert.equal(chooseOpenIn('auto', detectEnv(fakeWindow({ uaPlatform: 'Linux', outer: [1920, 1080], screen: [1920, 1080] }))), 'window');
  assert.equal(chooseOpenIn('auto', detectEnv(fakeWindow({ uaPlatform: 'Chrome OS', outer: [1366, 768], screen: [1366, 768] }))), 'window');
});

test('notch MacBook in fullscreen: background passes the real window state, still floating window', () => {
  // outerHeight is shorter than the screen on notched MacBooks, so page-side
  // size checks miss it; the background asks Chrome for the window state instead.
  assert.equal(chooseOpenIn('auto', { isMac: true, isFullscreen: true }), 'pip');
});

test('explicit setting always wins', () => {
  const macFs = { isMac: true, isFullscreen: true };
  const winNormal = { isMac: false, isFullscreen: false };
  assert.equal(chooseOpenIn('window', macFs), 'window');
  assert.equal(chooseOpenIn('sidepanel', winNormal), 'sidepanel');
  assert.equal(chooseOpenIn('pip', winNormal), 'pip');
});

test('missing pieces never throw', () => {
  assert.doesNotThrow(() => detectEnv({}));
  assert.equal(chooseOpenIn(undefined, detectEnv({})), 'window');
});
