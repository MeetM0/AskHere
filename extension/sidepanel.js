// AskHere side panel: used instead of the small window when Chrome is in
// fullscreen on a Mac (a separate window would jump to another desktop Space).
// It shows claude.ai / chatgpt.com in a frame and hands the question to
// inject.js running inside that frame.

import { AI_SITES } from './lib/settings.js';

const frame = document.getElementById('frame');
const empty = document.getElementById('empty');
const aiLabel = document.getElementById('ai');
let job = null; // question waiting to be handed to the frame
let frameOrigin = null;
let chatUrl = null; // where the chat in the frame currently is

async function takeJob() {
  const { sidepanelJob } = await chrome.storage.session.get('sidepanelJob');
  if (!sidepanelJob) return;
  await chrome.storage.session.remove('sidepanelJob');
  if (Date.now() - sidepanelJob.createdAt > 10 * 60 * 1000) return;
  start(sidepanelJob);
}

function start(newJob) {
  job = newJob;
  const site = AI_SITES[job.target] || AI_SITES.claude;
  frameOrigin = new URL(site.url).origin;
  aiLabel.textContent = '· ' + site.name;
  empty.hidden = true;
  frame.hidden = false;
  // Always start a fresh chat for a new question.
  chatUrl = null;
  frame.src = site.url + (site.url.includes('?') ? '&' : '?') + 'askhere=' + Date.now();
}

addEventListener('message', (e) => {
  if (e.source !== frame.contentWindow || e.origin !== frameOrigin) return;
  if (e.data?.askhere === 'ready' && job) {
    frame.contentWindow.postMessage({ askhere: 'job', job }, frameOrigin);
    job = null;
  } else if (e.data?.askhere === 'url' && typeof e.data.url === 'string') {
    if (new URL(e.data.url).origin === frameOrigin) chatUrl = e.data.url;
  } else if (e.data?.askhere === 'need-login' && e.data.job) {
    // Not logged in: keep the question and send it once the chat box shows up.
    job = e.data.job;
  }
});

chrome.storage.session.onChanged.addListener((changes) => {
  if (changes.sidepanelJob?.newValue) takeJob();
});

document.getElementById('close').addEventListener('click', () => window.close());
document.getElementById('full').addEventListener('click', async () => {
  const url = chatUrl || frame.src;
  if (!url || frame.hidden) return;
  await chrome.tabs.create({ url: url.replace(/[?&]askhere=\d+/, ''), active: true });
  window.close();
});

takeJob();
