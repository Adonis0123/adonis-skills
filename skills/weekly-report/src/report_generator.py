"""周报生成器模块

根据 Git 提交记录生成结构化周报。
"""

import re
from typing import Any, Dict, List, Optional

from src.git_analyzer import group_commits_by_project


def generate_report(
    commits: List[Dict[str, Any]],
    supplements: Optional[List[str]] = None,
) -> str:
    """生成周报

    Args:
        commits: 提交记录列表
        supplements: 补充内容列表

    Returns:
        Markdown 格式的周报内容
    """
    if not commits and not supplements:
        return ""

    # 过滤琐碎提交
    filtered_commits = filter_trivial_commits(commits)

    # 按项目分组
    grouped = group_commits_by_project(filtered_commits)

    # 生成周报内容
    sections = []

    # 按项目生成各部分
    for project, project_commits in sorted(grouped.items()):
        # 合并相关提交
        merged = merge_related_commits(project_commits)
        section = format_project_section(project, merged)
        sections.append(section)

    # 添加"其他"部分（补充内容）
    if supplements:
        other_section = format_other_section(supplements)
        sections.append(other_section)

    return "\n\n".join(sections)


def filter_trivial_commits(
    commits: List[Dict[str, Any]]
) -> List[Dict[str, Any]]:
    """过滤琐碎提交

    过滤规则：
    - typo 修复
    - 纯格式化/lint 调整
    - merge 提交
    - WIP 提交

    Args:
        commits: 提交记录列表

    Returns:
        过滤后的提交列表
    """
    return [c for c in commits if not c.get("is_trivial", False)]


def merge_related_commits(
    commits: List[Dict[str, Any]]
) -> List[Dict[str, Any]]:
    """合并相关提交

    合并规则：
    - 同一功能的多次迭代合并为一条
    - 问题排查和解决归为一条

    Args:
        commits: 提交记录列表

    Returns:
        合并后的提交列表
    """
    if not commits:
        return []
    if len(commits) <= 1:
        single = commits[0].copy()
        single.setdefault("details", [])
        return [single]

    # 按关键词分组
    groups: Dict[str, List[Dict[str, Any]]] = {}

    for commit in commits:
        # 提取关键词
        keywords = extract_keywords(commit["message"])
        key = frozenset(keywords) if keywords else commit["message"]

        # 转换为字符串 key
        str_key = str(sorted(keywords)) if keywords else commit["message"]

        if str_key not in groups:
            groups[str_key] = []
        groups[str_key].append(commit)

    # 合并同组提交（保留主条目 + 子条目细节，避免信息丢失）
    merged: List[Dict[str, Any]] = []
    for group_commits in groups.values():
        main_commit = group_commits[0].copy()
        for c in group_commits:
            if c.get("type") == "feat":
                main_commit = c.copy()
                break

        details = []
        for c in group_commits:
            details.append(clean_commit_message(c.get("message", "")))

        # 去重并保持顺序
        seen = set()
        uniq_details = []
        for d in details:
            key = d.strip()
            if not key or key in seen:
                continue
            seen.add(key)
            uniq_details.append(d.strip())

        main_commit["details"] = uniq_details if len(uniq_details) > 1 else []
        merged.append(main_commit)

    return merged


def extract_keywords(message: str) -> List[str]:
    """从提交信息中提取关键词

    Args:
        message: 提交信息

    Returns:
        关键词列表
    """
    # 去除前缀
    cleaned = re.sub(r"^(\w+)(\([^)]+\))?\s*:\s*", "", message)

    # 提取中文词语和英文单词
    chinese_words = re.findall(r"[\u4e00-\u9fff]+", cleaned)
    english_words = re.findall(r"[a-zA-Z]{3,}", cleaned)

    keywords = chinese_words + [w.lower() for w in english_words]

    # 过滤常见无意义词
    stop_words = {"the", "and", "for", "with", "this", "that", "from", "into"}
    keywords = [k for k in keywords if k.lower() not in stop_words]

    return keywords[:3]  # 只保留前3个关键词


def clean_commit_message(message: str) -> str:
    """清理提交信息为可读描述（去除 conventional 前缀）"""
    return re.sub(r"^(\w+)(\([^)]+\))?\s*:\s*", "", message).strip()


def format_project_section(
    project: str,
    commits: List[Dict[str, Any]],
) -> str:
    """格式化项目部分

    Args:
        project: 项目名称
        commits: 提交记录列表

    Returns:
        格式化的 Markdown 内容
    """
    lines = [project]

    for commit in commits:
        summary = summarize_commit(commit["message"])
        lines.append(f"  - {summary}")
        details = commit.get("details") or []
        for detail in details:
            lines.append(f"    - {detail}")

    return "\n".join(lines)


def format_other_section(supplements: List[str]) -> str:
    """格式化"其他"部分

    Args:
        supplements: 补充内容列表

    Returns:
        格式化的 Markdown 内容
    """
    lines = ["其他"]

    for item in supplements:
        lines.append(f"  - {item}")

    return "\n".join(lines)


def summarize_commit(message: str, max_length: int = 20) -> str:
    """生成提交摘要

    Args:
        message: 提交信息
        max_length: 最大长度

    Returns:
        摘要文本
    """
    cleaned = clean_commit_message(message)

    # 截断过长的文本
    if len(cleaned) > max_length:
        cleaned = cleaned[:max_length - 3] + "..."

    return cleaned.strip()


def generate_full_report(
    commits_by_project: Dict[str, List[Dict[str, Any]]],
    supplements: Optional[List[str]] = None,
    date_range: Optional[str] = None,
) -> str:
    """生成完整周报

    Args:
        commits_by_project: 按项目分组的提交记录
        supplements: 补充内容列表
        date_range: 日期范围描述

    Returns:
        完整的 Markdown 周报
    """
    # 合并所有提交
    all_commits = []
    for commits in commits_by_project.values():
        all_commits.extend(commits)

    # 生成报告内容
    content = generate_report(all_commits, supplements)

    # 添加标题（如果有日期范围）
    if date_range:
        header = f"# 周报 ({date_range})\n\n"
        content = header + content

    return content
