# services.py
from __future__ import annotations
from datetime import timedelta
from typing import Optional, List, Dict, Tuple
from math import inf
from django.utils import timezone
from django.db.models import QuerySet, OuterRef, Subquery, DateTimeField, F, Min, Max
from django.db import transaction

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
)


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
    Predict the next ``CardioRoutine`` based on the selected program's
    ``CardioPlan`` using a simple search over the routine sequence. The plan
    order is treated as a repeating sequence; the last N ``CardioDailyLog``
    entries—where N is the number of routines in the plan—are matched against
    this sequence and the routine following the closest (possibly partial)
    match is returned.

    Returns:
        ``CardioRoutine`` instance, or ``None`` if no plan can be determined.
    """
    now = now or timezone.now()

    # 1) Get the selected Program and its ordered CardioPlan
    try:
        program = Program.objects.get(selected=True)
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
    # 2) Gather the last N CardioDailyLog entries (where N = plan length)
    recent_logs_qs = (
        CardioDailyLog.objects
        .order_by("-datetime_started")
        .values_list("workout__routine_id", flat=True)[: len(plan)]
    )
    recent_logs: List[int] = list(reversed(recent_logs_qs))
    # If no recent logs, default to the first routine in the plan
    if not recent_logs:
        return CardioRoutine.objects.get(pk=plan_ids[0])

    # Keep only routines that are in the plan (defensive)
    recent_pattern: List[int] = [rid for rid in recent_logs if rid in set(plan_ids)]
    if not recent_pattern:
        return CardioRoutine.objects.get(pk=plan_ids[0])

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
        last_routine_id = recent_pattern[-1]
        try:
            last_pos = max(idx for idx, v in enumerate(repeated_plan) if v == last_routine_id)
        except ValueError:
            return CardioRoutine.objects.get(pk=plan_ids[0])

        next_id = (
            repeated_plan[last_pos + 1]
            if last_pos + 1 < len(repeated_plan)
            else plan_ids[0]
        )
        # Ensure the chosen next_id is a valid successor to the last routine
        valid_next_ids = [
            plan_ids[(i + 1) % len(plan_ids)]
            for i, rid in enumerate(plan_ids)
            if rid == last_routine_id
        ]
        if next_id not in valid_next_ids and valid_next_ids:
            next_id = valid_next_ids[0]
        return CardioRoutine.objects.get(pk=next_id)


    # 5) Predict the next routine: the element immediately after the matched window
    next_pos = start_idx + match_len
    if next_pos >= len(repeated_plan):
        # Shouldn't happen due to repeats, but be safe
        next_pos = next_pos % len(plan_ids)
    next_routine_id = repeated_plan[next_pos]

    # Only allow routines that directly follow the most recent one in the plan
    last_routine_id = recent_pattern[-1]
    valid_next_ids = [
        plan_ids[(i + 1) % len(plan_ids)]
        for i, rid in enumerate(plan_ids)
        if rid == last_routine_id
    ]
    if next_routine_id not in valid_next_ids and valid_next_ids:
        next_routine_id = valid_next_ids[0]

    return CardioRoutine.objects.get(pk=next_routine_id)

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

    If a Program is provided (or a selected one is found), routines are limited to that
    program’s CardioPlan and ties are broken by the plan's routine_order. Otherwise,
    ties break by `name`.
    """
    # If no program given, try the currently selected one
    if program is None:
        program = Program.objects.filter(selected=True).first()

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

def _count_consecutive_snapped_to_progression(workout_id: int, target_val: float, candidates: List[float]) -> int:
    """
    Count how many most-recent logs for this workout snap to target_val,
    stopping at the first log that snaps to a different progression value.
    """
    count = 0
    qs = (
        CardioDailyLog.objects
        .filter(workout_id=workout_id)
        .exclude(goal__isnull=True)
        .order_by("-datetime_started")
        .values_list("goal", flat=True)
    )
    for g in qs:
        snap = _nearest_progression_value(float(g), candidates)
        if not _float_eq(float(snap), float(target_val)):
            break
        count += 1
    return count

