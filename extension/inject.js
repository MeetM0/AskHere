// Runs on claude.ai and chatgpt.com. If AskHere opened this tab with a
// question, type it into the chat box and press send, exactly like the user
// would. If anything goes wrong, the question is put on the clipboard so the
// user can paste it.
//
// The selectors below are the fragile part: if Claude or ChatGPT change their
// page, update them here.

(async () => {
  const SITES = {
    claude: {
      composer: [
        'div[contenteditable="true"][data-testid="chat-input"]',
        'div.ProseMirror[contenteditable="true"]',
        'fieldset div[contenteditable="true"]',
        'div[contenteditable="true"][role="textbox"]',
        'div[contenteditable="true"]',
        'textarea',
      ],
      send: [
        'button[aria-label="Send message"]',
        'button[aria-label="Send Message"]',
        'button[data-testid="send-button"]',
        'button[aria-label*="Send" i]',
      ],
    },
    chatgpt: {
      composer: [
        '#prompt-textarea[contenteditable="true"]',
        '#prompt-textarea',
        'div.ProseMirror[contenteditable="true"]',
        'textarea[name="prompt-textarea"]',
        'textarea',
      ],
      send: [
        'button[data-testid="send-button"]',
        '#composer-submit-button',
        'button[aria-label*="Send" i]',
      ],
    },
  };

  const site = /(^|\.)claude\.ai$/.test(location.hostname) ? 'claude' : 'chatgpt';
  const S = SITES[site];

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // The page can finish loading before AskHere has recorded the question for
  // this tab, so ask a few times. Pages AskHere didn't open just get nothing.
  let job = null;
  for (let i = 0; i < 6 && !job; i++) {
    if (i) await sleep(400);
    try {
      job = await chrome.runtime.sendMessage({ type: 'askhere:take-pending' });
    } catch {
      return;
    }
  }
  if (!job?.prompt) return;

  function visible(el) {
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  }

  function find(selectors) {
    for (const sel of selectors) {
      for (const el of document.querySelectorAll(sel)) if (visible(el)) return el;
    }
    return null;
  }

  async function waitFor(fn, timeout) {
    const end = Date.now() + timeout;
    while (Date.now() < end) {
      const v = fn();
      if (v) return v;
      await sleep(150);
    }
    return null;
  }

  function textOf(el) {
    return (el.tagName === 'TEXTAREA' ? el.value : el.innerText || '').trim();
  }

  function insert(el, text) {
    el.focus();
    if (el.tagName === 'TEXTAREA') {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
      setter.call(el, text);
      el.dispatchEvent(new Event('input', { bubbles: true }));
      return;
    }
    // Rich editors (ProseMirror / Lexical) listen for real editing input.
    const range = document.createRange();
    range.selectNodeContents(el);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
    if (!document.execCommand('insertText', false, text) || !textOf(el)) {
      // Fallback: simulate a paste.
      const dt = new DataTransfer();
      dt.setData('text/plain', text);
      el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
    }
  }

  function sendButton() {
    const b = find(S.send);
    if (!b || b.disabled || b.getAttribute('aria-disabled') === 'true') return null;
    return b;
  }

  function pressEnter(el) {
    const opts = { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true };
    el.dispatchEvent(new KeyboardEvent('keydown', opts));
    el.dispatchEvent(new KeyboardEvent('keyup', opts));
  }

  function toast(message) {
    const el = document.createElement('div');
    el.textContent = message;
    el.setAttribute(
      'style',
      'position:fixed;left:50%;top:16px;transform:translateX(-50%);z-index:2147483647;max-width:90vw;' +
        'padding:10px 14px;border-radius:10px;background:#1c1b1f;color:#fff;font:14px/1.4 system-ui,sans-serif;' +
        'box-shadow:0 8px 24px rgba(0,0,0,.3)'
    );
    document.documentElement.append(el);
    setTimeout(() => el.remove(), 8000);
  }

  async function giveUp(message) {
    // Keep the question so it is sent automatically after the user logs in.
    chrome.runtime.sendMessage({ type: 'askhere:put-pending', job }).catch(() => {});
    try {
      await navigator.clipboard.writeText(job.prompt);
      toast(`${message} Your question is also copied, so you can paste it.`);
    } catch {
      toast(message);
    }
  }

  // The chat box can take a while to appear (page load, login redirect).
  const box = await waitFor(() => find(S.composer), 20000);
  if (!box) {
    await giveUp('AskHere: log in here and your question will be sent automatically.');
    return;
  }

  // SPAs sometimes re-render the editor right after it appears; retry a few times.
  let editor = box;
  for (let attempt = 0; attempt < 4; attempt++) {
    await sleep(attempt === 0 ? 300 : 600);
    editor = find(S.composer) || editor;
    insert(editor, job.prompt);
    await sleep(250);
    editor = find(S.composer) || editor;
    if (textOf(editor)) break;
  }
  if (!textOf(editor)) {
    await giveUp("AskHere couldn't type into the chat box.");
    return;
  }
  if (!job.autoSend) {
    editor.focus();
    return;
  }

  const btn = await waitFor(sendButton, 6000);
  if (btn) btn.click();
  else pressEnter(editor);

  // If the text is still sitting in the box, sending didn't work.
  await sleep(1500);
  const still = find(S.composer);
  if (still && textOf(still) && textOf(still).length >= Math.min(20, job.prompt.trim().length)) {
    toast('AskHere: press Enter to send your question.');
  }
})();
