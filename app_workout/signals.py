from __future__ import annotations
from typing import Optional, List
from django.db.models.signals import post_save, post_delete
from django.dispatch import receiver
from .models import (
    CardioDailyLog,
    CardioDailyLogDetail,
    StrengthDailyLog,
    StrengthDailyLogDetail,
)

# ---- helpers (interval & treadmill minutes) ----

def _to_minutes_row(d: CardioDailyLogDetail) -> Optional[float]:
    if d.running_minutes is not None or d.running_seconds is not None:
        m = float(d.running_minutes or 0)
        s = float(d.running_seconds or 0.0)
        return m + s / 60.0
    return None

def _tm_to_minutes_row(d: CardioDailyLogDetail) -> Optional[float]:
    if d.treadmill_time_minutes is not None or d.treadmill_time_seconds is not None:
        m = float(d.treadmill_time_minutes or 0)
        s = float(d.treadmill_time_seconds or 0.0)
        return m + s / 60.0
    return None

# ---- aggregates ----

def recompute_log_aggregates(log_id: int) -> None:
    log = CardioDailyLog.objects.get(pk=log_id)
    unit = getattr(getattr(log, "workout", None), "unit", None)
    unit_type_name = getattr(getattr(unit, "unit_type", None), "name", "").lower()

    details: List[CardioDailyLogDetail] = list(log.details.all().order_by("datetime", "id"))

    total_minutes = 0.0
    total_miles = 0.0
    have_minutes = False
    have_miles = False

    mph_weighted_num = 0.0
    mph_weighted_den = 0.0

    changed: List[CardioDailyLogDetail] = []

    for d in details:
        mins = _to_minutes_row(d)
        miles = float(d.running_miles) if d.running_miles is not None else None

        mph = None
        if miles is not None and mins is not None and mins > 0:
            mph = round(miles / (mins / 60.0), 3)
        if d.running_mph != mph:
            d.running_mph = mph
            changed.append(d)

        if mins is not None:
            have_minutes = True
            total_minutes += mins

        if miles is not None:
            have_miles = True
            total_miles += miles

        if mph is not None:
            if unit_type_name == "time":
                hours = (mins / 60.0) if mins else None
                if hours:
                    mph_weighted_num += mph * hours
                    mph_weighted_den += hours
                else:
                    mph_weighted_num += mph
                    mph_weighted_den += 1.0
            elif unit_type_name == "distance":
                if miles is not None:
                    mph_weighted_num += mph * miles
                    mph_weighted_den += miles
                else:
                    mph_weighted_num += mph
                    mph_weighted_den += 1.0
            else:
                mph_weighted_num += mph
                mph_weighted_den += 1.0

    if changed:
        CardioDailyLogDetail.objects.bulk_update(changed, ["running_mph"])

    avg_mph = (mph_weighted_num / mph_weighted_den) if mph_weighted_den > 0 else None

    total_completed = None

    if unit is not None:
        if unit_type_name == "time":
            if have_minutes:
                total_completed = total_minutes
        elif unit_type_name == "distance":
            num = float(unit.mile_equiv_numerator or 0.0)
            den = float(unit.mile_equiv_denominator or 1.0)
            miles_per_unit = (num / den) if den else 0.0
            if have_miles and miles_per_unit > 0:
                total_completed = total_miles / miles_per_unit

    if total_completed is None:
        if have_minutes:
            total_completed = total_minutes
        elif have_miles:
            total_completed = total_miles

    if details:
        last_tm = _tm_to_minutes_row(details[-1])
        minutes_elapsed = float(last_tm or 0.0)
    else:
        minutes_elapsed = 0.0

    CardioDailyLog.objects.filter(pk=log_id).update(
        avg_mph=avg_mph,
        total_completed=total_completed,
        minutes_elapsed=minutes_elapsed,
    )

# ---- receivers (details) ----

@receiver(post_save, sender=CardioDailyLogDetail)
def _detail_saved(sender, instance: CardioDailyLogDetail, **kwargs):
    recompute_log_aggregates(instance.log_id)

@receiver(post_delete, sender=CardioDailyLogDetail)
def _detail_deleted(sender, instance: CardioDailyLogDetail, **kwargs):
    recompute_log_aggregates(instance.log_id)


def recompute_strength_log_aggregates(log_id: int) -> None:
    log = StrengthDailyLog.objects.get(pk=log_id)
    details: List[StrengthDailyLogDetail] = list(
        log.details.all().order_by("datetime", "id")
    )
    total_reps = sum(
        (d.reps * d.weight) / log.routine.hundred_points_weight
        for d in details
        if d.reps is not None and d.weight is not None
    )
    max_reps = max(
        (
            (d.reps * d.weight) / log.routine.hundred_points_weight
            for d in details
            if d.reps is not None and d.weight is not None
        ),
        default=None,
    )
    max_weight = max((d.weight for d in details if d.weight is not None), default=None)
    minutes_elapsed = 0.0
    if details:
        last_dt = details[-1].datetime
        minutes_elapsed = (last_dt - log.datetime_started).total_seconds() / 60.0

    StrengthDailyLog.objects.filter(pk=log_id).update(
        total_reps_completed=total_reps if details else None,
        max_reps=max_reps,
        max_weight=max_weight,
        minutes_elapsed=minutes_elapsed,
    )


@receiver(post_save, sender=StrengthDailyLogDetail)
def _strength_detail_saved(sender, instance: StrengthDailyLogDetail, **kwargs):
    recompute_strength_log_aggregates(instance.log_id)


@receiver(post_delete, sender=StrengthDailyLogDetail)
def _strength_detail_deleted(sender, instance: StrengthDailyLogDetail, **kwargs):
    recompute_strength_log_aggregates(instance.log_id)
