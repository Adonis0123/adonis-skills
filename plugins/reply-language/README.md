English | [中文](./README.zh-CN.md)

# reply-language

A hook plugin for Claude Code and Codex that keeps the agent's user-facing replies in your language. It works once installed: the language comes from `REPLY_LANGUAGE`, else Claude Code's `language` setting, else the system language.

**First release: only Chinese (`zh`) is supported.** Any other language makes the plugin do nothing.

## Scenario

In long sessions with many tool calls, replies drift into English without anyone noticing, even when your instructions ask for Chinese. The author measured English at 25–32% of progress notes at one point.

## Why use it

- An off-language final reply is caught at the end of the turn, and the agent rewrites it.
- An off-language progress note gets a reminder, so the drift stops early.
- Code, commands, paths and URLs are not counted, so a Chinese reply full of terms still passes.

## How it works

- **Stop hook**: when the final reply is mostly not in the target language, it blocks the stop once. The agent's retry is let through, so a turn is blocked at most once. A retry caused by another Stop hook's block is still judged.
- **PostToolUse hook**: when the latest progress note the user already saw is mostly not in the target language, it adds a reminder to the agent's context. It never blocks and judges each note once. The reminder arrives one tool call late, because a reply is written to the transcript after its tool calls finish. It reads Claude Code's transcript format; in Codex it does nothing.

Only prose is measured. Code blocks, inline code, URLs and paths are removed first. A reply fails when, in what is left:

1. Latin letters ≥ 60 (30 for progress notes) and Latin letters > 3 × Han characters; or
2. for `zh`: kana (hiragana and katakana) ≥ 20 (10 for progress notes) and kana ≥ 0.5 × Han characters. Japanese prose writes more kana than kanji, while a Chinese reply that quotes a Japanese word or sentence has a few kana against many Han characters, so it passes.

The target language is the first of these sources that has a value. Later sources are not read, so an unsupported value stops there:

1. `REPLY_LANGUAGE` (`off` or `none` turns the plugin off).
2. Claude Code's `language` setting, from `<cwd>/.claude/settings.local.json`, `<cwd>/.claude/settings.json`, then `${CLAUDE_CONFIG_DIR:-~/.claude}/settings.json`. `cwd` comes from the hook input. The setting is free text, so `简体中文`, `中文`, `Chinese` and `zh-CN` all mean `zh`. An unreadable file is skipped.
3. The system language: on macOS the first entry of `defaults read -g AppleLanguages`; otherwise, or when that fails, the first set of `LC_ALL`, `LC_MESSAGES`, `LANG`.

Every error, missing field or short message lets the stop through (exit 0, no output). No network, no model call.

## What it blocks

With target language Chinese:

| Reply                                            | Result                      |
| ------------------------------------------------ | --------------------------- |
| A final reply mostly in English                  | Stop blocked once           |
| A final reply in Japanese                        | Stop blocked once           |
| A progress note mostly in English                | Reminder, never blocked     |
| Chinese with English terms, code, paths and URLs | Allowed                     |
| A short reply (`OK, done. Tests pass.`)          | Allowed: too short to judge |

## What the agent sees

For a final reply:

```text
This reply is mostly not in Chinese. Rewrite it in Chinese (code, commands, paths and technical terms may stay as they are) before ending the turn, and write the rest of this turn's progress notes in Chinese too.
```

For a progress note:

```text
The last progress note shown to the user was mostly not in Chinese. Write user-facing text in Chinese (code, commands, paths and technical terms may stay as they are), starting with the next sentence.
```

## Install

Claude Code (2.1.292 or later), one command:

```bash
claude plugin install reply-language --marketplace Adonis0123/adonis-skills
```

Codex:

```bash
codex plugin marketplace add Adonis0123/adonis-skills
codex plugin add reply-language@adonis-skills
```

Codex skips plugin hooks until you trust them: open Codex, run `/hooks` and trust this plugin's hooks. Codex asks again after the script changes. In Codex only the Stop check takes effect.

Requires `python3` on `PATH`. Supports macOS, Linux and WSL; native Windows is not supported.

## Configure

| Variable                     | Meaning                                                                                                                               |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `REPLY_LANGUAGE`             | Target language, `zh` (also `zh-CN`, `zh_CN`). Wins over the `language` setting and the system. `off` or `none` turns the plugin off. |
| `REPLY_LANGUAGE_CHECK_STATE` | Optional directory for the per-session state. Default: `$CLAUDE_PLUGIN_DATA`, else `$TMPDIR/reply-language`.                          |

Most people need no setup: a `language` of `简体中文` in Claude Code, or a Chinese system language, is enough. To set it explicitly, put it in the environment Claude Code starts from, or in `settings.json`:

```json
{
  "env": {
    "REPLY_LANGUAGE": "zh"
  }
}
```

### Adding a language

Languages live in the `LANGUAGES` table at the top of `scripts/reply-language-check.py`, one line each: code, English name, a regular expression for the language's own script, and an optional "rival" script (another language written with the same characters, like kana for Chinese). Adding a language is adding a line plus test cases in `tests/`. Free-text names in the `language` setting map through `CHINESE_NAMES`; add the new language's names next to it. The thresholds were calibrated on Chinese only.

## Turning it off

```bash
claude plugin disable reply-language@adonis-skills
```

To turn it off for one session or one project, set `REPLY_LANGUAGE=off`.

In Codex, run `codex plugin remove reply-language@adonis-skills`, or set `enabled = false` under `[plugins."reply-language@adonis-skills"]` in `~/.codex/config.toml`.

Cursor is not supported.

## Limitations

- Heuristic: a reply with few letters of either kind (short answers, mostly code) is never judged.
- A short Chinese reply that quotes a whole Japanese sentence can be blocked (under about 40 Han characters around 20 or more kana). Put the quote in backticks or a code block; quoted code is not measured.
- The agent decides how to rewrite; the plugin blocks at most once per turn, so a second off-language reply ends the turn.
- The PostToolUse reminder reads at most the last 4 MB of the transcript.
- In Codex it still reads Claude Code's `language` setting, because it uses the same order of sources.

## Tests

```bash
zsh plugins/reply-language/tests/reply-language-check.test.zsh   # needs python3 and jq
```
