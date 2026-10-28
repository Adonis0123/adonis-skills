// Candidate gallery: one HTML page that shows each recommended prompt with its
// sample images, an editable prompt, source and license. Served with `--serve`,
// a click on 选这个 sends the pick (and any edit) straight back to the agent;
// opened as a file, the same click copies a reply to paste into the chat.
import fs from "node:fs";
import http from "node:http";
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
  // Only what the user can act on: the ratio, and a reference photo they must supply.
  const facts = [["比例", c.ratio]].filter(([, v]) => v);
  const flags = [c.needReferenceImages ? "需要你提供参考图" : ""].filter(
    Boolean,
  );
  const prompt = c.adapted || c.content || "";
  return `
<article class="cand${c.default ? " is-default" : ""}" data-id="${esc(c.id)}" data-num="${i + 1}">
  <figure class="media">
    ${
      hero
        ? `<a href="${esc(hero)}" target="_blank" rel="noopener" title="看大图"><img src="${esc(hero)}" alt="${esc(c.title)} 的样图" loading="lazy" onerror="this.closest('figure').classList.add('broken')"></a>
    <figcaption class="broken-note">样图加载不出来</figcaption>`
        : `<figcaption class="broken-note always">这个案例没有样图</figcaption>`
    }
    ${
      rest.length
        ? `<div class="thumbs">${rest
            .map(
              (u) =>
                `<a href="${esc(u)}" target="_blank" rel="noopener" title="看大图"><img src="${esc(u)}" alt="" loading="lazy" onerror="this.parentNode.remove()"></a>`,
            )
            .join("")}</div>`
        : ""
    }
  </figure>
  <div class="body">
    <header>
      <span class="num">${i + 1}</span>
      <h2>${esc(c.title)}</h2>
      ${c.default ? `<span class="badge">推荐</span>` : ""}
    </header>
    ${c.fit ? `<p class="fit">${esc(c.fit)}</p>` : ""}
    ${
      facts.length || flags.length
        ? `<p class="facts">${facts
            .map(([k, v]) => `<span>${k} <b>${esc(v)}</b></span>`)
            .join(
              "",
            )}${flags.map((f) => `<span class="warn">${f}</span>`).join("")}</p>`
        : ""
    }
    <label class="prompt">
      <span class="prompt-head"><span>提示词，可以直接改</span><button type="button" class="link reset" hidden>恢复</button></span>
      <textarea spellcheck="false" rows="6">${esc(prompt)}</textarea>
    </label>
    ${
      c.adapted && c.content
        ? `<details class="orig"><summary>看案例的原始提示词</summary><pre>${esc(c.content)}</pre></details>`
        : ""
    }
    <div class="actions">
      <button type="button" class="pick">选这个</button>
      <span class="credit">#${esc(c.id)} · ${esc(c.source)} · ${esc(c.license)}</span>
    </div>
  </div>
</article>`;
}

