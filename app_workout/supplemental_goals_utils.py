from __future__ import annotations

from datetime import timedelta
from math import isfinite
from typing import Dict, Iterable, List, Optional, Tuple

from django.utils import timezone

from .models import (
    SupplementalDailyLog,
    SupplementalDailyLogDetail,
    SupplementalGoals,
    SupplementalRoutine,
)

WINDOW_6_MONTHS_WEEKS = 28
WINDOW_8_WEEKS = 8
DAY_SECONDS = 24.0 * 60.0 * 60.0


def _positive_float(value) -> Optional[float]:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    if not isfinite(number) or number <= 0:
        return None
    return number


def _value_points(rows: Iterable[dict], value_key: str) -> List[Tuple[float, float]]:
    points: List[Tuple[float, float]] = []
    for row in rows:
        dt = row.get("datetime_started")
        if dt is None:
            continue
        try:
            ts = dt.timestamp()
        except Exception:
            continue
        if not isfinite(ts):
            continue
        val = _positive_float(row.get(value_key))
        if val is None:
            continue
        points.append((ts, val))
    points.sort(key=lambda item: item[0])
    return points


def _highest_value(rows: Iterable[dict], value_key: str) -> Optional[float]:
    best = None
    for row in rows:
        val = _positive_float(row.get(value_key))
        if val is None:
            continue
        if best is None or val > best:
            best = val
    return best


def _last_value(rows_ascending: List[dict], value_key: str) -> Optional[float]:
    for row in reversed(rows_ascending):
        val = _positive_float(row.get(value_key))
        if val is not None:
            return val
    return None


def _min_next_value_for_uptrend(
    points: List[Tuple[float, float]], now_ts: float
) -> Optional[Dict[str, object]]:
    clean = [(ts, val) for ts, val in points if isfinite(ts) and isfinite(val)]
    if not clean or not isfinite(now_ts):
        return None
    clean.sort(key=lambda item: item[0])
    start_ts = clean[0][0]
    if not isfinite(start_ts):
        return None

    normalized = []
    for ts, val in clean:
        x = ((ts - start_ts) / DAY_SECONDS) + 1
        if not isfinite(x):
            continue
        normalized.append((x, val))
    if not normalized:
        return None

    m = len(normalized)
    x0 = ((now_ts - start_ts) / DAY_SECONDS) + 1
    if not isfinite(x0) or x0 <= 0:
        return None

    sum_x = 0.0
    sum_y = 0.0
    sum_xy = 0.0
    for x, y in normalized:
        sum_x += x
        sum_y += y
        sum_xy += x * y

    a = (m * x0) - sum_x
    c = ((m + 1) * sum_xy) - (sum_x * sum_y) - (x0 * sum_y)
    if abs(a) < 1e-9:
        return {"type": "any"} if c >= 0 else {"type": "none"}

    threshold = -c / a
    if not isfinite(threshold):
        return None
    if a > 0:
        return {"type": "min", "value": threshold}
    return {"type": "max", "value": threshold}


def _threshold_from_points(points: List[Tuple[float, float]], now_ts: float) -> Optional[float]:
    info = _min_next_value_for_uptrend(points, now_ts)
    if not info:
        return None
    if info.get("type") not in ("min", "max"):
        return None
    return _positive_float(info.get("value"))


def _current_trend_from_points(points: List[Tuple[float, float]], now_ts: float) -> Optional[float]:
    clean = [(ts, val) for ts, val in points if isfinite(ts) and isfinite(val)]
    if not clean or not isfinite(now_ts):
        return None
    clean.sort(key=lambda item: item[0])
    start_ts = clean[0][0]
    if not isfinite(start_ts):
        return None

    normalized: List[Tuple[float, float]] = []
    for ts, val in clean:
        x = ((ts - start_ts) / DAY_SECONDS) + 1.0
        if not isfinite(x):
            continue
        normalized.append((x, val))
    if not normalized:
        return None

    x0 = ((now_ts - start_ts) / DAY_SECONDS) + 1.0
    if not isfinite(x0):
        return None

    n = float(len(normalized))
    sum_x = 0.0
    sum_y = 0.0
    sum_xx = 0.0
    sum_xy = 0.0
    for x, y in normalized:
        sum_x += x
        sum_y += y
        sum_xx += x * x
        sum_xy += x * y

    denom = (n * sum_xx) - (sum_x * sum_x)
    if abs(denom) < 1e-9:
        prediction = sum_y / n
    else:
        slope = ((n * sum_xy) - (sum_x * sum_y)) / denom
        intercept = (sum_y - (slope * sum_x)) / n
        prediction = (slope * x0) + intercept

    return _positive_float(prediction)


