import { test } from 'node:test';
import assert from 'node:assert/strict';
import { placeWindow } from '../extension/lib/placement.js';

const screen = { availLeft: 0, availTop: 0, availWidth: 1920, availHeight: 1080 };
const size = { width: 520, height: 720 };

test('goes below the text when there is room', () => {
  const b = placeWindow({ left: 300, right: 500, top: 200, bottom: 220 }, screen, size);
  assert.deepEqual(b, { width: 520, height: 720, left: 300, top: 232 });
});

test('goes above the text near the bottom of the screen', () => {
  const b = placeWindow({ left: 300, right: 500, top: 900, bottom: 920 }, screen, size);
  assert.equal(b.top, 900 - 12 - 720);
});

test('goes beside the text when neither above nor below fits', () => {
  const b = placeWindow({ left: 300, right: 500, top: 500, bottom: 520 }, screen, size);
  assert.equal(b.left, 512);
});

test('stays on screen', () => {
  const b = placeWindow({ left: 1800, right: 1900, top: 100, bottom: 120 }, screen, size);
  assert.equal(b.left, 1920 - 520);
});

test('respects multi-monitor offsets', () => {
  const second = { availLeft: 1920, availTop: 0, availWidth: 1280, availHeight: 1024 };
  const b = placeWindow({ left: 1000, right: 1100, top: 100, bottom: 120 }, second, size);
  assert.equal(b.left, 1920);
});

test('no anchor -> only size', () => {
  assert.deepEqual(placeWindow(null, null, size), { width: 520, height: 720 });
});
