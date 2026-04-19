from __future__ import annotations

from math import isfinite
from typing import Any, Callable, Dict, List
from .distance_conversions import get_sprint_distance_miles_map

EPS = 1e-9
AVG_GOAL_EPSILON = 1e-6
INTERVAL_MPH_STEP = 0.1


WORKOUT_DESCRIPTION_BY_TYPE: Dict[str, str] = {
    "mi_run": "Easy conversational run. You should be able to talk without being too out of breath.",
    "tempo": "Controlled run with easy start and finish, and a sustained harder middle section near race pace.",
    "fast": "Hard effort. You should expect heavy breathing and limited ability to talk.",
    "min_run": "Long easy run focused on duration. Keep effort comfortable and steady.",
    "x400": "400 meter repeats.",
    "x200": "200 meter repeats.",
    "x800": "800 meter repeats.",
}

WORKOUT_TYPE_ALIASES: Dict[str, str] = {
    "mi run": "mi_run",
    "mirun": "mi_run",
    "tempo": "tempo",
    "fast": "fast",
    "min run": "min_run",
    "minrun": "min_run",
    "x400": "x400",
    "x 400": "x400",
    "x200": "x200",
    "x 200": "x200",
    "x800": "x800",
    "x 800": "x800",
}

INTERVAL_DISTANCE_WORKOUTS = {"x200", "x400", "x800"}


def _interval_distance_miles(workout_type: str) -> float:
    return float(get_sprint_distance_miles_map().get(workout_type, 0.0) or 0.0)


def _as_float(*values: Any) -> float | None:
    for value in values:
        try:
            num = float(value)
        except (TypeError, ValueError):
            continue
        if isfinite(num):
            return num
    return None


def _as_bool(value: Any, default: bool = False) -> bool:
    if isinstance(value, bool):
        return value
    if isinstance(value, str):
        text = value.strip().lower()
        if text in {"1", "true", "yes", "y"}:
            return True
        if text in {"0", "false", "no", "n"}:
            return False
    if value is None:
        return default
    return bool(value)


def _clamp(value: float, lower: float | None = None, upper: float | None = None) -> float:
    out = float(value)
    if lower is not None and out < lower:
        out = lower
    if upper is not None and out > upper:
        out = upper
    return out


def _safe_round(value: float | None, digits: int = 3) -> float | None:
    if value is None:
        return None
    try:
        num = float(value)
    except (TypeError, ValueError):
        return None
    if not isfinite(num):
        return None
    return round(num, digits)


def normalize_progression_unit(progression_unit: Any) -> str:
    text = str(progression_unit or "").strip().lower()
    if text.startswith("min"):
        return "minutes"
    return "miles"


def canonical_workout_type(workout_name: Any) -> str:
    cleaned = str(workout_name or "").strip().lower()
    cleaned = " ".join(cleaned.split())
    if cleaned in WORKOUT_TYPE_ALIASES:
        return WORKOUT_TYPE_ALIASES[cleaned]
    if cleaned.replace(" ", "") in WORKOUT_TYPE_ALIASES:
        return WORKOUT_TYPE_ALIASES[cleaned.replace(" ", "")]
    if cleaned.startswith("x") and any(ch.isdigit() for ch in cleaned):
        digits = "".join(ch for ch in cleaned if ch.isdigit())
        candidate = f"x{digits}"
        if candidate in INTERVAL_DISTANCE_WORKOUTS:
            return candidate
    return "mi_run"


def _derive_total_targets(
    progression: float,
    progression_unit: str,
    avg_mph_goal: float,
) -> tuple[float, float]:
    total_progression = max(0.0, float(progression or 0.0))
    if progression_unit == "minutes":
        total_minutes = total_progression
        total_miles = ((avg_mph_goal or 0.0) * total_minutes) / 60.0 if avg_mph_goal > 0 else 0.0
    else:
        total_miles = total_progression
        total_minutes = (total_miles / avg_mph_goal) * 60.0 if avg_mph_goal > 0 else 0.0
    return total_miles, total_minutes


def _solve_mph(distance_miles: float, minutes: float, fallback: float | None = None) -> float:
    if distance_miles > EPS and minutes > EPS:
        mph = distance_miles / (minutes / 60.0)
        if isfinite(mph) and mph > EPS:
            return mph
    if fallback is not None and fallback > EPS:
        return fallback
    return 0.0


def _step_floor(value: float, step: float) -> float:
    if value <= 0.0 or step <= 0.0:
        return 0.0
    return int((value + EPS) / step) * step


def _all_equalish(values: List[float], rel_tol: float = 0.01, abs_tol: float = 0.001) -> bool:
    if len(values) < 2:
        return False
    baseline = float(values[0] or 0.0)
    for value in values[1:]:
        current = float(value or 0.0)
        if abs(current - baseline) > max(abs_tol, abs(baseline) * rel_tol):
            return False
    return True


