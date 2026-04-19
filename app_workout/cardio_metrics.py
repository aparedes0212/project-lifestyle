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


def _best_log_for_window(workout: Optional[CardioWorkout], since=None) -> Optional[CardioDailyLog]:
    if workout is None:
        return None
    qs = (
        CardioDailyLog.objects
        .filter(workout=workout, ignore=False)
        .exclude(max_mph__isnull=True)
    )
    if since is not None:
        qs = qs.filter(datetime_started__gte=since)
    return qs.order_by("-max_mph", "-datetime_started", "-pk").first()


def _last_log(workout: Optional[CardioWorkout]) -> Optional[CardioDailyLog]:
    if workout is None:
        return None
    return (
        CardioDailyLog.objects
        .filter(workout=workout, ignore=False)
        .exclude(max_mph__isnull=True)
        .order_by("-datetime_started", "-pk")
        .first()
    )


def _serialize_log(log: Optional[CardioDailyLog]) -> Dict[str, object]:
    if log is None:
        return {
            "log_id": None,
            "activity_date": None,
            "datetime_started": None,
            "max_mph": None,
        }

    dt = getattr(log, "datetime_started", None)
    return {
        "log_id": log.id,
        "activity_date": getattr(log, "activity_date", None).isoformat() if getattr(log, "activity_date", None) else None,
        "datetime_started": dt.isoformat() if dt is not None else None,
        "max_mph": _positive_float(getattr(log, "max_mph", None)),
    }


def _serialize_period(
    key: str,
    label: str,
    log: Optional[CardioDailyLog],
    riegel_target_label: Optional[str] = None,
    riegel_target_distance_miles: Optional[float] = None,
    riegel_source_mph: Optional[float] = None,
    riegel_source_label: Optional[str] = None,
    riegel_source_distance_miles: Optional[float] = None,
) -> Dict[str, object]:
    max_mph = _positive_float(getattr(log, "max_mph", None)) if log is not None else None
    predicted_mph = _riegel_predicted_mph(
        source_mph=riegel_source_mph,
        source_distance_miles=riegel_source_distance_miles,
        target_distance_miles=riegel_target_distance_miles,
    )
    return {
        "key": key,
        "label": label,
        **_serialize_log(log),
        "riegel": {
            "source_label": riegel_source_label,
            "source_distance_miles": _positive_float(riegel_source_distance_miles),
            "source_mph": _positive_float(riegel_source_mph),
            "target_label": riegel_target_label,
            "target_distance_miles": _positive_float(riegel_target_distance_miles),
            "predicted_mph": predicted_mph,
        },
        "max_mph_display": max_mph,
    }


