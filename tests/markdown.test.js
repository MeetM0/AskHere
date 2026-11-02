import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../extension/lib/markdown.js';

const { render } = globalThis.AskHereMarkdown;

test('escapes raw HTML', () => {
  const out = render('<img src=x onerror=alert(1)> & <script>bad()</script>');
  assert.ok(!out.includes('<img'));
  assert.ok(!out.includes('<script'));
  assert.ok(out.includes('&lt;img'));
});

test('only allows http(s) links', () => {
  assert.match(render('[ok](https://example.com)'), /<a href="https:\/\/example.com"/);
  assert.ok(!render('[x](javascript:alert(1))').includes('<a'));
});

test('bold, italic, inline code', () => {
  const out = render('**bold** and *it* and `a<b`');
  assert.match(out, /<strong>bold<\/strong>/);
  assert.match(out, /<em>it<\/em>/);
  assert.match(out, /<code>a&lt;b<\/code>/);
});

test('does not treat snake_case as italics', () => {
  assert.ok(!render('use my_var_name here').includes('<em>'));
});

test('lists and headings', () => {
  const out = render('# Title\n\n- one\n- two\n\n1. a\n2. b');
  assert.match(out, /<h3>Title<\/h3>/);
  assert.match(out, /<ul><li>one<\/li><li>two<\/li><\/ul>/);
  assert.match(out, /<ol><li>a<\/li><li>b<\/li><\/ol>/);
});

test('fenced code is escaped and not formatted', () => {
  const out = render('```js\nconst a = **b** < c;\n```\nafter');
  assert.match(out, /<pre data-lang="js"><code>const a = \*\*b\*\* &lt; c;<\/code><\/pre>/);
  assert.match(out, /<p>after<\/p>/);
});

test('unterminated fence while streaming renders as code', () => {
  const out = render('Here:\n```py\nprint("hi")');
  assert.match(out, /<pre data-lang="py"><code>print\(&quot;hi&quot;\)<\/code><\/pre>/);
});