def _extract_completed_interval_series(state: Dict[str, Any]) -> tuple[List[float], List[float]]:
    completed_mphs: List[float] = []
    completed_distances: List[float] = []
    for raw in state.get("segments") or []:
        if not isinstance(raw, dict):
            continue
        mph = _as_float(raw.get("target_mph"), raw.get("running_mph"), raw.get("mph"))
        distance = _as_float(
            raw.get("target_distance"),
            raw.get("running_miles"),
            raw.get("miles"),
            raw.get("distance"),
        )
        if mph is None or distance is None:
            continue
        mph = float(mph)
        distance = float(distance)
        if mph <= EPS or distance <= EPS:
            continue
        completed_mphs.append(mph)
        completed_distances.append(distance)
    return completed_mphs, completed_distances


def _rebalance_interval_mphs_for_equal_interval_avg_goal(
    workout_type: str,
    progression_unit: str,
    state: Dict[str, Any],
    segments: List[Dict[str, Any]],
    mph_values: List[float],
    avg_mph_goal: float,
    max_mph: float,
    step: float = INTERVAL_MPH_STEP,
) -> List[float] | None:
    # For equal-distance interval workouts, keep recommendation math aligned with
    # sprint avg semantics (mean of interval MPH) so final reps do not over-push.
    if workout_type not in INTERVAL_DISTANCE_WORKOUTS:
        return None
    if progression_unit != "miles" or avg_mph_goal <= EPS or step <= EPS:
        return None
    if not segments or len(segments) != len(mph_values):
        return None

    completed_mphs, completed_distances = _extract_completed_interval_series(state)
    if not completed_mphs:
        return None

    planned_distances: List[float] = []
    adjusted = [max(0.1, float(value or 0.0)) for value in mph_values]
    max_non_max_mph = max(0.1, max_mph - step) if max_mph > step else max(0.1, max_mph)

    fixed_sum = 0.0
    variable_indices: List[int] = []
    for idx, segment in enumerate(segments):
        distance = _as_float(segment.get("progression"), segment.get("target_distance"))
        if distance is None or distance <= EPS:
            return None
        planned_distances.append(float(distance))
        if bool(segment.get("is_max")):
            adjusted[idx] = min(max_mph, adjusted[idx])
            fixed_sum += adjusted[idx]
            continue
        variable_indices.append(idx)

    all_distances = completed_distances + planned_distances
    if len(all_distances) < 2:
        return None
    if not _all_equalish(all_distances, rel_tol=0.01, abs_tol=max(0.001, float(planned_distances[0]) * 0.05)):
        return None
    if not variable_indices:
        return adjusted

    total_count = len(completed_mphs) + len(segments)
    completed_sum = sum(completed_mphs)
    variable_count = len(variable_indices)

    required_variable_sum = (avg_mph_goal * total_count) - completed_sum - fixed_sum
    min_variable_sum = 0.1 * variable_count
    max_variable_sum = max_non_max_mph * variable_count
    target_variable_sum = _clamp(required_variable_sum, lower=min_variable_sum, upper=max_variable_sum)

    base_value = _step_floor(target_variable_sum / variable_count, step)
    base_value = _clamp(base_value, lower=0.1, upper=max_non_max_mph)
    for idx in variable_indices:
        adjusted[idx] = base_value
    current_variable_sum = base_value * variable_count

    needed_sum = max(0.0, target_variable_sum - current_variable_sum)
    needed_steps = int((needed_sum + step - EPS) / step)
    next_idx = 0
    for _ in range(needed_steps):
        changed = False
        for offset in range(variable_count):
            idx = variable_indices[(next_idx + offset) % variable_count]
            bumped = min(max_non_max_mph, adjusted[idx] + step)
            if bumped <= adjusted[idx] + EPS:
                continue
            adjusted[idx] = bumped
            next_idx = (next_idx + offset + 1) % variable_count
            changed = True
            break
        if not changed:
            break

    return [_safe_round(value, 3) or value for value in adjusted]


def _interval_plan_totals(
    progression_unit: str,
    segments: List[Dict[str, Any]],
    mph_values: List[float],
) -> tuple[float, float]:
    planned_miles = 0.0
    planned_minutes = 0.0
    for idx, segment in enumerate(segments):
        if idx >= len(mph_values):
            break
        progression_amount = max(0.0, float(segment.get("progression") or 0.0))
        mph = max(0.1, float(mph_values[idx] or 0.0))
        if progression_unit == "minutes":
            minutes = progression_amount
            miles = (mph * minutes) / 60.0
        else:
            miles = progression_amount
            minutes = (miles / mph) * 60.0
        planned_miles += miles
        planned_minutes += minutes
    return planned_miles, planned_minutes


def _projected_avg_for_interval_plan(
    progression_unit: str,
    segments: List[Dict[str, Any]],
    mph_values: List[float],
    completed_miles: float,
    completed_minutes: float,
) -> float:
    planned_miles, planned_minutes = _interval_plan_totals(progression_unit, segments, mph_values)
    return _solve_mph(
        max(0.0, completed_miles) + planned_miles,
        max(0.0, completed_minutes) + planned_minutes,
        fallback=0.0,
    )


