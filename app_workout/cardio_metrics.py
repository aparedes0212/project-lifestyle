from __future__ import annotations

from datetime import timedelta
from math import isfinite
from typing import Dict, Optional

from django.utils import timezone

from .distance_conversions import (
    get_distance_conversion_payload,
    get_sprint_distance_miles,
)
from .models import CardioDailyLog, CardioMetricPeriodSelection, CardioProgression, CardioWorkout
from .services import get_next_progression_for_workout
from .timezones import derive_activity_date


RIEGEL_EXPONENT = 1.06
FAST_MAX_DAY_AVG_THRESHOLD = 10.0
X800_MAX_DAY_AVG_THRESHOLD = 11.4
EASY_MPH_MULTIPLIER_LOW = 0.70
EASY_MPH_MULTIPLIER_HIGH = 0.85
TAPER_PERIOD_KEY = "taper"
TAPER_PERIOD_LABEL = "Taper"
TAPER_PERIOD_X_BY_KEY = {
    "last_6_months": 4.0,
    "last_8_weeks": 3.0,
    "last_time": 2.0,
}
TAPER_TARGET_X = 1.0


def _positive_float(value) -> Optional[float]:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    if not isfinite(number) or number <= 0:
        return None
    return number


def _ceiling_to_next_tenth(value) -> Optional[float]:
    numeric = _positive_float(value)
    if numeric is None:
        return None
    return (int((numeric * 10) + 1e-9) + 1) / 10.0


def _round_to_tenth(value) -> Optional[float]:
    numeric = _positive_float(value)
    if numeric is None:
        return None
    return round(numeric, 1)


def _riegel_predicted_mph(
    source_mph: Optional[float],
    source_distance_miles: Optional[float],
    target_distance_miles: Optional[float],
) -> Optional[float]:
    mph = _positive_float(source_mph)
    d1 = _positive_float(source_distance_miles)
    d2 = _positive_float(target_distance_miles)
    if mph is None or d1 is None or d2 is None:
        return None

    t1_hours = d1 / mph
    if t1_hours <= 0:
        return None
    ratio = d2 / d1
    if ratio <= 0:
        return None

    t2_hours = t1_hours * (ratio ** RIEGEL_EXPONENT)
    if t2_hours <= 0:
        return None
    return _positive_float(d2 / t2_hours)


def _scaled_mph(mph: Optional[float], multiplier: float) -> Optional[float]:
    base = _positive_float(mph)
    factor = _positive_float(multiplier)
    if base is None or factor is None:
        return None
    return _positive_float(base * factor)


def _nearest_progression_value(value: float, candidates: list[float]) -> float:
    if not candidates:
        return float(value)
    best = min(candidates, key=lambda candidate: (abs(float(candidate) - float(value)), float(candidate)))
    return float(best)


def _find_workout(routine_name: str, workout_name: str) -> Optional[CardioWorkout]:
    return (
        CardioWorkout.objects
        .select_related("routine")
        .filter(
            routine__name__iexact=str(routine_name or "").strip(),
            name__iexact=str(workout_name or "").strip(),
        )
        .first()
    )


def _miles_per_unit_for_workout(workout: Optional[CardioWorkout]) -> Optional[float]:
    if workout is None:
        return None
    unit = getattr(workout, "unit", None)
    try:
        numerator = float(getattr(unit, "mile_equiv_numerator", 0.0) or 0.0)
        denominator = float(getattr(unit, "mile_equiv_denominator", 1.0) or 1.0)
    except (TypeError, ValueError):
        return None
    if denominator == 0:
        return None
    return _positive_float(numerator / denominator)


def _workout_value_to_miles(workout: Optional[CardioWorkout], value) -> Optional[float]:
    numeric = _positive_float(value)
    if workout is None or numeric is None:
        return None
    unit_type = str(getattr(getattr(getattr(workout, "unit", None), "unit_type", None), "name", "") or "").strip().lower()
    if unit_type != "distance":
        return None
    miles_per_unit = _miles_per_unit_for_workout(workout)
    if miles_per_unit is None:
        return None
    return _positive_float(numeric * miles_per_unit)


