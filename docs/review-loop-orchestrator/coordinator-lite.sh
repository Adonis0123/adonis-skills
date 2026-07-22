#!/usr/bin/env bash
# coordinator-lite v5 — Codex↔Claude 直连讨论的唯一驱动者与账本写者
# 权威规格: tmp/relay/20260714-1608-讨论机制合并三方辩论.md（v3 合并规格）+ Codex review 四修复（2026-07-14）
# 用法: coordinator-lite.sh <ledger.md 路径(必须位于本目录)> [max_exchanges<=3] [first_speaker=codex|opus]
# v4: TAIL fail-closed / 整票 deadline / 路径规范化 / 内容合同注入 / 懒孵化 / 增量阅读
# v5(Codex二轮review): CONSENSUS须绑定提案对象+CONSENSUS_REF机械核对 / NEEDS_EVIDENCE终态 /
#     可选盲开局(BLIND_OPENING=1) / kickoff framing 缺失警告。命名：用户控制下的双模型讨论。
set -uo pipefail

RELAY_DIR="$(cd "$(dirname "$0")" && pwd)"
RAW_LEDGER="${1:?need ledger file}"
MAX_EXCHANGES="${2:-3}"
SPEAKER="${3:-codex}"
TURN_TIMEOUT="${TURN_TIMEOUT:-600}"
TICKET_DEADLINE="${TICKET_DEADLINE:-1800}"
MAX_PARALLEL="${MAX_PARALLEL:-4}"
GLOBAL_STOP="$RELAY_DIR/CHANNEL_OFF"
CODEX_KEYS_FILE="$HOME/.codex/codex-keys.txt"
UUID_RE='[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'
START_TS=$(date +%s)