def _rebalance_interval_mphs_for_avg_goal(
    progression_unit: str,
    segments: List[Dict[str, Any]],
    mph_values: List[float],
    avg_mph_goal: float,
    completed_miles: float,
    completed_minutes: float,
    max_mph: float,
    step: float = INTERVAL_MPH_STEP,
) -> List[float]:
    if not segments or len(segments) != len(mph_values):
        return mph_values
    if avg_mph_goal <= EPS or step <= EPS:
        return mph_values

    max_non_max_mph = max(0.1, max_mph - step) if max_mph > step else max(0.1, max_mph)
    adjusted = [max(0.1, float(value or 0.0)) for value in mph_values]
    non_max_indices: List[int] = []

    # Use treadmill-friendly increments, then selectively bump only the reps
    # needed to keep the projected average at or above the goal.
    for idx, segment in enumerate(segments):
        if bool(segment.get("is_max")):
            continue
        baseline = min(adjusted[idx], max_non_max_mph)
        baseline = max(0.1, _step_floor(baseline, step))
        adjusted[idx] = min(max_non_max_mph, baseline)
        non_max_indices.append(idx)

    if not non_max_indices:
        return adjusted

    projected_avg = _projected_avg_for_interval_plan(
        progression_unit=progression_unit,
        segments=segments,
        mph_values=adjusted,
        completed_miles=completed_miles,
        completed_minutes=completed_minutes,
    )
    if projected_avg + AVG_GOAL_EPSILON >= avg_mph_goal:
        return adjusted

    ordered_non_max = sorted(
        non_max_indices,
        key=lambda idx: (-float(segments[idx].get("weight") or 0.0), idx),
    )

    while projected_avg + AVG_GOAL_EPSILON < avg_mph_goal:
        changed = False
        for idx in ordered_non_max:
            bumped = min(max_non_max_mph, adjusted[idx] + step)
            bumped = _safe_round(bumped, 3) or bumped
            if bumped <= adjusted[idx] + EPS:
                continue
            adjusted[idx] = bumped
            changed = True
            projected_avg = _projected_avg_for_interval_plan(
                progression_unit=progression_unit,
                segments=segments,
                mph_values=adjusted,
                completed_miles=completed_miles,
                completed_minutes=completed_minutes,
            )
            if projected_avg + AVG_GOAL_EPSILON >= avg_mph_goal:
                break
        if not changed:
            break

    return adjusted


def _segment(
    label: str,
    progression_unit: str,
    target_progression: float,
    target_mph: float,
    notes: str = "",
    intensity: str = "steady",
) -> Dict[str, Any]:
    progression_value = max(0.0, float(target_progression or 0.0))
    mph_value = max(0.0, float(target_mph or 0.0))
    if progression_unit == "minutes":
        target_minutes = progression_value
        target_distance = ((mph_value * target_minutes) / 60.0) if mph_value > 0 else 0.0
    else:
        target_distance = progression_value
        target_minutes = ((target_distance / mph_value) * 60.0) if mph_value > 0 else 0.0
    return {
        "label": label,
        "target_progression": _safe_round(progression_value, 4),
        "target_distance": _safe_round(target_distance, 4),
        "target_minutes": _safe_round(target_minutes, 4),
        "target_mph": _safe_round(mph_value, 3),
        "intensity": intensity,
        "notes": notes,
    }