export function renderGallery({ title, request, candidates, runId }) {
  const key = esc(runId || title || "gallery");
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title || "选一个方向")}</title>
<style>
:root{
  --bg:oklch(98.4% .004 95);--surface:oklch(100% 0 0);--sunk:oklch(95.6% .006 95);
  --ink:oklch(24% .012 95);--ink-2:oklch(45% .012 95);--line:oklch(89% .008 95);
  --accent:oklch(50% .12 150);--accent-hover:oklch(45% .12 150);--accent-ink:oklch(99% .01 150);--accent-soft:oklch(94% .04 150);
  --warn:oklch(48% .12 60);--warn-soft:oklch(95% .04 75);
  --shadow:0 1px 2px oklch(20% .02 95/.06),0 8px 24px -12px oklch(20% .02 95/.14);
  color-scheme:light;
}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){
  --bg:oklch(19% .008 95);--surface:oklch(23% .008 95);--sunk:oklch(16.5% .008 95);
  --ink:oklch(93% .006 95);--ink-2:oklch(72% .01 95);--line:oklch(33% .01 95);
  --accent:oklch(74% .13 150);--accent-hover:oklch(80% .13 150);--accent-ink:oklch(20% .03 150);--accent-soft:oklch(30% .05 150);
  --warn:oklch(80% .12 75);--warn-soft:oklch(30% .05 70);
  --shadow:0 1px 2px oklch(0% 0 0/.3),0 10px 28px -14px oklch(0% 0 0/.6);
  color-scheme:dark;
}}
*{box-sizing:border-box}
html{-webkit-text-size-adjust:100%}
body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.6 system-ui,-apple-system,"PingFang SC","Microsoft YaHei",sans-serif;font-variant-numeric:tabular-nums}
::selection{background:var(--accent-soft);color:var(--ink)}
:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
a{color:inherit}
main{max-width:1120px;margin:0 auto;padding:40px 16px 96px}
.page-head{margin-bottom:24px}
.page-head h1{font-size:1.625rem;line-height:1.25;margin:0 0 6px;letter-spacing:-.02em;text-wrap:balance}
.page-head p{margin:0;color:var(--ink-2);max-width:70ch}
.list{display:grid;gap:20px}
.cand{display:grid;grid-template-columns:minmax(0,5fr) minmax(0,7fr);background:var(--surface);border-radius:14px;box-shadow:var(--shadow);overflow:hidden;transition:opacity .2s ease}
.cand.is-default{outline:2px solid var(--accent);outline-offset:-2px}
.media{margin:0;background:var(--sunk);display:flex;flex-direction:column;gap:8px;padding:12px;min-height:240px}
.media > a{display:block;flex:1;min-height:0;cursor:zoom-in}
.media img{display:block;width:100%;height:100%;max-height:460px;object-fit:contain;border-radius:8px}
.thumbs{display:flex;gap:8px}
.thumbs a{width:56px;height:56px;flex:none}
.thumbs img{width:100%;height:100%;object-fit:cover;border-radius:6px}
.broken-note{display:none;margin:auto;color:var(--ink-2);font-size:13px}
.media.broken > a{display:none}.media.broken .broken-note,.broken-note.always{display:block}
.body{padding:20px 24px;display:flex;flex-direction:column;gap:12px;min-width:0}
.body header{display:flex;align-items:center;gap:12px}
.num{flex:none;display:grid;place-items:center;width:32px;height:32px;border-radius:999px;background:var(--sunk);font-weight:700}
.is-default .num{background:var(--accent);color:var(--accent-ink)}
.body h2{flex:1;font-size:1.125rem;line-height:1.35;margin:0;text-wrap:balance}
.badge{flex:none;color:var(--accent);font-size:13px;font-weight:600}
.fit{margin:0;max-width:70ch}
.facts{display:flex;flex-wrap:wrap;gap:6px 16px;margin:0;font-size:13px;color:var(--ink-2)}
.facts b{color:var(--ink);font-weight:500}
.facts .warn{color:var(--warn);background:var(--warn-soft);padding:0 8px;border-radius:999px}
.prompt{display:block}
.prompt-head{display:flex;justify-content:space-between;align-items:baseline;font-size:13px;color:var(--ink-2);margin-bottom:6px}
textarea{display:block;width:100%;resize:vertical;min-height:120px;background:var(--sunk);color:var(--ink);border:1px solid transparent;border-radius:8px;padding:12px 14px;font:13px/1.6 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;transition:border-color .15s ease,background-color .15s ease}
textarea:hover{border-color:var(--line)}
textarea:focus{outline:none;border-color:var(--accent);background:var(--surface)}
.orig summary{cursor:pointer;font-size:13px;color:var(--ink-2)}
.orig pre{margin:8px 0 0;background:var(--sunk);border-radius:8px;padding:12px 14px;font:12.5px/1.6 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;white-space:pre-wrap;word-break:break-word}
.actions{display:flex;align-items:center;gap:16px;flex-wrap:wrap;margin-top:auto;padding-top:4px}
.credit{flex:1;min-width:12rem;font-size:12px;color:var(--ink-2)}
button{font:inherit;cursor:pointer}
.pick{background:var(--accent);color:var(--accent-ink);border:0;border-radius:10px;padding:10px 24px;font-weight:600;transition:background-color .15s ease,transform .1s ease}
.pick:hover{background:var(--accent-hover)}
.pick:active{transform:translateY(1px)}
.pick:disabled{cursor:default;opacity:.55}
.link{background:none;border:0;padding:0;color:var(--accent);font-size:13px;text-decoration:underline;text-underline-offset:3px}
.done .cand:not(.chosen) .media{opacity:.4;filter:saturate(.4)}
.done .cand:not(.chosen){box-shadow:none}
.chosen{outline:2px solid var(--accent);outline-offset:-2px}
.chosen .pick:disabled{opacity:1}
.status{display:none;margin-top:14px;padding:12px 16px;border-radius:12px;background:var(--accent-soft);color:var(--ink);font-weight:500}
.status.show{display:block}
.bar{position:fixed;left:50%;bottom:24px;transform:translate(-50%,16px);opacity:0;pointer-events:none;display:flex;align-items:center;gap:16px;max-width:calc(100vw - 32px);background:var(--ink);color:var(--bg);padding:10px 12px 10px 18px;border-radius:12px;box-shadow:var(--shadow);transition:opacity .2s ease,transform .25s cubic-bezier(.16,1,.3,1)}
.bar.show{opacity:1;transform:translate(-50%,0);pointer-events:auto}
.bar button{background:transparent;color:var(--bg);border:1px solid currentColor;border-radius:8px;padding:4px 14px}
.bar button:hover{background:oklch(100% 0 0/.12)}
.bar button[hidden]{display:none}
kbd{font:12px/1 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;padding:2px 6px;border-radius:4px;background:var(--sunk);border:1px solid var(--line)}
.empty{background:var(--surface);border-radius:14px;padding:32px;color:var(--ink-2);box-shadow:var(--shadow)}
@media (max-width:760px){
  main{padding-top:28px}
  .cand{grid-template-columns:1fr}
  .media{min-height:0}
  .media img{max-height:340px}
  .body{padding:16px}
  .pick{width:100%}
}
@media (prefers-reduced-motion:reduce){*{transition:none!important}}
</style>
</head>
<body>
<main>
  <div class="page-head">
    <h1>${esc(title || "选一个方向")}</h1>
    <p>${request ? `${esc(request)}。` : ""}看图挑一个，点「选这个」或按数字键 <kbd>1</kbd>–<kbd>${Math.min(candidates.length, 9) || 1}</kbd>。想改提示词，先在框里改。</p>
    <p class="status" role="status"></p>
  </div>
  <div class="list">
    ${
      candidates.length
        ? candidates.map(candidateHtml).join("")
        : `<p class="empty">这次没找到合适的案例。回到对话里说一句想要的画面，我直接写一版。</p>`
    }
  </div>
