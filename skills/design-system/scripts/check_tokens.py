#!/usr/bin/env python3
"""设计系统自检：引用都能解析、每套主题深浅两种模式的关键文字对比度达标。

  python3 check_tokens.py <tokens.json>          # 全部通过退出 0，否则列出问题并退出 1
  python3 check_tokens.py <tokens.json> --css    # 另外打印每套主题的 CSS 变量，接入站点时用
"""
import json
import re
import sys
from pathlib import Path

ARGS = [a for a in sys.argv[1:] if not a.startswith("--")]
if not ARGS:
    sys.exit("用法：python3 check_tokens.py <tokens.json> [--css]")
TOKENS = json.loads(Path(ARGS[0]).read_text())
REF = re.compile(r"\{([a-z0-9-]+)\}")
MIX = re.compile(r"^color-mix\(in srgb, (#[0-9A-Fa-f]{6}) (\d+)%, (#[0-9A-Fa-f]{6}|transparent)\)$")

# 文字 / 底色 / 最低对比度。底色可以是“半透明色叠在某个底上”，写成 (角色, 叠在哪个角色上)
PAIRS = [
    ("foreground", "background", 4.5),
    ("foreground", "card", 4.5),
    ("muted-foreground", "card", 4.5),
    ("muted-foreground", "background", 4.5),
    # 有意低于 4.5：主按钮是饱和原色配白字、字重 500、胶囊圆角。原色加深到 4.5 会发灰，
    # 配近黑字又不好看；字节 Arco、Semi、即梦的实心按钮白字也在 3 左右。见 SKILL.md「按钮规则」
    ("primary-foreground", "primary", 3.0),
    ("link", "card", 4.5),
    ("accent-foreground", "accent", 4.5),
    ("nav-active-foreground", ("nav-active", "sidebar"), 4.5),
    ("foreground", "selected", 4.5),
    ("warning-text", "card", 4.5),
    ("danger-text", "card", 4.5),
    ("subtle-foreground", "card", 3.0),  # 只给占位符、提示这类非正文
]


def palette(theme, mode):
    p = {}
    for name, scale in TOKENS["scales"].items():  # neutral 必有，其余色阶按名字引用
        p.update({f"{name}-{i + 1}": v for i, v in enumerate(scale[mode])})
    p.update({f"fn-{k}": v for k, v in TOKENS["functional"].items() if k != "source"})
    t = TOKENS["themes"][theme]
    p.update({f"accent-{i + 1}": v for i, v in enumerate(t["scale"][mode])})
    pick = lambda v: v[mode] if isinstance(v, dict) else v  # 按钮色可深浅共用，也可写 {"light": …, "dark": …}
    p["accent-solid"], p["accent-solid-foreground"] = pick(t["solid"]), pick(t["solid-foreground"])
    return p


def resolve(theme, mode):
    """返回 {角色: 解析后的字符串}；解析不了的引用放进 errors。"""
    p, roles, errors = palette(theme, mode), TOKENS["roles"][mode], []
    out = {}

    def sub(m, role):
        key = m.group(1)
        if key in p:
            return p[key]
        if key in roles and key != role:
            return out.get(key) or REF.sub(lambda mm: sub(mm, key), roles[key])
        errors.append(f"{theme}/{mode} {role}：引用 {{{key}}} 不存在。改法：换成 tokens.json 里已有的色阶名或角色名")
        return "#000000"

    for role, value in roles.items():
        out[role] = REF.sub(lambda m: sub(m, role), value)
    return out, errors


def rgb(h):
    return [int(h[i:i + 2], 16) for i in (1, 3, 5)]


def solid(value, base=None):
    """把 #hex 或简单的 color-mix 算成实色；transparent 叠在 base 上。"""
    if value.startswith("#"):
        return value.upper()
    m = MIX.match(value)
    if not m:
        return None
    a, pct, b = m.group(1), int(m.group(2)) / 100, m.group(3)
    b = base if b == "transparent" else b
    if b is None:
        return None
    return "#" + "".join(f"{round(x * pct + y * (1 - pct)):02X}" for x, y in zip(rgb(a), rgb(b)))


def lum(h):
    def ch(v):
        v /= 255
        return v / 12.92 if v <= 0.04045 else ((v + 0.055) / 1.055) ** 2.4
    r, g, b = (ch(v) for v in rgb(h))
    return 0.2126 * r + 0.7152 * g + 0.0722 * b


def contrast(a, b):
    la, lb = sorted((lum(a), lum(b)), reverse=True)
    return (la + 0.05) / (lb + 0.05)


def main():
    problems, rows = [], []
    for theme in TOKENS["themes"]:
        for mode in ("light", "dark"):
            r, errors = resolve(theme, mode)
            problems += errors
            for fg, bg, need in PAIRS:
                if isinstance(bg, tuple):
                    bg_hex = solid(r[bg[0]], solid(r[bg[1]]))
                    bg_name = f"{bg[0]}（叠在 {bg[1]} 上）"
                else:
                    bg_hex, bg_name = solid(r[bg], solid(r["card"])), bg
                fg_hex = solid(r[fg])
                if not fg_hex or not bg_hex:
                    problems.append(f"{theme}/{mode} {fg} / {bg_name}：算不出实色。改法：文字角色写成 #hex 或色阶引用，底色只用 color-mix(in srgb, X p%, Y)")
                    continue
                c = contrast(fg_hex, bg_hex)
                rows.append(f"{theme:8} {mode:5} {fg:22} / {bg_name:28} {c:5.2f}")
                if c < need:
                    problems.append(f"{theme}/{mode} {fg} {fg_hex} 配 {bg_name} {bg_hex} 只有 {c:.2f}，要 ≥ {need}。改法：文字换更深（浅色）/更亮（深色）的一阶，或调低底色的彩色占比")
    if "--css" in sys.argv:
        for theme in TOKENS["themes"]:
            for mode in ("light", "dark"):
                sel = f'[data-accent="{theme}"]' + (".dark" if mode == "dark" else "")
                body = ";\n  ".join(f"--{k}: {v}" for k, v in resolve(theme, mode)[0].items())
                print(f"{sel} {{\n  {body};\n}}\n")
    print("\n".join(rows))
    if problems:
        print("\n不通过：")
        print("\n".join(f"- {p}" for p in problems))
        sys.exit(1)
    print(f"\n通过：{len(TOKENS['themes'])} 套主题 × 2 种模式，{len(rows)} 组对比度全部达标，引用全部可解析")


if __name__ == "__main__":
    main()