def normalize_already_complete(
    progression: float,
    progression_unit: str,
    avg_mph_goal: float,
    already_complete: Dict[str, Any] | None = None,
) -> Dict[str, Any]:
    progression_unit_norm = normalize_progression_unit(progression_unit)
    source = already_complete if isinstance(already_complete, dict) else {}
    total_progression = max(0.0, float(progression or 0.0))
    total_miles, total_minutes = _derive_total_targets(total_progression, progression_unit_norm, avg_mph_goal)

    normalized_segments: List[Dict[str, Any]] = []
    seg_miles_sum = 0.0
    seg_minutes_sum = 0.0
    seg_progression_sum = 0.0

    for idx, raw in enumerate(source.get("segments") or []):
        if not isinstance(raw, dict):
            continue
        miles_val = _as_float(
            raw.get("distance"),
            raw.get("miles"),
            raw.get("running_miles"),
            raw.get("target_distance"),
        )
        minutes_val = _as_float(
            raw.get("minutes"),
            raw.get("duration_minutes"),
            raw.get("running_minutes"),
            raw.get("target_minutes"),
        )
        running_seconds = _as_float(raw.get("running_seconds")) or 0.0
        if minutes_val is not None and running_seconds:
            minutes_val += running_seconds / 60.0

        mph_val = _as_float(raw.get("mph"), raw.get("running_mph"), raw.get("target_mph"))
        if miles_val is None and minutes_val is not None and mph_val and mph_val > 0:
            miles_val = mph_val * (minutes_val / 60.0)
        if minutes_val is None and miles_val is not None and mph_val and mph_val > 0:
            minutes_val = (miles_val / mph_val) * 60.0

        progression_val = _as_float(raw.get("progression"), raw.get("target_progression"))
        if progression_val is None:
            progression_val = miles_val if progression_unit_norm == "miles" else minutes_val

        if miles_val is None:
            miles_val = 0.0
        if minutes_val is None:
            minutes_val = 0.0
        if progression_val is None:
            progression_val = 0.0

        miles_val = max(0.0, miles_val)
        minutes_val = max(0.0, minutes_val)
        progression_val = max(0.0, progression_val)

        seg_miles_sum += miles_val
        seg_minutes_sum += minutes_val
        seg_progression_sum += progression_val

        normalized_segments.append(
            {
                "label": str(raw.get("label") or f"Completed {idx + 1}"),
                "target_distance": _safe_round(miles_val, 4),
                "target_minutes": _safe_round(minutes_val, 4),
                "target_progression": _safe_round(progression_val, 4),
                "target_mph": _safe_round(mph_val, 3),
                "intensity": str(raw.get("intensity") or "completed"),
                "notes": str(raw.get("notes") or ""),
            }
        )

    completed_progression = _as_float(
        source.get("completed_progression"),
        source.get("completed"),
        source.get("total_completed"),
    )
    completed_miles = _as_float(source.get("completed_miles"), source.get("miles_completed"))
    completed_minutes = _as_float(
        source.get("completed_minutes"),
        source.get("minutes_completed"),
        source.get("minutes_elapsed"),
    )

    if completed_progression is None:
        completed_progression = seg_progression_sum
    if completed_miles is None:
        completed_miles = seg_miles_sum
    if completed_minutes is None:
        completed_minutes = seg_minutes_sum

    if progression_unit_norm == "miles":
        if completed_progression is None:
            completed_progression = completed_miles
        if completed_miles is None:
            completed_miles = completed_progression
        if completed_minutes is None:
            completed_minutes = ((completed_miles / avg_mph_goal) * 60.0) if avg_mph_goal > 0 else 0.0
    else:
        if completed_progression is None:
            completed_progression = completed_minutes
        if completed_minutes is None:
            completed_minutes = completed_progression
        if completed_miles is None:
            completed_miles = ((avg_mph_goal * completed_minutes) / 60.0) if avg_mph_goal > 0 else 0.0

    completed_progression = _clamp(completed_progression or 0.0, lower=0.0, upper=total_progression)
    completed_miles = _clamp(completed_miles or 0.0, lower=0.0, upper=total_miles if total_miles > 0 else None)
    completed_minutes = _clamp(
        completed_minutes or 0.0,
        lower=0.0,
        upper=total_minutes if total_minutes > 0 else None,
    )

    remaining_progression = max(0.0, total_progression - completed_progression)
    remaining_miles = max(0.0, total_miles - completed_miles)
    remaining_minutes = max(0.0, total_minutes - completed_minutes)

    max_goal_done = _as_bool(
        source.get("max_goal_done"),
        default=_as_bool(source.get("max_done"), default=_as_bool(source.get("did_max_goal"), default=False)),
    )

    return {
        "progression_unit": progression_unit_norm,
        "total_progression": _safe_round(total_progression, 4),
        "completed_progression": _safe_round(completed_progression, 4),
        "remaining_progression": _safe_round(remaining_progression, 4),
        "total_miles": _safe_round(total_miles, 4),
        "completed_miles": _safe_round(completed_miles, 4),
        "remaining_miles": _safe_round(remaining_miles, 4),
        "total_minutes": _safe_round(total_minutes, 4),
        "completed_minutes": _safe_round(completed_minutes, 4),
        "remaining_minutes": _safe_round(remaining_minutes, 4),
        "max_goal_done": bool(max_goal_done),
        "segments": normalized_segments,
    }


def _package_result(
    workout_type: str,
    workout_name: str,
    progression: float,
    progression_unit: str,
    avg_mph_goal: float,
    goal_distance: float,
    max_mph_goal: float,
    state: Dict[str, Any],
    recommendations: List[Dict[str, Any]],
) -> Dict[str, Any]:
    planned_miles = sum(float(item.get("target_distance") or 0.0) for item in recommendations)
    planned_minutes = sum(float(item.get("target_minutes") or 0.0) for item in recommendations)
    planned_progression = sum(float(item.get("target_progression") or 0.0) for item in recommendations)

    projected_miles = float(state.get("completed_miles") or 0.0) + planned_miles
    projected_minutes = float(state.get("completed_minutes") or 0.0) + planned_minutes
    projected_progression = float(state.get("completed_progression") or 0.0) + planned_progression
    projected_avg_mph = _solve_mph(projected_miles, projected_minutes, fallback=0.0)

    return {
        "workout_type": workout_type,
        "workout_name": workout_name,
        "description": WORKOUT_DESCRIPTION_BY_TYPE.get(workout_type, ""),
        "progression": {
            "total": _safe_round(progression, 4),
            "unit": progression_unit,
            "remaining": _safe_round(state.get("remaining_progression"), 4),
        },
        "targets": {
            "avg_mph_goal": _safe_round(avg_mph_goal, 3),
            "goal_distance": _safe_round(goal_distance, 4),
            "max_mph_goal": _safe_round(max_mph_goal, 3),
        },
        "already_complete": state,
        "recommendations": recommendations,
        "summary": {
            "planned_progression": _safe_round(planned_progression, 4),
            "planned_miles": _safe_round(planned_miles, 4),
            "planned_minutes": _safe_round(planned_minutes, 4),
            "projected_completed_progression": _safe_round(projected_progression, 4),
            "projected_completed_miles": _safe_round(projected_miles, 4),
            "projected_completed_minutes": _safe_round(projected_minutes, 4),
            "projected_avg_mph": _safe_round(projected_avg_mph, 3),
        },
    }