def get_next_progression_for_workout(
    workout_id: int, 
    print_steps: bool = False
) -> Optional[CardioProgression]:
    """
    Float-safe progression picker with duplicate-aware advancement and end-of-plan fallback.

    Changes: when deciding how many duplicates you've done "in a row" at the end-of-plan,
    each logged goal is first snapped to the nearest progression value.

    End-of-plan rule: instead of choosing the 3rd highest unique value,
    we now pick the value that appears at the 3rd-to-last index in the progression list.
    """
    progressions: List[CardioProgression] = list(
        CardioProgression.objects.filter(workout_id=workout_id).order_by("progression_order")
    )
    if not progressions:
        if print_steps: 
            print("No progressions found for this workout.")
        return None

    last_completed = (
        CardioDailyLog.objects
        .filter(workout_id=workout_id)
        .exclude(goal__isnull=True)
        .filter(total_completed__gte=F("goal"))
        .order_by("-datetime_started")
        .values_list("total_completed", flat=True)
        .first()
    )
    if last_completed is None:
        last_completed = (
            CardioDailyLog.objects
            .filter(workout_id=workout_id)
            .exclude(goal__isnull=True)
            .aggregate(Max("total_completed"))["total_completed__max"]
        )

    if last_completed is None:
        if print_steps:
            print("No history found. Starting at the first progression.")
        return progressions[0]

    lc = float(last_completed)
    if print_steps:
        print(f"Last logged completed: {lc}")

    # --- Find nearest index among the full progression list (not just uniques) ---
    best_idx = 0
    best_diff = inf
    for idx, p in enumerate(progressions):
        d = abs(float(p.progression) - lc)
        if d < best_diff:
            best_diff = d
            best_idx = idx
    if print_steps:
        print(f"Snapped to progression[{best_idx}] = {progressions[best_idx].progression}")

    # --- Snap to the LAST index within this value's duplicate band ---
    best_val = float(progressions[best_idx].progression)
    while (
        best_idx + 1 < len(progressions)
        and _float_eq(float(progressions[best_idx + 1].progression), best_val)
    ):
        best_idx += 1
    if print_steps:
        print(f"Snapped to last duplicate in band at index {best_idx}")

    # If not at the end, move forward one index (advances past duplicates)
    if best_idx < len(progressions) - 1:
        if print_steps:
            print(f"Advancing forward to index {best_idx + 1}")
        return progressions[best_idx + 1]

    # --- At the VERY END: choose target progression based on 3rd-from-last in list ---
    if print_steps:
        print("At the end of the progression list. Applying end-of-plan logic.")

    if len(progressions) >= 3:
        target_val = float(progressions[-3].progression)
        if print_steps:
            print(f"Choosing 3rd-from-last progression in list: {target_val}")
    else:
        target_val = float(progressions[0].progression)
        if print_steps:
            print(f"Only {len(progressions)} progressions, choosing first: {target_val}")

    # Build unique mapping to find duplicate band
    unique_vals: List[float] = []
    val_to_indices: Dict[float, List[int]] = {}
    for idx, p in enumerate(progressions):
        v = float(p.progression)
        if not unique_vals or not _float_eq(v, unique_vals[-1]):
            unique_vals.append(v)
            val_to_indices[v] = [idx]
        else:
            val_to_indices[v].append(idx)

    band_indices = val_to_indices[target_val]
    dup_count = len(band_indices)

    consec = _count_consecutive_snapped_to_progression(workout_id, target_val, unique_vals)
    if print_steps:
        print(f"Consecutive snaps to {target_val}: {consec} (duplicates available: {dup_count})")

    copy_offset = consec if consec < dup_count else (dup_count - 1)
    target_idx = band_indices[copy_offset]

    if print_steps:
        print(f"Selected progression[{target_idx}] = {progressions[target_idx].progression}")

    return progressions[target_idx]

