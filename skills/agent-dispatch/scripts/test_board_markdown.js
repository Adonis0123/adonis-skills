// Worker reports render as Markdown through the vendored markdown-it; nothing executable survives.
const fs = require('node:fs'), vm = require('node:vm'), assert = require('node:assert/strict');
const context = {};
vm.createContext(context);
vm.runInContext(fs.readFileSync(__dirname + '/vendor/markdown-it-15.0.3.min.js', 'utf8'), context);
vm.runInContext(fs.readFileSync(__dirname + '/board_markdown.js', 'utf8'), context);
const md = text => context.markdownToHtml(text);

const report = md('## Q1 现成方案\n\n| 项目 | 星数 |\n|---|--:|\n| a | 1 |\n\n- 一\n- `二`\n\n```js\nlet a = 1 < 2\n```\n\n[官网](https://example.com/?a=1&b=2)');
for (const piece of ['<h2>Q1 现成方案</h2>', '<table>', '<th style="text-align:right">星数</th>', '<li><code>二</code></li>',
  '<pre><code class="language-js">let a = 1 &lt; 2', '<a href="https://example.com/?a=1&amp;b=2" rel="noreferrer">官网</a>'])
  assert.ok(report.includes(piece), piece);
console.log('PASS: tables, headings, lists, code and links');

for (const attack of ['<script>alert(1)</script>', '<img src=x onerror=alert(1)>', '<a href="javascript:alert(1)">x</a>',
  '<div onclick="x()">raw</div>', '<iframe src="https://evil"></iframe>', '<style>body{display:none}</style>']) {
  const out = md(attack);
  assert.ok(!/<(script|img|a|div|iframe|style)\b/i.test(out), out);
  assert.ok(out.includes('&lt;'), 'raw HTML is shown as text: ' + out);
}
for (const link of ['[x](javascript:alert(1))', '[x](JaVaScRiPt:alert(1))', '[x](&#106;avascript:alert(1))', '[x](java\tscript:alert(1))',
  '[x](vbscript:msgbox(1))', '[x](data:text/html;base64,PHNjcmlwdD4=)', '![i](data:image/svg+xml;base64,PHN2Zz4=)', '<javascript:alert(1)>', '[x](file:///etc/passwd)'])
  assert.ok(!/<(a|img)\b/.test(md(link)), link + ' -> ' + md(link));
console.log('PASS: script tags, event handlers, raw HTML and javascript:/data:/file: links never become markup');

assert.equal(context.markdownAllowed('<p onclick="x">a</p>'), false, 'unknown attribute');
assert.equal(context.markdownAllowed('<svg></svg>'), false, 'unknown tag');
assert.equal(context.markdownAllowed('<a href="javascript:x">a</a>'), false, 'unsafe href');
assert.equal(context.markdownAllowed('<p style="color:red">a</p>'), false, 'free style');
assert.equal(context.markdownAllowed('<p>a</p>'), true);
console.log('PASS: the allow-list rejects anything markdown-it would not emit safely');

// Without the library (or on a rejected render) the element keeps its escaped text.
const bare = {}; vm.createContext(bare); vm.runInContext(fs.readFileSync(__dirname + '/board_markdown.js', 'utf8'), bare);
assert.equal(bare.markdownToHtml('# x'), null);
const el = {textContent: '# 标题', attrs: {}, classList: {add(c) { el.plain = c; }}, setAttribute(k) { el.attrs[k] = true; }};
bare.renderMarkdownIn({querySelectorAll: () => [el]});
assert.equal(el.textContent, '# 标题'); assert.equal(el.plain, 'md-plain'); assert.ok(el.attrs['data-rendered']);
console.log('PASS: plain-text fallback');
