#!/usr/bin/env python3
"""reply-language-check.py — keep user-facing replies in the language named by REPLY_LANGUAGE.

Stop (default): block once when the final reply to the user is mostly not in the target language.
PostToolUse (--event post-tool-use): when the latest progress note the user already saw (the text of
the latest reply in the transcript) is mostly not in the target language, add a reminder to the
model's context. It never blocks, and judges each reply once.

The target language comes only from the environment variable REPLY_LANGUAGE (for example `zh`).
When it is unset or names a language missing from LANGUAGES, the hook does nothing: exit 0, no output.

Measures prose only: code blocks, inline code, URLs and paths are removed first, so a reply full of
commands and file names in the target language still passes. A reply fails when, in what is left,
  1. Latin letters >= MIN_LATIN and Latin letters > RATIO x target-script characters, or
  2. the language lists a rival script (one another language writes next to the same characters),
     rival characters >= MIN_RIVAL and rival characters >= RIVAL_SHARE x target-script characters.
Rule 1 was calibrated on real Chinese replies: they stayed at or below 1.6 Latin letters per CJK
character, English ones were at 24 or more. Rule 2 catches Japanese for `zh`: Japanese prose writes
more kana than kanji (kanji-heavy technical text still has well over half as much kana), while a
Chinese reply quoting a Japanese word or phrase has a handful of kana against hundreds of Han.

Blocks at most once per turn: the retry after its own block is allowed (state below); a retry after
another hook's block (stop_hook_active set by someone else) is still judged. Every error, missing
field or short message allows the stop: exit 0, no output. No network, no model.
Block = {"decision":"block","reason":"..."} on stdout. Progress notes are shorter, so they count from
NOTE_MIN_LATIN letters and NOTE_MIN_RIVAL rival characters.

Field names are read in snake_case (Claude Code) and camelCase (other hosts that send the same hook
payload), for example last_assistant_message / lastAssistantMessage.

Usage: reply-language-check.py [--event stop|post-tool-use]
Env:   REPLY_LANGUAGE=zh                 target language; unset disables the hook
       REPLY_LANGUAGE_CHECK_STATE=DIR    state directory (default $CLAUDE_PLUGIN_DATA,
                                         else $TMPDIR/reply-language)
"""
import hashlib
import json
import os
import re
import sys
import tempfile
from typing import NamedTuple, Optional, Pattern, Tuple


class Language(NamedTuple):
    name: str                       # English name used in the messages
    target: Pattern[str]            # characters of the language's own script
    rival: Optional[Pattern[str]]   # a script that marks another language written with the same characters


# One line per language. Adding a language is adding a line; only `zh` is supported so far.
LANGUAGES = {
    # Han ideographs; rival = hiragana, katakana (without the middle dot U+30FB) and half-width katakana.
    "zh": Language("Chinese", re.compile(r"[㐀-鿿豈-﫿]"), re.compile(r"[ぁ-ゖァ-ヺーｦ-ﾝ]")),
}

MIN_LATIN = 60
NOTE_MIN_LATIN = 30
RATIO = 3
MIN_RIVAL = 20
NOTE_MIN_RIVAL = 10
RIVAL_SHARE = 0.5
TRANSCRIPT_TAIL_BYTES = 4 * 1024 * 1024
# The path branch starts only at a word start (lookbehind), so a long word without `/` is scanned once,
# not once from every character (quadratic).
EXEMPT = re.compile(r"```.*?```|`[^`\n]*`|https?://\S+|(?<![A-Za-z0-9_.@~/-])(?:~|\.{1,2})?/?[A-Za-z0-9_.@-]+(?:/[A-Za-z0-9_.@-]+)+/?", re.S)
LATIN = re.compile(r"[A-Za-z]")
KEEP = "code, commands, paths and technical terms may stay as they are"
REASON = ("This reply is mostly not in {name}. Rewrite it in {name} (" + KEEP + ") before ending the turn, "
          "and write the rest of this turn's progress notes in {name} too.")
NOTE_REMINDER = ("The last progress note shown to the user was mostly not in {name}. Write user-facing text in "
                 "{name} (" + KEEP + "), starting with the next sentence.")


def target_language() -> Optional[Language]:
    """The Language for REPLY_LANGUAGE (`zh`, `zh-CN` and `zh_CN` all mean `zh`), or None."""
    value = os.environ.get("REPLY_LANGUAGE", "").strip().lower().replace("_", "-")
    return LANGUAGES.get(value.split("-")[0]) if value else None