def backfill_rest_days_if_gap(now=None) -> list:
    """
    If the most-recent CardioDailyLog is more than 32 hours old, insert
    24-hour-spaced 'Rest' day logs until the newest log is within 32 hours.

    Returns:
        A list of the CardioDailyLog objects that were created (may be empty).
    """
    print("STARTING")
    now = now or timezone.now()

    # Find the latest cardio log (if none, do nothing)
    last_log = (
        CardioDailyLog.objects
        .order_by("-datetime_started")
        .first()
    )
    if not last_log:
        return []

    # If gap already ≤ 32 hours, nothing to do
    thirty_two_hours = timedelta(hours=32)
    forty_hours = timedelta(hours=40)
    if now - last_log.datetime_started <= thirty_two_hours:
        return []

    # Resolve the "Rest" workout robustly:
    # Prefer a workout actually named "Rest"; otherwise, take first workout
    # under the routine named "Rest".
    rest_workout = (
        CardioWorkout.objects.filter(name__iexact="Rest").first()
        or CardioWorkout.objects.filter(routine__name__iexact="Rest").order_by("priority_order", "name").first()
    )
    if not rest_workout:
        # Nothing we can create without a rest workout
        return []

    created = []
    next_dt = last_log.datetime_started

    # Keep adding a day until the remaining gap is ≤ 40 hours
    with transaction.atomic():
        while now - next_dt > forty_hours:
            next_dt = next_dt + timedelta(hours=24)
            created.append(
                CardioDailyLog.objects.create(
                    workout=rest_workout,
                    datetime_started=next_dt,
                    # goal and other fields intentionally omitted; they can be null
                    # per existing usage in get_next_progression_for_workout
                )
            )

    return created

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


def get_next_strength_goal(routine_id: int) -> Optional[VwStrengthProgression]:
    """Return the next Strength goal for a routine based on daily volume."""
    # Fetch ordered progressions for this routine from the view
    try:
        routine = StrengthRoutine.objects.get(pk=routine_id)
    except StrengthRoutine.DoesNotExist:
        return None

    progressions: List[VwStrengthProgression] = list(
        VwStrengthProgression.objects.filter(routine_name=routine.name).order_by("progression_order")
    )
    if not progressions:
        return None

    # Determine the last completed volume for this routine
    last_completed = (
        StrengthDailyLog.objects
        .filter(routine_id=routine_id)
        .exclude(rep_goal__isnull=True)
        .filter(total_reps_completed__gte=F("rep_goal"))
        .order_by("-datetime_started")
        .values_list("total_reps_completed", flat=True)
        .first()
    )

    if last_completed is None:
        last_completed = (
            StrengthDailyLog.objects
            .filter(routine_id=routine_id)
            .exclude(rep_goal__isnull=True)
            .aggregate(Max("total_reps_completed"))["total_reps_completed__max"]
        )

    if last_completed is None:
        return progressions[0]

    lc = float(last_completed)
    for prog in progressions:
        if float(prog.daily_volume) > lc:
            return prog

    return progressions[-1]


def get_strength_routines_ordered_by_last_completed(
    program: Optional[Program] = None,
) -> List[StrengthRoutine]:
    """Return StrengthRoutines ordered by most recent completion time."""
    if program is None:
        program = Program.objects.filter(selected=True).first()

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
    """Select the StrengthRoutine least recently completed."""
    routines = get_strength_routines_ordered_by_last_completed()
    if not routines:
        return None
    return routines[-1]


def get_next_strength_routine(now=None) -> tuple[Optional[StrengthRoutine], Optional[VwStrengthProgression], List[StrengthRoutine]]:
    """Return predicted next StrengthRoutine, its next goal, and ordered routine list."""
    next_routine = predict_next_strength_routine(now=now)
    routine_list = get_strength_routines_ordered_by_last_completed()
    next_goal: Optional[VwStrengthProgression] = None
    if next_routine:
        next_goal = get_next_strength_goal(next_routine.id)
        try:
            idx = routine_list.index(next_routine)
            routine_list = routine_list[:idx] + routine_list[idx + 1:] + [next_routine]
        except ValueError:
            pass
    return next_routine, next_goal, routine_list