def _required_mph_for_remaining(
    state: Dict[str, Any],
    avg_mph_goal: float,
    fallback: float = 0.0,
) -> float:
    remaining_miles = max(0.0, float(state.get("remaining_miles") or 0.0))
    remaining_minutes = max(0.0, float(state.get("remaining_minutes") or 0.0))
    required = _solve_mph(
        remaining_miles,
        remaining_minutes,
        fallback=avg_mph_goal if avg_mph_goal > EPS else fallback,
    )
    if required <= EPS:
        required = avg_mph_goal if avg_mph_goal > EPS else fallback
    if required <= EPS:
        required = 1.0
    return required


def _interval_recommendation(
    workout_type: str,
    workout_name: str,
    progression: float,
    progression_unit: str,
    avg_mph_goal: float,
    goal_distance: float,
    max_mph_goal: float,
    already_complete: Dict[str, Any] | None,
) -> Dict[str, Any]:
    state = normalize_already_complete(
        progression=progression,
        progression_unit=progression_unit,
        avg_mph_goal=avg_mph_goal,
        already_complete=already_complete,
    )
    remaining_progression = float(state.get("remaining_progression") or 0.0)
    if remaining_progression <= EPS:
        return _package_result(
            workout_type,
            workout_name,
            progression,
            progression_unit,
            avg_mph_goal,
            goal_distance,
            max_mph_goal,
            state,
            [],
        )

    # Prefer goal_distance as the canonical repeat size (from workout config).
    # Fallback to known interval mile equivalents only when no goal_distance is provided.
    repeat_progression_default = goal_distance if goal_distance > EPS else 0.0
    if repeat_progression_default <= EPS:
        repeat_miles = _interval_distance_miles(workout_type)
        repeat_progression_default = repeat_miles
        if progression_unit == "minutes":
            repeat_progression_default = (repeat_miles / avg_mph_goal) * 60.0 if avg_mph_goal > 0 else 0.0
    if repeat_progression_default <= EPS:
        repeat_progression_default = max(0.1, remaining_progression)

    max_block_progression = 0.0
    if not bool(state.get("max_goal_done")):
        requested = goal_distance if goal_distance > EPS else repeat_progression_default
        if requested <= EPS:
            requested = repeat_progression_default if repeat_progression_default > EPS else remaining_progression
        max_block_progression = min(remaining_progression, max(requested, 0.0))
        if max_block_progression <= EPS and remaining_progression > EPS:
            max_block_progression = min(remaining_progression, repeat_progression_default)

    remaining_after_max = max(0.0, remaining_progression - max_block_progression)

    chunks: List[float] = []
    labels: List[str] = []
    repeat_label_counter = 1

    if max_block_progression > EPS:
        chunks.append(max_block_progression)
        labels.append("Max Rep")

    if remaining_after_max > EPS and repeat_progression_default > EPS:
        repeat_count = int((remaining_after_max + (repeat_progression_default * 1e-6)) / repeat_progression_default)
        if repeat_count < 0:
            repeat_count = 0
        for _ in range(repeat_count):
            chunks.append(repeat_progression_default)
            labels.append(f"Repeat {repeat_label_counter}")
            repeat_label_counter += 1

        consumed = repeat_count * repeat_progression_default
        remainder = max(0.0, remaining_after_max - consumed)
        # Avoid creating an extra tiny tail interval due float drift.
        tiny_remainder_cutoff = max(EPS * 10.0, repeat_progression_default * 0.08)
        if remainder > tiny_remainder_cutoff:
            chunks.append(remainder)
            labels.append(f"Repeat {repeat_label_counter}")
            repeat_label_counter += 1
        elif remainder > EPS:
            if chunks:
                chunks[-1] += remainder
            elif max_block_progression > EPS:
                chunks[0] += remainder
            else:
                chunks.append(remainder)
                labels.append(f"Repeat {repeat_label_counter}")

    if not chunks:
        chunks = [remaining_progression]
        labels = ["Repeat 1"]

    max_mph = max_mph_goal if max_mph_goal > EPS else (avg_mph_goal * 1.1 if avg_mph_goal > EPS else avg_mph_goal)
    if max_mph <= EPS:
        max_mph = avg_mph_goal if avg_mph_goal > EPS else 1.0

    if max_block_progression > EPS:
        max_seg = _segment(
            "Max Rep",
            progression_unit,
            chunks[0],
            max_mph,
            notes=f"Hit your hardest controlled rep for {workout_type.upper()}.",
            intensity="max",
        )
        max_distance = float(max_seg.get("target_distance") or 0.0)
        max_minutes = float(max_seg.get("target_minutes") or 0.0)
        rest_distance = max(0.0, float(state.get("remaining_miles") or 0.0) - max_distance)
        rest_minutes = max(0.0, float(state.get("remaining_minutes") or 0.0) - max_minutes)
        rest_mph = _solve_mph(rest_distance, rest_minutes, fallback=avg_mph_goal)
        if rest_mph > max_mph - 0.1:
            rest_mph = max(0.1, max_mph - 0.1)
    else:
        rest_mph = _solve_mph(float(state.get("remaining_miles") or 0.0), float(state.get("remaining_minutes") or 0.0), fallback=avg_mph_goal)
        rest_mph = max(0.1, rest_mph)

    segment_specs: List[Dict[str, Any]] = []
    for idx, amount in enumerate(chunks):
        if amount <= EPS:
            continue
        label = labels[idx] if idx < len(labels) else f"Repeat {idx + 1}"
        is_max = label == "Max Rep"
        segment_specs.append(
            {
                "label": label,
                "progression": amount,
                "is_max": is_max,
                "weight": amount,
                "target_mph": max_mph if is_max else rest_mph,
                "notes": "Full effort, then recover before the next repeat." if is_max else "Controlled repeat. Stay consistent.",
                "intensity": "max" if is_max else "hard",
            }
        )

    segment_mphs = [float(spec.get("target_mph") or 0.0) for spec in segment_specs]
    segment_mphs = _rebalance_interval_mphs_for_avg_goal(
        progression_unit=progression_unit,
        segments=segment_specs,
        mph_values=segment_mphs,
        avg_mph_goal=avg_mph_goal,
        completed_miles=float(state.get("completed_miles") or 0.0),
        completed_minutes=float(state.get("completed_minutes") or 0.0),
        max_mph=max_mph,
        step=INTERVAL_MPH_STEP,
    )

    recommendations: List[Dict[str, Any]] = []
    for idx, spec in enumerate(segment_specs):
        recommendations.append(
            _segment(
                label=f"{spec.get('label')} ({workout_type.upper()})",
                progression_unit=progression_unit,
                target_progression=float(spec.get("progression") or 0.0),
                target_mph=segment_mphs[idx] if idx < len(segment_mphs) else float(spec.get("target_mph") or 0.0),
                notes=str(spec.get("notes") or ""),
                intensity=str(spec.get("intensity") or "hard"),
            )
        )

    return _package_result(
        workout_type,
        workout_name,
        progression,
        progression_unit,
        avg_mph_goal,
        goal_distance,
        max_mph_goal,
        state,
        recommendations,
    )


