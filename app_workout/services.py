# services.py
from __future__ import annotations
from datetime import timedelta, datetime as _dt
from typing import Optional, List, Dict, Tuple
from collections import Counter
from math import inf, ceil, isfinite
from threading import Lock
import logging
from django.utils import timezone
from django.conf import settings
from zoneinfo import ZoneInfo
import os
from django.db.models import QuerySet, OuterRef, Subquery, DateTimeField, F, Min, Max, Count
from django.db import transaction
from django.db import connection
from django.db.utils import OperationalError
from django.db.models.functions import TruncDate

from .models import (
    Program,
    CardioPlan,
    CardioDailyLog,
    CardioRoutine,
    CardioWorkout,
    CardioProgression,
    StrengthPlan,
    StrengthDailyLog,
    StrengthRoutine,
    VwStrengthProgression,
    SupplementalPlan,
    SupplementalDailyLog,
    SupplementalRoutine,
    SupplementalDailyLogDetail,
    SpecialRule,
)

logger = logging.getLogger(__name__)

class RestBackfillService:
    """
    Singleton-style coordinator for inserting 'Rest' day logs to fill large gaps.

    Provides a debounced wrapper around `backfill_rest_days_if_gap` to avoid
    running the fill multiple times in quick succession across requests.
    """

    _instance: Optional["RestBackfillService"] = None
    _instance_lock = Lock()

    def __init__(self, debounce_seconds: int = 300):
        self._debounce = timedelta(seconds=debounce_seconds)
        self._last_run_at: Optional[timezone.datetime] = None
        self._run_lock = Lock()

    @classmethod
    def instance(cls) -> "RestBackfillService":
        if cls._instance is None:
            with cls._instance_lock:
                if cls._instance is None:
                    cls._instance = RestBackfillService()
        return cls._instance

    def ensure_backfilled(self, now=None, force: bool = False) -> list:
        """
        Debounced call to backfill rest days. Returns list of created logs.
        """
        now = now or timezone.now()
        if not force and self._last_run_at is not None and (now - self._last_run_at) < self._debounce:
            return []
        with self._run_lock:
            # Recheck inside the lock in case another thread just ran it
            if not force and self._last_run_at is not None and (now - self._last_run_at) < self._debounce:
                return []
            created = backfill_rest_days_if_gap(now=now)
            self._last_run_at = now
            return created


def _find_closest_subsequence(text: List[int], pattern: List[int]) -> Tuple[Optional[int], int]:
    """Return the position of the closest match of ``pattern`` within ``text``.

    The function searches ``text`` from the end and returns a tuple of
    ``(start_index, match_length)`` where ``match_length`` is the length of the
    longest prefix of ``pattern`` that matches ``text`` starting at
    ``start_index``. If ``match_length`` equals ``len(pattern)``, a full match is
    found. When no elements match, ``(None, 0)`` is returned.

    This avoids the complexity of the previous KMP-based search while allowing
    callers to handle cases where the log pattern only partially aligns with the
    cardio plan.
    """
    if not pattern or not text:
        return (None, 0)

    best_start: Optional[int] = None
    best_len = 0
    pat_len = len(pattern)

    for start in range(len(text) - 1, -1, -1):
        match_len = 0
        while (
            start + match_len < len(text)
            and match_len < pat_len
            and text[start + match_len] == pattern[match_len]
        ):
            match_len += 1

        if match_len > best_len:
            best_len = match_len
            best_start = start

        if best_len == pat_len:
            break

    return best_start, best_len

