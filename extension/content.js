// AskHere content script.
// Select text -> "✦ Ask AI" button -> small question box next to the text ->
// your own Claude / ChatGPT opens in a little window right beside it and the
// question is sent for you.

(() => {
  if (window.__askhereLoaded) return;
  window.__askhereLoaded = true;

  const QUICK_ACTIONS = [
    { label: 'Explain', prompt: 'Explain this.' },
    { label: 'Simplify', prompt: 'Explain this in simpler terms, as if I am new to the topic.' },
    { label: 'Example', prompt: 'Give me a concrete example of this.' },
    { label: 'Summarize', prompt: 'Summarize this in one or two sentences.' },
    { label: 'Why?', prompt: 'Why is this the case? What is the reasoning behind it?' },
  ];
  const AI_NAMES = { claude: 'Claude', chatgpt: 'ChatGPT' };
  const BOX_WIDTH = 360;

  // ---------- settings ----------
  let prefs = { triggerMode: 'button', disabledSites: '', target: 'auto', defaultAI: 'claude' };
  try {
    chrome.storage.local.get(prefs).then((s) => (prefs = s));
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local') return;
      for (const k of Object.keys(prefs)) if (changes[k]) prefs[k] = changes[k].newValue;
    });
  } catch {
    /* extension context gone */
  }

  function siteDisabled() {
    const host = location.hostname.replace(/^www\./, '');
    return prefs.disabledSites
      .split(/[\s,]+/)
      .map((s) => s.trim().replace(/^www\./, ''))
      .filter(Boolean)
      .some((d) => host === d || host.endsWith('.' + d));
  }

  // Same rule as lib/settings.js resolveTarget().
  function currentAI() {
    if (prefs.target === 'claude' || prefs.target === 'chatgpt') return prefs.target;
    const host = location.hostname.replace(/^www\./, '');
    if (host === 'claude.ai' || host.endsWith('.claude.ai')) return 'claude';
    if (host === 'chatgpt.com' || host.endsWith('.chatgpt.com') || host === 'chat.openai.com') return 'chatgpt';
    return prefs.defaultAI === 'chatgpt' ? 'chatgpt' : 'claude';
  }

  // ---------- shadow-DOM host (page CSS can't touch our UI) ----------
  const host = document.createElement('askhere-root');
  host.setAttribute(
    'style',
    'all: initial; position: fixed; top: 0; left: 0; width: 0; height: 0; z-index: 2147483647;'
  );
  const shadow = host.attachShadow({ mode: 'open' });
  const sheet = new CSSStyleSheet();
  shadow.adoptedStyleSheets = [sheet];
  fetch(chrome.runtime.getURL('panel.css'))
    .then((r) => r.text())
    .then((css) => sheet.replaceSync(css))
    .catch(() => {});

  function mount() {
    if (!host.isConnected) document.documentElement.appendChild(host);
  }

  // ---------- anchors: "where is the highlighted text on screen right now?" ----------
  function rangeAnchor(range) {
    let last = range.getBoundingClientRect();
    return {
      getRect() {
        if (range.startContainer.isConnected) {
          const r = range.getBoundingClientRect();
          if (r.width || r.height) last = r;
        }
        return last;
      },
      getEndRect() {
        const rects = range.startContainer.isConnected ? range.getClientRects() : [];
        return rects.length ? rects[rects.length - 1] : this.getRect();
      },
    };
  }

  function elementAnchor(el) {
    let last = el.getBoundingClientRect();
    return {
      getRect() {
        if (el.isConnected) last = el.getBoundingClientRect();
        return last;
      },
      getEndRect() {
        return this.getRect();
      },
    };
  }

  function fixedAnchor() {
    const rect = new DOMRect(Math.max(8, innerWidth / 2 - BOX_WIDTH / 2), 60, 0, 0);
    return { getRect: () => rect, getEndRect: () => rect };
  }

  // ---------- reading the selection ----------
  function isEditable(el) {
    if (!el) return false;
    if (el.tagName === 'TEXTAREA') return true;
    return el.tagName === 'INPUT' && /^(text|search|url|email|)$/i.test(el.type || '');
  }

  function captureSelection() {
    const active = document.activeElement;
    if (isEditable(active) && active.selectionStart !== active.selectionEnd) {
      const text = active.value.slice(active.selectionStart, active.selectionEnd);
      if (text.trim()) return { text, anchor: elementAnchor(active) };
    }
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || !sel.rangeCount) return null;
    const text = sel.toString();
    if (!text.trim()) return null;
    const range = sel.getRangeAt(0).cloneRange();
    if (range.commonAncestorContainer === host || host.contains(range.commonAncestorContainer)) return null;
    return { text, anchor: rangeAnchor(range) };
  }

  // ---------- tiny DOM helper ----------
  function h(tag, attrs = {}, ...children) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === 'class') el.className = v;
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else if (v !== false && v != null) el.setAttribute(k, v === true ? '' : v);
    }
    for (const c of children.flat()) if (c != null) el.append(c);
    return el;
  }

  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

  // ---------- "✦ Ask AI" button ----------
  const trigger = h(
    'button',
    { class: 'ah-trigger', type: 'button', title: 'Ask AI about this (Alt+Shift+A)' },
    h('span', { class: 'ah-spark', 'aria-hidden': 'true' }, '✦'),
    ' Ask AI'
  );
  shadow.append(trigger);
  let pending = null;

  trigger.addEventListener('mousedown', (e) => e.preventDefault()); // keep the selection
  trigger.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    const cap = pending;
    hideTrigger();
    if (cap) openBox(cap);
  });

  function showTrigger(cap) {
    mount();
    pending = cap;
    trigger.classList.add('ah-visible');
    positionTrigger();
  }

  function hideTrigger() {
    pending = null;
    trigger.classList.remove('ah-visible');
  }

  function positionTrigger() {
    if (!pending) return;
    const r = pending.anchor.getEndRect();
    const w = trigger.offsetWidth || 84;
    const left = clamp(r.right - w / 2, 6, innerWidth - w - 6);
    let top = r.bottom + 8;
    if (top + 34 > innerHeight) top = r.top - 40;
    trigger.style.transform = `translate(${left}px, ${top}px)`;
  }

  // ---------- the question box ----------
  let box = null; // { el, anchor, cap, placement }

  function openBox(cap) {
    closeBox();
    mount();
    let ai = currentAI();

    const input = h('textarea', {
      class: 'ah-input',
      rows: '1',
      placeholder: 'Ask anything… (Enter = Explain)',
      'aria-label': 'Your question',
    });
    const aiButtons = Object.entries(AI_NAMES).map(([id, name]) =>
      h(
        'button',
        {
          class: 'ah-ai-opt' + (id === ai ? ' ah-on' : ''),
          type: 'button',
          'data-ai': id,
          'aria-pressed': String(id === ai),
          onclick: () => {
            ai = id;
            for (const b of aiButtons) {
              const on = b.dataset.ai === id;
              b.classList.toggle('ah-on', on);
              b.setAttribute('aria-pressed', String(on));
            }
            input.focus();
          },
        },
        name
      )
    );

    const submit = (question) => {
      send(cap, question || input.value.trim() || 'Explain this.', ai);
      closeBox();
    };

    const el = h(
      'div',
      { class: 'ah-box', role: 'dialog', 'aria-label': 'Ask AI' },
      h(
        'div',
        { class: 'ah-head' },
        h('span', { class: 'ah-spark', 'aria-hidden': 'true' }, '✦'),
        h('span', { class: 'ah-title' }, 'Ask'),
        h('span', { class: 'ah-ai-switch', role: 'group', 'aria-label': 'Which AI' }, aiButtons),
        h('span', { class: 'ah-grow' }),
        h('button', { class: 'ah-icon', type: 'button', title: 'Close (Esc)', onclick: closeBox }, '×')
      ),
      h('div', { class: 'ah-quote', title: cap.text.trim() }, cap.text.trim().replace(/\s+/g, ' ')),
      h(
        'div',
        { class: 'ah-chips' },
        QUICK_ACTIONS.map((a) => h('button', { class: 'ah-chip', type: 'button', onclick: () => submit(a.prompt) }, a.label))
      ),
      h(
        'form',
        {
          class: 'ah-form',
          onsubmit: (e) => {
            e.preventDefault();
            submit();
          },
        },
        input,
        h('button', { class: 'ah-send', type: 'submit', title: 'Ask (Enter)' }, '↑')
      )
    );

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
        e.preventDefault();
        submit();
      }
    });
    input.addEventListener('input', () => {
      input.style.height = 'auto';
      input.style.height = Math.min(input.scrollHeight, 120) + 'px';
    });
    // Don't let the page's keyboard shortcuts fire while typing here.
    for (const type of ['keydown', 'keyup', 'keypress']) {
      el.addEventListener(type, (e) => {
        e.stopPropagation();
        if (type === 'keydown' && e.key === 'Escape') closeBox();
      });
    }

    shadow.append(el);
    box = { el, cap, placement: null };
    positionBox();
    requestAnimationFrame(() => {
      positionBox();
      input.focus({ preventScroll: true });
    });
  }

  function closeBox() {
    if (!box) return;
    box.el.remove();
    box = null;
  }

  function positionBox() {
    if (!box) return;
    const r = box.cap.anchor.getRect();
    const w = box.el.offsetWidth || BOX_WIDTH;
    const hgt = box.el.offsetHeight || 160;
    if (!box.placement) box.placement = innerHeight - r.bottom >= hgt + 16 || innerHeight - r.bottom >= r.top ? 'below' : 'above';
    const top = box.placement === 'below' ? r.bottom + 10 : r.top - hgt - 10;
    const left = clamp(r.left, 8, Math.max(8, innerWidth - w - 8));
    box.el.style.transform = `translate(${Math.round(left)}px, ${Math.round(top)}px)`;
  }

  // ---------- hand off to the background: open the AI window near the text ----------
  function send(cap, question, ai) {
    const r = cap.anchor.getRect();
    // Convert viewport coordinates to screen coordinates so the AI window can
    // be placed right next to the text. The browser's toolbar height is
    // outerHeight - innerHeight (approximate if devtools/side panels are open).
    const toolbar = Math.max(0, window.outerHeight - window.innerHeight);
    const sx = window.screenX;
    const sy = window.screenY + toolbar;
    const message = {
      type: 'askhere:ask',
      selection: cap.text,
      question,
      target: ai,
      title: document.title,
      url: location.href,
      hostname: location.hostname,
      anchor: { left: sx + r.left, right: sx + r.right, top: sy + r.top, bottom: sy + r.bottom },
      screen: {
        availLeft: screen.availLeft ?? 0,
        availTop: screen.availTop ?? 0,
        availWidth: screen.availWidth,
        availHeight: screen.availHeight,
      },
    };
    try {
      chrome.runtime.sendMessage(message).then((r) => r && !r.ok && console.warn('AskHere:', r.error)).catch(() => notice('AskHere was updated. Refresh this page to use it.'));
    } catch {
      notice('AskHere was updated. Refresh this page to use it.');
    }
    window.getSelection()?.removeAllRanges();
  }

  function notice(text) {
    mount();
    const el = h('div', { class: 'ah-notice', role: 'status' }, text);
    shadow.append(el);
    setTimeout(() => el.remove(), 5000);
  }

  // ---------- keep UI glued to its text while scrolling ----------
  let frameQueued = false;
  function reposition() {
    if (frameQueued) return;
    frameQueued = true;
    requestAnimationFrame(() => {
      frameQueued = false;
      positionTrigger();
      positionBox();
    });
  }
  addEventListener('scroll', reposition, { capture: true, passive: true });
  addEventListener('resize', reposition, { passive: true });

  // ---------- selection events ----------
  const fromOurUI = (e) => e.composedPath().includes(host);

  document.addEventListener('mouseup', (e) => {
    if (e.button !== 0 || fromOurUI(e)) return;
    setTimeout(() => {
      if (prefs.triggerMode === 'off' || siteDisabled()) return;
      if (prefs.triggerMode === 'alt' && !e.altKey) return;
      const cap = captureSelection();
      if (cap) showTrigger(cap);
      else hideTrigger();
    }, 0);
  });

  // Keyboard selection (Shift + arrows, Ctrl/Cmd + A).
  document.addEventListener('keyup', (e) => {
    if (!e.shiftKey && e.key !== 'a') return;
    if (prefs.triggerMode !== 'button' || siteDisabled()) return;
    const cap = captureSelection();
    if (cap) showTrigger(cap);
  });

  document.addEventListener('mousedown', (e) => {
    if (fromOurUI(e)) return;
    hideTrigger();
    closeBox();
  });

  document.addEventListener('selectionchange', () => {
    if (!pending) return;
    const sel = window.getSelection();
    const active = document.activeElement;
    const inputSel = isEditable(active) && active.selectionStart !== active.selectionEnd;
    if (!inputSel && (!sel || sel.isCollapsed)) hideTrigger();
  });

  // ---------- keyboard shortcut / right-click menu ----------
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg?.type !== 'askhere:open') return;
    hideTrigger();
    let cap = captureSelection();
    if (!cap && msg.text) cap = { text: msg.text, anchor: fixedAnchor() };
    if (cap) openBox(cap);
  });
})();