def _progression_unit_for_workout(workout: Optional[CardioWorkout]) -> Optional[str]:
    if workout is None:
        return None
    unit_type = str(getattr(getattr(getattr(workout, "unit", None), "unit_type", None), "name", "") or "").strip().lower()
    if unit_type == "time":
        return "minutes"
    if unit_type == "distance":
        return "miles"
    return None


def _serialize_workout_progression_meta(workout: Optional[CardioWorkout]) -> Dict[str, object]:
    if workout is None:
        return {
            "goal_distance": None,
            "next_progression": None,
            "progression_unit": None,
        }

    next_progression = get_next_progression_for_workout(workout.id)
    return {
        "goal_distance": _positive_float(getattr(workout, "goal_distance", None)),
        "next_progression": _positive_float(getattr(next_progression, "progression", None)),
        "progression_unit": _progression_unit_for_workout(workout),
    }


def _serialize_interval_progression_meta(workout: Optional[CardioWorkout]) -> Dict[str, object]:
    if workout is None:
        return {
            "goal_distance": None,
            "next_progression": None,
            "progression_unit": "intervals",
        }

    next_progression = get_next_progression_for_workout(workout.id)
    return {
        "goal_distance": _positive_float(getattr(workout, "goal_distance", None)),
        "next_progression": _positive_float(getattr(next_progression, "progression", None)),
        "progression_unit": "intervals",
    }


def _selected_period_key_map() -> Dict[int, str]:
    return {
        selection.workout_id: str(selection.period_key or "").strip()
        for selection in CardioMetricPeriodSelection.objects.select_related("workout").all()
    }


def _normalize_section_selection(section: Optional[Dict[str, object]], workout_id: Optional[int], selection_map: Dict[int, str]) -> None:
    if not isinstance(section, dict):
        return
    periods = list(section.get("periods") or [])
    requested_key = str(selection_map.get(workout_id) or "").strip()
    selected = next((item for item in periods if item.get("key") == requested_key), None)
    if selected is None and periods:
        selected = periods[0]
    section["selected_period_key"] = selected.get("key") if selected else None


def _get_section_selected_period(section: Optional[Dict[str, object]]) -> Optional[Dict[str, object]]:
    if not isinstance(section, dict):
        return None
    periods = list(section.get("periods") or [])
    selected_key = str(section.get("selected_period_key") or "").strip()
    selected = next((item for item in periods if item.get("key") == selected_key), None)
    if selected is not None:
        return selected
    return periods[0] if periods else None


def _serialize_metric_plan(
    workout_name: str,
    period: Optional[Dict[str, object]],
    mph_goal: Optional[float],
    mph_goal_avg: Optional[float],
) -> Optional[Dict[str, object]]:
    if not period:
        return None
    max_goal = _positive_float(mph_goal)
    avg_goal = _positive_float(mph_goal_avg) or max_goal
    if max_goal is None or avg_goal is None:
        return None
    return {
        "workout_name": workout_name,
        "period_key": period.get("key"),
        "period_label": period.get("label"),
        "mph_goal": max_goal,
        "mph_goal_avg": avg_goal,
    }


def _get_inherited_min_run_easy_mph(min_run_period: Optional[Dict[str, object]], fast_period: Optional[Dict[str, object]]) -> Optional[float]:
    easy_floor = _ceiling_to_next_tenth(((fast_period or {}).get("riegel") or {}).get("easy_low_mph"))
    easy_ceiling = _ceiling_to_next_tenth(((fast_period or {}).get("riegel") or {}).get("easy_high_mph"))
    current_avg = _positive_float((min_run_period or {}).get("avg_mph"))
    if easy_floor is None or easy_ceiling is None:
        return None

    lower_bound = min(easy_floor, easy_ceiling)
    upper_bound = max(easy_floor, easy_ceiling)
    adjusted = lower_bound
    minimum_required = (current_avg + 0.1) if current_avg is not None else None
    while minimum_required is not None and adjusted < minimum_required and adjusted < upper_bound:
        adjusted = round(adjusted + 0.1, 1)
    return min(adjusted, upper_bound)


