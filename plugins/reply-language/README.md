English | [中文](./README.zh-CN.md)

# reply-language

A Claude Code hook plugin that keeps the agent's user-facing replies in your language. Long, tool-heavy turns tend to drift into English even when your instructions say otherwise; this plugin catches that at the end of the turn and asks the agent to rewrite the reply.

**First release: only Chinese (`zh`) is supported.** Other values of `REPLY_LANGUAGE` make the plugin do nothing.

## What it does

- **Stop hook**: when the final reply is mostly not in the target language, it blocks the stop once with a reason such as "This reply is mostly not in Chinese. Rewrite it in Chinese (code, commands, paths and technical terms may stay as they are)…". The agent's retry is let through, so a turn is blocked at most once. A retry caused by another Stop hook's block is still judged.
- **PostToolUse hook**: when the latest progress note the user already saw is mostly not in the target language, it adds a reminder to the agent's context. It never blocks and judges each note once. The reminder arrives one tool call late, because a reply is written to the transcript after its tool calls finish.

Only prose is measured. Code blocks, inline code, URLs and paths are removed first, so a Chinese reply full of commands and file names passes. A reply fails when, in what is left:

1. Latin letters ≥ 60 (30 for progress notes) and Latin letters > 3 × Han characters; or
2. for `zh`: kana (hiragana and katakana) ≥ 20 (10 for progress notes) and kana ≥ 0.5 × Han characters. Japanese prose writes more kana than kanji, while a Chinese reply that quotes a Japanese word or sentence has a few kana against many Han characters, so it passes.

Every error, missing field or short message lets the stop through (exit 0, no output). No network, no model call.

## Install

```text
/plugin marketplace add Adonis0123/adonis-skills
/plugin install reply-language@adonis-skills
```

Requires `python3` on `PATH`.

## Configure

| Variable                     | Meaning                                                                                                                                     |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `REPLY_LANGUAGE`             | Target language. `zh` (also `zh-CN`, `zh_CN`). Unset or unsupported: the plugin does nothing. Claude Code's `language` setting is not read. |
| `REPLY_LANGUAGE_CHECK_STATE` | Optional directory for the per-session state. Default: `$CLAUDE_PLUGIN_DATA`, else `$TMPDIR/reply-language`.                                |

Set `REPLY_LANGUAGE` in the environment Claude Code starts from, or in `settings.json`:

```json
{
  "env": {
    "REPLY_LANGUAGE": "zh"
  }
}
```

To turn the plugin off, unset `REPLY_LANGUAGE` or disable the plugin with `/plugin`.

### Adding a language

Languages live in the `LANGUAGES` table at the top of `scripts/reply-language-check.py`, one line each: code, English name, a regular expression for the language's own script, and an optional "rival" script (another language written with the same characters, like kana for Chinese). Adding a language is adding a line plus test cases in `tests/`. The thresholds were calibrated on Chinese only.

## Codex (manual wiring)

Codex Stop hooks receive the same fields (`last_assistant_message`, `stop_hook_active`, `session_id`), so the Stop check works there too. Clone this repository and add a Stop entry to `~/.codex/hooks.json`:

```json
{
  "hooks": {
    "Stop": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "REPLY_LANGUAGE=zh python3 /path/to/adonis-skills/plugins/reply-language/scripts/reply-language-check.py",
            "timeout": 10
          }
        ]
      }
    ]
  }
}
```

- If your Codex version keeps hooks behind a feature flag, enable it in `~/.codex/config.toml` (`[features]` → `hooks = true`). Codex may ask you to trust a new hook before it runs.
- Wire only the Stop hook. The PostToolUse reminder reads Claude Code's transcript format.
- Without `CLAUDE_PLUGIN_DATA`, state goes to `$TMPDIR/reply-language`.

Cursor is not supported.

## Limitations

- Heuristic: a reply with few letters of either kind (short answers, mostly code) is never judged.
- A short Chinese reply that quotes a whole Japanese sentence can be blocked (under about 40 Han characters around 20 or more kana). Put the quote in backticks or a code block; quoted code is not measured.
- The agent decides how to rewrite; the plugin blocks at most once per turn, so a second off-language reply ends the turn.
- The PostToolUse reminder reads at most the last 4 MB of the transcript.

## Tests

```bash
zsh plugins/reply-language/tests/reply-language-check.test.zsh   # needs python3 and jq
```
