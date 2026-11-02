// AskHere's floating window (Document Picture-in-Picture).
// A PiP window floats above everything, including fullscreen apps on macOS,
// and can be dragged anywhere. It shows the question and Claude's / ChatGPT's
// answer, read from your own logged-in chat running in a background tab, and
// lets you type follow-ups.
// Classic content script: exposes globalThis.AskHerePip.

(function () {
  const S = () => globalThis.AskHereSanitize;
  let current = null;

  const CSS = `
    :root { --bg:#fff; --fg:#1c1b1f; --muted:#6b6870; --border:rgba(20,16,30,.12); --soft:#f4f2f7;
      --accent:#c2612c; --accent-fg:#fff; --user:#fbeee6; --code:#f2f0f5; --err:#b3261e; color-scheme: light dark; }
    @media (prefers-color-scheme: dark) {
      :root { --bg:#222026; --fg:#eceaf0; --muted:#a29fa8; --border:rgba(255,255,255,.12); --soft:#2d2a32;
        --accent:#e07a43; --accent-fg:#1a1410; --user:#3a2c24; --code:#2d2a32; --err:#f2b8b5; }
    }
    * { box-sizing: border-box; }
    html, body { height: 100%; margin: 0; }
    body { display: flex; flex-direction: column; background: var(--bg); color: var(--fg);
      font: 14px/1.5 ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif; }
    button { font: inherit; color: inherit; cursor: pointer; }
    .bar { flex: none; display: flex; align-items: center; gap: 4px; height: 36px; padding: 0 6px 0 12px;
      border-bottom: 1px solid var(--border); font-weight: 600; font-size: 13px; }
    .spark { color: var(--accent); }
    .ai { color: var(--muted); font-weight: 500; }
    .grow { flex: 1; }
    .icon { width: 28px; height: 28px; border: 0; border-radius: 7px; background: transparent; color: var(--muted); font-size: 14px; }
    .icon:hover { background: var(--soft); color: var(--fg); }
    .thread { flex: 1; min-height: 0; overflow-y: auto; padding: 8px 12px; overscroll-behavior: contain; }
    .quote { margin: 2px 0 8px; padding: 2px 0 2px 10px; border-left: 3px solid var(--accent); color: var(--muted);
      font-size: 12.5px; display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; }
    .user { width: fit-content; max-width: 85%; margin: 8px 0 8px auto; padding: 6px 10px; border-radius: 10px;
      background: var(--user); white-space: pre-wrap; overflow-wrap: anywhere; }
    .answer { margin: 6px 0 12px; overflow-wrap: anywhere; }
    .answer > :first-child { margin-top: 0; } .answer > :last-child { margin-bottom: 0; }
    .answer p, .answer ul, .answer ol, .answer pre, .answer blockquote, .answer table { margin: 0 0 8px; }
    .answer ul, .answer ol { padding-left: 20px; }
    .answer h1, .answer h2, .answer h3, .answer h4, .answer h5, .answer h6 { font-size: 14.5px; margin: 10px 0 4px; }
    .answer code { padding: 1px 4px; border-radius: 4px; background: var(--code);
      font: 12.5px/1.45 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
    .answer pre { padding: 8px 10px; border-radius: 8px; background: var(--code); overflow-x: auto; }
    .answer pre code { padding: 0; background: none; }
    .answer blockquote { padding-left: 10px; border-left: 3px solid var(--border); color: var(--muted); }
    .answer a { color: var(--accent); }
    .answer table { border-collapse: collapse; } .answer td, .answer th { border: 1px solid var(--border); padding: 3px 6px; }
    .status { color: var(--muted); font-size: 13px; }
    .status.err { color: var(--err); }
    .actions { display: flex; gap: 6px; margin-top: 4px; }
    .action { padding: 2px 9px; border: 1px solid var(--border); border-radius: 6px; background: transparent;
      color: var(--muted); font-size: 12px; }
    .action:hover { color: var(--fg); background: var(--soft); }
    .dots { display: inline-flex; gap: 4px; padding: 6px 0; }
    .dots i { width: 6px; height: 6px; border-radius: 50%; background: var(--muted); animation: blink 1s infinite ease-in-out; }
    .dots i:nth-child(2) { animation-delay: .15s; } .dots i:nth-child(3) { animation-delay: .3s; }
    @keyframes blink { 0%, 80%, 100% { opacity: .25; } 40% { opacity: 1; } }
    form { flex: none; display: flex; align-items: flex-end; gap: 6px; margin: 6px 8px 8px; padding: 4px 4px 4px 10px;
      border: 1px solid var(--border); border-radius: 11px; background: var(--soft); }
    form:focus-within { border-color: var(--accent); }
    textarea { flex: 1; min-height: 24px; max-height: 110px; padding: 4px 0; border: 0; outline: none; resize: none;
      background: transparent; color: var(--fg); font: inherit; }
    .send { flex: none; width: 30px; height: 30px; border: 0; border-radius: 8px; background: var(--accent);
      color: var(--accent-fg); font-weight: 700; }
    .send:disabled { opacity: .45; cursor: default; }
    @media (prefers-reduced-motion: reduce) { * { animation: none !important; } }
  `;

  function supported() {
    return typeof window.documentPictureInPicture?.requestWindow === 'function';
  }

  /**
   * Open (or reuse) the floating window. When it isn't open yet this must be
   * called while handling a click/keypress (browsers require a user action).
   */
  async function open(opts) {
    if (current && !current.win.closed) {
      current.setHandlers(opts);
      return current;
    }
    const win = await window.documentPictureInPicture.requestWindow({
      width: 380,
      height: 520,
      disallowReturnToOpener: true,
    });
    current = build(win, opts);
    return current;
  }

  function build(win, opts) {
    const doc = win.document;
    let handlers = opts;
    const h = (tag, attrs = {}, ...kids) => {
      const el = doc.createElement(tag);
      for (const [k, v] of Object.entries(attrs)) {
        if (k === 'class') el.className = v;
        else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
        else el.setAttribute(k, v);
      }
      for (const k of kids.flat()) if (k != null) el.append(k);
      return el;
    };

    try {
      const sheet = new win.CSSStyleSheet();
      sheet.replaceSync(CSS);
      doc.adoptedStyleSheets = [sheet];
    } catch {
      /* unstyled but usable */
    }
    doc.title = 'AskHere';

    const aiLabel = h('span', { class: 'ai' });
    const thread = h('div', { class: 'thread', 'aria-live': 'polite' });
    const input = h('textarea', { rows: '1', placeholder: 'Ask a follow-up…', 'aria-label': 'Follow-up question' });
    const sendBtn = h('button', { class: 'send', type: 'submit', title: 'Send (Enter)' }, '↑');
    const form = h('form', {}, input, sendBtn);

    doc.body.replaceChildren(
      h(
        'div',
        { class: 'bar' },
        h('span', { class: 'spark', 'aria-hidden': 'true' }, '✦'),
        h('span', {}, 'AskHere'),
        aiLabel,
        h('span', { class: 'grow' }),
        h('button', { class: 'icon', type: 'button', title: 'Show the full chat', 'data-act': 'show', onclick: () => handlers.onShowTab?.() }, '⤢'),
        h('button', { class: 'icon', type: 'button', title: 'Close', 'data-act': 'close', onclick: () => win.close() }, '✕')
      ),
      thread,
      form
    );

    let answerEl = null;
    let busy = false;

    const scrollDown = () => {
      if (thread.scrollHeight - thread.scrollTop - thread.clientHeight < 120) thread.scrollTop = thread.scrollHeight;
    };

    const setBusy = (on) => {
      busy = on;
      sendBtn.disabled = on;
    };

    function submit() {
      const text = input.value.trim();
      if (!text || busy) return;
      input.value = '';
      autosize();
      api.addQuestion(text);
      handlers.onFollowup?.(text);
    }
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      submit();
    });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
        e.preventDefault();
        submit();
      }
    });
    const autosize = () => {
      input.style.height = 'auto';
      input.style.height = Math.min(input.scrollHeight, 110) + 'px';
    };
    input.addEventListener('input', autosize);

    win.addEventListener('pagehide', () => {
      if (current?.win === win) current = null;
      handlers.onClose?.();
    });

    const api = {
      win,
      setHandlers(next) {
        handlers = next;
      },
      /** Start a new chat about `quote`. */
      newChat({ aiName, quote }) {
        aiLabel.textContent = '· ' + aiName;
        thread.replaceChildren();
        if (quote) thread.append(h('div', { class: 'quote', title: quote }, quote.replace(/\s+/g, ' ')));
      },
      addQuestion(text) {
        thread.append(h('div', { class: 'user' }, text));
        answerEl = h('div', { class: 'answer' }, h('span', { class: 'dots' }, h('i'), h('i'), h('i')));
        thread.append(answerEl);
        setBusy(true);
        scrollDown();
      },
      /** Show (part of) the answer; `tree` comes from AskHereSanitize.toTree. */
      setAnswer(tree, done) {
        if (!answerEl) {
          // e.g. the answer arrives after a "log in" message was shown
          answerEl = thread.appendChild(h('div', { class: 'answer' }));
          setBusy(true);
        }
        answerEl.replaceChildren(S().fromTree(tree, doc));
        if (done) {
          setBusy(false);
          const text = S().treeText(tree).trim();
          const copy = h('button', { class: 'action', type: 'button' }, 'Copy');
          copy.addEventListener('click', async () => {
            try {
              await win.navigator.clipboard.writeText(text);
              copy.textContent = 'Copied';
            } catch {
              copy.textContent = 'Copy failed';
            }
            setTimeout(() => (copy.textContent = 'Copy'), 1200);
          });
          answerEl.after(h('div', { class: 'actions' }, copy));
          answerEl = null;
          input.focus();
        }
        scrollDown();
      },
      /** Problems and hints: kind = 'login' | 'no-answer' | 'closed' | 'error'. */
      setStatus(kind, text) {
        const box = answerEl || thread.appendChild(h('div', { class: 'answer' }));
        const actions = h('div', { class: 'actions' });
        if (kind === 'login' || kind === 'no-answer') {
          actions.append(
            h('button', { class: 'action', type: 'button', onclick: () => handlers.onShowTab?.() }, kind === 'login' ? 'Open the chat to log in' : 'Show the full chat')
          );
        }
        box.replaceChildren(h('div', { class: 'status' + (kind === 'error' || kind === 'closed' ? ' err' : '') }, text));
        if (actions.childNodes.length) box.append(actions);
        // After logging in, the answer will take this message's place.
        answerEl = kind === 'login' ? box : null;
        setBusy(false);
        scrollDown();
      },
      focusInput() {
        input.focus();
      },
    };
    return api;
  }

  globalThis.AskHerePip = {
    supported,
    open,
    current: () => (current && !current.win.closed ? current : null),
  };
})();