def get_selected_cardio_metric_plan(
    workout: Optional[CardioWorkout] = None,
    workout_name: Optional[str] = None,
    snapshot: Optional[Dict[str, object]] = None,
) -> Optional[Dict[str, object]]:
    name = str(workout_name or getattr(workout, "name", "") or "").strip()
    if not name:
        return None
    snapshot = snapshot or get_cardio_metrics_snapshot()

    fast_section = snapshot.get("fast") if isinstance(snapshot, dict) else None
    tempo_section = snapshot.get("tempo") if isinstance(snapshot, dict) else None
    min_run_section = snapshot.get("min_run") if isinstance(snapshot, dict) else None
    sprint_workouts = {
        str(item.get("workout_name") or ""): item
        for item in ((snapshot or {}).get("sprints") or {}).get("workouts", [])
        if isinstance(item, dict)
    }

    if name == "Fast":
        period = _get_section_selected_period(fast_section)
        return _serialize_metric_plan(
            "Fast",
            period,
            _ceiling_to_next_tenth((period or {}).get("max_mph")),
            _ceiling_to_next_tenth((period or {}).get("avg_mph")),
        )

    if name == "Tempo":
        period = _get_section_selected_period(tempo_section)
        fast_period = next(
            (item for item in list((fast_section or {}).get("periods") or []) if item.get("key") == (period or {}).get("key")),
            _get_section_selected_period(fast_section),
        )
        return _serialize_metric_plan(
            "Tempo",
            period,
            _ceiling_to_next_tenth(((fast_period or {}).get("riegel") or {}).get("predicted_mph")),
            _ceiling_to_next_tenth((period or {}).get("avg_mph")),
        )

    if name == "Min Run":
        period = _get_section_selected_period(min_run_section)
        fast_period = next(
            (item for item in list((fast_section or {}).get("periods") or []) if item.get("key") == (period or {}).get("key")),
            _get_section_selected_period(fast_section),
        )
        return _serialize_metric_plan(
            "Min Run",
            period,
            _get_inherited_min_run_easy_mph(period, fast_period),
            _round_to_tenth((period or {}).get("avg_mph")),
        )

    if name == "x800":
        section = sprint_workouts.get("x800")
        period = _get_section_selected_period(section)
        return _serialize_metric_plan(
            "x800",
            period,
            _ceiling_to_next_tenth((period or {}).get("max_mph")),
            _ceiling_to_next_tenth((period or {}).get("avg_mph")),
        )

    if name in {"x400", "x200"}:
        section = sprint_workouts.get(name)
        period = _get_section_selected_period(section)
        current_max = _ceiling_to_next_tenth((period or {}).get("max_mph"))
        predicted = _ceiling_to_next_tenth((((period or {}).get("riegel") or {}).get("predicted_mph")))
        next_max = max(
            [value for value in [current_max, predicted] if value is not None],
            default=None,
        )
        return _serialize_metric_plan(
            name,
            period,
            next_max,
            _ceiling_to_next_tenth((period or {}).get("avg_mph")),
        )

    return None


def _build_progression_scope(workout: Optional[CardioWorkout]) -> Dict[str, object]:
    if workout is None:
        return {"current_progression": None, "progression_values": []}

    progression_values = [
        float(value) for value in (
            CardioProgression.objects
            .filter(workout=workout)
            .order_by("progression_order")
            .values_list("progression", flat=True)
        )
    ]
    if not progression_values:
        return {"current_progression": None, "progression_values": []}

    current_progression = _positive_float(getattr(get_next_progression_for_workout(workout.id), "progression", None))
    return {
        "current_progression": current_progression,
        "progression_values": progression_values,
    }


def _get_progression_basis_value(log: CardioDailyLog) -> Optional[float]:
    goal_value = _positive_float(getattr(log, "goal", None))
    if goal_value is not None:
        return goal_value
    return _positive_float(getattr(log, "total_completed", None))


