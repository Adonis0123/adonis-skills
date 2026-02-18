"""日期处理工具模块

提供周报日期范围计算和验证功能。
"""

from datetime import date, datetime, timedelta, timezone
from typing import Optional, Tuple

from dateutil.relativedelta import relativedelta


# 中国时区（东八区）
CHINA_TZ = timezone(timedelta(hours=8))


def get_today_china() -> date:
    """获取中国时区（东八区）的今天日期

    Returns:
        中国时区的今天日期
    """
    return datetime.now(CHINA_TZ).date()


def get_week_range(offset: int = 0) -> Tuple[date, date]:
    """获取指定周的日期范围（周一到周日）

    Args:
        offset: 周偏移量，0 表示本周，-1 表示上周，以此类推

    Returns:
        (start_date, end_date): 周一和周日的日期元组
        如果周日在未来，则结束日期为今天
    """
    today = get_today_china()

    # 计算本周一
    days_since_monday = today.weekday()
    current_monday = today - timedelta(days=days_since_monday)

    # 应用偏移量
    target_monday = current_monday + timedelta(weeks=offset)
    target_sunday = target_monday + timedelta(days=6)

    # 结束日期不能超过今天
    end_date = min(target_sunday, today)

    return target_monday, end_date


def validate_date_range(
    start: date, end: date
) -> Tuple[bool, Optional[str]]:
    """验证日期范围是否有效

    Args:
        start: 开始日期
        end: 结束日期

    Returns:
        (is_valid, error_message): 验证结果和错误信息
    """
    today = get_today_china()

    # 检查开始日期是否晚于结束日期
    if start > end:
        return False, "开始日期不能晚于结束日期"

    # 检查是否选择了未来日期
    if end > today:
        return False, "不能选择未来日期"

    # 检查开始日期是否是周一
    if start.weekday() != 0:
        return False, "开始日期必须是周一"

    return True, None


def is_valid_week(start: date, end: date) -> bool:
    """检查是否为有效的周一到周日

    Args:
        start: 开始日期
        end: 结束日期

    Returns:
        是否为有效的完整周
    """
    # 开始日期必须是周一
    if start.weekday() != 0:
        return False

    # 结束日期必须是周日
    if end.weekday() != 6:
        return False

    # 间隔必须是 6 天（同一周）
    if (end - start).days != 6:
        return False

    return True


def get_week_number(d: date) -> int:
    """获取日期所在的周数

    Args:
        d: 日期

    Returns:
        ISO 周数 (1-53)
    """
    return d.isocalendar()[1]


def format_date_range(start: date, end: date) -> str:
    """格式化日期范围为字符串

    Args:
        start: 开始日期
        end: 结束日期

    Returns:
        格式化的日期范围字符串
    """
    return f"{start.isoformat()} ~ {end.isoformat()}"


def get_available_weeks(count: int = 5) -> list:
    """获取可选择的周列表

    Args:
        count: 返回的周数量

    Returns:
        周列表，每项包含 (offset, start_date, end_date, label)
    """
    weeks = []
    for i in range(count):
        offset = -i
        start, end = get_week_range(offset)

        if i == 0:
            label = "本周"
        elif i == 1:
            label = "上周"
        else:
            label = f"{i} 周前"

        weeks.append({
            "offset": offset,
            "start": start,
            "end": end,
            "label": label,
            "display": f"{label} ({format_date_range(start, end)})",
        })

    return weeks


# ==================== 时间段报告相关函数 ====================


def get_half_year_range() -> Tuple[date, date]:
    """获取前半年的日期范围

    从当前时间往前推 6 个自然月。

    Returns:
        (start_date, end_date): 从 6 个月前到今天的日期元组
    """
    today = get_today_china()
    # 使用 relativedelta 计算 6 个月前的日期
    start_date = today - relativedelta(months=6)
    return start_date, today


def validate_custom_date_range(start: date, end: date) -> Tuple[bool, Optional[str]]:
    """验证自定义日期范围（无周一限制）

    用于时间段报告的日期验证，允许任意日期作为起始日。

    Args:
        start: 开始日期
        end: 结束日期

    Returns:
        (is_valid, error_message): 验证结果和错误信息
    """
    today = get_today_china()

    # 检查开始日期是否晚于结束日期
    if start > end:
        return False, "开始日期不能晚于结束日期"

    # 检查是否选择了未来日期
    if end > today:
        return False, "不能选择未来日期"

    return True, None


def format_date_for_filename(start: date, end: date) -> str:
    """生成用于文件名的日期范围字符串

    Args:
        start: 开始日期
        end: 结束日期

    Returns:
        格式为 "YYYY-MM-DD_to_YYYY-MM-DD"
    """
    return f"{start.isoformat()}_to_{end.isoformat()}"


def format_period_title(start: date, end: date) -> str:
    """生成时间段报告的标题

    Args:
        start: 开始日期
        end: 结束日期

    Returns:
        格式为 "YYYY-MM-DD ~ YYYY-MM-DD"
    """
    return format_date_range(start, end)


def get_available_time_ranges() -> list:
    """获取可选择的时间范围列表（包含周报和时间段报告选项）

    Returns:
        时间范围列表，每项包含 type, start, end, label, display
        type 可选值: "week" 或 "period"
    """
    ranges = []

    # 添加本周和上周（保持原有逻辑）
    weeks = get_available_weeks(count=2)
    for week in weeks:
        ranges.append({
            "type": "week",
            "offset": week["offset"],
            "start": week["start"],
            "end": week["end"],
            "label": week["label"],
            "display": week["display"],
        })

    # 添加前半年选项
    half_year_start, half_year_end = get_half_year_range()
    ranges.append({
        "type": "period",
        "period_name": "前半年",
        "start": half_year_start,
        "end": half_year_end,
        "label": "前半年",
        "display": f"前半年 ({format_date_range(half_year_start, half_year_end)})",
    })

    # 添加自定义时间段选项
    ranges.append({
        "type": "period",
        "period_name": "custom",
        "start": None,  # 用户输入
        "end": None,    # 用户输入（今天）
        "label": "自定义时间段",
        "display": "自定义时间段（输入起始日期，截止到今天）",
    })

    return ranges
