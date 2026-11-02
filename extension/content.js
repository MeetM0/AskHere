// AskHere content script.
// Shows an "Ask AI" button when you highlight text, and opens a small chat
// panel anchored to that text. The panel follows the text as you scroll, so
// you can ask side questions without losing your place.

(() => {
  if (window.__askhereLoaded) return;
  window.__askhereLoaded = true;

  const MD = globalThis.AskHereMarkdown;
  const PANEL_WIDTH = 400;
  const QUICK_ACTIONS = [
    { label: 'Explain', prompt: 'Explain this.' },
    { label: 'Simplify', prompt: 'Explain this in simpler terms, as if I am new to the topic.' },
    { label: 'Example', prompt: 'Give me a concrete example of this.' },
    { label: 'Summarize', prompt: 'Summarize this in one or two sentences.' },
    { label: 'Why?', prompt: 'Why is this the case? What is the reasoning behind it?' },
  ];

  // ---------- settings (only the non-secret bits the page needs) ----------
  let prefs = { triggerMode: 'button', disabledSites: '' };
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

  // ---------- shadow-DOM host ----------
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

  // Highlight the text a panel is about, without touching the page's DOM.
  const highlight = typeof Highlight === 'function' && CSS.highlights ? new Highlight() : null;
  if (highlight) {
    CSS.highlights.set('askhere', highlight);
    try {
      const docSheet = new CSSStyleSheet();
      docSheet.replaceSync('::highlight(askhere) { background-color: rgba(250, 204, 21, 0.35); }');
      document.adoptedStyleSheets = [...document.adoptedStyleSheets, docSheet];
    } catch {
      /* ignore */
    }
  }

  // ---------- anchors: something we can ask "where are you on screen now?" ----------
  function rangeAnchor(range) {
    let last = range.getBoundingClientRect();
    return {
      range,
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
    const rect = new DOMRect(Math.max(8, innerWidth / 2 - PANEL_WIDTH / 2), 60, 0, 0);
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
      if (text.trim()) return { text, anchor: elementAnchor(active), context: '' };
    }
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || !sel.rangeCount) return null;
    const text = sel.toString();
    if (!text.trim()) return null;
    const range = sel.getRangeAt(0).cloneRange();
    if (host.contains(range.commonAncestorContainer) || range.commonAncestorContainer === host) return null;
    return { text, anchor: rangeAnchor(range), context: surroundingText(range, text) };
  }

  // A little text around the selection helps the model understand it.
  function surroundingText(range, selected) {
    let el = range.commonAncestorContainer;
    if (el.nodeType !== Node.ELEMENT_NODE) el = el.parentElement;
    if (!el) return '';
    while (el.parentElement && el !== document.body && (el.innerText || '').length < 800) {
      el = el.parentElement;
    }
    let text = (el.innerText || '').replace(/\n{3,}/g, '\n\n').trim();
    const LIMIT = 2500;
    if (text.length > LIMIT) {
      const at = Math.max(0, text.indexOf(selected.trim().slice(0, 80)));
      const start = Math.max(0, at - LIMIT / 2);
      text = (start > 0 ? '…' : '') + text.slice(start, start + LIMIT) + '…';
    }
    return text;
  }

  // ---------- small DOM helper ----------
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

  // ---------- the floating "Ask AI" button ----------
  const trigger = h(
    'button',
    { class: 'ah-trigger', type: 'button', title: 'Ask AI about this (Alt+Shift+A)' },
    h('span', { class: 'ah-spark', 'aria-hidden': 'true' }, '✦'),
    ' Ask AI'
  );
  shadow.append(trigger);
  let pending = null; // { text, anchor, context, onPick? }

  // Keep the page selection alive when clicking the button.
  trigger.addEventListener('mousedown', (e) => e.preventDefault());
  trigger.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    const cap = pending;
    hideTrigger();
    if (!cap) return;
    if (cap.onPick) cap.onPick(cap.text);
    else openPanel(cap);
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

  // ---------- panels ----------
  const panels = new Set();
  let zCounter = 1;

  class Panel {
    constructor(cap) {
      this.source = {
        selection: cap.text.trim().slice(0, 8000),
        context: cap.context || '',
        title: document.title,
        url: location.href,
      };
      this.anchor = cap.anchor;
      this.turns = [];
      this.dx = 0;
      this.dy = 0;
      this.placement = null;
      this.port = null;
      this.minimized = false;
      if (highlight && cap.anchor.range) highlight.add(cap.anchor.range);
      this.build();
    }

    build() {
      const quoteText = this.source.selection.replace(/\s+/g, ' ');
      this.thread = h('div', { class: 'ah-thread', 'aria-live': 'polite' });
      this.input = h('textarea', {
        class: 'ah-input',
        rows: '1',
        placeholder: 'Ask anything about this…',
        'aria-label': 'Your question',
      });
      this.sendBtn = h('button', { class: 'ah-send', type: 'submit', title: 'Send (Enter)' }, '↑');
      this.chips = h(
        'div',
        { class: 'ah-chips' },
        QUICK_ACTIONS.map((a) =>
          h('button', { class: 'ah-chip', type: 'button', onclick: () => this.ask(a.prompt, a.label) }, a.label)
        )
      );
      this.form = h(
        'form',
        {
          class: 'ah-form',
          onsubmit: (e) => {
            e.preventDefault();
            if (this.port) this.stop();
            else this.submitInput();
          },
        },
        this.input,
        this.sendBtn
      );

      this.head = h(
        'div',
        { class: 'ah-head' },
        h('span', { class: 'ah-spark', 'aria-hidden': 'true' }, '✦'),
        h('span', { class: 'ah-title' }, 'Ask AI'),
        h('span', { class: 'ah-grow' }),
        h('button', { class: 'ah-icon', type: 'button', title: 'Minimize', onclick: () => this.minimize() }, '–'),
        h('button', { class: 'ah-icon', type: 'button', title: 'Close (Esc)', onclick: () => this.close() }, '×')
      );

      this.el = h(
        'div',
        { class: 'ah-panel', role: 'dialog', 'aria-label': 'Ask AI' },
        this.head,
        h('div', { class: 'ah-quote', title: this.source.selection }, quoteText),
        this.thread,
        this.chips,
        this.form
      );

      this.bubble = h(
        'button',
        { class: 'ah-bubble', type: 'button', title: 'Show answer', onclick: () => this.restore() },
        '✦'
      );

      this.input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
          e.preventDefault();
          if (!this.port) this.submitInput();
        }
      });
      this.input.addEventListener('input', () => this.autosize());
      this.el.addEventListener('keydown', (e) => {
        e.stopPropagation(); // don't trigger the page's keyboard shortcuts while typing
        if (e.key === 'Escape') this.close();
      });
      this.el.addEventListener('keyup', (e) => e.stopPropagation());
      this.el.addEventListener('keypress', (e) => e.stopPropagation());
      this.el.addEventListener('pointerdown', () => this.focus());
      this.el.addEventListener('mouseup', () => this.offerQuoteFromAnswer());
      this.enableDrag();

      shadow.append(this.el, this.bubble);
      this.focus();
    }

    focus() {
      this.el.style.zIndex = String(++zCounter);
    }

    autosize() {
      this.input.style.height = 'auto';
      this.input.style.height = Math.min(this.input.scrollHeight, 120) + 'px';
    }

    submitInput() {
      const q = this.input.value.trim();
      if (!q) return;
      this.input.value = '';
      this.autosize();
      this.ask(q);
    }

    // Select text inside an answer -> "Ask AI" quotes it into this panel's input.
    offerQuoteFromAnswer() {
      setTimeout(() => {
        const sel = shadow.getSelection ? shadow.getSelection() : window.getSelection();
        if (!sel || sel.isCollapsed || !sel.rangeCount) return;
        const text = sel.toString().trim();
        const range = sel.getRangeAt(0);
        if (!text || !this.thread.contains(range.commonAncestorContainer)) return;
        showTrigger({
          text,
          anchor: rangeAnchor(range.cloneRange()),
          onPick: (t) => {
            const quoted = t.replace(/\s+/g, ' ').slice(0, 500);
            this.input.value = `About "${quoted}": `;
            this.autosize();
            this.input.focus();
            this.input.setSelectionRange(this.input.value.length, this.input.value.length);
            sel.removeAllRanges();
          },
        });
      }, 0);
    }

    enableDrag() {
      let start = null;
      this.head.addEventListener('pointerdown', (e) => {
        if (e.button !== 0 || e.target.closest('button')) return;
        start = { x: e.clientX, y: e.clientY, dx: this.dx, dy: this.dy };
        this.head.setPointerCapture(e.pointerId);
        this.el.classList.add('ah-dragging');
      });
      this.head.addEventListener('pointermove', (e) => {
        if (!start) return;
        this.dx = start.dx + e.clientX - start.x;
        this.dy = start.dy + e.clientY - start.y;
        this.position();
      });
      const end = () => {
        start = null;
        this.el.classList.remove('ah-dragging');
      };
      this.head.addEventListener('pointerup', end);
      this.head.addEventListener('pointercancel', end);
    }

    position() {
      const r = this.anchor.getRect();
      const vw = innerWidth;
      const vh = innerHeight;
      if (this.minimized) {
        const left = clamp(r.right + 4, 4, vw - 32);
        this.bubble.style.transform = `translate(${left}px, ${r.top - 6}px)`;
        return;
      }
      const w = this.el.offsetWidth || PANEL_WIDTH;
      const hgt = this.el.offsetHeight || 220;
      if (!this.placement) {
        const below = vh - r.bottom;
        this.placement = below >= Math.min(hgt, 360) + 16 || below >= r.top ? 'below' : 'above';
      }
      let top = this.placement === 'below' ? r.bottom + 10 : r.top - hgt - 10;
      let left = r.left;
      top += this.dy;
      left = clamp(left + this.dx, 8, Math.max(8, vw - w - 8));
      this.el.style.transform = `translate(${Math.round(left)}px, ${Math.round(top)}px)`;
    }

    minimize() {
      this.minimized = true;
      this.el.classList.add('ah-hidden');
      this.bubble.classList.add('ah-visible');
      this.position();
    }

    restore() {
      this.minimized = false;
      this.el.classList.remove('ah-hidden');
      this.bubble.classList.remove('ah-visible');
      this.focus();
      this.position();
      this.input.focus();
    }

    close() {
      this.stop();
      this.el.remove();
      this.bubble.remove();
      if (highlight && this.anchor.range) highlight.delete(this.anchor.range);
      panels.delete(this);
    }

    scrollThread() {
      const t = this.thread;
      // Only auto-scroll if the user is already near the bottom.
      if (t.scrollHeight - t.scrollTop - t.clientHeight < 80) t.scrollTop = t.scrollHeight;
    }

    addUserMessage(label) {
      this.thread.append(h('div', { class: 'ah-msg ah-user' }, label));
    }

    ask(question, label) {
      if (this.port) return;
      this.chips.remove();
      this.turns.push({ role: 'user', content: question });
      this.addUserMessage(label || question);

      const body = h('div', { class: 'ah-md' });
      const msg = h('div', { class: 'ah-msg ah-ai ah-streaming' }, body);
      this.thread.append(msg);
      body.append(h('span', { class: 'ah-dots' }, h('i'), h('i'), h('i')));
      this.scrollThread();

      let text = '';
      let renderQueued = false;
      const render = () => {
        renderQueued = false;
        body.innerHTML = MD.render(text);
        this.scrollThread();
        this.position();
      };

      let port;
      try {
        port = chrome.runtime.connect({ name: 'askhere:ask' });
      } catch {
        this.turns.pop();
        this.showError(msg, 'AskHere was updated or reloaded. Refresh this page to keep using it.', false, null);
        return;
      }
      this.port = port;
      this.setStreaming(true);

      const finish = () => {
        this.port = null;
        this.setStreaming(false);
        msg.classList.remove('ah-streaming');
      };

      port.onMessage.addListener((m) => {
        if (m.type === 'delta') {
          text += m.text;
          if (!renderQueued) {
            renderQueued = true;
            requestAnimationFrame(render);
          }
        } else if (m.type === 'done') {
          render();
          finish();
          port.disconnect();
          if (!text.trim()) {
            this.turns.pop();
            const why =
              m.stopReason === 'refusal'
                ? 'The model declined to answer this one.'
                : 'The model returned an empty answer.';
            this.showError(msg, why, false, question);
            return;
          }
          this.turns.push({ role: 'assistant', content: text });
          if (m.stopReason === 'refusal') {
            msg.append(h('div', { class: 'ah-note' }, 'The model stopped early and declined to continue.'));
          } else if (m.stopReason === 'max_tokens' || m.stopReason === 'length') {
            msg.append(h('div', { class: 'ah-note' }, 'Answer was cut off because it hit the length limit.'));
          }
          this.addActions(msg, () => text);
        } else if (m.type === 'error') {
          finish();
          port.disconnect();
          this.turns.pop();
          this.showError(msg, m.message, m.needsKey, question);
        }
      });
      port.onDisconnect.addListener(() => {
        if (this.port !== port) return;
        finish();
        this.turns.pop();
        this.showError(msg, 'Lost connection to AskHere. Refresh the page and try again.', false, question);
      });
      port.postMessage({ type: 'ask', source: this.source, turns: this.turns });
      this._streamText = () => text;
      this._streamMsg = msg;
    }

    stop() {
      if (!this.port) return;
      const port = this.port;
      this.port = null;
      port.disconnect();
      this.setStreaming(false);
      const msg = this._streamMsg;
      const text = this._streamText ? this._streamText() : '';
      msg?.classList.remove('ah-streaming');
      if (text.trim()) {
        this.turns.push({ role: 'assistant', content: text });
        msg.querySelector('.ah-md').innerHTML = MD.render(text);
        msg.append(h('div', { class: 'ah-note' }, 'Stopped.'));
        this.addActions(msg, () => text);
      } else {
        this.turns.pop();
        msg?.remove();
      }
    }

    setStreaming(on) {
      this.sendBtn.textContent = on ? '■' : '↑';
      this.sendBtn.title = on ? 'Stop' : 'Send (Enter)';
      this.sendBtn.classList.toggle('ah-stop', on);
      if (!on) this.input.focus();
    }

    addActions(msg, getText) {
      const copy = h('button', { class: 'ah-action', type: 'button' }, 'Copy');
      copy.addEventListener('click', async () => {
        try {
          await navigator.clipboard.writeText(getText());
          copy.textContent = 'Copied';
        } catch {
          copy.textContent = 'Copy failed';
        }
        setTimeout(() => (copy.textContent = 'Copy'), 1200);
      });
      msg.append(h('div', { class: 'ah-actions' }, copy));
    }

    showError(msg, message, needsKey, retryQuestion) {
      msg.classList.remove('ah-streaming');
      msg.classList.add('ah-error');
      const body = msg.querySelector('.ah-md');
      body.textContent = message;
      const actions = h('div', { class: 'ah-actions' });
      if (needsKey) {
        actions.append(
          h(
            'button',
            {
              class: 'ah-action',
              type: 'button',
              onclick: () => chrome.runtime.sendMessage({ type: 'askhere:open-options' }).catch(() => {}),
            },
            'Open settings'
          )
        );
      }
      if (retryQuestion) {
        actions.append(
          h(
            'button',
            {
              class: 'ah-action',
              type: 'button',
              onclick: () => {
                msg.previousElementSibling?.remove(); // the user bubble
                msg.remove();
                this.ask(retryQuestion);
              },
            },
            'Retry'
          )
        );
      }
      if (actions.childNodes.length) msg.append(actions);
      this.scrollThread();
    }
  }

  function openPanel(cap) {
    mount();
    const panel = new Panel(cap);
    panels.add(panel);
    panel.position();
    // Second pass once the browser has laid it out and knows its real size.
    requestAnimationFrame(() => {
      panel.position();
      panel.input.focus({ preventScroll: true });
    });
    window.getSelection()?.removeAllRanges();
    return panel;
  }

  // ---------- keep everything glued to its text ----------
  let frameQueued = false;
  function reposition() {
    if (frameQueued) return;
    frameQueued = true;
    requestAnimationFrame(() => {
      frameQueued = false;
      positionTrigger();
      for (const p of panels) p.position();
    });
  }
  addEventListener('scroll', reposition, { capture: true, passive: true });
  addEventListener('resize', reposition, { passive: true });
  // Pages like chat apps re-flow without scrolling (streaming text), so poll gently.
  setInterval(() => {
    if (panels.size || pending) reposition();
  }, 250);

  // ---------- selection events ----------
  function fromOurUI(e) {
    return e.composedPath().includes(host);
  }

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

  // Keyboard selection (Shift + arrows, Ctrl+A).
  document.addEventListener('keyup', (e) => {
    if (!e.shiftKey && e.key !== 'a') return;
    if (prefs.triggerMode !== 'button' || siteDisabled()) return;
    const cap = captureSelection();
    if (cap) showTrigger(cap);
  });

  document.addEventListener('mousedown', (e) => {
    if (!fromOurUI(e)) hideTrigger();
  });

  document.addEventListener('selectionchange', () => {
    if (!pending || pending.onPick) return;
    const sel = window.getSelection();
    const active = document.activeElement;
    const inputSel = isEditable(active) && active.selectionStart !== active.selectionEnd;
    if (!inputSel && (!sel || sel.isCollapsed)) hideTrigger();
  });

  // ---------- shortcut / context menu ----------
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg?.type !== 'askhere:open') return;
    hideTrigger();
    let cap = captureSelection();
    if (!cap && msg.text) cap = { text: msg.text, anchor: fixedAnchor(), context: '' };
    if (cap) openPanel(cap);
  });
})();