</main>
<div class="bar" role="status" aria-live="polite"><span class="bar-text"></span><button type="button" class="undo">撤销</button></div>
<script>
(() => {
  const KEY = "prompt-studio:${key}:";
  const UNDO_SECONDS = 3;
  const store = {
    get: (k) => { try { return localStorage.getItem(KEY + k); } catch { return null; } },
    set: (k, v) => { try { v == null ? localStorage.removeItem(KEY + k) : localStorage.setItem(KEY + k, v); } catch {} },
  };
  const served = location.protocol.startsWith("http");
  const cards = [...document.querySelectorAll(".cand")];
  const bar = document.querySelector(".bar");
  const barText = bar.querySelector(".bar-text");
  const undo = bar.querySelector(".undo");
  const status = document.querySelector(".status");
  const calm = matchMedia("(prefers-reduced-motion: reduce)").matches;
  let pending = null;
  let closed = false;

  const showBar = (text, canUndo) => { barText.textContent = text; undo.hidden = !canUndo; bar.classList.add("show"); };
  const hideBar = () => bar.classList.remove("show");
  const mark = (card) => {
    document.body.classList.add("done");
    cards.forEach((c) => c.classList.toggle("chosen", c === card));
    card.scrollIntoView({ behavior: calm ? "auto" : "smooth", block: "nearest" });
  };
  const close = (card, text) => {
    closed = true;
    mark(card);
    status.textContent = text;
    status.classList.add("show");
    cards.forEach((c) => { c.querySelector(".pick").disabled = true; c.querySelector("textarea").readOnly = true; });
    card.querySelector(".pick").textContent = "已选";
    showBar(text, false);
  };

  async function send(card) {
    const box = card.querySelector("textarea");
    const num = card.dataset.num;
    const edited = box.value !== box.defaultValue;
    if (served) {
      try {
        const res = await fetch("/pick", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: card.dataset.id, number: Number(num), edited, prompt: box.value }) });
        if (!res.ok) throw new Error(String(res.status));
        return close(card, "已选第 " + num + " 个" + (edited ? "（用你改过的提示词）" : "") + "，结果会出现在对话里，这个页面可以关掉了。");
      } catch {
        // The agent stopped listening (timeout or already picked): fall back to copying.
      }
    }
    const reply = edited ? "选 " + num + "，提示词改成：\\n" + box.value : "选 " + num;
    let copied = false;
    try { await navigator.clipboard.writeText(reply); copied = true; } catch {}
    mark(card);
    status.textContent = copied
      ? "已复制「" + (edited ? "选 " + num + " + 改过的提示词" : reply) + "」，回到对话里粘贴发送。"
      : "回到对话里回复「选 " + num + "」" + (edited ? "，并贴上改过的提示词。" : "。");
    status.classList.add("show");
    showBar(status.textContent, false);
  }

  function pick(card) {
    if (closed) return;
    if (pending) { clearInterval(pending.timer); }
    mark(card);
    let left = UNDO_SECONDS;
    const tick = () => showBar("已选第 " + card.dataset.num + " 个，" + left + " 秒后" + (served ? "发给 AI" : "复制回复"), true);
    tick();
    pending = { card, timer: setInterval(() => {
      left -= 1;
      if (left > 0) return tick();
      clearInterval(pending.timer); pending = null;
      showBar(served ? "发送中…" : "复制中…", false);
      send(card);
    }, 1000) };
  }

  undo.addEventListener("click", () => {
    if (!pending) return;
    clearInterval(pending.timer); pending = null;
    document.body.classList.remove("done");
    cards.forEach((c) => c.classList.remove("chosen"));
    hideBar();
  });

  for (const card of cards) {
    const box = card.querySelector("textarea");
    const reset = card.querySelector(".reset");
    const saved = store.get(card.dataset.id);
    if (saved != null && saved !== box.defaultValue) { box.value = saved; reset.hidden = false; }
    const fit = () => { box.style.height = "auto"; box.style.height = Math.min(box.scrollHeight + 2, 480) + "px"; };
    fit();
    box.addEventListener("input", () => {
      const edited = box.value !== box.defaultValue;
      reset.hidden = !edited;
      store.set(card.dataset.id, edited ? box.value : null);
      fit();
    });
    reset.addEventListener("click", () => { box.value = box.defaultValue; reset.hidden = true; store.set(card.dataset.id, null); fit(); box.focus(); });
    card.querySelector(".pick").addEventListener("click", () => pick(card));
  }

  document.addEventListener("keydown", (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey || e.target.closest("textarea, input")) return;
    if (e.key === "Escape" && pending) return undo.click();
    const card = cards[Number(e.key) - 1];
    if (card) pick(card);
  });
})();
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
    // Some library prompts start with zero-width characters; drop them.
    const clean = (t) =>
      String(t ?? "")
        .replace(/[\u200b-\u200d\ufeff]/g, "")
        .trim();
    const content = clean(p.content ?? e?.content);
    const shown = p.adapted ? clean(p.adapted) : content;
    candidates.push({
      ...p,
      title: p.title || e?.title || `#${p.id}`,
      images: p.images || e?.sourceMedia || (p.image ? [p.image] : []),
      category: p.category || e?.category,
      content,
      ...(p.adapted ? { adapted: shown } : {}),
      needReferenceImages:
        p.needReferenceImages ?? Boolean(e?.needReferenceImages),
      hasPlaceholders:
        p.hasPlaceholders ??
        (/\{argument\b/i.test(shown) || /\{[a-z_]+=/i.test(shown)),
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

// Serve the page on 127.0.0.1 and resolve with the user's pick (or a timeout).
// `onReady` gets the URL as soon as the port is open, so the caller can open it.
export function serveGallery({
  file,
  ids,
  pickFile,
  timeoutMs = 30 * 60 * 1000,
  port = 0,
  onReady = () => {},
}) {
  const allowed = new Set(ids.map(String));
  return new Promise((resolve) => {
    let timer;
    const server = http.createServer((req, res) => {
      if (
        req.method === "GET" &&
        (req.url === "/" || req.url === "/index.html")
      ) {
        res.writeHead(200, {
          "content-type": "text/html; charset=utf-8",
          "cache-control": "no-store",
        });
        return res.end(fs.readFileSync(file));
      }
      if (req.method === "POST" && req.url === "/pick") {
        let body = "";
        req.on("data", (d) => {
          body += d;
          if (body.length > 200_000) req.destroy();
        });
        req.on("end", () => {
          let pick;
          try {
            pick = JSON.parse(body);
          } catch {
            pick = null;
          }
          if (!pick || !allowed.has(String(pick.id))) {
            res.writeHead(400);
            return res.end("unknown candidate");
          }
          const result = {
            status: "picked",
            id: pick.id,
            number: pick.number,
            edited: Boolean(pick.edited),
            prompt: String(pick.prompt || ""),
            at: new Date().toISOString(),
          };
          fs.writeFileSync(pickFile, `${JSON.stringify(result, null, 2)}\n`);
          res.writeHead(200, { "content-type": "application/json" });
          res.end('{"ok":true}');
          clearTimeout(timer);
          server.close();
          resolve({ ...result, pickFile });
        });
        return;
      }
      res.writeHead(404);
      res.end();
    });
    server.listen(port, "127.0.0.1", () => {
      onReady(`http://127.0.0.1:${server.address().port}/`);
      timer = setTimeout(() => {
        server.close();
        resolve({ status: "timeout", pickFile: null });
      }, timeoutMs);
    });
  });
}