# ── 修复3: 路径规范化 + 目录限制（防别名绕锁/账本逃逸）──
LEDGER=$(python3 -c "import os,sys;print(os.path.realpath(sys.argv[1]))" "$RAW_LEDGER")
case "$LEDGER" in
  "$RELAY_DIR"/*.md) : ;;
  *) echo "拒绝：账本必须位于 $RELAY_DIR/ 下的 .md（收到: ${LEDGER}）" >&2; exit 2 ;;
esac
[ -f "$LEDGER" ] || { echo "拒绝：账本不存在（需先写 kickoff）: $LEDGER" >&2; exit 2; }

# 硬上界：单票最多 3 来回；深度讨论=多张 Boss 逐次授权的票
if [ "$MAX_EXCHANGES" -gt 3 ] 2>/dev/null; then echo "拒绝：单票上限 3 来回（DEEP=多张授权票）" >&2; exit 2; fi
[ "$MAX_EXCHANGES" -lt 1 ] 2>/dev/null && MAX_EXCHANGES=1

ts() { date '+%m-%d %H:%M'; }
append_block() { { printf '\n## @%s · %s · %s\n\n' "$1" "$(ts)" "$2"; printf '%s\n' "$3"; } >> "$LEDGER"; }
die_block() { append_block "coordinator" "$1" "$2"; exit "${3:-1}"; }

# ── 每账本一把可回收锁（键=规范化路径 hash）+ 并行软上限 ──
hash=$(printf '%s' "$LEDGER" | shasum | cut -c1-12)
LOCK="$RELAY_DIR/.lock-$hash"
active=$(ls -d "$RELAY_DIR"/.lock-* 2>/dev/null | wc -l | tr -d ' ')
if mkdir "$LOCK" 2>/dev/null; then echo $$ > "$LOCK/pid"; else
  oldpid=$(cat "$LOCK/pid" 2>/dev/null || echo 0)
  if kill -0 "$oldpid" 2>/dev/null; then echo "本账本已有讨论进行中(pid=$oldpid)" >&2; exit 2; fi
  echo "回收死锁(pid=$oldpid)" >&2; rm -rf "$LOCK"; mkdir "$LOCK"; echo $$ > "$LOCK/pid"
fi
trap 'rm -rf "$LOCK"' EXIT
[ "$active" -ge "$MAX_PARALLEL" ] && die_block "拒绝启动" "并行讨论已达软上限 MAX_PARALLEL=${MAX_PARALLEL}。" 2

export CODEX_CHANNEL_KEY=$(grep -oE 'sk-[A-Za-z0-9_-]+' "$CODEX_KEYS_FILE" | sed -n 1p)

# v5: kickoff framing 合同（缺失只警告不拒绝——smoke/特殊票合法）
if ! grep -q '用户原话' "$LEDGER"; then
  append_block "coordinator" "注记·framing" "kickoff 未含【用户原话】字段。framing 合同建议七要素：用户原话(逐字)/需要决定的问题/已知事实/尚未验证的假设/发起方观点(单独标记,不得混入事实)/范围与禁止事项/证据路径。本场继续，记录在案。"
fi

ticket_left() { echo $(( TICKET_DEADLINE - ($(date +%s) - START_TS) )); }

# run_to <max-sec> <outfile> <cmd...>：0 完成 / 1 超时或失败 / 2 STOP / 3 整票超时
run_to() {
  local limit=$1 out=$2; shift 2
  ( "$@" > "$out" 2>&1 ) & local pid=$! waited=0
  while kill -0 "$pid" 2>/dev/null; do
    [ "$(ticket_left)" -le 0 ] && { kill "$pid" 2>/dev/null; return 3; }
    [ "$waited" -ge "$limit" ] && { kill "$pid" 2>/dev/null; return 1; }
    { [ -f "$GLOBAL_STOP" ] || [ -f "$LEDGER.STOP" ]; } && { kill "$pid" 2>/dev/null; return 2; }
    sleep 5; waited=$((waited+5))
  done
  wait "$pid"
}

# ── 修复4: 内容合同全量（条件式四条 + user-relevant 反压制权利）──
CONTRACT="内容合同（条件式）：①归因对方立场须引用手号+最短唯一原文，引用不实转 OPEN-待补引（允许补一次，只暂停依赖该引用的判断）；②基于证据推理时分离【原始证据/证据解释/新增观点】，纯新提案免模板；③未决事项显式记 OPEN，预算耗尽不得折算共识；未经对方复核的候选结论逐项标 UNREVIEWED；④你可对任一 OPEN 标 user-relevant（Boss 必须看到）——对方与汇总者均不得静默降级。⑤判断需外部证据才能裁决时：末行用 TAIL: NEEDS_EVIDENCE，正文写明缺什么证据/去哪查/它将决定哪个 OPEN——不得在缺证据时靠记忆继续互相说服；⑥提出共识时正文必须含一行 CONSENSUS_PROPOSAL <ID>（如 P1）并给出对象四要素（接受的决定/保留的 OPEN/未验证假设/用户影响），末行 TAIL: CONSENSUS；确认对方提案时末行用 TAIL: CONSENSUS_REF=<ID>，且仅当你确认的正是该对象。只讨论不实施。最后一个非空行必须恰为一行：TAIL: CONTINUE|CONSENSUS|CONSENSUS_REF=<ID>|NEEDS_USER|NEEDS_EVIDENCE|BLOCKED|ROTATE_REQUESTED（严格格式，其后不得再有正文）"

BOOT_RULES="你是本场讨论专属的通道会话（账本：${LEDGER} ）。每次被唤醒按 baton 指示阅读账本并只输出讨论回应正文（不寒暄不复述）。${CONTRACT}"

OPUS_CHANNEL=""; CODEX_CHANNEL=""; PAIR_NOTED=""

# ── UX1 懒孵化（首手=建会话+发言合一）+ UX2 增量阅读 ──
invoke_speaker() { # $1=speaker -> 0/1/2/3
  OUT=$(mktemp); RAW=$(mktemp); local rc
  local read_scope="通读账本全文"
  if [ "$1" = codex ] && [ -n "$CODEX_CHANNEL" ]; then read_scope="只读你上次发言之后新增的块（核对引用时可回读全文）"; fi
  if [ "$1" = opus ] && [ -n "$OPUS_CHANNEL" ]; then read_scope="只读你上次发言之后新增的块（核对引用时可回读全文）"; fi
  local baton="接力 · ${read_scope}：${LEDGER} · 你是@$1通道会话，针对最新一块给出讨论回应。${CONTRACT}"
  if [ "$1" = codex ]; then
    if [ -z "$CODEX_CHANNEL" ]; then
      run_to "$TURN_TIMEOUT" "$RAW" codex exec -s read-only -c 'model_providers.OpenAI.env_key="CODEX_CHANNEL_KEY"' \
        --skip-git-repo-check -o "$OUT" "${BOOT_RULES} 现在执行你的第一手：${baton}"; rc=$?
      [ $rc -eq 0 ] && CODEX_CHANNEL=$(grep -m1 -iE "session id" "$RAW" | grep -oE "$UUID_RE" | head -1)
    else
      run_to "$TURN_TIMEOUT" "$RAW" codex exec -s read-only -c 'model_providers.OpenAI.env_key="CODEX_CHANNEL_KEY"' \
        --skip-git-repo-check -o "$OUT" resume "$CODEX_CHANNEL" "$baton"; rc=$?
    fi
  else
    if [ -z "$OPUS_CHANNEL" ]; then
      run_to "$TURN_TIMEOUT" "$RAW" claude -p "${BOOT_RULES} 现在执行你的第一手：${baton}" \
        --allowedTools "Read,Grep,Glob" --output-format json; rc=$?
    else
      run_to "$TURN_TIMEOUT" "$RAW" claude -p --resume "$OPUS_CHANNEL" --allowedTools "Read,Grep,Glob" \
        --output-format json "$baton"; rc=$?
    fi
    if [ "${rc:-1}" -eq 0 ]; then
      [ -z "$OPUS_CHANNEL" ] && OPUS_CHANNEL=$(python3 -c "import json;print(json.load(open('$RAW')).get('session_id',''))" 2>/dev/null)
      python3 -c "import json;print(json.load(open('$RAW')).get('result',''))" > "$OUT" 2>/dev/null
    fi
  fi
  rm -f "$RAW"
  [ "${rc:-1}" -eq 2 ] && return 2
  [ "${rc:-1}" -eq 3 ] && return 3
  { [ "${rc:-1}" -ne 0 ] || [ ! -s "$OUT" ]; } && return 1
  if [ -z "$PAIR_NOTED" ] && [ -n "$OPUS_CHANNEL" ] && [ -n "$CODEX_CHANNEL" ]; then
    PAIR_NOTED=1
    append_block "coordinator" "通道就位（懒孵化）" "本场专属会话对：@opus=${OPUS_CHANNEL} @codex=${CODEX_CHANNEL}（讨论独占，用后即弃）。票=${MAX_EXCHANGES}来回，整票deadline=${TICKET_DEADLINE}s。"
  fi
  return 0
}

# ── 修复1: TAIL fail-closed——最后一个非空行必须恰为 TAIL 行 ──
parse_tail() {
  tail -20 "$1" | sed -e 's/[[:space:]]*$//' | grep -v '^$' | tail -1 \
    | grep -oE '^TAIL: (CONTINUE|CONSENSUS|CONSENSUS_REF=[A-Za-z0-9_-]+|NEEDS_USER|NEEDS_EVIDENCE|BLOCKED|ROTATE_REQUESTED)$' | sed 's/^TAIL: //'
}

turns=$((MAX_EXCHANGES * 2))
PENDING_ID=""; PENDING_SPEAKER=""
BLIND_OPENING="${BLIND_OPENING:-0}"
START_I=1
if [ "$BLIND_OPENING" = 1 ] && [ "$turns" -ge 2 ]; then
  # 盲开局：双方基于同一份冻结 kickoff 独立作答，coordinator 收齐后同时公开
  other=$([ "$SPEAKER" = codex ] && echo opus || echo codex)
  invoke_speaker "$SPEAKER"; rc=$?
  [ $rc -ne 0 ] && { case $rc in 2) die_block "STOPPED" "STOP 于盲开局 @${SPEAKER} 手。" 0;; 3) die_block "停·DEADLINE" "整票 deadline 于盲开局到达。" 0;; *) die_block "DELIVERY_UNKNOWN" "盲开局 @${SPEAKER} 手失败，停机不重试。" 1;; esac; }
  OUT1="$OUT"; OUT=""
  invoke_speaker "$other"; rc=$?
  [ $rc -ne 0 ] && { rm -f "$OUT1"; case $rc in 2) die_block "STOPPED" "STOP 于盲开局 @${other} 手。" 0;; 3) die_block "停·DEADLINE" "整票 deadline 于盲开局到达。" 0;; *) die_block "DELIVERY_UNKNOWN" "盲开局 @${other} 手失败（@${SPEAKER} 手已收但未公开，一并作废）。" 1;; esac; }
  OUT2="$OUT"
  append_block "coordinator" "盲开局公开" "以下两手为独立盲答（互相不可见后同时公开）。"
  append_block "${SPEAKER}(auto·盲)" "coordinator 第 1/$turns 手" "$(cat "$OUT1")"
  append_block "${other}(auto·盲)" "coordinator 第 2/$turns 手" "$(cat "$OUT2")"
  t1=$(parse_tail "$OUT1"); t2=$(parse_tail "$OUT2"); rm -f "$OUT1" "$OUT2"
  for bt in "1:$SPEAKER:$t1" "2:$other:$t2"; do
    bi="${bt%%:*}"; rest="${bt#*:}"; bs="${rest%%:*}"; btail="${rest#*:}"
    if [ -z "$btail" ]; then die_block "停·PROTOCOL_ERROR" "盲开局第 ${bi} 手（@${bs}）末行不是合法 TAIL。" 1; fi
    case "$btail" in
      NEEDS_USER)     die_block "停·NEEDS_USER" "盲开局第 ${bi} 手（@${bs}）NEEDS_USER。" 0 ;;
      NEEDS_EVIDENCE) die_block "停·NEEDS_EVIDENCE" "盲开局第 ${bi} 手（@${bs}）NEEDS_EVIDENCE，详见该手正文。" 0 ;;
      BLOCKED)        die_block "停·BLOCKED" "盲开局第 ${bi} 手（@${bs}）BLOCKED。" 0 ;;
      *) : ;; # CONTINUE/CONSENSUS*：盲答阶段不建立 pending（双方未见彼此），交叉质疑阶段重新提出
    esac
  done
  START_I=3
fi
if [ "$START_I" -gt "$turns" ]; then
  die_block "停·预算用尽" "盲开局已消耗全部 ${MAX_EXCHANGES} 来回预算（盲票至少建议 2 来回以包含交叉质疑）。继续需 Boss 新票。" 0
fi
for i in $(seq "$START_I" "$turns"); do
  [ "$i" -lt "$START_I" ] || [ "$i" -gt "$turns" ] && break  # BSD seq 反向防御
  [ -f "$GLOBAL_STOP" ] && die_block "STOPPED" "全局 CHANNEL_OFF 触发，中止于第 $i 手前。" 0
  [ -f "$LEDGER.STOP" ] && die_block "STOPPED" "本讨论 STOP 触发，中止于第 $i 手前。" 0
  # 修复2: 整票 deadline
  [ "$(ticket_left)" -le 0 ] && die_block "停·DEADLINE" "整票 deadline(${TICKET_DEADLINE}s) 已到，中止于第 $i 手前。未决以账本现状为准。" 0

  invoke_speaker "$SPEAKER"; rc=$?
  case $rc in
    2) die_block "STOPPED" "STOP 于 @${SPEAKER} 第 $i 手调用中触发，已杀进程，该手作废。" 0 ;;
    3) die_block "停·DEADLINE" "整票 deadline(${TICKET_DEADLINE}s) 于 @${SPEAKER} 第 $i 手中到达，已杀进程，该手作废。" 0 ;;
    1) # 休眠重试语义（合并规格，未激活）：仅可机械证明"未投递且 same-input retryable"允许重试一次；
       # 当前 launcher 无投递阶段证据，故一切失败停机。激活门=阶段证据可用。
       die_block "DELIVERY_UNKNOWN" "@${SPEAKER} 第 $i 手失败/超时(${TURN_TIMEOUT}s)/空输出。灰区纪律：停机不重试。" 1 ;;
  esac

  append_block "$SPEAKER(auto)" "coordinator 第 $i/$turns 手" "$(cat "$OUT")"
  tail_line=$(parse_tail "$OUT")
  proposal_id=$(grep -oE 'CONSENSUS_PROPOSAL[[:space:]]+[A-Za-z0-9_-]+' "$OUT" | head -1 | awk '{print $2}')
  rm -f "$OUT"
  if [ -z "$tail_line" ]; then
    die_block "停·PROTOCOL_ERROR" "@${SPEAKER} 第 $i 手末行不是合法 TAIL（fail-closed，不猜测意图）。该手内容已如实入账；人工裁量后可重新发起。" 1
  fi
  case "$tail_line" in
    CONSENSUS)
      if [ -z "$proposal_id" ]; then
        PENDING_ID=""; PENDING_SPEAKER=""
        append_block "coordinator" "注记" "@${SPEAKER} 第 $i 手 CONSENSUS 未绑定 CONSENSUS_PROPOSAL 对象——不进入 pending（v5 合同：共识必须绑定对象）。按 CONTINUE 处理。"
      else
        PENDING_ID="$proposal_id"; PENDING_SPEAKER="$SPEAKER"
        append_block "coordinator" "注记" "@${SPEAKER} 提出共识提案 ${proposal_id}（pending，待另一方 TAIL: CONSENSUS_REF=${proposal_id} 确认；其他 TAIL 使其失效）。"
      fi ;;
    CONSENSUS_REF=*)
      ref="${tail_line#CONSENSUS_REF=}"
      if [ -n "$PENDING_ID" ] && [ "$ref" = "$PENDING_ID" ] && [ "$PENDING_SPEAKER" != "$SPEAKER" ]; then
        die_block "收口·CONSENSUS双确认" "共识对象 ${PENDING_ID} 经 ${PENDING_SPEAKER} 提出、${SPEAKER} 引用确认（第 $i 手正式收口）。双方确认的是同一份决定。" 0
      fi
      append_block "coordinator" "注记" "@${SPEAKER} 的 CONSENSUS_REF=${ref} 无匹配 pending 提案（当前=${PENDING_ID:-无}/提案方=${PENDING_SPEAKER:-无}）——协议瑕疵记录在案，pending 清空，按 CONTINUE 处理。"
      PENDING_ID=""; PENDING_SPEAKER="" ;;
    NEEDS_USER)     die_block "停·NEEDS_USER" "讨论停于 NEEDS_USER（第 $i 手）：需 Boss 决策后重新发起。" 0 ;;
    NEEDS_EVIDENCE) die_block "停·NEEDS_EVIDENCE" "讨论停于 NEEDS_EVIDENCE（第 $i 手）：所缺证据/取证路径/受影响 OPEN 见该手正文。由正常交互窗口取证后，Boss 授权下一张票。" 0 ;;
    BLOCKED)          die_block "停·BLOCKED" "讨论停于 BLOCKED（第 $i 手）。" 0 ;;
    ROTATE_REQUESTED) die_block "停·ROTATE" "@${SPEAKER} 请求轮换（第 $i 手）——会话一场一换，视同人工介入。" 0 ;;
    CONTINUE)         PENDING_ID=""; PENDING_SPEAKER="" ;;
  esac
  [ "$SPEAKER" = codex ] && SPEAKER=opus || SPEAKER=codex
done
if [ -n "$PENDING_ID" ]; then
  die_block "停·共识提议未确认" "预算用尽时提案 ${PENDING_ID}（@${PENDING_SPEAKER}）未获对方 CONSENSUS_REF 确认——记为共识提议·UNREVIEWED，不升格。继续需 Boss 新票。" 0
fi
die_block "停·预算用尽" "回合预算用尽（${MAX_EXCHANGES} 来回）。继续需 Boss 重新发起。" 0
