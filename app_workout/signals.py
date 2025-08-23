from __future__ import annotations
from typing import Optional, List
from django.db import transaction
from django.db.models.signals import post_save, post_delete
from django.dispatch import receiver
from .models import CardioDailyLog, CardioDailyLogDetail

EPS = 1e-9

# ---- helpers (interval & treadmill minutes) ----

def _to_minutes_row(d: CardioDailyLogDetail) -> Optional[float]:
    # interval minutes (not cumulative)
    if d.running_minutes is not None or d.running_seconds is not None:
        m = float(d.running_minutes or 0)
        s = float(d.running_seconds or 0.0)
        return m + s / 60.0
    return None

def _tm_to_minutes_row(d: CardioDailyLogDetail) -> Optional[float]:
    # treadmill cumulative minutes at this row
    if d.treadmill_time_minutes is not None or d.treadmill_time_seconds is not None:
        m = float(d.treadmill_time_minutes or 0)
        s = float(d.treadmill_time_seconds or 0.0)
        return m + s / 60.0
    return None

def _set_interval_from_minutes(d: CardioDailyLogDetail, total: float) -> None:
    total = max(0.0, float(total or 0.0))
    m = int(total)
    s = (total - m) * 60.0
    d.running_minutes = m
    d.running_seconds = round(s, 3)

def _set_tm_from_minutes(d: CardioDailyLogDetail, cumulative: float) -> None:
    cumulative = max(0.0, float(cumulative or 0.0))
    m = int(cumulative)
    s = (cumulative - m) * 60.0
    d.treadmill_time_minutes = m
    d.treadmill_time_seconds = round(s, 3)

def _recalc_mph(d: CardioDailyLogDetail) -> None:
    miles = d.running_miles
    interval_min = _to_minutes_row(d)
    if miles is None or interval_min is None or interval_min <= 0:
        d.running_mph = None
        return
    mph = float(miles) / (interval_min / 60.0)
    d.running_mph = round(mph, 3)

# ---- aggregates ----

def _to_minutes_any(d: CardioDailyLogDetail) -> Optional[float]:
    # prefer treadmill time if given, else interval time
    tm = _tm_to_minutes_row(d)
    if tm is not None:
        # for weighting we still need *interval* minutes, not cumulative
        # but this is only used when interval mins are missing completely
        pass
    if d.running_minutes is not None or d.running_seconds is not None:
        return _to_minutes_row(d)
    # fall back: treat cumulative difference as interval if previous unknown (handled in normalize)
    return None

def recompute_log_aggregates(log_id: int) -> None:
    log = CardioDailyLog.objects.get(pk=log_id)
    details = list(log.details.all().order_by("datetime", "id"))

    total_minutes = 0.0
    total_miles = 0.0
    have_minutes = False
    have_miles = False

    max_mph = None
    mph_weighted_num = 0.0
    mph_weighted_den = 0.0

    for d in details:
        mins = _to_minutes_row(d)
        miles = float(d.running_miles) if d.running_miles is not None else None
        mph = float(d.running_mph) if d.running_mph is not None else None

        if mins is not None:
            have_minutes = True
            total_minutes += mins

        if miles is not None:
            have_miles = True
            total_miles += miles

        if mph is not None:
            hours = (mins / 60.0) if mins else None
            if hours:
                mph_weighted_num += mph * hours
                mph_weighted_den += hours
            else:
                mph_weighted_num += mph
                mph_weighted_den += 1.0
            max_mph = max(max_mph or mph, mph)

    avg_mph = (mph_weighted_num / mph_weighted_den) if mph_weighted_den > 0 else None

    # --- choose Total Completed by the workout's unit ---
    total_completed = None
    unit = getattr(getattr(log, "workout", None), "unit", None)

    if unit is not None:
        # unit_type.name: "Time" or "Distance" (per seed data)
        unit_type_name = getattr(getattr(unit, "unit_type", None), "name", "").lower()

        if unit_type_name == "time":
            # minutes are the native "completed" metric
            if have_minutes:
                total_completed = total_minutes

        elif unit_type_name == "distance":
            # convert summed miles back to the workout's unit
            # miles_per_unit = numerator / denominator (e.g., 400 / 1609.344 per row)
            num = float(unit.mile_equiv_numerator or 0.0)
            den = float(unit.mile_equiv_denominator or 1.0)
            miles_per_unit = (num / den) if den else 0.0

            if have_miles and miles_per_unit > 0:
                # e.g., for x400 this yields the number of 400m intervals completed
                total_completed = total_miles / miles_per_unit

    # fallback rules if unit missing/mismatched
    if total_completed is None:
        if have_minutes:
            total_completed = total_minutes
        elif have_miles:
            total_completed = total_miles

    # minutes_elapsed = last treadmill cumulative (or 0 if none)
    if details:
        last_tm = _tm_to_minutes_row(details[-1])
        minutes_elapsed = float(last_tm or 0.0)
    else:
        minutes_elapsed = 0.0

    CardioDailyLog.objects.filter(pk=log_id).update(
        max_mph=max_mph,
        avg_mph=avg_mph,
        total_completed=total_completed,
        minutes_elapsed=minutes_elapsed,
    )


