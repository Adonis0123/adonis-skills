"""配置管理模块

管理周报工具的配置，包括仓库列表等。
"""

import json
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple


# 默认配置
DEFAULT_CONFIG: Dict[str, Any] = {
    "repos": [],
    "default_author": "auto",
    "output_format": "markdown",
}


def get_config_path(base_dir: Optional[Path] = None) -> Path:
    """获取配置文件路径

    Args:
        base_dir: 基础目录，默认为 ~/.weekly-reports

    Returns:
        配置文件路径
    """
    if base_dir is None:
        base_dir = Path.home() / ".weekly-reports"

    return base_dir / "config.json"


def load_config(config_path: Optional[Path] = None) -> Dict[str, Any]:
    """加载配置文件

    Args:
        config_path: 配置文件路径，默认为 ~/.weekly-reports/config.json

    Returns:
        配置字典
    """
    if config_path is None:
        config_path = get_config_path()

    if not config_path.exists():
        return DEFAULT_CONFIG.copy()

    try:
        with open(config_path, "r", encoding="utf-8") as f:
            config = json.load(f)
            # 合并默认配置，确保所有字段都存在
            return {**DEFAULT_CONFIG, **config}
    except (json.JSONDecodeError, OSError):
        return DEFAULT_CONFIG.copy()


def save_config(
    config: Dict[str, Any],
    config_path: Optional[Path] = None,
) -> None:
    """保存配置文件

    Args:
        config: 配置字典
        config_path: 配置文件路径
    """
    if config_path is None:
        config_path = get_config_path()

    # 确保父目录存在
    config_path.parent.mkdir(parents=True, exist_ok=True)

    with open(config_path, "w", encoding="utf-8") as f:
        json.dump(config, f, indent=2, ensure_ascii=False)


def add_repo(
    config: Dict[str, Any],
    name: str,
    path: str,
) -> Dict[str, Any]:
    """添加仓库到配置

    Args:
        config: 配置字典
        name: 仓库名称
        path: 仓库路径

    Returns:
        更新后的配置
    """
    repos = config.get("repos", [])

    # 检查是否已存在
    for repo in repos:
        if repo["name"] == name:
            # 更新路径
            repo["path"] = path
            return config

    # 添加新仓库
    repos.append({"name": name, "path": path})
    config["repos"] = repos

    return config


def remove_repo(config: Dict[str, Any], name: str) -> Dict[str, Any]:
    """从配置中移除仓库

    Args:
        config: 配置字典
        name: 仓库名称

    Returns:
        更新后的配置
    """
    repos = config.get("repos", [])
    config["repos"] = [r for r in repos if r["name"] != name]
    return config


def get_repos(config: Dict[str, Any]) -> List[Dict[str, str]]:
    """获取仓库列表

    Args:
        config: 配置字典

    Returns:
        仓库列表
    """
    return config.get("repos", [])


def validate_repo(path: Path) -> Tuple[bool, Optional[str]]:
    """验证仓库路径是否有效

    Args:
        path: 仓库路径

    Returns:
        (is_valid, error_message)
    """
    if isinstance(path, str):
        path = Path(path)

    if not path.exists():
        return False, f"路径不存在: {path}"

    if not path.is_dir():
        return False, f"路径不是目录: {path}"

    git_dir = path / ".git"
    if not git_dir.exists():
        return False, f"不是有效的 Git 仓库: {path}"

    return True, None


def get_repo_paths(config: Dict[str, Any]) -> List[Path]:
    """获取所有仓库路径

    Args:
        config: 配置字典

    Returns:
        仓库路径列表
    """
    repos = get_repos(config)
    return [Path(r["path"]) for r in repos]
