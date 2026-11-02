// Turns an AI answer (from claude.ai / chatgpt.com) into a small, safe tree of
// plain data, and builds it back into DOM elsewhere. Only basic formatting
// survives; scripts, buttons, images, event handlers, styles and classes are
// dropped. No HTML strings are ever parsed or assigned (works on pages that
// enforce Trusted Types / strict CSP).
//
// Tree format: a node is either a string (text) or [tag, children, href?].
// Classic script: exposes globalThis.AskHereSanitize.

(function () {
  const KEEP = new Set([
    'p', 'br', 'ul', 'ol', 'li', 'pre', 'code', 'strong', 'b', 'em', 'i', 'u', 's', 'del',
    'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote', 'a', 'hr', 'sub', 'sup', 'kbd',
    'table', 'thead', 'tbody', 'tr', 'th', 'td', 'div',
  ]);
  // Removed together with everything inside them.
  const DROP = new Set([
    'script', 'style', 'template', 'noscript', 'iframe', 'object', 'embed', 'svg', 'math',
    'button', 'input', 'textarea', 'select', 'form', 'img', 'picture', 'video', 'audio',
    'canvas', 'link', 'meta', 'head', 'title',
  ]);
  const MAX_NODES = 20000;

  /** DOM node -> safe tree (array of children). */
  function toTree(source) {
    let budget = MAX_NODES;
    const walk = (node, out) => {
      if (--budget < 0) return;
      if (node.nodeType === 3) {
        if (node.nodeValue) out.push(node.nodeValue);
        return;
      }
      if (node.nodeType !== 1) return;
      const tag = node.tagName.toLowerCase();
      if (DROP.has(tag)) return;
      if (node.getAttribute('aria-hidden') === 'true' || node.hidden) return;
      if (KEEP.has(tag)) {
        const kids = [];
        for (const c of node.childNodes) walk(c, kids);
        const entry = [tag, kids];
        if (tag === 'a') {
          const href = node.getAttribute('href') || '';
          if (/^https?:\/\//i.test(href)) entry.push(href);
        }
        out.push(entry);
      } else {
        // Unknown wrappers (span, section, custom elements…) are unwrapped.
        for (const c of node.childNodes) walk(c, out);
      }
    };
    const out = [];
    for (const c of source.childNodes) walk(c, out);
    return out;
  }

  /** Safe tree -> DocumentFragment in `doc`. Validates again (never trusts input). */
  function fromTree(tree, doc) {
    const frag = doc.createDocumentFragment();
    let budget = MAX_NODES;
    const build = (items, parent, depth) => {
      if (!Array.isArray(items) || depth > 60) return;
      for (const item of items) {
        if (--budget < 0) return;
        if (typeof item === 'string') {
          parent.appendChild(doc.createTextNode(item));
        } else if (Array.isArray(item) && typeof item[0] === 'string') {
          const tag = item[0].toLowerCase();
          const badLink = tag === 'a' && !(typeof item[2] === 'string' && /^https?:\/\//i.test(item[2]));
          if (!KEEP.has(tag) || badLink) {
            build(item[1], parent, depth + 1);
            continue;
          }
          const el = doc.createElement(tag);
          if (tag === 'a' && typeof item[2] === 'string' && /^https?:\/\//i.test(item[2])) {
            el.setAttribute('href', item[2]);
            el.setAttribute('target', '_blank');
            el.setAttribute('rel', 'noopener noreferrer');
          }
          build(item[1], el, depth + 1);
          parent.appendChild(el);
        }
      }
    };
    build(tree, frag, 0);
    return frag;
  }

  /** Plain text of a tree (list of nodes), for copy and comparisons. */
  function treeText(nodes) {
    if (!Array.isArray(nodes)) return '';
    let out = '';
    for (const n of nodes) {
      if (typeof n === 'string') out += n;
      else if (Array.isArray(n)) {
        const [tag, kids] = n;
        if (tag === 'br') out += '\n';
        else out += treeText(kids) + (/^(p|div|li|h\d|pre|blockquote|tr)$/.test(tag) ? '\n' : '');
      }
    }
    return out;
  }

  globalThis.AskHereSanitize = { toTree, fromTree, treeText };
})();
