from __future__ import annotations

from datetime import timedelta
from math import isfinite
from typing import Dict, Optional

from django.utils import timezone

from .distance_conversions import (
    get_distance_conversion_payload,
    get_sprint_distance_miles,
)
from .models import CardioDailyLog, CardioWorkout


RIEGEL_EXPONENT = 1.06
FAST_SOURCE_DISTANCE_MILES = 3.0
FAST_MAX_DAY_AVG_THRESHOLD = 10.0
X800_MAX_DAY_AVG_THRESHOLD = 11.4


def _positive_float(value) -> Optional[float]:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    if not isfinite(number) or number <= 0:
        return None
    return number


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


def _best_log_for_window(
    workout: Optional[CardioWorkout],
    metric_field: str,
    since=None,
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
    return qs.order_by(f"-{metric_field}", "-datetime_started", "-pk").first()


def _last_log(workout: Optional[CardioWorkout]) -> Optional[CardioDailyLog]:
    if workout is None:
        return None
    return (
        CardioDailyLog.objects
        .filter(workout=workout, ignore=False)
        .exclude(max_mph__isnull=True, avg_mph__isnull=True)
        .order_by("-datetime_started", "-pk")
        .first()
    )


def _serialize_metric_log(log: Optional[CardioDailyLog], metric_field: str, prefix: str) -> Dict[str, object]:
    if log is None:
        return {
            f"{prefix}_log_id": None,
            f"{prefix}_activity_date": None,
            f"{prefix}_datetime_started": None,
            metric_field: None,
        }

    dt = getattr(log, "datetime_started", None)
    activity_date = getattr(log, "activity_date", None)
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
        },
        "max_or_predicted_mph": max_or_predicted_mph,
    }


def _build_periods_for_workout(
    workout: Optional[CardioWorkout],
    since_6_months,
    since_8_weeks,
    avg_from_max_when_max_over: Optional[float] = None,
    riegel_target_label: Optional[str] = None,
    riegel_target_distance_miles: Optional[float] = None,
    riegel_source_6_months_mph: Optional[float] = None,
    riegel_source_8_weeks_mph: Optional[float] = None,
    riegel_source_last_mph: Optional[float] = None,
    riegel_source_label: Optional[str] = None,
    riegel_source_distance_miles: Optional[float] = None,
) -> list[Dict[str, object]]:
    max_best_6 = _best_log_for_window(workout, "max_mph", since=since_6_months)
    max_best_8 = _best_log_for_window(workout, "max_mph", since=since_8_weeks)
    avg_best_6 = _best_log_for_window(workout, "avg_mph", since=since_6_months)
    avg_best_8 = _best_log_for_window(workout, "avg_mph", since=since_8_weeks)
    last_log = _last_log(workout)

    def apply_avg_override(max_log, avg_log):
        threshold = _positive_float(avg_from_max_when_max_over)
        max_mph = _positive_float(getattr(max_log, "max_mph", None)) if max_log is not None else None
        if threshold is not None and max_mph is not None and max_mph < threshold and max_log is not None:
            return max_log, True
        return avg_log, False

    avg_best_6, avg_locked_6 = apply_avg_override(max_best_6, avg_best_6)
    avg_best_8, avg_locked_8 = apply_avg_override(max_best_8, avg_best_8)
    last_avg_log, last_avg_locked = apply_avg_override(last_log, last_log)

    return [
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

    x800_best_6 = _best_log_for_window(x800_workout, "max_mph", since=since_6_months)
    x800_best_8 = _best_log_for_window(x800_workout, "max_mph", since=since_8_weeks)
    x800_last = _last_log(x800_workout)

    x800_distance_miles = get_sprint_distance_miles("x800")
    x400_distance_miles = get_sprint_distance_miles("x400")
    x200_distance_miles = get_sprint_distance_miles("x200")

    return {
        "conversions": conversion_payload,
        "fast": {
            "workout_name": "Fast",
            "periods": _build_periods_for_workout(
                fast_workout,
                since_6_months=since_6_months,
                since_8_weeks=since_8_weeks,
                avg_from_max_when_max_over=FAST_MAX_DAY_AVG_THRESHOLD,
                riegel_target_label="10K",
                riegel_target_distance_miles=conversion_payload["ten_k_miles"],
                riegel_source_6_months_mph=_positive_float(getattr(_best_log_for_window(fast_workout, "max_mph", since=since_6_months), "max_mph", None)),
                riegel_source_8_weeks_mph=_positive_float(getattr(_best_log_for_window(fast_workout, "max_mph", since=since_8_weeks), "max_mph", None)),
                riegel_source_last_mph=_positive_float(getattr(_last_log(fast_workout), "max_mph", None)),
                riegel_source_label="Fast",
                riegel_source_distance_miles=FAST_SOURCE_DISTANCE_MILES,
            ),
        },
        "tempo": {
            "workout_name": "Tempo",
            "periods": _build_periods_for_workout(
                tempo_workout,
                since_6_months=since_6_months,
                since_8_weeks=since_8_weeks,
            ),
        },
        "min_run": {
            "workout_name": "Min Run",
            "periods": _build_periods_for_workout(
                min_run_workout,
                since_6_months=since_6_months,
                since_8_weeks=since_8_weeks,
            ),
        },
        "sprints": {
            "workouts": [
                {
                    "workout_name": "x800",
                    "distance_miles": x800_distance_miles,
                    "distance_meters": conversion_payload["x800_meters"],
                    "distance_yards": conversion_payload["x800_yards"],
                    "periods": _build_periods_for_workout(
                        x800_workout,
                        since_6_months=since_6_months,
                        since_8_weeks=since_8_weeks,
                        avg_from_max_when_max_over=X800_MAX_DAY_AVG_THRESHOLD,
                    ),
                },
                {
                    "workout_name": "x400",
                    "distance_miles": x400_distance_miles,
                    "distance_meters": conversion_payload["x400_meters"],
                    "distance_yards": conversion_payload["x400_yards"],
                    "periods": _build_periods_for_workout(
                        x400_workout,
                        since_6_months=since_6_months,
                        since_8_weeks=since_8_weeks,
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
                    "distance_miles": x200_distance_miles,
                    "distance_meters": conversion_payload["x200_meters"],
                    "distance_yards": conversion_payload["x200_yards"],
                    "periods": _build_periods_for_workout(
                        x200_workout,
                        since_6_months=since_6_months,
                        since_8_weeks=since_8_weeks,
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
