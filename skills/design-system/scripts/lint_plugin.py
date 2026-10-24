#!/usr/bin/env python3
"""检查插件是否守主题契约：不写死色值、var() 不带后备色、只用设计系统里有的角色。

  python3 lint_plugin.py <插件目录或文件> [--tokens <tokens.json>]

有问题时逐条输出“文件:行 — 问题 — 改法”并退出 1。同一行写 design-system-ignore 可跳过（写明原因）。
"""
import json
import re
import sys
from pathlib import Path

EXTS = {".css", ".scss", ".less", ".ts", ".tsx", ".js", ".jsx", ".mjs", ".vue", ".svelte", ".html"}
SKIP_DIRS = {"node_modules", "dist", "build", ".git", ".next", "coverage", "generated"}
COLOR = re.compile(
    r"(?<![\w&/-])#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})\b(?![\w-])"
    r"|\b(?:rgba?|hsla?|oklch|oklab|lab|lch)\(\s*[\d.]"
)
VAR = re.compile(r"var\(\s*--([A-Za-z0-9_-]+)\s*(,)?")
IGNORE = "design-system-ignore"


def files(target):
    if target.is_file():
        yield target
        return
    for p in sorted(target.rglob("*")):
        if p.is_file() and p.suffix in EXTS and not SKIP_DIRS.intersection(p.parts) and not p.name.endswith((".test.ts", ".spec.ts")):
            yield p


def main():
    args = sys.argv[1:]
    if not args or args[0].startswith("--"):
        sys.exit("用法：python3 lint_plugin.py <插件目录或文件> [--tokens <tokens.json>]")
    target = Path(args[0])
    roles = None
    if "--tokens" in args:
        tokens = json.loads(Path(args[args.index("--tokens") + 1]).read_text())
        roles = set().union(*(set(r) for r in tokens["roles"].values()))
    problems = []
    for f in files(target):
        for n, line in enumerate(f.read_text(errors="ignore").splitlines(), 1):
            if IGNORE in line:
                continue
            for m in COLOR.finditer(line):
                problems.append(f"{f}:{n} — 写死了色值 {m.group(0).rstrip('( ')} — 换成语义角色 var(--<角色>)；确实要固定（如 logo）就在行尾注释 {IGNORE} 并写原因")
            for m in VAR.finditer(line):
                name = m.group(1)
                if m.group(2):
                    problems.append(f"{f}:{n} — var(--{name}, …) 带了后备色 — 删掉逗号后的值，让漏接主题时显眼地坏掉")
                if roles is not None and name not in roles:
                    problems.append(f"{f}:{n} — --{name} 不是设计系统的角色 — 换成 tokens.json roles 里已有的角色；确实缺就先在设计系统加角色")
    if problems:
        print("\n".join(problems))
        print(f"\n不通过：{len(problems)} 处。脚本只定位候选，logo、插画、截图里的颜色逐条判断。")
        sys.exit(1)
    print(f"通过：{target} 没有写死的色值、后备色" + ("或未知角色" if roles is not None else ""))


if __name__ == "__main__":
    main()
