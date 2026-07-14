#!/usr/bin/env python3
"""Lint copy-ready goal prompts for required labels and unsafe vagueness."""

from __future__ import annotations

import re
import sys
from pathlib import Path


REQUIRED_GROUPS = [
    ("command", [r"/goal"]),
    ("verification", [r"Verification[:：]", r"验证[:：]"]),
    ("constraints", [r"Constraints[:：]", r"约束[:：]"]),
    ("boundaries", [r"Boundaries[:：]", r"边界[:：]"]),
    ("execution strategy", [r"Execution strategy[:：]", r"执行编排[:：]"]),
    ("iteration policy", [r"Iteration policy[:：]", r"迭代策略[:：]"]),
    ("stop when", [r"Stop when[:：]", r"完成条件[:：]", r"停止条件[:：]"]),
    ("pause if", [r"Pause if[:：]", r"暂停条件[:：]", r"阻塞条件[:：]"]),
]

REQUIRED_PATTERNS = dict(REQUIRED_GROUPS)

PLACEHOLDERS = [
    r"\[[^\]]+\]",
    r"<[^>]+>",
    r"\bTODO\b",
    r"\bTBD\b",
    r"待补充",
    r"待定",
]

VAGUE_DANGERS = [
    r"make sure it works",
    r"edit anything",
    r"change whatever",
    r"keep trying",
    r"until it (looks|seems|feels) good",
    r"随便改",
    r"随意修改",
    r"一直尝试",
    r"直到满意",
    r"看起来不错就行",
    r"感觉可以",
]

EVIDENCE_WORDS = [
    r"\b(run|start|open|test|build|lint|typecheck|verify|inspect|capture|screenshot|log|artifact|file|url|api|browser|simulator|local)\b",
    r"(运行|启动|打开|测试|构建|检查|验证|读取|截图|日志|产物|文件|链接|接口|API|浏览器|模拟器|本地|证据)",
]

DELEGATION_ASSESSMENT_WORDS = [
    r"\b(assess|evaluate|decide|determine|judge|choose)\b",
    r"(评估|判断|决定|选择)",
]

DELEGATION_OPTION_WORDS = [
    r"\b(sub-?agent\w*|delegat\w*|single-agent|one agent)\b",
    r"(子代理|子智能体|单 agent|主 agent)",
]

MAIN_AGENT_WORDS = [r"\bmain agent\b", r"主 agent", r"主代理", r"主智能体"]

OWNERSHIP_WORDS = [
    r"\b(accountable|responsible|review|verify|verification|integrat)\w*\b",
    r"(负责|责任|审查|复核|验证|集成)",
]


def marker_content(text: str, patterns: list[str]) -> str | None:
    for pattern in patterns:
        match = re.search(rf"^{pattern}\s*(.+)$", text, re.IGNORECASE | re.MULTILINE)
        if match:
            return match.group(1).strip()
    return None


def lint_text(text: str, label: str) -> list[str]:
    errors: list[str] = []

    if re.search(r"^\s*/目标\b", text, re.MULTILINE):
        errors.append(f"{label}: use /goal, not /目标")

    for name, patterns in REQUIRED_GROUPS:
        if not any(re.search(pattern, text, re.IGNORECASE) for pattern in patterns):
            errors.append(f"{label}: missing {name}")

    for pattern in PLACEHOLDERS:
        if re.search(pattern, text, re.IGNORECASE):
            errors.append(f"{label}: unresolved placeholder matched {pattern}")

    for pattern in VAGUE_DANGERS:
        if re.search(pattern, text, re.IGNORECASE):
            errors.append(f"{label}: unsafe vague wording matched {pattern}")

    verification = marker_content(text, REQUIRED_PATTERNS["verification"])
    if verification and not any(re.search(pattern, verification, re.IGNORECASE) for pattern in EVIDENCE_WORDS):
        errors.append(f"{label}: verification should name concrete evidence")

    execution_strategy = marker_content(text, REQUIRED_PATTERNS["execution strategy"])
    if execution_strategy:
        assesses_delegation = any(
            re.search(pattern, execution_strategy, re.IGNORECASE)
            for pattern in DELEGATION_ASSESSMENT_WORDS
        ) and any(
            re.search(pattern, execution_strategy, re.IGNORECASE)
            for pattern in DELEGATION_OPTION_WORDS
        )
        if not assesses_delegation:
            errors.append(f"{label}: execution strategy should assess delegation")

        keeps_main_accountable = any(
            re.search(pattern, execution_strategy, re.IGNORECASE)
            for pattern in MAIN_AGENT_WORDS
        ) and any(
            re.search(pattern, execution_strategy, re.IGNORECASE)
            for pattern in OWNERSHIP_WORDS
        )
        if not keeps_main_accountable:
            errors.append(f"{label}: execution strategy should keep the main agent accountable")

    goal_line = next((line.strip() for line in text.splitlines() if line.strip().startswith("/goal")), "")
    if goal_line and len(goal_line.removeprefix("/goal").strip()) < 20:
        errors.append(f"{label}: /goal outcome is too short")

    return errors


def main(argv: list[str]) -> int:
    if len(argv) < 2:
        print("Usage: lint-goal-prompt.py <file> [<file> ...]", file=sys.stderr)
        return 2

    errors: list[str] = []
    for raw_path in argv[1:]:
        path = Path(raw_path)
        try:
            text = path.read_text(encoding="utf-8")
        except OSError as exc:
            errors.append(f"{path}: cannot read file: {exc}")
            continue
        errors.extend(lint_text(text, str(path)))

    if errors:
        for error in errors:
            print(error, file=sys.stderr)
        return 1

    print("Goal prompt lint passed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
