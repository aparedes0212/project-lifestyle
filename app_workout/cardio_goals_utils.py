from __future__ import annotations

from datetime import timedelta
from math import isfinite
from typing import Dict, Iterable, List, Optional, Tuple

from django.db.models import F, Max
from django.utils import timezone

from .models import CardioDailyLog, CardioGoals, CardioProgression, CardioWorkout
from .distance_conversions import get_sprint_distance_miles, get_ten_k_miles

WINDOW_6_MONTHS_WEEKS = 28
WINDOW_8_WEEKS = 8
DAY_SECONDS = 24.0 * 60.0 * 60.0
RIEGEL_EXPONENT = 1.06
RIEGEL_SOURCE_GOAL_TYPE_6_MONTHS = "highest_max_mph_6months"
RIEGEL_SOURCE_GOAL_TYPE_8_WEEKS = "highest_max_mph_8weeks"
RIEGEL_5K_SOURCE_WORKOUT_ID = 3
RIEGEL_SPRINTS_SOURCE_WORKOUT_ID = 7
MILES_3MI = 3.0


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


def _compute_dense_rank(values: List[Optional[float]]) -> Dict[float, int]:
    unique_desc = sorted({v for v in values if v is not None and v > 0}, reverse=True)
    return {value: idx + 1 for idx, value in enumerate(unique_desc)}


def _rounded_dedupe_sort_key(row: CardioGoals) -> Tuple[int, float, int, int, str]:
    # Keep non-Riegel rows first so Riegel predictions lose on collisions.
    is_riegel = 1 if CardioGoals.is_riegel_goal_type(row.goal_type) else 0
    raw = _positive_float(getattr(row, "mph_raw", None)) or 0.0
    try:
        priority = CardioGoals.GOAL_TYPES.index(getattr(row, "goal_type", None))
    except ValueError:
        priority = len(CardioGoals.GOAL_TYPES)
    row_id = int(getattr(row, "id", 0) or 0)
    goal_type = str(getattr(row, "goal_type", "") or "")
    return (is_riegel, -raw, priority, row_id, goal_type)


def _dedupe_mph_rounded(rows: List[CardioGoals]) -> None:
    grouped: Dict[float, List[CardioGoals]] = {}
    for row in rows:
        rounded = CardioGoals.round_up_to_tenth(getattr(row, "mph_rounded", None))
        row.mph_rounded = rounded
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
            row.mph_rounded = None


def _miles_per_unit_for_workout(workout: CardioWorkout) -> float:
    unit = getattr(workout, "unit", None)
    try:
        num = float(getattr(unit, "mile_equiv_numerator", 0.0) or 0.0)
        den = float(getattr(unit, "mile_equiv_denominator", 1.0) or 1.0)
        return (num / den) if den else 0.0
    except Exception:
        return 0.0


def _unit_type_for_workout(workout: CardioWorkout) -> str:
    unit = getattr(workout, "unit", None)
    return str(getattr(getattr(unit, "unit_type", None), "name", "") or "").lower()


def _to_miles_for_workout(
    workout: CardioWorkout,
    raw_value: Optional[float],
    reference_mph_for_time: Optional[float],
) -> Optional[float]:
    value = _positive_float(raw_value)
    if value is None:
        return None

    unit_type = _unit_type_for_workout(workout)
    if unit_type == "distance":
        miles_per_unit = _miles_per_unit_for_workout(workout)
        if miles_per_unit <= 0:
            return None
        return _positive_float(value * miles_per_unit)
    if unit_type == "time":
        mph = _positive_float(reference_mph_for_time)
        if mph is None:
            return None
        return _positive_float(mph * (value / 60.0))
    return _positive_float(value)


def _riegel_source_workout_and_d1(workout: CardioWorkout) -> Tuple[Optional[int], Optional[float]]:
    routine_name = str(getattr(getattr(workout, "routine", None), "name", "") or "").strip().lower()
    if routine_name == "5k prep":
        return RIEGEL_5K_SOURCE_WORKOUT_ID, MILES_3MI
    if routine_name == "sprints":
        return RIEGEL_SPRINTS_SOURCE_WORKOUT_ID, get_sprint_distance_miles("x800")
    return None, None


