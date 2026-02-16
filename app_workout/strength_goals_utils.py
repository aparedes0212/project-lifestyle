from __future__ import annotations

from datetime import timedelta
from math import isfinite
from typing import Dict, Iterable, List, Optional, Tuple

from django.utils import timezone

from .models import StrengthDailyLog, StrengthGoals, StrengthRoutine

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


def _rph(value, minutes) -> Optional[float]:
    reps = _positive_float(value)
    mins = _positive_float(minutes)
    if reps is None or mins is None:
        return None
    hours = mins / 60.0
    if hours <= 0:
        return None
    return _positive_float(reps / hours)


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


def _rounded_dedupe_sort_key(row: StrengthGoals) -> Tuple[float, int, int, str]:
    raw = _positive_float(getattr(row, "rph_raw", None)) or 0.0
    try:
        priority = StrengthGoals.GOAL_TYPES.index(getattr(row, "goal_type", None))
    except ValueError:
        priority = len(StrengthGoals.GOAL_TYPES)
    row_id = int(getattr(row, "id", 0) or 0)
    goal_type = str(getattr(row, "goal_type", "") or "")
    return (-raw, priority, row_id, goal_type)


def _dedupe_rph_rounded(rows: List[StrengthGoals]) -> None:
    grouped: Dict[float, List[StrengthGoals]] = {}
    for row in rows:
        rounded = StrengthGoals.round_up_to_whole(getattr(row, "rph_rounded", None))
        row.rph_rounded = rounded
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
            row.rph_rounded = None


def build_strength_goal_value_maps(
    routine: StrengthRoutine, now=None
) -> Tuple[Dict[str, Optional[float]], Dict[str, Optional[float]]]:
    if now is None:
        now = timezone.now()
    now_ts = now.timestamp()

    base_rows = list(
        StrengthDailyLog.objects
        .filter(routine_id=routine.id, ignore=False)
        .values("datetime_started", "max_reps", "total_reps_completed", "minutes_elapsed")
        .order_by("datetime_started", "id")
    )
    rows_ascending = []
    for row in base_rows:
        # Max-family goal types should track the session max reps directly.
        # Avg-family goal types remain normalized to reps-per-hour.
        rows_ascending.append(
            {
                "datetime_started": row.get("datetime_started"),
                "max_rph": _positive_float(row.get("max_reps")),
                "avg_rph": _rph(row.get("total_reps_completed"), row.get("minutes_elapsed")),
            }
        )

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

    points_max_6 = _value_points(rows_6, "max_rph")
    points_avg_6 = _value_points(rows_6, "avg_rph")
    points_max_8 = _value_points(rows_8, "max_rph")
    points_avg_8 = _value_points(rows_8, "avg_rph")

    raw_map: Dict[str, Optional[float]] = {
        "highest_max_rph_6months": _highest_value(rows_6, "max_rph"),
        "highest_avg_rph_6months": _highest_value(rows_6, "avg_rph"),
        "highest_max_rph_8weeks": _highest_value(rows_8, "max_rph"),
        "highest_avg_rph_8weeks": _highest_value(rows_8, "avg_rph"),
        "last_max_rph": _last_value(rows_ascending, "max_rph"),
        "last_avg_rph": _last_value(rows_ascending, "avg_rph"),
        "upward_trend_threshold_max_rph_6months": _threshold_from_points(points_max_6, now_ts),
        "upward_trend_threshold_avg_rph_6months": _threshold_from_points(points_avg_6, now_ts),
        "upward_trend_threshold_max_rph_8weeks": _threshold_from_points(points_max_8, now_ts),
        "upward_trend_threshold_avg_rph_8weeks": _threshold_from_points(points_avg_8, now_ts),
        "current_trend_max_rph_6months": _current_trend_from_points(points_max_6, now_ts),
        "current_trend_avg_rph_6months": _current_trend_from_points(points_avg_6, now_ts),
        "current_trend_max_rph_8weeks": _current_trend_from_points(points_max_8, now_ts),
        "current_trend_avg_rph_8weeks": _current_trend_from_points(points_avg_8, now_ts),
    }
    rounded_map: Dict[str, Optional[float]] = {
        goal_type: StrengthGoals.round_up_to_whole(raw_val)
        for goal_type, raw_val in raw_map.items()
    }
    return raw_map, rounded_map


def _ensure_goal_rows_for_routine(routine: StrengthRoutine) -> List[StrengthGoals]:
    existing = list(StrengthGoals.objects.filter(routine=routine))
    valid_goal_types = set(StrengthGoals.GOAL_TYPES)
    stale_ids = [row.id for row in existing if row.goal_type not in valid_goal_types]
    if stale_ids:
        StrengthGoals.objects.filter(id__in=stale_ids).delete()
        existing = [row for row in existing if row.id not in stale_ids]
    existing_types = {row.goal_type for row in existing}

    missing = [
        StrengthGoals(
            routine=routine,
            goal_type=goal_type,
            max_avg_type=StrengthGoals.infer_max_avg_type_for_goal_type(goal_type),
        )
        for goal_type in StrengthGoals.GOAL_TYPES
        if goal_type not in existing_types
    ]
    if missing:
        StrengthGoals.objects.bulk_create(missing)
        existing.extend(missing)
    return existing


def sync_strength_goals_for_routine(routine_id: int, now=None) -> Optional[StrengthGoals]:
    routine = StrengthRoutine.objects.filter(pk=routine_id).first()
    if routine is None:
        return None

    rows = _ensure_goal_rows_for_routine(routine)
    raw_map, rounded_map = build_strength_goal_value_maps(routine, now=now)

    now_dt = timezone.now()
    for row in rows:
        row.max_avg_type = StrengthGoals.infer_max_avg_type_for_goal_type(row.goal_type)
        row.rph_raw = raw_map.get(row.goal_type)
        row.rph_rounded = rounded_map.get(row.goal_type)

    _dedupe_rph_rounded(rows)

    rows_by_type: Dict[str, List[StrengthGoals]] = {"max": [], "avg": []}
    for row in rows:
        rows_by_type.setdefault(row.max_avg_type, []).append(row)

    for grouped in rows_by_type.values():
        rank_lookup = _compute_dense_rank(
            [
                row.rph_raw
                for row in grouped
                if row.rph_raw is not None and row.rph_rounded is not None
            ]
        )
        for row in grouped:
            if row.rph_raw is None or row.rph_rounded is None:
                row.inter_rank = None
            else:
                row.inter_rank = rank_lookup.get(row.rph_raw)

    for row in rows:
        row.last_updated = now_dt

    row_ids = [row.id for row in rows if row.id is not None]
    if row_ids:
        StrengthGoals.objects.filter(id__in=row_ids).update(rph_rounded=None, inter_rank=None)

    StrengthGoals.objects.bulk_update(
        rows,
        ["max_avg_type", "rph_raw", "rph_rounded", "inter_rank", "last_updated"],
    )
    return rows[0] if rows else None


def ensure_strength_goal_row_for_routine(routine_id: int) -> Optional[StrengthGoals]:
    routine = StrengthRoutine.objects.filter(pk=routine_id).first()
    if routine is None:
        return None
    rows = _ensure_goal_rows_for_routine(routine)
    return rows[0] if rows else None


def refresh_all_strength_goals(now=None) -> int:
    updated = 0
    for routine_id in StrengthRoutine.objects.values_list("id", flat=True):
        goal_row = sync_strength_goals_for_routine(routine_id, now=now)
        if goal_row is not None:
            updated += 1
    return updated
