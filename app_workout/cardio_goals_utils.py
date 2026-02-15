from __future__ import annotations

from datetime import timedelta
from math import isfinite
from typing import Dict, Iterable, List, Optional, Tuple

from django.utils import timezone

from .models import CardioDailyLog, CardioGoals, CardioWorkout

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


def _threshold_from_points(points: List[Tuple[float, float]], now_ts: float) -> Optional[float]:
    info = CardioWorkout._min_next_value_for_uptrend(points, now_ts)
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


def build_cardio_goal_value_maps(
    workout: CardioWorkout, now=None
) -> Tuple[Dict[str, Optional[float]], Dict[str, Optional[float]]]:
    if now is None:
        now = timezone.now()
    now_ts = now.timestamp()

    rows_ascending = list(
        CardioDailyLog.objects
        .filter(workout_id=workout.id, ignore=False)
        .values("datetime_started", "max_mph", "avg_mph")
        .order_by("datetime_started", "id")
    )

    since_6 = now - timedelta(weeks=WINDOW_6_MONTHS_WEEKS)
    since_8 = now - timedelta(weeks=WINDOW_8_WEEKS)
    rows_6 = [row for row in rows_ascending if row.get("datetime_started") and row["datetime_started"] >= since_6]
    rows_8 = [row for row in rows_ascending if row.get("datetime_started") and row["datetime_started"] >= since_8]

    points_max_6 = _value_points(rows_6, "max_mph")
    points_avg_6 = _value_points(rows_6, "avg_mph")
    points_max_8 = _value_points(rows_8, "max_mph")
    points_avg_8 = _value_points(rows_8, "avg_mph")

    raw: Dict[str, Optional[float]] = {
        "highest_max_mph_6months": _highest_value(rows_6, "max_mph"),
        "highest_avg_mph_6months": _highest_value(rows_6, "avg_mph"),
        "highest_max_mph_8weeks": _highest_value(rows_8, "max_mph"),
        "highest_avg_mph_8weeks": _highest_value(rows_8, "avg_mph"),
        "last_max_mph": _last_value(rows_ascending, "max_mph"),
        "last_avg_mph": _last_value(rows_ascending, "avg_mph"),
        "upward_trend_threshold_max_mph_6months": _threshold_from_points(points_max_6, now_ts),
        "upward_trend_threshold_avg_mph_6months": _threshold_from_points(points_avg_6, now_ts),
        "upward_trend_threshold_max_mph_8weeks": _threshold_from_points(points_max_8, now_ts),
        "upward_trend_threshold_avg_mph_8weeks": _threshold_from_points(points_avg_8, now_ts),
        "current_trend_max_mph_6months": _current_trend_from_points(points_max_6, now_ts),
        "current_trend_avg_mph_6months": _current_trend_from_points(points_avg_6, now_ts),
        "current_trend_max_mph_8weeks": _current_trend_from_points(points_max_8, now_ts),
        "current_trend_avg_mph_8weeks": _current_trend_from_points(points_avg_8, now_ts),
    }

    rounded = {
        key: CardioGoals.round_up_to_tenth(val)
        for key, val in raw.items()
    }
    return raw, rounded


def _compute_dense_rank(values: List[Optional[float]]) -> Dict[float, int]:
    unique_desc = sorted({v for v in values if v is not None and v > 0}, reverse=True)
    return {value: idx + 1 for idx, value in enumerate(unique_desc)}


def _max_avg_type_for_goal_type(goal_type: str) -> str:
    text = str(goal_type or "").lower()
    if "_avg_" in text or text.endswith("_avg_mph"):
        return "avg"
    return "max"


def _ensure_goal_rows_for_workout(workout: CardioWorkout) -> List[CardioGoals]:
    existing = list(CardioGoals.objects.filter(workout=workout))
    existing_types = {row.goal_type for row in existing}
    missing = [
        CardioGoals(
            workout=workout,
            goal_type=goal_type,
            max_avg_type=_max_avg_type_for_goal_type(goal_type),
        )
        for goal_type in CardioGoals.GOAL_TYPES
        if goal_type not in existing_types
    ]
    if missing:
        CardioGoals.objects.bulk_create(missing)
        existing.extend(missing)
    return existing


def sync_cardio_goals_for_workout(workout_id: int, now=None) -> Optional[CardioGoals]:
    workout = CardioWorkout.objects.filter(pk=workout_id).first()
    if workout is None:
        return None

    rows = _ensure_goal_rows_for_workout(workout)
    raw_map, rounded_map = build_cardio_goal_value_maps(workout, now=now)

    now_dt = timezone.now()
    for row in rows:
        row.max_avg_type = _max_avg_type_for_goal_type(row.goal_type)
        row.mph_raw = raw_map.get(row.goal_type)
        row.mph_rounded = rounded_map.get(row.goal_type)

    rows_by_type: Dict[str, List[CardioGoals]] = {"max": [], "avg": []}
    for row in rows:
        rows_by_type.setdefault(row.max_avg_type, []).append(row)

    for _max_avg_type, grouped in rows_by_type.items():
        rank_lookup = _compute_dense_rank([row.mph_raw for row in grouped])
        for row in grouped:
            row.inter_rank = rank_lookup.get(row.mph_raw) if row.mph_raw is not None else None

    for row in rows:
        row.last_updated = now_dt

    CardioGoals.objects.bulk_update(
        rows,
        ["max_avg_type", "mph_raw", "mph_rounded", "inter_rank", "last_updated"],
    )
    return rows[0] if rows else None


def ensure_cardio_goal_row_for_workout(workout_id: int) -> Optional[CardioGoals]:
    workout = CardioWorkout.objects.filter(pk=workout_id).first()
    if workout is None:
        return None
    rows = _ensure_goal_rows_for_workout(workout)
    return rows[0] if rows else None


def refresh_all_cardio_goals(now=None) -> int:
    updated = 0
    for workout_id in CardioWorkout.objects.values_list("id", flat=True):
        goal_row = sync_cardio_goals_for_workout(workout_id, now=now)
        if goal_row is not None:
            updated += 1
    return updated
