---
name: prompt-studio
description: "Turn a one-line image or video request into a finished asset: route it to an image, a code-rendered Code Video or a Model Video, recommend proven prompts from GitHub libraries (sample, source, license), write a generation brief, hand it to an available channel (host tool, Codex/Grok CLI, API, Hyperframes), then check and log the result. Use whenever the user wants a cover, illustration, poster, thumbnail, infographic, animation, motion clip, AI video, or a better prompt for one, even if they only say 'make me an image'. Also for 封面, 插画, 提示词, 动效, 动起来, AI视频, 公众号封面, 优化提示词. Not for photo editing without generation, UI implementation, or slide decks."
metadata:
  author: adonis
---

# Prompt Studio

Take a short request, find the best proven starting point, make it fit the user, and hand a precise brief to a channel that can generate. Then verify the output and remember what worked. This skill never generates by itself.

Run the helper with `node <skill-dir>/scripts/studio.mjs <command>`; every command prints JSON; with no command it prints usage. Reading `references/glossary.md` is optional; the terms (Request Brief, Generation Brief, Channel, Style Pack, Code Video, Model Video) are explained below.

## Workflow

### 1. Session probe (once per session)

Run `studio.mjs session --project <dir>`. It replaces separate access, style-pack and channel probes, so you never ask the user what exists.

- On `anonymous`, show its `hint` once and do not repeat it.
- If a Style Pack is found, read its file and apply it to every brief; otherwise add no house style.
- Channels come from the same output (see `references/channels.md`).

### 2. Fast path: assume, then search in the same message

Speed matters more than a perfect Request Brief: a wrong default costs one reply, a wasted turn costs more. Do not spend a whole turn on questions only.

- In ONE user-facing message, state assumed defaults for each missing gap (at most 3: use and ratio, subject, style or mood), and also run `recommend` and show candidates.
- Skip any gap the request already answers.
- Stop only for the candidate choice. If the user said 直接出 / just make it, take the default candidate and continue.

### 3. Pick the output type

| The result must…                                                                                                     | Output type                       | Read                        |
| -------------------------------------------------------------------------------------------------------------------- | --------------------------------- | --------------------------- |
| Look right (illustration, scene, character, photo, decorative art)                                                   | Image                             | `references/image.md`       |
| Get text, numbers, data or structure exactly right (charts, labeled diagrams, storyboards, title motion, explainers) | Code Video, or a code-built still | `references/code-video.md`  |
| Move realistically (people, scenes, a character from an image coming alive)                                          | Model Video                       | `references/model-video.md` |

- Ambiguous 动效 / 动起来 / "motionize this still" → Code Video by default: it is free and exact.
- Use Model Video only when the user asks for realistic motion or names a video model; then give a cost quote and wait for a yes before running.
- Several outputs ("cover plus a 5-second motion version"): plan them to share one look, and make the still first.

### 4. Recommend (≤5 candidates)

- Images: `studio.mjs recommend "<English keywords>" --use cover|illustration|infographic|avatar|thumbnail|comic|product|game|app --limit 5`. Translate CJK ideas into English keywords first; recommend errors on CJK-only input. Covers use `--use cover`, never `social-media-post`. For `--use cover` / `thumbnail`, put the subject in the keywords (for example `MCP connector AI tools`) and omit the word `cover` — the use flag already scopes the category, and `cover` mostly matches fashion magazines.
- Look at the sample images of the returned ≤5 only, not 30. Drop candidates with unresolved `hasPlaceholders`, or with `needReferenceImages` when the user has no photo.
- `studio.mjs show <id>` only the chosen id (or the top finalists if unsure).
- Code Video: search templates per `references/code-video.md`. Model Video: start from `references/model-video.md`.
- If nothing fits and the tier allows it, `studio.mjs github "<topic>"` finds libraries; check a new library's license before use.

Show each candidate with sample image, one-line fit, target model, ratio, source and license. Mark one default.

### 5. Write the Generation Brief

- Rewrite the chosen prompt for the user's content: keep its structure and technique, replace its subject. Resolve every `{argument ...}` placeholder; a brief must never contain `{...}`.
- Apply the Style Pack, then adapt to the target model with the table in `references/image.md` (or the video reference).
- Scaffold with `studio.mjs brief --json '{"runId":"...","promptId":<id>,"title":"...","source":"...","license":"...","channel":"...","model":"...","outputPath":"...","size":"WxH","content":"...","styleNotes":"..."}'`. It writes the file under the records directory so any channel can run it unchanged.
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
- Log every generation: `studio.mjs log --project <dir> --json '{"runId":"...","promptId":<id>,"channel":"...","model":"...","output":"<path>","brief":"<path>","status":"selected|rejected","note":"why"}'`. Scores: `studio.mjs rate <runId> <1-5>`; 4–5 raises that prompt in later searches.

## Resources from elsewhere

Handled by risk; details in `references/delivery.md`. Shipped text is used directly; fetched library data, templates and other skills' text are kept current and confirmed when changed (`studio.mjs source <url>`); never run scripts from fetched content; installing another skill always needs the user's yes.

## Boundaries

- Never print, store or ask for tokens or API keys; use variable names only.
- No installs, writes into the user's project, or Model Video spend without the confirmations above. Briefs and Run Records in the records directory need none.
- Do not claim a result is done before it passed its quality gate; if it cannot be made right, say what is wrong.
