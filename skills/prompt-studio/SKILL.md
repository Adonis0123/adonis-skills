---
name: prompt-studio
description: "Turn a one-line image or video request into a finished asset: route it to an image, a code-rendered Code Video or a Model Video, recommend proven prompts from GitHub libraries (sample, source, license), write a generation brief, hand it to an available channel (host tool, Codex/Grok CLI, API, Hyperframes), then check and log the result. Use whenever the user wants a cover, illustration, poster, thumbnail, infographic, animation, motion clip, AI video, or a better prompt for one, even if they only say 'make me an image'. Also for Chinese-language requests for WeChat covers, illustrations, still-to-motion clips, and image/video prompt optimization. Not for general chatbot or coding prompts, photo editing without generation, UI implementation, or slide decks."
metadata:
  author: adonis
---

# Prompt Studio

Take a short request, find the best proven starting point, make it fit the user, and hand a precise brief to a channel that can generate. Then verify the output and remember what worked. This skill never generates by itself.

Run the helper with `node <skill-dir>/scripts/studio.mjs <command>`; successful commands print JSON; no command prints plain-text usage. Failures may print stderr or a JSON `error` (for example `translate-to-english`) with a non-zero exit. Check the exit status and those fields, not only a `status` key. Terms such as Request Brief, Generation Brief, Channel and Style Pack are defined in `references/glossary.md`; read it if one is unclear.

## Workflow

Respect the requested stopping point: a plan, recommendation list or prompt-only request ends there, without generation. “Just make it” skips candidate selection, not explicit no-generation instructions or spending/install approval.

### 1. Session probe (once per session)

Run `studio.mjs session --project <dir>`. It replaces separate access, style-pack and channel probes, so you never ask the user what exists.

- On `anonymous`, show its `hint` once and do not repeat it.
- If a Style Pack is found, read its file and apply it to every brief. `stylePackText` on the session object is capped, so the file is the pack. If none is found, add no house style.
- Channels come from the same output (see `references/channels.md`).

### 2. Pick the output type

| The result must…                                                                                                     | Output type                       | Read                        |
| -------------------------------------------------------------------------------------------------------------------- | --------------------------------- | --------------------------- |
| Look right (illustration, scene, character, photo, decorative art)                                                   | Image                             | `references/image.md`       |
| Get text, numbers, data or structure exactly right (charts, labeled diagrams, storyboards, title motion, explainers) | Code Video, or a code-built still | `references/code-video.md`  |
| Move realistically (people, scenes, a character from an image coming alive)                                          | Model Video                       | `references/model-video.md` |

- Ambiguous 动效 / 动起来 / "motionize this still" → Code Video by default: it is free and exact.
- Use Model Video only when the user asks for realistic motion or names a video model; its cost gate is in step 6.
- Several outputs ("cover plus a 5-second motion version"): plan them to share one look, and make the still first.

### 3. Fast path: assume, then search in the same message

Speed matters more than a perfect Request Brief: a wrong default costs one reply, a wasted turn costs more. Do not spend a whole turn on questions only.

- Fill missing gaps (at most 3: use and ratio, subject, style or mood) with defaults and search within the output type chosen above in the same turn. Mention the defaults in one short line, not a list. Image-library `recommend` is only for image candidates, not exact-data stills or video plans.
- Skip any gap the request already answers. When improving a supplied prompt, revise it directly; search only if a missing technique needs a reference.
- For an asset request, pause for the candidate choice. If the user said 直接出 / just make it, take the default candidate and continue.
- Interview first instead when the user asks to discuss or be grilled (先聊聊 / 问我几个问题 / grill), or the asset carries brand or taste weight (a series, a brand cover, a campaign key visual) and the request names no style. Ask in rounds like the `grilling` skill: number each question, give your recommended answer, ask only questions whose prerequisites are settled, at most 2 rounds. Look facts up yourself (Style Pack, existing covers in the project) instead of asking. Then search.

### 4. Recommend (3 candidates)

- Images: `studio.mjs recommend "<English keywords>" --use cover|illustration|infographic|avatar|thumbnail|comic|product|game|app --limit 5 --project <dir>`. Same `--project` as session, brief, log and rate, so saved scores affect this ranking.
  - Translate CJK ideas into English keywords first; a CJK-only query returns `error: translate-to-english` and does not search.
  - Describe the picture, not the topic. The library holds visual prompts, so `isometric tech illustration` finds tech art while `MCP protocol` finds nothing. Send 2–3 visual directions (never more than 3) in one call separated by `|` (for example `isometric tech illustration | glowing network nodes | 3d cute robot mascot`); each result keeps its best direction and lists the words it `matched`. Ranking weights rare words above generic ones (`ai`, `tech`) and rewards matching more of a direction.
  - Covers use `--use cover`, never `social-media-post`. For `cover` / `thumbnail`, put the subject in the keywords (for example `MCP connector AI tools`) and omit the word `cover`: the flag already scopes the category, and the word mostly matches fashion magazines.
  - Read `cacheNote`: a skipped large category was not searched. Add `--allow-large` only when that category is where the request belongs (product shots, social posts).
