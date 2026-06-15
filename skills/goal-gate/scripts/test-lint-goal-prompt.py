#!/usr/bin/env python3
"""Minimal regression tests for lint-goal-prompt.py."""

from __future__ import annotations

import subprocess
import sys
import tempfile
from pathlib import Path


SCRIPT_DIR = Path(__file__).resolve().parent
LINTER = SCRIPT_DIR / "lint-goal-prompt.py"


VALID_GOAL = """/goal 创建第一版本地个人记账 App MVP，实现添加、查看、编辑和删除一笔收支记录的核心流程。
验证：运行项目提供的最小相关检查，启动本地应用，在浏览器中完整走通核心流程，并用命令输出、日志或截图作为证据。
约束：不接入真实银行、支付、账号系统、云同步、生产部署或金融建议。
边界：只写入新项目目录，或只修改现有项目中与记账核心流程直接相关的文件。
迭代策略：先做可运行核心流程，再根据检查结果和浏览器证据做最多 3 轮聚焦改进。
完成条件：本地核心记账流程可运行，验证证据已展示，检查通过或缺失配置已明确说明。
暂停条件：需要真实银行接口、账号凭证、付费服务、生产部署、法律/金融判断、敏感真实数据或产品范围决策时暂停。
"""


CASES = [
    {
        "name": "valid-goal",
        "text": VALID_GOAL,
        "returncode": 0,
        "stderr_contains": "",
    },
    {
        "name": "reject-chinese-command-prefix",
        "text": VALID_GOAL.replace("/goal", "/目标", 1),
        "returncode": 1,
        "stderr_contains": "use /goal",
    },
    {
        "name": "reject-placeholder",
        "text": VALID_GOAL.replace("创建第一版本地个人记账 App MVP", "[Outcome]", 1),
        "returncode": 1,
        "stderr_contains": "unresolved placeholder",
    },
    {
        "name": "reject-thin-verification",
        "text": VALID_GOAL.replace(
            "验证：运行项目提供的最小相关检查，启动本地应用，在浏览器中完整走通核心流程，并用命令输出、日志或截图作为证据。",
            "验证：确认可用。",
            1,
        ),
        "returncode": 1,
        "stderr_contains": "verification should name concrete evidence",
    },
]


def run_case(tmp_dir: Path, case: dict[str, object]) -> list[str]:
    path = tmp_dir / f"{case['name']}.txt"
    path.write_text(str(case["text"]), encoding="utf-8")

    result = subprocess.run(
        [sys.executable, str(LINTER), str(path)],
        check=False,
        capture_output=True,
        text=True,
    )

    errors: list[str] = []
    expected_returncode = int(case["returncode"])
    if result.returncode != expected_returncode:
        errors.append(
            f"{case['name']}: expected return code {expected_returncode}, got {result.returncode}",
        )

    expected_stderr = str(case["stderr_contains"])
    if expected_stderr and expected_stderr not in result.stderr:
        errors.append(
            f"{case['name']}: expected stderr to contain {expected_stderr!r}, got {result.stderr!r}",
        )

    if not expected_stderr and result.stderr:
        errors.append(f"{case['name']}: expected empty stderr, got {result.stderr!r}")

    return errors


def main() -> int:
    if not LINTER.exists():
        print(f"Missing linter: {LINTER}", file=sys.stderr)
        return 2

    errors: list[str] = []
    with tempfile.TemporaryDirectory() as raw_tmp_dir:
        tmp_dir = Path(raw_tmp_dir)
        for case in CASES:
            errors.extend(run_case(tmp_dir, case))

    if errors:
        for error in errors:
            print(error, file=sys.stderr)
        return 1

    print(f"{len(CASES)} lint-goal-prompt regression tests passed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
