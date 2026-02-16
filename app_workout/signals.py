from __future__ import annotations
from typing import Optional, List
from django.db.models.signals import post_save, post_delete
from django.dispatch import receiver
from django.db import transaction
from django.db.utils import OperationalError
from .models import (
    CardioWorkout,
    CardioDailyLog,
    CardioDailyLogDetail,
    StrengthRoutine,
    StrengthDailyLog,
    StrengthDailyLogDetail,
    SupplementalRoutine,
    SupplementalDailyLog,
    SupplementalDailyLogDetail,
)
from .db_utils import sqlite_atomic_retry
from .cardio_goals_utils import (
    ensure_cardio_goal_row_for_workout,
    sync_cardio_goals_for_workout,
)
from .strength_goals_utils import (
    ensure_strength_goal_row_for_routine,
    sync_strength_goals_for_routine,
)
from .supplemental_goals_utils import (
    ensure_supplemental_goal_row_for_routine,
    sync_supplemental_goals_for_routine,
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

def _refresh_cardio_goals(workout_id: Optional[int]) -> None:
    if workout_id is None:
        return
    wid = int(workout_id)
    try:
        sync_cardio_goals_for_workout(wid)
    except OperationalError as exc:
        msg = str(exc).lower()
        if "database is locked" in msg or "database is busy" in msg:
            transaction.on_commit(lambda: sync_cardio_goals_for_workout(wid))
            return
        raise


def _refresh_strength_goals(routine_id: Optional[int]) -> None:
    if routine_id is None:
        return
    rid = int(routine_id)
    try:
        sync_strength_goals_for_routine(rid)
    except OperationalError as exc:
        msg = str(exc).lower()
        if "database is locked" in msg or "database is busy" in msg:
            transaction.on_commit(lambda: sync_strength_goals_for_routine(rid))
            return
        raise


def _refresh_supplemental_goals(routine_id: Optional[int]) -> None:
    if routine_id is None:
        return
    rid = int(routine_id)
    try:
        sync_supplemental_goals_for_routine(rid)
    except OperationalError as exc:
        msg = str(exc).lower()
        if "database is locked" in msg or "database is busy" in msg:
            transaction.on_commit(lambda: sync_supplemental_goals_for_routine(rid))
            return
        raise


def _workout_id_for_log(log_id: int) -> Optional[int]:
    return (
        CardioDailyLog.objects
        .filter(pk=log_id)
        .values_list("workout_id", flat=True)
        .first()
    )


def _routine_id_for_strength_log(log_id: int) -> Optional[int]:
    return (
        StrengthDailyLog.objects
        .filter(pk=log_id)
        .values_list("routine_id", flat=True)
        .first()
    )


def _routine_id_for_supplemental_log(log_id: int) -> Optional[int]:
    return (
        SupplementalDailyLog.objects
        .filter(pk=log_id)
        .values_list("routine_id", flat=True)
        .first()
    )


def _recompute_log_and_goals(log_id: int) -> None:
    recompute_log_aggregates(log_id)
    _refresh_cardio_goals(_workout_id_for_log(log_id))

def recompute_log_aggregates(log_id: int) -> None:
    def _do() -> None:
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

    sqlite_atomic_retry(_do)

# ---- receivers (details) ----

@receiver(post_save, sender=CardioDailyLogDetail)
def _detail_saved(sender, instance: CardioDailyLogDetail, **kwargs):
    try:
        _recompute_log_and_goals(instance.log_id)
    except OperationalError as exc:
        # Under high write contention on SQLite, fall back to recomputing after commit.
        msg = str(exc).lower()
        if "database is locked" in msg or "database is busy" in msg:
            transaction.on_commit(lambda: _recompute_log_and_goals(instance.log_id))
            return
        raise

@receiver(post_delete, sender=CardioDailyLogDetail)
def _detail_deleted(sender, instance: CardioDailyLogDetail, **kwargs):
    try:
        _recompute_log_and_goals(instance.log_id)
    except OperationalError as exc:
        msg = str(exc).lower()
        if "database is locked" in msg or "database is busy" in msg:
            transaction.on_commit(lambda: _recompute_log_and_goals(instance.log_id))
            return
        raise


@receiver(post_save, sender=CardioWorkout)
def _cardio_workout_saved(sender, instance: CardioWorkout, **kwargs):
    try:
        ensure_cardio_goal_row_for_workout(instance.id)
        _refresh_cardio_goals(instance.id)
    except OperationalError as exc:
        msg = str(exc).lower()
        if "database is locked" in msg or "database is busy" in msg:
            transaction.on_commit(lambda: sync_cardio_goals_for_workout(instance.id))
            return
        raise


@receiver(post_save, sender=CardioDailyLog)
def _cardio_log_saved(sender, instance: CardioDailyLog, **kwargs):
    _refresh_cardio_goals(instance.workout_id)


@receiver(post_delete, sender=CardioDailyLog)
def _cardio_log_deleted(sender, instance: CardioDailyLog, **kwargs):
    _refresh_cardio_goals(instance.workout_id)


@receiver(post_save, sender=StrengthRoutine)
def _strength_routine_saved(sender, instance: StrengthRoutine, **kwargs):
    try:
        ensure_strength_goal_row_for_routine(instance.id)
        _refresh_strength_goals(instance.id)
    except OperationalError as exc:
        msg = str(exc).lower()
        if "database is locked" in msg or "database is busy" in msg:
            transaction.on_commit(lambda: sync_strength_goals_for_routine(instance.id))
            return
        raise


@receiver(post_save, sender=StrengthDailyLog)
def _strength_log_saved(sender, instance: StrengthDailyLog, **kwargs):
    _refresh_strength_goals(instance.routine_id)


@receiver(post_delete, sender=StrengthDailyLog)
def _strength_log_deleted(sender, instance: StrengthDailyLog, **kwargs):
    _refresh_strength_goals(instance.routine_id)


def recompute_strength_log_aggregates(log_id: int) -> None:
    def _do() -> None:
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

        # Compute elapsed minutes using the span of all known timestamps.
        minutes_elapsed = 0.0
        if details:
            time_candidates = [dt for dt in [log.datetime_started] if dt is not None]
            time_candidates.extend(d.datetime for d in details if d.datetime is not None)
            if len(time_candidates) >= 2:
                start_dt = min(time_candidates)
                end_dt = max(time_candidates)
                try:
                    delta_minutes = (end_dt - start_dt).total_seconds() / 60.0
                except Exception:
                    delta_minutes = 0.0
                minutes_elapsed = delta_minutes if delta_minutes > 0 else 0.0

        StrengthDailyLog.objects.filter(pk=log_id).update(
            total_reps_completed=total_reps if details else None,
            max_reps=max_reps,
            max_weight=max_weight,
            minutes_elapsed=minutes_elapsed,
        )

    sqlite_atomic_retry(_do)


@receiver(post_save, sender=StrengthDailyLogDetail)
def _strength_detail_saved(sender, instance: StrengthDailyLogDetail, **kwargs):
    try:
        recompute_strength_log_aggregates(instance.log_id)
        _refresh_strength_goals(_routine_id_for_strength_log(instance.log_id))
    except OperationalError as exc:
        msg = str(exc).lower()
        if "database is locked" in msg or "database is busy" in msg:
            transaction.on_commit(
                lambda: (
                    recompute_strength_log_aggregates(instance.log_id),
                    _refresh_strength_goals(_routine_id_for_strength_log(instance.log_id)),
                )
            )
            return
        raise


@receiver(post_delete, sender=StrengthDailyLogDetail)
def _strength_detail_deleted(sender, instance: StrengthDailyLogDetail, **kwargs):
    try:
        recompute_strength_log_aggregates(instance.log_id)
        _refresh_strength_goals(_routine_id_for_strength_log(instance.log_id))
    except OperationalError as exc:
        msg = str(exc).lower()
        if "database is locked" in msg or "database is busy" in msg:
            transaction.on_commit(
                lambda: (
                    recompute_strength_log_aggregates(instance.log_id),
                    _refresh_strength_goals(_routine_id_for_strength_log(instance.log_id)),
                )
            )
            return
        raise


@receiver(post_save, sender=SupplementalRoutine)
def _supplemental_routine_saved(sender, instance: SupplementalRoutine, **kwargs):
    try:
        ensure_supplemental_goal_row_for_routine(instance.id)
        _refresh_supplemental_goals(instance.id)
    except OperationalError as exc:
        msg = str(exc).lower()
        if "database is locked" in msg or "database is busy" in msg:
            transaction.on_commit(lambda: sync_supplemental_goals_for_routine(instance.id))
            return
        raise


@receiver(post_save, sender=SupplementalDailyLog)
def _supplemental_log_saved(sender, instance: SupplementalDailyLog, **kwargs):
    _refresh_supplemental_goals(instance.routine_id)


@receiver(post_delete, sender=SupplementalDailyLog)
def _supplemental_log_deleted(sender, instance: SupplementalDailyLog, **kwargs):
    _refresh_supplemental_goals(instance.routine_id)


# --- Supplemental aggregates ---

def recompute_supplemental_log_aggregates(log_id: int) -> None:
    def _do() -> None:
        log = SupplementalDailyLog.objects.get(pk=log_id)
        details: List[SupplementalDailyLogDetail] = list(
            log.details.all().order_by("datetime", "id")
        )

        # Best set value across the session
        best_unit = max(
            (float(d.unit_count) for d in details if d.unit_count is not None),
            default=None,
        )
        total_completed = best_unit

        datetime_started = log.datetime_started
        if details:
            first_dt = min((d.datetime for d in details if d.datetime is not None), default=None)
            if first_dt and (datetime_started is None or first_dt < datetime_started):
                datetime_started = first_dt

        SupplementalDailyLog.objects.filter(pk=log_id).update(
            total_completed=total_completed,
            datetime_started=datetime_started,
        )

    sqlite_atomic_retry(_do)


@receiver(post_save, sender=SupplementalDailyLogDetail)
def _supplemental_detail_saved(sender, instance: SupplementalDailyLogDetail, **kwargs):
    try:
        recompute_supplemental_log_aggregates(instance.log_id)
        _refresh_supplemental_goals(_routine_id_for_supplemental_log(instance.log_id))
    except OperationalError as exc:
        msg = str(exc).lower()
        if "database is locked" in msg or "database is busy" in msg:
            transaction.on_commit(
                lambda: (
                    recompute_supplemental_log_aggregates(instance.log_id),
                    _refresh_supplemental_goals(
                        _routine_id_for_supplemental_log(instance.log_id)
                    ),
                )
            )
            return
        raise


@receiver(post_delete, sender=SupplementalDailyLogDetail)
def _supplemental_detail_deleted(sender, instance: SupplementalDailyLogDetail, **kwargs):
    try:
        recompute_supplemental_log_aggregates(instance.log_id)
        _refresh_supplemental_goals(_routine_id_for_supplemental_log(instance.log_id))
    except OperationalError as exc:
        msg = str(exc).lower()
        if "database is locked" in msg or "database is busy" in msg:
            transaction.on_commit(
                lambda: (
                    recompute_supplemental_log_aggregates(instance.log_id),
                    _refresh_supplemental_goals(
                        _routine_id_for_supplemental_log(instance.log_id)
                    ),
                )
            )
            return
        raise
