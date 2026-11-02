// Runs on claude.ai and chatgpt.com, both in AskHere's small window and inside
// AskHere's side panel (used when Chrome is fullscreen on a Mac). If AskHere
// opened this page with a question, type it into the chat box and press send,
// exactly like the user would. If anything goes wrong, the question is put on
// the clipboard so the user can paste it.
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

  // ---------- compact, AskHere-branded window ----------
  // Hides the site's sidebar and top bar (the window is narrow, so both sites
  // already use their mobile layout), renames the window "AskHere", and adds a
  // small AskHere bar with: open in a normal tab, full view toggle, close.
  function compactMode({ branded = true } = {}) {
    const AI_NAME = site === 'claude' ? 'Claude' : 'ChatGPT';
    const TITLE = `AskHere · ${AI_NAME}`;
    const root = document.documentElement;

    const pageSheet = new CSSStyleSheet();
    pageSheet.replaceSync(`
      html.askhere-compact nav,
      html.askhere-compact header,
      html.askhere-compact [data-testid="menu-sidebar"],
      html.askhere-compact [data-testid="pin-sidebar-toggle"],
      html.askhere-compact button[aria-label="Open sidebar"],
      html.askhere-compact #stage-slideover-sidebar,
      html.askhere-compact #page-header,
      html.askhere-compact [data-testid="open-sidebar-button"],
      html.askhere-compact [data-testid="close-sidebar-button"] {
        display: none !important;
      }
    `);
    document.adoptedStyleSheets = [...document.adoptedStyleSheets, pageSheet];
    const root0 = document.documentElement;
    if (!branded) {
      // Side panel: AskHere's own header is around this frame already.
      root0.classList.add('askhere-compact');
      return { setEnabled: (on) => root0.classList.toggle('askhere-compact', on) };
    }

    // The bar lives in a shadow root so the site's CSS can't restyle it.
    const host = document.createElement('askhere-bar');
    host.setAttribute('style', 'all: initial; position: fixed; top: 6px; right: 6px; z-index: 2147483647;');
    const shadow = host.attachShadow({ mode: 'closed' });
    const barSheet = new CSSStyleSheet();
    barSheet.replaceSync(`
      .bar { display: flex; align-items: center; gap: 2px; padding: 3px 4px 3px 9px; border-radius: 999px;
        background: rgba(255,255,255,.92); border: 1px solid rgba(20,16,30,.12);
        box-shadow: 0 4px 14px rgba(20,16,30,.14); backdrop-filter: blur(6px);
        font: 600 12px/1 ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif; color: #1c1b1f; }
      .spark { color: #c2612c; margin-right: 3px; }
      .name { margin-right: 4px; }
      button { all: unset; cursor: pointer; width: 22px; height: 22px; border-radius: 50%;
        display: grid; place-items: center; color: #6b6870; font-size: 13px; }
      button:hover { background: rgba(20,16,30,.08); color: #1c1b1f; }
      button:focus-visible { outline: 2px solid #c2612c; }
      @media (prefers-color-scheme: dark) {
        .bar { background: rgba(34,32,38,.92); border-color: rgba(255,255,255,.12); color: #eceaf0; }
        .spark { color: #e07a43; }
        button { color: #a29fa8; }
        button:hover { background: rgba(255,255,255,.1); color: #eceaf0; }
      }
    `);
    shadow.adoptedStyleSheets = [barSheet];
    const bar = document.createElement('div');
    bar.className = 'bar';
    bar.innerHTML =
      '<span class="spark">✦</span><span class="name">AskHere</span>' +
      '<button data-act="full" title="Open this chat in a normal tab">⤢</button>' +
      '<button data-act="toggle" title="Show the full page">☰</button>' +
      '<button data-act="close" title="Close">✕</button>';
    shadow.append(bar);
    bar.addEventListener('click', (e) => {
      const act = e.target.closest('button')?.dataset.act;
      if (act === 'full') chrome.runtime.sendMessage({ type: 'askhere:open-full', url: location.href }).catch(() => {});
      if (act === 'close') chrome.runtime.sendMessage({ type: 'askhere:close-window' }).catch(() => {});
      if (act === 'toggle') setEnabled(!root.classList.contains('askhere-compact'));
    });

    function setEnabled(on) {
      root.classList.toggle('askhere-compact', on);
      const t = shadow.querySelector('[data-act="toggle"]');
      t.title = on ? 'Show the full page' : 'Back to compact view';
    }

    // Window title + icon say "AskHere"; the site keeps resetting them, so re-apply.
    let iconUrl = chrome.runtime.getURL('icons/icon32.png');
    fetch(iconUrl)
      .then((r) => r.blob())
      .then(
        (b) =>
          new Promise((res) => {
            const fr = new FileReader();
            fr.onload = () => res(fr.result);
            fr.readAsDataURL(b);
          })
      )
      .then((dataUrl) => {
        iconUrl = dataUrl;
        brand();
      })
      .catch(() => {});

    function brand() {
      if (!document.head) return;
      if (document.title !== TITLE) document.title = TITLE;
      const icons = document.head.querySelectorAll('link[rel~="icon"]');
      const ours = [...icons].find((l) => l.dataset.askhere);
      for (const l of icons) if (l !== ours) l.remove();
      if (!ours) {
        const link = document.createElement('link');
        link.rel = 'icon';
        link.dataset.askhere = '1';
        link.href = iconUrl;
        document.head.append(link);
      } else if (ours.href !== iconUrl) {
        ours.href = iconUrl;
      }
    }

    let scheduled = false;
    new MutationObserver(() => {
      if (scheduled) return;
      scheduled = true;
      queueMicrotask(() => {
        scheduled = false;
        brand();
        if (!host.isConnected) root.append(host);
      });
    }).observe(root, { childList: true, subtree: true, characterData: true });

    root.append(host);
    setEnabled(true);
    brand();
    return { setEnabled };
  }

  // Only act where AskHere opened the page. Normal claude.ai / chatgpt.com
  // tabs are left completely alone.
  const EXT_ORIGIN = `chrome-extension://${chrome.runtime.id}`;
  const inFrame = window.top !== window;
  let compact = null;
  let job = null;
  let frameGiveUp = null;

  if (inFrame) {
    // Inside AskHere's side panel: the panel page is our parent. Anything else
    // embedding claude.ai is ignored.
    if (location.ancestorOrigins?.[0] !== EXT_ORIGIN) return;
    const settings = await chrome.storage.local.get({ compactWindow: true }).catch(() => ({ compactWindow: true }));
    if (settings.compactWindow) compact = compactMode({ branded: false });
    job = await new Promise((resolve) => {
      const onMsg = (e) => {
        if (e.origin !== EXT_ORIGIN || e.data?.askhere !== 'job') return;
        removeEventListener('message', onMsg);
        resolve(e.data.job || null);
      };
      addEventListener('message', onMsg);
      parent.postMessage({ askhere: 'ready' }, EXT_ORIGIN);
      setTimeout(() => resolve(null), 5000);
    });
    frameGiveUp = () => parent.postMessage({ askhere: 'need-login', job }, EXT_ORIGIN);
    // Let the panel know the chat's address, for its "open in a tab" button.
    let lastUrl = '';
    setInterval(() => {
      if (location.href !== lastUrl) {
        lastUrl = location.href;
        parent.postMessage({ askhere: 'url', url: lastUrl }, EXT_ORIGIN);
      }
    }, 1000);
  } else {
    let info;
    try {
      info = await chrome.runtime.sendMessage({ type: 'askhere:window-info' });
    } catch {
      return;
    }
    if (!info?.isAskWindow) return;
    compact = info.compact ? compactMode() : null;

    // The page can finish loading before AskHere has recorded the question for
    // this tab, so ask a few times.
    for (let i = 0; i < 6 && !job; i++) {
      if (i) await sleep(400);
      try {
        job = await chrome.runtime.sendMessage({ type: 'askhere:take-pending' });
      } catch {
        return;
      }
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
    compact?.setEnabled(false);
    // Keep the question so it is sent automatically after the user logs in.
    if (frameGiveUp) frameGiveUp();
    else chrome.runtime.sendMessage({ type: 'askhere:put-pending', job }).catch(() => {});
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