def predict_next_cardio_routine(now=None) -> Optional[CardioRoutine]:
    """
    Predict the next ``CardioRoutine`` based on the selected cardio program's
    ``CardioPlan`` using a simple search over the routine sequence. The plan
    order is treated as a repeating sequence; the last N ``CardioDailyLog``
    entries—where N is the number of routines in the plan—are matched against
    this sequence and the routine following the closest (possibly partial)
    match is returned.

    Returns:
        ``CardioRoutine`` instance, or ``None`` if no plan can be determined.
    """
    now = now or timezone.now()

    # 1) Get the selected cardio Program and its ordered CardioPlan
    try:
        program = Program.objects.get(selected_cardio=True)
    except Program.DoesNotExist:
        return None

    plan_qs: QuerySet[CardioPlan] = (
        CardioPlan.objects.select_related("routine")
        .filter(program=program)
        .order_by("routine_order")
    )
    plan = list(plan_qs)
    if not plan:
        return None

    plan_ids: List[int] = [cp.routine_id for cp in plan]
    routine_map: Dict[int, CardioRoutine] = {cp.routine_id: cp.routine for cp in plan}

    rules = SpecialRule.get_solo()
    skip_marathon_weekdays = (
        bool(getattr(rules, "skip_marathon_prep_weekdays", False)) and now.weekday() < 5
    )

    def is_allowed(routine_id: int) -> bool:
        if skip_marathon_weekdays:
            routine = routine_map.get(routine_id)
            name = getattr(routine, "name", "") if routine else ""
            if "marathon" in name.lower():
                return False
        return True

    def choose_allowed_from(start_index: int) -> int:
        """Return the first allowed routine id scanning forward one plan cycle."""
        n = len(plan_ids)
        base = start_index % n
        for offset in range(n):
            candidate_id = plan_ids[(base + offset) % n]
            if is_allowed(candidate_id):
                return candidate_id
        return plan_ids[base]

    def resolve_routine(routine_id: int) -> CardioRoutine:
        routine = routine_map.get(routine_id)
        if routine:
            return routine
        return CardioRoutine.objects.get(pk=routine_id)

    # 2) Gather the last N CardioDailyLog entries (where N = plan length)
    recent_logs_qs = (
        CardioDailyLog.objects
        .order_by("-datetime_started")
        .values_list("workout__routine_id", flat=True)[: len(plan)]
    )
    recent_logs: List[int] = list(reversed(recent_logs_qs))
    # If no recent logs, default to the first routine in the plan
    if not recent_logs:
        next_id = choose_allowed_from(0)
        return resolve_routine(next_id)

    # Keep only routines that are in the plan (defensive)
    recent_pattern: List[int] = [rid for rid in recent_logs if rid in set(plan_ids)]
    if not recent_pattern:
        next_id = choose_allowed_from(0)
        return resolve_routine(next_id)

    last_routine_id = recent_pattern[-1]
    valid_next_ids = [
        plan_ids[(i + 1) % len(plan_ids)]
        for i, rid in enumerate(plan_ids)
        if rid == last_routine_id
    ]
    allowed_valid_next_ids = [rid for rid in valid_next_ids if is_allowed(rid)]

    # 3) Make a repeated plan "text" long enough to contain the pattern even if it wraps
    #    Repeat enough times to exceed pattern length by at least one full cycle.
    repeats = max(2, len(recent_pattern) // len(plan_ids) + 2)
    repeated_plan: List[int] = plan_ids * repeats

    # 4) Find the closest occurrence of the recent pattern inside the repeated
    # plan. Drop the final element from the search space so that we don't match
    # a window that ends at the very end of the repeated plan (where there would
    # be no "next" element to return).
    search_space = repeated_plan[:-1]
    start_idx, match_len = _find_closest_subsequence(search_space, recent_pattern)

    if start_idx is None or match_len == 0:
        # Fallback: use the routine that follows the last seen routine ID
        try:
            last_pos = max(idx for idx, v in enumerate(repeated_plan) if v == last_routine_id)
        except ValueError:
            next_id = choose_allowed_from(0)
            return resolve_routine(next_id)

        next_pos = last_pos + 1
        next_id = (
            repeated_plan[next_pos]
            if next_pos < len(repeated_plan)
            else plan_ids[0]
        )
        start_index = next_pos % len(plan_ids)
        if not is_allowed(next_id):
            if allowed_valid_next_ids:
                next_id = allowed_valid_next_ids[0]
            else:
                next_id = choose_allowed_from(start_index)
        elif valid_next_ids and next_id not in valid_next_ids:
            if allowed_valid_next_ids:
                next_id = allowed_valid_next_ids[0]
        return resolve_routine(next_id)


    # 5) Predict the next routine: the element immediately after the matched window
    next_pos = start_idx + match_len
    if next_pos >= len(repeated_plan):
        # Shouldn't happen due to repeats, but be safe
        next_pos = next_pos % len(plan_ids)
    next_routine_id = repeated_plan[next_pos]
    start_index = next_pos % len(plan_ids)

    if not is_allowed(next_routine_id):
        if allowed_valid_next_ids:
            next_routine_id = allowed_valid_next_ids[0]
        else:
            next_routine_id = choose_allowed_from(start_index)
    elif valid_next_ids and next_routine_id not in valid_next_ids:
        if allowed_valid_next_ids:
            next_routine_id = allowed_valid_next_ids[0]

    return resolve_routine(next_routine_id)

def predict_next_cardio_workout(routine_id: int, now=None) -> Optional[CardioWorkout]:
    """
    Predict the next ``CardioWorkout`` within a routine by matching the last N
    ``CardioDailyLog`` entries—where N is the routine's highest
    ``priority_order``—against that routine's workouts ordered by
    ``priority_order`` (and ``name`` as a tiebreaker). If exactly one workout in
    the plan hasn't been completed within those recent logs, that workout is
    returned immediately. Otherwise, a simple search is used to locate the most
    recent sequence of workouts, falling back to the closest partial match when
    an exact sequence isn't found.

    Returns:
        ``CardioWorkout`` instance, or ``None`` if the routine has no workouts.
    """
    now = now or timezone.now()

    # 1) Build the routine's ordered "plan" of workouts (skip flagged ones)
    plan_qs: QuerySet[CardioWorkout] = (
        CardioWorkout.objects
        .filter(routine_id=routine_id, skip=False)
        .order_by("priority_order", "name")
    )
    plan: List[CardioWorkout] = list(plan_qs)
    if not plan:
        return None

    plan_ids: List[int] = [w.id for w in plan]
    plan_id_set = set(plan_ids)

    # 2) Recent history: take the last M logs for this routine, where M is the
    #    maximum priority_order
    max_priority = plan_qs.aggregate(Max("priority_order"))["priority_order__max"] or 0
    recent_logs_qs = (
        CardioDailyLog.objects
        .filter(workout__routine_id=routine_id)
        .order_by("-datetime_started")
        .values_list("workout_id", flat=True)[: max_priority]
    )
    recent_logs: List[int] = list(reversed(recent_logs_qs))
    # If no recent logs, default to the first workout in the plan
    if not recent_logs:
        return plan[0]

    # Keep only workouts that belong to the plan (defensive)
    recent_pattern: List[int] = [wid for wid in recent_logs if wid in plan_id_set]
    if not recent_pattern:
        return plan[0]

    # Prefer any workout in the plan that hasn't been completed recently
    missing_ids: List[int] = [wid for wid in plan_ids if wid not in recent_pattern]
    if len(missing_ids) == 1:
        missing_id = missing_ids[0]
        missing_idx = plan_ids.index(missing_id)
        return plan[missing_idx]

    # 3) Repeat plan enough times to cover any wrap-around
    repeats = max(2, len(recent_pattern) // len(plan_ids) + 2)
    repeated_plan: List[int] = plan_ids * repeats

    # 4) Find the closest occurrence of the recent pattern
    search_space = repeated_plan[:-1]
    start_idx, match_len = _find_closest_subsequence(search_space, recent_pattern)

    if start_idx is None or match_len == 0:
        # Fallback: take the workout right after the last seen workout
        last_workout_id = recent_pattern[-1]
        try:
            last_pos = max(idx for idx, v in enumerate(repeated_plan) if v == last_workout_id)
        except ValueError:
            return plan[0]
        next_id = (
            repeated_plan[last_pos + 1]
            if last_pos + 1 < len(repeated_plan)
            else plan_ids[0]
        )
        valid_next_ids = [
            plan_ids[(i + 1) % len(plan_ids)]
            for i, wid in enumerate(plan_ids)
            if wid == last_workout_id
        ]
        if next_id not in valid_next_ids and valid_next_ids:
            next_id = valid_next_ids[0]
        return CardioWorkout.objects.get(pk=next_id)

    # 5) Return the workout immediately after the matched window
    next_pos = start_idx + match_len
    if next_pos >= len(repeated_plan):
        next_pos = next_pos % len(plan_ids)
    next_workout_id = repeated_plan[next_pos]

    last_workout_id = recent_pattern[-1]
    valid_next_ids = [
        plan_ids[(i + 1) % len(plan_ids)]
        for i, wid in enumerate(plan_ids)
        if wid == last_workout_id
    ]
    if next_workout_id not in valid_next_ids and valid_next_ids:
        next_workout_id = valid_next_ids[0]
    return CardioWorkout.objects.get(pk=next_workout_id)

def get_routines_ordered_by_last_completed(
    program: Optional[Program] = None,
) -> List[CardioRoutine]:
    """
    Return distinct CardioRoutines ordered by their most recent completion time
    (newest first; routines with no logs come last).

    If a Program is provided (or a selected cardio program is found), routines are limited
    to that program’s CardioPlan and ties are broken by the plan's routine_order. Otherwise,
    ties break by `name`.
    """
    # If no program given, try the currently selected cardio program
    if program is None:
        program = Program.objects.filter(selected_cardio=True).first()

    # Base routines: respect the plan if we have a program
    if program:
        base_qs: QuerySet[CardioRoutine] = (
            CardioRoutine.objects.filter(plans__program=program)
            .annotate(plan_order=Min("plans__routine_order"))
            .distinct()
        )
        tiebreak_fields = ["plan_order", "name"]
    else:
        base_qs = CardioRoutine.objects.all()
        tiebreak_fields = ["name"]

    # Subquery: last datetime_started for any log with a workout in this routine
    last_dt_subq = Subquery(
        CardioDailyLog.objects
        .filter(workout__routine=OuterRef("pk"))
        .order_by("-datetime_started")
        .values("datetime_started")[:1],
        output_field=DateTimeField(),
    )

    qs = (
        base_qs
        .annotate(last_completed=last_dt_subq)
        .order_by(F("last_completed").desc(nulls_last=True), *tiebreak_fields)
    )
    return list(qs)

def get_workouts_for_routine_ordered_by_last_completed(
    routine_id: int,
    include_skipped: bool = False,
) -> List[CardioWorkout]:
    """
    Given a CardioRoutine, return its CardioWorkouts ordered by last completed
    (newest first; workouts with no logs come last).
    - By default ignores workouts with skip=True; set include_skipped=True to include them.
    - Ties fall back to (priority_order, name).
    """
    filters = {"routine_id": routine_id}
    if not include_skipped:
        filters["skip"] = False

    base_qs: QuerySet[CardioWorkout] = (
        CardioWorkout.objects.filter(**filters).order_by("priority_order", "name")
    )

    last_dt_subq = Subquery(
        CardioDailyLog.objects
        .filter(workout=OuterRef("pk"))
        .order_by("-datetime_started")
        .values("datetime_started")[:1],
        output_field=DateTimeField(),
    )

    qs = (
        base_qs
        .annotate(last_completed=last_dt_subq)
        .order_by(F("last_completed").desc(nulls_last=True), "priority_order", "name")
    )
    return list(qs)

EPS = 1e-18  # float equality tolerance

def _float_eq(a: float, b: float, eps: float = EPS) -> bool:
    return abs(float(a) - float(b)) <= eps

def _nearest_progression_value(value: float, candidates: List[float]) -> float:
    """
    Return the candidate progression value that's nearest to `value`.
    Ties go to the lower candidate (stable for sorted ascending lists).
    """
    best_val = candidates[0]
    best_diff = abs(float(candidates[0]) - float(value))
    for c in candidates[1:]:
        d = abs(float(c) - float(value))
        if d < best_diff or (d == best_diff and c < best_val):
            best_diff = d
            best_val = c
    return best_val

def _restrict_to_recent_or_last(
    qs: QuerySet,
    cutoff: _dt,
    date_field: str,
) -> Optional[QuerySet]:
    """Limit qs to rows on/after cutoff, or the most recent row if none exist."""
    recent_qs = qs.filter(**{f"{date_field}__gte": cutoff})
    if recent_qs.exists():
        return recent_qs
    last_entry = qs.order_by(f"-{date_field}").first()
    if not last_entry:
        return None
    return qs.filter(pk=last_entry.pk)


def get_closest_progression_value(workout_id: int, target: float) -> float:
    """
    Given a cardio `workout_id` and a numeric `target`, return the progression
    value (float) from `app_workout_cardioprogression` that is numerically
    closest to `target`.

    - On ties, prefers the lower progression value.
    - If the workout has no progressions, returns `target` unchanged.
    """
    values_qs = (
        CardioProgression.objects
        .filter(workout_id=workout_id)
        .order_by("progression_order")
        .values_list("progression", flat=True)
    )
    candidates: List[float] = [float(v) for v in values_qs]
    if not candidates:
        return float(target)
    return float(_nearest_progression_value(float(target), candidates))

def _count_consecutive_snapped_to_progression(
    workout_id: int,
    target_val: float,
    candidates: List[float],
    cutoff: Optional[_dt] = None,
) -> int:
    """
    Count how many most-recent logs for this workout snap to target_val,
    stopping at the first log that snaps to a different progression value.
    Only considers logs that met or beat the goal, and optionally only within
    the provided cutoff.
    """
    count = 0
    qs = (
        CardioDailyLog.objects
        .filter(workout_id=workout_id)
        .exclude(goal__isnull=True)
        .filter(ignore=False)
        .filter(total_completed__gte=F("goal"))
    )
    if cutoff is not None:
        qs = qs.filter(datetime_started__gte=cutoff)
    qs = qs.order_by("-datetime_started").values_list("goal", flat=True)
    for g in qs:
        snap = _nearest_progression_value(float(g), candidates)
        if not _float_eq(float(snap), float(target_val)):
            break
        count += 1
    return count

#TODO 

def get_next_progression_for_workout(
    workout_id: int,
    print_steps: bool = False,
    return_debug: bool = False,
) -> Optional[CardioProgression] | tuple[Optional[CardioProgression], dict]:
    """
    Float-safe progression picker with duplicate-aware advancement and end-of-plan fallback.

    Changes: when deciding how many duplicates you've done "in a row" at the end-of-plan,
    each logged goal is first snapped to the nearest progression value.

    End-of-plan rule: instead of choosing the 3rd highest unique value,
    we now pick the value that appears at the 3rd-to-last index in the progression list.
    """
    steps: list[str] = []

    def _log(message: str) -> None:
        if print_steps:
            print(message)
        if return_debug:
            steps.append(message)

    progressions: List[CardioProgression] = list(
        CardioProgression.objects.filter(workout_id=workout_id).order_by("progression_order")
    )
    if not progressions:
        _log("No progressions found for this workout.")
        if return_debug:
            return None, {
                "steps": steps,
                "reason": "no_progressions",
                "progressions": [],
            }
        return None

    # Limit history to roughly the last six months of successful completions.
    cutoff = timezone.now() - timedelta(weeks=26)
    eligible_logs = (
        CardioDailyLog.objects
        .filter(workout_id=workout_id, datetime_started__gte=cutoff)
        .exclude(goal__isnull=True)
        .filter(ignore=False)
        .filter(total_completed__gte=F("goal"))
    )

    last_completed = (
        eligible_logs
        .order_by("-datetime_started")
        .values_list("total_completed", flat=True)
        .first()
    )

    if last_completed is None:
        _log("No eligible history in the last 6 months. Starting at the first progression.")
        selected = progressions[0]
        meta = {
            "steps": steps,
            "reason": "no_recent_history",
            "progressions": [float(p.progression) for p in progressions],
            "selected_progression": float(selected.progression),
            "selected_index": 0,
            "last_completed": None,
            "snapped_last_completed": None,
            "duplicate_count": None,
            "consecutive_same": None,
            "used_end_of_plan": False,
        }
        if return_debug:
            return selected, meta
        return selected

    lc = float(last_completed)
    _log(f"Last logged completed: {lc}")

    # --- Snap last completed to the closest progression value using helper ---
    snapped_val = get_closest_progression_value(workout_id, lc)
    _log(f"Snapped value via helper: {snapped_val}")

    # Locate the LAST index within this snapped value's duplicate band
    matching_indices = [
        i for i, p in enumerate(progressions)
        if _float_eq(float(p.progression), float(snapped_val))
    ]
    if matching_indices:
        best_idx = matching_indices[-1]
    else:
        # Fallback: in case of unexpected float mismatches, find nearest by diff
        best_idx = min(
            range(len(progressions)),
            key=lambda i: abs(float(progressions[i].progression) - float(snapped_val))
        )
        # And still try to move to the last duplicate within that band
        base_val = float(progressions[best_idx].progression)
        while (
            best_idx + 1 < len(progressions)
            and _float_eq(float(progressions[best_idx + 1].progression), base_val)
        ):
            best_idx += 1
    _log(f"Snapped to last duplicate in band at index {best_idx}")

    # Duplicate-aware advancement within the snapped value's band
    # Build unique mapping and determine consecutive snaps for this value
    unique_vals: List[float] = []
    val_to_indices: Dict[float, List[int]] = {}
    for idx, p in enumerate(progressions):
        v = float(p.progression)
        if not unique_vals or not _float_eq(v, unique_vals[-1]):
            unique_vals.append(v)
            val_to_indices[v] = [idx]
        else:
            val_to_indices[v].append(idx)

    band_indices = val_to_indices[float(snapped_val)] if float(snapped_val) in val_to_indices else matching_indices
    dup_count = len(band_indices)
    consec = _count_consecutive_snapped_to_progression(
        workout_id,
        float(snapped_val),
        unique_vals,
        cutoff=cutoff,
    )
    _log(f"Consecutive snaps to {snapped_val}: {consec} (duplicates available: {dup_count})")

    selected_idx = None
    reason = ""
    used_end_of_plan = False

    if consec < dup_count:
        selected_idx = band_indices[consec]
        reason = "duplicate_band"
        _log(f"Selecting duplicate within band at index {selected_idx}")

    # Completed all duplicates; advance to next distinct if available
    if selected_idx is None and best_idx < len(progressions) - 1:
        selected_idx = best_idx + 1
        reason = "advance_next_distinct"
        _log(f"Completed duplicates; advancing to next distinct at index {selected_idx}")

    # --- At the VERY END: choose target progression based on 3rd-from-last in list ---
    target_val = None
    if selected_idx is None:
        used_end_of_plan = True
        _log("At the end of the progression list. Applying end-of-plan logic.")

        if len(progressions) >= 3:
            target_val = float(progressions[-3].progression)
            _log(f"Choosing 3rd-from-last progression in list: {target_val}")
        else:
            target_val = float(progressions[0].progression)
            _log(f"Only {len(progressions)} progressions, choosing first: {target_val}")

        # Build unique mapping to find duplicate band
        unique_vals = []
        val_to_indices = {}
        for idx, p in enumerate(progressions):
            v = float(p.progression)
            if not unique_vals or not _float_eq(v, unique_vals[-1]):
                unique_vals.append(v)
                val_to_indices[v] = [idx]
            else:
                val_to_indices[v].append(idx)

        band_indices = val_to_indices[target_val]
        dup_count = len(band_indices)

        consec = _count_consecutive_snapped_to_progression(
            workout_id,
            target_val,
            unique_vals,
            cutoff=cutoff,
        )
        _log(f"Consecutive snaps to {target_val}: {consec} (duplicates available: {dup_count})")

        copy_offset = consec if consec < dup_count else (dup_count - 1)
        selected_idx = band_indices[copy_offset]
        reason = "end_of_plan"
        _log(f"Selected progression[{selected_idx}] = {progressions[selected_idx].progression}")

    if selected_idx is None:
        selected_idx = 0
        reason = reason or "fallback_first"
        _log("No selection computed; defaulting to the first progression.")

    selected_prog = progressions[selected_idx]
    meta = {
        "steps": steps,
        "reason": reason,
        "progressions": [float(p.progression) for p in progressions],
        "selected_progression": float(selected_prog.progression),
        "selected_index": selected_idx,
        "last_completed": lc,
        "snapped_last_completed": snapped_val,
        "duplicate_count": dup_count,
        "consecutive_same": consec,
        "used_end_of_plan": used_end_of_plan,
        "target_val": target_val,
    }
    if return_debug:
        return selected_prog, meta
    return selected_prog

def _calendar_tz() -> ZoneInfo:
    """Return the timezone used to determine calendar-day gaps.

    Priority:
    - settings.CALENDAR_TIME_ZONE if defined
    - env APP_CALENDAR_TZ if defined
    - settings.TIME_ZONE as a fallback
    """
    tz_name = getattr(settings, "CALENDAR_TIME_ZONE", None) or os.environ.get("APP_CALENDAR_TZ") or settings.TIME_ZONE
    try:
        return ZoneInfo(tz_name)
    except Exception:
        # Fallback to Django default timezone object
        return timezone.get_default_timezone()


def backfill_rest_days_if_gap(now=None) -> list:
    """
    Insert daily 'Rest' logs for each missing calendar day after the most
    recent CardioDailyLog up to yesterday (never create one for today).

    Returns:
        A list of the CardioDailyLog objects that were created (may be empty).
    """
    now = now or timezone.now()
    tz = _calendar_tz()

    # Find the latest cardio log (if none, do nothing)
    last_log = (
        CardioDailyLog.objects
        .order_by("-datetime_started")
        .first()
    )
    if not last_log:
        return []

    # If gap ≤ 32 hours, nothing to do
    thirty_two_hours = timedelta(hours=32)
    if now - last_log.datetime_started <= thirty_two_hours:
        return []

    rest_workout = _resolve_rest_workout()
    if not rest_workout:
        return []

    # Fill missing days up to yesterday, skipping any day that already has cardio activity
    # Build existing activity days in the calendar timezone to match gap computations
    existing_days = set(
        timezone.localtime(dt, tz).date()
        for dt in CardioDailyLog.objects.values_list("datetime_started", flat=True)
    )
    with transaction.atomic():
        return _create_daily_rest_gaps(
            prev_dt=last_log.datetime_started,
            exclusive_end_date=timezone.localdate(now, tz),  # exclude today in calendar TZ
            rest_workout=rest_workout,
            existing_activity_days=existing_days,
            skip_if_activity=True,
            tz=tz,
        )


def _resolve_rest_workout():
    return (
        CardioWorkout.objects.filter(name__iexact="Rest").first()
        or CardioWorkout.objects.filter(routine__name__iexact="Rest").order_by("priority_order", "name").first()
    )


def _create_daily_rest_gaps(*, prev_dt, exclusive_end_date, rest_workout, time_strategy: str = "prev", next_dt_for_midpoint=None, existing_activity_days=None, skip_if_activity: bool = False, tz: ZoneInfo | None = None) -> list:
    """
    Create one Rest log per missing calendar day strictly before `exclusive_end_date`.

    Args:
        prev_dt: datetime of the previous real/logged day.
        exclusive_end_date: date (local) not to reach or exceed (e.g., today or next real log date).
        rest_workout: resolved Rest workout.

    Returns: list of created CardioDailyLog objects.
    """
    created = []
    # Determine the time-of-day to use for created Rest logs
    if time_strategy == "midpoint" and next_dt_for_midpoint is not None:
        midpoint = prev_dt + (next_dt_for_midpoint - prev_dt) / 2
        base_time = timezone.localtime(midpoint, tz).timetz() if tz else timezone.localtime(midpoint).timetz()
    else:
        base_time = timezone.localtime(prev_dt, tz).timetz() if tz else timezone.localtime(prev_dt).timetz()

    prev_local_date = timezone.localtime(prev_dt, tz).date() if tz else timezone.localtime(prev_dt).date()
    cursor_date = prev_local_date
    while (cursor_date + timedelta(days=1)) < exclusive_end_date:
        cursor_date = cursor_date + timedelta(days=1)
        if skip_if_activity and existing_activity_days is not None:
            if cursor_date in existing_activity_days:
                continue
        composed = _dt.combine(cursor_date, base_time)
        # If tzinfo not present, make it aware in current timezone
        if composed.tzinfo is None:
            composed = timezone.make_aware(composed, timezone=tz) if tz else timezone.make_aware(composed)
        created.append(
            CardioDailyLog.objects.create(
                workout=rest_workout,
                datetime_started=composed,
            )
        )
        if existing_activity_days is not None:
            existing_activity_days.add(cursor_date)
    return created


def backfill_all_rest_day_gaps(now=None) -> list:
    """
    Scan cardio logs and insert one 'Rest' log for each missing calendar day
    between consecutive logs, and then from the last log up to yesterday.

    Applies the 32-hour guard only for the trailing segment (last log → now),
    mirroring backfill_rest_days_if_gap behavior.

    Returns: list of created CardioDailyLog objects.
    """
    now = now or timezone.now()
    tz = _calendar_tz()

    rest_workout = _resolve_rest_workout()
    if not rest_workout:
        return []

    logs = list(
        CardioDailyLog.objects.order_by("datetime_started").only("id", "datetime_started")
    )
    if not logs:
        return []

    # Build a set of local dates that already have cardio activity (do NOT consider strength)
    existing_days = set(
        timezone.localtime(dt, tz).date()
        for dt in CardioDailyLog.objects.values_list("datetime_started", flat=True)
    )

    created: List[CardioDailyLog] = []

    with transaction.atomic():
        # Fill between historical adjacent logs (exclusive of the next log's date)
        prev_dt = logs[0].datetime_started
        for i in range(1, len(logs)):
            curr_dt = logs[i].datetime_started
            created.extend(
                _create_daily_rest_gaps(
                    prev_dt=prev_dt,
                    exclusive_end_date=timezone.localtime(curr_dt, tz).date(),
                    rest_workout=rest_workout,
                    time_strategy="midpoint",
                    next_dt_for_midpoint=curr_dt,
                    existing_activity_days=existing_days,
                    skip_if_activity=True,
                    tz=tz,
                )
            )
            prev_dt = curr_dt

        # Fill from last historical log up to yesterday, only if gap > 32 hours
        if (now - prev_dt) > timedelta(hours=32):
            created.extend(
                _create_daily_rest_gaps(
                    prev_dt=prev_dt,
                    exclusive_end_date=timezone.localdate(now, tz),
                    rest_workout=rest_workout,
                    time_strategy="midpoint",
                    next_dt_for_midpoint=now,
                    existing_activity_days=existing_days,
                    skip_if_activity=True,
                    tz=tz,
                )
            )

    return created


def delete_rest_on_days_with_activity(now=None) -> list[dict]:
    """
    Delete 'Rest' cardio logs that occur on a calendar day that also has at
    least one non-Rest cardio log. Returns a list of deleted logs with minimal
    details: {id, datetime_started}.
    """
    tz = _calendar_tz()
    # Preload minimal fields to compute day grouping and rest predicate
    qs = (
        CardioDailyLog.objects
        .select_related("workout", "workout__routine")
        .only("id", "datetime_started", "workout__name", "workout__routine__name")
        .order_by("datetime_started")
    )

    activity_days = set()
    rest_by_day: Dict[_dt.date, list[Tuple[int, timezone.datetime]]] = {}

    for log in qs:
        day = timezone.localtime(log.datetime_started, tz).date()
        wname = getattr(getattr(log, "workout", None), "name", "").lower()
        rname = getattr(getattr(getattr(log, "workout", None), "routine", None), "name", "").lower()
        is_rest = (wname == "rest") or (rname == "rest")
        if is_rest:
            rest_by_day.setdefault(day, []).append((log.id, log.datetime_started))
        else:
            activity_days.add(day)

    to_delete: list[Tuple[int, timezone.datetime]] = []
    for day, items in rest_by_day.items():
        if day in activity_days:
            to_delete.extend(items)

    if not to_delete:
        return []

    ids = [i for (i, _dtm) in to_delete]
    # Collect metadata for response then delete
    deleted = [{"id": i, "datetime_started": dtm} for (i, dtm) in to_delete]
    CardioDailyLog.objects.filter(pk__in=ids).delete()
    return deleted

def get_next_cardio_workout(
    include_skipped: bool = False,
    now=None,
) -> tuple[Optional[CardioWorkout], Optional[CardioProgression], List[CardioWorkout]]:
    """
    Returns:
        (next_workout, next_progression, workout_list)

    - next_workout: predicted next CardioWorkout (or None)
    - next_progression: predicted next CardioProgression for that workout (or None)
    - workout_list: flattened list of workouts where `next_workout` is the last element
    """

    # 1) Predict next routine and next workout
    next_routine = predict_next_cardio_routine(now=now)
    if not next_routine:
        return None, None, []

    next_workout = predict_next_cardio_workout(routine_id=next_routine.id, now=now)

    # 2) Get routines ordered by last completed and move predicted routine to the end
    routine_list = get_routines_ordered_by_last_completed()
    try:
        idx = routine_list.index(next_routine)
        routine_list = routine_list[:idx] + routine_list[idx+1:] + [next_routine]
    except ValueError:
        pass

    # 3) Build workout_list; move predicted workout to end of its routine block
    workout_list: List[CardioWorkout] = []
    for routine in routine_list:
        sub_workouts = get_workouts_for_routine_ordered_by_last_completed(
            routine_id=routine.id,
            include_skipped=include_skipped,
        )
        if next_workout and routine.id == next_routine.id:
            try:
                widx = sub_workouts.index(next_workout)
                sub_workouts = sub_workouts[:widx] + sub_workouts[widx+1:] + [next_workout]
            except ValueError:
                # predicted workout not in list (e.g., filtered), ignore
                pass
        workout_list.extend(sub_workouts)

    # 4) Compute next progression for the predicted workout
    next_progression: Optional[CardioProgression] = None
    if next_workout:
        next_progression = get_next_progression_for_workout(next_workout.id)

    return next_workout, next_progression, workout_list


def _get_recent_max_reps_log(routine_id: int, months: int = 6) -> Optional[StrengthDailyLog]:
    """Return the most recent log with the highest max_reps within the lookback window."""
    lookback_days = int(round(months * 30.4375)) if months else None
    filters = (
        StrengthDailyLog.objects
        .filter(routine_id=routine_id, ignore=False)
        .exclude(max_reps__isnull=True)
    )
    if lookback_days:
        window_start = timezone.now() - timedelta(days=lookback_days)
        filters = filters.filter(datetime_started__gte=window_start)
    return filters.order_by("-max_reps", "-datetime_started").first()


def _closest_progression_index(
    progressions: List[VwStrengthProgression],
    target_value: float,
    attr_name: str = "current_max",
) -> Optional[int]:
    """Find the index of the progression whose attr is closest to target_value."""
    best_idx: Optional[int] = None
    best_distance = inf
    for idx, prog in enumerate(progressions):
        value = getattr(prog, attr_name, None)
        try:
            numeric_value = float(value)
        except (TypeError, ValueError):
            continue
        if not isfinite(numeric_value):
            continue
        distance = abs(numeric_value - target_value)
        if best_idx is None or distance < best_distance or (
            abs(distance - best_distance) <= 1e-9 and (best_idx is None or idx < best_idx)
        ):
            best_idx = idx
            best_distance = distance
    return best_idx


def get_next_strength_goal(routine_id: int, print_debug: bool = True) -> Optional[VwStrengthProgression]:
    """Return the next Strength goal for a routine using recent volume trends."""
    def _debug(message: str, *args) -> None:
        if print_debug:
            logger.info(message, *args)

    _debug("Starting get_next_strength_goal for routine_id=%s", routine_id)
    try:
        routine = StrengthRoutine.objects.get(pk=routine_id)
    except StrengthRoutine.DoesNotExist:
        _debug("Routine id=%s does not exist; returning None", routine_id)
        return None

    progressions: List[VwStrengthProgression] = list(
        VwStrengthProgression.objects.filter(routine_name=routine.name).order_by("progression_order")
    )
    if not progressions:
        _debug("No progressions found for routine '%s'; returning None", routine.name)
        return None

    _debug("Loaded %s progressions for routine '%s'", len(progressions), routine.name)

    max_log = _get_recent_max_reps_log(routine_id)
    if max_log is None:
        _debug(
            "No max_reps logs found within the last 6 months for routine '%s'; returning first progression",
            routine.name,
        )
        return progressions[0]

    try:
        recent_max = float(max_log.max_reps)
    except (TypeError, ValueError):
        _debug(
            "Max reps value %s is not numeric; returning first progression for routine '%s'",
            max_log.max_reps,
            routine.name,
        )
        return progressions[0]

    if not isfinite(recent_max) or recent_max <= 0:
        _debug(
            "Max reps value %s is non-positive or non-finite; returning first progression for routine '%s'",
            recent_max,
            routine.name,
        )
        return progressions[0]

    max_log_date = timezone.localtime(max_log.datetime_started).date()
    idx = _closest_progression_index(progressions, recent_max, "current_max")
    if idx is None:
        _debug(
            "Could not match recent max reps %.2f to a progression; returning first progression for routine '%s'",
            recent_max,
            routine.name,
        )
        return progressions[0]

    max_week = progressions[idx]
    max_week_minus_one = progressions[idx - 1] if idx - 1 >= 0 else progressions[0]
    max_week_minus_two = progressions[idx - 2] if idx - 2 >= 0 else progressions[0]

    today = timezone.localdate()
    day_diff = (today - max_log_date).days
    if day_diff <= 0:
        selected = max_week
        pattern_pos = "max_week"
    else:
        week_index = (day_diff - 1) // 7
        cycle = [max_week_minus_two, max_week_minus_one, max_week]
        selected = cycle[week_index % len(cycle)]
        pattern_map = {0: "max_week_minus_two", 1: "max_week_minus_one", 2: "max_week"}
        pattern_pos = pattern_map[week_index % len(cycle)]

    _debug(
        "Recent max reps %.2f on %s; pattern picked %s (order=%s, daily_volume=%s)",
        recent_max,
        max_log_date.isoformat(),
        pattern_pos,
        selected.progression_order,
        selected.daily_volume,
    )
    return selected


def get_strength_routines_ordered_by_last_completed(
    program: Optional[Program] = None,
) -> List[StrengthRoutine]:
    """Return StrengthRoutines ordered by most recent completion time."""
    if program is None:
        program = Program.objects.filter(selected_strength=True).first()

    if program:
        base_qs: QuerySet[StrengthRoutine] = (
            StrengthRoutine.objects.filter(plans__program=program).distinct()
        )
        tiebreak_fields = ["name"]
    else:
        base_qs = StrengthRoutine.objects.all()
        tiebreak_fields = ["name"]

    last_dt_subq = Subquery(
        StrengthDailyLog.objects
        .filter(routine=OuterRef("pk"))
        .exclude(rep_goal__isnull=True)
        .filter(total_reps_completed__gte=F("rep_goal"))
        .order_by("-datetime_started")
        .values("datetime_started")[:1],
        output_field=DateTimeField(),
    )

    qs = (
        base_qs
        .annotate(last_completed=last_dt_subq)
        .order_by(F("last_completed").desc(nulls_last=True), *tiebreak_fields)
    )
    return list(qs)


def predict_next_strength_routine(now=None) -> Optional[StrengthRoutine]:
    """Select the next StrengthRoutine using plan ratios as the primary guide."""
    now = now or timezone.now()
    program = Program.objects.filter(selected_strength=True).first()
    routines = get_strength_routines_ordered_by_last_completed(program=program)
    if not routines:
        return None

    # Track completed ratios per routine across the last seven days.
    since = now - timedelta(days=7)
    weekly_totals: Counter[int] = Counter()
    strength_done = 0.0
    strength_logs_qs = (
        StrengthDailyLog.objects
        .filter(datetime_started__gte=since)
        .exclude(rep_goal__isnull=True)
        .exclude(total_reps_completed__isnull=True)
    )
    for log in strength_logs_qs.only("rep_goal", "total_reps_completed", "routine_id"):
        try:
            goal_val = float(log.rep_goal or 0.0)
            comp_val = float(log.total_reps_completed or 0.0)
        except (TypeError, ValueError):
            goal_val = 0.0
            comp_val = 0.0

        if goal_val > 0 and comp_val > 0:
            ratio = comp_val / goal_val
            strength_done += ratio
            if log.routine_id:
                weekly_totals[int(log.routine_id)] += ratio

    strength_plan = 3  # target strength sessions per week
    pct_strength = (strength_done / strength_plan) if strength_plan > 0 else 1.0

    plan_counts: Counter[int] = Counter()
    if program:
        plan_routine_ids = list(
            StrengthPlan.objects
            .filter(program=program)
            .values_list("routine_id", flat=True)
        )
        if plan_routine_ids:
            plan_counts = Counter(int(rid) for rid in plan_routine_ids)

    if plan_counts:
        total_slots = 3  # target number of strength sessions per week
        total_plan = sum(plan_counts.values())
        expected_counts = {
            rid: (plan_counts[rid] / total_plan) * total_slots
            for rid in plan_counts
        }

        recent_routine_ids = list(
            StrengthDailyLog.objects
            .filter(routine_id__in=plan_counts.keys())
            .order_by("-datetime_started")
            .values_list("routine_id", flat=True)[:total_slots]
        )
        recent_counts = Counter(int(rid) for rid in recent_routine_ids)

        deficits = {
            rid: expected_counts[rid] - recent_counts.get(rid, 0)
            for rid in plan_counts
        }
        max_deficit = max(deficits.values()) if deficits else 0.0
        if max_deficit > 1e-9:
            deficit_ids = {rid for rid, val in deficits.items() if abs(val - max_deficit) <= 1e-9}
            for routine in reversed(routines):  # least recently completed first
                if routine.id in deficit_ids:
                    return routine

    if pct_strength > (2.0 / 3.0):
        least_routine = None
        least_key = None
        for idx, routine in enumerate(routines):
            volume = weekly_totals.get(routine.id, 0.0)
            key = (volume, -idx)
            if least_key is None or key < least_key:
                least_key = key
                least_routine = routine
        if least_routine:
            return least_routine

    return routines[-1]


def get_next_strength_routine(now=None) -> tuple[Optional[StrengthRoutine], Optional[VwStrengthProgression], List[StrengthRoutine]]:
    """Return predicted next StrengthRoutine, its next goal, and ordered routine list."""
    routine_list = get_strength_routines_ordered_by_last_completed()
    next_routine = predict_next_strength_routine(now=now)

    next_goal: Optional[VwStrengthProgression] = None
    if next_routine:
        next_goal = get_next_strength_goal(next_routine.id)
        try:
            idx = routine_list.index(next_routine)
            routine_list = routine_list[:idx] + routine_list[idx + 1:] + [next_routine]
        except ValueError:
            pass
    return next_routine, next_goal, routine_list


# --- Supplemental helpers -------------------------------------------------

def get_supplemental_routines_ordered_by_last_completed(
    program: Optional[Program] = None,
) -> List[SupplementalRoutine]:
    """Return Supplemental routines ordered by most recent completion time."""
    if program is None:
        program = Program.objects.filter(selected_supplemental=True).first()

    if program:
        base_qs: QuerySet[SupplementalRoutine] = (
            SupplementalRoutine.objects.filter(plans__program=program).distinct()
        )
    else:
        base_qs = SupplementalRoutine.objects.all()

    last_dt_subq = Subquery(
        SupplementalDailyLog.objects
        .filter(routine=OuterRef("pk"))
        .order_by("-datetime_started")
        .values("datetime_started")[:1],
        output_field=DateTimeField(),
    )

    qs = (
        base_qs
        .annotate(last_completed=last_dt_subq)
        .order_by(F("last_completed").desc(nulls_last=True), "name")
    )
    return list(qs)


def get_next_supplemental_routine(now=None) -> tuple[Optional[SupplementalRoutine], List[SupplementalRoutine]]:
    """Return the next Supplemental routine (least recently completed)."""
    routine_list = get_supplemental_routines_ordered_by_last_completed()
    next_routine = routine_list[-1] if routine_list else None
    return next_routine, routine_list


def get_next_supplemental_workout(now=None) -> tuple[Optional[SupplementalRoutine], None, list]:
    """
    Return the next Supplemental routine. Workout is fixed to the single 3 Max Sets model.
    """
    next_routine, routine_list = get_next_supplemental_routine(now=now)
    return next_routine, None, []


def _collect_best_supplemental_sets(
    routine_id: int,
    months: int = 6,
    max_sets: int = 3,
) -> tuple[dict[int, Optional[float]], dict[int, Optional[float]]]:
    """Return best unit_count and weight per set index within the last ``months`` months."""
    cutoff = timezone.now() - timedelta(weeks=4 * months)
    details_qs = SupplementalDailyLogDetail.objects.filter(
        log__routine_id=routine_id,
        log__datetime_started__gte=cutoff,
        log__ignore=False,
    ).order_by("log_id", "datetime", "id")

    best_unit: dict[int, Optional[float]] = {i: None for i in range(1, max_sets + 1)}
    best_weight: dict[int, Optional[float]] = {i: None for i in range(1, max_sets + 1)}
    current_log_id: Optional[int] = None
    idx_in_log = 0

    for detail in details_qs:
        if detail.log_id != current_log_id:
            current_log_id = detail.log_id
            idx_in_log = 0
        idx_in_log += 1
        set_number = detail.set_number or idx_in_log
        if set_number not in best_unit:
            continue
        try:
            unit_val = float(detail.unit_count)
        except (TypeError, ValueError):
            unit_val = None
        try:
            weight_val = float(detail.weight) if detail.weight is not None else None
        except (TypeError, ValueError):
            weight_val = None

        if unit_val is not None:
            prior = best_unit.get(set_number)
            best_unit[set_number] = unit_val if prior is None else max(prior, unit_val)
        if weight_val is not None:
            prior_w = best_weight.get(set_number)
            best_weight[set_number] = weight_val if prior_w is None else max(prior_w, weight_val)

    return best_unit, best_weight


def _derive_set_goal(
    best_unit: Optional[float],
    best_weight: Optional[float],
    step_value: Optional[float],
    max_set: Optional[float],
    step_weight: Optional[float],
) -> tuple[Optional[float], Optional[float], bool]:
    """
    Compute the next goal for a set using the routine's progression rules.

    Returns (goal_unit, goal_weight, using_weight).
    """
    try:
        step_val = float(step_value) if step_value is not None else 0.0
    except (TypeError, ValueError):
        step_val = 0.0
    try:
        max_target = float(max_set) if max_set is not None else None
    except (TypeError, ValueError):
        max_target = None
    try:
        step_wt = float(step_weight) if step_weight is not None else 0.0
    except (TypeError, ValueError):
        step_wt = 0.0

    use_weight = bool(
        max_target is not None
        and max_target > 0
        and best_unit is not None
        and float(best_unit) >= max_target
    )

    goal_unit: Optional[float] = None
    goal_weight: Optional[float] = None

    if use_weight:
        goal_unit = max_target if max_target is not None else (best_unit or 0.0)
        weight_base = float(best_weight) if best_weight is not None else 0.0
        goal_weight = weight_base + step_wt
    else:
        base_unit = float(best_unit) if best_unit is not None else 0.0
        goal_unit = base_unit + step_val
        if max_target is not None and max_target > 0:
            goal_unit = min(goal_unit, max_target)

    return goal_unit, goal_weight, use_weight


def get_supplemental_goal_targets(
    routine_id: int,
    months: int = 6,
) -> Dict[str, object]:
    """
    Return per-set bests and next goals for a routine in the last ``months`` months.
    """
    routine = SupplementalRoutine.objects.filter(pk=routine_id).first()
    if not routine:
        return {
            "routine_id": routine_id,
            "sets": [],
            "rest_yellow_start_seconds": None,
            "rest_red_start_seconds": None,
            "step_value": None,
            "max_set": None,
            "step_weight": None,
        }

    best_unit, best_weight = _collect_best_supplemental_sets(
        routine_id=routine_id,
        months=months,
    )

    sets: List[Dict[str, Optional[float]]] = []
    for set_number in (1, 2, 3):
        bu = best_unit.get(set_number)
        bw = best_weight.get(set_number)
        goal_unit, goal_weight, using_weight = _derive_set_goal(
            bu,
            bw,
            routine.step_value,
            routine.max_set,
            routine.step_weight,
        )
        sets.append(
            {
                "set_number": set_number,
                "best_unit": bu,
                "best_weight": bw,
                "goal_unit": goal_unit,
                "goal_weight": goal_weight,
                "using_weight": using_weight,
            }
        )

    return {
        "routine_id": routine_id,
        "sets": sets,
        "rest_yellow_start_seconds": routine.rest_yellow_start_seconds,
        "rest_red_start_seconds": routine.rest_red_start_seconds,
        "step_value": routine.step_value,
        "max_set": routine.max_set,
        "step_weight": routine.step_weight,
    }


def get_supplemental_best_recent(
    routine_id: int,
    months: int = 6,
) -> Optional[float]:
    """Return the best supplemental value (unit_count) in the last ``months`` months for a routine."""
    targets = get_supplemental_goal_targets(
        routine_id,
        months=months,
    )
    best_units = [s.get("best_unit") for s in targets.get("sets", []) if s.get("best_unit") is not None]
    if not best_units:
        return None
    try:
        return float(max(best_units))
    except (TypeError, ValueError):
        return None


def get_supplemental_goal_target(
    routine_id: int,
    months: int = 6,
) -> Dict[str, object]:
    """
    Return per-set targets (best + next goal) for a routine.
    Thin wrapper around ``get_supplemental_goal_targets`` for compatibility.
    """
    return get_supplemental_goal_targets(
        routine_id=routine_id,
        months=months,
    )
# --- Cardio MPH goal computation (runtime SQL equivalent of Vw_MPH_Goal) ---

def get_mph_goal_for_workout(
    workout_id: int,
    total_completed_input: Optional[float] = None,
    return_debug: bool = False,
) -> tuple[float, float] | tuple[float, float, dict]:
    """
    Compute (mph_goal, mph_goal_avg) for a workout using a configurable strategy.

    Strategies choose which log to inspect (progression/routine/workout scope +
    max of avg_mph or max_mph), then return that log's max_mph (goal) and
    avg_mph (goal_avg). Falls back to the latest log if no candidates exist.
    """

    from decimal import Decimal, ROUND_FLOOR
    try:
        w = CardioWorkout.objects.only("difficulty", "mph_goal_strategy", "routine_id").get(pk=workout_id)
    except CardioWorkout.DoesNotExist:
        return (0.0, 0.0, {"reason": "missing_workout"}) if return_debug else (0.0, 0.0)

    strategy = getattr(w, "mph_goal_strategy", "progression_max_avg") or "progression_max_avg"
    target_diff = int(getattr(w, "difficulty", 0) or 0)
    cutoff = timezone.now() - timedelta(weeks=26)  # ~6 months
    criterion = "avg" if strategy.endswith("_max_avg") else "max"
    scope = "workout" if strategy.startswith("workout_") else ("routine" if strategy.startswith("routine_") else "progression")
    candidate_count = 0
    debug: dict[str, object] = {
        "strategy": strategy,
        "scope": scope,
        "criterion": criterion,
        "cutoff": cutoff.isoformat(),
        "workout_id": workout_id,
    } if return_debug else {}

    def finish(mph_goal: float, mph_goal_avg: float, selected_row: Optional[dict] = None, used_fallback: bool = False):
        if return_debug:
            debug.update({
                "mph_goal": mph_goal,
                "mph_goal_avg": mph_goal_avg,
                "candidate_count": candidate_count,
                "selected_log": selected_row,
                "used_fallback": used_fallback,
            })
            return mph_goal, mph_goal_avg, debug
        return mph_goal, mph_goal_avg

    def serialize_row(row: Optional[dict]) -> Optional[dict]:
        if not return_debug or not row:
            return None
        try:
            dt = row.get("datetime_started")
        except Exception:
            dt = None
        try:
            dt_iso = dt.isoformat() if dt else None
        except Exception:
            dt_iso = None
        def _to_float(val):
            try:
                return float(val)
            except Exception:
                return None
        return {
            "id": row.get("id"),
            "datetime_started": dt_iso,
            "max_mph": _to_float(row.get("max_mph")),
            "avg_mph": _to_float(row.get("avg_mph")),
            "total_completed": _to_float(row.get("total_completed")),
        }

    base_logs_qs: QuerySet[CardioDailyLog] = CardioDailyLog.objects.filter(
        workout__difficulty__gte=target_diff,
        ignore=False,
    )
    # Scope filters
    if scope == "workout" or scope == "progression":
        base_logs_qs = base_logs_qs.filter(workout_id=workout_id)
    elif scope == "routine":
        base_logs_qs = base_logs_qs.filter(workout__routine_id=getattr(w, "routine_id", None))

    logs_qs = _restrict_to_recent_or_last(base_logs_qs, cutoff, "datetime_started")
    if not logs_qs:
        return finish(0.0, 0.0, used_fallback=True)

    def round_half_up_1(x: Optional[float], step: float = 0.1) -> float:
        if x is None:
            return 0.0
        try:
            step_dec = Decimal(str(step))
            if step_dec <= 0:
                return float(x)
            val_dec = Decimal(str(x))
        except Exception:
            return 0.0

        quotient = val_dec / step_dec
        base_multiple = quotient.to_integral_value(rounding=ROUND_FLOOR)
        next_multiple = (base_multiple + 1) * step_dec
        return float(next_multiple)

    # Build candidate logs (optionally matching progression)
    progs: list[float] = []
    snapped_input: Optional[float] = None
    if scope == "progression" and total_completed_input is not None:
        progs = [
            float(p) for p in (
                CardioProgression.objects
                .filter(workout_id=workout_id)
                .order_by("progression_order")
                .values_list("progression", flat=True)
            )
        ]
        if progs:
            snapped_input = float(_nearest_progression_value(float(total_completed_input), progs))
    if return_debug:
        debug.update({
            "progression_values": progs,
            "snapped_input": snapped_input,
            "input_value": total_completed_input,
        })

    def iter_candidates():
        values_qs = logs_qs.values("id", "max_mph", "avg_mph", "total_completed", "datetime_started")
        for row in values_qs:
            if scope == "progression" and progs and snapped_input is not None:
                tc = row.get("total_completed")
                try:
                    tc_f = float(tc)
                except Exception:
                    continue
                snapped_tc = float(_nearest_progression_value(tc_f, progs))
                if not _float_eq(snapped_tc, snapped_input):
                    continue
            yield row

    best: Optional[dict] = None
    best_val: Optional[float] = None
    for row in iter_candidates():
        candidate_count += 1
        val_raw = row.get("avg_mph") if criterion == "avg" else row.get("max_mph")
        try:
            val = float(val_raw)
        except Exception:
            continue
        if best is None or val > best_val:
            best = row
            best_val = val

    # Fallback to most recent log in scope if no match
    used_fallback = False
    if best is None:
        best = (
            logs_qs
            .order_by("-datetime_started")
            .values("id", "max_mph", "avg_mph", "total_completed", "datetime_started")
            .first()
        ) or {}
        used_fallback = True

    mph_goal = round_half_up_1(best.get("max_mph"))
    mph_goal_avg = round_half_up_1(best.get("avg_mph"))
    if mph_goal_avg and mph_goal == mph_goal_avg:
        mph_goal = round(mph_goal_avg + 0.1, 1)
    return finish(mph_goal, mph_goal_avg, serialize_row(best), used_fallback=used_fallback)


# --- Strength reps-per-hour goal computation ---

def get_reps_per_hour_goal_for_routine(
    routine_id: int,
    total_volume_input: Optional[float] = None,
    round_step: float = 1.0,
) -> tuple[float, float]:
    """Return (max_rph, avg_rph) targets for a Strength routine.

    The calculation mirrors the cardio MPH helper by:

    - Optionally snapping historical logs to the nearest progression daily volume
      when ``total_volume_input`` is supplied (e.g., the current goal).
    - Falling back to the full history if no logs snap to that progression.
    - Rounding up to the next ``round_step`` (default: 1 rep/hr) to avoid
      underestimating future effort.
    - Considering only the last 8 weeks of logs; when none exist, reusing the
      most recent historical log instead.
    """

    try:
        routine = StrengthRoutine.objects.only("name").get(pk=routine_id)
    except StrengthRoutine.DoesNotExist:
        return (0.0, 0.0)

    cutoff = timezone.now() - timedelta(weeks=8)
    base_logs_qs: QuerySet[StrengthDailyLog] = StrengthDailyLog.objects.filter(routine_id=routine_id, ignore=False)
    logs_qs = _restrict_to_recent_or_last(base_logs_qs, cutoff, "datetime_started")
    if not logs_qs:
        return (0.0, 0.0)

    candidate_progressions: List[float] = []
    snapped_input: Optional[float] = None

    if total_volume_input is not None:
        candidate_progressions = [
            float(v)
            for v in (
                VwStrengthProgression.objects
                .filter(routine_name=routine.name)
                .order_by("progression_order")
                .values_list("daily_volume", flat=True)
            )
        ]
        if candidate_progressions:
            snapped_input = float(
                _nearest_progression_value(float(total_volume_input), candidate_progressions)
            )

    matched_rates: List[float] = []
    all_rates: List[float] = []

    for total, minutes in (
        logs_qs
        .exclude(total_reps_completed__isnull=True)
        .exclude(minutes_elapsed__isnull=True)
        .values_list("total_reps_completed", "minutes_elapsed")
    ):
        try:
            total_f = float(total)
            minutes_f = float(minutes)
        except (TypeError, ValueError):
            continue

        if minutes_f <= 0:
            continue

        hours = minutes_f / 60.0
        if hours <= 0:
            continue

        rate = total_f / hours if hours else 0.0
        if not isfinite(rate) or rate <= 0:
            continue

        all_rates.append(rate)

        if snapped_input is not None and candidate_progressions:
            snapped_total = float(_nearest_progression_value(total_f, candidate_progressions))
            if _float_eq(snapped_total, snapped_input):
                matched_rates.append(rate)

    # Prefer matched progression history when there is meaningful depth; otherwise rely on the recent window.
    rates_to_use = matched_rates if len(matched_rates) >= 2 else all_rates
    if not rates_to_use:
        return (0.0, 0.0)

    def round_up(value: float, step: float) -> float:
        if not isfinite(value) or value <= 0 or step <= 0:
            return 0.0
        return float(ceil(value / step) * step)

    max_rate = round_up(max(rates_to_use), round_step)
    avg_rate = round_up(sum(rates_to_use) / len(rates_to_use), round_step)
    return max_rate, avg_rate

def get_max_reps_goal_for_routine(
    routine_id: int,
    rep_goal_input: Optional[float],
) -> Optional[float]:
    """Return the max reps goal anchored to the next progression current_max."""
    try:
        routine = StrengthRoutine.objects.only("name").get(pk=routine_id)
    except StrengthRoutine.DoesNotExist:
        return None

    def _coerce(value):
        try:
            val = float(value)
        except (TypeError, ValueError):
            return None
        return val if isfinite(val) else None

    try:
        progressions: List[VwStrengthProgression] = list(
            VwStrengthProgression.objects
            .filter(routine_name=routine.name)
            .order_by("progression_order")
        )
    except OperationalError:
        return None

    if not progressions:
        return None

    max_log = _get_recent_max_reps_log(routine_id)
    if max_log:
        recent_max = _coerce(max_log.max_reps)
        if recent_max is not None and recent_max > 0:
            idx = _closest_progression_index(progressions, recent_max, "current_max") or 0
            for candidate_idx in range(idx + 1, len(progressions)):
                candidate_val = _coerce(progressions[candidate_idx].current_max)
                if candidate_val is not None:
                    return candidate_val
            current_val = _coerce(progressions[idx].current_max)
            if current_val is not None:
                return current_val

    target = _coerce(rep_goal_input)
    if target is not None and target > 0:
        idx = _closest_progression_index(progressions, target, "current_max")
        if idx is not None:
            candidate_val = _coerce(progressions[idx].current_max)
            if candidate_val is not None:
                return candidate_val

    for prog in progressions:
        candidate_val = _coerce(prog.current_max)
        if candidate_val is not None and candidate_val > 0:
            return candidate_val
    return None




def get_max_weight_goal_for_routine(
    routine_id: int,
    rep_goal_input: Optional[float],
) -> Optional[float]:
    """Return the target peak weight for a Strength routine.

    Prefers the most recently persisted goal for the routine so goals remain
    consistent across sessions. Falls back to the latest observed max weight
    or the routine's hundred-points weight when no prior goal exists."""
    try:
        routine = StrengthRoutine.objects.only("hundred_points_weight").get(pk=routine_id)
    except StrengthRoutine.DoesNotExist:
        return None

    def _coerce(value):
        try:
            return float(value)
        except (TypeError, ValueError):
            return None

    agg = (
        StrengthDailyLog.objects
        .filter(routine_id=routine_id, ignore=False)
        .aggregate(goal_max=Max("max_weight_goal"), actual_max=Max("max_weight"))
    )
    candidates = []
    if agg:
        candidates.extend([agg.get("goal_max"), agg.get("actual_max")])
    candidates.append(getattr(routine, "hundred_points_weight", None))
    candidates = [c for c in (_coerce(val) for val in candidates) if c is not None and isfinite(c) and c > 0]
    if candidates:
        return max(candidates)

    return None