def _is_tempo_runs_workout(workout: CardioWorkout) -> bool:
    workout_name = str(getattr(workout, "name", "") or "").strip().lower()
    routine_name = str(getattr(getattr(workout, "routine", None), "name", "") or "").strip().lower()
    return workout_name in {"tempo", "tempo runs"} or routine_name in {"tempo", "tempo runs"}


def _source_window_start(source_goal_type: str, now):
    if source_goal_type == RIEGEL_SOURCE_GOAL_TYPE_6_MONTHS:
        return now - timedelta(weeks=WINDOW_6_MONTHS_WEEKS)
    if source_goal_type == RIEGEL_SOURCE_GOAL_TYPE_8_WEEKS:
        return now - timedelta(weeks=WINDOW_8_WEEKS)
    return None


def _source_mph(workout_id: int, source_goal_type: str, now=None) -> Optional[float]:
    if now is None:
        now = timezone.now()

    since = _source_window_start(source_goal_type, now)
    if since is not None:
        source_max = (
            CardioDailyLog.objects
            .filter(
                workout_id=workout_id,
                ignore=False,
                datetime_started__isnull=False,
                datetime_started__gte=since,
            )
            .aggregate(val=Max("max_mph"))
            .get("val")
        )
        from_logs = _positive_float(source_max)
        if from_logs is not None:
            return from_logs

    # Fallback for legacy/edge cases where source logs are unavailable.
    source_row = (
        CardioGoals.objects
        .filter(
            workout_id=workout_id,
            max_avg_type="max",
            goal_type=source_goal_type,
        )
        .order_by("-last_updated", "-id")
        .first()
    )
    if source_row is None:
        return None
    return _positive_float(getattr(source_row, "mph_raw", None))


def _progression_values_for_workout(workout_id: int) -> List[float]:
    values: List[float] = []
    rows = (
        CardioProgression.objects
        .filter(workout_id=workout_id)
        .order_by("progression_order", "id")
        .values_list("progression", flat=True)
    )
    for raw in rows:
        val = _positive_float(raw)
        if val is not None:
            values.append(val)
    return values


def _snap_to_progression(value: Optional[float], candidates: List[float]) -> Optional[float]:
    numeric = _positive_float(value)
    if numeric is None or not candidates:
        return None
    return min(candidates, key=lambda candidate: abs(candidate - numeric))


def _highest_progression_in_window(
    workout_id: int,
    candidates: List[float],
    since,
    accomplished_only: bool,
) -> Optional[float]:
    logs = (
        CardioDailyLog.objects
        .filter(
            workout_id=workout_id,
            ignore=False,
            datetime_started__isnull=False,
            datetime_started__gte=since,
        )
    )
    if accomplished_only:
        logs = logs.exclude(goal__isnull=True).filter(total_completed__gte=F("goal"))

    best = None
    for row in logs.values("goal", "total_completed"):
        ref = row.get("goal")
        if ref is None:
            ref = row.get("total_completed")
        snapped = _snap_to_progression(ref, candidates)
        if snapped is None:
            continue
        if best is None or snapped > best:
            best = snapped
    return best


def _riegel_avg_d2_units_or_minutes(workout: CardioWorkout, now) -> Optional[float]:
    candidates = _progression_values_for_workout(workout.id)
    if not candidates:
        return _positive_float(getattr(workout, "goal_distance", None))

    highest = max(candidates)
    lowest = min(candidates)
    since_8 = now - timedelta(weeks=WINDOW_8_WEEKS)

    highest_accomplished = _highest_progression_in_window(
        workout.id,
        candidates,
        since_8,
        accomplished_only=True,
    )
    if highest_accomplished is not None and abs(highest_accomplished - highest) < 1e-9:
        return highest

    highest_done = _highest_progression_in_window(
        workout.id,
        candidates,
        since_8,
        accomplished_only=False,
    )
    if highest_done is not None:
        return highest_done

    return lowest