def _compute_dense_rank(values: List[Optional[float]]) -> Dict[float, int]:
    unique_desc = sorted({v for v in values if v is not None and v > 0}, reverse=True)
    return {value: idx + 1 for idx, value in enumerate(unique_desc)}


def _rounded_dedupe_sort_key(row: SupplementalGoals) -> Tuple[float, int, int, str]:
    raw = _positive_float(getattr(row, "unit_raw", None)) or 0.0
    try:
        priority = SupplementalGoals.GOAL_TYPES.index(getattr(row, "goal_type", None))
    except ValueError:
        priority = len(SupplementalGoals.GOAL_TYPES)
    row_id = int(getattr(row, "id", 0) or 0)
    goal_type = str(getattr(row, "goal_type", "") or "")
    return (-raw, priority, row_id, goal_type)


def _dedupe_unit_rounded(rows: List[SupplementalGoals]) -> None:
    grouped: Dict[float, List[SupplementalGoals]] = {}
    for row in rows:
        rounded = SupplementalGoals.round_up_to_whole(getattr(row, "unit_rounded", None))
        row.unit_rounded = rounded
        if rounded is None:
            continue
        grouped.setdefault(rounded, []).append(row)

    for duplicates in grouped.values():
        if len(duplicates) <= 1:
            continue
        duplicates.sort(key=_rounded_dedupe_sort_key)
        winner = duplicates[0]
        for row in duplicates[1:]:
            if row is winner:
                continue
            row.unit_rounded = None


def _build_log_rows_for_routine(routine_id: int) -> List[dict]:
    logs = list(
        SupplementalDailyLog.objects
        .filter(routine_id=routine_id, ignore=False)
        .values("id", "datetime_started", "total_completed")
        .order_by("datetime_started", "id")
    )
    if not logs:
        return []

    log_ids = [row["id"] for row in logs]
    sum_by_log: Dict[int, float] = {}
    count_by_log: Dict[int, int] = {}
    max_by_log: Dict[int, float] = {}
    detail_rows = (
        SupplementalDailyLogDetail.objects
        .filter(log_id__in=log_ids)
        .values("log_id", "unit_count")
    )
    for row in detail_rows:
        log_id = int(row.get("log_id"))
        unit = _positive_float(row.get("unit_count"))
        if unit is None:
            continue
        sum_by_log[log_id] = float(sum_by_log.get(log_id, 0.0) + unit)
        count_by_log[log_id] = int(count_by_log.get(log_id, 0) + 1)
        current_max = max_by_log.get(log_id)
        if current_max is None or unit > current_max:
            max_by_log[log_id] = unit

    rows = []
    for row in logs:
        log_id = int(row.get("id"))
        # total_completed is cumulative session work; keep "max" metrics based on
        # the best single set, with total_completed as a legacy fallback only.
        max_unit = max_by_log.get(log_id)
        if max_unit is None:
            max_unit = _positive_float(row.get("total_completed"))

        avg_unit = None
        count = int(count_by_log.get(log_id, 0) or 0)
        if count > 0:
            total = _positive_float(sum_by_log.get(log_id))
            if total is not None:
                avg_unit = _positive_float(total / float(count))
        if avg_unit is None:
            avg_unit = max_unit

        rows.append(
            {
                "datetime_started": row.get("datetime_started"),
                "max_unit": max_unit,
                "avg_unit": avg_unit,
            }
        )
    return rows


