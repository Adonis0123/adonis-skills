# Image / video-producing skill trial

Use on the single-skill URL / 「测试一下」route when the candidate's core job is **generate bitmaps, then assemble them** (image-generation jobs feeding a renderer, story → illustrated video, page-flip from uploaded pages, Remotion-style compositions after master images).

Local specifics (accounts, proxies, the owner's own trial records): `references/local-image-producing-skill-trial.md` (if present).

## Hard gate: do not score from plan-only output

A storyboard JSON, caption split, job list, or `--mode plan` run is **not** evidence the skill works. The exercise is incomplete until all of these exist:

1. **Masters on disk** — the scene master images the skill expects (e.g. `*_master.png`) or the uploaded pages, at the exact paths the skill reads.
2. **Import / derive succeeds** — the skill's own import step turns the masters into its working plates or assets (e.g. black-and-white / color variants) without manual patching.
3. **A real exported video** — a preview or final MP4 rendered by the skill's pipeline, verified with `ffprobe` (duration and width × height match what the skill promised).

Plan-only = incomplete trial. Say so in the verdict rather than scoring the plan.

## Acceptance steps (minimum)

1. Temp clone under `/tmp/<skill>-eval-YYYYMMDD/`; install deps there (e.g. `npm ci`). No global skill install.
2. Run the plan step once to lock scene count and captions.
3. Generate the masters with the generator the skill documents (or the one the user names), and place them at the skill's exact output paths; create the directories first.
4. Run the skill's import step, then its preview/render step.
5. `ffprobe` the MP4 and record duration + resolution; keep a few stills.
6. Deliver the MP4 (with a cover/still) and the stills where the user will actually look, not just a path in text.

## Generator vs. skill

- Many such skills default to an agent's **built-in** image tool and keep a script as an explicit API fallback that needs a real provider key. An API proxy or wrong key failing is an **environment** problem, not proof the skill is broken, and not a reason to skip the visuals.
- If the user names a generator mid-eval ("use Codex / Grok to make the images"), switch to it immediately instead of continuing to probe the failing API.
- Do not retry a model the endpoint has already rejected once; skip master files that already exist and look complete.

## Intervention cost

Record generator steering separately from renderer quality. Heavy "wrong API, then another generator" cost belongs to the environment and should not inflate or deflate the skill's daily-fit score. Default verdict stays **C** (temporary-only) unless the job recurs often enough to justify a single install.
