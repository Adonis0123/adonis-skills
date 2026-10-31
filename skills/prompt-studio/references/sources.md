# Prompt sources

`recommend` searches many GitHub prompt libraries at once, through one index. Each source has an adapter, a license and a seed policy in `assets/sources.json`; `studio.mjs sources [--kind video]` lists them with what is cached. Libraries were checked on 2026-10-29; counts change daily.

## What is searched

| Kind         | Sources                                                                                                                                                                                                                                                                                  | Sample media                                    |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| `image`      | YouMind ai-image-prompts (by use category), YouMind GPT Image 2 (18k), freestylefly/awesome-gpt-image-2, ai-boost (GPT Image, Nano Banana), songguoxs (GPT-4o / Nano Banana), glidea (Nano Banana, Chinese), yang0/handraw-style (367 hand-drawn styles; style traits, not full prompts) | Sample images from the model named on the entry |
| `video`      | LearnPrompt Seedance (Seedance 2.x), SkyNotSilent MiniMax H3, ai-boost (Seedance, Veo, Kling, H3, Wan, Sora), imagineVid Kling 3.0 and Grok Imagine, YouMind Seedance, LichAmnesia ad prompts                                                                                            | Playable clip and poster on most entries        |
| `code-video` | Hyperframes catalog (templates, `npx hyperframes add <name>`), awesome-claude-video (videos Claude made, with clips), opus-video-prompts (copy-ready prompts)                                                                                                                            | Template poster or preview clip                 |

yang0/handraw-style entries are style traits in Chinese (line, color, figure shape) with a sample, not scene prompts: keep the traits, add the user's subject, and describe the look instead of naming the reference artist in its tags.

Gaps: no structured library covers Midjourney, Flux or Seedream images, or Runway and Wan 2.x clips well. For those, search the nearest kind without `--model`, then keep the user's target model as the constraint: adapt with the model's row in `image.md` or `model-video.md`, and when the target has no row there, check the vendor's official docs for its parameters before adapting (mark what you could not check `UNVERIFIED`). Say in the fit line that the samples come from another model, and never switch the user's channel silently.

## Model names users say

Pass `--model` only when the user names a model or the channel is fixed. Keys:

| User says                     | `--model`                                                                                                                                                                                                                                                                            |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 即梦, Seedance, Dreamina      | `seedance`                                                                                                                                                                                                                                                                           |
| 可灵, Kling                   | `kling`                                                                                                                                                                                                                                                                              |
| 海螺, Hailuo, MiniMax, H3     | `hailuo`                                                                                                                                                                                                                                                                             |
| Veo, Google 视频              | `veo`                                                                                                                                                                                                                                                                                |
| Grok, Grok Imagine            | `grok-imagine`                                                                                                                                                                                                                                                                       |
| 万相, Wan                     | `wan`                                                                                                                                                                                                                                                                                |
| GPT Image, gpt-image, 4o 生图 | `gpt-image`                                                                                                                                                                                                                                                                          |
| Nano Banana, Gemini 生图      | `nano-banana`                                                                                                                                                                                                                                                                        |
| Midjourney, MJ                | none: no library has Midjourney samples; search without `--model`. For images adapt with the Midjourney row in `image.md`; for Midjourney video, `model-video.md` has no row yet, so check the official docs for its video parameters and mark what you could not check `UNVERIFIED` |
| Hyperframes, Remotion, Manim  | same name                                                                                                                                                                                                                                                                            |

With `--model`, matching samples come first; when fewer than 3 exist, the rest are filled from other models and flagged `modelMismatch`. The gallery says so on the card.

## Ranking

Keyword match (rare words weigh more, title over description over body) → a small readiness prior (detailed prompt, several samples, playable clip for video, no placeholders) → the user's own scores from `rate`. Results are spread over sources (at most 2 per source unless `--source` or `--model` is given), so the 3 picks are less likely to be near copies.

## Freshness and first use

Each source is checked at most every 10 minutes with ETags. A call waits about 6 s for downloads; slower sources keep downloading in the background and the result lists them under `pending`. When `downloading` is not empty and fewer than 5 results came back, say once that more libraries are still downloading and rerun the same command with `--wait-sec 30`; `refreshing` sources already served their cached data, so do not wait for them. Offline, results come from the cache or the bundled seed (`origin: seed`). The seed holds prompt text and links: its sample images and clips are remote, so offline they do not show. Say which of three things work: finding prompts (yes, from cache or seed), seeing samples (only for cached media), generating (only with a local engine such as Hyperframes, or once online). Offer the text-only path: pick by the prompt and its fit line.

## Licenses

- `seed: "allowed"` sources (CC0, CC BY, MIT, Apache) may ship in `assets/seed-prompts.json`. All other sources are downloaded to the user's cache at runtime and never bundled.
- Show source and license on every candidate (the gallery does). Keep `author` and `link`: CC BY needs credit when the result is shared, and the original post is where the user checks the sample is real.
- Entries whose repo declares no license are reference only: adapt the technique, do not republish the prompt text.

## Adding a library the user found

When nothing fits and `access.onlineSearch` is true:

1. `studio.mjs github "<topic> prompts"` lists repositories.
2. Open the repo's README or data file and check that it has prompts with sample media and a license.
3. `studio.mjs sources add <owner/repo> --kind image|video|code-video` detects the format (JSON data file, one YAML per entry, or a README with prompt blocks), test-syncs it and prints the entry count and two sample titles. Pass `--adapter`, `--file` or `--map` only when detection fails. A source that yields 0 entries is not kept. For a video or code-video library, check that a sample entry has `videos`; when the data file holds only a poster and a slug but the clip sits at a predictable address, pass `--video-template 'https://host/{slug}/clip.mp4'` (any `{field}` of the row), and open one built URL to confirm it plays. Without it the gallery shows stills only.
4. User sources live in the cache (`user-sources.json`), not in the skill, and are searched like the built-in ones.