def _log_matches_progression_scope(log: CardioDailyLog, progression_scope: Optional[Dict[str, object]]) -> bool:
    if not progression_scope:
        return True

    current_progression = _positive_float(progression_scope.get("current_progression"))
    progression_values = [float(value) for value in (progression_scope.get("progression_values") or [])]
    if current_progression is None or not progression_values:
        return True

    basis_value = _get_progression_basis_value(log)
    if basis_value is None:
        return False
    snapped_value = _nearest_progression_value(float(basis_value), progression_values)
    return snapped_value == current_progression


def _log_is_metrics_eligible(log: CardioDailyLog) -> bool:
    if bool(getattr(log, "ignore", False)):
        return False

    goal_value = _positive_float(getattr(log, "goal", None))
    total_completed = _positive_float(getattr(log, "total_completed", None))
    if goal_value is not None and total_completed is not None and total_completed < goal_value:
        return False
    return True


def _filter_logs_to_progression_scope(logs, progression_scope: Optional[Dict[str, object]]) -> list[CardioDailyLog]:
    return [
        log
        for log in logs
        if _log_is_metrics_eligible(log) and _log_matches_progression_scope(log, progression_scope)
    ]


def _best_log_for_window(
    workout: Optional[CardioWorkout],
    metric_field: str,
    since=None,
    progression_scope: Optional[Dict[str, object]] = None,
) -> Optional[CardioDailyLog]:
    if workout is None:
        return None
    metric_field = str(metric_field or "").strip()
    if metric_field not in {"max_mph", "avg_mph"}:
        return None

    qs = (
        CardioDailyLog.objects
        .filter(workout=workout, ignore=False)
        .exclude(**{f"{metric_field}__isnull": True})
    )
    if since is not None:
        qs = qs.filter(datetime_started__gte=since)
    logs = _filter_logs_to_progression_scope(
        list(qs.order_by("-datetime_started", "-pk")),
        progression_scope,
    )
    if not logs:
        return None
    return max(
        logs,
        key=lambda log: (
            float(getattr(log, metric_field) or 0.0),
            getattr(log, "datetime_started", None),
            getattr(log, "pk", 0),
        ),
    )


def _last_log(workout: Optional[CardioWorkout], progression_scope: Optional[Dict[str, object]] = None) -> Optional[CardioDailyLog]:
    if workout is None:
        return None
    logs = _filter_logs_to_progression_scope(
        list(
            CardioDailyLog.objects
            .filter(workout=workout, ignore=False)
            .exclude(max_mph__isnull=True, avg_mph__isnull=True)
            .order_by("-datetime_started", "-pk")
        ),
        progression_scope,
    )
    return logs[0] if logs else None


def _serialize_metric_log(log: Optional[CardioDailyLog], metric_field: str, prefix: str) -> Dict[str, object]:
    if log is None:
        return {
            f"{prefix}_log_id": None,
            f"{prefix}_activity_date": None,
            f"{prefix}_datetime_started": None,
            metric_field: None,
        }

    dt = getattr(log, "datetime_started", None)
    activity_date = derive_activity_date(dt) if dt is not None else None
    return {
        f"{prefix}_log_id": log.id,
        f"{prefix}_activity_date": activity_date.isoformat() if activity_date else None,
        f"{prefix}_datetime_started": dt.isoformat() if dt is not None else None,
        metric_field: _positive_float(getattr(log, metric_field, None)),
    }


