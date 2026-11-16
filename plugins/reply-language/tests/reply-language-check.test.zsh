#!/bin/zsh
# Tests for reply-language-check.py (Stop: block once when the final reply is mostly not in REPLY_LANGUAGE;
# PostToolUse: remind once about a progress note in another language).
# Run: zsh plugins/reply-language/tests/reply-language-check.test.zsh   (needs python3 and jq)

set -u
script_dir="${0:A:h}"
hook="${script_dir:h}/scripts/reply-language-check.py"
fail() { print -u2 -- "FAIL: $1"; exit 1 }
assert_equal() { [[ "$2" == "$1" ]] || fail "$3 (expected=$1 actual=$2)" }

[[ -f $hook ]] || fail "missing $hook"

work=$(mktemp -d "${TMPDIR:-/tmp}/reply-language-test.XXXXXX"); trap 'rm -rf "$work"' EXIT
unset CLAUDE_PLUGIN_DATA
export REPLY_LANGUAGE=zh REPLY_LANGUAGE_CHECK_STATE="$work/state"

# run <message> [active] [camel] -> stdout of the hook; exit code must always be 0
run() {
  local msg=$1 active=${2:-false} camel=${3:-} payload out rc
  if [[ -n $camel ]]; then
    payload=$(jq -nc --arg m "$msg" --argjson a "$active" '{hookEventName:"stop",lastAssistantMessage:$m,stopHookActive:$a}')
  else
    payload=$(jq -nc --arg m "$msg" --argjson a "$active" '{hook_event_name:"Stop",last_assistant_message:$m,stop_hook_active:$a}')
  fi
  out=$(print -rn -- "$payload" | python3 "$hook"); rc=$?
  assert_equal 0 $rc "hook exit code ($msg)"
  print -rn -- "$out"
}
blocks() { [[ "$(run "$@" | jq -r '.decision' 2>/dev/null)" == block ]] }

english='All four automations are now fixed, and the projects page has buttons to deal with runs that need review. The one part still pending is a Grok review of the new page code.'
chinese_terms='Grok 复审已通过：config 仓 NO_FINDINGS，agents 仓 PASS。toast 改动晚于复审，agents 仓的 evidence 指纹变了，要补一轮 review。'
chinese_code='已改好，跑了下面的命令：
```bash
python3 -m unittest discover -s ~/.config/project-sync/tests --verbose and some long english output here
```
改动在 `project_sync/automations.py` 和 /srv/project-sync/web/index.html，见 https://example.com/some/long/english/path。'
japanese='設定ファイルを確認しました。テストはすべて通りましたので、このまま新しいブランチにプッシュしてもよろしいでしょうか。問題があれば教えてください。'
japanese_kanji='本変更は設定読込処理の不具合を修正し、起動時の初期化順序を整理したものです。既存の単体試験と結合試験は全件成功しており、性能面の劣化も確認されていません。'
chinese_quoting_japanese='日本那边的同事回复了一句「ご確認ありがとうございます。修正版をアップロードしましたので、もう一度ご確認ください」。意思是他们已经上传了修正版，请我们再确认一遍。我对比了两个版本的差异，只改了登录页的按钮文案和一处日期格式，其余逻辑没有变化。接下来我会在测试环境跑一遍完整的回归用例，确认没有问题后再合并到主分支，并在群里同步结果。'

# ── 1. a mostly English reply blocks, in both field namings ─────────────────
blocks "$english" || fail "English reply must block"
blocks "$english" false camel || fail "camelCase fields must be read"
reason=$(run "$english" | jq -r .reason)
[[ $reason == *"mostly not in Chinese"* && $reason == *"Rewrite it in Chinese"* ]] || fail "block reason must name the language: $reason"