def get_cardio_metrics_snapshot(now=None) -> Dict[str, object]:
    now = now or timezone.now()
    since_6_months = now - timedelta(days=int(round(6 * 30.4375)))
    since_8_weeks = now - timedelta(weeks=8)
    conversion_payload = get_distance_conversion_payload()

    fast_workout = _find_workout("5K Prep", "Fast")
    x800_workout = _find_workout("Sprints", "x800")
    x400_workout = _find_workout("Sprints", "x400")
    x200_workout = _find_workout("Sprints", "x200")

    fast_best_6 = _best_log_for_window(fast_workout, since=since_6_months)
    fast_best_8 = _best_log_for_window(fast_workout, since=since_8_weeks)
    fast_last = _last_log(fast_workout)

    x800_best_6 = _best_log_for_window(x800_workout, since=since_6_months)
    x800_best_8 = _best_log_for_window(x800_workout, since=since_8_weeks)
    x800_last = _last_log(x800_workout)

    x400_best_6 = _best_log_for_window(x400_workout, since=since_6_months)
    x400_best_8 = _best_log_for_window(x400_workout, since=since_8_weeks)
    x400_last = _last_log(x400_workout)

    x200_best_6 = _best_log_for_window(x200_workout, since=since_6_months)
    x200_best_8 = _best_log_for_window(x200_workout, since=since_8_weeks)
    x200_last = _last_log(x200_workout)

    x800_distance_miles = get_sprint_distance_miles("x800")
    x400_distance_miles = get_sprint_distance_miles("x400")
    x200_distance_miles = get_sprint_distance_miles("x200")

    return {
        "conversions": conversion_payload,
        "fast": {
            "workout_name": "Fast",
            "periods": [
                _serialize_period(
                    key="last_6_months",
                    label="Max in last 6 months",
                    log=fast_best_6,
                    riegel_target_label="10K",
                    riegel_target_distance_miles=conversion_payload["ten_k_miles"],
                    riegel_source_label="Fast",
                    riegel_source_distance_miles=FAST_SOURCE_DISTANCE_MILES,
                    riegel_source_mph=_positive_float(getattr(fast_best_6, "max_mph", None)),
                ),
                _serialize_period(
                    key="last_8_weeks",
                    label="Max in last 8 weeks",
                    log=fast_best_8,
                    riegel_target_label="10K",
                    riegel_target_distance_miles=conversion_payload["ten_k_miles"],
                    riegel_source_label="Fast",
                    riegel_source_distance_miles=FAST_SOURCE_DISTANCE_MILES,
                    riegel_source_mph=_positive_float(getattr(fast_best_8, "max_mph", None)),
                ),
                _serialize_period(
                    key="last_time",
                    label="Last time Fast was done",
                    log=fast_last,
                    riegel_target_label="10K",
                    riegel_target_distance_miles=conversion_payload["ten_k_miles"],
                    riegel_source_label="Fast",
                    riegel_source_distance_miles=FAST_SOURCE_DISTANCE_MILES,
                    riegel_source_mph=_positive_float(getattr(fast_last, "max_mph", None)),
                ),
            ],
        },
        "sprints": {
            "workouts": [
                {
                    "workout_name": "x800",
                    "distance_miles": x800_distance_miles,
                    "distance_meters": conversion_payload["x800_meters"],
                    "distance_yards": conversion_payload["x800_yards"],
                    "periods": [
                        _serialize_period("last_6_months", "Max in last 6 months", x800_best_6),
                        _serialize_period("last_8_weeks", "Max in last 8 weeks", x800_best_8),
                        _serialize_period("last_time", "Last time x800 was done", x800_last),
                    ],
                },
                {
                    "workout_name": "x400",
                    "distance_miles": x400_distance_miles,
                    "distance_meters": conversion_payload["x400_meters"],
                    "distance_yards": conversion_payload["x400_yards"],
                    "periods": [
                        _serialize_period(
                            key="last_6_months",
                            label="Max in last 6 months",
                            log=x400_best_6,
                            riegel_target_label="x400",
                            riegel_target_distance_miles=x400_distance_miles,
                            riegel_source_label="x800",
                            riegel_source_distance_miles=x800_distance_miles,
                            riegel_source_mph=_positive_float(getattr(x800_best_6, "max_mph", None)),
                        ),
                        _serialize_period(
                            key="last_8_weeks",
                            label="Max in last 8 weeks",
                            log=x400_best_8,
                            riegel_target_label="x400",
                            riegel_target_distance_miles=x400_distance_miles,
                            riegel_source_label="x800",
                            riegel_source_distance_miles=x800_distance_miles,
                            riegel_source_mph=_positive_float(getattr(x800_best_8, "max_mph", None)),
                        ),
                        _serialize_period(
                            key="last_time",
                            label="Last time x400 was done",
                            log=x400_last,
                            riegel_target_label="x400",
                            riegel_target_distance_miles=x400_distance_miles,
                            riegel_source_label="x800",
                            riegel_source_distance_miles=x800_distance_miles,
                            riegel_source_mph=_positive_float(getattr(x800_last, "max_mph", None)),
                        ),
                    ],
                },
                {
                    "workout_name": "x200",
                    "distance_miles": x200_distance_miles,
                    "distance_meters": conversion_payload["x200_meters"],
                    "distance_yards": conversion_payload["x200_yards"],
                    "periods": [
                        _serialize_period(
                            key="last_6_months",
                            label="Max in last 6 months",
                            log=x200_best_6,
                            riegel_target_label="x200",
                            riegel_target_distance_miles=x200_distance_miles,
                            riegel_source_label="x800",
                            riegel_source_distance_miles=x800_distance_miles,
                            riegel_source_mph=_positive_float(getattr(x800_best_6, "max_mph", None)),
                        ),
                        _serialize_period(
                            key="last_8_weeks",
                            label="Max in last 8 weeks",
                            log=x200_best_8,
                            riegel_target_label="x200",
                            riegel_target_distance_miles=x200_distance_miles,
                            riegel_source_label="x800",
                            riegel_source_distance_miles=x800_distance_miles,
                            riegel_source_mph=_positive_float(getattr(x800_best_8, "max_mph", None)),
                        ),
                        _serialize_period(
                            key="last_time",
                            label="Last time x200 was done",
                            log=x200_last,
                            riegel_target_label="x200",
                            riegel_target_distance_miles=x200_distance_miles,
                            riegel_source_label="x800",
                            riegel_source_distance_miles=x800_distance_miles,
                            riegel_source_mph=_positive_float(getattr(x800_last, "max_mph", None)),
                        ),
                    ],
                },
            ],
        },
    }
