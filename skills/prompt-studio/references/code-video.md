# Code Video

An LLM writes the composition; an engine renders frames. Every word and number is exact, and the cost is tokens plus local render time.

## Still to motion (动效 default)

When the user says 动效, 动起来, or "motionize this still" without asking for realistic motion or naming a video model, build a Code Video: it is free and every word and number stays exact. Rebuild the still's layout in code (or place the still as a background layer), animate transform and opacity only, keep the same palette and Style Pack, and default to a 3–5 s loop at the still's aspect ratio. Offer Model Video only as an upgrade, with a cost quote.

## Pick the engine

| Engine                                                         | Best for                                                                 | Needs                   | Notes                                                                                                                           |
| -------------------------------------------------------------- | ------------------------------------------------------------------------ | ----------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Hyperframes (default)                                          | Launch clips, explainers, data motion, vertical shorts, captions, slides | Node.js 22+, FFmpeg     | ~450 registry blocks, built-in checks. Skill: `heygen-com/hyperframes`                                                          |
| Remotion                                                       | Work inside an existing React project, batch or cloud rendering          | Node.js, `create-video` | All `remotion` and `@remotion/*` packages on one exact version. Company use may need a paid license: check remotion.dev/license |
| p5.js + p5.brush (for example a local painted-animation skill) | Hand-painted watercolor cartoons, character shorts                       | Node, FFmpeg, Chrome    | Slow without a GPU                                                                                                              |
| Kinetic typography (for example a local kinetic-reel skill)    | Big-type portfolio reels, product promos                                 | Node, FFmpeg, three.js  | Motion on the beat                                                                                                              |

Hyperframes is the default. Use another engine only when its skill is already installed and the request fits its row (a painted short, a kinetic-type reel, an existing Remotion project). When the Hyperframes skill is not installed, read its text through `delivery.md` layer 2 and offer to install it afterwards.

A template is a starting structure, not a spec. When it asks for real screenshots, music, voice-over or a logo the user did not give, use clean placeholder UI (simple shapes, the product name as a wordmark), no audio, and say so in one line with the result. Ask before starting only when the request depends on an asset (their real app screens, their logo).

## Code-built still

For a poster or card whose text must be exact: write one HTML page at the final size (`width`/`height` in px on `body`), with the generated background as a CSS `background-image` and the text as real HTML with a bundled CJK font (`@font-face`). Render it with `npx hyperframes snapshot` on a one-frame composition, or open it in a browser and take a full-page screenshot at the exact size. Check with `studio.mjs check-image <file> --size WxH`.

## Setup

- `npx hyperframes init <absolute dir> --skip-skills` (or `HYPERFRAMES_SKIP_SKILLS=1`): without it, `init` installs Hyperframes' agent skills, which skips the install confirmation in `delivery.md` layer 3. Pass absolute paths to `init` and run every later `hyperframes` command with the project as its working directory (`npm --prefix <dir>` or `cd <dir> && ...` in the same command): a shell `cd` in a separate call may not persist, and a relative `init` then creates the project inside whatever repository the shell is in.
- No local Chrome: set `HYPERFRAMES_BROWSER_PATH` to an existing Chrome or Chromium; otherwise `check` downloads a headless shell and can time out.
- Chinese or other non-Latin text: bundle a font that covers it in `assets/fonts/` with `@font-face`; the built-in fonts are Latin only and render CJK punctuation as boxes.
- Open the preview before rendering and look at it once.
- `check` and `snapshot` may leave a headless browser running for a few minutes; before you finish, stop any process you started, by pid.

## Templates

Start with `studio.mjs recommend "<motion description>" --kind code-video`: it searches the Hyperframes catalog (posters and preview clips) together with code videos other people made with an agent. A Hyperframes result's name is what `add` takes. The CLI search below is the fallback and lists blocks the index may not have yet.

```bash
npx hyperframes catalog --query "<English description>" --json   # search, offline index
npx hyperframes add <name> --json                                   # copies editable source into compositions/
```

Before the first write, ask once: the project directory `init` creates, the CLI version (`npx hyperframes --version`), each block to `add` with the files it writes, and a one-line summary of any changed skill text (`delivery.md`). Do not run `init` before that yes. If `catalog` returns nothing (it can come back empty behind a proxy), write the composition from the Request Brief directly; do not loop on the search. Remotion has no add command: start from `npx create-video@latest --yes --blank <dir>` (fails inside an existing Git repo; pick a fresh directory).

## Request Brief fields (from the Hyperframes spec)

- GOAL: one sentence — what the viewer feels or does afterwards.
- OUTPUT: W×H and fps (default 1920×1080 at 30 fps; use the Style Pack preset when given).
- TIME: seconds × fps = frames; BPM and frames per beat if there is music.
- LOOK: background hex, ink colour, one accent and where it may appear, font + weight + px size, texture, grain or vignette percentages.
- OBJECTS: each thing on screen with recognisable material and detail.
- MOTION: named easings, spring damping, durations and staggers in frames.
- SHOTS: one line each — frame range, the single main action, what the viewer must read and for how long, sound, hand-off to the next shot.
- BANNED and QA: what must not appear; which frames to check and what each must show.

Facts on screen must come from the user or a cited source; mark illustrative numbers as schematic. Labels are facts too: when the user gives numbers without saying what they measure (Q1 120 万 …), label them neutrally (季度数据（万）) and offer the likely meaning (营收?) as a question in the same message, instead of writing 营收 into the film. Check three things separately before calling it done: the input numbers, every derived number (growth %, differences), and that the title and labels say only what the user said.

## Rules that keep quality high

- Every frame is a pure function of time: no `Date.now()`, unseeded `Math.random()`, network calls, timers, or infinite repeats.
- Remotion: animate with `useCurrentFrame()` + `interpolate()`; CSS transitions and animations do not render.
- Hyperframes: every timed element has `class="clip"`, `data-start`, `data-duration`; register one paused timeline per composition (`window.__timelines[id] = tl`); never tween `display`, `visibility` or `autoAlpha` on a `.clip` itself, animate its children (this overrides GSAP's general advice to prefer `autoAlpha`).
- GSAP: sequence with a timeline and position parameters, not chained delays; animate transform and opacity, not width, height, top or left.
- One main action per shot; the subject fills at least 40% of the frame; something new every 2–4 seconds.
- Text colour needs 4.5:1 contrast with its background; a brand accent that fails goes on shapes and highlights, not on text.
- Readable text: at least 28 px at 1080p, on screen for 0.5 s + 0.3 s per word. Too many words → cut words, never shrink type.
- Default AI look is banned unless asked for: a black or dark-navy void, glow, bloom, neon, purple-blue gradients, glass cards, everything fading in at once, three cards in a row, KPI grids, a logo parked in a corner.
- Narrative clips longer than ~15 s get music and sound effects by default. You cannot hear audio: measure it (`ffmpeg -i out.mp4 -af volumedetect -f null -`) and say it was measured, not listened to.

## Quality gate

1. Hyperframes: `npx hyperframes lint`, then `npx hyperframes check --json` must be clean (it reports unread lines, dead stretches, text below size, an empty first frame, silent films).
2. Look at frames: `npx hyperframes snapshot --review` (includes a 360 px phone width) or, for any engine, `ffmpeg -i out.mp4 -vf fps=1 frames/%03d.png` and open them.
3. Write findings as P0/P1/P2; fix every P0 before calling it done. Do not score the film out of 10.
4. Render: `npx hyperframes render --quality draft` while iterating, `--quality delivery --output out.mp4` at the end; confirm duration with `ffprobe`.