def _serialize_period(
    key: str,
    label: str,
    max_log: Optional[CardioDailyLog] = None,
    avg_log: Optional[CardioDailyLog] = None,
    avg_locked_to_max_day: bool = False,
    riegel_target_label: Optional[str] = None,
    riegel_target_distance_miles: Optional[float] = None,
    riegel_source_mph: Optional[float] = None,
    riegel_source_label: Optional[str] = None,
    riegel_source_distance_miles: Optional[float] = None,
) -> Dict[str, object]:
    max_mph = _positive_float(getattr(max_log, "max_mph", None)) if max_log is not None else None
    avg_mph = _positive_float(getattr(avg_log, "avg_mph", None)) if avg_log is not None else None
    predicted_mph = _riegel_predicted_mph(
        source_mph=riegel_source_mph,
        source_distance_miles=riegel_source_distance_miles,
        target_distance_miles=riegel_target_distance_miles,
    )
    easy_low_mph = _scaled_mph(predicted_mph, EASY_MPH_MULTIPLIER_LOW)
    easy_high_mph = _scaled_mph(predicted_mph, EASY_MPH_MULTIPLIER_HIGH)

    max_or_predicted_candidates = [value for value in (max_mph, predicted_mph) if value is not None]
    max_or_predicted_mph = max(max_or_predicted_candidates) if max_or_predicted_candidates else None

    return {
        "key": key,
        "label": label,
        **_serialize_metric_log(max_log, "max_mph", "max"),
        **_serialize_metric_log(avg_log, "avg_mph", "avg"),
        "avg_locked_to_max_day": bool(avg_locked_to_max_day),
        "riegel": {
            "source_label": riegel_source_label,
            "source_distance_miles": _positive_float(riegel_source_distance_miles),
            "source_mph": _positive_float(riegel_source_mph),
            "target_label": riegel_target_label,
            "target_distance_miles": _positive_float(riegel_target_distance_miles),
            "predicted_mph": predicted_mph,
            "easy_low_mph": easy_low_mph,
            "easy_high_mph": easy_high_mph,
        },
        "max_or_predicted_mph": max_or_predicted_mph,
    }


def _period_value_at_path(period: Optional[Dict[str, object]], path: tuple[str, ...]) -> Optional[float]:
    current = period
    for key in path:
        if not isinstance(current, dict):
            return None
        current = current.get(key)
    return _positive_float(current)


def _linear_regression_predict(points: list[tuple[float, float]], target_x: float) -> Optional[float]:
    cleaned = [
        (float(x_value), float(y_value))
        for x_value, y_value in points
        if isfinite(float(x_value)) and isfinite(float(y_value))
    ]
    if not cleaned:
        return None
    if len(cleaned) == 1:
        return _positive_float(cleaned[0][1])

    n = float(len(cleaned))
    sum_x = sum(x_value for x_value, _ in cleaned)
    sum_y = sum(y_value for _, y_value in cleaned)
    sum_xx = sum(x_value * x_value for x_value, _ in cleaned)
    sum_xy = sum(x_value * y_value for x_value, y_value in cleaned)
    denominator = (n * sum_xx) - (sum_x * sum_x)
    if abs(denominator) < 1e-12:
        return _positive_float(sum_y / n)

    slope = ((n * sum_xy) - (sum_x * sum_y)) / denominator
    intercept = (sum_y - (slope * sum_x)) / n
    return _positive_float((slope * float(target_x)) + intercept)


def _build_taper_period(periods: list[Dict[str, object]]) -> Optional[Dict[str, object]]:
    if not periods:
        return None

    source_periods = [
        period
        for period in periods
        if str(period.get("key") or "").strip() in TAPER_PERIOD_X_BY_KEY
    ]
    if not source_periods:
        return None

    def predict(path: tuple[str, ...]) -> Optional[float]:
        points = []
        for period in source_periods:
            key = str(period.get("key") or "").strip()
            x_value = TAPER_PERIOD_X_BY_KEY.get(key)
            y_value = _period_value_at_path(period, path)
            if x_value is None or y_value is None:
                continue
            points.append((x_value, y_value))
        return _linear_regression_predict(points, TAPER_TARGET_X)

    first_riegel = next(
        ((period.get("riegel") or {}) for period in source_periods if isinstance(period.get("riegel"), dict)),
        {},
    )
    taper_max_mph = predict(("max_mph",))
    taper_avg_mph = predict(("avg_mph",))
    taper_riegel_source_mph = predict(("riegel", "source_mph"))
    taper_predicted_mph = predict(("riegel", "predicted_mph"))
    taper_easy_low_mph = predict(("riegel", "easy_low_mph"))
    taper_easy_high_mph = predict(("riegel", "easy_high_mph"))
    max_or_predicted_candidates = [
        value
        for value in (taper_max_mph, taper_predicted_mph)
        if value is not None
    ]
    taper_max_or_predicted_mph = max(max_or_predicted_candidates) if max_or_predicted_candidates else None

    return {
        "key": TAPER_PERIOD_KEY,
        "label": TAPER_PERIOD_LABEL,
        "max_log_id": None,
        "max_activity_date": None,
        "max_datetime_started": None,
        "max_mph": taper_max_mph,
        "avg_log_id": None,
        "avg_activity_date": None,
        "avg_datetime_started": None,
        "avg_mph": taper_avg_mph,
        "avg_locked_to_max_day": False,
        "riegel": {
            "source_label": first_riegel.get("source_label"),
            "source_distance_miles": _positive_float(first_riegel.get("source_distance_miles")),
            "source_mph": taper_riegel_source_mph,
            "target_label": first_riegel.get("target_label"),
            "target_distance_miles": _positive_float(first_riegel.get("target_distance_miles")),
            "predicted_mph": taper_predicted_mph,
            "easy_low_mph": taper_easy_low_mph,
            "easy_high_mph": taper_easy_high_mph,
        },
        "max_or_predicted_mph": taper_max_or_predicted_mph,
    }


