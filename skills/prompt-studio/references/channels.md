# Channels

This skill never generates. It hands a Generation Brief to a Channel.

## Detect what exists

`studio.mjs session` already reports CLI presence (codex, grok, ffmpeg, node) and the names of key variables, so read its output instead of probing again. The table shows what each signal means.

| Check                                                                                          | Means                                                  |
| ---------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| The current host exposes `image_gen` / `image_edit` / `reference_to_video` (Codex, Grok Build) | Host tool available                                    |
| `command -v codex`                                                                             | Codex CLI: images via its `image_gen`                  |
| `command -v grok`                                                                              | Grok Build CLI: images and video via its Imagine tools |
| An API key variable named in the Style Pack is set (check with `[ -n "$VAR" ]`, never echo it) | HTTP API available                                     |
| `node --version` ≥ 22 and `command -v ffmpeg`                                                  | Code Video rendering possible (Hyperframes)            |

Claude Code has no generation tool of its own; it always hands off to one of the others.

## Priority

1. A Channel the user named in this request.
2. The Channel the Style Pack names as preferred.
3. The current host's own tool.
4. Other detected Channels: list them with what each can produce and let the user pick.

## Invocation

Prompts always go through stdin or a file, never as a shell argument: quoting breaks on long prompts, and Codex's `-i` flag swallows every argument after it.

**Codex CLI (images)**

```bash
codex exec -s workspace-write -C "$PWD" -i ref1.png -i ref2.png - < brief.md
```

Start the brief with: `Generate one image with image_gen and save it as <absolute path>.` Outside a Git repository add `--skip-git-repo-check`. Reference images go in as `-i` flags before the final `-`, which makes Codex read the brief from stdin.

- One call makes one image. For 2–4 variants run that many calls in parallel (3–4 at most), each with its own output path.
- Codex returns its own fixed sizes (for example 1536×1024) and does not honour exact pixel sizes such as 1800×766. Generate at the nearest native shape, then fit it (see `image.md`).

**Grok Build CLI (images, video)**

```bash
grok -p "$(cat brief.md)" --always-approve --output-format json
```

Only use `--always-approve` inside a working directory you are willing to let it write to. In the brief, name the tool (`image_gen`, `image_edit` or `reference_to_video`), the output path and every parameter. Grok has no text-only video: `reference_to_video` needs at least one reference image.

**HTTP API**

Write a short script that reads the key from the environment variable, submits the task, polls until it finishes (video is asynchronous; poll every 10–15 s with a timeout), and downloads the result. Print task id and status, never the key.

**Render engines**

See `code-video.md`.

## After the run

Confirm the file exists and is non-empty, then run the quality gate. A Channel exiting successfully is not proof that the asset is right.
