import { DEFAULTS, ANTHROPIC_MODELS, getSettings } from './lib/settings.js';

const $ = (id) => document.getElementById(id);
const CUSTOM = '__custom__';

const modelSelect = $('anthropicModelSelect');
for (const m of ANTHROPIC_MODELS) modelSelect.add(new Option(m.label, m.id));
modelSelect.add(new Option('Custom model ID…', CUSTOM));

const simpleFields = [
  'anthropicKey',
  'openaiKey',
  'openaiModel',
  'effort',
  'answerLength',
  'customInstructions',
  'triggerMode',
  'disabledSites',
];

async function load() {
  const s = await getSettings();
  for (const k of simpleFields) $(k).value = s[k];
  document.querySelector(`input[name="provider"][value="${s.provider}"]`).checked = true;
  if (ANTHROPIC_MODELS.some((m) => m.id === s.anthropicModel)) {
    modelSelect.value = s.anthropicModel;
  } else {
    modelSelect.value = CUSTOM;
    $('anthropicModelCustom').value = s.anthropicModel;
  }
  refreshVisibility();
}

function collect() {
  const out = {};
  for (const k of simpleFields) out[k] = $(k).value;
  out.provider = document.querySelector('input[name="provider"]:checked')?.value || DEFAULTS.provider;
  out.anthropicModel =
    modelSelect.value === CUSTOM ? $('anthropicModelCustom').value.trim() || DEFAULTS.anthropicModel : modelSelect.value;
  out.openaiModel = out.openaiModel.trim() || DEFAULTS.openaiModel;
  return out;
}

function refreshVisibility() {
  const provider = document.querySelector('input[name="provider"]:checked')?.value;
  for (const box of document.querySelectorAll('.provider-box')) box.hidden = box.dataset.provider !== provider;
  $('anthropicModelCustomWrap').hidden = modelSelect.value !== CUSTOM;
}

let savedTimer;
async function save() {
  await chrome.storage.local.set(collect());
  const el = $('saved');
  el.textContent = 'Saved ✓';
  el.className = 'status ok';
  clearTimeout(savedTimer);
  savedTimer = setTimeout(() => (el.textContent = ''), 1500);
}

document.addEventListener('input', () => {
  refreshVisibility();
  save();
});
document.addEventListener('change', () => {
  refreshVisibility();
  save();
});

// "Test connection" runs a tiny real request through the background worker,
// exactly like the in-page panel does.
$('test').addEventListener('click', async () => {
  await save();
  const out = $('testResult');
  out.className = 'status';
  out.textContent = 'Testing…';
  const port = chrome.runtime.connect({ name: 'askhere:ask' });
  let text = '';
  port.onMessage.addListener((m) => {
    if (m.type === 'delta') text += m.text;
    else if (m.type === 'done') {
      out.className = 'status ok';
      out.textContent = `✓ Works (${m.model}): "${text.trim().slice(0, 80)}"`;
      port.disconnect();
    } else if (m.type === 'error') {
      out.className = 'status err';
      out.textContent = m.message;
      port.disconnect();
    }
  });
  port.postMessage({
    type: 'ask',
    source: { selection: 'AskHere connection test', title: 'Settings', url: 'about:settings' },
    turns: [{ role: 'user', content: 'Reply with just the word "ready".' }],
  });
});

load();