# ---- normalize treadmill cumulative ----

@transaction.atomic
def normalize_treadmill_cumulative(log_id: int) -> None:
    """
    Special-case first row: if treadmill_time is provided, accept it as-is (normalized),
    and DO NOT back-calculate interval minutes/seconds from it. From the second row onward,
    treadmill cumulative is authoritative and interval = tm - prev_tm.
    Recalc running_mph from the (possibly unchanged) interval minutes for each row.
    Finally recompute per-log aggregates (minutes_elapsed = last treadmill cumulative).
    """
    log = CardioDailyLog.objects.select_for_update().get(pk=log_id)
    rows: List[CardioDailyLogDetail] = list(log.details.all().order_by("datetime", "id"))

    prev_tm = 0.0
    changed: List[CardioDailyLogDetail] = []

    for idx, d in enumerate(rows):
        tm = _tm_to_minutes_row(d)
        interval = _to_minutes_row(d)

        if idx == 0:
            # ---- FIRST ROW RULES ----
            if tm is not None:
                # accept whatever the frontend sent (clamped >= 0), but do not alter interval fields
                tm = max(0.0, tm)
                _set_tm_from_minutes(d, tm)  # normalize to int/rounded seconds
                # keep running_minutes/seconds exactly as provided
            else:
                # no treadmill cumulative sent -> derive from provided interval (or 0 if missing)
                delta = float(interval or 0.0)
                tm = max(0.0, delta)
                _set_tm_from_minutes(d, tm)
                # keep running_minutes/seconds as provided
            # mph should reflect the interval fields the user provided (or remain None)
            _recalc_mph(d)
            prev_tm = tm
            changed.append(d)
            continue

        # ---- ROWS 2..N RULES ----
        if tm is not None:
            # enforce non-decreasing cumulative
            if tm + EPS < prev_tm:
                tm = prev_tm
                _set_tm_from_minutes(d, tm)
            # interval equals delta
            delta = max(0.0, tm - prev_tm)
            _set_interval_from_minutes(d, delta)
        else:
            # derive cumulative from interval
            delta = float(interval or 0.0)
            tm = prev_tm + delta
            _set_tm_from_minutes(d, tm)

        # recalc mph based on normalized interval
        _recalc_mph(d)

        prev_tm = tm
        changed.append(d)

    if changed:
        CardioDailyLogDetail.objects.bulk_update(
            changed,
            [
                "running_minutes",
                "running_seconds",
                "treadmill_time_minutes",
                "treadmill_time_seconds",
                "running_mph",
            ],
        )

    recompute_log_aggregates(log_id)
# ---- receivers (details) ----

@receiver(post_save, sender=CardioDailyLogDetail)
def _detail_saved(sender, instance: CardioDailyLogDetail, **kwargs):
    normalize_treadmill_cumulative(instance.log_id)

@receiver(post_delete, sender=CardioDailyLogDetail)
def _detail_deleted(sender, instance: CardioDailyLogDetail, **kwargs):
    normalize_treadmill_cumulative(instance.log_id)