def build_supplemental_goal_value_maps(
    routine: SupplementalRoutine, now=None
) -> Tuple[Dict[str, Optional[float]], Dict[str, Optional[float]]]:
    if now is None:
        now = timezone.now()
    now_ts = now.timestamp()

    rows_ascending = _build_log_rows_for_routine(routine.id)
    since_6 = now - timedelta(weeks=WINDOW_6_MONTHS_WEEKS)
    since_8 = now - timedelta(weeks=WINDOW_8_WEEKS)
    rows_6 = [
        row
        for row in rows_ascending
        if row.get("datetime_started") and row["datetime_started"] >= since_6
    ]
    rows_8 = [
        row
        for row in rows_ascending
        if row.get("datetime_started") and row["datetime_started"] >= since_8
    ]

    points_max_6 = _value_points(rows_6, "max_unit")
    points_avg_6 = _value_points(rows_6, "avg_unit")
    points_max_8 = _value_points(rows_8, "max_unit")
    points_avg_8 = _value_points(rows_8, "avg_unit")

    raw_map: Dict[str, Optional[float]] = {
        "highest_max_unit_6months": _highest_value(rows_6, "max_unit"),
        "highest_avg_unit_6months": _highest_value(rows_6, "avg_unit"),
        "highest_max_unit_8weeks": _highest_value(rows_8, "max_unit"),
        "highest_avg_unit_8weeks": _highest_value(rows_8, "avg_unit"),
        "last_max_unit": _last_value(rows_ascending, "max_unit"),
        "last_avg_unit": _last_value(rows_ascending, "avg_unit"),
        "upward_trend_threshold_max_unit_6months": _threshold_from_points(points_max_6, now_ts),
        "upward_trend_threshold_avg_unit_6months": _threshold_from_points(points_avg_6, now_ts),
        "upward_trend_threshold_max_unit_8weeks": _threshold_from_points(points_max_8, now_ts),
        "upward_trend_threshold_avg_unit_8weeks": _threshold_from_points(points_avg_8, now_ts),
        "current_trend_max_unit_6months": _current_trend_from_points(points_max_6, now_ts),
        "current_trend_avg_unit_6months": _current_trend_from_points(points_avg_6, now_ts),
        "current_trend_max_unit_8weeks": _current_trend_from_points(points_max_8, now_ts),
        "current_trend_avg_unit_8weeks": _current_trend_from_points(points_avg_8, now_ts),
    }
    rounded_map: Dict[str, Optional[float]] = {
        goal_type: SupplementalGoals.round_up_to_whole(raw_val)
        for goal_type, raw_val in raw_map.items()
    }
    return raw_map, rounded_map


def _ensure_goal_rows_for_routine(routine: SupplementalRoutine) -> List[SupplementalGoals]:
    existing = list(SupplementalGoals.objects.filter(routine=routine))
    valid_goal_types = set(SupplementalGoals.GOAL_TYPES)
    stale_ids = [row.id for row in existing if row.goal_type not in valid_goal_types]
    if stale_ids:
        SupplementalGoals.objects.filter(id__in=stale_ids).delete()
        existing = [row for row in existing if row.id not in stale_ids]
    existing_types = {row.goal_type for row in existing}

    missing = [
        SupplementalGoals(
            routine=routine,
            goal_type=goal_type,
            max_avg_type=SupplementalGoals.infer_max_avg_type_for_goal_type(goal_type),
        )
        for goal_type in SupplementalGoals.GOAL_TYPES
        if goal_type not in existing_types
    ]
    if missing:
        SupplementalGoals.objects.bulk_create(missing)
        existing.extend(missing)
    return existing


def sync_supplemental_goals_for_routine(routine_id: int, now=None) -> Optional[SupplementalGoals]:
    routine = SupplementalRoutine.objects.filter(pk=routine_id).first()
    if routine is None:
        return None

    rows = _ensure_goal_rows_for_routine(routine)
    raw_map, rounded_map = build_supplemental_goal_value_maps(routine, now=now)

    now_dt = timezone.now()
    for row in rows:
        row.max_avg_type = SupplementalGoals.infer_max_avg_type_for_goal_type(row.goal_type)
        row.unit_raw = raw_map.get(row.goal_type)
        row.unit_rounded = rounded_map.get(row.goal_type)

    _dedupe_unit_rounded(rows)

    rows_by_type: Dict[str, List[SupplementalGoals]] = {"max": [], "avg": []}
    for row in rows:
        rows_by_type.setdefault(row.max_avg_type, []).append(row)

    for grouped in rows_by_type.values():
        rank_lookup = _compute_dense_rank(
            [
                row.unit_raw
                for row in grouped
                if row.unit_raw is not None and row.unit_rounded is not None
            ]
        )
        for row in grouped:
            if row.unit_raw is None or row.unit_rounded is None:
                row.inter_rank = None
            else:
                row.inter_rank = rank_lookup.get(row.unit_raw)

    for row in rows:
        row.last_updated = now_dt

    row_ids = [row.id for row in rows if row.id is not None]
    if row_ids:
        SupplementalGoals.objects.filter(id__in=row_ids).update(unit_rounded=None, inter_rank=None)

    SupplementalGoals.objects.bulk_update(
        rows,
        ["max_avg_type", "unit_raw", "unit_rounded", "inter_rank", "last_updated"],
    )
    return rows[0] if rows else None


def ensure_supplemental_goal_row_for_routine(routine_id: int) -> Optional[SupplementalGoals]:
    routine = SupplementalRoutine.objects.filter(pk=routine_id).first()
    if routine is None:
        return None
    rows = _ensure_goal_rows_for_routine(routine)
    return rows[0] if rows else None


def refresh_all_supplemental_goals(now=None) -> int:
    updated = 0
    for routine_id in SupplementalRoutine.objects.values_list("id", flat=True):
        goal_row = sync_supplemental_goals_for_routine(routine_id, now=now)
        if goal_row is not None:
            updated += 1
    return updated
