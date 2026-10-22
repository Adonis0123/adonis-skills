// Worker reports as Markdown: vendored markdown-it with raw HTML off, then an allow-list check.
// Anything the check rejects is shown as plain text, never as HTML.
const MD_TAGS = new Set(['p', 'br', 'hr', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'strong', 'em', 's', 'code', 'pre',
  'blockquote', 'ul', 'ol', 'li', 'a', 'img', 'table', 'thead', 'tbody', 'tr', 'th', 'td']);
const MD_ATTRS = new Set(['href', 'src', 'alt', 'title', 'class', 'start', 'style', 'target', 'rel']);
let markdownEngine = null;

function safeUrl(url) {
  const value = String(url).replace(/&amp;/g, '&').replace(/[\u0000- ]/g, '');
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(value);
  return !scheme || ['http', 'https', 'mailto'].includes(scheme[1].toLowerCase());
}

function markdownAllowed(markup) {
  const tag = /<\/?([a-zA-Z][a-zA-Z0-9]*)((?:\s+[a-zA-Z-]+="[^"<>]*")*)\s*\/?>/g;
  let rest = markup;
  for (const match of markup.matchAll(tag)) {
    if (!MD_TAGS.has(match[1].toLowerCase())) return false;
    for (const [, name, value] of match[2].matchAll(/\s+([a-zA-Z-]+)="([^"]*)"/g)) {
      const key = name.toLowerCase();
      if (!MD_ATTRS.has(key)) return false;
      if ((key === 'href' || key === 'src') && !safeUrl(value)) return false;
      if (key === 'style' && !/^text-align:(left|right|center)$/.test(value)) return false;
      if (key === 'class' && !/^language-[\w+-]+$/.test(value)) return false;
    }
    rest = rest.replace(match[0], '');
  }
  return !/[<>]/.test(rest); // every remaining angle bracket would be an unparsed tag
}

function markdownToHtml(source) {
  if (typeof markdownit !== 'function') return null;
  if (!markdownEngine) {
    markdownEngine = markdownit({html: false, linkify: false, typographer: false, breaks: true})  // a summary's lines stay lines;
    const validate = markdownEngine.validateLink;
    markdownEngine.validateLink = url => validate(url) && safeUrl(url);
    markdownEngine.renderer.rules.link_open = (tokens, index, options, env, self) => {
      // Same tab: embedded browsers such as Orca's refuse popups, and Back returns to the board.
      tokens[index].attrSet('rel', 'noreferrer');
      return self.renderToken(tokens, index, options);
    };
  }
  try {
    const markup = markdownEngine.render(String(source));
    return markdownAllowed(markup) ? markup : null;
  } catch (_) { return null; }
}

// Elements carry their Markdown as escaped text, so a page without JavaScript still reads.
function renderMarkdownIn(root) {
  for (const el of Array.from(root.querySelectorAll ? root.querySelectorAll('[data-md]') : [])) {
    if (el.mdSource !== undefined) continue;
    const source = el.textContent;
    const markup = markdownToHtml(source);
    el.mdSource = source;
    if (markup !== null) el.innerHTML = markup;
    else el.classList?.add('md-plain');
    el.setAttribute('data-rendered', '');
  }
}
if (typeof document !== 'undefined' && document.querySelectorAll) renderMarkdownIn(document);