# ── 2. Chinese replies pass, even with many terms, code, paths and URLs ─────
assert_equal '' "$(run "$chinese_terms")" "Chinese with English terms allows"
assert_equal '' "$(run "$chinese_code")" "Chinese with code, paths and URLs allows"
assert_equal '' "$(run '```
'"$english"'
```')" "English inside a code block allows"

# ── 3. short replies are not judged ──────────────────────────────────────────
assert_equal '' "$(run 'OK, done. Tests pass.')" "short English allows"

# ── 4. the retry after a block is allowed (block at most once per turn) ─────
assert_equal '' "$(run "$english" true)" "stop_hook_active allows"
assert_equal '' "$(run "$english" true camel)" "stopHookActive allows"

# ── 5. bad input allows ──────────────────────────────────────────────────────
for bad in '' 'not json' '[]' '{"last_assistant_message": 42}'; do
  out=$(print -rn -- "$bad" | python3 "$hook"); assert_equal 0 $? "exit code for bad input: $bad"
  assert_equal '' "$out" "bad input allows: $bad"
done

# ── 5b. REPLY_LANGUAGE decides whether the hook runs at all ──────────────────
payload=$(jq -nc --arg m "$english" '{last_assistant_message:$m}')
out=$(print -rn -- "$payload" | env -u REPLY_LANGUAGE python3 "$hook"); rc=$?
assert_equal 0 $rc "unset REPLY_LANGUAGE exit code"
assert_equal '' "$out" "unset REPLY_LANGUAGE does nothing"
for value in '' fr ja xx; do
  out=$(print -rn -- "$payload" | REPLY_LANGUAGE=$value python3 "$hook"); rc=$?
  assert_equal 0 $rc "REPLY_LANGUAGE=$value exit code"
  assert_equal '' "$out" "unsupported REPLY_LANGUAGE=$value does nothing"
done
for value in zh-CN zh_CN ZH; do
  [[ "$(print -rn -- "$payload" | REPLY_LANGUAGE=$value python3 "$hook" | jq -r .decision)" == block ]] \
    || fail "REPLY_LANGUAGE=$value means zh"
done
out=$(jq -nc '{hook_event_name:"PostToolUse",transcript_path:"/nonexistent/t.jsonl"}' | env -u REPLY_LANGUAGE python3 "$hook" --event post-tool-use)
assert_equal '' "$out" "unset REPLY_LANGUAGE: PostToolUse does nothing"

# ── 5c. Japanese is not Chinese; a Japanese phrase inside Chinese is fine ────
blocks "$japanese" || fail "a Japanese reply must block"
blocks "$japanese_kanji" || fail "a kanji-heavy Japanese reply must block"
assert_equal '' "$(run "$chinese_quoting_japanese")" "Chinese quoting a Japanese sentence allows"
assert_equal '' "$(run '好的，这个按钮文案改成「よろしく」就行，其余部分保持不变，我这就去改。')" "Chinese with one Japanese word allows"
assert_equal '' "$(run '了解しました。確認します。')" "short Japanese allows"
assert_equal '' "$(run '日文原文如下：
```
'"$japanese"'
```')" "Japanese inside a code block allows"

# ── 6. PostToolUse: remind once about the latest reply's note when it is off-language ──
transcript="$work/transcript.jsonl"; export REPLY_LANGUAGE_CHECK_STATE="$work/note-state"
line() { jq -nc --arg id "$1" --argjson block "$2" '{type:"assistant",message:{id:$id,content:[$block]}}' >> "$transcript" }
text() { line "$1" "$(jq -nc --arg t "$2" '{type:"text",text:$t}')" }
call() { line "$1" "$(jq -nc --arg id "$2" '{type:"tool_use",id:$id,name:"Bash",input:{}}')" }
note() {
  local out rc
  out=$(jq -nc --arg p "$1" '{hook_event_name:"PostToolUse",transcript_path:$p,tool_use_id:"x"}' | python3 "$hook" --event post-tool-use); rc=$?
  assert_equal 0 $rc "post-tool-use exit code"
  print -rn -- "$out"
}
reminds() { [[ "$(note "$transcript" | jq -r .hookSpecificOutput.additionalContext 2>/dev/null)" == *"mostly not in Chinese"* ]] }

text m1 "I am checking the log first, then I will rerun the tests on the new branch."; call m1 t1
reminds || fail "an English note must remind"
assert_equal '' "$(note "$transcript")" "the same reply is judged only once"
call m2 t2
assert_equal '' "$(note "$transcript")" "a reply without text does not re-judge the older note"
text m3 "先看日志，再在新分支上重跑 tests 和 lint。"; call m3 t3
assert_equal '' "$(note "$transcript")" "a Chinese note does not remind"
text m4 "The verifier still flags this cell, so its rule probably differs from the reference cell."; call m4 t4
reminds || fail "a new English note reminds again"
text m5 "ログを確認してから、新しいブランチでテストをもう一度実行します。"; call m5 t5
reminds || fail "a Japanese note reminds"
assert_equal '' "$(note "$work/missing.jsonl")" "missing transcript does not remind"

# ── 7. a retry after ANOTHER hook's block is still judged; our own retry passes once ──
export REPLY_LANGUAGE_CHECK_STATE="$work/stop-state"
stop_s() { jq -nc --arg m "$1" --argjson a "$2" '{hook_event_name:"Stop",session_id:"s1",last_assistant_message:$m,stop_hook_active:$a}' | python3 "$hook" }
[[ "$(stop_s "$english" true | jq -r .decision)" == block ]] || fail "English after another hook's block must block"
assert_equal '' "$(stop_s "$english" true)" "the retry after our own block allows"
[[ "$(stop_s "$english" true | jq -r .decision)" == block ]] || fail "the marker is used once"
assert_equal '' "$(stop_s "$english" true)" "second retry allows again"
assert_equal '' "$(stop_s "$chinese_terms" true)" "Chinese after another hook's block allows"
[[ "$(stop_s "$english" false | jq -r .decision)" == block ]] || fail "fresh English stop blocks"
assert_equal '' "$(stop_s "$chinese_terms" false)" "a Chinese stop clears the marker"
[[ "$(stop_s "$english" true | jq -r .decision)" == block ]] || fail "cleared marker: retry is judged again"

# ── 8. state goes to $CLAUDE_PLUGIN_DATA when no override is set ─────────────
unset REPLY_LANGUAGE_CHECK_STATE
data_dir="$work/plugin-data"
out=$(jq -nc --arg m "$english" '{session_id:"s2",last_assistant_message:$m,stop_hook_active:false}' | CLAUDE_PLUGIN_DATA=$data_dir python3 "$hook")
[[ "$(print -rn -- "$out" | jq -r .decision)" == block ]] || fail "English stop with CLAUDE_PLUGIN_DATA blocks"
[[ -n "$(ls "$data_dir" 2>/dev/null)" ]] || fail "the stop marker must be written under CLAUDE_PLUGIN_DATA"
out=$(jq -nc --arg m "$english" '{session_id:"s2",last_assistant_message:$m,stop_hook_active:true}' | CLAUDE_PLUGIN_DATA=$data_dir python3 "$hook")
assert_equal '' "$out" "retry after own block with CLAUDE_PLUGIN_DATA allows"

# a long word without `/` must not make the path pattern quadratic (hook timeout is 10 s)
start=$SECONDS
out=$(python3 -c 'import json; print(json.dumps({"session_id":"s3","last_assistant_message":"a" * 200000}))' | REPLY_LANGUAGE_CHECK_STATE="$work/perf" python3 "$hook"); rc=$?
[[ $rc == 0 ]] && (( SECONDS - start < 3 )) || fail "200,000-letter word must finish fast"

print "reply-language-check: all tests passed"
