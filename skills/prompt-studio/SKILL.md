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

- In ONE user-facing message, state assumed defaults for each missing gap (at most 3: use and ratio, subject, style or mood), and search within the output type chosen above; show the candidates in that same turn. Image-library `recommend` is only for image candidates, not exact-data stills or video plans.
- Skip any gap the request already answers. When improving a supplied prompt, revise it directly; search only if a missing technique needs a reference.
- For an asset request, pause for the candidate choice. If the user said 直接出 / just make it, take the default candidate and continue.
- Interview first instead when the user asks to discuss or be grilled (先聊聊 / 问我几个问题 / grill), or the asset carries brand or taste weight (a series, a brand cover, a campaign key visual) and the request names no style. Ask in rounds like the `grilling` skill: number each question, give your recommended answer, ask only questions whose prerequisites are settled, at most 2 rounds. Look facts up yourself (Style Pack, existing covers in the project) instead of asking. Then search.

### 4. Recommend (≤5 candidates)

- Images: `studio.mjs recommend "<English keywords>" --use cover|illustration|infographic|avatar|thumbnail|comic|product|game|app --limit 5 --project <dir>`. Same `--project` as session, brief, log and rate, so saved scores affect this ranking.
  - Translate CJK ideas into English keywords first; a CJK-only query returns `error: translate-to-english` and does not search.
  - Describe the picture, not the topic. The library holds visual prompts, so `isometric tech illustration` finds tech art while `MCP protocol` finds nothing. Send 2–3 visual directions in one call separated by `|` (for example `isometric tech illustration | glowing network nodes | 3d cute robot mascot`); each result keeps its best direction and lists the words it `matched`. Ranking weights rare words above generic ones (`ai`, `tech`) and rewards matching more of a direction.
  - Covers use `--use cover`, never `social-media-post`. For `cover` / `thumbnail`, put the subject in the keywords (for example `MCP connector AI tools`) and omit the word `cover`: the flag already scopes the category, and the word mostly matches fashion magazines.
  - Read `cacheNote`: a skipped large category was not searched. Add `--allow-large` only when that category is where the request belongs (product shots, social posts).
- Look at the sample images of the returned ≤5 only, not 30. Resolve flagged placeholders from the request or safe defaults; drop a candidate only when essential inputs remain missing. Drop `needReferenceImages` candidates when suitable user references are unavailable.
- `studio.mjs show <id>` only the chosen id (or the top finalists if unsure).
- Code Video: search templates per `references/code-video.md`. Model Video: start from `references/model-video.md`.
- If nothing in those results fits and `access.onlineSearch` is true, `studio.mjs github "<topic>"` finds libraries; check a new library's license before use. When `onlineSearch` is false, skip `github`: the anonymous hint already explained it, and the command returns no repositories.

Show the candidates as a gallery page, because a terminal cannot render the sample images:

1. `studio.mjs gallery --project <dir> --json '{"runId":"...","title":"...","request":"<user request>","query":"<keywords>","candidates":[{"id":<id>,"fit":"<one line, user language>","model":"...","ratio":"...","adapted":"<your rewritten prompt, optional>","default":true}]}'`. The script fills in sample images, the full prompt text, source and license from the library, writes `<records>/gallery/<runId>.html` and prints its `file` and `url`. A non-empty `missing` means an id was not in the library: fix it and rerun.
2. Open it for the user (`open <file>` where available) and give the path.
3. In the chat message too, list each candidate: number, title, one-line fit, the first ~300 characters of the prompt, the sample image URL, source and license. The user must see the prompt and the case even if the page does not open.

Model and ratio may be your proposed adaptation, not library metadata; the page labels them 建议. If a sample cannot be opened, mark visual fit `UNVERIFIED`. Mark one default. For Code Video and Model Video plans, pass templates or reference clips as candidates with `content`, `title`, `images`, `source` and `license` filled in yourself.

### 5. Write the Generation Brief

- Rewrite the chosen prompt for the user's content: keep its structure and technique, replace its subject. Resolve every template placeholder, including `{argument ...}` and `{style=...}`; literal JSON object braces are valid and need not be removed.
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