def _append_taper_period(periods: list[Dict[str, object]]) -> list[Dict[str, object]]:
    taper_period = _build_taper_period(periods)
    if taper_period is None:
        return periods
    return [*periods, taper_period]


def _build_periods_for_workout(
    workout: Optional[CardioWorkout],
    since_6_months,
    since_8_weeks,
    progression_scope: Optional[Dict[str, object]] = None,
    avg_from_max_when_max_below: Optional[float] = None,
    riegel_target_label: Optional[str] = None,
    riegel_target_distance_miles: Optional[float] = None,
    riegel_source_6_months_mph: Optional[float] = None,
    riegel_source_8_weeks_mph: Optional[float] = None,
    riegel_source_last_mph: Optional[float] = None,
    riegel_source_label: Optional[str] = None,
    riegel_source_distance_miles: Optional[float] = None,
) -> list[Dict[str, object]]:
    max_best_6 = _best_log_for_window(workout, "max_mph", since=since_6_months, progression_scope=progression_scope)
    max_best_8 = _best_log_for_window(workout, "max_mph", since=since_8_weeks, progression_scope=progression_scope)
    avg_best_6 = _best_log_for_window(workout, "avg_mph", since=since_6_months, progression_scope=progression_scope)
    avg_best_8 = _best_log_for_window(workout, "avg_mph", since=since_8_weeks, progression_scope=progression_scope)
    last_log = _last_log(workout, progression_scope=progression_scope)

    def apply_avg_override(max_log, avg_log):
        threshold = _positive_float(avg_from_max_when_max_below)
        max_mph = _positive_float(getattr(max_log, "max_mph", None)) if max_log is not None else None
        if threshold is not None and max_mph is not None and max_mph < threshold and max_log is not None:
            return max_log, True
        return avg_log, False

    avg_best_6, avg_locked_6 = apply_avg_override(max_best_6, avg_best_6)
    avg_best_8, avg_locked_8 = apply_avg_override(max_best_8, avg_best_8)
    last_avg_log, last_avg_locked = apply_avg_override(last_log, last_log)

    periods = [
        _serialize_period(
            key="last_6_months",
            label="Max in last 6 months",
            max_log=max_best_6,
            avg_log=avg_best_6,
            avg_locked_to_max_day=avg_locked_6,
            riegel_target_label=riegel_target_label,
            riegel_target_distance_miles=riegel_target_distance_miles,
            riegel_source_label=riegel_source_label,
            riegel_source_distance_miles=riegel_source_distance_miles,
            riegel_source_mph=riegel_source_6_months_mph,
        ),
        _serialize_period(
            key="last_8_weeks",
            label="Max in last 8 weeks",
            max_log=max_best_8,
            avg_log=avg_best_8,
            avg_locked_to_max_day=avg_locked_8,
            riegel_target_label=riegel_target_label,
            riegel_target_distance_miles=riegel_target_distance_miles,
            riegel_source_label=riegel_source_label,
            riegel_source_distance_miles=riegel_source_distance_miles,
            riegel_source_mph=riegel_source_8_weeks_mph,
        ),
        _serialize_period(
            key="last_time",
            label=f"Last time {getattr(workout, 'name', 'workout')} was done" if workout is not None else "Last time workout was done",
            max_log=last_log,
            avg_log=last_avg_log,
            avg_locked_to_max_day=last_avg_locked,
            riegel_target_label=riegel_target_label,
            riegel_target_distance_miles=riegel_target_distance_miles,
            riegel_source_label=riegel_source_label,
            riegel_source_distance_miles=riegel_source_distance_miles,
            riegel_source_mph=riegel_source_last_mph,
        ),
    ]
    return _append_taper_period(periods)


