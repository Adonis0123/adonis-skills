#!/usr/bin/env bash
# 开一个新接力文件，并打印它的路径。
# 无 CURRENT 指针 —— 用文件名寻址（见 PROTOCOL.md）。
# 用法:
#   tmp/relay/new-relay.sh "<主题>"
# 把打印出的路径放进 baton 发给两边：
#   接力 · 读 tmp/relay/<该文件>.md · <指令>
set -euo pipefail
dir="$(cd "$(dirname "$0")" && pwd)"
slug="$(printf '%s' "${1:-relay}" | tr ' /' '__')"
ts="$(date +%Y%m%d-%H%M)"
name="${ts}-${slug}.md"

cat > "$dir/$name" <<EOF
# 接力 · ${ts} · ${slug}

> Append-only。新消息追加到文件末尾。格式：\`## @opus|@codex|@grok|@me · MM-DD HH:MM\` + 内容。
> 寻址靠文件名，无 CURRENT 指针。规则见 tmp/relay/PROTOCOL.md。可选第三席 @grok。

STATE: 批次=新建 | 球=@me(分工/首轮指令) | 阻塞=无 | 已定稿=无

---
EOF

printf 'tmp/relay/%s\n' "$name"