def recommend_mi_run(
    progression: float,
    progression_unit: str,
    avg_mph_goal: float,
    goal_distance: float,
    max_mph_goal: float,
    already_complete: Dict[str, Any] | None = None,
) -> Dict[str, Any]:
    progression_unit_norm = normalize_progression_unit(progression_unit)
    state = normalize_already_complete(
        progression=progression,
        progression_unit=progression_unit_norm,
        avg_mph_goal=avg_mph_goal,
        already_complete=already_complete,
    )
    remaining = float(state.get("remaining_progression") or 0.0)
    recommendations: List[Dict[str, Any]] = []
    if remaining > EPS:
        easy_mph = _required_mph_for_remaining(
            state=state,
            avg_mph_goal=avg_mph_goal,
            fallback=max_mph_goal,
        )
        recommendations.append(
            _segment(
                label="Easy Run",
                progression_unit=progression_unit_norm,
                target_progression=remaining,
                target_mph=easy_mph,
                notes="Conversation pace. If breathing spikes, back off speed.",
                intensity="easy",
            )
        )

    return _package_result(
        "mi_run",
        "Mi Run",
        progression,
        progression_unit_norm,
        avg_mph_goal,
        goal_distance,
        max_mph_goal,
        state,
        recommendations,
    )


def recommend_tempo(
    progression: float,
    progression_unit: str,
    avg_mph_goal: float,
    goal_distance: float,
    max_mph_goal: float,
    already_complete: Dict[str, Any] | None = None,
) -> Dict[str, Any]:
    progression_unit_norm = normalize_progression_unit(progression_unit)
    state = normalize_already_complete(
        progression=progression,
        progression_unit=progression_unit_norm,
        avg_mph_goal=avg_mph_goal,
        already_complete=already_complete,
    )
    remaining = float(state.get("remaining_progression") or 0.0)
    recommendations: List[Dict[str, Any]] = []
    if remaining <= EPS:
        return _package_result(
            "tempo",
            "Tempo",
            progression,
            progression_unit_norm,
            avg_mph_goal,
            goal_distance,
            max_mph_goal,
            state,
            recommendations,
        )

    if goal_distance > EPS and not bool(state.get("max_goal_done")):
        tempo_progression = min(remaining, goal_distance)
    else:
        tempo_progression = min(remaining * 0.5, remaining)

    warm_cool_total = max(0.0, remaining - tempo_progression)
    warm_progression = warm_cool_total / 2.0
    cool_progression = warm_cool_total - warm_progression

    tempo_mph = max_mph_goal if max_mph_goal > EPS else (avg_mph_goal * 1.1 if avg_mph_goal > EPS else avg_mph_goal)
    if tempo_mph <= EPS:
        tempo_mph = 1.0

    tempo_segment = _segment(
        label="Tempo Build",
        progression_unit=progression_unit_norm,
        target_progression=tempo_progression,
        target_mph=tempo_mph,
        notes="Strong middle section near threshold effort.",
        intensity="hard",
    )
    tempo_miles = float(tempo_segment.get("target_distance") or 0.0)
    tempo_minutes = float(tempo_segment.get("target_minutes") or 0.0)

    easy_miles = max(0.0, float(state.get("remaining_miles") or 0.0) - tempo_miles)
    easy_minutes = max(0.0, float(state.get("remaining_minutes") or 0.0) - tempo_minutes)
    easy_mph = _solve_mph(easy_miles, easy_minutes, fallback=(avg_mph_goal * 0.9 if avg_mph_goal > EPS else avg_mph_goal))
    if easy_mph <= EPS:
        easy_mph = max(1.0, avg_mph_goal * 0.9 if avg_mph_goal > EPS else 1.0)
    if easy_mph >= tempo_mph:
        easy_mph = max(0.1, tempo_mph - 0.2)

    if warm_progression > EPS:
        recommendations.append(
            _segment(
                label="Warm-up",
                progression_unit=progression_unit_norm,
                target_progression=warm_progression,
                target_mph=easy_mph,
                notes="Start easy and relaxed.",
                intensity="easy",
            )
        )
    if tempo_progression > EPS:
        recommendations.append(tempo_segment)
    if cool_progression > EPS:
        recommendations.append(
            _segment(
                label="Cool-down",
                progression_unit=progression_unit_norm,
                target_progression=cool_progression,
                target_mph=easy_mph,
                notes="Ease down and recover while finishing the progression.",
                intensity="easy",
            )
        )

    return _package_result(
        "tempo",
        "Tempo",
        progression,
        progression_unit_norm,
        avg_mph_goal,
        goal_distance,
        max_mph_goal,
        state,
        recommendations,
    )


