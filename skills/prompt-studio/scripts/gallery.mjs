// Candidate gallery: one static HTML page that shows each recommended prompt
// with its sample images, full prompt text, source and license, so the user can
// compare and pick without a terminal that renders images.
import fs from "node:fs";
import path from "node:path";

const esc = (v) =>
  String(v ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

// Only web and local image references are rendered; anything else is dropped.
const safeImage = (u) =>
  /^(https?:\/\/|\.{0,2}\/|[\w.-]+\.(png|jpe?g|webp|gif|avif)$)/i.test(
    String(u || ""),
  )
    ? String(u)
    : null;

function candidateHtml(c, i) {
  const images = (c.images || [c.image]).map(safeImage).filter(Boolean);
  const [hero, ...rest] = images;
  const facts = [
    ["模型", c.model, c.modelProposed !== false],
    ["比例", c.ratio, c.ratioProposed !== false],
    ["分类", c.category, false],
  ].filter(([, v]) => v);
  const flags = [
    c.needReferenceImages ? "需要参考图" : "",
    c.hasPlaceholders ? "含占位符，需要替换" : "",
  ].filter(Boolean);
  const promptId = `prompt-${i}`;
  return `
<article class="cand${c.default ? " is-default" : ""}" id="c-${esc(c.id)}">
  <figure class="media">
    ${
      hero
        ? `<a href="${esc(hero)}" target="_blank" rel="noopener"><img src="${esc(hero)}" alt="${esc(c.title)} 的样图" loading="lazy" onerror="this.closest('figure').classList.add('broken')"></a>
    <figcaption class="broken-note">样图无法加载，视觉匹配度未验证</figcaption>`
        : `<figcaption class="broken-note always">没有样图，视觉匹配度未验证</figcaption>`
    }
    ${
      rest.length
        ? `<div class="thumbs">${rest
            .map(
              (u) =>
                `<a href="${esc(u)}" target="_blank" rel="noopener"><img src="${esc(u)}" alt="" loading="lazy" onerror="this.parentNode.remove()"></a>`,
            )
            .join("")}</div>`
        : ""
    }
  </figure>
  <div class="body">
    <header>
      <h2><span class="num">${i + 1}</span>${esc(c.title)}</h2>
      ${c.default ? `<span class="badge">默认推荐</span>` : ""}
    </header>
    ${c.fit ? `<p class="fit">${esc(c.fit)}</p>` : ""}
    ${
      facts.length || flags.length
        ? `<dl class="facts">${facts
            .map(
              ([k, v, proposed]) =>
                `<div><dt>${k}</dt><dd>${esc(v)}${proposed ? `<small>建议</small>` : ""}</dd></div>`,
            )
            .join(
              "",
            )}${flags.map((f) => `<div class="warn"><dd>${f}</dd></div>`).join("")}</dl>`
        : ""
    }
    ${
      c.adapted
        ? `<section class="prompt">
      <div class="prompt-head"><h3>改写后的提示词</h3><button type="button" data-copy="${promptId}-a">复制</button></div>
      <pre id="${promptId}-a">${esc(c.adapted)}</pre>
    </section>`
        : ""
    }
    <section class="prompt">
      <div class="prompt-head"><h3>${c.adapted ? "原始提示词" : "提示词原文"}</h3><button type="button" data-copy="${promptId}">复制</button></div>
      <pre id="${promptId}" class="${String(c.content || "").length > 900 ? "long" : ""}">${esc(c.content || "（原文缺失，运行 show " + c.id + " 查看）")}</pre>
      ${String(c.content || "").length > 900 ? `<button type="button" class="more" aria-expanded="false">展开全文</button>` : ""}
    </section>
    <footer class="credit">
      <span>#${esc(c.id)}</span>
      <span>${esc(c.source)}</span>
      <span>${esc(c.license)}</span>
    </footer>
  </div>
</article>`;
}

export function renderGallery({
  title,
  request,
  query,
  candidates,
  generatedAt,
}) {
  const when = new Date(generatedAt || Date.now()).toLocaleString("zh-CN", {
    hour12: false,
  });
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title || "提示词候选")}</title>
<style>
:root{
  --bg:oklch(98.4% .004 95);--surface:oklch(100% 0 0);--sunk:oklch(95.6% .006 95);
  --ink:oklch(24% .012 95);--ink-2:oklch(45% .012 95);--line:oklch(90% .008 95);
  --accent:oklch(52% .12 150);--accent-ink:oklch(99% .01 150);--accent-soft:oklch(94% .04 150);
  --warn:oklch(50% .12 60);--warn-soft:oklch(95% .04 75);
  --shadow:0 1px 2px oklch(20% .02 95/.06),0 8px 24px -12px oklch(20% .02 95/.14);
  color-scheme:light;
}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){
  --bg:oklch(19% .008 95);--surface:oklch(23% .008 95);--sunk:oklch(16.5% .008 95);
  --ink:oklch(93% .006 95);--ink-2:oklch(72% .01 95);--line:oklch(31% .01 95);
  --accent:oklch(74% .13 150);--accent-ink:oklch(20% .03 150);--accent-soft:oklch(30% .05 150);
  --warn:oklch(80% .12 75);--warn-soft:oklch(30% .05 70);
  --shadow:0 1px 2px oklch(0% 0 0/.3),0 10px 28px -14px oklch(0% 0 0/.6);
  color-scheme:dark;
}}
*{box-sizing:border-box}
html{-webkit-text-size-adjust:100%}
body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.6 system-ui,-apple-system,"PingFang SC","Microsoft YaHei",sans-serif;font-variant-numeric:tabular-nums}
::selection{background:var(--accent-soft);color:var(--ink)}
:focus-visible{outline:2px solid var(--accent);outline-offset:2px;border-radius:6px}
a{color:inherit;text-underline-offset:3px}
main{max-width:1120px;margin:0 auto;padding:40px 16px 72px}
.page-head{margin-bottom:28px}
.page-head h1{font-size:1.625rem;line-height:1.25;margin:0 0 8px;letter-spacing:-.02em;text-wrap:balance}
.page-head p{margin:0;color:var(--ink-2);max-width:70ch}
.page-head code{font:13px/1.5 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;background:var(--sunk);padding:1px 6px;border-radius:4px}
.list{display:grid;gap:20px}
.cand{display:grid;grid-template-columns:minmax(0,5fr) minmax(0,7fr);background:var(--surface);border-radius:14px;box-shadow:var(--shadow);overflow:hidden}
.cand.is-default{outline:2px solid var(--accent);outline-offset:-2px}
.media{margin:0;background:var(--sunk);display:flex;flex-direction:column;gap:8px;padding:12px;min-height:240px}
.media > a{display:block;flex:1;min-height:0}
.media img{display:block;width:100%;height:100%;max-height:460px;object-fit:contain;border-radius:8px}
.thumbs{display:flex;gap:8px}
.thumbs a{width:64px;height:64px;flex:none}
.thumbs img{width:100%;height:100%;object-fit:cover;border-radius:6px}
.broken-note{display:none;margin:auto;color:var(--ink-2);font-size:13px;text-align:center}
.media.broken > a{display:none}.media.broken .broken-note,.broken-note.always{display:block}
.body{padding:20px 24px;display:flex;flex-direction:column;gap:14px;min-width:0}
.body header{display:flex;align-items:flex-start;justify-content:space-between;gap:12px}
.body h2{font-size:1.125rem;line-height:1.35;margin:0;display:flex;gap:10px;text-wrap:balance}
.num{color:var(--ink-2);font-weight:500}
.badge{flex:none;background:var(--accent);color:var(--accent-ink);font-size:12px;font-weight:600;padding:3px 10px;border-radius:999px}
.fit{margin:0;max-width:70ch}
.facts{display:flex;flex-wrap:wrap;gap:6px 16px;margin:0;font-size:13px}
.facts div{display:flex;gap:6px;align-items:baseline}
.facts dt{color:var(--ink-2)}
.facts dd{margin:0;font-weight:500}
.facts small{margin-left:4px;color:var(--ink-2);font-weight:400}
.facts .warn dd{color:var(--warn);background:var(--warn-soft);padding:0 8px;border-radius:999px;font-weight:500}
.prompt-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:6px}
.prompt h3{font-size:13px;font-weight:600;margin:0;color:var(--ink-2)}
pre{margin:0;background:var(--sunk);border-radius:8px;padding:12px 14px;font:12.5px/1.6 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;white-space:pre-wrap;word-break:break-word;max-height:none}
pre.long{max-height:220px;overflow:hidden;mask-image:linear-gradient(#000 70%,transparent)}
pre.long.open{max-height:none;mask-image:none}
button{font:inherit;font-size:13px;color:var(--ink);background:var(--surface);border:1px solid var(--line);border-radius:8px;padding:4px 12px;cursor:pointer;transition:background-color .15s ease,border-color .15s ease}
button:hover{background:var(--sunk);border-color:var(--ink-2)}
button.done{border-color:var(--accent);color:var(--accent)}
.more{margin-top:8px}
.credit{display:flex;flex-wrap:wrap;gap:4px 14px;margin-top:auto;padding-top:10px;border-top:1px solid var(--line);font-size:12px;color:var(--ink-2)}
.empty{background:var(--surface);border-radius:14px;padding:32px;color:var(--ink-2);box-shadow:var(--shadow)}
@media (max-width:760px){
  main{padding-top:28px}
  .cand{grid-template-columns:1fr}
  .media{min-height:0}
  .media img{max-height:340px}
  .body{padding:16px}
}
</style>
</head>
<body>
<main>
  <div class="page-head">
    <h1>${esc(title || "提示词候选")}</h1>
    <p>${request ? `需求：${esc(request)}。` : ""}${query ? `检索词 <code>${esc(query)}</code>。` : ""}共 ${candidates.length} 个候选，生成于 ${esc(when)}。回到对话里告诉我选哪一个（填编号），或者说出想调整的地方。</p>
  </div>
  <div class="list">
    ${
      candidates.length
        ? candidates.map(candidateHtml).join("")
        : `<p class="empty">这次检索没有合适的候选。换一组描述画面的关键词再试，或者让我直接写一版提示词。</p>`
    }
  </div>
</main>
<script>
document.addEventListener("click", async (e) => {
  const copy = e.target.closest("[data-copy]");
  if (copy) {
    const text = document.getElementById(copy.dataset.copy).textContent;
    try { await navigator.clipboard.writeText(text); copy.textContent = "已复制"; }
    catch { copy.textContent = "复制失败，请手动选中"; }
    copy.classList.add("done");
    setTimeout(() => { copy.textContent = "复制"; copy.classList.remove("done"); }, 1600);
  }
  const more = e.target.closest(".more");
  if (more) {
    const pre = more.previousElementSibling;
    const open = pre.classList.toggle("open");
    more.textContent = open ? "收起" : "展开全文";
    more.setAttribute("aria-expanded", String(open));
  }
});
</script>
</body>
</html>
`;
}

// Fill each picked candidate from the library entry, so the page shows the full
// prompt even when the caller only passed ids and fit lines.
export function buildCandidates(picks, entries) {
  const byId = new Map(entries.map((e) => [String(e.id), e]));
  const missing = [];
  const candidates = [];
  for (const p of picks) {
    const e = byId.get(String(p.id));
    if (!e && !p.content) {
      missing.push(p.id);
      continue;
    }
    const content = String(p.content ?? e?.content ?? "");
    candidates.push({
      ...p,
      title: p.title || e?.title || `#${p.id}`,
      images: p.images || e?.sourceMedia || (p.image ? [p.image] : []),
      category: p.category || e?.category,
      content,
      needReferenceImages:
        p.needReferenceImages ?? Boolean(e?.needReferenceImages),
      hasPlaceholders:
        p.hasPlaceholders ??
        (/\{argument\b/i.test(content) || /\{[a-z_]+=/i.test(content)),
      source: p.source || e?.source || "unknown source",
      license: p.license || e?.license || "license unknown",
    });
  }
  if (!candidates.some((c) => c.default) && candidates[0])
    candidates[0].default = true;
  return { candidates, missing };
}

export function writeGallery({ file, ...data }) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, renderGallery(data));
  return file;
}