def _riegel_predicted_mph(
    workout: CardioWorkout,
    max_avg_type: str,
    source_goal_type: str,
    now=None,
) -> Optional[float]:
    if now is None:
        now = timezone.now()

    source_workout_id, d1_miles = _riegel_source_workout_and_d1(workout)
    if source_workout_id is None or d1_miles is None or d1_miles <= 0:
        return None

    source_mph = _source_mph(source_workout_id, source_goal_type, now=now)
    if source_mph is None or source_mph <= 0:
        return None

    if max_avg_type == "max" and _is_tempo_runs_workout(workout):
        d2_miles = _positive_float(get_ten_k_miles())
    else:
        if max_avg_type == "max":
            d2_units_or_minutes = _positive_float(getattr(workout, "goal_distance", None))
        else:
            d2_units_or_minutes = _riegel_avg_d2_units_or_minutes(workout, now=now)

        d2_miles = _to_miles_for_workout(workout, d2_units_or_minutes, source_mph)

    if d2_miles is None or d2_miles <= 0:
        return None

    t1_hours = d1_miles / source_mph
    ratio = d2_miles / d1_miles
    if t1_hours <= 0 or ratio <= 0:
        return None

    t2_hours = t1_hours * (ratio ** RIEGEL_EXPONENT)
    if t2_hours <= 0:
        return None
    predicted_mph = d2_miles / t2_hours
    return _positive_float(predicted_mph)


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

    raw_map: Dict[str, Optional[float]] = {
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
        CardioGoals.RIEGEL_MAX_6_MONTHS_GOAL_TYPE: _riegel_predicted_mph(
            workout,
            "max",
            RIEGEL_SOURCE_GOAL_TYPE_6_MONTHS,
            now=now,
        ),
        CardioGoals.RIEGEL_AVG_6_MONTHS_GOAL_TYPE: _riegel_predicted_mph(
            workout,
            "avg",
            RIEGEL_SOURCE_GOAL_TYPE_6_MONTHS,
            now=now,
        ),
        CardioGoals.RIEGEL_MAX_8_WEEKS_GOAL_TYPE: _riegel_predicted_mph(
            workout,
            "max",
            RIEGEL_SOURCE_GOAL_TYPE_8_WEEKS,
            now=now,
        ),
        CardioGoals.RIEGEL_AVG_8_WEEKS_GOAL_TYPE: _riegel_predicted_mph(
            workout,
            "avg",
            RIEGEL_SOURCE_GOAL_TYPE_8_WEEKS,
            now=now,
        ),
    }

    rounded_map: Dict[str, Optional[float]] = {
        goal_type: CardioGoals.round_up_to_tenth(raw_val)
        for goal_type, raw_val in raw_map.items()
    }
    return raw_map, rounded_map


def _ensure_goal_rows_for_workout(workout: CardioWorkout) -> List[CardioGoals]:
    existing = list(CardioGoals.objects.filter(workout=workout))
    valid_goal_types = set(CardioGoals.GOAL_TYPES)
    stale_ids = [row.id for row in existing if row.goal_type not in valid_goal_types]
    if stale_ids:
        CardioGoals.objects.filter(id__in=stale_ids).delete()
        existing = [row for row in existing if row.id not in stale_ids]
    existing_types = {row.goal_type for row in existing}

    missing = [
        CardioGoals(
            workout=workout,
            goal_type=goal_type,
            max_avg_type=CardioGoals.infer_max_avg_type_for_goal_type(goal_type),
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
        row.max_avg_type = CardioGoals.infer_max_avg_type_for_goal_type(row.goal_type)
        row.mph_raw = raw_map.get(row.goal_type)
        row.mph_rounded = rounded_map.get(row.goal_type)

    _dedupe_mph_rounded(rows)

    rows_by_type: Dict[str, List[CardioGoals]] = {"max": [], "avg": []}
    for row in rows:
        rows_by_type.setdefault(row.max_avg_type, []).append(row)

    for _max_avg_type, grouped in rows_by_type.items():
        rank_lookup = _compute_dense_rank(
            [
                row.mph_raw
                for row in grouped
                if row.mph_raw is not None and row.mph_rounded is not None
            ]
        )
        for row in grouped:
            if row.mph_raw is None or row.mph_rounded is None:
                row.inter_rank = None
            else:
                row.inter_rank = rank_lookup.get(row.mph_raw)

    for row in rows:
        row.last_updated = now_dt

    row_ids = [row.id for row in rows if row.id is not None]
    if row_ids:
        # Avoid transient uniqueness collisions while values are being reassigned.
        CardioGoals.objects.filter(id__in=row_ids).update(mph_rounded=None, inter_rank=None)

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