def state_dir() -> str:
    return (os.environ.get("REPLY_LANGUAGE_CHECK_STATE") or os.environ.get("CLAUDE_PLUGIN_DATA")
            or os.path.join(tempfile.gettempdir(), "reply-language"))


def off_target(text: str, lang: Language, min_latin: int = MIN_LATIN, min_rival: int = MIN_RIVAL) -> bool:
    prose = EXEMPT.sub(" ", text)
    target = len(lang.target.findall(prose))
    latin = len(LATIN.findall(prose))
    if latin >= min_latin and latin > RATIO * target:
        return True
    rival = len(lang.rival.findall(prose)) if lang.rival else 0
    return rival >= min_rival and rival >= RIVAL_SHARE * target


def latest_note(transcript_path: str) -> Tuple[Optional[str], str]:
    """(message id, text) of the latest reply in the transcript that has text, or (None, "").

    The transcript stores each content block of a reply as its own line, all sharing message.id.
    A reply's lines reach the file only after its tool calls' PostToolUse hooks have run, so this
    sees the reply before the current one: the reminder arrives one tool call late.
    """
    with open(transcript_path, "rb") as f:
        f.seek(0, 2)
        f.seek(max(0, f.tell() - TRANSCRIPT_TAIL_BYTES))
        lines = f.read().splitlines()
    latest, texts = None, []
    for line in lines:
        try:
            entry = json.loads(line)
        except ValueError:
            continue
        message = entry.get("message") if entry.get("type") == "assistant" else None
        if not (isinstance(message, dict) and isinstance(message.get("content"), list)):
            continue
        for block in message["content"]:
            if isinstance(block, dict) and block.get("type") == "text" and block.get("text"):
                if message.get("id") != latest:
                    latest, texts = message.get("id"), []
                texts.append(block["text"])
    return latest, "\n".join(texts)


def post_tool_use(data: dict, lang: Language) -> None:
    path = data.get("transcript_path", data.get("transcriptPath"))
    if not isinstance(path, str):
        return
    message_id, text = latest_note(path)
    if not message_id:
        return
    # Remember the last reply judged for this transcript, so a reply is reminded about only once.
    directory = state_dir()
    seen = os.path.join(directory, hashlib.sha256(path.encode()).hexdigest()[:32])
    try:
        with open(seen, encoding="utf-8") as f:
            if f.read() == message_id:
                return
    except OSError:
        pass
    os.makedirs(directory, exist_ok=True)
    with open(seen, "w", encoding="utf-8") as f:
        f.write(message_id)
    if off_target(text, lang, NOTE_MIN_LATIN, NOTE_MIN_RIVAL):
        print(json.dumps({"hookSpecificOutput": {"hookEventName": "PostToolUse",
                                                 "additionalContext": NOTE_REMINDER.format(name=lang.name)}}))


def stop(data: dict, lang: Language) -> None:
    """Block a final reply mostly not in the target language, at most once per turn.

    stop_hook_active only says that some Stop hook blocked before, not which one. When another hook
    blocked first, the retry is still judged; only the retry after this hook's own block is let
    through. That needs a session key (transcript_path or session_id) to remember the block; without
    one, any retry is let through.
    """
    active = data.get("stop_hook_active", data.get("stopHookActive")) in (True, "true")
    key = data.get("transcript_path") or data.get("transcriptPath") or data.get("session_id") or data.get("sessionId")
    directory = state_dir()
    marker = (os.path.join(directory, "stop-" + hashlib.sha256(key.encode()).hexdigest()[:32])
              if isinstance(key, str) and key else None)
    if active and (marker is None or os.path.exists(marker)):
        if marker:
            os.remove(marker)
        return
    message = data.get("last_assistant_message", data.get("lastAssistantMessage"))
    if isinstance(message, str) and off_target(message, lang):
        if marker:
            os.makedirs(directory, exist_ok=True)
            open(marker, "w").close()
        print(json.dumps({"decision": "block", "reason": REASON.format(name=lang.name)}))
    elif marker and os.path.exists(marker):
        os.remove(marker)


def main() -> int:
    lang = target_language()
    if lang is None:
        return 0
    try:
        data = json.loads(sys.stdin.read() or "{}")
    except ValueError:
        return 0
    if not isinstance(data, dict):
        return 0
    args = sys.argv[1:]
    if "--event=post-tool-use" in args or any(a == "--event" and b == "post-tool-use" for a, b in zip(args, args[1:])):
        post_tool_use(data, lang)
    else:
        stop(data, lang)
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception:  # noqa: BLE001 - a broken check must never block a stop
        sys.exit(0)
