# Style Pack

A Style Pack is a Markdown file the user owns. It holds the house style; this skill holds none.

## Where it is found

1. `<project>/.agents/style-pack.md`
2. The path in `PROMPT_STUDIO_STYLE_PACK`
3. Otherwise there is no Style Pack and no house style is added.

`node scripts/studio.mjs style-pack --project <dir>` reports which one was found. A project file may simply point at a shared one ("See /path/to/style-pack.md").

## Format

Use these five sections. Leave a section out when it does not apply.

```markdown
# Style Pack: <name>

## Palette

- Background: #FAFAF8 (paper)
- Ink: #1F2328
- Accent: #2BB3A3, only on the main subject

## Banned

- Text inside generated images
- Dark full-bleed backgrounds
- Neon glow, purple-blue gradients

## Characters

- Nika: reference sheet at /abs/path/nika-sheet.png. Always pass it as a reference image; text alone drifts.

## Presets

| Use               | Size              | Notes                                                           |
| ----------------- | ----------------- | --------------------------------------------------------------- |
| Article cover     | 1800x766 (2.35:1) | Keep the subject inside the centre 766 px so the 1:1 crop works |
| Card illustration | 1448x1086 (4:3)   | Plain background, subject centred                               |

## Checks

- `check-image --size 1800x766` for covers
- Look for any text in the image; regenerate if present

## Channels (optional)

- Preferred image channel: codex
- API key variable for video: MINIMAX_API_KEY
- Records directory: .prompt-studio
```

## How to apply it

- Palette and Banned go into every Generation Brief as positive instructions ("plain #FAFAF8 background") rather than negatives where the target model prefers that (see the model rules).
- Characters: attach the reference image whenever that character appears. If the Channel cannot take reference images, tell the user the character may drift.
- Presets decide aspect ratio and size; Checks run after generation.
