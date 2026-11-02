// Tiny, safe Markdown -> HTML renderer for AI answers.
// Everything is HTML-escaped first; only a small whitelist of constructs is
// turned back into tags. Links are limited to http(s). Works on partial
// (still-streaming) text, e.g. an unclosed ``` fence renders as code.
//
// Loaded as a classic content script (exposes globalThis.AskHereMarkdown) and
// importable from Node tests.

(function () {
  function escapeHtml(s) {
    return s
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function inline(text) {
    const codes = [];
    // Pull out inline code first so its contents are left alone.
    let s = text.replace(/`([^`\n]+)`/g, (_, c) => {
      codes.push(c);
      return `\u0000${codes.length - 1}\u0000`;
    });
    s = escapeHtml(s);
    s = s.replace(/\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/g, (_, label, url) => {
      return `<a href="${url}" target="_blank" rel="noopener noreferrer">${label}</a>`;
    });
    s = s.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
    s = s.replace(/__([^_\n]+)__/g, '<strong>$1</strong>');
    s = s.replace(/(^|[^*\w])\*([^*\n]+)\*(?!\w)/g, '$1<em>$2</em>');
    s = s.replace(/(^|[^_\w])_([^_\n]+)_(?!\w)/g, '$1<em>$2</em>');
    s = s.replace(/~~([^~\n]+)~~/g, '<del>$1</del>');
    s = s.replace(/\u0000(\d+)\u0000/g, (_, i) => `<code>${escapeHtml(codes[+i])}</code>`);
    return s;
  }

  function renderBlocks(text) {
    const lines = text.split('\n');
    const out = [];
    let para = [];
    let list = null; // { type: 'ul'|'ol', items: [] }
    let quote = [];

    const flushPara = () => {
      if (para.length) out.push(`<p>${para.map(inline).join('<br>')}</p>`);
      para = [];
    };
    const flushList = () => {
      if (list) out.push(`<${list.type}>${list.items.map((i) => `<li>${inline(i)}</li>`).join('')}</${list.type}>`);
      list = null;
    };
    const flushQuote = () => {
      if (quote.length) out.push(`<blockquote>${quote.map(inline).join('<br>')}</blockquote>`);
      quote = [];
    };
    const flushAll = () => {
      flushPara();
      flushList();
      flushQuote();
    };

    for (const line of lines) {
      let m;
      if (!line.trim()) {
        flushAll();
      } else if ((m = line.match(/^(#{1,6})\s+(.*)$/))) {
        flushAll();
        const level = Math.min(m[1].length + 2, 6); // keep headings small in a popup
        out.push(`<h${level}>${inline(m[2])}</h${level}>`);
      } else if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) {
        flushAll();
        out.push('<hr>');
      } else if ((m = line.match(/^\s*[-*+]\s+(.*)$/))) {
        flushPara();
        flushQuote();
        if (!list || list.type !== 'ul') {
          flushList();
          list = { type: 'ul', items: [] };
        }
        list.items.push(m[1]);
      } else if ((m = line.match(/^\s*\d+[.)]\s+(.*)$/))) {
        flushPara();
        flushQuote();
        if (!list || list.type !== 'ol') {
          flushList();
          list = { type: 'ol', items: [] };
        }
        list.items.push(m[1]);
      } else if ((m = line.match(/^>\s?(.*)$/))) {
        flushPara();
        flushList();
        quote.push(m[1]);
      } else if (list && /^\s{2,}\S/.test(line)) {
        // continuation of the previous list item
        list.items[list.items.length - 1] += ' ' + line.trim();
      } else {
        flushList();
        flushQuote();
        para.push(line);
      }
    }
    flushAll();
    return out.join('');
  }

  function render(md) {
    const src = String(md || '').replace(/\r\n?/g, '\n');
    const parts = [];
    const fence = /^```([\w+-]*)[^\n]*\n([\s\S]*?)(?:^```[ \t]*$|$(?![\s\S]))/gm;
    let last = 0;
    let m;
    while ((m = fence.exec(src))) {
      if (m.index === fence.lastIndex) fence.lastIndex++;
      parts.push(renderBlocks(src.slice(last, m.index)));
      const lang = m[1] ? ` data-lang="${escapeHtml(m[1])}"` : '';
      const code = m[2].replace(/\n$/, '');
      parts.push(`<pre${lang}><code>${escapeHtml(code)}</code></pre>`);
      last = fence.lastIndex;
    }
    parts.push(renderBlocks(src.slice(last)));
    return parts.join('');
  }

  const api = { render, escapeHtml };
  globalThis.AskHereMarkdown = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
