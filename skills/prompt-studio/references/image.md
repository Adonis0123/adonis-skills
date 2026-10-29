# Images

## Library

- Sources: YouMind `ai-image-prompts-skill` (10,000+ prompts, split by use) and its GPT Image 2 library (18,000), plus freestylefly, ai-boost, songguoxs and glidea (full list and licenses in `sources.md`). `studio.mjs` reads their raw data directly; installing their skills is not needed.
- Offline: `assets/seed-prompts.json`, a few samples per category from sources whose license allows bundling.
- Fields: `id`, `title`, `description`, `content` (the prompt), `images` (samples), `model` (the model that made the sample, when the library says), `author`, `link`, `needReferenceImages`. There is no popularity field, so ranking uses: keyword match → your look at the sample → the user's own scores.
- Follow SKILL.md for recommendation commands, candidate filtering and placeholder resolution; this reference adds image-specific adaptation and quality checks.
- Many prompts were written for Nano Banana or GPT Image. Some are long JSON-style prompts; keep their structure when it carries layout, otherwise convert to prose for the target model.

Category slugs (check `studio.mjs sync` for the current list): `profile-avatar`, `social-media-post`, `infographic-edu-visual`, `youtube-thumbnail`, `comic-storyboard`, `product-marketing`, `ecommerce-main-image`, `game-asset`, `poster-flyer`, `app-web-design`, `others`. `social-media-post` (~22 MB) and `product-marketing` (~13 MB) are large; search them only when the request fits.

## Covers and thumbnails

A cover competes in a feed at about 340 px wide (and as a 1:1 crop at about 100 px). Quiet editorial minimalism disappears there. After the cover search in SKILL.md, apply:

- One subject, big: it fills at least 60% of the safe area's height; a face or character shown close (waist-up or closer) beats a full figure with props.
- A readable emotion or action: surprise, determination, a mid-motion gesture. A neutral smile reads as nothing at thumbnail size.
- One visual hook that carries the topic: an oversized object, a scale contrast, something breaking or glowing. Not five small icons.
- A colour field, not empty white: a light, saturated background from the Style Pack (dark backgrounds only if the Style Pack allows them), with the subject in a contrasting colour.
- Few, large shapes; no fine detail the eye has to hunt for.
- Design for the title the platform lays over the image. Many feeds and editors (WeChat drafts and cards, for example) print the title in white over the bottom ~40% with a soft dark gradient. Put the subject and hook in the upper ~55%, keep the bottom band low in detail and mid-to-dark in tone so white text reads, and never put the face there. The Style Pack says whether this applies.

Cover gate (in addition to the checks below): run `studio.mjs cover-check <files> --title "<title>" --size WxH`, which writes the 340 px, 120 px-crop and title previews (needs ffmpeg), and look at them. Each check reports `pass`, `written` or `unverified`. When ffmpeg lacks the drawtext filter or no CJK font is found, the title preview is an HTML file (`previews.title`) with the title band over the 340 px image: open it in a browser and take a screenshot before judging; until then the title check stays `unverified`, never a pass. Its title preview is a short bar on the 340 px sheet, not the platform's bottom ~40% band, so it cannot answer whether a feed title covers the face. Manual equivalent for the two small views: downscale to 340 px wide and to the 1:1 centre crop at 120 px, look at both, and answer in one line each: what is it, and what is the feeling? If either is unclear, regenerate. When the platform overlays the title, also make the preview below with the real title and look at it — the title must be readable and must not cover the face or the hook:

```bash
printf '%s\n%s' "<title line 1>" "<title line 2>" > title.txt
ffmpeg -i cover.png -vf "drawbox=y=ih*0.58:w=iw:h=ih*0.42:color=black@0.35:t=fill,drawtext=fontfile=<CJK font>:textfile=title.txt:fontcolor=white:fontsize=h*0.075:line_spacing=15:x=w*0.03:y=h*0.64" title-preview.png
```

When showing cover candidates, make them differ in direction (hook or background colour), not just wording, so the pick in SKILL.md step 3 is a real choice. Do not generate the directions before that pick unless the user said 直接出 / just make it.

## Rewriting a chosen prompt

1. Keep what makes it work: composition, lens and lighting language, material and texture words, layout structure.
2. Replace its subject, text and brand details with the user's.
3. Apply the Style Pack (palette, banned elements, character references, preset size).
4. Adapt to the target model:

| Target               | Rules                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Grok `image_gen`     | 2–5 sentences of natural prose; subject first; describe positively instead of negative prompts; aspect ratio is a parameter (`1:1`, `16:9`, `9:16`, `3:2`, `2:3`, `auto`), not prose. Use `image_edit` with a reference for any recurring character or real person.                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| Codex `image_gen`    | Prose; state the output path and exact pixel size in the first line; keep any text the image must show short and quoted.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| Midjourney           | Short comma-separated phrases, subject first, most important words early; no instructions to an assistant ("generate", "please"), no JSON. Parameters go last: `--ar W:H` (aspect ratio, e.g. `--ar 3:4` for 小红书, `--ar 16:9`), `--stylize 0–1000` (default 100; lower follows the text more closely), `--no <things>` for exclusions, `--sref <url>` for a style reference image. Leave `--v` out unless the user names a version: the account's default applies (2026 reports say V8.2 since 2026-07-24; `UNVERIFIED` against the official docs, which blocked access). Text inside the image is unreliable: put titles in later. Tell the user to check `/settings` if a parameter is rejected. |
| Nano Banana / Gemini | Natural prose; layout instructions and quoted on-image text work well; reference images for edits.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| Unknown model        | Prose, subject → setting → composition → light → style → palette; size as a parameter.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |

On-image text:

- A short slogan (up to about 12 Chinese characters or 6 English words) goes into the prompt, quoted, on GPT Image, Nano Banana and Grok. Then read every character in the result at full size; one wrong character fails the variant.
- Numbers, data, prices in a table, long copy, or a slogan that came out wrong twice: build a code-built still (recipe in `code-video.md`) and generate only the text-free background.
- Midjourney: leave text out and add it in the code-built still.

## Quality gate

1. Ask for 2–4 variants; look at every one and pick the best. Say why in one line.
2. Reject: off-topic subject, garbled or unwanted text, extra limbs or broken hands, watermarks, style that ignores the Style Pack. For a poster or any image with text, crop the text area (`ffmpeg -i in.png -vf "crop=iw:ih/3:0:0" text.png`, adjust to where the text is) and read it character by character against the request.
3. Size: `studio.mjs check-image <file> --size WxH` (or `--ratio A:B`). When it fails:
   - If the project already has a compositing step (for example a `cover.html` that places a background image into the final frame), generate only that input and re-render with the project's step. That step wins over everything below.
   - Wide targets such as 2.35:1 from a 3:2 render: fit, do not crop — scale to the target height and pad the sides with the background colour so the subject stays whole: `ffmpeg -i in.png -vf "scale=-2:H,pad=W:H:(ow-iw)/2:0:color=0xFAFAF8" out.png` (if the scaled width exceeds W, scale to W instead and pad top and bottom). Ask for generous empty space left and right in the brief so the fit looks intended.
   - Small mismatches: `ffmpeg -i in.png -vf "scale=W:H:force_original_aspect_ratio=increase,crop=W:H" out.png`, then look again; regenerate when cropping cuts the subject.
4. Style Pack checks (for example "subject inside the centre 766 px"): verify by looking at the image.