def recommend_fast(
    progression: float,
    progression_unit: str,
    avg_mph_goal: float,
    goal_distance: float,
    max_mph_goal: float,
    already_complete: Dict[str, Any] | None = None,
) -> Dict[str, Any]:
    progression_unit_norm = normalize_progression_unit(progression_unit)
    state = normalize_already_complete(
        progression=progression,
        progression_unit=progression_unit_norm,
        avg_mph_goal=avg_mph_goal,
        already_complete=already_complete,
    )
    remaining = float(state.get("remaining_progression") or 0.0)
    recommendations: List[Dict[str, Any]] = []
    if remaining <= EPS:
        return _package_result(
            "fast",
            "Fast",
            progression,
            progression_unit_norm,
            avg_mph_goal,
            goal_distance,
            max_mph_goal,
            state,
            recommendations,
        )

    max_block_progression = 0.0
    if not bool(state.get("max_goal_done")):
        requested = goal_distance if goal_distance > EPS else (remaining * 0.35)
        max_block_progression = min(remaining, max(requested, 0.0))

    sustain_progression = max(0.0, remaining - max_block_progression)
    max_mph = max_mph_goal if max_mph_goal > EPS else (avg_mph_goal * 1.1 if avg_mph_goal > EPS else avg_mph_goal)
    if max_mph <= EPS:
        max_mph = 1.0

    if max_block_progression > EPS:
        max_segment = _segment(
            label="Max Push",
            progression_unit=progression_unit_norm,
            target_progression=max_block_progression,
            target_mph=max_mph,
            notes="Hard effort. Breathing should be heavy.",
            intensity="max",
        )
        recommendations.append(max_segment)
        remaining_miles = max(0.0, float(state.get("remaining_miles") or 0.0) - float(max_segment.get("target_distance") or 0.0))
        remaining_minutes = max(0.0, float(state.get("remaining_minutes") or 0.0) - float(max_segment.get("target_minutes") or 0.0))
        sustain_mph = _solve_mph(remaining_miles, remaining_minutes, fallback=avg_mph_goal)
    else:
        sustain_mph = _solve_mph(float(state.get("remaining_miles") or 0.0), float(state.get("remaining_minutes") or 0.0), fallback=avg_mph_goal)

    if sustain_mph <= EPS:
        sustain_mph = avg_mph_goal if avg_mph_goal > EPS else max_mph
    sustain_mph = min(sustain_mph, max_mph)

    if sustain_progression > EPS:
        recommendations.append(
            _segment(
                label="Hard Sustain",
                progression_unit=progression_unit_norm,
                target_progression=sustain_progression,
                target_mph=sustain_mph,
                notes="Stay aggressive but controlled for the remaining work.",
                intensity="hard",
            )
        )

    return _package_result(
        "fast",
        "Fast",
        progression,
        progression_unit_norm,
        avg_mph_goal,
        goal_distance,
        max_mph_goal,
        state,
        recommendations,
    )