- Look at the sample images of the returned 5 only, not 30, and keep the 3 that differ most in look (up to 5 when the user asks for more). Resolve flagged placeholders from the request or safe defaults; drop a candidate only when essential inputs remain missing. Drop `needReferenceImages` candidates when suitable user references are unavailable.
- Do not `show` or rewrite candidates before the pick: the gallery already carries the full prompt. After the pick, `show` the chosen id only.
- Code Video: search templates per `references/code-video.md`. Model Video: start from `references/model-video.md`.
- If nothing in those results fits and `access.onlineSearch` is true, `studio.mjs github "<topic>"` finds libraries; check a new library's license before use. When `onlineSearch` is false, skip `github`: the anonymous hint already explained it, and the command returns no repositories.

Show the candidates as a gallery page, because a terminal cannot render the sample images. The user picks there with one click. Keep commands, JSON and tool status out of the chat unless the user asks to see them; then list every command in order, including the `recommend` and `gallery` already run.

1. Build it: `studio.mjs gallery --project <dir> --serve --json '{"runId":"...","title":"<short Chinese title>","request":"<user request>","candidates":[{"id":<id>,"fit":"<one line, user language>","ratio":"...","default":true}]}'`. The script fills in sample images, the full prompt, source and license, and writes `<records>/gallery/<runId>.html`. A non-empty `missing` means an id was not in the library: fix it and rerun.
2. `--serve` hosts the page on 127.0.0.1, prints `url` first, then waits for the user's click and prints `{"pick":{"id","number","edited","prompt"}}`. Run it in the background (Claude Code: `run_in_background`; Codex/Grok: a background shell) and open the `url` (`open <url>` where available). The user clicks 选这个 (3-second undo) or presses a number key; an edited prompt comes back in `prompt` and replaces the library text. `status: "timeout"` after 30 minutes means fall back to a chat reply: say so in one line and repeat the numbered list from step 3, so the message stands on its own. Without a background shell, drop `--serve` and open the file: 选这个 then copies 「选 N」 (plus any edited prompt) for the user to paste, so still point them to it.
3. Always also list the candidates in the chat, even though the page has them, in this shape:

   ```text
   1. 等距科技插画（推荐）：把 AI 和工具的连接画成一张架构图
   2. 霓虹网络节点：暗色、科技感强
   3. 3D 可爱机器人：轻松口吻
   候选页：<url> ，点「选这个」或直接回复编号；想改提示词就在页面框里改。
   ```

   If the page cannot be opened, add each prompt (first ~300 characters), sample image URL, source and license under its line.

4. A chat reply (编号, or 编号 plus an edited prompt) counts the same as a click.

Mark one default. If a sample cannot be opened, mark visual fit `UNVERIFIED`. For Code Video and Model Video plans, pass templates or reference clips as candidates with `content`, `title`, `images`, `source` and `license` filled in yourself.

### 5. Write the Generation Brief

- Start from the user's edited `prompt` when the pick has `edited: true`; otherwise from the library prompt. Rewrite it for the user's content: keep its structure and technique, replace its subject. Resolve every template placeholder, including `{argument ...}` and `{style=...}`; literal JSON object braces are valid and need not be removed.
- Apply the Style Pack, then adapt to the target model with the table in `references/image.md` (or the video reference).
- Scaffold with `studio.mjs brief --project <dir> --json '{"runId":"...","promptId":<id>,"title":"...","source":"...","license":"...","channel":"...","model":"...","outputPath":"...","size":"WxH","content":"...","styleNotes":"..."}'`. It writes a provenance file at `<records>/briefs/<runId>.md` (default records directory `<project>/.prompt-studio`, override `PROMPT_STUDIO_RECORDS`). The channel runs `content`, not this file; the handoff shape is in `references/channels.md`. If the user asked for a brief path, copy the finished provenance file there too. `outputPath` is the generated asset, not the brief.
- Credit source and license in the brief; CC BY 4.0 requires attribution when shared.

### 6. Hand off to a Channel

Follow `references/channels.md` for priority (user-named → Style Pack → host → list the others) and invocation.

- Model Video costs money: before every run state duration, resolution, channel and estimated cost, then wait for a yes.
- Images: ask for 2–4 variants when supported.
- On a moderation block, stop and tell the user; do not reword around the filter.
- Named real people need the user's own reference photo.

### 7. Check, refine, record

- Images: look at every variant and pick the best. Covers also run `studio.mjs cover-check <files> --title "..." --size WxH` and look at the previews. Exact size: `studio.mjs check-image <file> --size WxH`.
- Code Video and Model Video: run the gates in their references.
- Feedback ("warmer background") changes only the sentences that cover it; prefer an edit tool over regenerating.
- Log every generation: `studio.mjs log --project <dir> --json '{"runId":"...","promptId":<id>,"channel":"...","model":"...","output":"<path>","brief":"<path>","status":"selected|rejected","note":"why"}'`. Scores: `studio.mjs rate <runId> <1-5> --project <dir>`; 4–5 raises that prompt in later searches.

## Resources from elsewhere

Handled by risk; details in `references/delivery.md`. Shipped text is used directly; fetched library data, templates and other skills' text are kept current and confirmed when changed (`studio.mjs source <url>`); never run scripts from fetched content; installing another skill always needs the user's yes.

## Boundaries

- Never print, store or ask for tokens or API keys; use variable names only.
- No installs, writes into the user's project, or Model Video spend without the confirmations above. Briefs and Run Records in the records directory need none.
- Do not claim a result is done before it passed its quality gate; if it cannot be made right, say what is wrong.
