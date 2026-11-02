import { getSettings } from './lib/settings.js';

const $ = (id) => document.getElementById(id);
const valueFields = ['target', 'defaultAI', 'windowSize', 'prefix', 'triggerMode', 'disabledSites'];
const checkFields = ['compactWindow', 'reuseWindow', 'autoSend'];

async function load() {
  const s = await getSettings();
  for (const k of valueFields) $(k).value = s[k];
  for (const k of checkFields) $(k).checked = !!s[k];
}

let savedTimer;
async function save() {
  const out = {};
  for (const k of valueFields) out[k] = $(k).value;
  for (const k of checkFields) out[k] = $(k).checked;
  await chrome.storage.local.set(out);
  const el = $('saved');
  el.textContent = 'Saved ✓';
  el.className = 'status ok';
  clearTimeout(savedTimer);
  savedTimer = setTimeout(() => (el.textContent = ''), 1500);
}

document.addEventListener('input', save);
document.addEventListener('change', save);
load();
