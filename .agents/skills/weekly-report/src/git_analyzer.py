"""Git 分析器模块

提供 Git 仓库提交记录分析功能。
"""

import re
import subprocess
from datetime import date, timedelta
from pathlib import Path
from typing import Any, Dict, List, Optional


# 琐碎提交的关键词
TRIVIAL_PATTERNS = [
    r"^fix\s*typo",
    r"^typo",
    r"^update\s*(readme|changelog)",
    r"^merge\s+branch",
    r"^merge\s+pull\s+request",
    r"^wip$",
    r"^wip:",
    r"^format",
    r"^lint",
    r"^style:",
]


def get_git_user(repo_path: Path) -> Optional[str]:
    """获取 Git 用户名

    Args:
        repo_path: 仓库路径

    Returns:
        用户名，未配置时返回 None
    """
    try:
        result = subprocess.run(
            ["git", "config", "user.name"],
            cwd=repo_path,
            capture_output=True,
            text=True,
        )
        if result.returncode == 0 and result.stdout.strip():
            return result.stdout.strip()
        return None
    except Exception:
        return None


def get_git_user_email(repo_path: Path) -> Optional[str]:
    """获取 Git 用户邮箱

    Args:
        repo_path: 仓库路径

    Returns:
        邮箱，未配置时返回 None
    """
    try:
        result = subprocess.run(
            ["git", "config", "user.email"],
            cwd=repo_path,
            capture_output=True,
            text=True,
        )
        if result.returncode == 0 and result.stdout.strip():
            return result.stdout.strip()
        return None
    except Exception:
        return None


def _escape_git_author_pattern(value: str) -> str:
    # git log --author 使用正则匹配；这里做最小转义，避免邮箱/括号等字符影响匹配。
    return re.sub(r"([\\.^$|?*+()[\]{}])", r"\\\1", value)


def build_author_pattern(
    user_name: Optional[str],
    user_email: Optional[str],
) -> Optional[str]:
    """构建 git log --author 的匹配模式（name/email 任一匹配即视为本人）"""
    parts: List[str] = []
    if user_name and user_name.strip():
        parts.append(_escape_git_author_pattern(user_name.strip()))
    if user_email and user_email.strip():
        parts.append(_escape_git_author_pattern(user_email.strip()))

    if not parts:
        return None
    if len(parts) == 1:
        return parts[0]
    return "(" + "|".join(parts) + ")"


def get_commits(
    repo_path: Path,
    start_date: date,
    end_date: date,
    author: Optional[str] = None,
) -> List[Dict[str, Any]]:
    """获取指定日期范围内的提交记录

    Args:
        repo_path: 仓库路径
        start_date: 开始日期
        end_date: 结束日期
        author: 作者名（可选）

    Returns:
        提交记录列表
    """
    # git log 的 --until=YYYY-MM-DD 会被解析为当天 00:00:00，
    # 可能导致“结束日当天”的提交被排除；这里将截止时间调整到下一天 00:00。
    end_date_exclusive = end_date + timedelta(days=1)

    # 构建 git log 命令
    cmd = [
        "git",
        "log",
        "--all",
        f"--since={start_date.isoformat()}",
        f"--until={end_date_exclusive.isoformat()}",
        "--pretty=format:%H|%s|%an|%ad",
        "--date=short",
    ]

    if author:
        cmd.append(f"--author={author}")

    try:
        result = subprocess.run(
            cmd,
            cwd=repo_path,
            capture_output=True,
            text=True,
        )

        if result.returncode != 0 or not result.stdout.strip():
            return []

        commits = []
        for line in result.stdout.strip().split("\n"):
            if not line:
                continue

            parts = line.split("|")
            if len(parts) >= 4:
                parsed = parse_commit_message(parts[1])
                commits.append({
                    "hash": parts[0],
                    "message": parts[1],
                    "author": parts[2],
                    "date": parts[3],
                    "type": parsed["type"],
                    "is_trivial": parsed["is_trivial"],
                    "project": get_repo_name(repo_path),
                })

        return commits
    except Exception:
        return []


