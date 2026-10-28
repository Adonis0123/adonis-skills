# Channels

This skill never generates. It hands a Generation Brief to a Channel.

## Detect what exists

`studio.mjs session` already reports CLI presence (codex, grok, ffmpeg), whether Node can run the helper (`nodeOk`), and the names of key variables. Do not probe those again. The table shows what each signal means. Hyperframes still needs its own version check, below.

| Check                                                                                          | Means                                                  |
| ---------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| The current host exposes `image_gen` / `image_edit` / `reference_to_video` (Codex, Grok Build) | Host tool available                                    |
| `command -v codex`                                                                             | Codex CLI: images via its `image_gen`                  |
| `command -v grok`                                                                              | Grok Build CLI: images and video via its Imagine tools |
| An API key variable named in the Style Pack is set (check with `[ -n "$VAR" ]`, never echo it) | HTTP API available                                     |
| `node --version` ≥ 22 and `command -v ffmpeg`                                                  | Code Video rendering possible (Hyperframes)            |

These are discovery signals, not readiness checks: a CLI version does not prove login, and a set key variable does not prove valid credentials. Inspect the host’s actual tool list; before handoff check the selected channel’s authentication and supported parameters without generating or spending. The helper’s `nodeOk` means Node 18+ for the helper, not Hyperframes’ Node 22+ requirement. Session does not include the version number, so read `node --version` before calling Hyperframes runnable. If the host has no generation tool, hand off to an available channel.

## Priority

1. A Channel the user named in this request.
2. The Channel the Style Pack names as preferred.
3. The current host's own tool.
4. Other detected Channels: pick the first one that can produce the output type and say which in one line; ask only when none fits or the choice costs money.

## Invocation

Codex prompts go through stdin, not a shell argument: its `-i` flag swallows every argument after it, and quoting breaks on long prompts. `studio.mjs brief` writes a provenance file (source, license, paths). Pass the generation text — `content`, whose first line is the instruction below — not that markdown file. Feeding the provenance file in makes the model read headings before the prompt.

**Codex CLI (images)**

```bash
codex exec -s workspace-write -C "$PWD" -i ref1.png -i ref2.png - < prompt.txt
```

`prompt.txt` starts with: `Generate one image with image_gen and save it as <absolute path>.` Outside a Git repository add `--skip-git-repo-check`. Reference images go in as `-i` flags before the final `-`, which makes Codex read the prompt from stdin.

- One call makes one image. For 2–4 variants run that many calls in parallel (3–4 at most), each with its own output path.
- Codex returns its own fixed sizes (for example 1536×1024) and does not honour exact pixel sizes such as 1800×766. Generate at the nearest native shape, then fit it (see `image.md`).

**Grok Build CLI (images, video)**

```bash
grok -p "$(cat prompt.txt)" --always-approve --output-format json
```

This passes the prompt as one shell argument. Keep the double quotes so the shell does not split it. A very long prompt can still exceed the OS argument limit; if that happens, check `grok --help` for a file or stdin flag instead of inventing one. Only use `--always-approve` inside a working directory you are willing to let it write to. In the prompt, name the tool (`image_gen`, `image_edit` or `reference_to_video`), the output path and every parameter. Grok has no text-only video: `reference_to_video` needs at least one reference image.

**HTTP API**

Write a short script that reads the key from the environment variable, submits the task, polls until it finishes (video is asynchronous; poll every 10–15 s with a timeout), and downloads the result. Print task id and status, never the key.

**Render engines**

See `code-video.md`.

## After the run

Confirm the file exists and is non-empty, then run the quality gate. A Channel exiting successfully is not proof that the asset is right.