def recommend_min_run(
    progression: float,
    progression_unit: str,
    avg_mph_goal: float,
    goal_distance: float,
    max_mph_goal: float,
    already_complete: Dict[str, Any] | None = None,
) -> Dict[str, Any]:
    progression_unit_norm = normalize_progression_unit(progression_unit)
    state = normalize_already_complete(
        progression=progression,
        progression_unit=progression_unit_norm,
        avg_mph_goal=avg_mph_goal,
        already_complete=already_complete,
    )
    remaining = float(state.get("remaining_progression") or 0.0)
    recommendations: List[Dict[str, Any]] = []
    if remaining <= EPS:
        return _package_result(
            "min_run",
            "Min Run",
            progression,
            progression_unit_norm,
            avg_mph_goal,
            goal_distance,
            max_mph_goal,
            state,
            recommendations,
        )

    easy_mph = _required_mph_for_remaining(
        state=state,
        avg_mph_goal=avg_mph_goal,
        fallback=(max_mph_goal * 0.9 if max_mph_goal > EPS else 1.0),
    )
    pickup_progression = 0.0
    if not bool(state.get("max_goal_done")) and goal_distance > EPS:
        pickup_progression = min(remaining * 0.1, goal_distance)
    easy_progression = max(0.0, remaining - pickup_progression)

    if easy_progression > EPS:
        recommendations.append(
            _segment(
                label="Long Easy Block",
                progression_unit=progression_unit_norm,
                target_progression=easy_progression,
                target_mph=easy_mph,
                notes="Keep it comfortable. Walk breaks and hydration are fine.",
                intensity="easy",
            )
        )

    if pickup_progression > EPS and max_mph_goal > EPS:
        recommendations.append(
            _segment(
                label="Optional Closing Pickup",
                progression_unit=progression_unit_norm,
                target_progression=pickup_progression,
                target_mph=max_mph_goal,
                notes="Short controlled pickup if you want to hit the max block today.",
                intensity="steady",
            )
        )

    return _package_result(
        "min_run",
        "Min Run",
        progression,
        progression_unit_norm,
        avg_mph_goal,
        goal_distance,
        max_mph_goal,
        state,
        recommendations,
    )


def recommend_x400(
    progression: float,
    progression_unit: str,
    avg_mph_goal: float,
    goal_distance: float,
    max_mph_goal: float,
    already_complete: Dict[str, Any] | None = None,
) -> Dict[str, Any]:
    return _interval_recommendation(
        workout_type="x400",
        workout_name="x400",
        progression=progression,
        progression_unit=progression_unit,
        avg_mph_goal=avg_mph_goal,
        goal_distance=goal_distance,
        max_mph_goal=max_mph_goal,
        already_complete=already_complete,
    )


def recommend_x200(
    progression: float,
    progression_unit: str,
    avg_mph_goal: float,
    goal_distance: float,
    max_mph_goal: float,
    already_complete: Dict[str, Any] | None = None,
) -> Dict[str, Any]:
    return _interval_recommendation(
        workout_type="x200",
        workout_name="x200",
        progression=progression,
        progression_unit=progression_unit,
        avg_mph_goal=avg_mph_goal,
        goal_distance=goal_distance,
        max_mph_goal=max_mph_goal,
        already_complete=already_complete,
    )


def recommend_x800(
    progression: float,
    progression_unit: str,
    avg_mph_goal: float,
    goal_distance: float,
    max_mph_goal: float,
    already_complete: Dict[str, Any] | None = None,
) -> Dict[str, Any]:
    return _interval_recommendation(
        workout_type="x800",
        workout_name="x800",
        progression=progression,
        progression_unit=progression_unit,
        avg_mph_goal=avg_mph_goal,
        goal_distance=goal_distance,
        max_mph_goal=max_mph_goal,
        already_complete=already_complete,
    )


WORKOUT_RECOMMENDERS: Dict[str, Callable[..., Dict[str, Any]]] = {
    "mi_run": recommend_mi_run,
    "tempo": recommend_tempo,
    "fast": recommend_fast,
    "min_run": recommend_min_run,
    "x400": recommend_x400,
    "x200": recommend_x200,
    "x800": recommend_x800,
}


def recommend_for_workout_name(
    workout_name: str,
    progression: float,
    progression_unit: str,
    avg_mph_goal: float,
    goal_distance: float,
    max_mph_goal: float,
    already_complete: Dict[str, Any] | None = None,
) -> Dict[str, Any]:
    workout_type = canonical_workout_type(workout_name)
    recommender = WORKOUT_RECOMMENDERS.get(workout_type, recommend_mi_run)
    payload = recommender(
        progression=progression,
        progression_unit=normalize_progression_unit(progression_unit),
        avg_mph_goal=float(avg_mph_goal or 0.0),
        goal_distance=float(goal_distance or 0.0),
        max_mph_goal=float(max_mph_goal or 0.0),
        already_complete=already_complete,
    )
    payload["workout_name"] = workout_name or payload.get("workout_name") or workout_type
    payload["workout_type"] = workout_type
    return payload


def list_supported_workout_types() -> List[Dict[str, str]]:
    payload: List[Dict[str, str]] = []
    for workout_type in ("mi_run", "tempo", "fast", "min_run", "x400", "x200", "x800"):
        payload.append(
            {
                "workout_type": workout_type,
                "description": WORKOUT_DESCRIPTION_BY_TYPE.get(workout_type, ""),
            }
        )
    return payload