def group_commits_by_project(
    commits: List[Dict[str, Any]]
) -> Dict[str, List[Dict[str, Any]]]:
    """按项目分组提交记录

    Args:
        commits: 提交记录列表

    Returns:
        按项目分组的提交记录字典
    """
    grouped: Dict[str, List[Dict[str, Any]]] = {}

    for commit in commits:
        project = commit.get("project", "unknown")
        if project not in grouped:
            grouped[project] = []
        grouped[project].append(commit)

    return grouped


def parse_commit_message(message: str) -> Dict[str, Any]:
    """解析提交信息

    Args:
        message: 提交信息

    Returns:
        解析后的提交信息字典
    """
    result = {
        "type": "other",
        "scope": None,
        "description": message,
        "is_trivial": False,
    }

    # 检查是否为琐碎提交
    message_lower = message.lower().strip()
    for pattern in TRIVIAL_PATTERNS:
        if re.match(pattern, message_lower, re.IGNORECASE):
            result["is_trivial"] = True
            break

    # 解析常规提交格式: type(scope): description
    conventional_pattern = r"^(\w+)(?:\(([^)]+)\))?\s*:\s*(.+)$"
    match = re.match(conventional_pattern, message)

    if match:
        result["type"] = match.group(1).lower()
        result["scope"] = match.group(2)
        result["description"] = match.group(3)
    else:
        result["description"] = message

    return result


def is_git_repo(path: Path) -> bool:
    """检查路径是否为 Git 仓库

    Args:
        path: 路径

    Returns:
        是否为 Git 仓库
    """
    git_dir = path / ".git"
    return git_dir.exists() and git_dir.is_dir()


def get_repo_name(repo_path: Path) -> str:
    """获取仓库名称

    Args:
        repo_path: 仓库路径

    Returns:
        仓库名称
    """
    return repo_path.name


def scan_repos(
    repo_paths: List[Path],
) -> List[Dict[str, Any]]:
    """扫描多个仓库

    Args:
        repo_paths: 仓库路径列表

    Returns:
        有效仓库信息列表
    """
    repos = []

    for path in repo_paths:
        if isinstance(path, str):
            path = Path(path)

        if is_git_repo(path):
            repos.append({
                "path": path,
                "name": get_repo_name(path),
            })

    return repos


def merge_commits_from_repos(
    commits_by_repo: Dict[str, List[Dict[str, Any]]]
) -> List[Dict[str, Any]]:
    """合并多仓库提交记录

    Args:
        commits_by_repo: 按仓库分组的提交记录

    Returns:
        合并后的提交记录列表
    """
    merged = []

    for repo_name, commits in commits_by_repo.items():
        for commit in commits:
            # 确保每个提交都有 project 字段
            if "project" not in commit:
                commit["project"] = repo_name
            merged.append(commit)

    # 按日期排序
    merged.sort(key=lambda x: x.get("date", ""), reverse=True)

    return merged


def get_all_commits_from_repos(
    repo_paths: List[Path],
    start_date: date,
    end_date: date,
    author: Optional[str] = None,
) -> Dict[str, List[Dict[str, Any]]]:
    """从多个仓库获取提交记录

    Args:
        repo_paths: 仓库路径列表
        start_date: 开始日期
        end_date: 结束日期
        author: 作者名（可选，None 表示自动获取）

    Returns:
        按仓库分组的提交记录
    """
    commits_by_repo: Dict[str, List[Dict[str, Any]]] = {}

    for path in repo_paths:
        if isinstance(path, str):
            path = Path(path)

        if not is_git_repo(path):
            continue

        # 如果没有指定作者，自动获取
        current_author = author
        if current_author is None:
            current_author = build_author_pattern(
                user_name=get_git_user(path),
                user_email=get_git_user_email(path),
            )

        repo_name = get_repo_name(path)
        commits = get_commits(path, start_date, end_date, current_author)

        if commits:
            commits_by_repo[repo_name] = commits

    return commits_by_repo