def get_cardio_metrics_snapshot(now=None) -> Dict[str, object]:
    now = now or timezone.now()
    since_6_months = now - timedelta(days=int(round(6 * 30.4375)))
    since_8_weeks = now - timedelta(weeks=8)
    conversion_payload = get_distance_conversion_payload()

    fast_workout = _find_workout("5K Prep", "Fast")
    tempo_workout = _find_workout("5K Prep", "Tempo")
    min_run_workout = _find_workout("5K Prep", "Min Run")
    x800_workout = _find_workout("Sprints", "x800")
    x400_workout = _find_workout("Sprints", "x400")
    x200_workout = _find_workout("Sprints", "x200")

    fast_scope = _build_progression_scope(fast_workout)
    tempo_scope = _build_progression_scope(tempo_workout)
    min_run_scope = _build_progression_scope(min_run_workout)
    x800_scope = _build_progression_scope(x800_workout)
    x400_scope = _build_progression_scope(x400_workout)
    x200_scope = _build_progression_scope(x200_workout)

    x800_best_6 = _best_log_for_window(x800_workout, "max_mph", since=since_6_months, progression_scope=x800_scope)
    x800_best_8 = _best_log_for_window(x800_workout, "max_mph", since=since_8_weeks, progression_scope=x800_scope)
    x800_last = _last_log(x800_workout, progression_scope=x800_scope)
    tempo_meta = _serialize_workout_progression_meta(tempo_workout)
    min_run_meta = _serialize_workout_progression_meta(min_run_workout)

    fast_source_distance_miles = _workout_value_to_miles(
        fast_workout,
        getattr(fast_workout, "goal_distance", None) if fast_workout is not None else None,
    )
    fast_next_progression = get_next_progression_for_workout(fast_workout.id) if fast_workout is not None else None
    fast_next_progression_miles = _workout_value_to_miles(
        fast_workout,
        getattr(fast_next_progression, "progression", None),
    )

    x800_distance_miles = get_sprint_distance_miles("x800")
    x400_distance_miles = get_sprint_distance_miles("x400")
    x200_distance_miles = get_sprint_distance_miles("x200")

    snapshot = {
        "conversions": conversion_payload,
        "fast": {
            "workout_name": "Fast",
            "source_distance_miles": fast_source_distance_miles,
            "next_progression": _positive_float(getattr(fast_next_progression, "progression", None)),
            "next_progression_miles": fast_next_progression_miles,
            "periods": _build_periods_for_workout(
                fast_workout,
                since_6_months=since_6_months,
                since_8_weeks=since_8_weeks,
                progression_scope=fast_scope,
                avg_from_max_when_max_below=FAST_MAX_DAY_AVG_THRESHOLD,
                riegel_target_label="10K",
                riegel_target_distance_miles=conversion_payload["ten_k_miles"],
                riegel_source_6_months_mph=_positive_float(getattr(_best_log_for_window(fast_workout, "max_mph", since=since_6_months, progression_scope=fast_scope), "max_mph", None)),
                riegel_source_8_weeks_mph=_positive_float(getattr(_best_log_for_window(fast_workout, "max_mph", since=since_8_weeks, progression_scope=fast_scope), "max_mph", None)),
                riegel_source_last_mph=_positive_float(getattr(_last_log(fast_workout, progression_scope=fast_scope), "max_mph", None)),
                riegel_source_label="Fast",
                riegel_source_distance_miles=fast_source_distance_miles,
            ),
        },
        "tempo": {
            "workout_name": "Tempo",
            **tempo_meta,
            "periods": _build_periods_for_workout(
                tempo_workout,
                since_6_months=since_6_months,
                since_8_weeks=since_8_weeks,
                progression_scope=tempo_scope,
            ),
        },
        "min_run": {
            "workout_name": "Min Run",
            **min_run_meta,
            "periods": _build_periods_for_workout(
                min_run_workout,
                since_6_months=since_6_months,
                since_8_weeks=since_8_weeks,
                progression_scope=min_run_scope,
            ),
        },
        "sprints": {
            "workouts": [
                {
                    "workout_name": "x800",
                    **_serialize_interval_progression_meta(x800_workout),
                    "distance_miles": x800_distance_miles,
                    "distance_meters": conversion_payload["x800_meters"],
                    "distance_yards": conversion_payload["x800_yards"],
                    "periods": _build_periods_for_workout(
                        x800_workout,
                        since_6_months=since_6_months,
                        since_8_weeks=since_8_weeks,
                        progression_scope=x800_scope,
                        avg_from_max_when_max_below=X800_MAX_DAY_AVG_THRESHOLD,
                    ),
                },
                {
                    "workout_name": "x400",
                    **_serialize_interval_progression_meta(x400_workout),
                    "distance_miles": x400_distance_miles,
                    "distance_meters": conversion_payload["x400_meters"],
                    "distance_yards": conversion_payload["x400_yards"],
                    "periods": _build_periods_for_workout(
                        x400_workout,
                        since_6_months=since_6_months,
                        since_8_weeks=since_8_weeks,
                        progression_scope=x400_scope,
                        riegel_target_label="x400",
                        riegel_target_distance_miles=x400_distance_miles,
                        riegel_source_6_months_mph=_positive_float(getattr(x800_best_6, "max_mph", None)),
                        riegel_source_8_weeks_mph=_positive_float(getattr(x800_best_8, "max_mph", None)),
                        riegel_source_last_mph=_positive_float(getattr(x800_last, "max_mph", None)),
                        riegel_source_label="x800",
                        riegel_source_distance_miles=x800_distance_miles,
                    ),
                },
                {
                    "workout_name": "x200",
                    **_serialize_interval_progression_meta(x200_workout),
                    "distance_miles": x200_distance_miles,
                    "distance_meters": conversion_payload["x200_meters"],
                    "distance_yards": conversion_payload["x200_yards"],
                    "periods": _build_periods_for_workout(
                        x200_workout,
                        since_6_months=since_6_months,
                        since_8_weeks=since_8_weeks,
                        progression_scope=x200_scope,
                        riegel_target_label="x200",
                        riegel_target_distance_miles=x200_distance_miles,
                        riegel_source_6_months_mph=_positive_float(getattr(x800_best_6, "max_mph", None)),
                        riegel_source_8_weeks_mph=_positive_float(getattr(x800_best_8, "max_mph", None)),
                        riegel_source_last_mph=_positive_float(getattr(x800_last, "max_mph", None)),
                        riegel_source_label="x800",
                        riegel_source_distance_miles=x800_distance_miles,
                    ),
                },
            ],
        },
    }

    selection_map = _selected_period_key_map()
    _normalize_section_selection(snapshot.get("fast"), getattr(fast_workout, "id", None), selection_map)
    _normalize_section_selection(snapshot.get("tempo"), getattr(tempo_workout, "id", None), selection_map)
    _normalize_section_selection(snapshot.get("min_run"), getattr(min_run_workout, "id", None), selection_map)
    sprint_sections = list(((snapshot.get("sprints") or {}).get("workouts") or []))
    workout_lookup = {
        "x800": x800_workout,
        "x400": x400_workout,
        "x200": x200_workout,
    }
    for sprint_section in sprint_sections:
        workout_name = str(sprint_section.get("workout_name") or "")
        workout = workout_lookup.get(workout_name)
        _normalize_section_selection(sprint_section, getattr(workout, "id", None), selection_map)

    return snapshot
